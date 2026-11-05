import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { describe, expect, it } from 'vitest';
import { parseVehiclePositions, platformFromLabel } from '../src/realtime/vehicles.js';

const { transit_realtime: rt } = GtfsRealtimeBindings;
const S = rt.VehiclePosition.VehicleStopStatus;

function feed(vehicles: object[]): Uint8Array {
  return rt.FeedMessage.encode(
    rt.FeedMessage.fromObject({
      header: { gtfsRealtimeVersion: '2.0', timestamp: 1_793_866_647 },
      entity: vehicles.map((vehicle, i) => ({ id: String(i), vehicle })),
    }),
  ).finish();
}

describe('platformFromLabel', () => {
  it('saca el andén de la etiqueta de Renfe', () => {
    expect(platformFromLabel('C1-23578-PLATF.(6)')).toBe('6');
    expect(platformFromLabel('R2S-1234-PLATF.(12)')).toBe('12');
  });
  it('devuelve undefined si no hay andén', () => {
    expect(platformFromLabel('C4-23615')).toBeUndefined();
    expect(platformFromLabel(undefined)).toBeUndefined();
  });
});

describe('parseVehiclePositions', () => {
  it('lee posición, estado, parada y andén', () => {
    const m = parseVehiclePositions(
      feed([
        {
          trip: { tripId: 'T1' },
          position: { latitude: 37.39, longitude: -5.97 },
          currentStatus: S.STOPPED_AT,
          timestamp: 1_793_866_640,
          stopId: '51003',
          vehicle: { id: '23521', label: 'C1-23521-PLATF.(9)' },
        },
        { trip: { tripId: 'T2' }, currentStatus: S.INCOMING_AT, stopId: '50600', vehicle: { label: 'C4-23615' } },
        { trip: { tripId: 'T3' }, position: { latitude: 40, longitude: -3 }, stopId: '1' },
      ]),
    );
    expect(m.get('T1')).toEqual({
      lat: expect.closeTo(37.39, 4),
      lon: expect.closeTo(-5.97, 4),
      stopId: '51003',
      status: 'stopped',
      platform: '9',
      timestamp: 1_793_866_640_000,
    });
    expect(m.get('T2')).toMatchObject({ lat: null, lon: null, status: 'incoming', platform: undefined });
    // Sin estado: según el estándar, de camino a la parada.
    expect(m.get('T3')!.status).toBe('in_transit');
  });

  it('ignora vehículos sin viaje', () => {
    expect(parseVehiclePositions(feed([{ stopId: '1' }])).size).toBe(0);
  });
});
