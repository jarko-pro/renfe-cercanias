import type { Line, TrainMatch } from '@renfe/shared';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { fetchTrains, isAbort } from '../lib/api';
import type { TransportMode } from '../lib/mode';
import { formatTime, normalize } from '../lib/text';
import { HelpCard } from './HelpCard';
import { LineChip } from './LineChip';
import { track } from '../lib/analytics';

/** Lo que el buscador necesita de una estación de tren o una parada de autobús. */
export interface SearchStop {
  id: string;
  name: string;
  lines: Line[];
  /** Número de la marquesina (paradas de autobús): se busca también por él. */
  code?: string;
}

interface Props<T extends SearchStop> {
  mode: TransportMode;
  /** Lo que va a la izquierda de la barra (la píldora Trenes | Buses). */
  leading?: ReactNode;
  stops: T[];
  favorites: T[];
  /** Texto gris bajo el nombre: el núcleo de Cercanías, o el número y el sentido de la parada. */
  metaOf: (stop: T) => string;
  isFavorite: (id: string) => boolean;
  onToggleFavorite: (stop: T) => void;
  onSelect: (stop: T) => void;
  onSelectTrain: (train: TrainMatch) => void;
}

/**
 * Móvil estrecho (360-400 px): con la píldora y la estrella al lado, al buscador le quedan unos
 * 120 px de texto. En el resto (incluido el escritorio, con la columna de 380 px) caben unos 160.
 */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('resize', cb);
      return () => window.removeEventListener('resize', cb);
    },
    () => window.innerWidth <= 400,
  );
}

const PLACEHOLDER: Record<TransportMode, [wide: string, narrow: string]> = {
  tren: ['Estación o nº de tren', 'Buscar estación'],
  bus: ['Parada, calle o nº', 'Buscar parada'],
};
/** Para lectores de pantalla, el texto completo. */
const LABEL: Record<TransportMode, string> = {
  tren: 'Buscar estación o número de tren',
  bus: 'Buscar parada por nombre, calle o número de parada',
};

/** Los números de tren de Renfe tienen siempre 5 cifras. */
const TRAIN_RE = /^\d{5}$/;

/** Qué lista está desplegada bajo la barra. */
type Mode = 'closed' | 'search' | 'favorites' | 'help';

function StopRow<T extends SearchStop>({
  s,
  meta,
  active,
  onPick,
  fav,
}: {
  s: T;
  meta: string;
  active: boolean;
  onPick: () => void;
  /** En la lista de favoritas: estrella para quitarla (o volver a ponerla) sin abrir la estación. */
  fav?: { on: boolean; toggle: () => void };
}) {
  return (
    <li
      role="option"
      aria-selected={active}
      className={[active ? 'active' : '', fav ? 'with-star' : '', fav && !fav.on ? 'removed' : ''].join(' ').trim()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      {fav && (
        <button
          className={`row-star${fav.on ? ' on' : ''}`}
          aria-pressed={fav.on}
          aria-label={fav.on ? `Quitar ${s.name} de favoritas` : `Volver a añadir ${s.name} a favoritas`}
          title={fav.on ? 'Quitar de favoritas' : 'Añadir a favoritas'}
          onClick={(e) => {
            e.stopPropagation();
            fav.toggle();
          }}
        >
          {fav.on ? '★' : '☆'}
        </button>
      )}
      <div className="result-name">{s.name}</div>
      <div className="result-meta">
        <span>{meta}</span>
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

export function StopSearch<T extends SearchStop>({
  mode: transport,
  leading,
  stops,
  favorites,
  metaOf,
  isFavorite,
  onToggleFavorite,
  onSelect,
  onSelectTrain,
}: Props<T>) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('closed');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const indexed = useMemo(() => stops.map((s) => ({ s, n: normalize(s.name) })), [stops]);

  const searchResults = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return [];
    // Paradas de autobús: un número busca primero el de la marquesina (exacto y luego por delante).
    const exact: T[] = [];
    const starts: T[] = [];
    const contains: T[] = [];
    const digits = /^\d+$/.test(q);
    for (const { s, n } of indexed) {
      if (digits && s.code === q) exact.push(s);
      else if (n.startsWith(q) || (digits && s.code?.startsWith(q))) starts.push(s);
      else if (n.includes(q)) contains.push(s);
    }
    return [...exact, ...starts, ...contains].slice(0, 8);
  }, [query, indexed]);

  // Búsqueda por número de tren: solo con las 5 cifras, para no lanzar peticiones a cada tecla.
  const trains_ = transport === 'tren';
  const trainQuery = trains_ && TRAIN_RE.test(query.trim()) ? query.trim() : null;
  const digitsOnly = trains_ && /^\d{1,4}$/.test(query.trim());
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

  // Lo que se ve en la lista de favoritas: las que había al abrirla. Una quitada sigue (con ☆)
  // hasta cerrar la lista, para poder deshacerlo tocando otra vez.
  const [favShown, setFavShown] = useState<T[]>([]);
  const results = mode === 'favorites' ? favShown : searchResults;

  // Cerrar al pulsar fuera.
  useEffect(() => {
    if (mode === 'closed') return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMode('closed');
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [mode]);

  const pick = (s: T) => {
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
  const narrow = useNarrow();
  const noun = transport === 'bus' ? 'paradas' : 'estaciones';

  return (
    <div className="search" ref={rootRef} onKeyDown={onKeyDown}>
      <div className="search-bar">
        {leading}
        <div className="search-field">
          <input
            ref={inputRef}
            type="search"
            placeholder={leading ? PLACEHOLDER[transport][narrow ? 1 : 0] : 'Buscar estación o nº de tren…'}
            value={query}
            aria-label={LABEL[transport]}
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
          aria-label={`${noun === 'paradas' ? 'Paradas' : 'Estaciones'} favoritas`}
          aria-expanded={favOpen}
          title={`${noun === 'paradas' ? 'Paradas' : 'Estaciones'} favoritas`}
          onClick={() => {
            setActive(0);
            if (!favOpen) setFavShown(favorites);
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

      {mode === 'help' && <HelpCard mode={transport} />}

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
            <StopRow key={s.id} s={s} meta={metaOf(s)} active={i === active} onPick={() => pick(s)} />
          ))}
        </ul>
      )}

      {favOpen && (
        <ul className="search-results" role="listbox" aria-label={`${noun} favoritas`}>
          <li className="search-heading">Tus favoritas</li>
          {favShown.length === 0 ? (
            <li className="search-empty">
              Aún no tienes favoritas. Abre {noun === 'paradas' ? 'una parada' : 'una estación'} y pulsa ☆ para
              añadirla.
            </li>
          ) : (
            favShown.map((s, i) => (
              <StopRow
                key={s.id}
                s={s}
                meta={metaOf(s)}
                active={i === active}
                onPick={() => pick(s)}
                fav={{ on: isFavorite(s.id), toggle: () => onToggleFavorite(s) }}
              />
            ))
          )}
        </ul>
      )}
    </div>
  );
}
