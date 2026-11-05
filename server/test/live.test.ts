import { describe, expect, it } from 'vitest';
import type { GtfsData } from '../src/gtfs/types.js';
import { buildTripLive, nextStopId } from '../src/live.js';
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
