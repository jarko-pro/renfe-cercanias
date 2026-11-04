import type { Stop } from '@renfe/shared';
import { useEffect, useMemo, useState } from 'react';
import { MapView } from './components/MapView';
import { StopPanel } from './components/StopPanel';
import { StopSearch } from './components/StopSearch';
import { fetchStops } from './lib/api';
import { useFavorites } from './lib/favorites';

export function App() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Stop | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null);
  const favorites = useFavorites();

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchStops()
        .then((s) => !cancelled && (setStops(s), setLoadError(null)))
        .catch((e: Error) => {
          if (cancelled) return;
          setLoadError(e.message);
          retry = setTimeout(load, 5000); // el servidor puede estar cargando el GTFS
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
        {loadError && stops.length === 0 && <div className="toast">{loadError}</div>}
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
