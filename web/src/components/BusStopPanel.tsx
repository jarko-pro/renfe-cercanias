import { busFeedInfo, type BusArrivalsResponse, type BusLineArrivals, type BusStop } from '@renfe/shared';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, fetchBusArrivals, isAbort } from '../lib/api';
import { formatTime } from '../lib/text';
import { LineChip } from './LineChip';

const REFRESH_MS = 30_000;
const RETRY_MS = 4_000;
/** Sin una respuesta buena en este tiempo, la lista se da por vieja y se pinta en gris. */
const STALE_MS = 90_000;
const TICK_MS = 5_000;
/** Un bus sale de la lista 30 s después de su hora estimada. */
const HIDE_AFTER_MS = 30_000;

interface Props {
  stop: BusStop;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
}

/** 0 = llegando (a menos de 30 s); si no, minutos redondeados. Mismo criterio que en los trenes. */
function minutesUntil(estimatedMs: number, nowMs: number): number {
  const secs = (estimatedMs - nowMs) / 1000;
  return secs <= 30 ? 0 : Math.max(1, Math.round(secs / 60));
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "a 350 m", "a 1,2 km". */
function distanceText(m: number): string {
  if (m < 1000) return `a ${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `a ${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

function BusRow({ g, now }: { g: BusLineArrivals; now: number }) {
  const [first, second] = g.next;
  const minutes = minutesUntil(first.estimated, now);
  const sub = [
    first.distanceM != null && minutes > 0 ? distanceText(first.distanceM) : null,
    second ? `siguiente en ${minutesUntil(second.estimated, now)} min` : null,
  ].filter(Boolean);
  return (
    <li className="arrival bus-row">
      <LineChip line={g.line} />
      <span className="arrival-main">
        <span className="headsign">{g.headsign}</span>
        {sub.length > 0 && <span className="arrival-sub">{sub.join(' · ')}</span>}
      </span>
      <span className="eta">
        {minutes === 0 ? (
          <span className="now">Llegando</span>
        ) : (
          <>
            <strong>{minutes}</strong>
            <span>min</span>
          </>
        )}
      </span>
    </li>
  );
}

export function BusStopPanel({ stop, isFavorite, onToggleFavorite, onClose }: Props) {
  const [data, setData] = useState<BusArrivalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);
  const feed = busFeedInfo(stop.feed);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    let ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Tras un fallo se reintenta enseguida (el servidor puede estar despertando);
    // si va bien, se refresca cada 30 s.
    const load = async () => {
      clearTimeout(timer);
      ctrl.abort();
      ctrl = new AbortController();
      let next = REFRESH_MS;
      try {
        const res = await fetchBusArrivals(stop.feed, stop.code, ctrl.signal);
        setData(res);
        setReceivedAt(Date.now());
        setError(null);
        setWaking(false);
      } catch (e) {
        if (isAbort(e)) return;
        setError((e as Error).message);
        setWaking(e instanceof ApiError && e.unavailable);
        next = RETRY_MS;
      } finally {
        setLoading(false);
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
  }, [stop.id]);

  const now = useNow(TICK_MS);
  const stale = !!data && now - receivedAt > STALE_MS;
  // Quita en vivo los buses que ya han pasado, sin esperar al siguiente refresco.
  const lines = useMemo(
    () =>
      (data?.lines ?? [])
        .map((g) => ({ ...g, next: g.next.filter((n) => n.estimated >= now - HIDE_AFTER_MS) }))
        .filter((g) => g.next.length > 0)
        .sort((a, b) => a.next[0].estimated - b.next[0].estimated),
    [data, now],
  );
  const idle = data?.idle ?? [];

  return (
    <section className="panel bus-panel" aria-label={`Próximos autobuses en ${stop.name}`}>
      <header className="panel-header">
        <div className="panel-title">
          <h2>{stop.name}</h2>
          <div className="panel-meta">
            <span>{[`Parada ${stop.code}`, stop.towards && `hacia ${stop.towards}`, feed?.city].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <button
          className={`icon-btn star${isFavorite ? ' on' : ''}`}
          onClick={onToggleFavorite}
          aria-pressed={isFavorite}
          title={isFavorite ? 'Quitar de favoritas' : 'Añadir a favoritas'}
        >
          {isFavorite ? '★' : '☆'}
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar" title="Cerrar">
          ✕
        </button>
      </header>

      <div className="panel-body">
        {!data && (loading || waking) && (
          <p className="placeholder">
            {waking ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Despertando el servidor… puede tardar hasta un minuto. Se actualizará solo.
              </>
            ) : (
              'Cargando próximos autobuses…'
            )}
          </p>
        )}
        {error && !data && !waking && !loading && <p className="placeholder error">{error} · reintentando…</p>}
        {data && lines.length === 0 && <p className="placeholder">Ahora mismo no viene ningún autobús a esta parada.</p>}
        {data && lines.length > 0 && (
          <ul className={`arrivals${stale ? ' stale' : ''}`}>
            {lines.map((g) => (
              <BusRow key={`${g.line.name}|${g.headsign}`} g={g} now={now} />
            ))}
          </ul>
        )}
        {data && idle.length > 0 && (
          <div className="bus-idle" title="Líneas que paran aquí pero no tienen ahora ningún autobús en camino">
            <span>Sin autobuses ahora:</span>
            {idle.map((l) => (
              <LineChip key={l.name} line={l} small />
            ))}
          </div>
        )}
      </div>

      {data && (
        <footer className={`panel-footer${stale ? ' stale' : ''}`}>
          {stale ? 'Sin datos nuevos desde las ' : 'Actualizado a las '}
          {formatTime(data.generatedAt)}
          {error && ' · sin conexión, reintentando'}
          {feed && ` · Datos: ${feed.source}`}
        </footer>
      )}
    </section>
  );
}
