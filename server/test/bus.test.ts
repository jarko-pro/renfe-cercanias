import { PGlite } from '@electric-sql/pglite';
import { parseBusStopId } from '@renfe/shared';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/history/db.js';
import { migrateBus, upsertPasses } from '../src/bus/db.js';
import { buildEmtStatic, emtArrivals, titleCase } from '../src/bus/emt.js';
import { toRows } from '../src/bus/history.js';
import { dailyQuota } from '../src/bus/ondemand.js';
import { createPassDetector, serviceDayOf, type Pass } from '../src/bus/passes.js';
import { BUS_REGISTRY, type SantanderConfig } from '../src/bus/registry.js';
import {
  buildStatic,
  parseEstimates,
  stopArrivals,
  STALE_MS,
  type Estimate,
  type Resource,
} from '../src/bus/santander.js';
import { buildTmbStatic, tmbArrivals } from '../src/bus/tmb.js';
import { serviceDayBase } from '../src/time.js';

const cfg = BUS_REGISTRY.santander as SantanderConfig;

// Recortes de los datasets reales del Ayuntamiento de Santander (24-11-2026).
const STOPS: Resource[] = [
  {
    'ayto:numero': '328',
    'ayto:parada': 'Avenida  de los Castros 47',
    'ayto:sentido': 'PCTCAN',
    'wgs84_pos:lat': '43.4710',
    'wgs84_pos:long': '-3.7950',
  },
  { 'ayto:numero': '201', 'ayto:parada': 'Cuatro Caminos', 'wgs84_pos:lat': '43.4587', 'wgs84_pos:long': '-3.8253' },
  // Sin ninguna línea en las secuencias: no se muestra.
  { 'ayto:numero': '999', 'ayto:parada': 'Parada sin servicio', 'wgs84_pos:lat': '43.45', 'wgs84_pos:long': '-3.80' },
];
const LINES: Resource[] = [{ 'ayto:numero': '1' }, { 'ayto:numero': '5C1' }, { 'ayto:numero': '11' }];
const SEQ: Resource[] = [
  { 'ayto:NParada': '328', 'dc:EtiquetaLinea': '11' },
  { 'ayto:NParada': '328', 'dc:EtiquetaLinea': '1' },
  { 'ayto:NParada': '328', 'dc:EtiquetaLinea': '5C1' },
  { 'ayto:NParada': '201', 'dc:EtiquetaLinea': '1' },
];

const T0 = Date.parse('2026-11-24T19:10:00Z');

function est(stop: string, line: string, t1: number, dest1: string, t2: number | null, dest2: string, at: number): Resource {
  return {
    'ayto:paradaId': stop,
    'ayto:etiqLinea': line,
    'ayto:tiempo1': String(t1),
    'ayto:distancia1': String(t1 * 6),
    'ayto:destino1': dest1,
    'ayto:tiempo2': t2 == null ? '' : String(t2),
    'ayto:distancia2': t2 == null ? '' : String(t2 * 6),
    'ayto:destino2': t2 == null ? '' : dest2,
    'ayto:fechActual': new Date(at).toISOString(),
  };
}

describe('Santander: paradas y líneas', () => {
  const stat = buildStatic(cfg, STOPS, LINES, SEQ, T0);

  it('construye las paradas con sus líneas en orden natural y el id con la red delante', () => {
    const s = stat.stops.get('328')!;
    expect(s.id).toBe('santander:328');
    expect(s.name).toBe('Avenida de los Castros 47');
    expect(s.towards).toBe('PCTCAN');
    expect(s.lines.map((l) => l.name)).toEqual(['1', '5C1', '11']);
    expect(s.lines[0]).toEqual({ name: '1', color: 'FF0000', textColor: 'FFFFFF' });
  });

  it('no muestra las paradas sin líneas', () => {
    expect(stat.stops.has('999')).toBe(false);
    expect(stat.stops.size).toBe(2);
  });

  it('todos los ids de parada de bus llevan la red delante (nunca chocan con Renfe)', () => {
    for (const s of stat.stops.values()) expect(parseBusStopId(s.id)).toEqual({ feed: 'santander', code: s.code });
    expect(parseBusStopId('18000')).toBeNull();
  });
});

