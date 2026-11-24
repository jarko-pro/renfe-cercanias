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

export type BusFeedConfig = SantanderConfig;

export const BUS_REGISTRY: Record<string, BusFeedConfig> = {
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
