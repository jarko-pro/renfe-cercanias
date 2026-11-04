import type { Line, Stop } from '@renfe/shared';
import { addDays, parseGtfsTime, weekday } from '../time.js';
import { networkOf } from './networks.js';
import type { GtfsData, GtfsSource, StopTime, TripInfo } from './types.js';

const WEEKDAY_COLS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Construye los índices en memoria. Solo guarda stop_times de los viajes que circulan
 * ayer, hoy o mañana (fecha local `today`), lo que reduce mucho la memoria.
 */
export async function buildGtfsData(src: GtfsSource, today: string): Promise<GtfsData> {
  const dates = [addDays(today, -1), today, addDays(today, 1)];
  const servicesByDate = new Map<string, Set<string>>(dates.map((d) => [d, new Set<string>()]));

  if (src.has('calendar.txt')) {
    for await (const r of src.rows('calendar.txt')) {
      for (const d of dates) {
        if (d >= r.start_date && d <= r.end_date && r[WEEKDAY_COLS[weekday(d)]] === '1') {
          servicesByDate.get(d)!.add(r.service_id);
        }
      }
    }
  }
  if (src.has('calendar_dates.txt')) {
    for await (const r of src.rows('calendar_dates.txt')) {
      const set = servicesByDate.get(r.date);
      if (!set) continue;
      if (r.exception_type === '1') set.add(r.service_id);
      else if (r.exception_type === '2') set.delete(r.service_id);
    }
  }
  const activeServices = new Set<string>();
  for (const s of servicesByDate.values()) for (const id of s) activeServices.add(id);

  const lines = new Map<string, Line>();
  for await (const r of src.rows('routes.txt')) {
    lines.set(r.route_id, {
      name: r.route_short_name || r.route_long_name.replace(/\s+/g, ' '),
      color: (r.route_color || '7A7A7A').toUpperCase(),
      textColor: (r.route_text_color || 'FFFFFF').toUpperCase(),
    });
  }

  const routeOfTrip = new Map<string, string>();
  const trips = new Map<string, TripInfo>();
  for await (const r of src.rows('trips.txt')) {
    routeOfTrip.set(r.trip_id, r.route_id);
    if (activeServices.has(r.service_id)) {
      trips.set(r.trip_id, {
        routeId: r.route_id,
        serviceId: r.service_id,
        headsign: r.trip_headsign ?? '',
        lastStopId: '',
      });
    }
  }

  const rawStops = new Map<string, { name: string; lat: number; lon: number }>();
  for await (const r of src.rows('stops.txt')) {
    if (r.location_type && r.location_type !== '0' && r.location_type !== '1') continue;
    rawStops.set(r.stop_id, { name: r.stop_name, lat: +r.stop_lat, lon: +r.stop_lon });
  }

  const routesByStop = new Map<string, Set<string>>();
  const stopTimesByStop = new Map<string, StopTime[]>();
  const lastSeq = new Map<string, number>();
  for await (const r of src.rows('stop_times.txt')) {
    const stopId = r.stop_id;
    if (!rawStops.has(stopId)) continue;
    const routeId = routeOfTrip.get(r.trip_id);
    if (routeId) {
      let set = routesByStop.get(stopId);
      if (!set) routesByStop.set(stopId, (set = new Set()));
      set.add(routeId);
    }
    const trip = trips.get(r.trip_id);
    if (!trip) continue;
    const seq = parseInt(r.stop_sequence, 10);
    const arr = parseGtfsTime(r.arrival_time || r.departure_time);
    const dep = parseGtfsTime(r.departure_time || r.arrival_time);
    let list = stopTimesByStop.get(stopId);
    if (!list) stopTimesByStop.set(stopId, (list = []));
    list.push({ tripId: r.trip_id, arr, dep, seq });
    if (seq > (lastSeq.get(r.trip_id) ?? -1)) {
      lastSeq.set(r.trip_id, seq);
      trip.lastStopId = stopId;
    }
  }
  for (const list of stopTimesByStop.values()) list.sort((a, b) => a.arr - b.arr);
  for (const trip of trips.values()) {
    if (!trip.headsign) trip.headsign = rawStops.get(trip.lastStopId)?.name ?? '';
  }

  const stops = new Map<string, Stop>();
  for (const [id, s] of rawStops) {
    const routeIds = routesByStop.get(id);
    if (!routeIds) continue; // parada sin servicio: no se muestra
    const byName = new Map<string, Line>();
    const networks = new Map<string, number>();
    for (const rid of routeIds) {
      const line = lines.get(rid);
      if (line) byName.set(line.name, line);
      const n = networkOf(rid);
      networks.set(n, (networks.get(n) ?? 0) + 1);
    }
    const network = [...networks.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const sortedLines = [...byName.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { numeric: true }),
    );
    stops.set(id, { id, name: s.name, lat: s.lat, lon: s.lon, network, lines: sortedLines });
  }

  return { loadedAt: Date.now(), today, stops, lines, trips, servicesByDate, stopTimesByStop };
}
