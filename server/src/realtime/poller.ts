import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { transit_realtime: rt } = GtfsRealtimeBindings;

export const TRIP_UPDATES_URL = process.env.RT_URL ?? 'https://gtfsrt.renfe.com/trip_updates.pb';

export interface StopUpdate {
  /** Hora estimada (epoch ms) si el feed la da. */
  time?: number;
  delaySec?: number;
  skipped: boolean;
}

export interface TripRealtime {
  delaySec?: number;
  cancelled: boolean;
  stops: Map<string, StopUpdate>;
}

export interface RealtimeState {
  fetchedAt: number | null;
  feedTimestamp: number | null;
  trips: Map<string, TripRealtime>;
}

type LongLike = number | { toNumber(): number } | null | undefined;
const num = (v: LongLike): number | undefined =>
  v == null ? undefined : typeof v === 'number' ? v : v.toNumber();

export function parseTripUpdates(buf: Uint8Array): Omit<RealtimeState, 'fetchedAt'> {
  const feed = rt.FeedMessage.decode(buf);
  const trips = new Map<string, TripRealtime>();
  const CANCELED = rt.TripDescriptor.ScheduleRelationship.CANCELED;
  const SKIPPED = rt.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED;

  for (const e of feed.entity) {
    const tu = e.tripUpdate;
    const tripId = tu?.trip?.tripId;
    if (!tu || !tripId) continue;
    const stops = new Map<string, StopUpdate>();
    for (const s of tu.stopTimeUpdate ?? []) {
      if (!s.stopId) continue;
      const ev = s.arrival ?? s.departure;
      const t = num(ev?.time as LongLike);
      stops.set(s.stopId, {
        time: t ? t * 1000 : undefined,
        delaySec: ev?.delay ?? undefined,
        skipped: s.scheduleRelationship === SKIPPED,
      });
    }
    const firstDelay = [...stops.values()].find((s) => s.delaySec != null)?.delaySec;
    trips.set(tripId, {
      delaySec: tu.delay ?? firstDelay,
      cancelled: tu.trip?.scheduleRelationship === CANCELED,
      stops,
    });
  }
  return { feedTimestamp: (num(feed.header.timestamp as LongLike) ?? 0) * 1000 || null, trips };
}

export function createRealtimePoller(intervalMs: number, log: (msg: string) => void) {
  const state: RealtimeState = { fetchedAt: null, feedTimestamp: null, trips: new Map() };

  async function tick() {
    try {
      const res = await fetch(TRIP_UPDATES_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseTripUpdates(new Uint8Array(await res.arrayBuffer()));
      state.trips = parsed.trips;
      state.feedTimestamp = parsed.feedTimestamp;
      state.fetchedAt = Date.now();
    } catch (err) {
      log(`Error leyendo tiempo real: ${(err as Error).message}`);
    }
  }

  void tick();
  const timer = setInterval(tick, intervalMs);
  return { state, stop: () => clearInterval(timer) };
}
