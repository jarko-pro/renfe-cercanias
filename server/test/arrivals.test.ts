import { describe, expect, it } from 'vitest';
import { getArrivals, minutesUntil } from '../src/arrivals.js';
import { buildGtfsData } from '../src/gtfs/build.js';
import type { GtfsSource } from '../src/gtfs/types.js';
import type { TripRealtime } from '../src/realtime/poller.js';
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

  it('marca trenes cancelados', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const rt = { trips: new Map<string, TripRealtime>([['B', { cancelled: true, stops: new Map() }]]) };
    const res = getArrivals(data, rt, 'S2', at(TODAY, 8, 0));
    expect(res.find((a) => a.tripId === 'B')!.cancelled).toBe(true);
  });

  it('descarta trenes ya pasados y fuera de la ventana', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    expect(getArrivals(data, noRt, 'S2', at(TODAY, 8, 15)).map((a) => a.tripId)).toEqual(['B']);
    expect(getArrivals(data, noRt, 'S2', at(TODAY, 5, 0))).toEqual([]);
  });
});
