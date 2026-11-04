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
  /** Minutos que faltan hasta `estimated` (redondeado hacia abajo, mínimo 0). */
  minutes: number;
  /** Retraso en segundos (null si no hay datos de tiempo real). */
  delaySec: number | null;
  realtime: boolean;
  cancelled: boolean;
  /** El tren termina su recorrido en esta parada. */
  terminates: boolean;
}

export interface ArrivalsResponse {
  stop: Stop;
  generatedAt: number;
  realtimeAgeSec: number | null;
  arrivals: Arrival[];
}

export interface HealthResponse {
  ok: boolean;
  gtfsLoadedAt: number | null;
  gtfsStops: number;
  realtimeFetchedAt: number | null;
  realtimeTrips: number;
  error?: string;
}
