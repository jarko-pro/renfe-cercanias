import type { TripRealtime } from './poller.js';
import type { VehicleState } from './vehicles.js';

/**
 * Último dato que Renfe publicó de un tren. Los feeds se leen enteros cada 30 s y un tren que
 * no viene en una lectura desaparecería sin más: retraso, posición y todo.
 *
 * Medido el 2026-11-17 (45 min, día de huelga): de 133 cortes de trenes en marcha que luego
 * volvieron, la mitad duró menos de 2 min, el 90 % menos de 8 y el más largo 15. Durante el
 * corte el retraso casi siempre sube (90 veces sube, 32 igual, 33 baja; mediana +1 min, p90
 * +7). Otros 17 trenes en marcha, muchos con +20 a +80 min, se perdieron y no volvieron.
 */
export interface Remembered {
  rt?: TripRealtime;
  /** Última lectura de trip_updates en la que salía el viaje (epoch ms). */
  rtAt?: number;
  vehicle?: VehicleState;
  /** Última lectura de vehicle_positions en la que salía el viaje (epoch ms). */
  vehicleAt?: number;
}

/** Hueco tan corto que no se nota: se sigue mostrando como dato en directo. */
export const BLIP_MS = 2 * 60_000;
/** Se olvida el tren pasado este tiempo sin ningún dato (antes ya habrá llegado a su destino). */
const FORGET_MS = 3 * 3600_000;

export function createRealtimeMemory() {
  const trips = new Map<string, Remembered>();
  const entry = (tripId: string) => {
    let e = trips.get(tripId);
    if (!e) trips.set(tripId, (e = {}));
    return e;
  };
  const prune = (nowMs: number) => {
    for (const [id, e] of trips) if (Math.max(e.rtAt ?? 0, e.vehicleAt ?? 0) < nowMs - FORGET_MS) trips.delete(id);
  };
  return {
    trips,
    onTrips(feed: Map<string, TripRealtime>, nowMs: number) {
      for (const [id, rt] of feed) Object.assign(entry(id), { rt, rtAt: nowMs });
      prune(nowMs);
    },
    onVehicles(feed: Map<string, VehicleState>, nowMs: number) {
      for (const [id, vehicle] of feed) Object.assign(entry(id), { vehicle, vehicleAt: nowMs });
      prune(nowMs);
    },
  };
}

export type RealtimeMemory = ReturnType<typeof createRealtimeMemory>;
