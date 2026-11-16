/** Normaliza para búsqueda: minúsculas y sin tildes. */
export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const timeFmt = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Madrid',
});

export const formatTime = (ms: number) => timeFmt.format(ms);

/** Color del retraso: verde en hora, verde amarillento 1-2 min, amarillo 3-5, naranja 6-10, rojo más. */
export function delayClass(min: number): string {
  if (min <= 0) return 'd0';
  if (min <= 2) return 'd1';
  if (min <= 5) return 'd2';
  if (min <= 10) return 'd3';
  return 'd4';
}
