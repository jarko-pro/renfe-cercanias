import type { Arrival } from '@renfe/shared';
import type { GtfsData } from './gtfs/types.js';
import type { RealtimeState } from './realtime/poller.js';
import { addDays, localDate, serviceDayBase } from './time.js';

export interface ArrivalsOptions {
  /** Cuántos minutos hacia delante buscar trenes. */
  windowMin?: number;
  limit?: number;
  /** Mantener un tren en la lista hasta X segundos después de su hora estimada. */
  graceSec?: number;
}

/**
 * Próximos trenes en una parada: horario programado de los días de servicio ayer/hoy/mañana
 * (los viajes de "ayer" pueden pasar de las 24:00) corregido con el tiempo real.
 */
export function getArrivals(
  data: GtfsData,
  realtime: Pick<RealtimeState, 'trips'>,
  stopId: string,
  nowMs: number,
  { windowMin = 90, limit = 12, graceSec = 30 }: ArrivalsOptions = {},
): Arrival[] {
  const stopTimes = data.stopTimesByStop.get(stopId);
  if (!stopTimes) return [];

  const today = localDate(nowMs);
  const fromMs = nowMs - graceSec * 1000;
  const toMs = nowMs + windowMin * 60_000;
  const out: Arrival[] = [];

  for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
    const services = data.servicesByDate.get(date);
    if (!services?.size) continue;
    const base = serviceDayBase(date);

    for (const st of stopTimes) {
      const scheduled = base + st.arr * 1000;
      // Margen de 2 h para trenes con mucho retraso que salieron antes de la ventana.
      if (scheduled > toMs || scheduled < fromMs - 2 * 3600_000) continue;
      const trip = data.trips.get(st.tripId);
      if (!trip || !services.has(trip.serviceId)) continue;

      const rtTrip = realtime.trips.get(st.tripId);
      const rtStop = rtTrip?.stops.get(stopId);
      if (rtTrip && !rtStop && alreadyPassed(data, st.tripId, st.seq, rtTrip.stops.keys())) continue;
      let estimated = scheduled;
      let delaySec: number | null = null;
      if (rtStop?.time) {
        estimated = rtStop.time;
        delaySec = Math.round((estimated - scheduled) / 1000);
      } else if (rtStop?.delaySec != null) {
        delaySec = rtStop.delaySec;
        estimated = scheduled + delaySec * 1000;
      } else if (rtTrip?.delaySec != null) {
        delaySec = rtTrip.delaySec;
        estimated = scheduled + delaySec * 1000;
      }
      if (estimated < fromMs || estimated > toMs) continue;

      const line = data.lines.get(trip.routeId) ?? { name: '?', color: '7A7A7A', textColor: 'FFFFFF' };
      out.push({
        tripId: st.tripId,
        line,
        headsign: trip.headsign,
        scheduled,
        estimated,
        minutes: Math.max(0, Math.floor((estimated - nowMs) / 60_000)),
        delaySec,
        realtime: rtTrip != null,
        cancelled: !!rtTrip?.cancelled || !!rtStop?.skipped,
        terminates: trip.lastStopId === stopId,
      });
    }
  }

  out.sort((a, b) => a.estimated - b.estimated);
  return out.slice(0, limit);
}

/**
 * Renfe publica en tiempo real la(s) próxima(s) parada(s) de cada tren. Si todas están
 * más adelante en el recorrido que la nuestra, el tren ya ha pasado aunque vaya con retraso.
 */
function alreadyPassed(data: GtfsData, tripId: string, seq: number, rtStopIds: Iterable<string>): boolean {
  let minRtSeq = Infinity;
  for (const id of rtStopIds) {
    const st = data.stopTimesByStop.get(id)?.find((s) => s.tripId === tripId);
    if (st && st.seq < minRtSeq) minRtSeq = st.seq;
  }
  return seq < minRtSeq && minRtSeq !== Infinity;
}
