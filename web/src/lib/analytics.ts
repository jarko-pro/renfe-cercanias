/**
 * Estadísticas de uso con Umami Cloud: sin cookies ni datos personales, así que no hace
 * falta banner de consentimiento. Solo se activa en producción y si hay ID configurado
 * (variable VITE_UMAMI_ID en el build); en local no se envía nada.
 */

type EventData = Record<string, string | number>;

declare global {
  interface Window {
    umami?: { track(name: string, data?: EventData): void };
  }
}

const WEBSITE_ID = import.meta.env.VITE_UMAMI_ID as string | undefined;
const enabled = import.meta.env.PROD && !!WEBSITE_ID;

/** Eventos lanzados antes de que cargue el script de Umami. */
const pending: [string, EventData | undefined][] = [];

export function initAnalytics() {
  if (!enabled) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://cloud.umami.is/script.js';
  s.dataset.websiteId = WEBSITE_ID;
  s.onload = () => {
    for (const [name, data] of pending.splice(0)) window.umami?.track(name, data);
  };
  document.head.appendChild(s);

  // Instalaciones: Android avisa con 'appinstalled'; iOS no tiene evento, así que también se
  // cuenta cada vez que se abre como app desde la pantalla de inicio.
  window.addEventListener('appinstalled', () => track('app-instalada'));
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) track('app-abierta');
}

export function track(name: string, data?: EventData) {
  if (!enabled) return;
  if (window.umami) window.umami.track(name, data);
  else pending.push([name, data]);
}