describe('Santander: estimaciones', () => {
  const stat = buildStatic(cfg, STOPS, LINES, SEQ, T0);

  it('lee los dos buses y deja el segundo vacío si no hay', () => {
    const [a, b] = parseEstimates([
      est('328', '1', 240, 'PCTCAN-UNEATLANTICO', 900, 'PCTCAN-UNEATLANTICO', T0),
      est('201', '1', 30, 'GONZALEZ TREVILLA', null, '', T0),
    ]);
    expect(a).toMatchObject({ stop: '328', line: '1', t1: 240, t2: 900, dest2: 'PCTCAN-UNEATLANTICO', at: T0 });
    expect(b).toMatchObject({ t1: 30, t2: null, d2: null, dest2: '' });
  });

  it('agrupa por línea y destino, ordena por el primero y deja aparte las líneas sin buses', () => {
    const e = parseEstimates([
      est('328', '5C1', 600, 'MIRANDA', null, '', T0),
      // Los dos buses de la línea 1 van a destinos distintos: dos filas.
      est('328', '1', 120, 'PCTCAN-UNEATLANTICO', 1500, 'ADARZO', T0),
    ]);
    const now = T0 + 30_000;
    const { lines, idle } = stopArrivals(cfg, stat, e, '328', now);
    expect(lines.map((l) => `${l.line.name}→${l.headsign}`)).toEqual(['1→PCTCAN-UNEATLANTICO', '5C1→MIRANDA', '1→ADARZO']);
    // Los minutos se cuentan desde que TUS calculó la estimación, no desde que la leímos.
    expect(lines[0].next).toEqual([{ estimated: T0 + 120_000, minutes: 2, distanceM: 720 }]);
    expect(idle.map((l) => l.name)).toEqual(['11']);
  });

  it('descarta las estimaciones viejas y los buses que ya deberían haber pasado', () => {
    const e = parseEstimates([
      est('328', '1', 60, 'PCTCAN', null, '', T0 - STALE_MS - 1000),
      est('328', '5C1', 30, 'MIRANDA', 400, 'MIRANDA', T0 - 120_000),
    ]);
    const { lines } = stopArrivals(cfg, stat, e, '328', T0);
    expect(lines).toHaveLength(1);
    expect(lines[0].line.name).toBe('5C1');
    expect(lines[0].next.map((n) => n.minutes)).toEqual([5]);
  });
});

/** Lecturas sucesivas de una sola fila parada × línea. */
function series(rows: [t1: number, t2: number | null, atSec: number][]): Estimate[][] {
  return rows.map(([t1, t2, s]) => parseEstimates([est('201', '1', t1, 'PCTCAN', t2, 'PCTCAN', T0 + s * 1000)]));
}

function run(reads: Estimate[][]): Pass[] {
  const det = createPassDetector();
  return reads.flatMap((r) => det.update(r, r[0]?.at ?? T0));
}

describe('detector de pasos', () => {
  it('detecta el paso cuando el segundo bus pasa a ser el primero', () => {
    const passes = run(
      series([
        [240, 1000, 0],
        [117, 880, 60],
        [40, 820, 120],
        [770, null, 180], // el bus de 40 s ha pasado; el de 820 s es ahora el primero
      ]),
    );
    expect(passes).toEqual([{ stop: '201', line: '1', dest: 'PCTCAN', time: T0 + 160_000 }]);
  });

  it('no cuenta una subida pequeña del tiempo (semáforo, atasco)', () => {
    expect(run(series([[80, 900, 0], [150, 840, 60], [60, 790, 120]]))).toEqual([]);
  });

  it('sin segundo bus, solo cuenta un salto grande', () => {
    expect(run(series([[50, null, 0], [120, null, 60]]))).toEqual([]);
    expect(run(series([[50, null, 0], [1200, null, 60]]))).toHaveLength(1);
  });

  it('no cuenta dos veces la misma estimación ni adivina tras un corte largo', () => {
    expect(run(series([[40, 800, 0], [40, 800, 0], [740, null, 600]]))).toEqual([]);
  });

  it('cuenta el último bus si la fila desaparece con él llegando', () => {
    const det = createPassDetector();
    det.update(series([[30, null, 0]])[0], T0);
    expect(det.update([], T0 + 60_000)).toEqual([{ stop: '201', line: '1', dest: 'PCTCAN', time: T0 + 30_000 }]);
  });
});

describe('día de servicio de los pasos', () => {
  it('la madrugada cuenta para el día anterior, con más de 24 h', () => {
    const late = serviceDayBase('20261124') + (24 * 3600 + 30 * 60) * 1000; // 00:30 del 25
    expect(serviceDayOf(late)).toEqual({ date: '20261124', sec: 24 * 3600 + 30 * 60 });
    const day = serviceDayBase('20261124') + 8 * 3600 * 1000;
    expect(serviceDayOf(day)).toEqual({ date: '20261124', sec: 8 * 3600 });
  });
});

