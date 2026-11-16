import type { Line, StopTimetable, TimetableGroup, TripTimes } from '@renfe/shared';
import type { GtfsData } from './gtfs/types.js';
import { trainNumber } from './gtfs/networks.js';
import { serviceDayBase } from './time.js';

const UNKNOWN_LINE: Line = { name: '?', color: '7A7A7A', textColor: 'FFFFFF' };
const MARKS = 'abcdefghijklmnopqrstuvwxyz';

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
export function getStopTimetable(data: GtfsData, stopId: string, date: string): StopTimetable | null {
  const stop = data.stops.get(stopId);
  const services = data.servicesByDate.get(date);
  if (!stop || !services) return null;

  const groups = new Map<string, { line: Line; trains: { tripId: string; t: number; headsign: string }[] }>();
  for (const st of data.stopTimesByStop.get(stopId) ?? []) {
    const trip = data.trips.get(st.tripId);
    if (!trip || !services.has(trip.serviceId) || trip.lastStopId === stopId) continue;
    const line = data.lines.get(trip.routeId) ?? UNKNOWN_LINE;
    const headsign = destination(data, trip.lastStopId, trip.headsign);
    const key = `${line.name}|${directionKey(trip.shapeId, headsign)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { line, trains: [] }));
    g.trains.push({ tripId: st.tripId, t: st.dep, headsign });
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
        .map(({ tripId, t, headsign }) => {
          const mark = markOf.get(headsign);
          return mark ? { tripId, t, mark } : { tripId, t };
        });
      return { line: g.line, headsign: main, notes, trains };
    });

  return { stopId, date, base: serviceDayBase(date), groups: out };
}

/** Recorrido programado de un tren, con la hora en cada parada. */
export function getTripTimes(data: GtfsData, tripId: string): TripTimes | null {
  const trip = data.trips.get(tripId);
  const stopIds = data.tripStops.get(tripId);
  if (!trip || !stopIds) return null;

  const stops: TripTimes['stops'] = [];
  let lastSeq = -Infinity;
  stopIds.forEach((stopId, i) => {
    // Si el tren pasa dos veces por la misma parada, la siguiente en orden.
    const st = data.stopTimesByStop.get(stopId)?.find((s) => s.tripId === tripId && s.seq > lastSeq);
    if (!st) return;
    lastSeq = st.seq;
    const isLast = i === stopIds.length - 1;
    stops.push({ stopId, name: data.stops.get(stopId)?.name ?? stopId, t: isLast ? st.arr : st.dep });
  });

  const number = trainNumber(tripId);
  return {
    tripId,
    ...(number ? { trainNumber: number } : {}),
    line: data.lines.get(trip.routeId) ?? UNKNOWN_LINE,
    headsign: destination(data, trip.lastStopId, trip.headsign),
    stops,
  };
}
