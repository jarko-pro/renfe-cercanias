import type { TripLive } from '@renfe/shared';
import { useEffect, useMemo, useState } from 'react';
import { fetchTripLive, fetchTripShape, isAbort } from './api';

/** Renfe actualiza las posiciones cada ~30 s; pidiendo cada 15 s el retraso extra es pequeño. */
const REFRESH_MS = 15_000;
const RETRY_MS = 5_000;
/** Sin una respuesta buena en este tiempo, la posición se da por vieja (se pinta en gris). */
export const STALE_MS = 90_000;

/**
 * Posición en vivo de un tren mientras se le sigue. Solo pide datos con la pestaña visible
 * y deja de pedir en cuanto `tripId` pasa a null.
 */
export function useTripLive(tripId: string | null): (TripLive & { stale: boolean }) | null {
  const [live, setLive] = useState<TripLive | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    setLive(null);
    setStale(false);
    if (!tripId) return;
    let ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      clearTimeout(timer);
      ctrl.abort();
      ctrl = new AbortController();
      let next = REFRESH_MS;
      try {
        setLive(await fetchTripLive(tripId, ctrl.signal));
        setStale(false);
        clearTimeout(staleTimer);
        staleTimer = setTimeout(() => setStale(true), STALE_MS);
      } catch (e) {
        if (isAbort(e)) return;
        next = RETRY_MS; // se mantiene la última posición conocida
      }
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') void load();
      }, next);
    };

    void load();
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
      clearTimeout(staleTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tripId]);

  return useMemo(() => (live ? { ...live, stale } : null), [live, stale]);
}

/** Trazado del viaje seguido (se pide una sola vez por tren). Vacío si no hay o falla. */
export function useTripShape(tripId: string | null): [number, number][] {
  const [path, setPath] = useState<[number, number][]>([]);
  useEffect(() => {
    setPath([]);
    if (!tripId) return;
    const ctrl = new AbortController();
    fetchTripShape(tripId, ctrl.signal)
      .then((r) => setPath(r.path))
      .catch(() => {
        /* sin trazado: se sigue viendo el tren igualmente */
      });
    return () => ctrl.abort();
  }, [tripId]);
  return path;
}
