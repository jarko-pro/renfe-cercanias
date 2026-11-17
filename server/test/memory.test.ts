import { describe, expect, it } from 'vitest';
import { createRealtimeMemory } from '../src/realtime/memory.js';
import type { TripRealtime } from '../src/realtime/poller.js';
import type { VehicleState } from '../src/realtime/vehicles.js';

const rt = (delaySec: number): TripRealtime => ({ delaySec, cancelled: false, stops: new Map() });
const veh: VehicleState = { lat: 40, lon: -3, stopId: 'S1', status: 'in_transit', timestamp: null };

describe('createRealtimeMemory', () => {
  it('guarda el último dato de cada feed aunque el tren deje de salir', () => {
    const m = createRealtimeMemory();
    m.onTrips(new Map([['A', rt(300)]]), 1000);
    m.onVehicles(new Map([['A', veh]]), 2000);
    m.onTrips(new Map(), 31_000);
    expect(m.trips.get('A')).toEqual({ rt: rt(300), rtAt: 1000, vehicle: veh, vehicleAt: 2000 });
    m.onTrips(new Map([['A', rt(600)]]), 61_000);
    expect(m.trips.get('A')!.rt!.delaySec).toBe(600);
    expect(m.trips.get('A')!.rtAt).toBe(61_000);
  });

  it('olvida los trenes sin ningún dato en 3 h', () => {
    const m = createRealtimeMemory();
    m.onTrips(new Map([['A', rt(0)]]), 0);
    m.onVehicles(new Map([['A', veh]]), 3600_000);
    m.onTrips(new Map(), 3 * 3600_000);
    expect(m.trips.has('A')).toBe(true);
    m.onTrips(new Map(), 4 * 3600_000 + 1);
    expect(m.trips.has('A')).toBe(false);
  });
});
