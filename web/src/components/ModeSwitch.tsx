import type { TransportMode } from '../lib/mode';
import { BusIcon, TrainIcon } from './icons';

/** Píldora Trenes | Buses a la izquierda del buscador. */
export function ModeSwitch({ mode, onChange }: { mode: TransportMode; onChange: (m: TransportMode) => void }) {
  const option = (m: TransportMode, label: string, icon: JSX.Element) => (
    <button
      role="radio"
      aria-checked={mode === m}
      aria-label={label}
      title={label}
      className={mode === m ? 'on' : undefined}
      onClick={() => onChange(m)}
    >
      {icon}
    </button>
  );
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Trenes o autobuses">
      {option('tren', 'Trenes de Cercanías', <TrainIcon />)}
      {option('bus', 'Autobuses urbanos', <BusIcon />)}
    </div>
  );
}
