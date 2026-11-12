import type { Db } from './db.js';

/**
 * Estadísticas sacadas del histórico (`train_runs`): qué es "lo normal" para cada tren y cada
 * línea. Se calculan en Postgres una vez al día y se guardan en memoria para responder al momento.
 */

/** Primer día del histórico (empezó a recogerse el 6-11-2026, a media mañana). */
export const CLEAN_FROM = '2026-11-06';
/**
 * Días que no cuentan como normales (huelgas, temporales, cortes grandes...).
 * 10 y 12-11-2026: huelga de maquinistas (Semaf); 11-11-2026: huelga general.
 */
export const EXCLUDED_DAYS: string[] = ['2026-11-10', '2026-11-11', '2026-11-12'];
/** Festivos nacionales: cuentan como domingo. */
export const HOLIDAYS = ['2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06'];
/** Solo se miran las últimas semanas, para que los cambios de horario no arrastren datos viejos. */
export const WINDOW_DAYS = 42;
/** Con menos días que estos, una estadística no se da (devuelve null). */
export const MIN_DAYS = 4;
/** Puntual = menos de 3 min de retraso. */
export const PUNCTUAL_SEC = 180;

export type DayType = 'lab' | 'sab' | 'dom';

/** Tipo de día de una fecha (YYYY-MM-DD o YYYYMMDD). */
export function dayType(date: string): DayType {
  const iso = date.includes('-') ? date : `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  if (HOLIDAYS.includes(iso)) return 'dom';
  const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return wd === 0 ? 'dom' : wd === 6 ? 'sab' : 'lab';
}

/** Cuántos días salió de verdad un tren (por número y tipo de día). */
export interface TrainReliability {
  days: number;
  /** Con datos de Renfe (circuló). */
  ran: number;
  cancelled: number;
  /** Renfe nunca dio señal: puede que circulase sin datos o que no saliese. */
  noData: number;
}

/** Cómo suele llegar un tren a una parada concreta. */
export interface TrainAtStop {
  days: number;
  medianDelaySec: number;
  /** Días que llegó con menos de 3 min de retraso. */
  punctualDays: number;
}

/** Lo normal en una línea a una hora del día (por la hora de salida de origen de sus trenes). */
export interface LineBaseline {
  days: number;
  runs: number;
  medianDelaySec: number;
  /** Proporción de pasos por parada con menos de 3 min de retraso (0-1). */
  punctualShare: number;
}

export interface Insights {
  loadedAt: number;
  /** Días de referencia usados (ya sin los excluidos). */
  days: number;
  reliability(network: string, train: string, dt: DayType): TrainReliability | null;
  atStop(network: string, train: string, dt: DayType, stopId: string): TrainAtStop | null;
  line(network: string, line: string, dt: DayType, hour: number): LineBaseline | null;
  counts(): { trains: number; trainStops: number; lines: number };
}

// Clasifica cada viaje por tipo de día en SQL, con los mismos festivos que dayType().
// Cada estadística se calcula dos veces: por tipo de día y con todos los días juntos (dt = '*'),
// que es la que se usa mientras un tipo de día no llega al mínimo (los fines de semana solo suman
// un día por semana; tardarían un mes).
const BASE = `
  with r as (
    select network, train, line, trip_id, service_date, dep_time, status, stops, delays,
      case
        when service_date = any($3::date[]) then 'dom'
        when extract(isodow from service_date) = 7 then 'dom'
        when extract(isodow from service_date) = 6 then 'sab'
        else 'lab'
      end as dt
    from train_runs
    where service_date >= $1::date and service_date < $4::date and not (service_date = any($2::date[]))
  )`;

const Q_DAYS = `${BASE} select count(distinct service_date)::int as days from r`;

const Q_RELIABILITY = `${BASE}
  select network, train, coalesce(dt, '*') as dt,
    count(*)::int as days,
    count(*) filter (where status = 'ok')::int as ran,
    count(*) filter (where status = 'cancelled')::int as cancelled,
    count(*) filter (where status = 'no_data')::int as no_data
  from r group by grouping sets ((network, train, dt), (network, train))
  having count(*) >= ${MIN_DAYS}`;

const Q_AT_STOP = `${BASE}
  select r.network, r.train, coalesce(r.dt, '*') as dt, u.stop,
    count(*)::int as days,
    round(percentile_cont(0.5) within group (order by u.delay))::int as median,
    count(*) filter (where u.delay < ${PUNCTUAL_SEC})::int as punctual
  from r cross join lateral unnest(r.stops, r.delays) as u(stop, delay)
  where r.status = 'ok' and u.delay is not null
  group by grouping sets ((r.network, r.train, r.dt, u.stop), (r.network, r.train, u.stop))
  having count(*) >= ${MIN_DAYS}`;

const Q_LINE = `${BASE}
  select r.network, r.line, coalesce(r.dt, '*') as dt, (r.dep_time / 3600) % 24 as hour,
    count(distinct r.service_date)::int as days,
    count(distinct (r.service_date, r.trip_id))::int as runs,
    round(percentile_cont(0.5) within group (order by u.delay))::int as median,
    (count(*) filter (where u.delay < ${PUNCTUAL_SEC}))::float / count(*) as punctual
  from r cross join lateral unnest(r.stops, r.delays) as u(stop, delay)
  where r.status = 'ok' and u.delay is not null
  group by grouping sets (
    (r.network, r.line, r.dt, (r.dep_time / 3600) % 24),
    (r.network, r.line, (r.dep_time / 3600) % 24)
  )
  having count(distinct r.service_date) >= ${MIN_DAYS}`;

const isoOf = (d: string) => (d.includes('-') ? d : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);

function minusDays(iso: string, n: number): string {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
}

/**
 * Calcula las estadísticas con los días completos anteriores a `today` (YYYYMMDD o YYYY-MM-DD).
 * Hoy no cuenta: aún está a medias.
 */
export async function loadInsights(db: Db, today: string, nowMs = Date.now()): Promise<Insights> {
  const end = isoOf(today);
  const fromWindow = minusDays(end, WINDOW_DAYS);
  const from = fromWindow > CLEAN_FROM ? fromWindow : CLEAN_FROM;
  const params = [from, EXCLUDED_DAYS, HOLIDAYS, end];

  const [daysRes, relRes, stopRes, lineRes] = await Promise.all([
    db.query<{ days: number }>(Q_DAYS, params),
    db.query<{ network: string; train: string; dt: DayType | '*'; days: number; ran: number; cancelled: number; no_data: number }>(
      Q_RELIABILITY,
      params,
    ),
    db.query<{ network: string; train: string; dt: DayType | '*'; stop: string; days: number; median: number; punctual: number }>(
      Q_AT_STOP,
      params,
    ),
    db.query<{ network: string; line: string; dt: DayType | '*'; hour: number; days: number; runs: number; median: number; punctual: number }>(
      Q_LINE,
      params,
    ),
  ]);

  const rel = new Map<string, TrainReliability>();
  for (const x of relRes.rows)
    rel.set(`${x.network}|${x.train}|${x.dt}`, { days: x.days, ran: x.ran, cancelled: x.cancelled, noData: x.no_data });

  // Por tren y tipo de día, sus paradas. Se guarda compacto: [días, mediana, puntuales].
  const stops = new Map<string, Map<string, [number, number, number]>>();
  for (const x of stopRes.rows) {
    const k = `${x.network}|${x.train}|${x.dt}`;
    let m = stops.get(k);
    if (!m) stops.set(k, (m = new Map()));
    m.set(x.stop, [x.days, x.median, x.punctual]);
  }

  const lines = new Map<string, LineBaseline>();
  for (const x of lineRes.rows)
    lines.set(`${x.network}|${x.line}|${x.dt}|${Number(x.hour)}`, {
      days: x.days,
      runs: x.runs,
      medianDelaySec: x.median,
      punctualShare: Number(x.punctual),
    });

  let trainStops = 0;
  for (const [k, m] of stops) if (!k.endsWith('|*')) trainStops += m.size;

  return {
    loadedAt: nowMs,
    days: daysRes.rows[0]?.days ?? 0,
    // Primero el mismo tipo de día; si aún no llega al mínimo, todos los días juntos.
    reliability: (n, t, dt) => rel.get(`${n}|${t}|${dt}`) ?? rel.get(`${n}|${t}|*`) ?? null,
    atStop: (n, t, dt, stopId) => {
      const s = stops.get(`${n}|${t}|${dt}`)?.get(stopId) ?? stops.get(`${n}|${t}|*`)?.get(stopId);
      return s ? { days: s[0], medianDelaySec: s[1], punctualDays: s[2] } : null;
    },
    // En fin de semana, la de todos los días incluye laborables (suelen ir peor): avisa de menos, no de más.
    line: (n, l, dt, hour) => lines.get(`${n}|${l}|${dt}|${hour}`) ?? lines.get(`${n}|${l}|*|${hour}`) ?? null,
    // Sin contar dos veces lo agrupado con todos los días juntos.
    counts: () => ({
      trains: new Set([...rel.keys()].map((k) => k.slice(0, k.lastIndexOf('|')))).size,
      trainStops,
      lines: lines.size,
    }),
  };
}

/** Una línea que hoy va claramente peor de lo normal a esta hora. */
export interface LineAnomaly {
  network: string;
  line: string;
  /** Mediana del retraso de los trenes que circulan ahora mismo. */
  nowDelaySec: number;
  normalDelaySec: number;
  trains: number;
}

/** Hace falta al menos este empeoramiento (mediana) para avisar... */
export const ANOMALY_EXTRA_SEC = 5 * 60;
/** ...y con al menos estos trenes en circulación, para no avisar por un solo tren. */
export const ANOMALY_MIN_TRAINS = 3;

/**
 * Compara el retraso actual de cada línea con lo normal para esta hora y tipo de día.
 * `live`: un retraso (s) por tren que circula ahora, con su núcleo y línea.
 */
export function lineAnomalies(
  insights: Insights,
  live: { network: string; line: string; delaySec: number }[],
  dt: DayType,
  hour: number,
): LineAnomaly[] {
  const byLine = new Map<string, number[]>();
  for (const t of live) {
    const k = `${t.network}|${t.line}`;
    const a = byLine.get(k);
    if (a) a.push(t.delaySec);
    else byLine.set(k, [t.delaySec]);
  }
  const out: LineAnomaly[] = [];
  for (const [k, delays] of byLine) {
    if (delays.length < ANOMALY_MIN_TRAINS) continue;
    const [network, line] = k.split('|');
    // Lo normal de esta hora; si no hay datos de esta hora exacta, la anterior (trenes que salieron antes).
    const base = insights.line(network, line, dt, hour) ?? insights.line(network, line, dt, (hour + 23) % 24);
    if (!base) continue;
    const now = median(delays);
    if (now - base.medianDelaySec >= ANOMALY_EXTRA_SEC)
      out.push({ network, line, nowDelaySec: now, normalDelaySec: base.medianDelaySec, trains: delays.length });
  }
  return out.sort((a, b) => b.nowDelaySec - b.normalDelaySec - (a.nowDelaySec - a.normalDelaySec));
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
