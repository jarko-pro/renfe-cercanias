import type { Stop } from '@renfe/shared';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Pane, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';

export interface TrainPosition {
  tripId: string;
  lat: number;
  lon: number;
  /** Color de la línea, hex sin '#'. */
  color: string;
  /** Sin datos nuevos hace rato (p. ej. sin conexión): se pinta en gris. */
  stale?: boolean;
}

interface Props {
  stops: Stop[];
  selectedId: string | null;
  favoriteIds: string[];
  /** Parada a la que volar (cambia la referencia para volver a centrar). */
  focus: { lat: number; lon: number; zoom?: number; key: number } | null;
  onSelect: (stop: Stop) => void;
  /** Tren que se está siguiendo, si lo hay. */
  train: TrainPosition | null;
  /** Trazado del tren seguido, de origen a destino. */
  route: { path: [number, number][]; color: string } | null;
}

const SPAIN: [number, number] = [40.2, -3.7];
const VIEW_KEY = 'renfe:view:v1';

/** Última vista del mapa guardada en el dispositivo; si no hay, España entera. */
function initialView(): { center: [number, number]; zoom: number } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon) && Number.isFinite(v.zoom)) {
      return { center: [v.lat, v.lon], zoom: v.zoom };
    }
  } catch {
    /* sin almacenamiento o dato corrupto */
  }
  return { center: SPAIN, zoom: 6 };
}

/** Guarda la vista cada vez que el mapa se para, para abrir ahí la próxima vez. */
function RememberView() {
  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() }));
      } catch {
        /* modo privado: no se recuerda */
      }
    },
  });
  return null;
}

function FlyTo({ focus }: { focus: Props['focus'] }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    map.flyTo([focus.lat, focus.lon], Math.max(map.getZoom(), focus.zoom ?? 14), { duration: 0.8 });
  }, [focus, map]);
  return null;
}

/** Silueta de tren de cercanías vista de frente (blanca sobre el color de la línea). */
const TRAIN_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
  '<path fill="#fff" d="M12 2C8 2 5 2.5 5 6v9.5A3.5 3.5 0 0 0 8.5 19L7 20.5v.5h2.2l2-2h1.6l2 2H17v-.5L15.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-3-4-7-4Zm-5 5h4.2v4H7V7Zm5.8 0H17v4h-4.2V7ZM8.5 14a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/>' +
  '</svg>';

/** Tiempo que tarda el marcador en deslizarse hasta la nueva posición. */
const GLIDE_MS = 2_000;

/**
 * Tren seguido: un punto del color de su línea con un pulso. Entre posiciones (llegan cada
 * ~30 s) se desliza en línea recta en vez de saltar.
 */
