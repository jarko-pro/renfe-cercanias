import type { Arrival, ArrivalsResponse, Stop } from '@renfe/shared';
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
}

function ArrivalRow({ a }: { a: Arrival }) {
  const delayMin = a.delaySec != null ? Math.round(a.delaySec / 60) : 0;
  return (
    <li className={`arrival${a.cancelled ? ' cancelled' : ''}`}>
      <LineChip line={a.line} />
      <div className="arrival-main">
        <div className="headsign">{a.headsign || 'Destino desconocido'}</div>
        <div className="arrival-sub">
          {a.cancelled ? (
            <span className="badge danger">Cancelado</span>
          ) : a.realtime ? (
            <span className="badge live" title="Dato en tiempo real">
              <span className="dot" />
              {delayMin > 0 ? `+${delayMin} min` : 'En hora'}
            </span>
          ) : (
            <span className="badge muted" title="Sin datos en tiempo real: horario programado">
              Programado
            </span>
          )}
          <span className="sched">
            {delayMin > 0 && !a.cancelled ? (
              <>
                <s>{formatTime(a.scheduled)}</s> {formatTime(a.estimated)}
              </>
            ) : (
              formatTime(a.scheduled)
            )}
          </span>
        </div>
      </div>
      <div className="eta" aria-label={`${a.minutes} minutos`}>
        {a.cancelled ? '—' : a.minutes === 0 ? <span className="now">Ahora</span> : (
          <>
            <strong>{a.minutes}</strong>
            <span>min</span>
          </>
        )}
      </div>
    </li>
  );
}

export function StopPanel({ stop, isFavorite, onToggleFavorite, onClose }: Props) {
  const [data, setData] = useState<ArrivalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);
  const [tab, setTab] = useState<Tab>('departures');
  const [lineFilter, setLineFilter] = useState<string[]>([]);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    setTab('departures');
    setLineFilter([]);
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

  const all = data?.arrivals ?? [];
  const byLine = useMemo(
    () => (lineFilter.length ? all.filter((a) => lineFilter.includes(a.line.name)) : all),
    [all, lineFilter],
  );
  const departures = byLine.filter((a) => !a.terminates);
  const arrivals = byLine.filter((a) => a.terminates);
  // Pestañas solo donde terminan trenes (estaciones finales); en las intermedias no aportan.
  const showTabs = all.some((a) => a.terminates);
  const visible = (showTabs && tab === 'arrivals' ? arrivals : showTabs ? departures : byLine).slice(0, MAX_ROWS);

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
        {error && !data && !waking && !loading && <p className="placeholder error">{error} · reintentando…</p>}
        {data && visible.length === 0 && <p className="placeholder">{emptyText}</p>}
        {data && visible.length > 0 && (
          <ul className="arrivals">
            {visible.map((a) => (
              <ArrivalRow key={`${a.tripId}-${a.scheduled}`} a={a} />
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
