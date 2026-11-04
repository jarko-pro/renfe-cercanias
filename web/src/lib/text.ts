/** Normaliza para búsqueda: minúsculas y sin tildes. */
export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const timeFmt = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Madrid',
});

export const formatTime = (ms: number) => timeFmt.format(ms);
