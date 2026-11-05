import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { transit_realtime: rt } = GtfsRealtimeBindings;

export const ALERTS_URL = process.env.ALERTS_URL ?? 'https://gtfsrt.renfe.com/alerts.pb';

export interface AlertInfo {
  id: string;
  text: string;
  routeIds: Set<string>;
  stopIds: Set<string>;
  /** Inicio de vigencia (epoch ms), si viene. */
  start: number | null;
}

export interface AlertsState {
  fetchedAt: number | null;
  alerts: AlertInfo[];
}

type LongLike = number | { toNumber(): number } | null | undefined;
const num = (v: LongLike): number => (v == null ? 0 : typeof v === 'number' ? v : v.toNumber());

/**
 * Deja el texto listo para mostrar. En el País Vasco viene "euskera // castellano": nos
 * quedamos con el castellano. Se quitan etiquetas de redes al principio (#MadC3) y los '#'.
 */
export function cleanAlertText(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  const parts = t.split(' // ');
  if (parts.length > 1) t = parts[parts.length - 1].trim();
  // Etiquetas tipo #MadC3 o #SanSebastianC1 (no #NUEVOS ni #LÍNEA, que forman parte del texto).
  t = t.replace(/^#[A-Z][a-zà-ÿ]+[A-Za-z]*[A-Z0-9]\w*\s+/, '');
  return t.replace(/#/g, '').replace(/\s+/g, ' ').trim();
}

/** Aviso de un tren concreto ("Tren con salida a las 9:00h..."): caduca en unas horas. */
const SINGLE_TRAIN = /tren con salida (prevista )?a las \d/i;
const SINGLE_TRAIN_MAX_AGE_MS = 3 * 3600_000;

/**
 * Avisos vigentes. Renfe no rellena causa, efecto ni gravedad (todo "desconocido") y casi
 * nunca pone fecha de fin, así que se filtra por inicio y se descartan los avisos de trenes
 * concretos ya antiguos, las pruebas y los duplicados.
 */
export function parseAlerts(buf: Uint8Array, nowMs: number): AlertInfo[] {
  const feed = rt.FeedMessage.decode(buf);
  const now = nowMs / 1000;
  const out: AlertInfo[] = [];
  const seen = new Set<string>();
  for (const e of feed.entity) {
    const a = e.alert;
    if (!a) continue;
    const periods = (a.activePeriod ?? []).map((p) => ({ start: num(p.start as LongLike), end: num(p.end as LongLike) }));
    const active =
      !periods.length || periods.some((p) => (!p.start || p.start <= now) && (!p.end || p.end >= now));
    if (!active) continue;

    const raw = a.descriptionText?.translation?.[0]?.text || a.headerText?.translation?.[0]?.text || '';
    const text = cleanAlertText(raw);
    if (text.length < 15 || /^pruebas\b/i.test(text) || seen.has(text)) continue;

    const start = periods.find((p) => p.start)?.start;
    const startMs = start ? start * 1000 : null;
    if (SINGLE_TRAIN.test(text) && startMs && nowMs - startMs > SINGLE_TRAIN_MAX_AGE_MS) continue;

    seen.add(text);
    out.push({
      id: e.id,
      text,
      routeIds: new Set((a.informedEntity ?? []).map((x) => x.routeId).filter((x): x is string => !!x)),
      stopIds: new Set((a.informedEntity ?? []).map((x) => x.stopId).filter((x): x is string => !!x)),
      start: startMs,
    });
  }
  return out;
}

export function createAlertsPoller(intervalMs: number, log: (msg: string) => void) {
  const state: AlertsState = { fetchedAt: null, alerts: [] };

  async function tick() {
    try {
      const res = await fetch(ALERTS_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.alerts = parseAlerts(new Uint8Array(await res.arrayBuffer()), Date.now());
      state.fetchedAt = Date.now();
    } catch (err) {
      log(`Error leyendo avisos: ${(err as Error).message}`);
    }
  }

  void tick();
  const timer = setInterval(tick, intervalMs);
  return { state, stop: () => clearInterval(timer) };
}
