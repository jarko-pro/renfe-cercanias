import type { GtfsData } from '../gtfs/types.js';
import type { TripRealtime } from '../realtime/poller.js';
import { addDays, serviceDayBase } from '../time.js';
import { trainNumber } from '../gtfs/networks.js';

/** Un viaje terminado, listo para guardar. */
export interface TrainRun {
  service_date: string; // YYYY-MM-DD
  network: string; // prefijo del route_id, p. ej. '10' = Madrid
  train: string; // número de tren, p. ej. '19799'
  line: string;
  trip_id: string;
  /** Salida programada del origen, en segundos desde el inicio del día de servicio. */
  dep_time: number;
  /** ok = con datos de Renfe; cancelled = Renfe lo canceló; no_data = Renfe nunca publicó nada. */
  status: 'ok' | 'cancelled' | 'no_data';
  stops: string[];
  /** Retraso (s) con el que llegó a cada parada; null si no hubo dato. */
  delays: (number | null)[];
}

interface Tracked {
  date: string;
  stops: string[];
  delays: (number | null)[];
  cancelled: boolean;
  lastDelay: number;
}

/** Margen tras la hora prevista de llegada al destino antes de dar el viaje por terminado. */
const END_MARGIN_MS = 30 * 60_000;
/** Un hueco mayor que esto entre lecturas del feed cuenta como caída (no se marcan "sin datos"). */
const OUTAGE_MS = 3 * 60_000;

/** trip_id -> [salida del origen, llegada al destino] en segundos del día de servicio. */
const spanCache = new WeakMap<GtfsData, Map<string, [number, number]>>();
function spanSecs(data: GtfsData): Map<string, [number, number]> {
  let m = spanCache.get(data);
  if (m) return m;
  m = new Map();
  for (const list of data.stopTimesByStop.values())
    for (const st of list) {
      const s = m.get(st.tripId);
      if (!s) m.set(st.tripId, [st.dep, st.arr]);
      else {
        s[0] = Math.min(s[0], st.dep);
        s[1] = Math.max(s[1], st.arr);
      }
    }
  spanCache.set(data, m);
  return m;
}

const isoDate =(d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/**
 * Va anotando, en cada lectura del feed de Renfe, el último retraso previsto para la parada a
 * la que se dirige cada tren. Cuando el tren pasa de largo, ese último valor queda como su
 * retraso en esa parada. Al terminar el viaje se entrega una fila por tren y día.
 */
export function createCollector(startedAt: number) {
  const tracked = new Map<string, Tracked>(); // `${date}|${tripId}`
  const done = new Set<string>();
  const outages: [number, number][] = [];
  let lastObs: number | null = null;

  /** Día de servicio (de ayer u hoy) al que pertenece el viaje. */
  function serviceDate(data: GtfsData, tripId: string, today: string): string | null {
    const sid = data.trips.get(tripId)?.serviceId;
    if (!sid) return null;
    for (const d of [today, addDays(today, -1)]) if (data.servicesByDate.get(d)?.has(sid)) return d;
    return null;
  }

  function observe(
    data: GtfsData,
    trips: Map<string, TripRealtime>,
    vehicles: Map<string, unknown>,
    today: string,
    nowMs: number,
  ) {
    if (lastObs != null && nowMs - lastObs > OUTAGE_MS) outages.push([lastObs, nowMs]);
    lastObs = nowMs;

    const touch = (tripId: string): Tracked | null => {
      const date = serviceDate(data, tripId, today);
      const stops = data.tripStops.get(tripId);
      if (!date || !stops) return null;
      const key = `${date}|${tripId}`;
      if (done.has(key)) return null;
      let t = tracked.get(key);
      if (!t) tracked.set(key, (t = { date, stops, delays: stops.map(() => null), cancelled: false, lastDelay: 0 }));
      return t;
    };

    for (const [tripId, rt] of trips) {
      const t = touch(tripId);
      if (!t) continue;
      if (rt.cancelled) t.cancelled = true;
      for (const [stopId, u] of rt.stops) {
        const i = t.stops.indexOf(stopId);
        const d = u.delaySec ?? rt.delaySec;
        if (i >= 0 && d != null) {
          t.delays[i] = d;
          t.lastDelay = d;
        }
      }
    }
    // Solo con posición (sin retraso): al menos consta que circuló.
    for (const tripId of vehicles.keys()) touch(tripId);
  }

  /** Hora prevista (ms) de salida del origen y de llegada al destino. */
  function span(data: GtfsData, tripId: string, date: string): [number, number] | null {
    const s = spanSecs(data).get(tripId);
    if (!s) return null;
    const base = serviceDayBase(date);
    return [base + s[0] * 1000, base + s[1] * 1000];
  }

  /** Devuelve los viajes que ya han terminado y los olvida. */
  function collect(data: GtfsData, today: string, nowMs: number): TrainRun[] {
    const out: TrainRun[] = [];
    const run = (tripId: string, date: string, status: TrainRun['status'], t?: Tracked): void => {
      const info = data.trips.get(tripId);
      const train = trainNumber(tripId);
      const sp = span(data, tripId, date);
      if (!info || !train || !sp) return;
      const stops = t?.stops ?? data.tripStops.get(tripId) ?? [];
      out.push({
        service_date: isoDate(date),
        network: info.routeId.slice(0, 2),
        train,
        line: data.lines.get(info.routeId)?.name ?? '',
        trip_id: tripId,
        dep_time: Math.round((sp[0] - serviceDayBase(date)) / 1000),
        status,
        stops,
        delays: t?.delays ?? stops.map(() => null),
      });
    };

    // Viajes vistos: se cierran cuando ha pasado su hora de llegada (más el retraso y un margen).
    for (const [key, t] of tracked) {
      const tripId = key.slice(key.indexOf('|') + 1);
      const sp = span(data, tripId, t.date);
      if (sp && nowMs < sp[1] + Math.max(0, t.lastDelay) * 1000 + END_MARGIN_MS) continue;
      tracked.delete(key);
      done.add(key);
      run(tripId, t.date, t.cancelled ? 'cancelled' : 'ok', t);
    }

    // Viajes que Renfe nunca publicó. Solo si los vimos enteros: tras arrancar y sin caídas del feed.
    for (const date of [addDays(today, -1), today]) {
      const services = data.servicesByDate.get(date);
      if (!services) continue;
      for (const [tripId, info] of data.trips) {
        if (!services.has(info.serviceId)) continue;
        const key = `${date}|${tripId}`;
        if (done.has(key) || tracked.has(key)) continue;
        const sp = span(data, tripId, date);
        if (!sp || nowMs < sp[1] + END_MARGIN_MS) continue;
        done.add(key);
        const watched =
          sp[0] >= startedAt && lastObs != null && lastObs >= sp[1] && !outages.some(([a, b]) => a < sp[1] && b > sp[0]);
        if (watched) run(tripId, date, 'no_data');
      }
    }

    // Olvida lo de hace más de dos días.
    const keep = addDays(today, -2);
    for (const key of done) if (key.slice(0, 8) < keep) done.delete(key);
    while (outages.length && outages[0][1] < nowMs - 2 * 86_400_000) outages.shift();
    return out;
  }

  return { observe, collect, pending: () => tracked.size };
}
