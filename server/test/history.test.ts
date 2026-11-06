import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildGtfsData } from '../src/gtfs/build.js';
import type { GtfsData, GtfsSource } from '../src/gtfs/types.js';
import { createCollector, trainNumber, type TrainRun } from '../src/history/collector.js';
import { insertRuns, migrate, type Db } from '../src/history/db.js';
import type { TripRealtime } from '../src/realtime/poller.js';
import { serviceDayBase } from '../src/time.js';

const TODAY = '20261104';

const FILES: Record<string, string> = {
  'calendar.txt': `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
1004J,0,0,1,0,0,0,0,20261104,20261104`,
  'routes.txt': `route_id,route_short_name,route_long_name,route_type,route_color,route_text_color
10T0001C1,C1,Principe Pio-Aeropuerto,2,75B6E0,FFFFFF`,
  'trips.txt': `route_id,service_id,trip_id,trip_headsign
10T0001C1,1004J,1004J19799C1,
10T0001C1,1004J,1004J19801C1,
10T0001C1,1004J,1004J19803C1,`,
  'stops.txt': `stop_id,stop_name,stop_lat,stop_lon
S1,Origen,40.0,-3.0
S2,Atocha,40.4,-3.69
S3,Destino,40.5,-3.7`,
  'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence
1004J19799C1,08:00:00,08:00:00,S1,1
1004J19799C1,08:10:00,08:11:00,S2,2
1004J19799C1,08:20:00,08:20:00,S3,3
1004J19801C1,09:00:00,09:00:00,S1,1
1004J19801C1,09:20:00,09:20:00,S3,2
1004J19803C1,10:00:00,10:00:00,S1,1
1004J19803C1,10:20:00,10:20:00,S3,2`,
};

function source(files: Record<string, string>): GtfsSource {
  return {
    has: (f) => f in files,
    async *rows(f) {
      const [head, ...lines] = files[f].trim().split('\n');
      const header = head.split(',');
      for (const line of lines) {
        const cells = line.split(',');
        yield Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
      }
    },
  };
}

const at = (hh: number, mm: number) => serviceDayBase(TODAY) + (hh * 3600 + mm * 60) * 1000;
const rt = (stops: [string, number][], cancelled = false): TripRealtime => ({
  cancelled,
  delaySec: stops[0]?.[1],
  stops: new Map(stops.map(([id, d]) => [id, { delaySec: d, skipped: false }])),
});

let data: GtfsData;
beforeAll(async () => {
  data = await buildGtfsData(source(FILES), TODAY);
});

/** Simula lecturas del feed cada 30 s entre dos horas. */
function feed(c: ReturnType<typeof createCollector>, from: number, to: number, trips: (t: number) => Map<string, TripRealtime>) {
  for (let t = from; t <= to; t += 30_000) c.observe(data, trips(t), new Map(), TODAY, t);
}

describe('trainNumber', () => {
  it('saca el número del trip_id de Renfe', () => {
    expect(trainNumber('1008J19799C1')).toBe('19799');
    expect(trainNumber('5108J77636R4')).toBe('77636');
    expect(trainNumber('1008J17098C8a')).toBe('17098');
    expect(trainNumber('raro')).toBeNull();
  });
});

describe('collector', () => {
  it('guarda el último retraso previsto de cada parada al pasar el tren', () => {
    const c = createCollector(at(7, 0));
    feed(c, at(7, 50), at(9, 30), (t) => {
      const m = new Map<string, TripRealtime>();
      // 19799: va a S2 con 2 min, que suben a 3 justo antes de llegar; luego a S3 con 4 min.
      if (t < at(8, 5)) m.set('1004J19799C1', rt([['S2', 120]]));
      else if (t < at(8, 14)) m.set('1004J19799C1', rt([['S2', 180]]));
      else if (t < at(8, 25)) m.set('1004J19799C1', rt([['S3', 240]]));
      // 19801: cancelado por Renfe.
      if (t > at(8, 50) && t < at(9, 10)) m.set('1004J19801C1', rt([], true));
      return m;
    });
    const runs = c.collect(data, TODAY, at(10, 0));
    const r = runs.find((x) => x.train === '19799')!;
    expect(r).toMatchObject({ service_date: '2026-11-04', network: '10', line: 'C1', status: 'ok', dep_time: 8 * 3600 });
    expect(r.stops).toEqual(['S1', 'S2', 'S3']);
    expect(r.delays).toEqual([null, 180, 240]);
    expect(runs.find((x) => x.train === '19801')!.status).toBe('cancelled');
  });

  it('no cierra un viaje hasta su hora de llegada (con retraso) más un margen', () => {
    const c = createCollector(at(7, 0));
    feed(c, at(7, 50), at(8, 20), () => new Map([['1004J19799C1', rt([['S3', 600]])]]));
    expect(c.collect(data, TODAY, at(8, 45)).map((r) => r.train)).not.toContain('19799');
    expect(c.collect(data, TODAY, at(9, 1)).map((r) => r.train)).toContain('19799');
    // Y no lo devuelve dos veces.
    expect(c.collect(data, TODAY, at(9, 30)).map((r) => r.train)).not.toContain('19799');
  });

  it('marca "sin datos" los trenes que Renfe nunca publicó, solo si los vimos enteros', () => {
    const c = createCollector(at(8, 30)); // arranca después de que saliera el 19799
    feed(c, at(8, 30), at(11, 0), () => new Map());
    const runs = c.collect(data, TODAY, at(11, 0));
    expect(runs.find((r) => r.train === '19801')).toMatchObject({ status: 'no_data', delays: [null, null] });
    expect(runs.find((r) => r.train === '19799')).toBeUndefined();
  });

  it('no marca "sin datos" si el feed estuvo caído durante el viaje', () => {
    const c = createCollector(at(7, 0));
    feed(c, at(7, 0), at(9, 5), () => new Map());
    feed(c, at(9, 30), at(11, 0), () => new Map()); // 25 min sin lecturas
    const runs = c.collect(data, TODAY, at(11, 0));
    expect(runs.find((r) => r.train === '19801')).toBeUndefined();
    expect(runs.find((r) => r.train === '19803')!.status).toBe('no_data');
  });
});

describe('db', () => {
  it('crea la tabla, inserta y no duplica', async () => {
    const pg = new PGlite();
    const db = pg as unknown as Db;
    await migrate(db);
    await migrate(db); // idempotente
    const run: TrainRun = {
      service_date: '2026-11-04',
      network: '10',
      train: '19799',
      line: 'C1',
      trip_id: '1004J19799C1',
      dep_time: 28800,
      status: 'ok',
      stops: ['S1', 'S2', 'S3'],
      delays: [null, 180, 240],
    };
    await insertRuns(db, [run]);
    await insertRuns(db, [run]);
    const { rows } = await db.query<{ train: string; delays: (number | null)[]; stops: string[] }>(
      'select train, delays, stops from train_runs',
    );
    expect(rows).toEqual([{ train: '19799', delays: [null, 180, 240], stops: ['S1', 'S2', 'S3'] }]);
    await pg.close();
  });
});