describe('bus_passes', () => {
  it('agrupa los pasos por día, línea, destino y parada y añade horas sin duplicarlas', async () => {
    const db = new PGlite() as unknown as Db;
    await migrateBus(db);
    const base = serviceDayBase('20261124');
    const p = (sec: number, stop = '201'): { feed: string; pass: Pass } => ({
      feed: 'santander',
      pass: { stop, line: '1', dest: 'PCTCAN', time: base + sec * 1000 },
    });
    const first = toRows([p(30000), p(29000), p(29000), p(31000, '328')]);
    expect(first).toEqual([
      { service_date: '2026-11-24', feed: 'santander', line: '1', dest: 'PCTCAN', stop: '201', times: [29000, 30000] },
      { service_date: '2026-11-24', feed: 'santander', line: '1', dest: 'PCTCAN', stop: '328', times: [31000] },
    ]);
    await upsertPasses(db, first);
    await upsertPasses(db, toRows([p(30000), p(32000)]));
    const { rows } = await db.query<{ stop: string; times: number[] }>(
      'select stop, times from bus_passes order by stop',
    );
    expect(rows).toEqual([
      { stop: '201', times: [29000, 30000, 32000] },
      { stop: '328', times: [31000] },
    ]);
  });
});

describe('EMT Madrid', () => {
  // Recortes de la API de MobilityLabs (26-11-2026).
  const LINES = [
    { line: '005', label: '5', nameA: 'SOL SEVILLA', nameB: 'CHAMARTIN', color: '0072ce' },
    { line: '363', label: 'C03', nameA: 'PUERTA DE TOLEDO', nameB: 'ARGÜELLES', color: '0072ce' },
    { line: '501', label: 'N1', nameA: 'CIBELES', nameB: 'SANCHINARRO', color: '050505', forecolor: 'f2fb02' },
    { line: '161', label: '161', nameA: 'MONCLOA', nameB: 'ARAVACA SUR', color: '0072ce' },
  ];
  const STOPS = [
    { node: '72', name: 'Cibeles-Casa de América', geometry: { coordinates: [-3.6929, 40.4189] as [number, number] }, lines: ['005/1', '363/2', '501/1'] },
    { node: '1', name: 'Avenida Valdemarín-Blanca de Castilla', geometry: { coordinates: [-3.7829, 40.4700] as [number, number] }, lines: ['161/1'] },
    // Línea que hoy no existe: la parada no se muestra.
    { node: '9', name: 'Sin servicio', geometry: { coordinates: [-3.7, 40.4] as [number, number] }, lines: ['999/1'] },
  ];
  const stat = buildEmtStatic('madrid', STOPS, LINES, 0);

  it('lee paradas y líneas con su etiqueta pública y sus colores', () => {
    expect([...stat.stops.keys()]).toEqual(['72', '1']);
    const cibeles = stat.stops.get('72')!;
    expect(cibeles.id).toBe('madrid:72');
    expect(parseBusStopId(cibeles.id)).toEqual({ feed: 'madrid', code: '72' });
    expect(cibeles.lat).toBeCloseTo(40.4189);
    expect(cibeles.lines.map((l) => l.name)).toEqual(['5', 'C03', 'N1']);
    expect(stat.lines.get('N1')).toEqual({ name: 'N1', color: '050505', textColor: 'F2FB02' });
    // Varias direcciones: sin "hacia"; una sola (sentido 1 = hacia la cabecera B): con él.
    expect(cibeles.towards).toBeUndefined();
    expect(stat.stops.get('1')!.towards).toBe('Aravaca Sur');
  });

  it('agrupa las llegadas por línea y destino, las dos primeras', () => {
    const at = 1_000_000;
    const { lines, idle } = emtArrivals(
      stat,
      '72',
      [
        { line: '5', destination: 'CHAMARTIN', estimateArrive: 349, DistanceBus: 704 },
        { line: 'C03', destination: 'ARGÜELLES', estimateArrive: 838, DistanceBus: 2078 },
        { line: '5', destination: 'CHAMARTIN', estimateArrive: 1200, DistanceBus: 3000 },
        { line: '5', destination: 'CHAMARTIN', estimateArrive: 83, DistanceBus: 176, bus: 2294, geometry: { coordinates: [-3.6931, 40.4143] } },
        // Sin estimación real: fuera.
        { line: 'C03', destination: 'ARGÜELLES', estimateArrive: 999999 },
      ],
      at,
      at + 30_000,
    );
    expect(lines.map((g) => `${g.line.name} ${g.headsign}`)).toEqual(['5 Chamartin', 'C03 Argüelles']);
    expect(lines[0].next.map((n) => n.estimated)).toEqual([at + 83_000, at + 349_000]);
    expect(lines[0].next[0]).toMatchObject({ minutes: 1, distanceM: 176, vehicle: { id: '2294', lat: 40.4143, lon: -3.6931 } });
    expect(lines[0].next[1].vehicle).toBeUndefined();
    expect(idle.map((l) => l.name)).toEqual(['N1']);
  });

  it('pone en minúsculas los destinos de la EMT', () => {
    expect(titleCase('PUERTA DE TOLEDO')).toBe('Puerta de Toledo');
    expect(titleCase('PIO XII')).toBe('Pio XII');
    expect(titleCase('LAS ROSAS-AV. GUADALAJARA')).toBe('Las Rosas-Av. Guadalajara');
  });
});

