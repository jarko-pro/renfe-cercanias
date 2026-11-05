import type { Arrival, ArrivalsResponse, Stop, StopAlert, TripLive } from '@renfe/shared';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, fetchArrivals, isAbort } from '../lib/api';
import { formatTime } from '../lib/text';
import { LineChip } from './LineChip';

const REFRESH_MS = 30_000;
const RETRY_MS = 4_000;
const MAX_ROWS = 12;

type Tab = 'departures' | 'arrivals';

interface Props {
  stop: Stop;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  /** Tren que se sigue en el mapa; `live` es null mientras se localiza. */
  tracked: { tripId: string; live: TripLive | null } | null;
  /** Empieza a seguir un tren, o deja de seguirlo si ya se seguía (null = dejar de seguir). */
  onTrack: (a: Arrival | null) => void;
}

/** Cada cuánto se recalcula la cuenta atrás en pantalla. */
const TICK_MS = 5_000;
/** El tren sale de la lista 30 s después de su hora estimada. */
const HIDE_AFTER_MS = 30_000;

/** 0 = "Ahora" (a menos de 30 s); si no, minutos redondeados. Mismo criterio que el servidor. */
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

/** "https://www.renfe.com/es/..." → "renfe.com": las URL completas no caben en el panel. */
function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www|grupo)\./, '');
  } catch {
    return 'enlace';
  }
}

/** Texto con los enlaces (https://...) clicables. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+[^\s.,;:)])/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer">
            {linkLabel(p)} ↗
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

function AlertList({ alerts }: { alerts: StopAlert[] }) {
  return (
    <ul className="alerts">
      {alerts.map((a) => (
        <li key={a.id} className={`alert${a.severe ? ' severe' : ''}`}>
          <span className="alert-icon" aria-hidden="true">
            {a.kind === 'access' ? '♿' : '⚠'}
          </span>
          <span className="alert-body">
            {a.lines.length > 0 && (
              <span className="alert-lines">
                {a.lines.map((l) => (
                  <LineChip key={l.name} line={l} small />
                ))}
              </span>
            )}
            <Linkified text={a.text} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Dónde está el tren seguido, en pocas palabras. */
function whereText(live: TripLive | null | undefined): string {
  if (!live) return 'Localizando el tren…';
  // Renfe no publica algunos trenes (p. ej. antes de salir de origen): no se inventa el motivo.
  if (!live.position) return 'Sin posición en directo';
  if (!live.stopName) return 'En camino';
  if (live.status === 'stopped') return `En ${live.stopName}`;
  if (live.status === 'incoming') return `Llegando a ${live.stopName}`;
  // En marcha, Renfe da la parada que acaba de dejar; la siguiente la calcula el servidor.
  return live.nextStopName ? `Entre ${live.stopName} y ${live.nextStopName}` : `Saliendo de ${live.stopName}`;
}

interface RowProps {
  a: Arrival;
  now: number;
  /** undefined = no se sigue este tren; null = se sigue pero aún no hay posición. */
  live: TripLive | null | undefined;
  onTrack: (a: Arrival) => void;
}

