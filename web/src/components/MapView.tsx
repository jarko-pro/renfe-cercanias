import type { Stop } from '@renfe/shared';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Pane, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';

export interface TrainPosition {
  tripId: string;
  lat: number;
  lon: number;
  /** Color de la línea, hex sin '#'. */
  color: string;
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
        className: 'train-marker',
        html: `<span style="--line:#${train.color}">${TRAIN_SVG}</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
    [train.color],
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
        paddingBottomRight: mobile ? [40, window.innerHeight * 0.58 + 40] : [40, 40],
        maxZoom: 15,
        duration: 0.8,
      },
    );
  }, [train, stop, map]);
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

  return (
    <div className="map-wrap">
      <MapContainer center={SPAIN} zoom={6} preferCanvas zoomControl={false} className="map">
        <TileLayer
          // Renfe exige citar la fuente ("Origen de los datos: Renfe Operadora") en sus datos abiertos.
          attribution='Origen de los datos: <a href="https://data.renfe.com/" target="_blank" rel="noopener">Renfe Operadora</a> · &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
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
              eventHandlers={{ click: () => onSelect(s) }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                {s.name}
              </Tooltip>
            </CircleMarker>
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
        <FitTrain train={train} stop={selectedStop} />
        <FlyTo focus={focus} />
        <FlyTo focus={locFocus} />
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
