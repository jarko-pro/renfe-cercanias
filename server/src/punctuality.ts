import type { Arrival } from '@renfe/shared';
import type { GtfsData } from './gtfs/types.js';
import { dayType, type Insights } from './history/insights.js';
import { localDate } from './time.js';

/** Con menos días que estos no se muestra "Puntual X de Y días": sería poco fiable. */
export const PUNCTUALITY_MIN_DAYS = 5;

/**
 * Añade a cada tren cómo suele llegar a esta estación según el histórico (mismo número de
 * tren y tipo de día; si aún no hay bastantes, todos los días juntos).
 */
export function withPunctuality(
  arrivals: Arrival[],
  data: GtfsData,
  insights: Insights | null,
  stopId: string,
  nowMs: number,
): Arrival[] {
  if (!insights) return arrivals;
  const dt = dayType(localDate(nowMs));
  return arrivals.map((a) => {
    const network = data.trips.get(a.tripId)?.routeId.slice(0, 2);
    const s = network && a.trainNumber ? insights.atStop(network, a.trainNumber, dt, stopId) : null;
    if (!s || s.days < PUNCTUALITY_MIN_DAYS) return a;
    return { ...a, punctuality: { days: s.days, punctualDays: s.punctualDays, medianDelaySec: s.medianDelaySec } };
  });
}
