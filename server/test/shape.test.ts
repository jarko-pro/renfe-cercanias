import { describe, expect, it } from 'vitest';
import type { GtfsData } from '../src/gtfs/types.js';
import { tripPath } from '../src/shape.js';

// Línea recta de 10 puntos hacia el norte, separados ~111 m (0.001º de latitud).
const LINE = new Float64Array(Array.from({ length: 10 }, (_, i) => [40 + i * 0.001, -3]).flat());
const stop = (id: string, i: number) => [id, { id, name: id, lat: 40 + i * 0.001, lon: -3.00001, network: '', lines: [] }];

function data(first: string, last: string, shapeId = 'L'): GtfsData {
  return {
    trips: new Map([['T', { routeId: 'R', serviceId: 'S', headsign: '', firstStopId: first, lastStopId: last, shapeId }]]),
    stops: new Map([stop('P0', 0), stop('P2', 2), stop('P7', 7), stop('P9', 9)] as never),
    shapes: new Map([['L', LINE]]),
  } as unknown as GtfsData;
}

describe('tripPath', () => {
  it('recorta el trazado entre la primera y la última parada', () => {
    const path = tripPath(data('P2', 'P7'), 'T')!;
    expect(path).toHaveLength(6);
    expect(path[0]).toEqual([40.002, -3]);
    expect(path.at(-1)).toEqual([40.007, -3]);
  });

  it('da la vuelta al trazado si el tren circula en sentido contrario', () => {
    const path = tripPath(data('P9', 'P0'), 'T')!;
    expect(path[0]).toEqual([40.009, -3]);
    expect(path.at(-1)).toEqual([40, -3]);
  });

  it('devuelve null si el viaje no tiene trazado', () => {
    expect(tripPath(data('P0', 'P9', ''), 'T')).toBeNull();
  });
});
