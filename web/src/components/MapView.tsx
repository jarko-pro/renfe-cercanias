import type { Stop } from '@renfe/shared';
import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';

interface Props {
  stops: Stop[];
  selectedId: string | null;
  favoriteIds: string[];
  /** Parada a la que volar (cambia la referencia para volver a centrar). */
  focus: { lat: number; lon: number; zoom?: number; key: number } | null;
  onSelect: (stop: Stop) => void;
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

export function MapView({ stops, selectedId, favoriteIds, focus, onSelect }: Props) {
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [locFocus, setLocFocus] = useState<Props['focus']>(null);

  return (
    <div className="map-wrap">
      <MapContainer center={SPAIN} zoom={6} preferCanvas zoomControl={false} className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
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