function ArrivalRow({ a, now, live, onTrack }: RowProps) {
  const delayMin = a.delaySec != null ? Math.round(a.delaySec / 60) : 0;
  const minutes = minutesUntil(a.estimated, now);
  const following = live !== undefined;
  // En cabeceras el tren espera en el andén varios minutos: ahí manda la cuenta atrás.
  const atPlatform = a.vehicleStatus === 'at_platform';
  const eta = a.cancelled
    ? '—'
    : atPlatform && minutes <= 1
      ? 'En andén'
      : a.vehicleStatus === 'arriving' && minutes <= 2
        ? 'Entrando'
        : minutes === 0
          ? // Sin datos de Renfe no se puede afirmar que el tren esté llegando.
            a.unconfirmed
            ? '—'
            : 'Ahora'
          : null;
  const platformText = a.platform
    ? `${atPlatform ? 'En vía' : 'Vía'} ${a.platform}`
    : atPlatform && eta == null
      ? 'En andén'
      : null;
  // Dentro de un <button> solo vale contenido "en línea": spans con display por CSS.
  return (
    <li className="arrival-item">
      <button
        type="button"
        className={`arrival${a.cancelled ? ' cancelled' : ''}${following ? ' following' : ''}`}
        // Solo se pueden seguir los trenes de los que Renfe publica la posición.
        disabled={a.cancelled || (!a.hasPosition && !following)}
        aria-pressed={following}
        title={
          following ? 'Dejar de seguir este tren' : a.hasPosition ? 'Ver este tren en directo en el mapa' : undefined
        }
        onClick={() => onTrack(a)}
      >
        <LineChip line={a.line} />
        <span className="arrival-main">
          <span className="headsign">{a.headsign || 'Destino desconocido'}</span>
          <span className="arrival-sub">
            {a.cancelled ? (
              <span className="badge danger">Cancelado</span>
            ) : a.realtime ? (
              <span className="badge live" title="Dato en tiempo real">
                <span className="dot" />
                {delayMin > 0 ? `+${delayMin} min` : 'En hora'}
              </span>
            ) : a.unconfirmed ? (
              <span
                className="badge warn"
                title="Renfe no da datos en tiempo real de este tren: puede ir con retraso o estar cancelado"
              >
                Sin confirmar
              </span>
            ) : (
              <span className="badge muted" title="Sin datos en tiempo real: horario programado">
                Programado
              </span>
            )}
            {following ? (
              <span className="where">{whereText(live)}</span>
            ) : (
              <span className="sched">
                {delayMin > 0 && !a.cancelled ? (
                  <>
                    <s>{formatTime(a.scheduled)}</s> {formatTime(a.estimated)}
                  </>
                ) : (
                  formatTime(a.scheduled)
                )}
              </span>
            )}
            {platformText && !a.cancelled && <span className="badge platform">{platformText}</span>}
            {(a.hasPosition || following) && !a.cancelled && (
              <svg className="live-pin" viewBox="0 0 24 24" width="15" height="15" aria-label="Se puede ver en directo">
                <path
                  fill="currentColor"
                  d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"
                />
              </svg>
            )}
          </span>
        </span>
        <span className={`eta${a.unconfirmed ? ' unsure' : ''}`}>
          {eta != null ? (
            <span className={eta === '—' ? undefined : 'now'}>{eta}</span>
          ) : (
            <>
              <strong>{minutes}</strong>
              <span>min</span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}

export function StopPanel({ stop, isFavorite, onToggleFavorite, onClose, tracked, onTrack }: Props) {
  const [data, setData] = useState<ArrivalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);
  const [tab, setTab] = useState<Tab>('departures');
  const [lineFilter, setLineFilter] = useState<string[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    setTab('departures');
    setLineFilter([]);
    setShowAlerts(false);
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
        const res = await fetchArrivals(stop.id, ctrl.signal);
        setData(res);
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
  // Quita en vivo los trenes que ya han pasado, sin esperar al siguiente refresco.
  const all = useMemo(
    () => (data?.arrivals ?? []).filter((a) => a.estimated >= now - HIDE_AFTER_MS),
    [data, now],
  );
  // Si el tren seguido ya ha pasado y sale de la lista, se deja de seguir.
  const trackedGone = !!tracked && !!data && !all.some((a) => a.tripId === tracked.tripId);
  useEffect(() => {
    if (trackedGone) onTrack(null);
  }, [trackedGone, onTrack]);

  const byLine = useMemo(
    () => (lineFilter.length ? all.filter((a) => lineFilter.includes(a.line.name)) : all),
    [all, lineFilter],
  );
  const departures = byLine.filter((a) => !a.terminates);
  const arrivals = byLine.filter((a) => a.terminates);
  // Pestañas solo donde terminan trenes (estaciones finales); en las intermedias no aportan.
  const showTabs = all.some((a) => a.terminates);
  const visible = (showTabs && tab === 'arrivals' ? arrivals : showTabs ? departures : byLine).slice(0, MAX_ROWS);

  const alerts = data?.alerts ?? [];
  // Franja arriba solo para lo grave que afecta a esta estación; lo demás, detrás del botón.
  const banner = alerts.find((a) => a.severe && a.here);
  const onlyAccess = alerts.length > 0 && alerts.every((a) => a.kind === 'access');

  const toggleLine = (name: string) =>
    setLineFilter((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const emptyText = lineFilter.length
    ? `No hay trenes de ${lineFilter.join(', ')} en los próximos 90 minutos.`
    : showTabs && tab === 'arrivals'
      ? 'No llega ningún tren que termine aquí en los próximos 90 minutos.'
      : 'No hay trenes previstos en los próximos 90 minutos.';

  return (
    <section className="panel" aria-label={`Próximos trenes en ${stop.name}`}>
      <header className="panel-header">
        <div className="panel-title">
          <h2>{stop.name}</h2>
          <div className="panel-meta">
            <span>{stop.network}</span>
            {stop.lines.length === 1 && <LineChip line={stop.lines[0]} small />}
            {alerts.length > 0 && (
              <button
                className={`alerts-toggle${showAlerts ? ' on' : ''}`}
                aria-expanded={showAlerts}
                onClick={() => setShowAlerts((v) => !v)}
              >
                {onlyAccess ? '♿' : '⚠'} {alerts.length} {alerts.length === 1 ? 'aviso' : 'avisos'}
              </button>
            )}
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

      {banner && !showAlerts && (
        <button className="alert-banner" onClick={() => setShowAlerts(true)} title="Ver avisos">
          <span aria-hidden="true">⚠</span>
          <span className="alert-banner-text">{banner.text}</span>
        </button>
      )}

      <div className="panel-controls">
        {stop.lines.length > 1 && (
          <div className="line-filter" role="group" aria-label="Filtrar por línea">
            {stop.lines.map((l) => {
              const on = lineFilter.includes(l.name);
              return (
                <button
                  key={l.name}
                  className={`line-toggle${on ? ' on' : ''}${lineFilter.length && !on ? ' dim' : ''}`}
                  aria-pressed={on}
                  title={on ? `Quitar filtro ${l.name}` : `Ver solo ${l.name}`}
                  onClick={() => toggleLine(l.name)}
                >
                  <LineChip line={l} />
                </button>
              );
            })}
            {lineFilter.length > 0 && (
              <button className="clear-filter" onClick={() => setLineFilter([])}>
                Todas
              </button>
            )}
          </div>
        )}
        {showTabs && (
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'departures'} onClick={() => setTab('departures')}>
              Salidas <span className="count">{departures.length}</span>
            </button>
            <button role="tab" aria-selected={tab === 'arrivals'} onClick={() => setTab('arrivals')}>
              Llegadas <span className="count">{arrivals.length}</span>
            </button>
          </div>
        )}
      </div>

      <div className="panel-body">
        {!data && (loading || waking) && (
          <p className="placeholder">
            {waking ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Despertando el servidor… puede tardar hasta un minuto. Se actualizará solo.
              </>
            ) : (
              'Cargando próximos trenes…'
            )}
          </p>
        )}
        {showAlerts && <AlertList alerts={alerts} />}
        {error && !data && !waking && !loading && <p className="placeholder error">{error} · reintentando…</p>}
        {data && visible.length === 0 && <p className="placeholder">{emptyText}</p>}
        {data && visible.length > 0 && (
          <ul className="arrivals">
            {visible.map((a) => (
              <ArrivalRow
                key={`${a.tripId}-${a.scheduled}`}
                a={a}
                now={now}
                live={tracked?.tripId === a.tripId ? tracked.live : undefined}
                onTrack={onTrack}
              />
            ))}
          </ul>
        )}
      </div>

      {data && (
        <footer className="panel-footer">
          Actualizado a las {formatTime(data.generatedAt)}
          {error && ' · sin conexión, reintentando'}
        </footer>
      )}
    </section>
  );
}
