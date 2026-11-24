import { busStopId, type BusLineArrivals, type BusStop, type Line } from '@renfe/shared';
import type { SantanderConfig } from './registry.js';

/**
 * Autobuses de Santander (TUS) con los datos abiertos del Ayuntamiento:
 * - `paradas_bus`, `lineas_bus` y `lineas_bus_secuencia`: paradas, líneas y orden de paradas
 *   (se actualizan a diario y casan con las estimaciones);
 * - `control_flotas_estimaciones`: por parada y línea, los dos próximos buses (segundos, metros
 *   y destino). Cada fila se renueva cada 45-60 s. No hay id de viaje.
 */

export type Resource = Record<string, string | undefined>;

export interface SantanderStatic {
  loadedAt: number;
  /** Número de parada (el de la marquesina) -> parada. */
  stops: Map<string, BusStop>;
  /** Etiqueta de línea ("1", "5C1", "N2") -> línea. */
  lines: Map<string, Line>;
}

/** Una fila de estimación: parada × línea, con hasta dos buses en camino. */
export interface Estimate {
  stop: string;
  line: string;
  /** Primer bus: segundos y metros que le faltan, y su destino. */
  t1: number;
  d1: number;
  dest1: string;
  /** Segundo bus (null si no hay). */
  t2: number | null;
  d2: number | null;
  dest2: string;
  /** Cuándo calculó TUS esta fila (epoch ms): las llegadas se cuentan desde aquí. */
  at: number;
}

/** Una estimación de hace más de esto ya no se muestra (el bus no está en servicio o hay un corte). */
export const STALE_MS = 3 * 60_000;

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const num = (s: string | undefined) => {
  const v = clean(s);
  return v === '' ? null : Number(v);
};

/** Orden natural de líneas: 1, 2, 3, 5C1, 11, 24C1, E1, LC, N1. */
const byLineName = (a: Line, b: Line) => a.name.localeCompare(b.name, 'es', { numeric: true });

export function lineOf(cfg: SantanderConfig, label: string): Line {
  const [color, textColor] = cfg.colors[label] ?? cfg.defaultColor;
  return { name: label, color, textColor };
}

/** Paradas con sus líneas. Las paradas por las que no pasa ninguna línea no se muestran. */
export function buildStatic(
  cfg: SantanderConfig,
  stopsRes: Resource[],
  linesRes: Resource[],
  seqRes: Resource[],
  now = Date.now(),
): SantanderStatic {
  const lines = new Map<string, Line>();
  for (const r of linesRes) {
    const label = clean(r['ayto:numero']);
    if (label) lines.set(label, lineOf(cfg, label));
  }
  const linesByStop = new Map<string, Set<string>>();
  for (const r of seqRes) {
    const stop = clean(r['ayto:NParada']);
    const label = clean(r['dc:EtiquetaLinea']);
    if (!stop || !label) continue;
    if (!lines.has(label)) lines.set(label, lineOf(cfg, label));
    let set = linesByStop.get(stop);
    if (!set) linesByStop.set(stop, (set = new Set()));
    set.add(label);
  }
  const stops = new Map<string, BusStop>();
  for (const r of stopsRes) {
    const code = clean(r['ayto:numero']);
    const lat = num(r['wgs84_pos:lat']);
    const lon = num(r['wgs84_pos:long']);
    const labels = linesByStop.get(code);
    if (!code || lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon) || !labels) continue;
    const towards = clean(r['ayto:sentido']);
    stops.set(code, {
      id: busStopId(cfg.id, code),
      feed: cfg.id,
      code,
      name: clean(r['ayto:parada']) || clean(r['vivo:address1']) || `Parada ${code}`,
      ...(towards ? { towards } : {}),
      lat,
      lon,
      lines: [...labels].map((l) => lines.get(l)!).sort(byLineName),
    });
  }
  return { loadedAt: now, stops, lines };
}

export function parseEstimates(res: Resource[]): Estimate[] {
  const out: Estimate[] = [];
  for (const r of res) {
    const stop = clean(r['ayto:paradaId']);
    const line = clean(r['ayto:etiqLinea']);
    const t1 = num(r['ayto:tiempo1']);
    const dest1 = clean(r['ayto:destino1']);
    const at = Date.parse(clean(r['ayto:fechActual']));
    if (!stop || !line || t1 == null || !dest1 || !Number.isFinite(at)) continue;
    const t2 = num(r['ayto:tiempo2']);
    const dest2 = clean(r['ayto:destino2']);
    out.push({
      stop,
      line,
      t1,
      d1: num(r['ayto:distancia1']) ?? 0,
      dest1,
      t2: t2 != null && dest2 ? t2 : null,
      d2: t2 != null && dest2 ? num(r['ayto:distancia2']) : null,
      dest2: t2 != null ? dest2 : '',
      at,
    });
  }
  return out;
}

/** Estimaciones agrupadas por parada (para responder sin recorrer las ~900 filas). */
export function indexByStop(estimates: Estimate[]): Map<string, Estimate[]> {
  const out = new Map<string, Estimate[]>();
  for (const e of estimates) {
    let list = out.get(e.stop);
    if (!list) out.set(e.stop, (list = []));
    list.push(e);
  }
  return out;
}

/** Minutos que faltan (0 = llegando, menos de 30 s), redondeados como en los trenes. */
const minutesUntil = (ms: number, now: number) => Math.max(0, Math.round((ms - now) / 60_000));

/**
 * Próximos buses de una parada, una fila por línea y destino, ordenadas por el primero que
 * llega. Las líneas de la parada sin ningún bus en camino van aparte (`idle`).
 */
export function stopArrivals(
  cfg: SantanderConfig,
  stat: SantanderStatic,
  estimates: Estimate[] | undefined,
  code: string,
  now: number,
): { lines: BusLineArrivals[]; idle: Line[] } {
  const groups = new Map<string, BusLineArrivals>();
  const add = (label: string, dest: string, secs: number, dist: number | null, at: number) => {
    const estimated = at + secs * 1000;
    // Un bus que según su última estimación ya debería haber pasado hace rato no se muestra.
    if (estimated < now - 60_000) return;
    const key = `${label}|${dest}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { line: stat.lines.get(label) ?? lineOf(cfg, label), headsign: dest, next: [] }));
    g.next.push({ estimated, minutes: minutesUntil(estimated, now), ...(dist != null ? { distanceM: dist } : {}) });
  };
  for (const e of estimates ?? []) {
    if (now - e.at > STALE_MS) continue;
    add(e.line, e.dest1, e.t1, e.d1, e.at);
    if (e.t2 != null) add(e.line, e.dest2, e.t2, e.d2, e.at);
  }
  const lines = [...groups.values()];
  for (const g of lines) g.next.sort((a, b) => a.estimated - b.estimated);
  lines.sort((a, b) => a.next[0].estimated - b.next[0].estimated || byLineName(a.line, b.line));
  const active = new Set(lines.map((g) => g.line.name));
  const idle = (stat.stops.get(code)?.lines ?? []).filter((l) => !active.has(l.name));
  return { lines, idle };
}
