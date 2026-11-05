import type { FastifyInstance } from 'fastify';

/**
 * Estadísticas de uso: la web manda aquí la visita y los eventos y este servidor se los
 * reenvía a Umami Cloud. Así no los cortan los bloqueadores de anuncios, que bloquean
 * cloud.umami.is pero no nuestra propia API (sin ella la app no funcionaría).
 */

const UMAMI_SEND_URL = 'https://cloud.umami.is/api/send';
/** ID público de la web en Umami. Solo se reenvía lo que venga para esta web. */
const WEBSITE_ID = process.env.UMAMI_ID ?? '7f703cd1-7662-449f-8100-8c59c01b53c6';
/** Eventos que manda la web (`null` = visita). Cualquier otro se ignora. */
const EVENTS = new Set(['estacion', 'seguir-tren', 'favorita', 'app-instalada', 'app-abierta']);

interface Body {
  website?: unknown;
  name?: unknown;
  data?: unknown;
  url?: unknown;
  title?: unknown;
  referrer?: unknown;
  hostname?: unknown;
  language?: unknown;
  screen?: unknown;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Hasta 5 propiedades sencillas, recortadas. */
function cleanData(v: unknown): Record<string, string | number> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(v).slice(0, 5)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k.slice(0, 30)] = val;
    else if (typeof val === 'string') out[k.slice(0, 30)] = val.slice(0, 100);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Construye lo que se envía a Umami, o null si la petición no es válida. */
export function umamiPayload(body: Body, ip: string, userAgent: string) {
  if (body.website !== WEBSITE_ID) return null;
  const name = body.name == null ? undefined : str(body.name, 50);
  if (name !== undefined && !EVENTS.has(name)) return null;
  return {
    type: 'event',
    payload: {
      website: WEBSITE_ID,
      hostname: str(body.hostname, 100),
      url: str(body.url, 300) ?? '/',
      title: str(body.title, 200),
      referrer: str(body.referrer, 300),
      language: str(body.language, 35),
      screen: str(body.screen, 20),
      ...(name ? { name, data: cleanData(body.data) } : {}),
      // IP y navegador del usuario, no los de Render: si no, todo saldría desde Alemania.
      ip,
      userAgent,
    },
  };
}

export function registerStats(app: FastifyInstance) {
  app.post<{ Body: Body }>('/api/e', { logLevel: 'warn', bodyLimit: 4096 }, async (req, reply) => {
    const userAgent = req.headers['user-agent'] ?? '';
    const payload = umamiPayload(req.body ?? {}, req.ip, userAgent);
    if (!payload) return reply.code(400).send();
    // No se espera a Umami: la app no tiene por qué notar si va lento o falla.
    fetch(UMAMI_SEND_URL, {
      method: 'POST',
      // La ubicación sale de `payload.ip` (comprobado: Umami Cloud ignora X-Forwarded-For).
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
      .then((res) => {
        if (!res.ok) app.log.warn(`Umami respondió HTTP ${res.status}`);
      })
      .catch((err) => app.log.warn(`No se pudo enviar a Umami: ${(err as Error).message}`));
    return reply.code(204).send();
  });
}
