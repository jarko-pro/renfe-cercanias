import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import type { ArrivalsResponse, HealthResponse, Stop, TripShape } from '@renfe/shared';
import Fastify from 'fastify';
import { alertsForStop } from './alerts.js';
import { getArrivals } from './arrivals.js';
import { downloadGtfs, loadGtfs } from './gtfs/loader.js';
import type { GtfsData } from './gtfs/types.js';
import { buildTripLive } from './live.js';
import { createAlertsPoller } from './realtime/alerts.js';
import { createRealtimePoller } from './realtime/poller.js';
import { createVehiclePoller } from './realtime/vehicles.js';
import { tripPath } from './shape.js';
import { registerStats } from './stats.js';
import { createHistory } from './history/index.js';
import { localDate } from './time.js';

const PORT = Number(process.env.PORT ?? 3001);
const ZIP_PATH = fileURLToPath(new URL('../data/fomento_transit.zip', import.meta.url));
const GTFS_MAX_AGE_MS = 12 * 3600_000;
const RT_INTERVAL_MS = 30_000;
/** Renfe regenera las posiciones cada ~30 s: pedirlas más a menudo no aporta nada. */
const VP_INTERVAL_MS = 30_000;

// trustProxy: detrás del proxy de Render, req.ip es la IP real del usuario (X-Forwarded-For).
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    // Sin IP ni otros datos del usuario en los registros: solo método y ruta.
    serializers: { req: (req) => ({ method: req.method, url: req.url }) },
  },
  trustProxy: true,
});
await app.register(cors, { origin: true });

let gtfs: GtfsData | null = null;
let gtfsError: string | null = null;
let stopsJson = '[]';
let stopsEtag = '';
let loading = false;

async function refreshGtfs() {
  if (loading) return;
  loading = true;
  try {
    const t0 = Date.now();
    await downloadGtfs(ZIP_PATH, GTFS_MAX_AGE_MS);
    const data = await loadGtfs(ZIP_PATH);
    const stops: Stop[] = [...data.stops.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    stopsJson = JSON.stringify(stops);
    stopsEtag = `"${createHash('sha1').update(stopsJson).digest('hex').slice(0, 16)}"`;
    gtfs = data;
    gtfsError = null;
    app.log.info(
      `GTFS cargado en ${((Date.now() - t0) / 1000).toFixed(1)} s: ${stops.length} paradas, ${data.trips.size} viajes activos`,
    );
  } catch (err) {
    gtfsError = (err as Error).message;
    app.log.error(err, 'Error cargando GTFS');
  } finally {
    loading = false;
  }
}

const realtime = createRealtimePoller(RT_INTERVAL_MS, (m) => app.log.warn(m));
// Una sola descarga cada 30 s para todos los usuarios: seguir un tren solo lee de memoria.
const positions = createVehiclePoller(VP_INTERVAL_MS, (m) => app.log.warn(m));
// Los avisos cambian poco: cada 2 min basta.
const alerts = createAlertsPoller(2 * 60_000, (m) => app.log.warn(m));
// Histórico de retrasos (Postgres en DATABASE_URL). Cada 10 s mira si hay una lectura nueva del feed.
const history = createHistory(process.env.DATABASE_URL, () => gtfs, {
  info: (m) => app.log.info(m),
  warn: (m) => app.log.warn(m),
});
setInterval(() => history.observe(realtime.state, positions.state.vehicles), 10_000);

// Render (plan gratuito) duerme el servidor tras 15 min sin tráfico entrante. Llamar a
// nuestra propia URL pública sale a internet y vuelve a entrar por Render, así que cuenta
// como visita. RENDER_EXTERNAL_URL lo define Render; en local no existe y no se hace nada.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    fetch(`${SELF_URL}/api/health`, { signal: AbortSignal.timeout(30_000) })
      .then((res) => app.log.info(`Auto-ping OK (HTTP ${res.status})`))
      .catch((err) => app.log.warn(`Auto-ping fallido: ${(err as Error).message}`));
  }, 10 * 60_000);
}

// Recarga el GTFS cuando cambia el día local (los índices cubren ayer/hoy/mañana).
setInterval(() => {
  if (gtfs && gtfs.today !== localDate(Date.now())) void refreshGtfs();
}, 10 * 60_000);

// Render llama a /api/health cada 5 s (healthCheckPath): no se registra para no llenar los logs.
app.get('/api/health', { logLevel: 'warn' }, async (): Promise<HealthResponse> => ({
  ok: gtfs != null,
  gtfsLoadedAt: gtfs?.loadedAt ?? null,
  gtfsStops: gtfs?.stops.size ?? 0,
  realtimeFetchedAt: realtime.state.fetchedAt,
  realtimeTrips: realtime.state.trips.size,
  vehicles: positions.state.vehicles.size,
  alerts: alerts.state.alerts.length,
  history: { ...history.status },
  ...(gtfsError ? { error: gtfsError } : {}),
}));

app.get('/api/stops', async (req, reply) => {
  if (!gtfs) return reply.code(503).send({ error: 'Cargando datos de Renfe, prueba en unos segundos' });
  reply.header('ETag', stopsEtag).header('Cache-Control', 'public, max-age=300');
  if (req.headers['if-none-match'] === stopsEtag) return reply.code(304).send();
  return reply.type('application/json').send(stopsJson);
});

app.get<{ Params: { id: string } }>('/api/stops/:id/arrivals', async (req, reply) => {
  if (!gtfs) return reply.code(503).send({ error: 'Cargando datos de Renfe, prueba en unos segundos' });
  const stop = gtfs.stops.get(req.params.id);
  if (!stop) return reply.code(404).send({ error: 'Parada no encontrada' });
  const now = Date.now();
  const res: ArrivalsResponse = {
    stop,
    generatedAt: now,
    realtimeAgeSec: realtime.state.fetchedAt ? Math.round((now - realtime.state.fetchedAt) / 1000) : null,
    // Se devuelven todos los de la ventana: la app separa salidas/llegadas y filtra por línea.
    arrivals: getArrivals(
      gtfs,
      { trips: realtime.state.trips, vehicles: positions.state.vehicles },
      stop.id,
      now,
      { limit: 60 },
    ),
    alerts: alertsForStop(gtfs, alerts.state.alerts, stop.id),
  };
  reply.header('Cache-Control', 'no-store');
  return res;
});

app.get<{ Params: { tripId: string } }>('/api/trips/:tripId/live', async (req, reply) => {
  if (!gtfs) return reply.code(503).send({ error: 'Cargando datos de Renfe, prueba en unos segundos' });
  const { tripId } = req.params;
  const res = buildTripLive(gtfs, tripId, positions.state.vehicles.get(tripId), realtime.state.trips.get(tripId));
  if (!res) return reply.code(404).send({ error: 'Tren no encontrado' });
  reply.header('Cache-Control', 'no-store');
  return res;
});

// Trazado del viaje: no cambia en el día, así que la web lo pide una vez y se puede cachear.
app.get<{ Params: { tripId: string } }>('/api/trips/:tripId/shape', async (req, reply) => {
  if (!gtfs) return reply.code(503).send({ error: 'Cargando datos de Renfe, prueba en unos segundos' });
  const { tripId } = req.params;
  if (!gtfs.trips.has(tripId)) return reply.code(404).send({ error: 'Tren no encontrado' });
  const res: TripShape = { tripId, path: tripPath(gtfs, tripId) ?? [] };
  reply.header('Cache-Control', 'public, max-age=3600');
  return res;
});

registerStats(app);

await app.listen({ port: PORT, host: '0.0.0.0' });
void refreshGtfs();
