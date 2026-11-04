import type { ArrivalsResponse, Stop } from '@renfe/shared';

/** Vacío en desarrollo (proxy de Vite). En Capacitor/producción: URL pública del backend. */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Error ${res.status}`);
  }
  return res.json();
}

export const fetchStops = (signal?: AbortSignal) => get<Stop[]>('/api/stops', signal);

export const fetchArrivals = (stopId: string, signal?: AbortSignal) =>
  get<ArrivalsResponse>(`/api/stops/${encodeURIComponent(stopId)}/arrivals`, signal);
