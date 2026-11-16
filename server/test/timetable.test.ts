import { describe, expect, it } from 'vitest';
import { buildGtfsData } from '../src/gtfs/build.js';
import type { GtfsSource } from '../src/gtfs/types.js';
import type { Observed } from '../src/history/collector.js';
import { getStopTimetable, getTripTimes } from '../src/timetable.js';
import { serviceDayBase } from '../src/time.js';

const TODAY = '20261104'; // miércoles
const TOMORROW = '20261105';

const FILES: Record<string, string> = {
  'calendar.txt': `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
WED,0,0,1,0,0,0,0,20261104,20261104
THU,0,0,0,1,0,0,0,20261105,20261105`,
  'routes.txt': `route_id,route_short_name,route_long_name,route_type,route_color,route_text_color
10T0001C1,C1,Principe Pio-Aeropuerto,2,75B6E0,FFFFFF
10T0003C3,C3,Sol-Aranjuez,2,9B4A97,FFFFFF`,
  'trips.txt': `route_id,service_id,trip_id,trip_headsign,shape_id
10T0001C1,WED,A1,,10_C1
10T0001C1,WED,A2,,10_C1
10T0001C1,WED,SHORT,,10_C1
10T0001C1,WED,B1,,10_C1_INV
10T0001C1,WED,END,,10_C1_INV
10T0003C3,WED,C1,,
10T0001C1,THU,TH,,10_C1`,
  'stops.txt': `stop_id,stop_name,stop_lat,stop_lon
S1,Origen,40.0,-3.0
S2,Atocha,40.4,-3.69
S3,Destino,40.5,-3.7
S4,Corto,40.45,-3.7`,
  'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence
A2,09:00:00,09:00:00,S1,1
A2,09:10:00,09:11:00,S2,2
A2,09:20:00,09:20:00,S3,3
A1,08:00:00,08:00:00,S1,1
A1,08:10:00,08:11:00,S2,2
A1,08:20:00,08:20:00,S3,3
SHORT,24:30:00,24:30:00,S1,1
SHORT,24:40:00,24:41:00,S2,2
SHORT,24:45:00,24:45:00,S4,3
B1,07:00:00,07:00:00,S3,1
B1,07:10:00,07:10:00,S2,2
B1,07:20:00,07:20:00,S1,3
END,07:30:00,07:30:00,S3,1
END,07:40:00,07:40:00,S2,2
C1,10:00:00,10:00:00,S2,1
C1,10:10:00,10:10:00,S3,2
TH,06:00:00,06:00:00,S1,1
TH,06:10:00,06:10:00,S2,2
TH,06:20:00,06:20:00,S3,3`,
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

describe('getStopTimetable', () => {
  it('agrupa por línea y sentido, marca los otros destinos y omite los que terminan aquí', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const tt = getStopTimetable(data, 'S2', TODAY)!;
    expect(tt.base).toBe(serviceDayBase(TODAY));
    expect(tt.groups.map((g) => [g.line.name, g.headsign])).toEqual([
      ['C1', 'Destino'],
      ['C1', 'Origen'],
      ['C3', 'Destino'],
    ]);
    const ida = tt.groups[0];
    expect(ida.notes).toEqual([{ mark: 'a', headsign: 'Corto' }]);
    // Ordenadas por hora de salida; las de después de medianoche, al final.
    expect(ida.trains).toEqual([
      { tripId: 'A1', t: 8 * 3600 + 11 * 60 },
      { tripId: 'A2', t: 9 * 3600 + 11 * 60 },
      { tripId: 'SHORT', t: 24 * 3600 + 41 * 60, mark: 'a' },
    ]);
    // END termina en S2: no sale hacia ningún sitio.
    expect(tt.groups[1].trains.map((t) => t.tripId)).toEqual(['B1']);
  });

  it('da el horario de mañana con sus propios servicios', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const tt = getStopTimetable(data, 'S2', TOMORROW)!;
    expect(tt.groups).toHaveLength(1);
    expect(tt.groups[0].trains.map((t) => t.tripId)).toEqual(['TH']);
  });

  it('null si la parada no existe', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    expect(getStopTimetable(data, 'NOPE', TODAY)).toBeNull();
  });
});

describe('getTripTimes', () => {
  it('lista las paradas con la salida de cada una y la llegada en la última', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const trip = getTripTimes(data, 'A1', TODAY)!;
    expect(trip.line.name).toBe('C1');
    expect(trip.headsign).toBe('Destino');
    expect(trip.stops).toEqual([
      { stopId: 'S1', name: 'Origen', t: 8 * 3600 },
      { stopId: 'S2', name: 'Atocha', t: 8 * 3600 + 11 * 60 },
      { stopId: 'S3', name: 'Destino', t: 8 * 3600 + 20 * 60 },
    ]);
    expect(getTripTimes(data, 'NOPE', TODAY)).toBeNull();
  });
});

describe('trenes ya pasados', () => {
  const base = serviceDayBase(TODAY);
  const at = (hh: number, mm: number) => base + (hh * 3600 + mm * 60) * 1000;
  const obs: Record<string, Observed> = {
    // A1: Renfe solo dio retraso en la primera parada (+3 min): vale también para Atocha.
    A1: { stops: ['S1', 'S2', 'S3'], delays: [180, null, null], cancelled: false, status: 'ok' },
    // A2: va con +10 min, todavía no ha llegado a Atocha a las 09:15.
    A2: { stops: ['S1', 'S2', 'S3'], delays: [600, 600, 600], cancelled: false, status: 'running' },
    B1: { stops: ['S3', 'S2', 'S1'], delays: [null, null, null], cancelled: true, status: 'cancelled' },
  };
  const live = { nowMs: at(9, 15), observed: (_d: string, id: string) => obs[id] ?? null };

  it('marca en el horario de hoy los que han pasado, con su retraso', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const tt = getStopTimetable(data, 'S2', TODAY, live)!;
    const [ida, vuelta, c3] = tt.groups;
    expect(ida.trains.map((t) => t.passed)).toEqual([{ delaySec: 180 }, undefined, undefined]);
    expect(vuelta.trains[0].passed).toEqual({ delaySec: null, cancelled: true });
    // C1 (10:00) aún no toca.
    expect(c3.trains[0].passed).toBeUndefined();
    // Sin datos de un tren que ya debería haber pasado: pasado, sin retraso conocido.
    const later = getStopTimetable(data, 'S2', TODAY, { ...live, nowMs: at(10, 5) })!;
    expect(later.groups[2].trains[0].passed).toEqual({ delaySec: null });
    // Sin `live` (mañana) no se marca nada.
    expect(getStopTimetable(data, 'S2', TODAY)!.groups[0].trains.every((t) => !t.passed)).toBe(true);
  });

  it('el recorrido lleva el retraso en las paradas ya pasadas', async () => {
    const data = await buildGtfsData(source(FILES), TODAY);
    const trip = getTripTimes(data, 'A2', TODAY, live)!;
    expect(trip.stops.map((s) => s.passed)).toEqual([{ delaySec: 600 }, undefined, undefined]);
    expect(getTripTimes(data, 'B1', TODAY, live)!.cancelled).toBe(true);
  });
});
