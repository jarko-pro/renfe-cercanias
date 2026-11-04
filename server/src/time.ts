/** Utilidades de fecha/hora en la zona horaria de Renfe (Europe/Madrid). */
export const TZ = 'Europe/Madrid';

const dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function parts(ms: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Diferencia (ms) entre la hora local de Madrid y UTC en el instante dado. */
export function tzOffsetMs(ms: number): number {
  const p = parts(ms);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Fecha local de Madrid en formato GTFS (YYYYMMDD). */
export function localDate(ms: number): string {
  const p = parts(ms);
  return `${p.year}${p.month}${p.day}`;
}

function splitDate(date: string): [number, number, number] {
  return [+date.slice(0, 4), +date.slice(4, 6), +date.slice(6, 8)];
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = splitDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${t.getUTCFullYear()}${mm}${dd}`;
}

/** 0 = domingo ... 6 = sábado */
export function weekday(date: string): number {
  const [y, m, d] = splitDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Instante de referencia del día de servicio GTFS: "mediodía menos 12 h" en hora local.
 * Los tiempos de stop_times (que pueden pasar de 24:00) se suman a este valor.
 */
export function serviceDayBase(date: string): number {
  const [y, m, d] = splitDate(date);
  const noonUtc = Date.UTC(y, m - 1, d, 12);
  const localNoon = noonUtc - tzOffsetMs(noonUtc);
  return localNoon - 12 * 3600_000;
}

/** "24:05:00" -> segundos desde el inicio del día de servicio. */
export function parseGtfsTime(s: string): number {
  const [h, m, sec] = s.split(':');
  return +h * 3600 + +m * 60 + +(sec ?? 0);
}
