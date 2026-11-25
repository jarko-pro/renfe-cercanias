/**
 * Redes de autobús que sabe leer el servidor. Se activan con BUS_FEEDS (p. ej. "santander");
 * sin esa variable el servidor solo hace trenes. Lo público de cada red está en
 * `@renfe/shared` (BUS_FEEDS), con el mismo id.
 */

/** Ayuntamiento de Santander: JSON propio, sin GTFS-RT ni id de viaje. */
export interface SantanderConfig {
  id: string;
  kind: 'santander-json';
  /** Base de la API de datos abiertos (datasets en `${base}/{nombre}.json`). */
  base: string;
  /** Cada cuánto se leen las estimaciones de día y de madrugada (casi sin servicio). */
  dayIntervalMs: number;
  nightIntervalMs: number;
  /** Colores de línea (no van en los datos abiertos; sacados del GTFS de TUS). */
  colors: Record<string, [string, string]>;
  defaultColor: [string, string];
}

/**
 * EMT de Madrid (MobilityLabs): API con credenciales (EMT_CLIENT_ID y EMT_PASS_KEY). Las
 * llegadas se piden parada a parada cuando alguien abre una, y se comparten unos segundos.
 */
export interface EmtConfig {
  id: string;
  kind: 'emt-madrid';
  base: string;
  /** Cuánto se reutiliza la respuesta de una parada antes de volver a pedirla. */
  cacheMs: number;
}

/**
 * TMB de Barcelona (api.tmb.cat): clave de developer.tmb.cat (AMB_CLIENT_ID = app_id y
 * AMB_PASS_KEY = app_key). Como en Madrid, las llegadas se piden parada a parada.
 */
export interface TmbConfig {
  id: string;
  kind: 'tmb';
  base: string;
  cacheMs: number;
  /** Tope propio de consultas al día (TMB no publica el suyo). */
  dailyLimit: number;
}

export type BusFeedConfig = SantanderConfig | EmtConfig | TmbConfig;

export const BUS_REGISTRY: Record<string, BusFeedConfig> = {
  madrid: {
    id: 'madrid',
    kind: 'emt-madrid',
    base: 'https://openapi.emtmadrid.es',
    // La web refresca cada 30 s: con 25 s, dos personas en la misma parada gastan una sola consulta.
    cacheMs: 25_000,
  },
  barcelona: {
    id: 'barcelona',
    kind: 'tmb',
    base: 'https://api.tmb.cat',
    cacheMs: 25_000,
    dailyLimit: 20_000,
  },
  santander: {
    id: 'santander',
    kind: 'santander-json',
    base: 'https://datos.santander.es/api/rest/datasets',
    // Cada fila se renueva cada 45-60 s: con 30 s no se pierde ninguna.
    dayIntervalMs: 30_000,
    nightIntervalMs: 120_000,
    colors: {
      '1': ['FF0000', 'FFFFFF'],
      '2': ['EBBCC2', '000000'],
      '3': ['FFD014', '000000'],
      '4': ['3AF2E5', '000000'],
      '11': ['BA3309', 'FFFFFF'],
      '12': ['B2DB74', '000000'],
      '13': ['D4B0D3', '000000'],
      '14': ['3EB9E6', '000000'],
      '15': ['F5F53D', '000000'],
      '16': ['D444B2', '000000'],
      '17': ['FFD2C7', '000000'],
      '18': ['C9F3FF', '000000'],
      '24C1': ['FF6622', '000000'],
      '24C2': ['FF6622', '000000'],
      '5C1': ['CFCFCF', '000000'],
      '5C2': ['ADADAD', '000000'],
      '6C1': ['0EC758', 'FFFFFF'],
      '6C2': ['00C200', 'FFFFFF'],
      '7C1': ['FF9D1C', '000000'],
      '7C2': ['FF9D1C', '000000'],
      '99': ['FF9D1C', '000000'],
      E1: ['2A99B5', 'FFFFFF'],
      E2: ['C9CCC0', '000000'],
      E3: ['D692D4', '000000'],
      E31: ['BED171', '000000'],
      E4: ['E8B780', '000000'],
      // El GTFS lo da con texto negro sobre azul oscuro: ilegible.
      LC: ['1717FF', 'FFFFFF'],
      N1: ['ADADAD', '000000'],
      N2: ['696969', 'FFFFFF'],
      N3: ['ABABAB', '000000'],
    },
    defaultColor: ['D62D20', 'FFFFFF'],
  },
};
