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
  /** Número de tren (p. ej. "19799"), el que Renfe muestra en sus pantallas y billetes. */
  trainNumber?: string;
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
  /**
   * Sin ningún dato en tiempo real cuando ya debería tenerlos (ya ha salido de su origen o
   * sale en unos minutos). Puede ir con retraso o estar cancelado: la hora no es fiable.
   */
  unconfirmed: boolean;
  /**
   * Renfe ha dejado de dar datos de este tren: hora del último (epoch ms). `delaySec` y
   * `estimated` son los de entonces. Con `unconfirmed` a false iba en marcha y se perdió hace
   * poco ("sin señal"); a true, se perdió hace rato o antes de salir de su origen.
   */
  lastSeenAt?: number;
  /** Lleva estos minutos parado en su origen tras su hora de salida (va con `unconfirmed`). */
  heldAtOriginMin?: number;
  cancelled: boolean;
  /** El tren termina su recorrido en esta parada. */
  terminates: boolean;
  /** Posición real del tren respecto a esta parada (solo si está entrando o parado en ella). */
  vehicleStatus?: 'arriving' | 'at_platform';
  /** Andén o vía en esta parada, si Renfe lo publica. */
  platform?: string;
  /** Renfe está publicando la posición de este tren: se puede seguir en el mapa. */
  hasPosition: boolean;
  /**
   * Cómo suele llegar este tren (mismo número) a esta estación, según el histórico. Solo con
   * al menos 5 días de datos. Puntual = menos de 3 min de retraso.
   */
  punctuality?: { days: number; punctualDays: number; medianDelaySec: number };
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
  /** Renfe ha dejado de dar la posición: es la última conocida, recibida a esta hora (epoch ms). */
  lastSeenAt?: number;
}

/** Aviso de Renfe que afecta a una estación o a alguna de sus líneas. */
export interface StopAlert {
  id: string;
  text: string;
  /** Líneas de esta estación a las que afecta (vacío si es un aviso solo de la estación). */
  lines: Line[];
  /**
   * 'access': ascensores, escaleras, accesibilidad. 'service': todo lo demás. 'delays': no es de
   * Renfe, lo calculamos: la línea va hoy peor de lo normal a esta hora según el histórico.
   */
  kind: 'service' | 'access' | 'delays';
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
  /** Histórico de retrasos: viajes en curso, guardados y último error de la base de datos. */
  history?: {
    enabled: boolean;
    pending: number;
    saved: number;
    lastError: string | null;
    /** Estadísticas de referencia: días usados y cuántos trenes y franjas de línea tienen datos. */
    insights: { loadedAt: number; days: number; trains: number; trainStops: number; lines: number } | null;
  };
  /** Memoria del proceso en MB. `maxRss` es el pico desde que arrancó (p. ej. al recargar el GTFS). */
  mem?: { rss: number; maxRss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number };
  /** Retardo del event loop en ms en la última ventana de 5 min (si sube, las respuestas tardan). */
  eventLoop?: { p99Ms: number; maxMs: number };
  uptimeSec?: number;
  /** Redes de autobús activas (BUS_FEEDS). */
  bus?: BusFeedStatus[];
  error?: string;
}

/** Estado de una red de autobús, para /api/health. */
export interface BusFeedStatus {
  feed: string;
  stops: number;
  staticLoadedAt: number | null;
  fetchedAt: number | null;
  /** Filas de estimación (parada × línea) en la última lectura. */
  estimates: number;
  /** Lecturas descartadas por venir vacías o a medias desde que arrancó. */
  badReads: number;
  /** Pasos de bus por parada detectados hoy (la base de la puntualidad). */
  passesToday: number;
  history: { enabled: boolean; pending: number; saved: number; lastError: string | null };
  error?: string;
}

/**
 * Parada de autobús. `id` lleva la red delante ("santander:328") para no chocar con las
 * estaciones de Renfe; `code` es el número que pone en la marquesina.
 */
export interface BusStop {
  id: string;
  feed: string;
  code: string;
  name: string;
  /** Hacia dónde van los buses de esta parada, si la red lo publica ("Los Agustinos"). */
  towards?: string;
  lat: number;
  lon: number;
  lines: Line[];
}

/** Un bus que viene hacia la parada. */
export interface BusEta {
  /** Hora estimada de llegada (epoch ms). */
  estimated: number;
  /** Minutos que faltan al generar la respuesta (0 = llegando). La web lo recalcula en vivo. */
  minutes: number;
  /** Distancia en metros por la ruta, si la red la da. */
  distanceM?: number;
}

/** Una línea en un sentido, con sus próximos buses en la parada (como en las marquesinas). */
export interface BusLineArrivals {
  line: Line;
  headsign: string;
  next: BusEta[];
}

export interface BusArrivalsResponse {
  stop: BusStop;
  generatedAt: number;
  /** Segundos desde la última lectura buena de la red (null si aún no hay ninguna). */
  realtimeAgeSec: number | null;
  /** Ordenadas por el primer bus que llega. */
  lines: BusLineArrivals[];
  /** Líneas de la parada sin ningún bus en camino ahora (p. ej., fuera de su horario). */
  idle: Line[];
}

/** Resultado de buscar un tren por su número. */
export interface TrainMatch {
  tripId: string;
  train: string;
  line: Line;
  network: string;
  headsign: string;
  /** Estación que abrir: donde está o la próxima a la que llega; si aún no ha salido, su origen. */
  stopId: string;
  stopName: string;
  state: 'running' | 'later';
  /** Salida programada del origen (epoch ms). */
  departure: number;
}

/** Una línea en un sentido, con todas sus salidas del día en una estación. */
export interface TimetableGroup {
  line: Line;
  /** Destino más habitual de este sentido. */
  headsign: string;
  /** Otros destinos de algunos trenes, marcados con una letra en su hora. */
  notes: { mark: string; headsign: string }[];
  /** Salidas en orden; `t` en segundos desde el inicio del día de servicio (puede pasar de 24 h). */
  trains: { tripId: string; t: number; mark?: string; passed?: Passed }[];
}

/**
 * Un tren que ya ha pasado por la parada: con qué retraso (según Renfe al pasar) o null si
 * Renfe no dio ningún dato. Solo en el horario de hoy.
 */
export interface Passed {
  delaySec: number | null;
  cancelled?: boolean;
}

/** Horario programado de una estación para un día (sin tiempo real). */
export interface StopTimetable {
  stopId: string;
  /** Día de servicio (YYYYMMDD). */
  date: string;
  /** Inicio del día de servicio (epoch ms): hora real = base + t·1000. */
  base: number;
  groups: TimetableGroup[];
}

/** Recorrido programado de un tren: sus paradas con la hora de cada una. */
export interface TripTimes {
  tripId: string;
  trainNumber?: string;
  line: Line;
  headsign: string;
  /** Inicio del día de servicio (epoch ms): hora real = base + t·1000. */
  base: number;
  cancelled: boolean;
  /** `t` en segundos desde el inicio del día de servicio (salida; llegada en la última). */
  stops: { stopId: string; name: string; t: number; passed?: Passed }[];
}

export * from './slug';
export * from './feeds';
