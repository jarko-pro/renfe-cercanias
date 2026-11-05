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
  /**
   * Respecto a `stopId`: entrando en ella, parado en ella o en marcha tras salir de ella
   * (Renfe da en ese caso la última parada, no la siguiente).
   */
  status: 'incoming' | 'stopped' | 'in_transit' | null;
  stopId: string | null;
  stopName: string | null;
  /** En marcha: la parada a la que se dirige (calculada con el recorrido del viaje). */
  nextStopName: string | null;
  platform?: string;
  delaySec: number | null;
  /** Hora de la posición (epoch ms). */
  updatedAt: number | null;
}

/** Aviso de Renfe que afecta a una estación o a alguna de sus líneas. */
export interface StopAlert {
  id: string;
  text: string;
  /** Líneas de esta estación a las que afecta (vacío si es un aviso solo de la estación). */
  lines: Line[];
  /** 'access': ascensores, escaleras, accesibilidad. 'service': todo lo demás. */
  kind: 'service' | 'access';
  /** Corta o altera mucho el servicio (suspendido, no circula, autobús...). */
  severe: boolean;
  /** Afecta a esta estación en concreto (la nombra o va asociado a ella). */
  here: boolean;
}

export interface ArrivalsResponse {
  stop: Stop;
  generatedAt: number;
  realtimeAgeSec: number | null;
  arrivals: Arrival[];
  /** Ordenados: primero los graves de esta estación, los de accesibilidad al final. */
  alerts: StopAlert[];
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
  alerts: number;
  error?: string;
}
