import type { BusStop, Line, Stop, TrainMatch } from '@renfe/shared';
import {
  BUS_FEEDS,
  busFeedInfo,
  busStopFromPath,
  busStopId,
  busStopPath,
  slugFromPath,
  stopPath,
  stopSlugs,
} from '@renfe/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BusStopPanel } from './components/BusStopPanel';
import { InstallHint } from './components/InstallHint';
import { NoticeCard, useNotice } from './components/NoticeCard';
import { MapView, type BusVehicle } from './components/MapView';
import { ModeSwitch } from './components/ModeSwitch';
import { StopPanel } from './components/StopPanel';
import { StopSearch } from './components/StopSearch';
import {
  ApiError,
  fetchBusStops,
  fetchStops,
  readCachedBusStops,
  readCachedStops,
  writeCachedBusStops,
  writeCachedStops,
} from './lib/api';
import { track } from './lib/analytics';
import { useFavorites } from './lib/favorites';
import { BUS_ENABLED, initialMode, saveMode, type TransportMode } from './lib/mode';
import { useTripLive, useTripShape } from './lib/useTripLive';

const BASE_TITLE = 'Cercanías en directo · Próximos trenes y retrasos en tiempo real';
const BUS_TITLE = `Autobuses en directo · ${BUS_FEEDS.map((f) => f.city).join(', ')}`;

/** Texto gris bajo el nombre de una parada de autobús en el buscador y en favoritas. */
const busMeta = (s: BusStop) =>
  [`nº ${s.code}`, s.towards && `hacia ${s.towards}`, busFeedInfo(s.feed)?.city].filter(Boolean).join(' · ');

