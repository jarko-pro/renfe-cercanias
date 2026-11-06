import type { TrainRun } from './collector.js';

/** Lo mínimo que usamos de un cliente Postgres (pg.Pool o PGlite en los tests). */
export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export const RETENTION_DAYS = 90;

export async function migrate(db: Db): Promise<void> {
  await db.query(`
    create table if not exists train_runs (
      service_date date not null,
      network text not null,
      train text not null,
      line text not null,
      trip_id text not null,
      dep_time int not null,
      status text not null,
      stops text[] not null,
      delays int[] not null,
      primary key (service_date, trip_id)
    )`);
  await db.query('create index if not exists train_runs_train on train_runs (network, train, service_date)');
}

/** Inserta en una sola consulta; si un viaje ya estaba (p. ej. tras reiniciar), se ignora. */
export async function insertRuns(db: Db, runs: TrainRun[]): Promise<void> {
  if (!runs.length) return;
  await db.query(
    `insert into train_runs
     select * from json_populate_recordset(null::train_runs, $1::json)
     on conflict do nothing`,
    [JSON.stringify(runs)],
  );
}

export async function purgeOld(db: Db): Promise<void> {
  await db.query(`delete from train_runs where service_date < current_date - ${RETENTION_DAYS}`);
}
