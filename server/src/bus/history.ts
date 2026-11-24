import pg from 'pg';
import type { Db } from '../history/db.js';
import { migrateBus, purgeOldPasses, upsertPasses, type PassRow } from './db.js';
import { serviceDayOf, type Pass } from './passes.js';

const FLUSH_MS = 5 * 60_000;
/** Si la base de datos falla, no se acumulan más pasos que estos en memoria. */
const MAX_QUEUE = 50_000;

export interface BusHistoryStatus {
  enabled: boolean;
  pending: number;
  saved: number;
  lastError: string | null;
}

const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/** Agrupa los pasos en filas (día, red, línea, destino, parada) con sus horas ordenadas. */
export function toRows(passes: { feed: string; pass: Pass }[]): PassRow[] {
  const rows = new Map<string, PassRow>();
  for (const { feed, pass } of passes) {
    const { date, sec } = serviceDayOf(pass.time);
    const key = `${date}|${feed}|${pass.line}|${pass.dest}|${pass.stop}`;
    let row = rows.get(key);
    if (!row) {
      rows.set(key, (row = { service_date: iso(date), feed, line: pass.line, dest: pass.dest, stop: pass.stop, times: [] }));
    }
    if (!row.times.includes(sec)) row.times.push(sec);
  }
  for (const r of rows.values()) r.times.sort((a, b) => a - b);
  return [...rows.values()];
}

/**
 * Guarda los pasos de bus en Postgres (DATABASE_URL_BUS, separada de la de trenes para que una
 * no pueda llenar la otra). Sin URL no se guarda nada y solo se informa en el log.
 */
export function createBusHistory(
  url: string | undefined,
  log: { info(m: string): void; warn(m: string): void },
  /** Solo leer (BUS_HISTORY_READ_ONLY=1): para probar en local sin escribir en producción. */
  readOnly = false,
) {
  const pool = url
    ? new pg.Pool({
        connectionString: url,
        max: 1,
        ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
      })
    : null;
  pool?.on('error', (err) => log.warn(`Conexión con la base de datos de buses perdida: ${err.message}`));
  const db: Db | null = pool;
  const status: BusHistoryStatus = { enabled: !!db && !readOnly, pending: 0, saved: 0, lastError: null };
  let queue: { feed: string; pass: Pass }[] = [];
  let ready: Promise<void> | null = null;
  let lastPurge = '';

  function add(feed: string, passes: Pass[]) {
    for (const pass of passes) queue.push({ feed, pass });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    status.pending = queue.length;
  }

  let flushing = false;
  async function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    const batch = queue;
    queue = [];
    try {
      if (!db || readOnly) {
        log.info(`Histórico de buses (${db ? 'solo lectura' : 'sin base de datos'}): ${batch.length} pasos`);
        status.saved += batch.length;
        return;
      }
      ready ??= migrateBus(db);
      await ready;
      await upsertPasses(db, toRows(batch));
      status.saved += batch.length;
      const today = new Date().toISOString().slice(0, 10);
      if (lastPurge !== today) {
        await purgeOldPasses(db);
        lastPurge = today;
      }
      status.lastError = null;
    } catch (err) {
      ready = null;
      status.lastError = (err as Error).message;
      queue = [...batch, ...queue].slice(-MAX_QUEUE);
      log.warn(`Error guardando el histórico de buses: ${status.lastError}`);
    } finally {
      status.pending = queue.length;
      flushing = false;
    }
  }

  const timer = setInterval(() => void flush(), FLUSH_MS);
  return { add, flush, status, stop: () => clearInterval(timer) };
}

export type BusHistory = ReturnType<typeof createBusHistory>;
