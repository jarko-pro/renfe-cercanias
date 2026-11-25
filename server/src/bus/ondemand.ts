import { createHash } from 'node:crypto';
import type { BusArrivalsResponse, BusFeedStatus, BusLineArrivals, BusStop, Line } from '@renfe/shared';
import { tzOffsetMs } from '../time.js';
import type { BusFeed, Log } from './index.js';

/**
 * Redes cuyas llegadas solo se pueden pedir parada a parada (EMT de Madrid, TMB de Barcelona):
 * se piden cuando alguien abre una parada y la respuesta se comparte unos segundos entre todos.
 * Aquí está lo común (caché, consultas simultáneas, tope diario, recarga de paradas); cada red
 * pone cómo se leen sus paradas y sus llegadas.
 */

const STATIC_MAX_AGE_MS = 24 * 3600_000;
const STATIC_RETRY_MS = 10 * 60_000;
/** Si la red falla, se sigue enseñando la última respuesta de la parada hasta este tiempo. */
const SERVE_STALE_MS = 2 * 60_000;

export interface OnDemandStatic {
  loadedAt: number;
  /** Número de parada (el de la marquesina) -> parada. */
  stops: Map<string, BusStop>;
  lines: Map<string, Line>;
}

export interface OnDemandSource<S extends OnDemandStatic, R> {
  /** Paradas y líneas (una vez al día). */
  loadStatic(now: number): Promise<S>;
  /** Respuesta en bruto de la red para una parada. */
  fetchStop(code: string): Promise<R>;
  /** `at` es cuándo se pidió la respuesta a la red. */
  arrivals(stat: S, code: string, raw: R, at: number, now: number): { lines: BusLineArrivals[]; idle: Line[] };
  requestsToday(): number;
}

export interface OnDemandConfig {
  id: string;
  /** Cuánto se reutiliza la respuesta de una parada antes de volver a pedirla. */
  cacheMs: number;
  /** Menos paradas que esto es una carga mala: se mantiene la anterior. */
  minStops: number;
}

/** "20261126" en hora de Madrid. */
export const localDate = (ms: number) => new Date(ms + tzOffsetMs(ms)).toISOString().slice(0, 10).replace(/-/g, '');

/** Cuenta las consultas del día (hora de Madrid) y corta al llegar al tope propio. */
export function dailyQuota(limit: number) {
  let day = '';
  let count = 0;
  return {
    take(now = Date.now()) {
      const today = localDate(now);
      if (today !== day) {
        day = today;
        count = 0;
      }
      if (count >= limit) throw new Error('límite diario de consultas alcanzado');
      count++;
    },
    get count() {
      return count;
    },
  };
}

export function createOnDemandFeed<S extends OnDemandStatic, R>(
  cfg: OnDemandConfig,
  src: OnDemandSource<S, R>,
  log: Log,
): BusFeed {
  let stat: S | null = null;
  let stopsJson = '[]';
  let stopsEtag = '';
  let staticTry = 0;
  let loadingStatic = false;
  const cache = new Map<string, { at: number; raw: R }>();
  const inflight = new Map<string, Promise<{ at: number; raw: R }>>();
  let errors = 0;
  let lastOkAt: number | null = null;
  let error: string | null = null;

  async function loadStatic(now = Date.now()) {
    if (loadingStatic) return;
    if (stat && now - stat.loadedAt < STATIC_MAX_AGE_MS) return;
    if (now - staticTry < STATIC_RETRY_MS) return;
    loadingStatic = true;
    staticTry = now;
    try {
      const next = await src.loadStatic(now);
      if (next.stops.size < cfg.minStops) throw new Error(`solo ${next.stops.size} paradas`);
      const list = [...next.stops.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
      stopsJson = JSON.stringify(list);
      stopsEtag = `"${createHash('sha1').update(stopsJson).digest('hex').slice(0, 16)}"`;
      stat = next;
      log.info(`Buses de ${cfg.id}: ${next.stops.size} paradas y ${next.lines.size} líneas`);
    } catch (err) {
      log.warn(`Buses de ${cfg.id}: error cargando paradas y líneas: ${(err as Error).message}`);
    } finally {
      loadingStatic = false;
    }
  }

  /** Respuesta de la parada: de la caché si es reciente; si no, una sola consulta aunque la pidan varios. */
  async function rawOf(code: string, now: number) {
    const hit = cache.get(code);
    if (hit && now - hit.at < cfg.cacheMs) return hit;
    let p = inflight.get(code);
    if (!p) {
      p = src
        .fetchStop(code)
        .then((raw) => ({ at: Date.now(), raw }))
        .finally(() => inflight.delete(code));
      inflight.set(code, p);
    }
    try {
      const fresh = await p;
      cache.set(code, fresh);
      lastOkAt = fresh.at;
      error = null;
      if (cache.size > 3000) {
        for (const [k, v] of cache) if (now - v.at > SERVE_STALE_MS) cache.delete(k);
      }
      return fresh;
    } catch (err) {
      errors++;
      error = (err as Error).message;
      log.warn(`Buses de ${cfg.id}: error en la parada ${code}: ${error}`);
      if (hit && now - hit.at < SERVE_STALE_MS) return hit;
      return null;
    }
  }

  void loadStatic();
  const timer = setInterval(() => void loadStatic(), STATIC_RETRY_MS);

  return {
    stops: () => (stat ? { json: stopsJson, etag: stopsEtag } : null),
    async arrivals(code, now) {
      if (!stat) {
        void loadStatic();
        return 'loading';
      }
      const stop = stat.stops.get(code);
      if (!stop) return null;
      const got = await rawOf(code, now);
      if (!got) return 'unavailable';
      const at = Date.now();
      const { lines, idle } = src.arrivals(stat, code, got.raw, got.at, at);
      const res: BusArrivalsResponse = {
        stop,
        generatedAt: at,
        realtimeAgeSec: Math.round((at - got.at) / 1000),
        lines,
        idle,
      };
      return res;
    },
    status: (): BusFeedStatus => ({
      feed: cfg.id,
      stops: stat?.stops.size ?? 0,
      staticLoadedAt: stat?.loadedAt ?? null,
      fetchedAt: lastOkAt,
      estimates: cache.size,
      badReads: errors,
      passesToday: 0,
      history: { enabled: false, pending: 0, saved: 0, lastError: null },
      requestsToday: src.requestsToday(),
      ...(error ? { error } : {}),
    }),
    stop: () => clearInterval(timer),
  };
}
