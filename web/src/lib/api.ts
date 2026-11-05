import type { ArrivalsResponse, Stop, TripLive, TripShape } from '@renfe/shared';

/** Vacío en desarrollo (proxy de Vite). En Capacitor/producción: URL pública del backend. */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

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

export const fetchTripLive = (tripId: string, signal?: AbortSignal) =>
  get<TripLive>(`/api/trips/${encodeURIComponent(tripId)}/live`, signal);

export const fetchTripShape = (tripId: string, signal?: AbortSignal) =>
  get<TripShape>(`/api/trips/${encodeURIComponent(tripId)}/shape`, signal);

// ---- Caché local de estaciones: cambian muy poco, así el mapa sale al instante ----

const STOPS_KEY = 'renfe:stops:v1';

export function readCachedStops(): Stop[] | null {
  try {
    const raw = localStorage.getItem(STOPS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedStops(stops: Stop[]) {
  try {
    localStorage.setItem(STOPS_KEY, JSON.stringify(stops));
  } catch {
    /* sin almacenamiento (modo privado o lleno): no pasa nada */
  }
}
