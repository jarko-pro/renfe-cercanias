import { apiUrl } from './api';

/**
 * Estadísticas de uso (Umami Cloud, sin cookies ni datos personales: no hace falta banner).
 *
 * No se carga el script de Umami: los bloqueadores de anuncios lo cortan. La visita y los
 * eventos se mandan a nuestra propia API (/api/e), que los reenvía a Umami. Solo en
 * producción y si hay ID configurado (VITE_UMAMI_ID en el build); en local no se envía nada.
 */

type EventData = Record<string, string | number>;

const WEBSITE_ID = import.meta.env.VITE_UMAMI_ID as string | undefined;
const enabled = import.meta.env.PROD && !!WEBSITE_ID;

function send(name?: string, data?: EventData) {
  if (!enabled) return;
  const body = {
    website: WEBSITE_ID,
    name,
    data,
    hostname: location.hostname,
    url: location.pathname,
    title: document.title,
    referrer: document.referrer,
    language: navigator.language,
    screen: `${screen.width}x${screen.height}`,
  };
  // keepalive: el envío no se pierde aunque se cierre la pestaña justo después.
  fetch(apiUrl('/api/e'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    /* las estadísticas nunca deben molestar */
  });
}

export function initAnalytics() {
  if (!enabled) return;
  send(); // visita

  // Instalaciones: Android avisa con 'appinstalled'; iOS no tiene evento, así que también se
  // cuenta cada vez que se abre como app desde la pantalla de inicio.
  window.addEventListener('appinstalled', () => track('app-instalada'));
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) track('app-abierta');
}

export const track = (name: string, data?: EventData) => send(name, data);
