import type { Stop } from '@renfe/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { normalize } from '../lib/text';
import { LineChip } from './LineChip';

interface Props {
  stops: Stop[];
  favorites: Stop[];
  onSelect: (stop: Stop) => void;
}

/** Qué lista está desplegada bajo la barra. */
type Mode = 'closed' | 'search' | 'favorites';

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

export function StopSearch({ stops, favorites, onSelect }: Props) {
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, results.length - 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter' && results[active]) pick(results[active]);
    else if (e.key === 'Escape') setMode('closed');
  };

  const favOpen = mode === 'favorites';

  return (
    <div className="search" ref={rootRef} onKeyDown={onKeyDown}>
      <div className="search-bar">
        <input
          ref={inputRef}
          type="search"
          placeholder="Buscar estación…"
          value={query}
          aria-label="Buscar estación"
          aria-expanded={mode === 'search' && searchResults.length > 0}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setMode('search');
          }}
          onFocus={() => query.trim() && setMode('search')}
        />
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

      {mode === 'search' && searchResults.length > 0 && (
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
