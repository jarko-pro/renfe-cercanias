import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { transit_realtime: rt } = GtfsRealtimeBindings;

export const VEHICLE_POSITIONS_URL = process.env.VP_URL ?? 'https://gtfsrt.renfe.com/vehicle_positions.pb';

export type VehicleStatus = 'incoming' | 'stopped' | 'in_transit';

export interface VehicleState {
  lat: number | null;
  lon: number | null;
  /** Parada a la que se refiere `status` (la siguiente, o en la que está parado). */
  stopId: string;
  status: VehicleStatus;
  /** Andén/vía, sacado de la etiqueta (`C1-23578-PLATF.(6)`). */
  platform?: string;
  /** Hora de la posición (epoch ms). */
  timestamp: number | null;
}

export interface VehiclesState {
  fetchedAt: number | null;
  vehicles: Map<string, VehicleState>;
}

type LongLike = number | { toNumber(): number } | null | undefined;
const num = (v: LongLike): number | undefined =>
  v == null ? undefined : typeof v === 'number' ? v : v.toNumber();

export const platformFromLabel = (label: string | null | undefined): string | undefined =>
  label ? /PLATF\.\((\w+)\)/.exec(label)?.[1] : undefined;

const STATUS: Record<number, VehicleStatus> = {
  [rt.VehiclePosition.VehicleStopStatus.INCOMING_AT]: 'incoming',
  [rt.VehiclePosition.VehicleStopStatus.STOPPED_AT]: 'stopped',
  [rt.VehiclePosition.VehicleStopStatus.IN_TRANSIT_TO]: 'in_transit',
};

export function parseVehiclePositions(buf: Uint8Array): Map<string, VehicleState> {
  const feed = rt.FeedMessage.decode(buf);
  const out = new Map<string, VehicleState>();
  for (const e of feed.entity) {
    const v = e.vehicle;
    const tripId = v?.trip?.tripId;
    if (!v || !tripId) continue;
    const ts = num(v.timestamp as LongLike);
    out.set(tripId, {
      lat: v.position?.latitude ?? null,
      lon: v.position?.longitude ?? null,
      stopId: v.stopId ?? '',
      // Si no viene estado, el estándar dice IN_TRANSIT_TO.
      status: STATUS[v.currentStatus ?? 2] ?? 'in_transit',
      platform: platformFromLabel(v.vehicle?.label),
      timestamp: ts ? ts * 1000 : null,
    });
  }
  return out;
}

export function createVehiclePoller(intervalMs: number, log: (msg: string) => void) {
  const state: VehiclesState = { fetchedAt: null, vehicles: new Map() };

  async function tick() {
    try {
      const res = await fetch(VEHICLE_POSITIONS_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.vehicles = parseVehiclePositions(new Uint8Array(await res.arrayBuffer()));
      state.fetchedAt = Date.now();
    } catch (err) {
      log(`Error leyendo posiciones de trenes: ${(err as Error).message}`);
    }
  }

  void tick();
  const timer = setInterval(tick, intervalMs);
  return { state, stop: () => clearInterval(timer) };
}
