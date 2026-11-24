import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import type { ArrivalsResponse, HealthResponse, Stop, StopTimetable, TrainMatch, TripShape, TripTimes } from '@renfe/shared';
import Fastify from 'fastify';
import { alertsForStop } from './alerts.js';
import { getArrivals, leftOrigin } from './arrivals.js';
import { downloadGtfs, loadGtfs } from './gtfs/loader.js';
import type { GtfsData } from './gtfs/types.js';
import { tripLiveNow } from './live.js';
import { createAlertsPoller } from './realtime/alerts.js';
import { createRealtimeMemory } from './realtime/memory.js';
import { createRealtimePoller } from './realtime/poller.js';
import { createVehiclePoller } from './realtime/vehicles.js';
import { tripPath } from './shape.js';
import { findTrains } from './trains.js';
import { getStopTimetable, getTripTimes } from './timetable.js';
import { withPunctuality } from './punctuality.js';
import { registerStats } from './stats.js';
import { createHistory } from './history/index.js';
import { dayType, lineAnomalies, type LineAnomaly } from './history/insights.js';
import { addDays, localDate, tzOffsetMs } from './time.js';

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

// Último dato de cada tren: si deja de salir en el feed, no se pierden su retraso ni su posición.
const memory = createRealtimeMemory();
const realtime = createRealtimePoller(
  RT_INTERVAL_MS,
  (m) => app.log.warn(m),
  (trips, at) => memory.onTrips(trips, at),
);
// Una sola descarga cada 30 s para todos los usuarios: seguir un tren solo lee de memoria.
const positions = createVehiclePoller(
  VP_INTERVAL_MS,
  (m) => app.log.warn(m),
  (vehicles, at) => memory.onVehicles(vehicles, at),
);
/** Lo que se sabe en tiempo real, con el último dato de los trenes que han dejado de salir. */
const rtView = () => ({ trips: realtime.state.trips, vehicles: positions.state.vehicles, memory: memory.trips });
// Los avisos cambian poco: cada 2 min basta.
const alerts = createAlertsPoller(2 * 60_000, (m) => app.log.warn(m));
// Histórico de retrasos (Postgres en DATABASE_URL). Cada 10 s mira si hay una lectura nueva del feed.
const history = createHistory(
  process.env.DATABASE_URL,
  () => gtfs,
  { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) },
  process.env.HISTORY_READ_ONLY === '1',
);
setInterval(() => history.observe(realtime.state, positions.state.vehicles), 10_000);

const localHour = (ms: number) => new Date(ms + tzOffsetMs(ms)).getUTCHours();

/**
 * Líneas que hoy van peor de lo normal a esta hora. Se calcula una vez por lectura del feed.
 * Solo cuentan los trenes que circulan (con posición y ya fuera de su origen: los que siguen en
 * él suman retraso sin parar y no dicen cómo va la línea).
 */
let anomaliesCache: { key: string; value: LineAnomaly[] } = { key: '', value: [] };
function currentAnomalies(): LineAnomaly[] {
  const ins = history.insights();
  if (!gtfs || !ins) return [];
  const now = Date.now();
  const hour = localHour(now);
  const key = `${realtime.state.fetchedAt}|${ins.loadedAt}|${hour}`;
  if (anomaliesCache.key === key) return anomaliesCache.value;
  const live: { network: string; line: string; delaySec: number }[] = [];
  for (const [tripId, rt] of realtime.state.trips) {
    const v = positions.state.vehicles.get(tripId);
    if (rt.cancelled || rt.delaySec == null || !v || !leftOrigin(gtfs, tripId, v)) continue;
    const routeId = gtfs.trips.get(tripId)?.routeId;
    const line = routeId && gtfs.lines.get(routeId)?.name;
    if (routeId && line) live.push({ network: routeId.slice(0, 2), line, delaySec: rt.delaySec });
  }
  anomaliesCache = { key, value: lineAnomalies(ins, live, dayType(localDate(now)), hour) };
  return anomaliesCache.value;
}

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
    arrivals: withPunctuality(
      getArrivals(gtfs, rtView(), stop.id, now, { limit: 60 }),
      gtfs,
      history.insights(),
      stop.id,
      now,
    ),
    alerts: alertsForStop(gtfs, alerts.state.alerts, stop.id, currentAnomalies()),
  };
  reply.header('Cache-Control', 'no-store');
  return res;
});

