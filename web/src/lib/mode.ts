/**
 * Modo de la app: trenes (Cercanías) o autobuses. El mapa enseña solo las paradas del modo
 * elegido, que se recuerda en el dispositivo.
 */
export type TransportMode = 'tren' | 'bus';

const KEY = 'renfe:mode:v1';

/**
 * Los autobuses están ocultos mientras solo haya Santander: sin píldora y sin forma de entrar
 * (ni por ?modo=bus ni por /bus/...). El servidor sigue recogiendo su histórico. Para verlos en
 * local: VITE_BUS=1 al arrancar Vite.
 */
export const BUS_ENABLED = import.meta.env.VITE_BUS === '1';

const valid = (v: unknown): v is TransportMode => v === 'tren' || v === 'bus';

/** Manda la dirección (una página de estación o de parada, o ?modo=); si no, lo último elegido. */
export function initialMode(): TransportMode {
  if (!BUS_ENABLED) return 'tren';
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
