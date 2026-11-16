import type { Passed, Stop, StopTimetable, TripTimes } from '@renfe/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchTimetable, fetchTripTimes, isAbort } from '../lib/api';
import { delayClass } from '../lib/text';
import { LineChip } from './LineChip';

type Day = 0 | 1;

/** Hoy el horario lleva la hora real de los que ya han pasado: se refresca cada minuto. */
const REFRESH_MS = 60_000;

interface Props {
  stop: Stop;
  /** Línea con la que abrir (la del filtro del panel, si había una). */
  initialLine?: string;
  onBack: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Segundos del día de servicio → "HH:MM" (las 24:30 son las 00:30). */
const hhmm = (t: number) => `${pad(Math.floor(t / 3600) % 24)}:${pad(Math.floor(t / 60) % 60)}`;

/**
 * Cómo pintar un tren (o una parada) ya pasado: la hora real, con el color de su retraso;
 * sin dato de Renfe, la programada en gris; cancelado, tachado.
 */
function passedView(t: number, p: Passed): { text: string; cls: string; title: string } {
  if (p.cancelled) return { text: hhmm(t), cls: 'cancelled', title: 'Cancelado' };
  if (p.delaySec == null)
    return { text: hhmm(t), cls: 'dx', title: `Programado a las ${hhmm(t)} · sin datos de Renfe` };
  const min = Math.round(p.delaySec / 60);
  const real = hhmm(t + p.delaySec);
  const how = min > 0 ? `${min} min tarde` : min < 0 ? `${-min} min antes` : 'en hora';
  return { text: real, cls: delayClass(min), title: `Pasó a las ${real} (${how}; programado a las ${hhmm(t)})` };
}

const dateFmt = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Madrid',
});

/**
 * Horario de todo el día en una estación, como el cartel de cada línea: una fila por hora con
 * las horas de paso completas (HH:MM). Hoy, los que ya han pasado llevan la hora real con el
 * color de su retraso. Tocar una hora abre el recorrido de ese tren.
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

  // Hoy: se vuelve a pedir cada minuto para ir coloreando los que van pasando.
  useEffect(() => {
    if (day !== 0) return;
    let ctrl = new AbortController();
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      ctrl.abort();
      ctrl = new AbortController();
      fetchTimetable(stop.id, 0, ctrl.signal)
        .then((res) => setCache((c) => ({ ...c, 0: res })))
        .catch(() => {
          /* se reintenta en la siguiente vuelta */
        });
    }, REFRESH_MS);
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, [stop.id, day]);

  const lines = useMemo(() => {
    const seen = new Map<string, StopTimetable['groups'][number]['line']>();
    for (const g of data?.groups ?? []) if (!seen.has(g.line.name)) seen.set(g.line.name, g.line);
    return [...seen.values()];
  }, [data]);
  const line = lines.find((l) => l.name === lineName) ?? lines[0];
  const dirs = useMemo(() => (data?.groups ?? []).filter((g) => g.line.name === line?.name), [data, line]);
  const group = dirs[Math.min(dirIdx, dirs.length - 1)];

  // Solo hoy: el próximo que no ha pasado, resaltado (-1: ya no queda ninguno).
  const today = day === 0;
  const nextIdx = today && group ? group.trains.findIndex((t) => !t.passed) : -1;

  const hours = useMemo(() => {
    const out: { h: number; trains: { tripId: string; t: number; mark?: string; passed?: Passed; i: number }[] }[] = [];
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
    return <TripView tripId={tripId} day={day} stopId={stop.id} onBack={() => setTripId(null)} />;
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
                      {trains.map((t) => {
                        const pv = t.passed && passedView(t.t, t.passed);
                        return (
                          <button
                            key={t.tripId}
                            className={`tt-min${pv ? ` done ${pv.cls}` : ''}${t.i === nextIdx ? ' next' : ''}`}
                            title={pv ? `${pv.title} · ver recorrido` : 'Ver recorrido'}
                            onClick={() => openTrip(t.tripId)}
                          >
                            {pv ? pv.text : hhmm(t.t)}
                            {t.mark && <sup>{t.mark}</sup>}
                          </button>
                        );
                      })}
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
        <footer className="panel-footer">
          {today ? 'Los que ya han pasado, con su hora real' : 'Horario programado'} ·{' '}
          {dateFmt.format(data.base + 12 * 3600_000)}
        </footer>
      )}
    </>
  );
}

interface TripProps {
  tripId: string;
  day: Day;
  stopId: string;
  onBack: () => void;
}

function TripView({ tripId, day, stopId, onBack }: TripProps) {
  const [trip, setTrip] = useState<TripTimes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ctrl = new AbortController();
    const load = () => {
      ctrl.abort();
      ctrl = new AbortController();
      fetchTripTimes(tripId, day, ctrl.signal)
        .then(setTrip)
        .catch((e) => !isAbort(e) && setError((e as Error).message));
    };
    load();
    // Hoy, si el tren va circulando, las paradas se van coloreando según pasa.
    const id = day === 0 ? setInterval(() => document.visibilityState === 'visible' && load(), 30_000) : undefined;
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, [tripId, day]);

  const hereIdx = trip?.stops.findIndex((s) => s.stopId === stopId) ?? -1;
  const hereRef = useRef<HTMLLIElement>(null);
  // Solo al cargarlo: con los refrescos no se mueve.
  const loaded = !!trip;
  useEffect(() => {
    hereRef.current?.scrollIntoView({ block: 'center' });
  }, [loaded]);

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
            {trip.cancelled && <span className="badge danger">Cancelado</span>}
          </p>
        )}
      </div>
      <div className="panel-body">
        {!trip && !error && <p className="placeholder">Cargando recorrido…</p>}
        {error && !trip && <p className="placeholder error">{error}</p>}
        {trip && (
          <ol className="tt-trip" style={{ ['--line' as string]: `#${trip.line.color}` }}>
            {trip.stops.map((s, i) => {
              const pv = s.passed && passedView(s.t, s.passed);
              return (
                <li
                  key={`${s.stopId}-${i}`}
                  ref={i === hereIdx ? hereRef : undefined}
                  className={i === hereIdx ? 'here' : hereIdx >= 0 && i < hereIdx && !pv ? 'before' : undefined}
                >
                  <span className={`tt-time${pv ? ` done ${pv.cls}` : ''}`} title={pv?.title}>
                    {pv ? pv.text : hhmm(s.t)}
                  </span>
                  <span className="tt-dot" aria-hidden="true" />
                  <span className="tt-stop">{s.name}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <footer className="panel-footer">
        {trip?.stops.some((s) => s.passed)
          ? 'Hora real en las paradas por las que ya ha pasado; en el resto, la programada.'
          : 'Horas programadas: en directo pueden variar.'}
      </footer>
    </>
  );
}
