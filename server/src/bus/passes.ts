import { localDate, serviceDayBase } from '../time.js';
import type { Estimate } from './santander.js';

/**
 * Detecta cuándo pasa un bus por una parada a partir de las estimaciones (Santander no da id de
 * viaje ni hora real de paso). En cada fila parada × línea, el primer bus se acerca (`t1` baja) y,
 * cuando pasa, `t1` salta al siguiente: lo que antes era el segundo bus o uno que entra en el
 * horizonte. La hora del paso es la de la última estimación más los segundos que le faltaban.
 */

/** El primer bus estaba "llegando": le faltaban como mucho estos segundos. */
export const ARRIVING_SEC = 90;
/** Con un segundo bus a la vista, el nuevo `t1` debe parecerse a su `t2` (± esto o un 30 %). */
const MATCH_SEC = 120;
/** Sin segundo bus a la vista, el nuevo `t1` debe ser al menos esto mayor que el anterior. */
const JUMP_ALONE_SEC = 180;
/** Si una fila desaparece con el bus llegando, solo cuenta si su último dato es reciente. */
const GONE_FRESH_MS = 3 * 60_000;

export interface Pass {
  stop: string;
  line: string;
  dest: string;
  /** Hora estimada del paso (epoch ms). */
  time: number;
}

interface Seen {
  t1: number;
  dest1: string;
  t2: number | null;
  at: number;
}

/** Tras un hueco más largo (corte de red), pueden haber pasado varios buses: no se adivina. */
const MAX_GAP_SEC = 5 * 60;

function isPass(prev: Seen, cur: Estimate): boolean {
  const elapsed = (cur.at - prev.at) / 1000;
  if (prev.t1 > ARRIVING_SEC || elapsed > MAX_GAP_SEC) return false;
  if (prev.t2 != null) {
    // El que era segundo es ahora el primero.
    const expected = prev.t2 - elapsed;
    return Math.abs(cur.t1 - expected) <= Math.max(MATCH_SEC, 0.3 * prev.t2) && cur.t1 > prev.t1 + 30;
  }
  return cur.t1 >= prev.t1 + JUMP_ALONE_SEC;
}

export function createPassDetector() {
  const prev = new Map<string, Seen>();

  /** Recibe una lectura completa del feed y devuelve los pasos detectados desde la anterior. */
  function update(estimates: Estimate[], now: number): Pass[] {
    const out: Pass[] = [];
    const seen = new Set<string>();
    for (const e of estimates) {
      const key = `${e.stop}|${e.line}`;
      seen.add(key);
      const p = prev.get(key);
      if (p && e.at <= p.at) continue; // misma estimación que en la lectura anterior
      if (p && isPass(p, e)) {
        out.push({ stop: e.stop, line: e.line, dest: p.dest1, time: Math.min(p.at + Math.max(0, p.t1) * 1000, e.at) });
      }
      prev.set(key, { t1: e.t1, dest1: e.dest1, t2: e.t2, at: e.at });
    }
    // Fila que desaparece con el bus llegando: era el último bus del día (o el último en un rato).
    for (const [key, p] of prev) {
      if (seen.has(key)) continue;
      prev.delete(key);
      if (p.t1 <= ARRIVING_SEC && now - p.at <= GONE_FRESH_MS) {
        const [stop, line] = key.split('|');
        out.push({ stop, line, dest: p.dest1, time: p.at + Math.max(0, p.t1) * 1000 });
      }
    }
    return out;
  }

  return { update, size: () => prev.size };
}

/** Los buses de madrugada cuentan para el día anterior (como en GTFS, con horas de más de 24). */
const DAY_START_MS = 4 * 3600_000;

/** Día de servicio (YYYYMMDD) y segundos desde su inicio de un instante. */
export function serviceDayOf(ms: number): { date: string; sec: number } {
  const date = localDate(ms - DAY_START_MS);
  return { date, sec: Math.round((ms - serviceDayBase(date)) / 1000) };
}
