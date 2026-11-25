import { buildEmtStatic, emtArrivals, type EmtArriveRaw, type EmtLineRaw, type EmtStopRaw } from './emt.js';
import type { BusFeed, Log } from './index.js';
import { createOnDemandFeed, dailyQuota, localDate } from './ondemand.js';
import type { EmtConfig } from './registry.js';

/** Tope propio, por debajo de las 250.000 consultas diarias de MobilityLabs. */
const DAILY_LIMIT = 200_000;
const TIMEOUT_MS = 10_000;

interface EmtJson<T> {
  code?: string;
  description?: string;
  data?: T;
}

export function createEmtFeed(cfg: EmtConfig, creds: { clientId: string; passKey: string }, log: Log): BusFeed {
  let token: string | null = null;
  let tokenUntil = 0;
  let loggingIn: Promise<string> | null = null;
  const quota = dailyQuota(DAILY_LIMIT);

  async function login(): Promise<string> {
    const res = await fetch(`${cfg.base}/v1/mobilitylabs/user/login/`, {
      headers: { 'X-ClientId': creds.clientId, passKey: creds.passKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json()) as EmtJson<{ accessToken?: string; tokenSecExpiration?: number }[]>;
    const d = json.data?.[0];
    if (!res.ok || !d?.accessToken) throw new Error(`login EMT: HTTP ${res.status}, código ${json.code ?? '?'}`);
    token = d.accessToken;
    // Se renueva 10 min antes de que caduque (suele durar 24 h).
    tokenUntil = Date.now() + Math.max(60, (d.tokenSecExpiration ?? 3600) - 600) * 1000;
    return token;
  }

  async function getToken(): Promise<string> {
    if (token && Date.now() < tokenUntil) return token;
    loggingIn ??= login().finally(() => (loggingIn = null));
    return loggingIn;
  }

  /** Llamada a la API con el token; si la EMT lo da por caducado, se vuelve a entrar una vez. */
  async function api<T>(path: string, init: { method?: string; body?: string } = {}): Promise<EmtJson<T>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      quota.take();
      const res = await fetch(`${cfg.base}${path}`, {
        method: init.method ?? 'GET',
        headers: { accessToken: await getToken(), 'Content-Type': 'application/json' },
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as EmtJson<T>;
      const authFailed = res.status === 401 || res.status === 403 || (/token/i.test(json.description ?? '') && json.code !== '00');
      if (authFailed && attempt === 0) {
        token = null;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return json;
    }
    throw new Error('token de la EMT rechazado');
  }

  return createOnDemandFeed(
    { id: cfg.id, cacheMs: cfg.cacheMs, minStops: 1000 },
    {
      async loadStatic(now) {
        // stops/list sin cuerpo: con "{}" la EMT responde un error interno.
        const [stops, lines] = await Promise.all([
          api<EmtStopRaw[]>('/v1/transport/busemtmad/stops/list/', { method: 'POST' }),
          api<EmtLineRaw[]>(`/v2/transport/busemtmad/lines/info/${localDate(now)}/`),
        ]);
        if (stops.code !== '00' || lines.code !== '00') {
          throw new Error(`códigos ${stops.code ?? '?'} / ${lines.code ?? '?'}`);
        }
        return buildEmtStatic(cfg.id, stops.data ?? [], lines.data ?? [], Date.now());
      },
      async fetchStop(code) {
        const body = {
          cultureInfo: 'ES',
          Text_StopRequired_YN: 'N',
          Text_EstimationsRequired_YN: 'Y',
          Text_IncidencesRequired_YN: 'N',
          DateTime_Referenced_Incidencies_YYYYMMDD: localDate(Date.now()),
        };
        const json = await api<{ Arrive?: EmtArriveRaw[] }[]>(
          `/v2/transport/busemtmad/stops/${encodeURIComponent(code)}/arrives/`,
          { method: 'POST', body: JSON.stringify(body) },
        );
        if (json.code !== '00') throw new Error(`código ${json.code ?? '?'}: ${(json.description ?? '').slice(0, 80)}`);
        return json.data?.[0]?.Arrive ?? [];
      },
      arrivals: emtArrivals,
      requestsToday: () => quota.count,
    },
    log,
  );
}
