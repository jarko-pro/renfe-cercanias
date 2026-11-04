import { useCallback, useEffect, useState } from 'react';

/**
 * Almacén de paradas favoritas. Hoy se guarda en el dispositivo (localStorage);
 * cuando haya cuentas de usuario se añadirá una implementación remota con la misma interfaz.
 */
export interface FavoritesStore {
  list(): Promise<string[]>;
  save(ids: string[]): Promise<void>;
}

const KEY = 'renfe:favorites';

export const localFavoritesStore: FavoritesStore = {
  async list() {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  },
  async save(ids) {
    try {
      localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      /* almacenamiento no disponible (modo privado): se mantiene solo en memoria */
    }
  },
};

export function useFavorites(store: FavoritesStore = localFavoritesStore) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    void store.list().then(setIds);
  }, [store]);

  const toggle = useCallback(
    (id: string) => {
      setIds((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        void store.save(next);
        return next;
      });
    },
    [store],
  );

  return { ids, isFavorite: (id: string) => ids.includes(id), toggle };
}
