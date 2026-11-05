import type { TripLive } from '@renfe/shared';
import { useEffect, useState } from 'react';
import { fetchTripLive, fetchTripShape, isAbort } from './api';

/** Renfe actualiza las posiciones cada ~30 s; pidiendo cada 15 s el retraso extra es pequeño. */
const REFRESH_MS = 15_000;
const RETRY_MS = 5_000;

/**
 * Posición en vivo de un tren mientras se le sigue. Solo pide datos con la pestaña visible
 * y deja de pedir en cuanto `tripId` pasa a null.
 */
export function useTripLive(tripId: string | null): TripLive | null {
  const [live, setLive] = useState<TripLive | null>(null);

  useEffect(() => {
    setLive(null);
    if (!tripId) return;
    let ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      clearTimeout(timer);
      ctrl.abort();
      ctrl = new AbortController();
      let next = REFRESH_MS;
      try {
        setLive(await fetchTripLive(tripId, ctrl.signal));
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
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tripId]);

  return live;
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
