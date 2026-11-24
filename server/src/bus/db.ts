import type { Db } from '../history/db.js';

/**
 * Histórico de autobuses (segunda base de datos, DATABASE_URL_BUS): la hora real a la que pasó
 * cada bus por cada parada. Sin id de viaje, se guarda una fila por día, línea, destino y
 * parada con todas sus horas de paso; el retraso se calcula al hacer las estadísticas, así que
 * se puede recalcular si llega un horario mejor.
 */

/** Las estadísticas usan 6 semanas: no hace falta guardar más. */
export const BUS_RETENTION_DAYS = 42;

export interface PassRow {
  /** Día de servicio (YYYY-MM-DD). */
  service_date: string;
  feed: string;
  line: string;
  dest: string;
  stop: string;
  /** Segundos desde el inicio del día de servicio (pueden pasar de 24 h), sin repetir. */
  times: number[];
}

export async function migrateBus(db: Db): Promise<void> {
  await db.query(`
    create table if not exists bus_passes (
      service_date date not null,
      feed text not null,
      line text not null,
      dest text not null,
      stop text not null,
      times int[] not null,
      primary key (service_date, feed, line, dest, stop)
    )`);
}

/** Inserta o añade horas a las filas existentes, en una sola consulta y sin duplicar horas. */
export async function upsertPasses(db: Db, rows: PassRow[]): Promise<void> {
  if (!rows.length) return;
  await db.query(
    `insert into bus_passes (service_date, feed, line, dest, stop, times)
     select service_date, feed, line, dest, stop, times
     from json_populate_recordset(null::bus_passes, $1::json)
     on conflict (service_date, feed, line, dest, stop) do update
     set times = (select array_agg(distinct t order by t) from unnest(bus_passes.times || excluded.times) as u(t))`,
    [JSON.stringify(rows)],
  );
}

export async function purgeOldPasses(db: Db): Promise<void> {
  await db.query(`delete from bus_passes where service_date < current_date - ${BUS_RETENTION_DAYS}`);
}