function TrainMarker({ train }: { train: TrainPosition }) {
  const ref = useRef<L.Marker>(null);
  const shown = useRef<[number, number]>([train.lat, train.lon]);
  const icon = useMemo(
    () =>
      L.divIcon({
        className: `train-marker${train.stale ? ' stale' : ''}`,
        html: `<span style="--line:#${train.color}">${TRAIN_SVG}</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
    [train.color, train.stale],
  );

  useEffect(() => {
    const marker = ref.current;
    if (!marker) return;
    const [fromLat, fromLon] = shown.current;
    const { lat, lon } = train;
    if (fromLat === lat && fromLon === lon) return;
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / GLIDE_MS);
      const e = k * (2 - k); // frena al final
      shown.current = [fromLat + (lat - fromLat) * e, fromLon + (lon - fromLon) * e];
      marker.setLatLng(shown.current);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [train.lat, train.lon]);

  return (
    <Marker ref={ref} position={shown.current} icon={icon} keyboard={false} interactive={false} zIndexOffset={1000} />
  );
}

/** Tramo del trazado que le queda al tren: desde el punto más cercano a él hasta el destino. */
function aheadOf(path: [number, number][], train: TrainPosition | null): [number, number][] {
  if (!train) return path;
  let best = 0;
  let bestD = Infinity;
  const k = Math.cos((train.lat * Math.PI) / 180);
  path.forEach(([lat, lon], i) => {
    const d = (lat - train.lat) ** 2 + ((lon - train.lon) * k) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return [[train.lat, train.lon], ...path.slice(best + 1)];
}

/** Al empezar a seguir un tren, encuadra la estación y el tren (una sola vez por tren). */
function FitTrain({ train, stop }: { train: TrainPosition | null; stop: Stop | undefined }) {
  const map = useMap();
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!train) {
      fitted.current = null;
      return;
    }
    if (!stop || fitted.current === train.tripId) return;
    fitted.current = train.tripId;
    // Deja libre la zona que tapa el panel: abajo en el móvil, a la izquierda en escritorio.
    const mobile = window.innerWidth <= 640;
    map.flyToBounds(
      [
        [stop.lat, stop.lon],
        [train.lat, train.lon],
      ],
      {
        paddingTopLeft: mobile ? [40, 90] : [420, 40],
        // En el móvil el panel se reduce a la fila del tren seguido (unos 130 px).
        paddingBottomRight: mobile ? [40, 190] : [40, 40],
        maxZoom: 15,
        duration: 0.8,
      },
    );
  }, [train, stop, map]);
  return null;
}

/** Distancia (px) a la que un clic o un toque cuenta como sobre una estación. */
const HIT_MOUSE = 14;
const HIT_TOUCH = 22;
/** Margen (px) alrededor del nombre que sigue contando como "encima", para llegar a él sin que se cierre. */
const TIP_MARGIN = 10;
/** Tiempo de gracia antes de cerrar el nombre al salir de la zona. */
const TIP_HIDE_MS = 250;

/**
 * Clics y nombre de las estaciones. En lugar de que cada punto detecte el clic con su tamaño
 * visible (muy pequeño en el móvil), se busca la estación más cercana dentro de un radio amplio:
 * si dos puntos se solapan, gana el más cercano al dedo. El nombre (al pasar el ratón) también se
 * puede pulsar, pero siempre después de los puntos: si el clic cae sobre un punto, gana el punto.
 */
function StopHits({ stops, onSelect }: { stops: Stop[]; onSelect: (stop: Stop) => void }) {
  const map = useMap();
  const tooltip = useRef<L.Tooltip | null>(null);
  const hovered = useRef<Stop | null>(null);
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const container = map.getContainer();
    // interactive: el nombre recibe sus propios clics (y muestra la mano), en vez de depender de que
    // el clic lo atraviese hasta el mapa.
    const tip = L.tooltip({ direction: 'top', offset: [0, -6], opacity: 0.9, interactive: true });
    tooltip.current = tip;

    /** Estación más cercana al punto (coordenadas del contenedor), dentro del radio. */
    const nearest = (p: L.Point, radius: number): Stop | null => {
      let best: Stop | null = null;
      let bestD = radius * radius;
      const b = map.getBounds().pad(0.05);
      for (const s of stopsRef.current) {
        if (!b.contains([s.lat, s.lon])) continue;
        const q = map.latLngToContainerPoint([s.lat, s.lon]);
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d <= bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    };

    /**
     * ¿Está el puntero encima del nombre que se está mostrando? La zona va desde el nombre hasta
     * su punto (más un margen), para no dejar un hueco entre los dos al subir en diagonal.
     */
    const overTooltip = (e: MouseEvent): boolean => {
      const el = map.hasLayer(tip) ? tip.getElement() : null;
      const s = hovered.current;
      if (!el || !s) return false;
      const r = el.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      const dotY = c.top + map.latLngToContainerPoint([s.lat, s.lon]).y;
      return (
        e.clientX >= r.left - TIP_MARGIN &&
        e.clientX <= r.right + TIP_MARGIN &&
        e.clientY >= r.top - TIP_MARGIN &&
        e.clientY <= Math.max(r.bottom, dotY) + TIP_MARGIN
      );
    };

    let hideTimer = 0;
    const show = (s: Stop | null) => {
      if (s) {
        clearTimeout(hideTimer);
        hideTimer = 0;
        if (s === hovered.current) return;
        hovered.current = s;
        tip.setLatLng([s.lat, s.lon]).setContent(s.name).addTo(map);
      } else if (hovered.current && !hideTimer) {
        hideTimer = window.setTimeout(() => {
          hideTimer = 0;
          hovered.current = null;
          tip.remove();
        }, TIP_HIDE_MS);
      }
    };
    const hideNow = () => {
      clearTimeout(hideTimer);
      hideTimer = 0;
      hovered.current = null;
      tip.remove();
    };

    let frame = 0;
    const onMove = (ev: L.LeafletMouseEvent) => {
      const e = ev.originalEvent;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const s = nearest(ev.containerPoint, HIT_MOUSE);
        // Sin punto cerca, el nombre que ya está a la vista se mantiene mientras el ratón esté encima.
        const keep = !s && hovered.current && overTooltip(e) ? hovered.current : s;
        show(keep);
        container.style.cursor = keep ? 'pointer' : '';
      });
    };

    const onClick = (ev: L.LeafletMouseEvent) => {
      const s = nearest(ev.containerPoint, coarse.matches ? HIT_TOUCH : HIT_MOUSE);
      if (s) return onSelectRef.current(s);
      if (hovered.current && overTooltip(ev.originalEvent)) onSelectRef.current(hovered.current);
    };

    // Clic sobre el nombre: si debajo hay un punto, gana el punto; si no, la estación del nombre.
    const onTipClick = (e: MouseEvent) => {
      L.DomEvent.stop(e); // que no llegue también al mapa (abriría dos veces)
      const s = nearest(map.mouseEventToContainerPoint(e), coarse.matches ? HIT_TOUCH : HIT_MOUSE);
      const pick = s ?? hovered.current;
      if (pick) onSelectRef.current(pick);
    };
    // El elemento del nombre se crea la primera vez que se muestra; se engancha entonces.
    const onTipOpen = () => {
      const el = tip.getElement();
      if (!el || (el as HTMLElement & { _hits?: boolean })._hits) return;
      (el as HTMLElement & { _hits?: boolean })._hits = true;
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.on(el, 'click', onTipClick as L.DomEvent.EventHandlerFn);
    };
    tip.on('add', onTipOpen);

    const onOut = () => {
      hideNow();
      container.style.cursor = '';
    };

    map.on('mousemove', onMove);
    map.on('click', onClick);
    map.on('mouseout movestart zoomstart', onOut);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hideTimer);
      map.off('mousemove', onMove);
      map.off('click', onClick);
      map.off('mouseout movestart zoomstart', onOut);
      tip.off('add', onTipOpen);
      const el = tip.getElement();
      if (el) L.DomEvent.off(el, 'click', onTipClick as L.DomEvent.EventHandlerFn);
      tip.remove();
    };
  }, [map]);

  // Si cambia la lista (p. ej. al llegar del servidor), el nombre mostrado puede ser de otra copia.
  useEffect(() => {
    hovered.current = null;
    tooltip.current?.remove();
  }, [stops]);

  return null;
}

function RouteLine({ path, color }: { path: [number, number][]; color: string }) {
  return (
    <>
      <Polyline positions={path} interactive={false} pathOptions={{ color: '#fff', weight: 8, opacity: 0.9 }} />
      <Polyline positions={path} interactive={false} pathOptions={{ color: `#${color}`, weight: 5, opacity: 1 }} />
    </>
  );
}

function LocateButton({ onLocated }: { onLocated: (lat: number, lon: number) => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const locate = () => {
    if (!('geolocation' in navigator)) return setState('error');
    setState('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState('idle');
        onLocated(pos.coords.latitude, pos.coords.longitude);
      },
      () => setState('error'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };
  return (
    <button
      className={`locate-btn ${state}`}
      onClick={locate}
      title={state === 'error' ? 'No se pudo obtener tu ubicación' : 'Mi ubicación'}
      aria-label="Centrar en mi ubicación"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </button>
  );
}

export function MapView({ stops, selectedId, favoriteIds, focus, onSelect, train, route }: Props) {
  const selectedStop = useMemo(() => stops.find((s) => s.id === selectedId), [stops, selectedId]);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [locFocus, setLocFocus] = useState<Props['focus']>(null);
  const [view] = useState(initialView);

  return (
    <div className="map-wrap">
      <MapContainer center={view.center} zoom={view.zoom} preferCanvas zoomControl={false} className="map">
        <TileLayer
          // Renfe exige citar la fuente ("Origen de los datos: Renfe Operadora") en sus datos abiertos.
          attribution='Origen de los datos: <a href="https://data.renfe.com/" target="_blank" rel="noopener">Renfe Operadora</a> · &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="/privacidad.html" target="_blank" rel="noopener">Privacidad</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {stops.map((s) => {
          const selected = s.id === selectedId;
          const fav = favoriteIds.includes(s.id);
          return (
            <CircleMarker
              key={s.id}
              center={[s.lat, s.lon]}
              radius={selected ? 10 : fav ? 7 : 5.5}
              pathOptions={{
                color: selected ? '#111' : '#fff',
                weight: selected ? 3 : 1.5,
                fillColor: `#${s.lines[0]?.color ?? '8a0b3a'}`,
                fillOpacity: 1,
              }}
              // Los clics y el nombre los gestiona StopHits, con un área mayor que el punto.
              interactive={false}
            />
          );
        })}
        {userPos && (
          <CircleMarker
            center={userPos}
            radius={8}
            interactive={false}
            pathOptions={{ color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
          />
        )}
        {route && (
          // Por debajo de las paradas (overlayPane = 400) para que se vean encima de la vía.
          <Pane name="route" style={{ zIndex: 390 }}>
            <RouteLine path={aheadOf(route.path, train)} color={route.color} />
          </Pane>
        )}
        {train && <TrainMarker key={train.tripId} train={train} />}
        <StopHits stops={stops} onSelect={onSelect} />
        <FitTrain train={train} stop={selectedStop} />
        <FlyTo focus={focus} />
        <FlyTo focus={locFocus} />
        <RememberView />
      </MapContainer>
      <LocateButton
        onLocated={(lat, lon) => {
          setUserPos([lat, lon]);
          setLocFocus({ lat, lon, zoom: 14, key: Date.now() });
        }}
      />
    </div>
  );
}