// Horario programado de todo el día (day=0 hoy, 1 mañana). No depende del tiempo real.
app.get<{ Params: { id: string }; Querystring: { day?: string } }>('/api/stops/:id/timetable', async (req, reply) => {
  if (!gtfs) return reply.code(503).send({ error: 'Cargando datos de Renfe, prueba en unos segundos' });
  const day = req.query.day === '1' ? 1 : 0;
  const now = Date.now();
  // Hoy lleva la hora real de los que ya han pasado: cambia a cada minuto.
  const live = day === 0 ? { nowMs: now, observed: history.observed } : undefined;
  const res: StopTimetable | null = getStopTimetable(gtfs, req.params.id, addDays(localDate(now), day), live);
  if (!res) return reply.code(404).send({ error: 'Parada no encontrada' });
  reply.header('Cache-Control', `public, max-age=${day === 0 ? 60 : 600}`);
  return res;
});

app.get<{ Params: { tripId: string } }>('/api/trips/:tripId/live', async (req, reply) => {
  if (!gtfs) return reply.code(503).send({ error: 'Cargando datos de Renfe, prueba en unos segundos' });
  const { tripId } = req.params;
  const res = tripLiveNow(gtfs, tripId, rtView(), Date.now());
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

// Recorrido del tren (day=0 hoy, 1 mañana): paradas, hora programada y, hoy, la real en las ya pasadas.
app.get<{ Params: { tripId: string }; Querystring: { day?: string } }>('/api/trips/:tripId/stops', async (req, reply) => {
  if (!gtfs) return reply.code(503).send({ error: 'Cargando datos de Renfe, prueba en unos segundos' });
  const day = req.query.day === '1' ? 1 : 0;
  const now = Date.now();
  const live = day === 0 ? { nowMs: now, observed: history.observed } : undefined;
  const res: TripTimes | null = getTripTimes(gtfs, req.params.tripId, addDays(localDate(now), day), live);
  if (!res) return reply.code(404).send({ error: 'Tren no encontrado' });
  reply.header('Cache-Control', `public, max-age=${day === 0 ? 30 : 3600}`);
  return res;
});

// Buscar un tren por su número (5 cifras): dónde está ahora o de dónde sale.
app.get<{ Params: { number: string } }>('/api/trains/:number', async (req, reply) => {
  if (!gtfs) return reply.code(503).send({ error: 'Cargando datos de Renfe, prueba en unos segundos' });
  const { number } = req.params;
  if (!/^\d{5}$/.test(number)) return reply.code(400).send({ error: 'El número de tren tiene 5 cifras' });
  const res: TrainMatch[] = findTrains(
    gtfs,
    rtView(),
    number,
    Date.now(),
  );
  reply.header('Cache-Control', 'no-store');
  return res;
});

// Para comprobar las estadísticas: qué líneas van hoy peor de lo normal a esta hora.
app.get('/api/insights', async (_req, reply) => {
  reply.header('Cache-Control', 'no-store');
  if (!gtfs || !history.insights()) return { ready: false, status: history.status.insights };
  const now = Date.now();
  return {
    ready: true,
    status: history.status.insights,
    dayType: dayType(localDate(now)),
    hour: localHour(now),
    anomalies: currentAnomalies(),
  };
});

registerStats(app);

await app.listen({ port: PORT, host: '0.0.0.0' });
void refreshGtfs();
