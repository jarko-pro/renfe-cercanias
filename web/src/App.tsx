import type { Line, Stop, TrainMatch } from '@renfe/shared';
import { slugFromPath, stopPath, stopSlugs } from '@renfe/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { InstallHint } from './components/InstallHint';
import { NoticeCard, useNotice } from './components/NoticeCard';
import { MapView } from './components/MapView';
import { StopPanel } from './components/StopPanel';
import { StopSearch } from './components/StopSearch';
import { fetchStops, readCachedStops, writeCachedStops } from './lib/api';
import { track } from './lib/analytics';
import { useFavorites } from './lib/favorites';
import { useTripLive, useTripShape } from './lib/useTripLive';

const BASE_TITLE = 'Cercanías en directo · Próximos trenes y retrasos en tiempo real';

export function App() {
  // Arranca con la copia guardada: el mapa y las favoritas funcionan aunque el servidor duerma.
  const [stops, setStops] = useState<Stop[]>(() => readCachedStops() ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Stop | null>(null);
  const { notice, close: closeNotice } = useNotice();
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null);
  const favorites = useFavorites();
  // Tren que se sigue en el mapa (solo uno, y solo mientras el panel de su estación está abierto).
  const [tracked, setTracked] = useState<{ tripId: string; line: Line } | null>(null);
  const live = useTripLive(tracked?.tripId ?? null);
  const routePath = useTripShape(tracked?.tripId ?? null);

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
  const slugs = useMemo(() => stopSlugs(stops), [stops]);
  const favoriteStops = useMemo(
    () => favorites.ids.map((id) => byId.get(id)).filter((s): s is Stop => !!s),
    [favorites.ids, byId],
  );

  const select = (s: Stop, fly: boolean, from?: string) => {
    if (s.id !== selected?.id) {
      setTracked(null);
      // `fly` = elegida en el buscador o en favoritas; si no, tocando el mapa.
      track('estacion', { estacion: s.name, red: s.network, desde: from ?? (fly ? 'buscador' : 'mapa') });
    }
    setSelected(s);
    if (fly) setFocus({ lat: s.lat, lon: s.lon, key: Date.now() });
  };

  // Entrando por la página de una estación (/estacion/atocha/), se abre su panel.
  const fromUrl = useRef(slugFromPath(location.pathname));
  useEffect(() => {
    if (!fromUrl.current || stops.length === 0) return;
    const stop = stops.find((s) => slugs.get(s.id) === fromUrl.current);
    fromUrl.current = null;
    if (stop) select(stop, true, 'enlace');
  }, [stops, slugs]);

  // La dirección sigue a la estación abierta, para poder compartirla o guardarla.
  useEffect(() => {
    if (!location.protocol.startsWith('http') || fromUrl.current) return;
    const slug = selected ? slugs.get(selected.id) : null;
    const path = slug ? stopPath(slug) : '/';
    if (location.pathname !== path) history.replaceState(null, '', path + location.search);
    document.title = selected ? `${selected.name} · Cercanías en directo` : BASE_TITLE;
  }, [selected, slugs]);

  // Desde el buscador por número: abre su estación y lo sigue (si va en marcha o sale pronto).
  const selectTrain = (t: TrainMatch) => {
    const stop = byId.get(t.stopId);
    if (!stop) return;
    track('buscar-tren', { linea: t.line.name, red: t.network });
    select(stop, true);
    const soon = t.state === 'running' || t.departure - Date.now() < 90 * 60_000;
    setTracked(soon ? { tripId: t.tripId, line: t.line } : null);
  };

  return (
    <div className={`app${selected ? ' has-panel' : ''}${selected && tracked ? ' tracking' : ''}`}>
      <MapView
        stops={stops}
        selectedId={selected?.id ?? null}
        favoriteIds={favorites.ids}
        focus={focus}
        onSelect={(s) => select(s, false)}
        train={
          tracked && live?.tripId === tracked.tripId && live.position
            ? { tripId: tracked.tripId, ...live.position, color: tracked.line.color, stale: live.stale }
            : null
        }
        route={tracked && routePath.length > 1 ? { path: routePath, color: tracked.line.color } : null}
      />
      <div className="overlay">
        <StopSearch
          stops={stops}
          favorites={favoriteStops}
          onSelect={(s) => select(s, true)}
          onSelectTrain={selectTrain}
        />
        {notice && <NoticeCard notice={notice} onClose={closeNotice} />}
        {!selected && !notice && <InstallHint />}
        {loadError && stops.length === 0 && (
          <div className="toast">Conectando con el servidor… la primera carga puede tardar hasta un minuto.</div>
        )}
        {selected && (
          <StopPanel
            stop={selected}
            isFavorite={favorites.isFavorite(selected.id)}
            onToggleFavorite={() => {
              if (!favorites.isFavorite(selected.id)) track('favorita', { estacion: selected.name });
              favorites.toggle(selected.id);
            }}
            onClose={() => {
              setSelected(null);
              setTracked(null);
            }}
            tracked={tracked ? { tripId: tracked.tripId, live: live?.tripId === tracked.tripId ? live : null } : null}
            onTrack={(a) => {
              const start = !!a && a.tripId !== tracked?.tripId;
              if (start) track('seguir-tren', { linea: a.line.name, estacion: selected.name });
              setTracked(start ? { tripId: a.tripId, line: a.line } : null);
            }}
          />
        )}
      </div>
    </div>
  );
}
