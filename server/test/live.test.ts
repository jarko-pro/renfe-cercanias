import { describe, expect, it } from 'vitest';
import type { GtfsData } from '../src/gtfs/types.js';
import { buildTripLive, nextStopId, tripLiveNow } from '../src/live.js';
import type { VehicleState } from '../src/realtime/vehicles.js';

const stop = (id: string) => [id, { id, name: `Estación ${id}`, lat: 40, lon: -3, network: '', lines: [] }];
const data = {
  trips: new Map([['T', { routeId: 'R', serviceId: 'S', headsign: 'Fin', firstStopId: 'A', lastStopId: 'C', shapeId: '' }]]),
  lines: new Map([['R', { name: 'C1', color: '75B6E0', textColor: 'FFFFFF' }]]),
  stops: new Map([stop('A'), stop('B'), stop('C')] as never),
  tripStops: new Map([['T', ['A', 'B', 'C']]]),
} as unknown as GtfsData;
const veh = (stopId: string, status: VehicleState['status']): VehicleState => ({
  lat: 40,
  lon: -3,
  stopId,
  status,
  timestamp: 1,
});

describe('nextStopId', () => {
  it('da la parada siguiente del recorrido', () => {
    expect(nextStopId(data, 'T', 'A')).toBe('B');
    expect(nextStopId(data, 'T', 'C')).toBeNull();
    expect(nextStopId(data, 'T', 'X')).toBeNull();
  });
});

describe('buildTripLive', () => {
  it('en marcha: la parada de Renfe es la que deja y se añade la siguiente', () => {
    const live = buildTripLive(data, 'T', veh('A', 'in_transit'), undefined)!;
    expect(live.stopName).toBe('Estación A');
    expect(live.nextStopName).toBe('Estación B');
  });

  it('parado o entrando: no hay parada siguiente', () => {
    expect(buildTripLive(data, 'T', veh('B', 'stopped'), undefined)!.nextStopName).toBeNull();
    expect(buildTripLive(data, 'T', veh('B', 'incoming'), undefined)!.nextStopName).toBeNull();
  });

  it('sin vehículo en el feed: sin posición', () => {
    const live = buildTripLive(data, 'T', undefined, undefined)!;
    expect(live.position).toBeNull();
    expect(live.status).toBeNull();
  });

  it('viaje desconocido: null', () => {
    expect(buildTripLive(data, 'NO', undefined, undefined)).toBeNull();
  });
});

describe('tripLiveNow', () => {
  it('si deja de salir en el feed, da la última posición con su hora', () => {
    const memory = new Map([['T', { vehicle: veh('B', 'in_transit'), vehicleAt: 1000 }]]);
    const live = tripLiveNow(data, 'T', { trips: new Map(), vehicles: new Map(), memory }, 1000 + 5 * 60_000)!;
    expect(live.position).toEqual({ lat: 40, lon: -3 });
    expect(live.nextStopName).toBe('Estación C');
    expect(live.lastSeenAt).toBe(1000);
  });

  it('con la posición en el feed no hay lastSeenAt', () => {
    const live = tripLiveNow(data, 'T', { trips: new Map(), vehicles: new Map([['T', veh('B', 'stopped')]]) }, 5000)!;
    expect(live.lastSeenAt).toBeUndefined();
  });
});
