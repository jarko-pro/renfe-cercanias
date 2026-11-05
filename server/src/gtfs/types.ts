import type { Line, Stop } from '@renfe/shared';

export interface StopTime {
  tripId: string;
  /** Segundos desde el inicio del día de servicio. */
  arr: number;
  dep: number;
  seq: number;
}

export interface TripInfo {
  routeId: string;
  serviceId: string;
  headsign: string;
  firstStopId: string;
  lastStopId: string;
  /** Trazado de la línea en `GtfsData.shapes` ('' si Renfe no lo da). */
  shapeId: string;
}

export interface GtfsData {
  loadedAt: number;
  /** Fecha local (YYYYMMDD) para la que se construyeron los índices. */
  today: string;
  stops: Map<string, Stop>;
  /** route_id -> línea */
  lines: Map<string, Line>;
  /** Solo viajes con servicio activo ayer, hoy o mañana. */
  trips: Map<string, TripInfo>;
  /** Fecha YYYYMMDD -> servicios activos ese día. */
  servicesByDate: Map<string, Set<string>>;
  /** stop_id -> paso de trenes (solo viajes activos), ordenado por hora. */
  stopTimesByStop: Map<string, StopTime[]>;
  /** stop_id -> route_id de las líneas que paran ahí (para cruzar con los avisos). */
  routesByStop: Map<string, Set<string>>;
  /** trip_id -> paradas del viaje en orden (solo viajes activos). */
  tripStops: Map<string, string[]>;
  /** shape_id -> puntos del trazado empaquetados [lat0, lon0, lat1, lon1, ...]. */
  shapes: Map<string, Float64Array>;
}

/** Fuente de filas CSV, desacoplada del zip para poder testear. */
export interface GtfsSource {
  has(file: string): boolean;
  rows(file: string): AsyncIterable<Record<string, string>>;
}
