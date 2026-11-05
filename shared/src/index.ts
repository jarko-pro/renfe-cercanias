/** Línea de Cercanías tal como se muestra al usuario (C1, R2 Sud...). */
export interface Line {
  name: string;
  /** Color hex sin '#', p. ej. "75B6E0". */
  color: string;
  textColor: string;
}

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Núcleo de Cercanías (Madrid, Rodalies de Catalunya...). */
  network: string;
  lines: Line[];
}

export interface Arrival {
  tripId: string;
  line: Line;
  /** Destino del tren (última parada del recorrido). */
  headsign: string;
  /** Hora programada de paso (epoch ms). */
  scheduled: number;
  /** Hora estimada con retraso en tiempo real (epoch ms). Igual a `scheduled` si no hay datos RT. */
  estimated: number;
  /**
   * Minutos que faltan hasta `estimated` en el momento de generar la respuesta: 0 = "Ahora"
   * (menos de 30 s), si no redondeado al minuto más cercano. La web lo recalcula en vivo.
   */
  minutes: number;
  /** Retraso en segundos (null si no hay datos de tiempo real). */
  delaySec: number | null;
  realtime: boolean;
  cancelled: boolean;
  /** El tren termina su recorrido en esta parada. */
  terminates: boolean;
  /** Posición real del tren respecto a esta parada (solo si está entrando o parado en ella). */
  vehicleStatus?: 'arriving' | 'at_platform';
  /** Andén o vía en esta parada, si Renfe lo publica. */
  platform?: string;
  /** Renfe está publicando la posición de este tren: se puede seguir en el mapa. */
  hasPosition: boolean;
}

/** Dónde está ahora un tren concreto (para seguirlo en el mapa). */
export interface TripLive {
  tripId: string;
  line: Line;
  headsign: string;
  /** null si el tren aún no aparece en el feed (no ha salido de origen). */
  position: { lat: number; lon: number } | null;
  /** Respecto a `stopId`: entrando, parado en ella o de camino a ella. */
  status: 'incoming' | 'stopped' | 'in_transit' | null;
  stopId: string | null;
  stopName: string | null;
  platform?: string;
  delaySec: number | null;
  /** Hora de la posición (epoch ms). */
  updatedAt: number | null;
}

export interface ArrivalsResponse {
  stop: Stop;
  generatedAt: number;
  realtimeAgeSec: number | null;
  arrivals: Arrival[];
}

/** Trazado de un viaje de origen a destino, en su sentido. Vacío si Renfe no lo publica. */
export interface TripShape {
  tripId: string;
  path: [number, number][];
}

export interface HealthResponse {
  ok: boolean;
  gtfsLoadedAt: number | null;
  gtfsStops: number;
  realtimeFetchedAt: number | null;
  realtimeTrips: number;
  vehicles: number;
  error?: string;
}
