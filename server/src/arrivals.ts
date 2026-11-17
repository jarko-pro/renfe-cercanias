import type { Arrival } from '@renfe/shared';
import type { GtfsData } from './gtfs/types.js';
import { BLIP_MS, SIGNAL_LOST_MS, type Remembered } from './realtime/memory.js';
import type { StopUpdate, TripRealtime } from './realtime/poller.js';
import type { VehicleState } from './realtime/vehicles.js';
import { trainNumber } from './gtfs/networks.js';
import { distM } from './shape.js';
import { addDays, localDate, serviceDayBase } from './time.js';

/** Mismo criterio que la web: 0 ("Ahora") a menos de 30 s; si no, minutos redondeados. */
export function minutesUntil(estimatedMs: number, nowMs: number): number {
  const secs = (estimatedMs - nowMs) / 1000;
  return secs <= 30 ? 0 : Math.max(1, Math.round(secs / 60));
}

/** Lo que se sabe en tiempo real: los feeds de la última lectura y el último dato de cada tren. */
export interface RealtimeView {
  trips: Map<string, TripRealtime>;
  vehicles?: Map<string, VehicleState>;
  /** Último dato de cada tren, para cuando deja de salir en los feeds. */
  memory?: Map<string, Remembered>;
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
  realtime: RealtimeView,
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

      // Posición real y último dato guardado: solo de la circulación de hoy (no la de ayer/mañana
      // con el mismo trip_id), que es la que puede estar en los feeds.
      const current = Math.abs(scheduled - nowMs) < 4 * 3600_000;
      const liveRt = realtime.trips.get(st.tripId);
      const liveVehicle = current ? realtime.vehicles?.get(st.tripId) : undefined;
      const mem = current ? realtime.memory?.get(st.tripId) : undefined;
      const rtTrip = liveRt ?? mem?.rt;
      const vehicle = liveVehicle ?? mem?.vehicle;
      // Antigüedad del dato que se usa (0 si viene en la última lectura).
      const rtAge = liveRt ? 0 : mem?.rt && mem.rtAt != null ? nowMs - mem.rtAt : null;
      const vehicleAge = liveVehicle ? 0 : mem?.vehicle && mem.vehicleAt != null ? nowMs - mem.vehicleAt : null;
      // El tren ha dejado de salir en el feed de retrasos: el retraso es el último que dio Renfe.
      const rtLost = rtAge != null && rtAge > BLIP_MS;
      const vehicleLost = vehicleAge != null && vehicleAge > BLIP_MS;

      const rtStop = rtTrip?.stops.get(stopId);
      const delaySec = rtTrip ? realtimeDelaySec(data, st.tripId, stopId, base, rtTrip) : null;
      const estimated = delaySec != null ? scheduled + delaySec * 1000 : scheduled;

      let pos = vehicle ? vehiclePosition(data, st.tripId, stopId, st.seq, vehicle) : null;
      // Ya está más allá de nuestra parada: ha pasado aunque la estimación diga otra cosa.
      // Vale también con la última posición conocida: un tren no va hacia atrás.
      if (pos === 'passed') continue;
      if (pos && vehicleLost) {
        // Se perdió en nuestra parada: si es la última, ya ha terminado; si no, no se sabe si
        // sigue ahí, así que no se afirma "En andén" ni "Entrando".
        if (trip.lastStopId === stopId) continue;
        pos = null;
      }

      let unconfirmed: boolean;
      if (rtLost) {
        // Si ya iba en marcha y hace poco que se perdió (o se sigue viendo en el mapa), sale
        // "sin señal" con su último retraso. Si no, "Sin confirmar", pero con ese retraso.
        const lastSeen = nowMs - rtAge;
        const moved = hasMoved(data, st.tripId, base, vehicle, delaySec, lastSeen);
        unconfirmed = !(moved && (rtAge <= SIGNAL_LOST_MS || (vehicleAge != null && vehicleAge <= BLIP_MS)));
      } else {
        const heard = rtTrip != null || (vehicleAge != null && !vehicleLost);
        unconfirmed = !heard && departsFromOriginBy(data, st.tripId, base) <= nowMs + UNCONFIRMED_AHEAD_MS;
      }

      // Un tren que ya ha pasado tiene hora estimada en el pasado y se descarta aquí, salvo
      // que siga entrando o parado en la estación. Si se perdió, el retraso suele haber ido
      // a más: se le da un margen antes de quitarlo.
      // Pero solo si aún no había pasado cuando se perdió: si no, reaparecería un tren que ya
      // se fue. En la última parada tampoco: al terminar el recorrido sale del feed, y es lo
      // normal (caso real: perdido a una parada del final, seguía "llegando" al destino).
      const from =
        rtLost && trip.lastStopId !== stopId
          ? Math.max(fromMs - LOST_GRACE_MS, nowMs - rtAge - graceSec * 1000)
          : fromMs;
      if (!pos && (estimated < from || estimated > toMs)) continue;
      if (pos && estimated > toMs) continue;

