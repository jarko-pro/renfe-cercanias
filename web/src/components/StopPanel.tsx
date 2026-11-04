import type { Arrival, ArrivalsResponse, Stop } from '@renfe/shared';
import { useEffect, useState } from 'react';
import { fetchArrivals } from '../lib/api';
import { formatTime } from '../lib/text';
import { LineChip } from './LineChip';

const REFRESH_MS = 30_000;

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
          {a.terminates && <span className="badge muted">Final de trayecto</span>}
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

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    let ctrl = new AbortController();

    const load = async () => {
      ctrl.abort();
      ctrl = new AbortController();
      try {
        const res = await fetchArrivals(stop.id, ctrl.signal);
        setData(res);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    };

    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ctrl.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [stop.id]);

  return (
    <section className="panel" aria-label={`Próximos trenes en ${stop.name}`}>
      <header className="panel-header">
        <div className="panel-title">
          <h2>{stop.name}</h2>
          <div className="panel-meta">
            <span>{stop.network}</span>
            <span className="chips">
              {stop.lines.map((l) => (
                <LineChip key={l.name} line={l} small />
              ))}
            </span>
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
        {loading && !data && <p className="placeholder">Cargando próximos trenes…</p>}
        {error && !data && <p className="placeholder error">{error}</p>}
        {data && data.arrivals.length === 0 && (
          <p className="placeholder">No hay trenes previstos en los próximos 90 minutos.</p>
        )}
        {data && data.arrivals.length > 0 && (
          <ul className="arrivals">
            {data.arrivals.map((a) => (
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
