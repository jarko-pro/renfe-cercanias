import { beforeAll, describe, expect, it } from 'vitest';
import { buildGtfsData } from '../src/gtfs/build.js';
import type { GtfsData, GtfsSource } from '../src/gtfs/types.js';
import type { TripRealtime } from '../src/realtime/poller.js';
import type { VehicleState } from '../src/realtime/vehicles.js';
import { serviceDayBase } from '../src/time.js';
import { findTrains, trainNumber } from '../src/trains.js';

const TODAY = '20261104';

const FILES: Record<string, string> = {
  'calendar.txt': `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
1004J,0,0,1,0,0,0,0,20261104,20261104`,
  'routes.txt': `route_id,route_short_name,route_long_name,route_type,route_color,route_text_color
10T0001C1,C1,Principe Pio-Aeropuerto,2,75B6E0,FFFFFF`,
  'trips.txt': `route_id,service_id,trip_id,trip_headsign
10T0001C1,1004J,1004J19799C1,
10T0001C1,1004J,1004J29799C1,`,
  'stops.txt': `stop_id,stop_name,stop_lat,stop_lon
S1,Origen,40.0,-3.0
S2,Atocha,40.4,-3.69
S3,Destino,40.5,-3.7`,
  'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence
1004J19799C1,08:00:00,08:00:00,S1,1
1004J19799C1,08:10:00,08:11:00,S2,2
1004J19799C1,08:20:00,08:20:00,S3,3
1004J29799C1,18:00:00,18:00:00,S3,1
1004J29799C1,18:20:00,18:20:00,S1,2`,
};

function source(files: Record<string, string>): GtfsSource {
  return {
    has: (f) => f in files,
    async *rows(f) {
      const [head, ...lines] = files[f].trim().split('\n');
      const header = head.split(',');
      for (const line of lines) {
        const cells = line.split(',');
        yield Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
      }
    },
  };
}

const at = (hh: number, mm: number) => serviceDayBase(TODAY) + (hh * 3600 + mm * 60) * 1000;
const none = { trips: new Map<string, TripRealtime>(), vehicles: new Map<string, VehicleState>() };
const vehicle = (stopId: string, status: VehicleState['status']): VehicleState => ({
  lat: 40,
  lon: -3,
  stopId,
  status,
  timestamp: 0,
});

let data: GtfsData;
beforeAll(async () => {
  data = await buildGtfsData(source(FILES), TODAY);
});

describe('trainNumber', () => {
  it('saca el número del trip_id de Renfe', () => {
    expect(trainNumber('1008J19799C1')).toBe('19799');
    expect(trainNumber('5108J77636R4')).toBe('77636');
    expect(trainNumber('1008J17098C8a')).toBe('17098');
    expect(trainNumber('raro')).toBeNull();
  });
});

describe('findTrains', () => {
  it('antes de salir: abre el origen', () => {
    const [m] = findTrains(data, none, '19799', at(7, 30));
    expect(m).toMatchObject({ state: 'later', stopId: 'S1', stopName: 'Origen', network: 'Madrid', departure: at(8, 0) });
    expect(m.line.name).toBe('C1');
  });

  it('en tránsito: abre la parada siguiente a la que acaba de dejar', () => {
    const rt = { ...none, vehicles: new Map([['1004J19799C1', vehicle('S1', 'in_transit')]]) };
    expect(findTrains(data, rt, '19799', at(8, 5))[0]).toMatchObject({ state: 'running', stopId: 'S2' });
  });

  it('parado en una estación: abre esa estación', () => {
    const rt = { ...none, vehicles: new Map([['1004J19799C1', vehicle('S2', 'stopped')]]) };
    expect(findTrains(data, rt, '19799', at(8, 10))[0].stopId).toBe('S2');
  });

  it('si Renfe aún lo da parado en una estación que ya dejó, abre la siguiente', () => {
    // A las 8:13 sigue "parado en Atocha" (posición atrasada), pero allí tocaba a las 8:10.
    const rt = { ...none, vehicles: new Map([['1004J19799C1', vehicle('S2', 'stopped')]]) };
    expect(findTrains(data, rt, '19799', at(8, 13))[0].stopId).toBe('S3');
  });

  it('si le falta menos de un minuto y no hay posición, abre la siguiente', () => {
    expect(findTrains(data, none, '19799', at(8, 9) + 30_000)[0].stopId).toBe('S3');
  });

  it('solo con retraso de Renfe: abre la parada a la que va', () => {
    const rt = {
      ...none,
      trips: new Map([['1004J19799C1', { cancelled: false, delaySec: 60, stops: new Map([['S3', { delaySec: 60, skipped: false }]]) }]]),
    };
    expect(findTrains(data, rt, '19799', at(8, 12))[0].stopId).toBe('S3');
  });

  it('sin datos: la próxima parada según el horario', () => {
    expect(findTrains(data, none, '19799', at(8, 12))[0]).toMatchObject({ state: 'running', stopId: 'S3' });
  });

  it('no devuelve trenes que ya han llegado, cancelados ni números desconocidos', () => {
    expect(findTrains(data, none, '19799', at(9, 0))).toEqual([]);
    const cancelled = { ...none, trips: new Map([['1004J19799C1', { cancelled: true, stops: new Map() }]]) };
    expect(findTrains(data, cancelled, '19799', at(8, 5))).toEqual([]);
    expect(findTrains(data, none, '12345', at(8, 5))).toEqual([]);
  });
});
