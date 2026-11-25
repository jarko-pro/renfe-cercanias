/** Redes de autobús: lo que la web necesita saber de cada una sin preguntar al servidor. */
export interface BusFeedInfo {
  /** Solo letras minúsculas: va en las URLs y delante de los ids de parada ("santander:328"). */
  id: string;
  city: string;
  operator: string;
  /** Centro y zoom con los que se abre el mapa en esa ciudad. */
  center: [number, number];
  zoom: number;
  /** Quién publica los datos (atribución obligatoria al reutilizarlos). */
  source: string;
  sourceUrl: string;
}

export const BUS_FEEDS: BusFeedInfo[] = [
  {
    id: 'madrid',
    city: 'Madrid',
    operator: 'EMT',
    center: [40.4168, -3.7038],
    zoom: 15,
    // MobilityLabs pide citarla como fuente de los datos.
    source: 'EMT Madrid MobilityLabs',
    sourceUrl: 'https://mobilitylabs.emtmadrid.es',
  },
  {
    id: 'barcelona',
    city: 'Barcelona',
    operator: 'TMB',
    center: [41.3874, 2.1686],
    zoom: 15,
    source: 'TMB (Transports Metropolitans de Barcelona)',
    sourceUrl: 'https://developer.tmb.cat',
  },
  {
    id: 'santander',
    city: 'Santander',
    operator: 'TUS',
    center: [43.4623, -3.81],
    zoom: 13,
    source: 'Ayuntamiento de Santander',
    sourceUrl: 'https://datos.santander.es',
  },
];

export function busFeedInfo(id: string): BusFeedInfo | undefined {
  return BUS_FEEDS.find((f) => f.id === id);
}

/** Id de una parada de autobús en la API. Las estaciones de Renfe nunca llevan ':'. */
export function busStopId(feed: string, code: string): string {
  return `${feed}:${code}`;
}

/** "santander:328" -> { feed: 'santander', code: '328' }; null si es una estación de Renfe. */
export function parseBusStopId(id: string): { feed: string; code: string } | null {
  const i = id.indexOf(':');
  if (i <= 0 || i === id.length - 1) return null;
  return { feed: id.slice(0, i), code: id.slice(i + 1) };
}
