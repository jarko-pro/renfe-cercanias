import type { Stop, StopTimetable, TripTimes } from '@renfe/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchTimetable, fetchTripTimes, isAbort } from '../lib/api';
import { LineChip } from './LineChip';

type Day = 0 | 1;

interface Props {
  stop: Stop;
  /** Línea con la que abrir (la del filtro del panel, si había una). */
  initialLine?: string;
  onBack: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Segundos del día de servicio → "HH:MM" (las 24:30 son las 00:30). */
const hhmm = (t: number) => `${pad(Math.floor(t / 3600) % 24)}:${pad(Math.floor(t / 60) % 60)}`;

const dateFmt = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Madrid',
});

/**
 * Horario programado de todo el día en una estación, como el cartel de cada línea: una fila
 * por hora con las horas de paso completas (HH:MM). Tocar una abre el recorrido de ese tren.
 */
export function Timetable({ stop, initialLine, onBack }: Props) {
  const [day, setDay] = useState<Day>(0);
  const [cache, setCache] = useState<Partial<Record<Day, StopTimetable>>>({});
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [lineName, setLineName] = useState<string | undefined>(initialLine);
  const [dirIdx, setDirIdx] = useState(0);
  const [tripId, setTripId] = useState<string | null>(null);
  // Solo la primera vez: si hoy ya no queda ningún tren, se abre directamente mañana.
  const decided = useRef(false);

  const data = cache[day];

  useEffect(() => {
    if (cache[day]) return;
    const ctrl = new AbortController();
    setError(null);
    fetchTimetable(stop.id, day, ctrl.signal)
      .then((res) => {
        setCache((c) => ({ ...c, [day]: res }));
        if (day === 0 && !decided.current) {
          decided.current = true;
          const nowSec = (Date.now() - res.base) / 1000;
          const anyLeft = res.groups.some((g) => g.trains.some((t) => t.t >= nowSec));
          if (!anyLeft) setDay(1);
        }
      })
      .catch((e) => !isAbort(e) && setError((e as Error).message));
    return () => ctrl.abort();
  }, [stop.id, day, cache, retry]);

  const lines = useMemo(() => {
    const seen = new Map<string, StopTimetable['groups'][number]['line']>();
    for (const g of data?.groups ?? []) if (!seen.has(g.line.name)) seen.set(g.line.name, g.line);
    return [...seen.values()];
  }, [data]);
  const line = lines.find((l) => l.name === lineName) ?? lines[0];
  const dirs = useMemo(() => (data?.groups ?? []).filter((g) => g.line.name === line?.name), [data, line]);
  const group = dirs[Math.min(dirIdx, dirs.length - 1)];

  const now = Date.now();
  const nowSec = data ? (now - data.base) / 1000 : -Infinity;
  // Solo hoy: los que ya han pasado en gris y el próximo resaltado (-1: ya no queda ninguno).
  const today = day === 0;
  const nextIdx = today && group ? group.trains.findIndex((t) => t.t >= nowSec - 30) : -1;

  const hours = useMemo(() => {
    const out: { h: number; trains: { tripId: string; t: number; mark?: string; i: number }[] }[] = [];
    group?.trains.forEach((tr, i) => {
      const h = Math.floor(tr.t / 3600);
      if (out[out.length - 1]?.h !== h) out.push({ h, trains: [] });
      out[out.length - 1].trains.push({ ...tr, i });
    });
    return out;
  }, [group]);

  // Al abrir o cambiar de línea/sentido/día: la hora del próximo tren arriba del todo.
  const bodyRef = useRef<HTMLDivElement>(null);
  const groupKey = `${day}|${line?.name}|${group?.headsign}`;
  // Al volver del recorrido de un tren, donde se estaba.
  const savedScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (savedScroll.current != null) {
      body.scrollTop = savedScroll.current;
      savedScroll.current = null;
      return;
    }
    const row = body.querySelector<HTMLElement>('.tt-hour.current');
    body.scrollTop = row ? row.offsetTop - 4 : 0;
  }, [groupKey, !!data, !!tripId]);

  const openTrip = (id: string) => {
    savedScroll.current = bodyRef.current?.scrollTop ?? null;
    setTripId(id);
  };

  const pickLine = (name: string) => {
    setLineName(name);
    setDirIdx(0);
  };

  if (tripId && data) {
    return <TripView tripId={tripId} stopId={stop.id} onBack={() => setTripId(null)} />;
  }

  return (
    <>
      <div className="panel-controls">
        <div className="tt-top">
          <button className="tt-back" onClick={onBack}>
            <span aria-hidden="true">‹</span> Próximos trenes
          </button>
          <div className="tabs tt-days" role="tablist" aria-label="Día">
            <button role="tab" aria-selected={day === 0} onClick={() => setDay(0)}>
              Hoy
            </button>
            <button role="tab" aria-selected={day === 1} onClick={() => setDay(1)}>
              Mañana
            </button>
          </div>
        </div>
        {lines.length > 1 && (
          <div className="line-filter" role="group" aria-label="Línea">
            {lines.map((l) => {
              const on = l.name === line?.name;
              return (
                <button
                  key={l.name}
                  className={`line-toggle${on ? ' on' : ' dim'}`}
                  aria-pressed={on}
                  onClick={() => pickLine(l.name)}
                >
                  <LineChip line={l} />
                </button>
              );
            })}
          </div>
        )}
        {dirs.length > 1 ? (
          <div className="tabs tt-dirs" role="tablist" aria-label="Sentido">
            {dirs.map((g, i) => (
              <button
                key={`${g.headsign}-${i}`}
                role="tab"
                aria-selected={g === group}
                onClick={() => setDirIdx(i)}
                title={`Hacia ${g.headsign}`}
              >
                → {g.headsign}
              </button>
            ))}
          </div>
        ) : (
          group && (
            <p className="tt-dir">
              {lines.length <= 1 && line && <LineChip line={line} small />} Hacia <strong>{group.headsign}</strong>
            </p>
          )
        )}
      </div>

      <div className="panel-body tt-body" ref={bodyRef}>
        {!data && !error && <p className="placeholder">Cargando horario…</p>}
        {error && !data && (
          <p className="placeholder error">
            {error} ·{' '}
            <button className="clear-filter" onClick={() => setRetry((n) => n + 1)}>
              Reintentar
            </button>
          </p>
        )}
        {data && !group && (
          <p className="placeholder">{day === 0 ? 'Hoy' : 'Mañana'} no sale ningún tren de esta estación.</p>
        )}
        {group && (
          <>
            <ol className="tt-hours">
              {hours.map(({ h, trains }) => {
                const current = nextIdx >= 0 && trains.some((t) => t.i === nextIdx);
                return (
                  <li key={h} className={`tt-hour${current ? ' current' : ''}`}>
                    <span className="tt-mins">
                      {trains.map((t) => (
                        <button
                          key={t.tripId}
                          className={`tt-min${today && (nextIdx < 0 || t.i < nextIdx) ? ' past' : ''}${t.i === nextIdx ? ' next' : ''}`}
                          title="Ver recorrido"
                          onClick={() => openTrip(t.tripId)}
                        >
                          {hhmm(t.t)}
                          {t.mark && <sup>{t.mark}</sup>}
                        </button>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ol>
            {group.notes.length > 0 && (
              <ul className="tt-notes">
                {group.notes.map((n) => (
                  <li key={n.mark}>
                    <sup>{n.mark}</sup> Va a {n.headsign}
                  </li>
                ))}
              </ul>
            )}
            <p className="tt-hint">Toca una hora para ver el recorrido del tren.</p>
          </>
        )}
      </div>

      {data && (
        <footer className="panel-footer">Horario programado · {dateFmt.format(data.base + 12 * 3600_000)}</footer>
      )}
    </>
  );
}

function TripView({ tripId, stopId, onBack }: { tripId: string; stopId: string; onBack: () => void }) {
  const [trip, setTrip] = useState<TripTimes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchTripTimes(tripId, ctrl.signal)
      .then(setTrip)
      .catch((e) => !isAbort(e) && setError((e as Error).message));
    return () => ctrl.abort();
  }, [tripId]);

  const hereIdx = trip?.stops.findIndex((s) => s.stopId === stopId) ?? -1;
  const hereRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    hereRef.current?.scrollIntoView({ block: 'center' });
  }, [trip]);

  return (
    <>
      <div className="panel-controls">
        <div className="tt-top">
          <button className="tt-back" onClick={onBack}>
            <span aria-hidden="true">‹</span> Horario
          </button>
        </div>
        {trip && (
          <p className="tt-dir">
            <LineChip line={trip.line} small /> Hacia <strong>{trip.headsign}</strong>
            {trip.trainNumber && <span className="train-no"> · Tren {trip.trainNumber}</span>}
          </p>
        )}
      </div>
      <div className="panel-body">
        {!trip && !error && <p className="placeholder">Cargando recorrido…</p>}
        {error && !trip && <p className="placeholder error">{error}</p>}
        {trip && (
          <ol className="tt-trip" style={{ ['--line' as string]: `#${trip.line.color}` }}>
            {trip.stops.map((s, i) => (
              <li
                key={`${s.stopId}-${i}`}
                ref={i === hereIdx ? hereRef : undefined}
                className={i === hereIdx ? 'here' : hereIdx >= 0 && i < hereIdx ? 'before' : undefined}
              >
                <span className="tt-time">{hhmm(s.t)}</span>
                <span className="tt-dot" aria-hidden="true" />
                <span className="tt-stop">{s.name}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <footer className="panel-footer">Horas programadas: en directo pueden variar.</footer>
    </>
  );
}
