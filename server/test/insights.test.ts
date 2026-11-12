import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrainRun } from '../src/history/collector.js';
import { insertRuns, migrate, type Db } from '../src/history/db.js';
import { dayType, lineAnomalies, loadInsights, type Insights } from '../src/history/insights.js';

const run = (date: string, train: string, over: Partial<TrainRun> = {}): TrainRun => ({
  service_date: date,
  network: '10',
  train,
  line: 'C1',
  trip_id: `1004J${train}C1-${date}`,
  dep_time: 8 * 3600 + 15 * 60,
  status: 'ok',
  stops: ['S1', 'S2', 'S3'],
  delays: [0, 60, 120],
  ...over,
});

// Laborables limpios: del lunes 16 al viernes 20 de noviembre de 2026.
const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
const SATURDAYS = ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'];

let pg: PGlite;
let ins: Insights;
beforeAll(async () => {
  pg = new PGlite();
  const db = pg as unknown as Db;
  await migrate(db);
  const runs: TrainRun[] = [];
  WEEK.forEach((d, i) => {
    // 19799: llega a S2 con 1, 2, 3, 4 y 10 min -> mediana 3 min; puntual (<3 min) 2 días.
    runs.push(run(d, '19799', { delays: [0, [60, 120, 180, 240, 600][i], null] }));
    // 19801: un día cancelado y otro sin datos.
    runs.push(run(d, '19801', { status: i === 0 ? 'cancelled' : i === 1 ? 'no_data' : 'ok', delays: [0, 0, 0] }));
  });
  // Solo 3 días: no llega al mínimo.
  WEEK.slice(0, 3).forEach((d) => runs.push(run(d, '19803')));
  // Huelga (día excluido): retrasos enormes que no deben contar.
  runs.push(run('2026-11-10', '19799', { delays: [3600, 3600, 3600] }));
  // Lunes 9, antes de la huelga: sí cuenta, y con él el 19805 llega a 4 días.
  WEEK.slice(0, 3).forEach((d) => runs.push(run(d, '19805')));
  runs.push(run('2026-11-09', '19805'));
  // Anterior al inicio del histórico: no cuenta.
  runs.push(run('2026-11-02', '19803'));
  // Sábado: tipo de día distinto.
  runs.push(run('2026-11-21', '19799', { delays: [0, 0, 0] }));
  // 19807: 4 sábados con 5 min en S2 y 2 laborables en hora.
  for (const d of SATURDAYS) runs.push(run(d, '19807', { delays: [0, 300, 300] }));
  runs.push(run('2026-11-16', '19807', { delays: [0, 0, 0] }), run('2026-11-17', '19807', { delays: [0, 0, 0] }));
  // "Hoy" (a medias): no cuenta.
  runs.push(run('2026-11-30', '19799', { delays: [3600, 3600, 3600] }));
  await insertRuns(db, runs);
  ins = await loadInsights(db, '20261130', 1);
});
afterAll(() => pg.close());

describe('dayType', () => {
  it('distingue laborable, sábado, domingo y festivos', () => {
    expect(dayType('20261116')).toBe('lab');
    expect(dayType('2026-11-21')).toBe('sab');
    expect(dayType('2026-11-22')).toBe('dom');
    expect(dayType('2026-12-08')).toBe('dom'); // martes festivo
  });
});

describe('loadInsights', () => {
  it('usa solo días limpios y completos', () => {
    expect(ins.days).toBe(10); // 9, 16-20 y 4 sábados; ni la huelga, ni antes del inicio, ni hoy
  });

  it('da cómo suele llegar un tren a cada parada', () => {
    expect(ins.atStop('10', '19799', 'lab', 'S2')).toEqual({ days: 5, medianDelaySec: 180, punctualDays: 2 });
    // S3 sin datos ningún día.
    expect(ins.atStop('10', '19799', 'lab', 'S3')).toBeNull();
  });

  it('en un tipo de día con pocos datos, usa todos los días del tren', () => {
    // 19799 solo tiene un sábado: se usan sus 6 días (0, 1, 2, 3, 4 y 10 min).
    expect(ins.atStop('10', '19799', 'sab', 'S2')).toEqual({ days: 6, medianDelaySec: 150, punctualDays: 3 });
    expect(ins.reliability('10', '19799', 'dom')).toMatchObject({ days: 6, ran: 6 });
  });

  it('con 4 días de su tipo, usa solo esos', () => {
    expect(ins.atStop('10', '19807', 'sab', 'S2')).toEqual({ days: 4, medianDelaySec: 300, punctualDays: 0 });
    // Laborables: solo 2, así que todos los días juntos.
    expect(ins.atStop('10', '19807', 'lab', 'S2')).toEqual({ days: 6, medianDelaySec: 300, punctualDays: 2 });
  });

  it('cuenta cuántos días salió el tren', () => {
    expect(ins.reliability('10', '19801', 'lab')).toEqual({ days: 5, ran: 3, cancelled: 1, noData: 1 });
  });

  it('no da nada con menos días del mínimo', () => {
    expect(ins.reliability('10', '19803', 'lab')).toBeNull();
    expect(ins.atStop('10', '19803', 'lab', 'S2')).toBeNull();
  });

  it('cuenta los días normales de antes de la huelga', () => {
    expect(ins.reliability('10', '19805', 'lab')).toEqual({ days: 4, ran: 4, cancelled: 0, noData: 0 });
  });

  it('da lo normal de la línea por hora de salida', () => {
    const b = ins.line('10', 'C1', 'lab', 8)!;
    expect(b.days).toBe(6);
    expect(b.runs).toBe(5 + 3 + 3 + 4 + 2); // los 19801 cancelados o sin datos no cuentan
    expect(b.medianDelaySec).toBe(0);
    expect(ins.line('10', 'C1', 'lab', 9)).toBeNull();
    expect(ins.line('10', 'C1', 'sab', 8)).toMatchObject({ days: 4, medianDelaySec: 300 });
    // Domingo sin datos: todos los días juntos.
    expect(ins.line('10', 'C1', 'dom', 8)).toMatchObject({ days: 10 });
  });

  it('no cuenta dos veces los trenes en el resumen', () => {
    expect(ins.counts().trains).toBe(4); // 19799, 19801, 19805 y 19807; el 19803 no llega al mínimo
  });
});

describe('lineAnomalies', () => {
  const live = (line: string, ...delays: number[]) => delays.map((delaySec) => ({ network: '10', line, delaySec }));

  it('avisa si la línea va claramente peor de lo normal', () => {
    const out = lineAnomalies(ins, live('C1', 400, 500, 600, 0), 'lab', 8);
    expect(out).toEqual([{ network: '10', line: 'C1', nowDelaySec: 450, normalDelaySec: 0, trains: 4 }]);
  });

  it('no avisa con pocos trenes, con poco empeoramiento ni sin referencia', () => {
    expect(lineAnomalies(ins, live('C1', 900, 900), 'lab', 8)).toEqual([]);
    expect(lineAnomalies(ins, live('C1', 120, 180, 240), 'lab', 8)).toEqual([]);
    expect(lineAnomalies(ins, live('C5', 900, 900, 900), 'lab', 8)).toEqual([]);
  });

  it('a falta de datos de esta hora, usa la anterior', () => {
    expect(lineAnomalies(ins, live('C1', 900, 900, 900), 'lab', 9)).toHaveLength(1);
  });
});
