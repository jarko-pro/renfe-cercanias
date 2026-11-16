import type { Line, Passed, StopTimetable, TimetableGroup, TripTimes } from '@renfe/shared';
import type { GtfsData } from './gtfs/types.js';
import type { Observed } from './history/collector.js';
import { trainNumber } from './gtfs/networks.js';
import { serviceDayBase } from './time.js';

const UNKNOWN_LINE: Line = { name: '?', color: '7A7A7A', textColor: 'FFFFFF' };
const MARKS = 'abcdefghijklmnopqrstuvwxyz';
/** Un tren sin ningún dato de Renfe se da por pasado este rato después de su hora. */
const NO_DATA_MARGIN_S = 120;

/** Lo que el histórico sabe de los viajes de hoy, para marcar los que ya han pasado. */
export interface LiveContext {
  nowMs: number;
  observed: (date: string, tripId: string) => Observed | null;
}

/**
 * Si el tren ya ha pasado por la parada `idx` de su recorrido, con qué retraso. Renfe da un
 * retraso por tren, a veces solo para la parada siguiente: si falta el de esta parada, vale el
 * último anterior que se conozca (o, si no hay, el siguiente).
 */
function passedAt(obs: Observed | null, idx: number, base: number, t: number, nowMs: number): Passed | undefined {
  let d: number | null = null;
  for (let i = idx; obs && i >= 0 && d == null; i--) d = obs.delays[i] ?? null;
  // Paradas por las que pasó antes de que el servidor arrancara: vale el primer retraso posterior.
  for (let i = idx + 1; obs && idx >= 0 && i < obs.delays.length && d == null; i++) d = obs.delays[i] ?? null;
  if (obs?.cancelled) return base + t * 1000 < nowMs ? { delaySec: null, cancelled: true } : undefined;
  if (d != null) return base + (t + d) * 1000 < nowMs ? { delaySec: d } : undefined;
  return base + (t + NO_DATA_MARGIN_S) * 1000 < nowMs ? { delaySec: null } : undefined;
}

/**
 * Sentido de un viaje dentro de su línea. Renfe no da `direction_id` ni `trip_headsign`, pero
 * el trazado de vuelta se llama igual que el de ida con `_INV` (`10_C1` / `10_C1_INV`). Sin
 * trazado (algún núcleo no lo publica), cada destino cuenta como un sentido.
 */
function directionKey(shapeId: string, headsign: string): string {
  if (!shapeId) return `h:${headsign}`;
  return shapeId.endsWith('_INV') ? 'inv' : 'dir';
}

/**
 * Destino real (última parada). Renfe pone a veces el tipo de servicio en `trip_headsign`
 * ("CIVIS", semidirecto): se añade al destino para que esos trenes lleven su propia nota.
 */
function destination(data: GtfsData, lastStopId: string, headsign: string): string {
  const name = data.stops.get(lastStopId)?.name;
  if (!name) return headsign;
  return headsign && headsign !== name ? `${name} (${headsign})` : name;
}

/**
 * Horario programado de una estación en un día de servicio: las salidas agrupadas por línea y
 * sentido, como el cartel impreso de cada línea. Los trenes que terminan aquí no se cuentan
 * (no salen hacia ningún sitio).
 */
export function getStopTimetable(
  data: GtfsData,
  stopId: string,
  date: string,
  live?: LiveContext,
): StopTimetable | null {
  const stop = data.stops.get(stopId);
  const services = data.servicesByDate.get(date);
  if (!stop || !services) return null;

  const base = serviceDayBase(date);
  type Train = { tripId: string; t: number; headsign: string; passed?: Passed };
  const groups = new Map<string, { line: Line; trains: Train[] }>();
  for (const st of data.stopTimesByStop.get(stopId) ?? []) {
    const trip = data.trips.get(st.tripId);
    if (!trip || !services.has(trip.serviceId) || trip.lastStopId === stopId) continue;
    const line = data.lines.get(trip.routeId) ?? UNKNOWN_LINE;
    const headsign = destination(data, trip.lastStopId, trip.headsign);
    const key = `${line.name}|${directionKey(trip.shapeId, headsign)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { line, trains: [] }));
    let passed: Passed | undefined;
    if (live) {
      const obs = live.observed(date, st.tripId);
      const idx = (obs?.stops ?? data.tripStops.get(st.tripId) ?? []).indexOf(stopId);
      passed = passedAt(obs, idx, base, st.dep, live.nowMs);
    }
    g.trains.push({ tripId: st.tripId, t: st.dep, headsign, ...(passed ? { passed } : {}) });
  }

  const lineOrder = new Map(stop.lines.map((l, i) => [l.name, i]));
  const out: TimetableGroup[] = [...groups.entries()]
    .sort(([ka, a], [kb, b]) => {
      const byLine = (lineOrder.get(a.line.name) ?? 99) - (lineOrder.get(b.line.name) ?? 99);
      return byLine || a.line.name.localeCompare(b.line.name) || ka.localeCompare(kb);
    })
    .map(([, g]) => {
      // El destino más habitual da nombre al sentido; los demás llevan una letra.
      const counts = new Map<string, number>();
      for (const t of g.trains) counts.set(t.headsign, (counts.get(t.headsign) ?? 0) + 1);
      const [main, ...others] = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
      const notes = others.map((headsign, i) => ({ mark: MARKS[i] ?? '*', headsign }));
      const markOf = new Map(notes.map((n) => [n.headsign, n.mark]));
      const trains = g.trains
        .sort((a, b) => a.t - b.t)
        .map(({ headsign, ...train }) => {
          const mark = markOf.get(headsign);
          return mark ? { ...train, mark } : train;
        });
      return { line: g.line, headsign: main, notes, trains };
    });

  return { stopId, date, base, groups: out };
}

/**
 * Recorrido programado de un tren en un día de servicio, con la hora en cada parada y, si se
 * pasa `live`, el retraso con el que pasó por las que ya ha dejado atrás.
 */
export function getTripTimes(data: GtfsData, tripId: string, date: string, live?: LiveContext): TripTimes | null {
  const trip = data.trips.get(tripId);
  const stopIds = data.tripStops.get(tripId);
  if (!trip || !stopIds) return null;

  const base = serviceDayBase(date);
  const obs = live?.observed(date, tripId) ?? null;
  const stops: TripTimes['stops'] = [];
  let lastSeq = -Infinity;
  stopIds.forEach((stopId, i) => {
    // Si el tren pasa dos veces por la misma parada, la siguiente en orden.
    const st = data.stopTimesByStop.get(stopId)?.find((s) => s.tripId === tripId && s.seq > lastSeq);
    if (!st) return;
    lastSeq = st.seq;
    const isLast = i === stopIds.length - 1;
    const t = isLast ? st.arr : st.dep;
    const passed = live ? passedAt(obs, i, base, t, live.nowMs) : undefined;
    stops.push({ stopId, name: data.stops.get(stopId)?.name ?? stopId, t, ...(passed ? { passed } : {}) });
  });

  const number = trainNumber(tripId);
  return {
    tripId,
    ...(number ? { trainNumber: number } : {}),
    line: data.lines.get(trip.routeId) ?? UNKNOWN_LINE,
    headsign: destination(data, trip.lastStopId, trip.headsign),
    base,
    cancelled: !!obs?.cancelled,
    stops,
  };
}
