import { busStopId, type BusLineArrivals, type BusStop, type Line } from '@renfe/shared';
import type { OnDemandStatic } from './ondemand.js';

/**
 * Autobuses de TMB (Barcelona) con su API para desarrolladores (api.tmb.cat, app_id y app_key):
 * - `transit/parades`: paradas (~2700);
 * - `transit/linies/bus`: líneas con nombre público ("V7", "H12", "D20") y colores;
 * - `transit/linies/bus/parades`: qué líneas paran en cada parada y hacia dónde;
 * - `itransit/bus/parades/{n}`: próximos buses de UNA parada (hora prevista, número de bus).
 *   Incluye también los buses metropolitanos del AMB que paran allí.
 * No da la posición GPS de los buses.
 */

export interface TmbFeature<P> {
  geometry?: { coordinates?: [number, number] } | null;
  properties: P;
}

export interface TmbStopProps {
  CODI_PARADA: number | string;
  NOM_PARADA?: string;
}

export interface TmbLineProps {
  CODI_LINIA: number | string;
  NOM_LINIA: string;
  COLOR_LINIA?: string;
  COLOR_TEXT_LINIA?: string;
}

export interface TmbLineStopProps {
  CODI_PARADA: number | string;
  CODI_LINIA: number | string;
  DESTI_SENTIT?: string;
}

export interface TmbTrajecte {
  /** "bus" (TMB) o "amb" (buses metropolitanos). */
  transit_namespace?: string;
  nom_linia: string;
  desti_trajecte?: string;
  /** `temps_arribada`: hora prevista (ms desde 1970), no segundos que faltan. */
  propers_busos?: { temps_arribada?: number; id_bus?: number | string }[];
}

export type TmbStatic = OnDemandStatic;

/** Las líneas del AMB que salen en las llegadas no están en la lista de TMB: gris neutro. */
const DEFAULT_COLOR = '5E5E5E';
const MAX_AHEAD_MS = 2 * 3600_000;

const hex = (c: string | undefined, fallback: string) => (c && /^[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : fallback);
const byLineName = (a: Line, b: Line) => a.name.localeCompare(b.name, 'es', { numeric: true });
const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function buildTmbStatic(
  feed: string,
  stopsRaw: TmbFeature<TmbStopProps>[],
  linesRaw: TmbFeature<TmbLineProps>[],
  lineStopsRaw: TmbFeature<TmbLineStopProps>[],
  now = Date.now(),
): TmbStatic {
  const lines = new Map<string, Line>();
  const byCode = new Map<string, Line>();
  for (const { properties: l } of linesRaw) {
    if (l.CODI_LINIA == null || !l.NOM_LINIA) continue;
    const line: Line = {
      name: l.NOM_LINIA,
      color: hex(l.COLOR_LINIA, DEFAULT_COLOR),
      textColor: hex(l.COLOR_TEXT_LINIA, 'FFFFFF'),
    };
    lines.set(line.name, line);
    byCode.set(String(l.CODI_LINIA), line);
  }
  /** Parada -> sus líneas y sus destinos. */
  const served = new Map<string, { lines: Map<string, Line>; towards: Set<string> }>();
  for (const { properties: r } of lineStopsRaw) {
    const line = byCode.get(String(r.CODI_LINIA));
    if (!line || r.CODI_PARADA == null) continue;
    const code = String(r.CODI_PARADA);
    let s = served.get(code);
    if (!s) served.set(code, (s = { lines: new Map(), towards: new Set() }));
    s.lines.set(line.name, line);
    const dest = clean(r.DESTI_SENTIT);
    if (dest) s.towards.add(dest);
  }
  const stops = new Map<string, BusStop>();
  for (const f of stopsRaw) {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const code = String(f.properties.CODI_PARADA ?? '');
    const s = served.get(code);
    // Las paradas sin ninguna línea no se muestran.
    if (!code || !s || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    stops.set(code, {
      id: busStopId(feed, code),
      feed,
      code,
      name: clean(f.properties.NOM_PARADA) || `Parada ${code}`,
      // Solo si todas sus líneas van hacia el mismo sitio: así se distinguen las dos aceras.
      ...(s.towards.size === 1 ? { towards: [...s.towards][0] } : {}),
      lat: lat!,
      lon: lon!,
      lines: [...s.lines.values()].sort(byLineName),
    });
  }
  return { loadedAt: now, stops, lines };
}

/** "X2-Prat Xpres (Av. Remolar)" -> "Prat Xpres (Av. Remolar)": el nombre de la línea ya va en la fila. */
function headsignOf(t: TmbTrajecte): string {
  const d = clean(t.desti_trajecte);
  const prefix = `${t.nom_linia}-`;
  return d.toLowerCase().startsWith(prefix.toLowerCase()) ? d.slice(prefix.length).trim() : d;
}

const minutesUntil = (ms: number, now: number) => Math.max(0, Math.round((ms - now) / 60_000));

/** Llegadas de TMB a una parada, una fila por línea y destino, ordenadas por el primero que llega. */
export function tmbArrivals(
  stat: TmbStatic,
  code: string,
  trajectes: TmbTrajecte[],
  _at: number,
  now: number,
): { lines: BusLineArrivals[]; idle: Line[] } {
  const groups = new Map<string, BusLineArrivals>();
  for (const t of trajectes) {
    if (!t.nom_linia) continue;
    const dest = headsignOf(t);
    const key = `${t.nom_linia}|${dest}`;
    for (const b of t.propers_busos ?? []) {
      const estimated = b.temps_arribada;
      if (typeof estimated !== 'number' || estimated < now - 60_000 || estimated > now + MAX_AHEAD_MS) continue;
      let g = groups.get(key);
      if (!g) {
        const line = stat.lines.get(t.nom_linia) ?? { name: t.nom_linia, color: DEFAULT_COLOR, textColor: 'FFFFFF' };
        groups.set(key, (g = { line, headsign: dest, next: [] }));
      }
      g.next.push({ estimated, minutes: minutesUntil(estimated, now) });
    }
  }
  const lines = [...groups.values()];
  for (const g of lines) {
    g.next.sort((x, y) => x.estimated - y.estimated);
    g.next = g.next.slice(0, 2);
  }
  lines.sort((x, y) => x.next[0].estimated - y.next[0].estimated || byLineName(x.line, y.line));
  const active = new Set(lines.map((g) => g.line.name));
  const idle = (stat.stops.get(code)?.lines ?? []).filter((l) => !active.has(l.name));
  return { lines, idle };
}