      const line = data.lines.get(trip.routeId) ?? { name: '?', color: '7A7A7A', textColor: 'FFFFFF' };
      out.push({
        tripId: st.tripId,
        trainNumber: trainNumber(st.tripId) ?? undefined,
        line,
        headsign: trip.headsign,
        scheduled,
        estimated,
        minutes: minutesUntil(estimated, nowMs),
        delaySec,
        realtime: rtTrip != null && !rtLost,
        unconfirmed,
        ...(rtLost ? { lastSeenAt: nowMs - rtAge } : {}),
        cancelled: !!rtTrip?.cancelled || !!rtStop?.skipped,
        terminates: trip.lastStopId === stopId,
        hasPosition: vehicle?.lat != null && vehicle.lon != null,
        ...(pos ? { vehicleStatus: pos } : {}),
        ...(pos && vehicle?.platform ? { platform: vehicle.platform } : {}),
      });
    }
  }

  out.sort((a, b) => a.estimated - b.estimated);
  return out.slice(0, limit);
}

/**
 * Un tren sin datos en tiempo real es normal si sale dentro de un rato. Si ya ha salido de
 * su origen o sale en menos de esto, debería tenerlos: se marca como "sin confirmar".
 * (Medido el 2026-11-05: ~28 % de los trenes que deberían circular no tienen datos; un
 * cuarto aparece en unos minutos, el resto no: retraso en publicar o cancelación sin avisar.)
 */
const UNCONFIRMED_AHEAD_MS = 5 * 60_000;

/**
 * Un tren que se ha perdido se mantiene este tiempo tras su hora estimada si no consta que
 * haya pasado: durante el corte el retraso casi siempre sube (p90 +7 min, medido 2026-11-17).
 */
const LOST_GRACE_MS = 10 * 60_000;

/**
 * ¿Había salido ya de su origen cuando se perdió? Con posición, si estaba más allá de la
 * primera parada; sin ella, si según el horario y su retraso debía haber salido ya.
 */
function hasMoved(
  data: GtfsData,
  tripId: string,
  base: number,
  v: VehicleState | undefined,
  delaySec: number | null,
  lastSeen: number,
): boolean {
  const stops = data.tripStops.get(tripId) ?? [];
  const i = v ? stops.indexOf(v.stopId) : -1;
  if (i > 0) return true;
  if (v && i === 0) {
    // "En tránsito" con la de origen: Renfe da la parada que acaba de dejar.
    if (v.status !== 'in_transit') return false;
    const s = data.stops.get(stops[0]);
    return !s || v.lat == null || v.lon == null || distM(s.lat, s.lon, v.lat, v.lon) > PASSED_M;
  }
  return departsFromOriginBy(data, tripId, base) + Math.max(0, delaySec ?? 0) * 1000 <= lastSeen;
}

/** Hora programada de salida del viaje desde su primera parada (epoch ms). */
function departsFromOriginBy(data: GtfsData, tripId: string, base: number): number {
  const first = data.tripStops.get(tripId)?.[0];
  const st = first ? data.stopTimesByStop.get(first)?.find((s) => s.tripId === tripId) : undefined;
  return st ? base + st.dep * 1000 : Infinity;
}

/** A partir de esta distancia, un tren "en tránsito" desde nuestra parada ya ha salido. */
const PASSED_M = 300;

/**
 * Dónde está el tren respecto a nuestra parada: entrando, parado en ella, ya pasado o
 * (null) todavía de camino / sin datos útiles.
 */
function vehiclePosition(
  data: GtfsData,
  tripId: string,
  stopId: string,
  ourSeq: number,
  v: VehicleState,
): 'arriving' | 'at_platform' | 'passed' | null {
  if (v.stopId === stopId) {
    if (v.status === 'stopped') return 'at_platform';
    if (v.status === 'incoming') return 'arriving';
    // "En tránsito" con nuestra parada: Renfe indica la última parada que ha dejado, así que
    // si ya está lejos de ella es que ha salido. Muy cerca puede estar aún arrancando.
    const stop = data.stops.get(stopId);
    if (stop && v.lat != null && v.lon != null && distM(stop.lat, stop.lon, v.lat, v.lon) > PASSED_M) return 'passed';
    return null;
  }
  const vSeq = data.stopTimesByStop.get(v.stopId)?.find((s) => s.tripId === tripId)?.seq;
  return vSeq != null && vSeq > ourSeq ? 'passed' : null;
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
