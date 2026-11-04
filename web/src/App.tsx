import type { Stop } from '@renfe/shared';
import { useEffect, useMemo, useState } from 'react';
import { MapView } from './components/MapView';
import { StopPanel } from './components/StopPanel';
import { StopSearch } from './components/StopSearch';
import { fetchStops, readCachedStops, writeCachedStops } from './lib/api';
import { useFavorites } from './lib/favorites';

export function App() {
  // Arranca con la copia guardada: el mapa y las favoritas funcionan aunque el servidor duerma.
  const [stops, setStops] = useState<Stop[]>(() => readCachedStops() ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Stop | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null);
  const favorites = useFavorites();

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;
    // Esta petición también despierta al servidor si estaba dormido.
    const load = () =>
      fetchStops()
        .then((s) => {
          if (cancelled) return;
          setStops(s);
          setLoadError(null);
          writeCachedStops(s);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setLoadError(e.message);
          retry = setTimeout(load, 3000);
        });
    load();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, []);

  const byId = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops]);
  const favoriteStops = useMemo(
    () => favorites.ids.map((id) => byId.get(id)).filter((s): s is Stop => !!s),
    [favorites.ids, byId],
  );

  const select = (s: Stop, fly: boolean) => {
    setSelected(s);
    if (fly) setFocus({ lat: s.lat, lon: s.lon, key: Date.now() });
  };

  return (
    <div className={`app${selected ? ' has-panel' : ''}`}>
      <MapView
        stops={stops}
        selectedId={selected?.id ?? null}
        favoriteIds={favorites.ids}
        focus={focus}
        onSelect={(s) => select(s, false)}
      />
      <div className="overlay">
        <StopSearch stops={stops} favorites={favoriteStops} onSelect={(s) => select(s, true)} />
        {loadError && stops.length === 0 && (
          <div className="toast">Conectando con el servidor… la primera carga puede tardar hasta un minuto.</div>
        )}
        {selected && (
          <StopPanel
            stop={selected}
            isFavorite={favorites.isFavorite(selected.id)}
            onToggleFavorite={() => favorites.toggle(selected.id)}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
