import type {
  ArrivalsResponse,
  BusArrivalsResponse,
  BusStop,
  Stop,
  StopTimetable,
  TrainMatch,
  TripLive,
  TripShape,
  TripTimes,
} from '@renfe/shared';

/** Vacío en desarrollo (proxy de Vite). En Capacitor/producción: URL pública del backend. */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** URL completa de un endpoint del backend. */
export const apiUrl = (path: string) => `${BASE}${path}`;

/** Tiempo máximo por petición: si el servidor está arrancando, se corta y se reintenta. */
const TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  /** El servidor no responde o está arrancando (dormido en Render, cargando horarios...). */
  readonly unavailable: boolean;
  constructor(message: string, unavailable: boolean) {
    super(message);
    this.unavailable = unavailable;
  }
}

export const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(body?.error ?? `Error ${res.status}`, res.status >= 502 && res.status <= 504);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (isAbort(e) && !timedOut) throw e; // cancelada por quien llama
    throw new ApiError('El servidor no responde', true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export const fetchStops = (signal?: AbortSignal) => get<Stop[]>('/api/stops', signal);

export const fetchArrivals = (stopId: string, signal?: AbortSignal) =>
  get<ArrivalsResponse>(`/api/stops/${encodeURIComponent(stopId)}/arrivals`, signal);

/** Horario programado de todo el día: 0 = hoy, 1 = mañana. */
export const fetchTimetable = (stopId: string, day: 0 | 1, signal?: AbortSignal) =>
  get<StopTimetable>(`/api/stops/${encodeURIComponent(stopId)}/timetable?day=${day}`, signal);

/** Recorrido del tren: 0 = hoy (con la hora real en las paradas ya pasadas), 1 = mañana. */
export const fetchTripTimes = (tripId: string, day: 0 | 1, signal?: AbortSignal) =>
  get<TripTimes>(`/api/trips/${encodeURIComponent(tripId)}/stops?day=${day}`, signal);

export const fetchTripLive = (tripId: string, signal?: AbortSignal) =>
  get<TripLive>(`/api/trips/${encodeURIComponent(tripId)}/live`, signal);

export const fetchTripShape = (tripId: string, signal?: AbortSignal) =>
  get<TripShape>(`/api/trips/${encodeURIComponent(tripId)}/shape`, signal);

export const fetchTrains = (number: string, signal?: AbortSignal) =>
  get<TrainMatch[]>(`/api/trains/${encodeURIComponent(number)}`, signal);

/** Paradas de una red de autobús (p. ej. "santander"). */
export const fetchBusStops = (feed: string, signal?: AbortSignal) =>
  get<BusStop[]>(`/api/bus/${encodeURIComponent(feed)}/stops`, signal);

/** Próximos buses de una parada (por su número), por línea y destino. */
export const fetchBusArrivals = (feed: string, code: string, signal?: AbortSignal) =>
  get<BusArrivalsResponse>(`/api/bus/${encodeURIComponent(feed)}/stops/${encodeURIComponent(code)}/arrivals`, signal);

// ---- Caché local de estaciones y paradas: cambian muy poco, así el mapa sale al instante ----

const STOPS_KEY = 'renfe:stops:v1';
const BUS_STOPS_KEY = 'renfe:busstops:v1';

function readCache<T>(key: string): T[] | null {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, list: unknown[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* sin almacenamiento (modo privado o lleno): no pasa nada */
  }
}

export const readCachedStops = () => readCache<Stop>(STOPS_KEY);
export const writeCachedStops = (stops: Stop[]) => writeCache(STOPS_KEY, stops);
export const readCachedBusStops = () => readCache<BusStop>(BUS_STOPS_KEY);
export const writeCachedBusStops = (stops: BusStop[]) => writeCache(BUS_STOPS_KEY, stops);