describe('TMB Barcelona', () => {
  // Recortes de api.tmb.cat (25-11-2026).
  const pt = (lon: number, lat: number) => ({ coordinates: [lon, lat] as [number, number] });
  const LINES = [
    { properties: { CODI_LINIA: 244, NOM_LINIA: 'X2', COLOR_LINIA: 'da291c', COLOR_TEXT_LINIA: 'FFFFFF' } },
    { properties: { CODI_LINIA: 212, NOM_LINIA: 'H12', COLOR_LINIA: '003888', COLOR_TEXT_LINIA: 'FFFFFF' } },
    { properties: { CODI_LINIA: 207, NOM_LINIA: 'V7', COLOR_LINIA: '6BB023', COLOR_TEXT_LINIA: 'FFFFFF' } },
  ];
  const STOPS = [
    { geometry: pt(2.1479, 41.3743), properties: { CODI_PARADA: 108, NOM_PARADA: 'Pl Espanya - FGC' } },
    { geometry: pt(2.12, 41.38), properties: { CODI_PARADA: 622, NOM_PARADA: 'Av Diagonal - Numància' } },
    // Sin líneas: no se muestra.
    { geometry: pt(2.1, 41.4), properties: { CODI_PARADA: 9999, NOM_PARADA: 'Sin servicio' } },
  ];
  const LINE_STOPS = [
    { properties: { CODI_PARADA: 108, CODI_LINIA: 244, DESTI_SENTIT: 'Prat' } },
    { properties: { CODI_PARADA: 108, CODI_LINIA: 212, DESTI_SENTIT: 'Gornal' } },
    { properties: { CODI_PARADA: 108, CODI_LINIA: 207, DESTI_SENTIT: 'Pl. Espanya' } },
    { properties: { CODI_PARADA: 622, CODI_LINIA: 207, DESTI_SENTIT: 'Pl. Espanya' } },
  ];
  const stat = buildTmbStatic('barcelona', STOPS, LINES, LINE_STOPS, 0);

  it('lee paradas, sus líneas y sus colores', () => {
    expect([...stat.stops.keys()]).toEqual(['108', '622']);
    const espanya = stat.stops.get('108')!;
    expect(espanya.id).toBe('barcelona:108');
    expect(espanya.lat).toBeCloseTo(41.3743);
    expect(espanya.lines.map((l) => l.name)).toEqual(['H12', 'V7', 'X2']);
    expect(espanya.towards).toBeUndefined();
    expect(stat.stops.get('622')!.towards).toBe('Pl. Espanya');
    expect(stat.lines.get('X2')).toEqual({ name: 'X2', color: 'DA291C', textColor: 'FFFFFF' });
  });

  it('agrupa las llegadas (horas absolutas), quita la línea del destino y acepta las del AMB', () => {
    const now = 1_795_605_400_000;
    const { lines, idle } = tmbArrivals(
      stat,
      '108',
      [
        {
          transit_namespace: 'bus',
          nom_linia: 'X2',
          desti_trajecte: 'X2-Prat Xpres (Av. Remolar)',
          propers_busos: [
            { temps_arribada: now + 900_000, id_bus: 4656 },
            { temps_arribada: now + 45_000, id_bus: 4655 },
            { temps_arribada: now + 1_800_000 },
          ],
        },
        { transit_namespace: 'amb', nom_linia: 'L70', desti_trajecte: 'St. Boi L.', propers_busos: [{ temps_arribada: now + 300_000 }] },
        // Ya pasó hace rato: fuera.
        { transit_namespace: 'bus', nom_linia: 'H12', desti_trajecte: 'Gornal', propers_busos: [{ temps_arribada: now - 120_000 }] },
      ],
      now,
      now,
    );
    expect(lines.map((g) => `${g.line.name} ${g.headsign}`)).toEqual(['X2 Prat Xpres (Av. Remolar)', 'L70 St. Boi L.']);
    expect(lines[0].next.map((n) => n.minutes)).toEqual([1, 15]);
    expect(lines[1].line.color).toBe('5E5E5E');
    expect(idle.map((l) => l.name)).toEqual(['H12', 'V7']);
  });
});

describe('Tope diario de consultas', () => {
  it('corta al llegar al tope y vuelve a empezar al día siguiente', () => {
    const q = dailyQuota(2);
    const day1 = Date.UTC(2026, 10, 25, 12);
    q.take(day1);
    q.take(day1);
    expect(() => q.take(day1)).toThrow(/límite/);
    q.take(day1 + 24 * 3600_000);
    expect(q.count).toBe(1);
  });
});
