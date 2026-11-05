import type { TripLive } from '@renfe/shared';
import type { GtfsData } from './gtfs/types.js';
import type { TripRealtime } from './realtime/poller.js';
import type { VehicleState } from './realtime/vehicles.js';

/** Parada siguiente a `stopId` en el recorrido del viaje (null si es la última o no está). */
export function nextStopId(data: GtfsData, tripId: string, stopId: string): string | null {
  const stops = data.tripStops.get(tripId);
  const i = stops?.indexOf(stopId) ?? -1;
  return stops && i >= 0 && i < stops.length - 1 ? stops[i + 1] : null;
}

/**
 * Dónde está ahora un tren.
 *
 * Ojo con el estado "en tránsito": Renfe pone en `stopId` la parada que el tren acaba de
 * DEJAR, no la siguiente como dice el estándar (medido el 2026-11-05 en 25 trenes: ninguno
 * tenía esa parada por delante). Por eso la siguiente se calcula con el recorrido del viaje.
 * "Entrando" y "parado" sí se refieren a la parada correcta.
 */
export function buildTripLive(
  data: GtfsData,
  tripId: string,
  v: VehicleState | undefined,
  rtTrip: TripRealtime | undefined,
): TripLive | null {
  const trip = data.trips.get(tripId);
  if (!trip) return null;
  const stopName = (id: string | null | undefined) => (id && data.stops.get(id)?.name) || null;
  const next = v?.status === 'in_transit' && v.stopId ? nextStopId(data, tripId, v.stopId) : null;
  return {
    tripId,
    line: data.lines.get(trip.routeId) ?? { name: '?', color: '7A7A7A', textColor: 'FFFFFF' },
    headsign: trip.headsign,
    position: v?.lat != null && v.lon != null ? { lat: v.lat, lon: v.lon } : null,
    status: v?.status ?? null,
    stopId: v?.stopId || null,
    stopName: stopName(v?.stopId),
    nextStopName: stopName(next),
    ...(v?.platform ? { platform: v.platform } : {}),
    delaySec: rtTrip?.delaySec ?? null,
    updatedAt: v?.timestamp ?? null,
  };
}
