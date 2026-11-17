import { describe, expect, it } from 'vitest';
import { getArrivals, minutesUntil } from '../src/arrivals.js';
import { buildGtfsData } from '../src/gtfs/build.js';
import type { GtfsSource } from '../src/gtfs/types.js';
import type { Remembered } from '../src/realtime/memory.js';
import type { TripRealtime } from '../src/realtime/poller.js';
import type { VehicleState } from '../src/realtime/vehicles.js';
import { serviceDayBase } from '../src/time.js';

const TODAY = '20261104'; // miércoles
const YESTERDAY = '20261103';

const FILES: Record<string, string> = {
  'calendar.txt': `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
TUE,0,1,0,0,0,0,0,20261103,20261103
WED,0,0,1,0,0,0,0,20261104,20261104
WEDX,0,0,1,0,0,0,0,20261104,20261104`,
  'calendar_dates.txt': `service_id,date,exception_type
WEDX,20261104,2`,
  'routes.txt': `route_id,route_short_name,route_long_name,route_type,route_color,route_text_color
10T0001C1  ,C1  ,Principe Pio   -Aeropuerto,2,75B6E0,FFFFFF
10T0003C3  ,C3  ,Sol-Aranjuez,2,9B4A97,FFFFFF`,
  'trips.txt': `route_id,service_id,trip_id,trip_headsign
10T0001C1,TUE,NIGHT,
10T0001C1,WED,A,
10T0003C3,WED,B,
10T0003C3,WEDX,REMOVED,`,
  'stops.txt': `stop_id,stop_name,stop_lat,stop_lon
S1,Origen,40.0,-3.0
S2,Atocha,40.4,-3.69
S3,Destino,40.5,-3.7
S9,Sin servicio,40.6,-3.8`,
  'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence
NIGHT,24:05:00,24:05:00,S1,001
NIGHT,24:10:00,24:10:00,S2,002
A,08:00:00,08:00:00,S1,001
A,08:10:00,08:11:00,S2,002
A,08:20:00,08:20:00,S3,003
B,08:30:00,08:30:00,S3,001
B,08:40:00,08:40:00,S2,002
REMOVED,08:15:00,08:15:00,S2,001`,
};

function source(files: Record<string, string>): GtfsSource {
  return {
    has: (f) => f in files,
    async *rows(f) {
      const [head, ...lines] = files[f].trim().split('\n');
      const header = head.split(',').map((h) => h.trim());
      for (const line of lines) {
        const cells = line.split(',').map((c) => c.trim());
        yield Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
      }
    },
  };
}

const at = (date: string, hh: number, mm: number) => serviceDayBase(date) + (hh * 3600 + mm * 60) * 1000;
const noRt = { trips: new Map<string, TripRealtime>() };

describe('buildGtfsData', () => {
  it('construye paradas con líneas y descarta las que no tienen servicio', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    expect(data.stops.has('S9')).toBe(false);
    expect(data.stops.get('S2')!.lines.map((l) => l.name)).toEqual(['C1', 'C3']);
    expect(data.stops.get('S2')!.network).toBe('Madrid');
  });

  it('guarda las paradas de cada viaje en orden', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    expect(data.tripStops.get('A')).toEqual(['S1', 'S2', 'S3']);
    expect(data.trips.get('B')!.firstStopId).toBe('S3');
  });

  it('usa la última parada como destino cuando trip_headsign está vacío', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    expect(data.trips.get('A')!.headsign).toBe('Destino');
    expect(data.trips.get('B')!.headsign).toBe('Atocha');
  });
});

describe('minutesUntil', () => {
  const now = 1_000_000_000;
  it('muestra "Ahora" solo en los últimos 30 s', () => {
    expect(minutesUntil(now + 30_000, now)).toBe(0);
    expect(minutesUntil(now - 20_000, now)).toBe(0);
    expect(minutesUntil(now + 31_000, now)).toBe(1);
  });
  it('redondea al minuto más cercano', () => {
    expect(minutesUntil(now + 89_000, now)).toBe(1);
    expect(minutesUntil(now + 100_000, now)).toBe(2);
    expect(minutesUntil(now + 10 * 60_000, now)).toBe(10);
  });
});

describe('getArrivals', () => {
  it('ordena los próximos trenes y calcula los minutos', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const res = getArrivals(data, noRt, 'S2', at(TODAY, 8, 0));
    expect(res.map((a) => a.tripId)).toEqual(['A', 'B']);
    expect(res[0].minutes).toBe(10);
    expect(res[0].realtime).toBe(false);
    expect(res[0].line.name).toBe('C1');
    expect(res[0].hasPosition).toBe(false);
    expect(res[1].terminates).toBe(true);
  });

  it('respeta calendar_dates que eliminan un servicio', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const res = getArrivals(data, noRt, 'S2', at(TODAY, 8, 0));
    expect(res.find((a) => a.tripId === 'REMOVED')).toBeUndefined();
  });

  it('incluye trenes del día anterior que pasan de las 24:00', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const res = getArrivals(data, noRt, 'S2', at(TODAY, 0, 0));
    expect(res[0].tripId).toBe('NIGHT');
    expect(res[0].minutes).toBe(10);
    expect(res[0].scheduled).toBe(at(YESTERDAY, 24, 10));
  });

  it('aplica el retraso en tiempo real del viaje', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const rt = { trips: new Map<string, TripRealtime>([['A', { delaySec: 300, cancelled: false, stops: new Map() }]]) };
    const [a] = getArrivals(data, rt, 'S2', at(TODAY, 8, 0));
    expect(a.realtime).toBe(true);
    expect(a.delaySec).toBe(300);
    expect(a.minutes).toBe(15);
  });

  it('prioriza la hora estimada de la parada y reordena por ella', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const rt = {
      trips: new Map<string, TripRealtime>([
        ['A', { delaySec: 0, cancelled: false, stops: new Map([['S2', { time: at(TODAY, 8, 45), skipped: false }]]) }],
      ]),
    };
    const res = getArrivals(data, rt, 'S2', at(TODAY, 8, 0));
    expect(res.map((a) => a.tripId)).toEqual(['B', 'A']);
    expect(res[1].delaySec).toBe(35 * 60);
  });

  it('muestra en origen un tren que aún no ha salido aunque el feed solo informe la parada siguiente', async () => {
    // Caso real (Santander → Valdecilla): Renfe no publica la parada de origen.
    const data = await buildGtfsData(source(FILES), TODAY);
    const rt = {
      trips: new Map<string, TripRealtime>([
        ['A', { delaySec: 0, cancelled: false, stops: new Map([['S2', { time: at(TODAY, 8, 10), skipped: false }]]) }],
      ]),
    };
    const [a] = getArrivals(data, rt, 'S1', at(TODAY, 7, 55));
    expect(a.tripId).toBe('A');
    expect(a.minutes).toBe(5);
    expect(a.realtime).toBe(true);
  });

  it('usa el retraso de la parada informada más cercana si la nuestra no viene en el feed', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const rt = {
      trips: new Map<string, TripRealtime>([
        // Llega a S3 (08:20 programado) a las 08:27 → 7 min de retraso; el retraso del viaje dice 0.
        ['A', { delaySec: 0, cancelled: false, stops: new Map([['S3', { time: at(TODAY, 8, 27), skipped: false }]]) }],
      ]),
    };
    const [a] = getArrivals(data, rt, 'S2', at(TODAY, 8, 0));
    expect(a.delaySec).toBe(7 * 60);
    expect(a.minutes).toBe(17);
  });

  describe('trenes sin confirmar', () => {
    it('marca el tren sin datos que ya debería haber salido de su origen', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      // A sale de S1 a las 08:00; a las 08:05 sin ningún dato en tiempo real.
      const [a] = getArrivals(data, noRt, 'S2', at(TODAY, 8, 5));
      expect(a.tripId).toBe('A');
      expect(a.unconfirmed).toBe(true);
    });

    it('marca el que sale de origen en menos de 5 min sin datos, pero no el que sale más tarde', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      expect(getArrivals(data, noRt, 'S1', at(TODAY, 7, 56))[0].unconfirmed).toBe(true);
      expect(getArrivals(data, noRt, 'S1', at(TODAY, 7, 50))[0].unconfirmed).toBe(false);
    });

    it('no marca el tren con datos en tiempo real o con posición', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const rt = { trips: new Map<string, TripRealtime>([['A', { delaySec: 0, cancelled: false, stops: new Map() }]]) };
      expect(getArrivals(data, rt, 'S2', at(TODAY, 8, 5))[0].unconfirmed).toBe(false);
      const veh: VehicleState = { lat: 40, lon: -3, stopId: 'S1', status: 'in_transit', timestamp: null };
      const withVeh = { trips: new Map<string, TripRealtime>(), vehicles: new Map([['A', veh]]) };
      expect(getArrivals(data, withVeh, 'S2', at(TODAY, 8, 5))[0].unconfirmed).toBe(false);
    });
  });

  it('marca trenes cancelados', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const rt = { trips: new Map<string, TripRealtime>([['B', { cancelled: true, stops: new Map() }]]) };
    const res = getArrivals(data, rt, 'S2', at(TODAY, 8, 0));
    expect(res.find((a) => a.tripId === 'B')!.cancelled).toBe(true);
  });

  describe('posición real del tren', () => {
    const veh = (
      stopId: string,
      status: VehicleState['status'],
      platform?: string,
      [lat, lon]: [number, number] = [40, -3],
    ): VehicleState => ({
      lat,
      lon,
      stopId,
      status,
      platform,
      timestamp: null,
    });
    const withVeh = (v: VehicleState) => ({ trips: new Map<string, TripRealtime>(), vehicles: new Map([['A', v]]) });

    it('marca el tren parado en la estación con su vía, aunque su hora ya haya pasado', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const [a] = getArrivals(data, withVeh(veh('S2', 'stopped', '3')), 'S2', at(TODAY, 8, 12));
      expect(a.tripId).toBe('A');
      expect(a.vehicleStatus).toBe('at_platform');
      expect(a.platform).toBe('3');
      expect(a.minutes).toBe(0);
      expect(a.hasPosition).toBe(true);
    });

    it('marca el tren que está entrando', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const [a] = getArrivals(data, withVeh(veh('S2', 'incoming')), 'S2', at(TODAY, 8, 9));
      expect(a.vehicleStatus).toBe('arriving');
      expect(a.platform).toBeUndefined();
    });

    it('no marca nada si el tren va en marcha desde la parada anterior', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const [a] = getArrivals(data, withVeh(veh('S1', 'in_transit', '3')), 'S2', at(TODAY, 8, 5));
      expect(a.tripId).toBe('A');
      expect(a.vehicleStatus).toBeUndefined();
      expect(a.platform).toBeUndefined();
    });

    // Renfe pone en "en tránsito" la parada que el tren acaba de dejar.
    it('descarta el tren en tránsito desde nuestra parada si ya está lejos de ella', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const res = getArrivals(data, withVeh(veh('S2', 'in_transit', undefined, [40.41, -3.69])), 'S2', at(TODAY, 8, 10));
      expect(res.find((a) => a.tripId === 'A')).toBeUndefined();
    });

    it('mantiene el tren en tránsito desde nuestra parada si aún está saliendo', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const [a] = getArrivals(data, withVeh(veh('S2', 'in_transit', undefined, [40.4005, -3.69])), 'S2', at(TODAY, 8, 10));
      expect(a.tripId).toBe('A');
      expect(a.vehicleStatus).toBeUndefined();
    });

    it('descarta el tren que ya está en una parada posterior aunque la estimación diga que no ha llegado', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const res = getArrivals(data, withVeh(veh('S3', 'incoming')), 'S2', at(TODAY, 8, 9));
      expect(res.find((a) => a.tripId === 'A')).toBeUndefined();
    });

    it('en origen no descarta el tren que aún no ha salido', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const [a] = getArrivals(data, withVeh(veh('S1', 'stopped', '1')), 'S1', at(TODAY, 7, 55));
      expect(a.tripId).toBe('A');
      expect(a.vehicleStatus).toBe('at_platform');
    });
  });

  // Renfe deja de publicar a veces un tren a mitad de recorrido (sobre todo en huelgas).
  describe('trenes que dejan de dar señal', () => {
    const lostRt = (delaySec: number): TripRealtime => ({ delaySec, cancelled: false, stops: new Map() });
    const veh = (stopId: string, status: VehicleState['status']): VehicleState => ({
      lat: 40.2,
      lon: -3.3,
      stopId,
      status,
      timestamp: null,
    });
    /** Nada en la última lectura de los feeds; en memoria, lo último que se supo de A (o de `id`). */
    const lost = (m: Remembered, id = 'A') => ({
      trips: new Map<string, TripRealtime>(),
      vehicles: new Map<string, VehicleState>(),
      memory: new Map([[id, m]]),
    });
    // A: S1 08:00 → S2 08:10 → S3 08:20. Perdido en marcha desde S1 y con +15 min.
    const enMarcha = (seenAt: number, delay = 900): Remembered => ({
      rt: lostRt(delay),
      rtAt: seenAt,
      vehicle: veh('S1', 'in_transit'),
      vehicleAt: seenAt,
    });
    const findA = (res: ReturnType<typeof getArrivals>) => res.find((a) => a.tripId === 'A');

    it('mantiene su último retraso en vez de volver a la hora programada', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const now = at(TODAY, 8, 12);
      // Sin memoria, el tren (08:10 programado) ya habría desaparecido de la estación.
      expect(findA(getArrivals(data, noRt, 'S2', now))).toBeUndefined();
      const a = findA(getArrivals(data, lost(enMarcha(at(TODAY, 8, 5))), 'S2', now))!;
      expect(a.delaySec).toBe(900);
      expect(a.estimated).toBe(at(TODAY, 8, 25));
      expect(a.realtime).toBe(false);
      expect(a.unconfirmed).toBe(false);
      expect(a.lastSeenAt).toBe(at(TODAY, 8, 5));
      expect(a.hasPosition).toBe(true);
    });

    it('un hueco de menos de 2 min no se nota: sigue como dato en directo', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const seen = at(TODAY, 8, 5);
      const a = findA(getArrivals(data, lost(enMarcha(seen)), 'S2', seen + 90_000))!;
      expect(a.realtime).toBe(true);
      expect(a.delaySec).toBe(900);
      expect(a.lastSeenAt).toBeUndefined();
    });

    it('si ya había salido, sigue "sin señal" aunque lleve mucho sin datos', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const a = findA(getArrivals(data, lost(enMarcha(at(TODAY, 8, 5), 1800)), 'S2', at(TODAY, 8, 30)))!;
      expect(a.unconfirmed).toBe(false);
      expect(a.delaySec).toBe(1800);
      expect(a.lastSeenAt).toBe(at(TODAY, 8, 5));
      expect(a.hasPosition).toBe(true);
    });

    it('si se perdió sin salir de su origen: "sin confirmar" con su retraso y sin posición', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const seen = at(TODAY, 8, 5);
      const m: Remembered = { rt: lostRt(900), rtAt: seen, vehicle: veh('S1', 'stopped'), vehicleAt: seen };
      const a = findA(getArrivals(data, lost(m), 'S2', at(TODAY, 8, 10)))!;
      expect(a.unconfirmed).toBe(true);
      expect(a.delaySec).toBe(900);
      expect(a.hasPosition).toBe(false);
    });

    it('en tránsito junto a su origen aún no cuenta como salido', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const seen = at(TODAY, 8, 5);
      // S1 está en 40.0, -3.0: a pocos metros, arrancando.
      const cerca: VehicleState = { lat: 40.0005, lon: -3.0, stopId: 'S1', status: 'in_transit', timestamp: null };
      const a = findA(getArrivals(data, lost({ rt: lostRt(0), rtAt: seen, vehicle: cerca, vehicleAt: seen }), 'S2', at(TODAY, 8, 9)))!;
      expect(a.unconfirmed).toBe(true);
      expect(a.hasPosition).toBe(false);
    });

    it('sin posición, cuenta como en marcha si por horario y retraso ya había salido', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const a = findA(getArrivals(data, lost({ rt: lostRt(120), rtAt: at(TODAY, 8, 5) }), 'S2', at(TODAY, 8, 9)))!;
      expect(a.unconfirmed).toBe(false);
      expect(a.lastSeenAt).toBe(at(TODAY, 8, 5));
    });

    it('sigue en la lista hasta 10 min después de su hora estimada', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      // Hora estimada en S2: 08:25.
      const m = lost(enMarcha(at(TODAY, 8, 5)));
      expect(findA(getArrivals(data, m, 'S2', at(TODAY, 8, 33)))!.minutes).toBe(0);
      expect(findA(getArrivals(data, m, 'S2', at(TODAY, 8, 36)))).toBeUndefined();
    });

    it('no vuelve a mostrar un tren que ya había pasado cuando se perdió', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      // Sin posición, en hora: pasó por S2 a las 08:10 y se perdió a las 08:15.
      const m = lost({ rt: lostRt(0), rtAt: at(TODAY, 8, 15) });
      expect(findA(getArrivals(data, m, 'S2', at(TODAY, 8, 18)))).toBeUndefined();
      // En S3 (08:20) sí sigue: aún no había llegado.
      expect(findA(getArrivals(data, m, 'S3', at(TODAY, 8, 18)))!.lastSeenAt).toBe(at(TODAY, 8, 15));
      // Terminó en S3 a las 08:20 y por eso dejó de salir: no reaparece.
      const fin = lost({ rt: lostRt(0), rtAt: at(TODAY, 8, 21) });
      expect(findA(getArrivals(data, fin, 'S3', at(TODAY, 8, 24)))).toBeUndefined();
      // Perdido a una parada del final: en el destino no se le da margen tras su hora.
      const casi = lost({ ...enMarcha(at(TODAY, 8, 15), 0), vehicle: veh('S2', 'in_transit') });
      expect(findA(getArrivals(data, casi, 'S3', at(TODAY, 8, 19)))).toBeDefined();
      expect(findA(getArrivals(data, casi, 'S3', at(TODAY, 8, 21)))).toBeUndefined();
    });

    it('descarta el tren si su última posición ya estaba más allá de nuestra parada', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const m: Remembered = { ...enMarcha(at(TODAY, 8, 5)), vehicle: veh('S3', 'incoming') };
      expect(findA(getArrivals(data, lost(m), 'S2', at(TODAY, 8, 12)))).toBeUndefined();
    });

    it('con la última posición en nuestra parada no afirma "En andén"; si es la última, ya ha llegado', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const seen = at(TODAY, 8, 8);
      const enS2: Remembered = { rt: lostRt(0), rtAt: seen, vehicle: veh('S2', 'stopped'), vehicleAt: seen };
      expect(findA(getArrivals(data, lost(enS2), 'S2', at(TODAY, 8, 12)))!.vehicleStatus).toBeUndefined();
      // B termina en S2 (08:40): perdido parado allí, ha terminado su recorrido.
      const bSeen = at(TODAY, 8, 40);
      const bEnS2: Remembered = { rt: lostRt(0), rtAt: bSeen, vehicle: veh('S2', 'stopped'), vehicleAt: bSeen };
      const res = getArrivals(data, lost(bEnS2, 'B'), 'S2', at(TODAY, 8, 44));
      expect(res.find((a) => a.tripId === 'B')).toBeUndefined();
    });

    it('con retraso en directo pero la posición perdida en su origen, tampoco se puede seguir', async () => {
      const data = await buildGtfsData(source(FILES), TODAY);
      const seen = at(TODAY, 7, 50);
      const rt = {
        trips: new Map<string, TripRealtime>([['A', lostRt(600)]]),
        vehicles: new Map<string, VehicleState>(),
        memory: new Map([['A', { vehicle: veh('S1', 'stopped'), vehicleAt: seen }]]),
      };
      const a = findA(getArrivals(data, rt, 'S2', at(TODAY, 8, 0)))!;
      expect(a.realtime).toBe(true);
      expect(a.hasPosition).toBe(false);
    });
  });

  it('descarta trenes ya pasados y fuera de la ventana', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    expect(getArrivals(data, noRt, 'S2', at(TODAY, 8, 15)).map((a) => a.tripId)).toEqual(['B']);
    expect(getArrivals(data, noRt, 'S2', at(TODAY, 5, 0))).toEqual([]);
  });
});
