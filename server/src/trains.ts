import type { TrainMatch } from '@renfe/shared';
import { getArrivals } from './arrivals.js';
import { networkOf, trainNumber } from './gtfs/networks.js';
import type { GtfsData } from './gtfs/types.js';
import { nextStopId } from './live.js';
import type { TripRealtime } from './realtime/poller.js';
import type { VehicleState } from './realtime/vehicles.js';
import { addDays, localDate, serviceDayBase } from './time.js';

export { trainNumber };

/** La web quita de la lista los trenes cuya hora estimada pasó hace más de esto. */
const HIDE_AFTER_MS = 30_000;

/**
 * ¿Saldrá este tren en el panel de la estación, y durante un rato? Usa el mismo cálculo que
 * el panel. Si está a punto de desaparecer de la lista (hora ya cumplida y sin estar entrando
 * ni en el andén), mejor abrir la siguiente: si no, se abre una estación por la que ya pasó.
 */
function shownAt(
  data: GtfsData,
  realtime: { trips: Map<string, TripRealtime>; vehicles: Map<string, VehicleState> },
  tripId: string,
  stopId: string,
  nowMs: number,
): boolean {
  const a = getArrivals(data, realtime, stopId, nowMs, { limit: 1000 }).find((x) => x.tripId === tripId);
  if (!a || a.estimated < nowMs - HIDE_AFTER_MS) return false;
  return a.vehicleStatus != null || a.estimated >= nowMs + 60_000;
}

/** número de tren -> trip_ids (de ayer, hoy y mañana), calculado una vez por carga del GTFS. */
const indexCache = new WeakMap<GtfsData, Map<string, string[]>>();
function trainIndex(data: GtfsData): Map<string, string[]> {
  let idx = indexCache.get(data);
  if (idx) return idx;
  idx = new Map();
  for (const tripId of data.trips.keys()) {
    const n = trainNumber(tripId);
    if (!n) continue;
    const list = idx.get(n);
    if (list) list.push(tripId);
    else idx.set(n, [tripId]);
  }
  indexCache.set(data, idx);
  return idx;
}

/** Margen tras la llegada prevista al destino en el que el tren aún se considera en marcha. */
const DONE_AFTER_MS = 2 * 60_000;

/**
 * Trenes de hoy con ese número que aún no han terminado su recorrido, con la estación que
 * conviene abrir: donde está o la próxima a la que llega; si aún no ha salido, su origen.
 */
export function findTrains(
  data: GtfsData,
  realtime: { trips: Map<string, TripRealtime>; vehicles: Map<string, VehicleState> },
  number: string,
  nowMs: number,
): TrainMatch[] {
  const today = localDate(nowMs);
  const out: TrainMatch[] = [];
  for (const tripId of trainIndex(data).get(number) ?? []) {
    const trip = data.trips.get(tripId);
    const stops = data.tripStops.get(tripId);
    if (!trip || !stops?.length) continue;
    const date = [addDays(today, -1), today].find((d) => data.servicesByDate.get(d)?.has(trip.serviceId));
    if (!date) continue;

    const base = serviceDayBase(date);
    const times = stops.map((s) => data.stopTimesByStop.get(s)?.find((st) => st.tripId === tripId));
    const first = times[0];
    const last = times[times.length - 1];
    if (!first || !last) continue;

    const rt = realtime.trips.get(tripId);
    const v = realtime.vehicles.get(tripId);
    const delayMs = Math.max(0, rt?.delaySec ?? 0) * 1000;
    const departure = base + first.dep * 1000;
    if (rt?.cancelled || nowMs > base + last.arr * 1000 + delayMs + DONE_AFTER_MS) continue;

    let stopId: string;
    let state: TrainMatch['state'] = 'running';
    if (v?.stopId && stops.includes(v.stopId)) {
      // En tránsito, Renfe da la parada que acaba de dejar: se abre la siguiente.
      stopId = (v.status === 'in_transit' && nextStopId(data, tripId, v.stopId)) || v.stopId;
    } else if (rt && [...rt.stops.keys()].some((s) => stops.includes(s))) {
      stopId = [...rt.stops.keys()].find((s) => stops.includes(s))!;
    } else if (nowMs < departure) {
      stopId = stops[0];
      state = 'later';
    } else {
      // Sin datos de Renfe: la próxima parada según el horario.
      const i = times.findIndex((t) => t && base + t.arr * 1000 + delayMs >= nowMs);
      stopId = stops[i >= 0 ? i : stops.length - 1];
    }
    // La posición de Renfe llega con ~30 s de retraso: si el panel de esa estación ya no lo
    // muestra, se avanza hasta la primera parada donde sí aparece.
    if (state === 'running') {
      const from = stops.indexOf(stopId);
      const shown = stops.slice(from).find((s) => shownAt(data, realtime, tripId, s, nowMs));
      if (shown) stopId = shown;
    }

    out.push({
      tripId,
      train: number,
      line: data.lines.get(trip.routeId) ?? { name: '?', color: '7A7A7A', textColor: 'FFFFFF' },
      network: networkOf(trip.routeId),
      headsign: trip.headsign,
      stopId,
      stopName: data.stops.get(stopId)?.name ?? '',
      state,
      departure,
    });
  }
  // Primero los que van en marcha; luego por hora de salida.
  return out.sort((a, b) => (a.state === b.state ? a.departure - b.departure : a.state === 'running' ? -1 : 1));
}
