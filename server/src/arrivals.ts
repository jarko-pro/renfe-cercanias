import type { Arrival } from '@renfe/shared';
import type { GtfsData } from './gtfs/types.js';
import type { RealtimeState, StopUpdate, TripRealtime } from './realtime/poller.js';
import { addDays, localDate, serviceDayBase } from './time.js';

/** Mismo criterio que la web: 0 ("Ahora") a menos de 30 s; si no, minutos redondeados. */
export function minutesUntil(estimatedMs: number, nowMs: number): number {
  const secs = (estimatedMs - nowMs) / 1000;
  return secs <= 30 ? 0 : Math.max(1, Math.round(secs / 60));
}

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
      const delaySec = rtTrip ? realtimeDelaySec(data, st.tripId, stopId, base, rtTrip) : null;
      const estimated = delaySec != null ? scheduled + delaySec * 1000 : scheduled;
      // Un tren que ya ha pasado tiene hora estimada en el pasado y se descarta aquí.
      if (estimated < fromMs || estimated > toMs) continue;

      const line = data.lines.get(trip.routeId) ?? { name: '?', color: '7A7A7A', textColor: 'FFFFFF' };
      out.push({
        tripId: st.tripId,
        line,
        headsign: trip.headsign,
        scheduled,
        estimated,
        minutes: minutesUntil(estimated, nowMs),
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
 * Retraso en segundos de un viaje en nuestra parada.
 *
 * Renfe normalmente publica solo la *próxima* parada de cada tren, nunca la de origen: un
 * tren que aún no ha salido trae la predicción de su segunda parada. Si nuestra parada no
 * viene en el feed, usamos el retraso de la parada informada más cercana a la nuestra.
 */
function realtimeDelaySec(
  data: GtfsData,
  tripId: string,
  stopId: string,
  base: number,
  rtTrip: TripRealtime,
): number | null {
  const delayAt = (u: StopUpdate, arrSec: number | undefined): number | null => {
    if (u.time != null && arrSec != null) return Math.round((u.time - (base + arrSec * 1000)) / 1000);
    return u.delaySec ?? null;
  };
  const findSt = (id: string) => data.stopTimesByStop.get(id)?.find((s) => s.tripId === tripId);

  const own = rtTrip.stops.get(stopId);
  if (own) {
    const d = delayAt(own, findSt(stopId)?.arr);
    if (d != null) return d;
  }

  const ourSeq = findSt(stopId)?.seq ?? 0;
  let best: { dist: number; delay: number } | null = null;
  for (const [id, u] of rtTrip.stops) {
    const st = findSt(id);
    if (!st) continue;
    const d = delayAt(u, st.arr);
    if (d == null) continue;
    const dist = Math.abs(st.seq - ourSeq);
    if (!best || dist < best.dist) best = { dist, delay: d };
  }
  return best?.delay ?? rtTrip.delaySec ?? null;
}
