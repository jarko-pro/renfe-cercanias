import pg from 'pg';
import type { GtfsData } from '../gtfs/types.js';
import type { RealtimeState } from '../realtime/poller.js';
import { localDate } from '../time.js';
import { createCollector, type TrainRun } from './collector.js';
import { insertRuns, migrate, purgeOld, type Db } from './db.js';
import { loadInsights, type Insights } from './insights.js';

const FLUSH_MS = 5 * 60_000;

export interface HistoryStatus {
  enabled: boolean;
  pending: number;
  saved: number;
  lastError: string | null;
  /** Estadísticas de referencia cargadas (null si aún no hay). */
  insights: { loadedAt: number; days: number; trains: number; trainStops: number; lines: number } | null;
}

/**
 * Guarda el retraso de cada tren en Postgres (DATABASE_URL). Sin DATABASE_URL no se guarda
 * nada, pero el recolector funciona igual (útil en local para ver qué se guardaría).
 */
export function createHistory(
  url: string | undefined,
  getData: () => GtfsData | null,
  log: { info(m: string): void; warn(m: string): void },
) {
  const pool = url
    ? new pg.Pool({
        connectionString: url,
        max: 2,
        // El pooler de Supabase usa un certificado propio que Node no reconoce.
        ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
      })
    : null;
  // Sin esto, un corte de una conexión inactiva tumbaría el servidor entero.
  pool?.on('error', (err) => log.warn(`Conexión con la base de datos perdida: ${err.message}`));
  const db: Db | null = pool;
  const collector = createCollector(Date.now());
  const status: HistoryStatus = { enabled: !!db, pending: 0, saved: 0, lastError: null, insights: null };
  let queue: TrainRun[] = [];
  let ready: Promise<void> | null = null;
  let lastFetch: number | null = null;
  let lastPurge = '';
  let insights: Insights | null = null;
  let insightsDay = '';
  let insightsTry = 0;

  /** Recalcula las estadísticas una vez al día (y al arrancar). Si falla, reintenta a los 30 min. */
  async function refreshInsights(today: string, now: number) {
    if (!db || insightsDay === today || now - insightsTry < 30 * 60_000) return;
    insightsTry = now;
    try {
      const t0 = Date.now();
      insights = await loadInsights(db, today, now);
      insightsDay = today;
      status.insights = { loadedAt: insights.loadedAt, days: insights.days, ...insights.counts() };
      log.info(
        `Estadísticas del histórico en ${((Date.now() - t0) / 1000).toFixed(1)} s: ${insights.days} días, ` +
          `${status.insights.trains} trenes, ${status.insights.lines} franjas de línea`,
      );
    } catch (err) {
      log.warn(`Error calculando estadísticas: ${(err as Error).message}`);
    }
  }

  function observe(rt: RealtimeState, vehicles: Map<string, unknown>) {
    const data = getData();
    if (!data || rt.fetchedAt == null || rt.fetchedAt === lastFetch) return;
    lastFetch = rt.fetchedAt;
    collector.observe(data, rt.trips, vehicles, localDate(rt.fetchedAt), rt.fetchedAt);
  }

  let flushing = false;
  async function flush() {
    const data = getData();
    if (!data || flushing) return;
    flushing = true;
    try {
      await doFlush(data);
    } finally {
      flushing = false;
    }
  }

  async function doFlush(data: GtfsData) {
    const now = Date.now();
    const today = localDate(now);
    queue.push(...collector.collect(data, today, now));
    status.pending = collector.pending();
    if (!db) {
      if (queue.length) log.info(`Histórico (sin base de datos): ${queue.length} viajes cerrados`);
      status.saved += queue.length;
      queue = [];
      return;
    }
    try {
      ready ??= migrate(db);
      await ready;
      await insertRuns(db, queue);
      status.saved += queue.length;
      queue = [];
      if (lastPurge !== today) {
        await purgeOld(db);
        lastPurge = today;
      }
      await refreshInsights(today, now);
      status.lastError = null;
    } catch (err) {
      ready = null;
      status.lastError = (err as Error).message;
      // Si la base de datos falla, se reintenta en la siguiente vuelta (con tope para no llenar la memoria).
      if (queue.length > 20_000) queue = queue.slice(-20_000);
      log.warn(`Error guardando histórico: ${status.lastError}`);
    }
  }

  const timer = setInterval(() => void flush(), FLUSH_MS);
  // Al arrancar no se espera a la primera vuelta de 5 min para tener las estadísticas.
  if (db) void (async () => {
    try {
      ready ??= migrate(db);
      await ready;
      await refreshInsights(localDate(Date.now()), Date.now());
    } catch (err) {
      ready = null;
      log.warn(`Error preparando el histórico: ${(err as Error).message}`);
    }
  })();
  return { observe, flush, status, insights: () => insights, stop: () => clearInterval(timer) };
}
