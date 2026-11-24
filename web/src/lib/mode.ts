/**
 * Modo de la app: trenes (Cercanías) o autobuses. El mapa enseña solo las paradas del modo
 * elegido, que se recuerda en el dispositivo.
 */
export type TransportMode = 'tren' | 'bus';

const KEY = 'renfe:mode:v1';

const valid = (v: unknown): v is TransportMode => v === 'tren' || v === 'bus';

/** Manda la dirección (una página de estación o de parada, o ?modo=); si no, lo último elegido. */
export function initialMode(): TransportMode {
  if (location.pathname.startsWith('/bus/')) return 'bus';
  if (location.pathname.startsWith('/estacion/')) return 'tren';
  const q = new URLSearchParams(location.search).get('modo');
  if (valid(q)) return q;
  try {
    const saved = localStorage.getItem(KEY);
    if (valid(saved)) return saved;
  } catch {
    /* sin almacenamiento */
  }
  return 'tren';
}

export function saveMode(mode: TransportMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* modo privado: no se recuerda */
  }
}
