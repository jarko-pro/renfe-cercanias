import { busStopId, type BusLineArrivals, type BusStop, type Line } from '@renfe/shared';

/**
 * Autobuses de la EMT de Madrid con la API de MobilityLabs (openapi.emtmadrid.es):
 * - `stops/list`: todas las paradas (~4900) con sus líneas y sentido ("161/1");
 * - `lines/info/{fecha}`: líneas con su etiqueta pública ("C03", "N1"), cabeceras y colores;
 * - `stops/{n}/arrives`: los próximos buses de UNA parada (segundos, metros, destino).
 * No hay un volcado de todas las llegadas, así que se piden por parada cuando alguien la abre.
 */

export interface EmtStopRaw {
  node: string;
  name: string;
  geometry?: { coordinates?: [number, number] };
  /** "161/1": id interno de línea y sentido (1 = hacia la cabecera B; 2 = hacia la A). */
  lines?: string[];
}

export interface EmtLineRaw {
  line: string;
  label: string;
  nameA?: string;
  nameB?: string;
  color?: string;
  forecolor?: string;
}

export interface EmtArriveRaw {
  /** Etiqueta pública de la línea ("5", "C03", "N1"). */
  line: string;
  destination?: string;
  estimateArrive?: number;
  DistanceBus?: number;
  /** Número del autobús y su posición GPS ([lon, lat]). */
  bus?: number | string;
  geometry?: { coordinates?: [number, number] };
}

export interface EmtStatic {
  loadedAt: number;
  /** Número de parada (el de la marquesina) -> parada. */
  stops: Map<string, BusStop>;
  /** Etiqueta pública -> línea. */
  lines: Map<string, Line>;
}

const DEFAULT_COLOR = '0072CE';
/** Una estimación más lejana que esto es un "sin dato" de la EMT (da 999999 s, p. ej.). */
const MAX_ETA_SEC = 2 * 3600;

/** Números romanos ("Pio XII", "Carlos III", "IV Centenario"). */
const ROMAN = /^(?=[ivxlc]{2,})(x{0,3})(ix|iv|v?i{0,3})$|^x{1,3}$/;
const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'a', 'en']);
/** "CUATRO CAMINOS" -> "Cuatro Caminos"; "PUERTA DE TOLEDO" -> "Puerta de Toledo". */
export function titleCase(s: string): string {
  const words = s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('es').split(' ');
  return words
    .map((w, i) =>
      i > 0 && SMALL.has(w)
        ? w
        : ROMAN.test(w)
          ? w.toUpperCase()
          : w.replace(/(^|[-/.(])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase('es')),
    )
    .join(' ');
}

const hex = (c: string | undefined, fallback: string) => (c && /^[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : fallback);

const byLineName = (a: Line, b: Line) => a.name.localeCompare(b.name, 'es', { numeric: true });

export function buildEmtStatic(feed: string, stopsRaw: EmtStopRaw[], linesRaw: EmtLineRaw[], now = Date.now()): EmtStatic {
  const lines = new Map<string, Line>();
  /** id interno -> línea y cabeceras. */
  const byId = new Map<string, { line: Line; a: string; b: string }>();
  for (const l of linesRaw) {
    if (!l.line || !l.label) continue;
    const line: Line = { name: l.label, color: hex(l.color, DEFAULT_COLOR), textColor: hex(l.forecolor, 'FFFFFF') };
    lines.set(l.label, line);
    byId.set(l.line, { line, a: titleCase(l.nameA ?? ''), b: titleCase(l.nameB ?? '') });
  }
  const stops = new Map<string, BusStop>();
  for (const s of stopsRaw) {
    const [lon, lat] = s.geometry?.coordinates ?? [];
    if (!s.node || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const found = new Map<string, Line>();
    const towards = new Set<string>();
    for (const ld of s.lines ?? []) {
      const [id, dir] = ld.split('/');
      const info = byId.get(id);
      if (!info) continue;
      found.set(info.line.name, info.line);
      const dest = dir === '1' ? info.b : dir === '2' ? info.a : '';
      if (dest) towards.add(dest);
    }
    // Las paradas sin ninguna línea en servicio hoy no se muestran.
    if (found.size === 0) continue;
    const code = String(s.node);
    stops.set(code, {
      id: busStopId(feed, code),
      feed,
      code,
      name: s.name?.replace(/\s+/g, ' ').trim() || `Parada ${code}`,
      // Solo si todas sus líneas van hacia el mismo sitio: así se distinguen las dos aceras.
      ...(towards.size === 1 ? { towards: [...towards][0] } : {}),
      lat: lat!,
      lon: lon!,
      lines: [...found.values()].sort(byLineName),
    });
  }
  return { loadedAt: now, stops, lines };
}

const minutesUntil = (ms: number, now: number) => Math.max(0, Math.round((ms - now) / 60_000));

/**
 * Llegadas de la EMT a una parada, una fila por línea y destino, ordenadas por el primero que
 * llega. `at` es cuándo se pidieron a la EMT: los segundos se cuentan desde ahí.
 */
export function emtArrivals(
  stat: EmtStatic,
  code: string,
  arrive: EmtArriveRaw[],
  at: number,
  now: number,
): { lines: BusLineArrivals[]; idle: Line[] } {
  const groups = new Map<string, BusLineArrivals>();
  for (const a of arrive) {
    const secs = a.estimateArrive;
    if (!a.line || typeof secs !== 'number' || secs < 0 || secs > MAX_ETA_SEC) continue;
    const estimated = at + secs * 1000;
    if (estimated < now - 60_000) continue;
    const dest = titleCase(a.destination ?? '');
    const key = `${a.line}|${dest}`;
    let g = groups.get(key);
    if (!g) {
      const line = stat.lines.get(a.line) ?? { name: a.line, color: DEFAULT_COLOR, textColor: 'FFFFFF' };
      groups.set(key, (g = { line, headsign: dest, next: [] }));
    }
    const dist = a.DistanceBus;
    const [lon, lat] = a.geometry?.coordinates ?? [];
    // Sin GPS la EMT da 0,0 (o nada): solo se acepta una posición por la zona de Madrid.
    const located = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat! - 40.4) < 1 && Math.abs(lon! + 3.7) < 1;
    g.next.push({
      estimated,
      minutes: minutesUntil(estimated, now),
      ...(typeof dist === 'number' && dist >= 0 ? { distanceM: dist } : {}),
      ...(located && a.bus != null ? { vehicle: { id: String(a.bus), lat: lat!, lon: lon! } } : {}),
    });
  }
  const lines = [...groups.values()];
  for (const g of lines) {
    g.next.sort((x, y) => x.estimated - y.estimated);
    // Como en las marquesinas: los dos próximos.
    g.next = g.next.slice(0, 2);
  }
  lines.sort((x, y) => x.next[0].estimated - y.next[0].estimated || byLineName(x.line, y.line));
  const active = new Set(lines.map((g) => g.line.name));
  const idle = (stat.stops.get(code)?.lines ?? []).filter((l) => !active.has(l.name));
  return { lines, idle };
}
