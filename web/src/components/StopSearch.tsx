import type { Stop } from '@renfe/shared';
import { useMemo, useRef, useState } from 'react';
import { normalize } from '../lib/text';
import { LineChip } from './LineChip';

interface Props {
  stops: Stop[];
  favorites: Stop[];
  onSelect: (stop: Stop) => void;
}

export function StopSearch({ stops, favorites, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const indexed = useMemo(() => stops.map((s) => ({ s, n: normalize(s.name) })), [stops]);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return favorites;
    const starts: Stop[] = [];
    const contains: Stop[] = [];
    for (const { s, n } of indexed) {
      if (n.startsWith(q)) starts.push(s);
      else if (n.includes(q)) contains.push(s);
    }
    return [...starts, ...contains].slice(0, 8);
  }, [query, indexed, favorites]);

  const pick = (s: Stop) => {
    onSelect(s);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const showList = open && results.length > 0;

  return (
    <div className="search">
      <input
        ref={inputRef}
        type="search"
        placeholder="Buscar estación…"
        value={query}
        aria-label="Buscar estación"
        aria-expanded={showList}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter' && results[active]) pick(results[active]);
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {showList && (
        <ul className="search-results" role="listbox">
          {!query.trim() && <li className="search-heading">Tus favoritas</li>}
          {results.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
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
          ))}
        </ul>
      )}
    </div>
  );
}
