import type { Stop, TrainMatch } from '@renfe/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTrains, isAbort } from '../lib/api';
import { formatTime, normalize } from '../lib/text';
import { HelpCard } from './HelpCard';
import { LineChip } from './LineChip';
import { track } from '../lib/analytics';

interface Props {
  stops: Stop[];
  favorites: Stop[];
  onSelect: (stop: Stop) => void;
  onSelectTrain: (train: TrainMatch) => void;
}

/** Los números de tren de Renfe tienen siempre 5 cifras. */
const TRAIN_RE = /^\d{5}$/;

/** Qué lista está desplegada bajo la barra. */
type Mode = 'closed' | 'search' | 'favorites' | 'help';

function StopRow({ s, active, onPick }: { s: Stop; active: boolean; onPick: () => void }) {
  return (
    <li
      role="option"
      aria-selected={active}
      className={active ? 'active' : ''}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      <div className="result-name">{s.name}</div>
      <div className="result-meta">
        <span>{s.network}</span>
        <span className="chips">
          {s.lines.slice(0, 6).map((l) => (
            <LineChip key={l.name} line={l} small />
          ))}
        </span>
      </div>
    </li>
  );
}

function TrainRow({ t, active, onPick }: { t: TrainMatch; active: boolean; onPick: () => void }) {
  return (
    <li
      role="option"
      aria-selected={active}
      className={active ? 'active' : ''}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      <div className="result-name train-result">
        <LineChip line={t.line} small />
        <span>
          Tren {t.train} → {t.headsign || 'Destino desconocido'}
        </span>
      </div>
      <div className="result-meta">
        <span>
          {t.state === 'running'
            ? `En marcha · próxima parada: ${t.stopName}`
            : `Sale a las ${formatTime(t.departure)} de ${t.stopName}`}
        </span>
        <span>{t.network}</span>
      </div>
    </li>
  );
}

export function StopSearch({ stops, favorites, onSelect, onSelectTrain }: Props) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('closed');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const indexed = useMemo(() => stops.map((s) => ({ s, n: normalize(s.name) })), [stops]);

  const searchResults = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return [];
    const starts: Stop[] = [];
    const contains: Stop[] = [];
    for (const { s, n } of indexed) {
      if (n.startsWith(q)) starts.push(s);
      else if (n.includes(q)) contains.push(s);
    }
    return [...starts, ...contains].slice(0, 8);
  }, [query, indexed]);

  // Búsqueda por número de tren: solo con las 5 cifras, para no lanzar peticiones a cada tecla.
  const trainQuery = TRAIN_RE.test(query.trim()) ? query.trim() : null;
  const digitsOnly = /^\d{1,4}$/.test(query.trim());
  const [trains, setTrains] = useState<{ q: string; list: TrainMatch[] | null; error?: boolean } | null>(null);
  useEffect(() => {
    if (!trainQuery) return setTrains(null);
    setTrains({ q: trainQuery, list: null });
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetchTrains(trainQuery, ctrl.signal)
        .then((list) => setTrains({ q: trainQuery, list }))
        .catch((e) => !isAbort(e) && setTrains({ q: trainQuery, list: [], error: true }));
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [trainQuery]);
  const trainResults = trainQuery && trains?.q === trainQuery ? (trains.list ?? []) : [];

  const results = mode === 'favorites' ? favorites : searchResults;

  // Cerrar al pulsar fuera.
  useEffect(() => {
    if (mode === 'closed') return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMode('closed');
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [mode]);

  const pick = (s: Stop) => {
    onSelect(s);
    setQuery('');
    setMode('closed');
    inputRef.current?.blur();
  };

  const pickTrain = (t: TrainMatch) => {
    onSelectTrain(t);
    setQuery('');
    setMode('closed');
    inputRef.current?.blur();
  };

  const trainMode = mode === 'search' && !!trainQuery;
  const onKeyDown = (e: React.KeyboardEvent) => {
    const count = trainMode ? trainResults.length : results.length;
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, count - 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter' && trainMode && trainResults[active]) pickTrain(trainResults[active]);
    else if (e.key === 'Enter' && !trainMode && results[active]) pick(results[active]);
    else if (e.key === 'Escape') setMode('closed');
  };

  const favOpen = mode === 'favorites';

  return (
    <div className="search" ref={rootRef} onKeyDown={onKeyDown}>
      <div className="search-bar">
        <div className="search-field">
          <input
            ref={inputRef}
            type="search"
            placeholder="Buscar estación o nº de tren…"
            value={query}
            aria-label="Buscar estación o número de tren"
            aria-expanded={mode === 'search' && searchResults.length > 0}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setMode('search');
            }}
            onFocus={() => query.trim() && setMode('search')}
          />
          <button
            className={`help-toggle${mode === 'help' ? ' on' : ''}`}
            aria-label="Cómo funciona"
            aria-expanded={mode === 'help'}
            title="Cómo funciona"
            onClick={() => {
              if (mode !== 'help') track('ayuda');
              setMode(mode === 'help' ? 'closed' : 'help');
            }}
          >
            ?
          </button>
        </div>
        <button
          className={`fav-toggle${favOpen ? ' on' : ''}`}
          aria-label="Estaciones favoritas"
          aria-expanded={favOpen}
          title="Estaciones favoritas"
          onClick={() => {
            setActive(0);
            setMode(favOpen ? 'closed' : 'favorites');
          }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.85 1.03-6L3.3 9.6l6-.9z"
              fill={favOpen || favorites.length ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          {favorites.length > 0 && <span className="fav-count">{favorites.length}</span>}
        </button>
      </div>

      {mode === 'help' && <HelpCard />}

      {trainMode && (
        <ul className="search-results" role="listbox" aria-label={`Tren ${trainQuery}`}>
          {trains?.q !== trainQuery || trains.list == null ? (
            <li className="search-empty">Buscando el tren {trainQuery}…</li>
          ) : trainResults.length === 0 ? (
            <li className="search-empty">
              {trains.error
                ? 'No se ha podido buscar el tren. Prueba de nuevo en unos segundos.'
                : `No hay ningún tren ${trainQuery} pendiente hoy.`}
            </li>
          ) : (
            trainResults.map((t, i) => (
              <TrainRow key={t.tripId} t={t} active={i === active} onPick={() => pickTrain(t)} />
            ))
          )}
        </ul>
      )}

      {mode === 'search' && digitsOnly && (
        <ul className="search-results" role="listbox">
          <li className="search-empty">Escribe las 5 cifras del número de tren.</li>
        </ul>
      )}

      {mode === 'search' && !trainQuery && searchResults.length > 0 && (
        <ul className="search-results" role="listbox">
          {searchResults.map((s, i) => (
            <StopRow key={s.id} s={s} active={i === active} onPick={() => pick(s)} />
          ))}
        </ul>
      )}

      {favOpen && (
        <ul className="search-results" role="listbox" aria-label="Estaciones favoritas">
          <li className="search-heading">Tus favoritas</li>
          {favorites.length === 0 ? (
            <li className="search-empty">
              Aún no tienes favoritas. Abre una estación y pulsa ☆ para añadirla.
            </li>
          ) : (
            favorites.map((s, i) => <StopRow key={s.id} s={s} active={i === active} onPick={() => pick(s)} />)
          )}
        </ul>
      )}
    </div>
  );
}