export function App() {
  const [mode, setModeState] = useState<TransportMode>(initialMode);
  // Arranca con la copia guardada: el mapa y las favoritas funcionan aunque el servidor duerma.
  const [stops, setStops] = useState<Stop[]>(() => readCachedStops() ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busStops, setBusStops] = useState<BusStop[]>(() => readCachedBusStops() ?? []);
  // 'waking': el servidor no responde (dormido); 'missing': responde, pero sin autobuses.
  const [busError, setBusError] = useState<'waking' | 'missing' | null>(null);
  const [selected, setSelected] = useState<Stop | null>(null);
  const [selectedBus, setSelectedBus] = useState<BusStop | null>(null);
  const { notice, close: closeNotice } = useNotice();
  // Autobuses que vienen a la parada abierta, y el que se sigue (tocado en el panel; otra vez, se deja).
  const [buses, setBuses] = useState<BusVehicle[]>([]);
  const [busFocus, setBusFocus] = useState<{ vehicle: BusVehicle; key: number } | null>(null);
  const pickBus = useCallback(
    (vehicle: BusVehicle) => setBusFocus((f) => (f?.vehicle.id === vehicle.id ? null : { vehicle, key: Date.now() })),
    [],
  );
  // Posición al día del bus seguido; si ya no viene (ha pasado por la parada), se deja de seguir.
  const followed = busFocus ? buses.find((b) => b.id === busFocus.vehicle.id) : undefined;
  useEffect(() => {
    if (busFocus && buses.length > 0 && !followed) setBusFocus(null);
  }, [busFocus, buses, followed]);
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

  // Las paradas de autobús solo se piden la primera vez que se entra en el modo bus.
  const busWanted = mode === 'bus';
  useEffect(() => {
    if (!busWanted) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;
    const load = () =>
      // Cada red por su cuenta: si una falla (o no está activa en el servidor), salen las demás.
      Promise.allSettled(BUS_FEEDS.map((f) => fetchBusStops(f.id)))
        .then((results) => {
          if (cancelled) return;
          const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
          if (ok.length === 0) throw (results[0] as PromiseRejectedResult).reason;
          const all = ok.flat();
          setBusStops(all);
          setBusError(null);
          writeCachedBusStops(all);
          // Una red que aún está cargando (o el servidor despertando) se vuelve a pedir.
          const pending = results.some(
            (r) => r.status === 'rejected' && (!(r.reason instanceof ApiError) || r.reason.unavailable),
          );
          if (pending) retry = setTimeout(load, 5000);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          const waking = !(e instanceof ApiError) || e.unavailable;
          setBusError(waking ? 'waking' : 'missing');
          retry = setTimeout(load, waking ? 3000 : 30_000);
        });
    load();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [busWanted]);

  const byId = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops]);
  const busById = useMemo(() => new Map(busStops.map((s) => [s.id, s])), [busStops]);
  const slugs = useMemo(() => stopSlugs(stops), [stops]);
  // Las favoritas de los dos modos van en la misma lista: las de bus llevan la red delante
  // ("santander:328"), así que cada una solo aparece en su modo.
  const favoriteStops = useMemo(
    () => favorites.ids.map((id) => byId.get(id)).filter((s): s is Stop => !!s),
    [favorites.ids, byId],
  );
  const favoriteBusStops = useMemo(
    () => favorites.ids.map((id) => busById.get(id)).filter((s): s is BusStop => !!s),
    [favorites.ids, busById],
  );

  const changeMode = (m: TransportMode) => {
    if (m === mode) return;
    saveMode(m);
    track('modo', { modo: m });
    setSelected(null);
    setSelectedBus(null);
    setTracked(null);
    setFocus(null);
    setModeState(m);
    // Que un ?modo= de la dirección no devuelva al modo anterior al recargar.
    const params = new URLSearchParams(location.search);
    if (params.has('modo')) {
      params.delete('modo');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? `?${q}` : ''));
    }
  };

  const select = (s: Stop, fly: boolean, from?: string) => {
    if (s.id !== selected?.id) {
      setTracked(null);
      // `fly` = elegida en el buscador o en favoritas; si no, tocando el mapa.
      track('estacion', { estacion: s.name, red: s.network, desde: from ?? (fly ? 'buscador' : 'mapa') });
    }
    setSelected(s);
    if (fly) setFocus({ lat: s.lat, lon: s.lon, key: Date.now() });
  };

  // Al cambiar de parada (o cerrarla), el autobús elegido deja de estarlo.
  useEffect(() => setBusFocus(null), [selectedBus?.id]);

  // Siguiendo un bus, el mapa solo enseña las paradas de su línea (y la abierta).
  const followedLine = followed?.line.name;
  const mapBusStops = useMemo(() => {
    if (!followedLine || !selectedBus) return busStops;
    return busStops.filter(
      (s) =>
        s.id === selectedBus.id || (s.feed === selectedBus.feed && s.lines.some((l) => l.name === followedLine)),
    );
  }, [busStops, followedLine, selectedBus]);

  const selectBus = (s: BusStop, fly: boolean, from?: string) => {
    if (s.id !== selectedBus?.id) {
      track('parada-bus', { parada: `${s.code} ${s.name}`, red: s.feed, desde: from ?? (fly ? 'buscador' : 'mapa') });
    }
    setSelectedBus(s);
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

  // Igual con una parada de autobús (/bus/santander/parada/328/).
  const busFromUrl = useRef(BUS_ENABLED ? busStopFromPath(location.pathname) : null);
  useEffect(() => {
    if (!busFromUrl.current || busStops.length === 0) return;
    const stop = busById.get(busStopId(busFromUrl.current.feed, busFromUrl.current.code));
    busFromUrl.current = null;
    if (stop) selectBus(stop, true, 'enlace');
  }, [busStops, busById]);

  // La dirección sigue a la estación o parada abierta, para poder compartirla o guardarla.
  useEffect(() => {
    if (!location.protocol.startsWith('http') || fromUrl.current || busFromUrl.current) return;
    let path = '/';
    let title = mode === 'bus' ? BUS_TITLE : BASE_TITLE;
    if (mode === 'tren' && selected) {
      const slug = slugs.get(selected.id);
      if (slug) path = stopPath(slug);
      title = `${selected.name} · Cercanías en directo`;
    } else if (mode === 'bus' && selectedBus) {
      path = busStopPath(selectedBus.feed, selectedBus.code);
      const city = busFeedInfo(selectedBus.feed)?.city ?? '';
      title = `${selectedBus.name} (parada ${selectedBus.code}) · Autobuses de ${city} en directo`;
    }
    if (location.pathname !== path) history.replaceState(null, '', path + location.search);
    document.title = title;
  }, [mode, selected, selectedBus, slugs]);

  // Desde el buscador por número: abre su estación y lo sigue (si va en marcha o sale pronto).
  const selectTrain = (t: TrainMatch) => {
    const stop = byId.get(t.stopId);
    if (!stop) return;
    track('buscar-tren', { linea: t.line.name, red: t.network });
    select(stop, true);
    const soon = t.state === 'running' || t.departure - Date.now() < 90 * 60_000;
    setTracked(soon ? { tripId: t.tripId, line: t.line } : null);
  };

  const toggleFavorite = (id: string, name: string) => {
    if (!favorites.isFavorite(id)) track('favorita', { estacion: name, modo: mode });
    favorites.toggle(id);
  };

  const bus = mode === 'bus';
  const panelOpen = bus ? !!selectedBus : !!selected;
  // Sin autobuses (aún solo Santander), no hay píldora: la app es solo de trenes.
  const switcher = BUS_ENABLED ? <ModeSwitch mode={mode} onChange={changeMode} /> : undefined;
  const showNotice = !!notice && !bus; // los avisos de ahora son de Renfe

  return (
    <div className={`app mode-${mode}${panelOpen ? ' has-panel' : ''}${!bus && selected && tracked ? ' tracking' : ''}`}>
      <MapView
        // Cada modo tiene su propio mapa (y su propia vista guardada).
        key={mode}
        mode={mode}
        stops={bus ? mapBusStops : stops}
        selectedId={(bus ? selectedBus?.id : selected?.id) ?? null}
        favoriteIds={favorites.ids}
        focus={focus}
        onSelect={(s) => (bus ? selectBus(s as BusStop, false) : select(s as Stop, false))}
        train={
          !bus && tracked && live?.tripId === tracked.tripId && live.position
            ? {
                tripId: tracked.tripId,
                ...live.position,
                color: tracked.line.color,
                // En gris también si Renfe ha dejado de darla: es su última posición conocida.
                stale: live.stale || live.lastSeenAt != null,
              }
            : null
        }
        buses={bus && followed ? [followed] : undefined}
        busFocus={bus ? busFocus : null}
        route={!bus && tracked && routePath.length > 1 ? { path: routePath, color: tracked.line.color } : null}
      />
      <div className="overlay">
        {bus ? (
          <StopSearch
            key="bus"
            mode="bus"
            leading={switcher}
            stops={busStops}
            favorites={favoriteBusStops}
            metaOf={busMeta}
            isFavorite={favorites.isFavorite}
            onToggleFavorite={(s) => toggleFavorite(s.id, s.name)}
            onSelect={(s) => selectBus(s, true)}
            onSelectTrain={() => {}}
          />
        ) : (
          <StopSearch
            key="tren"
            mode="tren"
            leading={switcher}
            stops={stops}
            favorites={favoriteStops}
            metaOf={(s) => s.network}
            isFavorite={favorites.isFavorite}
            onToggleFavorite={(s) => toggleFavorite(s.id, s.name)}
            onSelect={(s) => select(s, true)}
            onSelectTrain={selectTrain}
          />
        )}
        {showNotice && notice && <NoticeCard notice={notice} onClose={closeNotice} />}
        {!panelOpen && !showNotice && <InstallHint />}
        {((!bus && loadError && stops.length === 0) || (bus && busError === 'waking' && busStops.length === 0)) && (
          <div className="toast">Conectando con el servidor… la primera carga puede tardar hasta un minuto.</div>
        )}
        {bus && busError === 'missing' && busStops.length === 0 && (
          <div className="toast">Los autobuses no están disponibles ahora mismo. Prueba de nuevo en un rato.</div>
        )}
        {!bus && selected && (
          <StopPanel
            stop={selected}
            isFavorite={favorites.isFavorite(selected.id)}
            onToggleFavorite={() => toggleFavorite(selected.id, selected.name)}
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
        {bus && selectedBus && (
          <BusStopPanel
            stop={selectedBus}
            isFavorite={favorites.isFavorite(selectedBus.id)}
            onToggleFavorite={() => toggleFavorite(selectedBus.id, selectedBus.name)}
            onClose={() => setSelectedBus(null)}
            onVehicles={setBuses}
            onPickVehicle={pickBus}
            followingId={followed?.id ?? null}
          />
        )}
      </div>
    </div>
  );
}
