import type { GtfsData } from './gtfs/types.js';

/** Distancia mínima entre puntos devueltos: aligera la respuesta sin que se note en el mapa. */
const MIN_STEP_M = 25;

/** Distancia aproximada en metros (equirectangular: sobra a escala de una línea de cercanías). */
export function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const y = lat2 - lat1;
  return Math.sqrt(x * x + y * y) * 111_320;
}

function nearestIndex(pts: Float64Array, lat: number, lon: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length / 2; i++) {
    const d = distM(lat, lon, pts[i * 2], pts[i * 2 + 1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Trazado por el que circula un viaje, de su primera a su última parada y en su sentido.
 * Renfe da un trazado por línea (a veces uno por sentido), así que se recorta entre los
 * puntos más cercanos a la primera y la última parada, y se le da la vuelta si hace falta.
 */
export function tripPath(data: GtfsData, tripId: string): [number, number][] | null {
  const trip = data.trips.get(tripId);
  const pts = trip?.shapeId ? data.shapes.get(trip.shapeId) : undefined;
  const from = trip && data.stops.get(trip.firstStopId);
  const to = trip && data.stops.get(trip.lastStopId);
  if (!pts || !from || !to) return null;

  const a = nearestIndex(pts, from.lat, from.lon);
  const b = nearestIndex(pts, to.lat, to.lon);
  if (a === b) return null;
  const dir = a < b ? 1 : -1;

  const out: [number, number][] = [];
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  for (let i = a; ; i += dir) {
    const lat = pts[i * 2];
    const lon = pts[i * 2 + 1];
    const last = out[out.length - 1];
    if (i === b || !last || distM(last[0], last[1], lat, lon) >= MIN_STEP_M) out.push([round(lat), round(lon)]);
    if (i === b) break;
  }
  return out;
}
