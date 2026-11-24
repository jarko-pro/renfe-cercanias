import { createHash } from 'node:crypto';
import type { BusArrivalsResponse, BusFeedStatus } from '@renfe/shared';
import { tzOffsetMs } from '../time.js';
import type { BusHistory } from './history.js';
import { createPassDetector, serviceDayOf } from './passes.js';
import { BUS_REGISTRY, type SantanderConfig } from './registry.js';
import {
  buildStatic,
  indexByStop,
  parseEstimates,
  stopArrivals,
  type Estimate,
  type Resource,
  type SantanderStatic,
} from './santander.js';

type Log = { info(m: string): void; warn(m: string): void };

/** Paradas, líneas y recorridos cambian poco: se recargan una vez al día. */
const STATIC_MAX_AGE_MS = 24 * 3600_000;
const STATIC_RETRY_MS = 10 * 60_000;

/** Lee un dataset de la API del Ayuntamiento, con todas sus páginas. */
async function fetchResources(base: string, dataset: string, items: number): Promise<Resource[]> {
  const out: Resource[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${base}/${dataset}.json?items=${items}&page=${page}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`${dataset}: HTTP ${res.status}`);
    const json = (await res.json()) as { summary?: { pages?: number }; resources?: Resource[] };
    out.push(...(json.resources ?? []));
    if (!json.summary?.pages || page >= json.summary.pages) break;
  }
  return out;
}

const localHour = (ms: number) => new Date(ms + tzOffsetMs(ms)).getUTCHours();
/** De 1:30 a 5:30 casi no hay buses (solo los nocturnos del fin de semana): se lee menos. */
const isNight = (ms: number) => {
  const h = localHour(ms) + new Date(ms).getUTCMinutes() / 60;
  return h >= 1.5 && h < 5.5;
};

function createSantanderFeed(cfg: SantanderConfig, log: Log, history: BusHistory) {
  let stat: SantanderStatic | null = null;
  let stopsJson = '[]';
  let stopsEtag = '';
  let staticTry = 0;
  let loadingStatic = false;
  let byStop = new Map<string, Estimate[]>();
  let estimateCount = 0;
  let badReads = 0;
  let smallInARow = 0;
  let fetchedAt: number | null = null;
  let error: string | null = null;
  const detector = createPassDetector();
  let passesDay = '';
  let passesToday = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function loadStatic(now = Date.now()) {
    if (loadingStatic) return;
    if (stat && now - stat.loadedAt < STATIC_MAX_AGE_MS) return;
    if (now - staticTry < STATIC_RETRY_MS) return;
    loadingStatic = true;
    staticTry = now;
    try {
      const [stopsRes, linesRes, seqRes] = await Promise.all([
        fetchResources(cfg.base, 'paradas_bus', 2000),
        fetchResources(cfg.base, 'lineas_bus', 500),
        fetchResources(cfg.base, 'lineas_bus_secuencia', 5000),
      ]);
      const next = buildStatic(cfg, stopsRes, linesRes, seqRes, Date.now());
      if (next.stops.size < 50) throw new Error(`solo ${next.stops.size} paradas`);
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

  async function poll() {
    const now = Date.now();
    try {
      const res = await fetchResources(cfg.base, 'control_flotas_estimaciones', 5000);
      const estimates = parseEstimates(res);
      // La API devuelve a veces una lectura vacía o a medias (HTTP 200 sin filas, ~1 de cada
      // 10): se descarta y se mantiene la anterior. Si no, todos los buses "desaparecerían".
      // Si una lectura más pequeña (no vacía) se repite 5 veces, es que la red ha cambiado de verdad.
      if (res.length === 0 || (estimates.length < estimateCount / 2 && ++smallInARow < 5)) {
        badReads++;
        return;
      }
      smallInARow = 0;
      byStop = indexByStop(estimates);
      estimateCount = estimates.length;
      fetchedAt = Date.now();
      error = null;
      const passes = detector.update(estimates, fetchedAt);
      const today = serviceDayOf(fetchedAt).date;
      if (today !== passesDay) {
        passesDay = today;
        passesToday = 0;
      }
      passesToday += passes.length;
      if (passes.length) history.add(cfg.id, passes);
    } catch (err) {
      error = (err as Error).message;
      log.warn(`Buses de ${cfg.id}: error leyendo estimaciones: ${error}`);
    } finally {
      void loadStatic();
      const wait = isNight(Date.now()) ? cfg.nightIntervalMs : cfg.dayIntervalMs;
      timer = setTimeout(() => void poll(), Math.max(1000, wait - (Date.now() - now)));
    }
  }

  void loadStatic().then(() => poll());

  return {
    stops: () => (stat ? { json: stopsJson, etag: stopsEtag } : null),
    arrivals(code: string, now: number): BusArrivalsResponse | null | 'loading' {
      if (!stat) return 'loading';
      const stop = stat.stops.get(code);
      if (!stop) return null;
      const { lines, idle } = stopArrivals(cfg, stat, byStop.get(code), code, now);
      return {
        stop,
        generatedAt: now,
        realtimeAgeSec: fetchedAt ? Math.round((now - fetchedAt) / 1000) : null,
        lines,
        idle,
      };
    },
    status: (): BusFeedStatus => ({
      feed: cfg.id,
      stops: stat?.stops.size ?? 0,
      staticLoadedAt: stat?.loadedAt ?? null,
      fetchedAt,
      estimates: estimateCount,
      badReads,
      passesToday,
      history: { ...history.status },
      ...(error ? { error } : {}),
    }),
    stop: () => timer && clearTimeout(timer),
  };
}

/** Redes de autobús activas (ids de BUS_FEEDS separados por comas). */
export function createBus(ids: string[], log: Log, history: BusHistory) {
  const feeds = new Map<string, ReturnType<typeof createSantanderFeed>>();
  for (const id of ids) {
    const cfg = BUS_REGISTRY[id];
    if (!cfg) {
      log.warn(`BUS_FEEDS: red de autobús desconocida "${id}"`);
      continue;
    }
    feeds.set(id, createSantanderFeed(cfg, log, history));
  }
  if (feeds.size) log.info(`Buses activos: ${[...feeds.keys()].join(', ')}`);
  return {
    feed: (id: string) => feeds.get(id),
    status: () => [...feeds.values()].map((f) => f.status()),
    enabled: () => feeds.size > 0,
  };
}

export function parseBusFeeds(env: string | undefined): string[] {
  return (env ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
