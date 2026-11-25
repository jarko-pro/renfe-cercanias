import type { BusFeed, Log } from './index.js';
import { createOnDemandFeed, dailyQuota } from './ondemand.js';
import type { TmbConfig } from './registry.js';
import {
  buildTmbStatic,
  tmbArrivals,
  type TmbFeature,
  type TmbLineProps,
  type TmbLineStopProps,
  type TmbStopProps,
  type TmbTrajecte,
} from './tmb.js';

const TIMEOUT_MS = 10_000;
const STATIC_TIMEOUT_MS = 60_000;

export function createTmbFeed(cfg: TmbConfig, creds: { appId: string; appKey: string }, log: Log): BusFeed {
  const quota = dailyQuota(cfg.dailyLimit);
  const auth = `app_id=${encodeURIComponent(creds.appId)}&app_key=${encodeURIComponent(creds.appKey)}`;

  /** Las claves van en la URL: los errores solo dicen la ruta, nunca la URL entera. */
  async function api<T>(path: string, query = '', timeout = TIMEOUT_MS): Promise<T> {
    quota.take();
    const res = await fetch(`${cfg.base}${path}?${query ? `${query}&` : ''}${auth}`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  type Collection<P> = { features?: TmbFeature<P>[] };

  return createOnDemandFeed(
    { id: cfg.id, cacheMs: cfg.cacheMs, minStops: 1000 },
    {
      async loadStatic() {
        // Solo los campos que se usan: sin ellos, los recorridos con su trazado pesan varios MB.
        const [stops, lines, lineStops] = await Promise.all([
          api<Collection<TmbStopProps>>('/v1/transit/parades', 'propertyName=CODI_PARADA,NOM_PARADA,GEOMETRY', STATIC_TIMEOUT_MS),
          api<Collection<TmbLineProps>>(
            '/v1/transit/linies/bus',
            'propertyName=CODI_LINIA,NOM_LINIA,COLOR_LINIA,COLOR_TEXT_LINIA',
            STATIC_TIMEOUT_MS,
          ),
          api<Collection<TmbLineStopProps>>(
            '/v1/transit/linies/bus/parades',
            'propertyName=CODI_LINIA,CODI_PARADA,DESTI_SENTIT',
            STATIC_TIMEOUT_MS,
          ),
        ]);
        return buildTmbStatic(cfg.id, stops.features ?? [], lines.features ?? [], lineStops.features ?? [], Date.now());
      },
      async fetchStop(code) {
        const json = await api<{ parades?: { linies_trajectes?: TmbTrajecte[] }[] }>(
          `/v1/itransit/bus/parades/${encodeURIComponent(code)}`,
        );
        return json.parades?.[0]?.linies_trajectes ?? [];
      },
      arrivals: tmbArrivals,
      requestsToday: () => quota.count,
    },
    log,
  );
}
