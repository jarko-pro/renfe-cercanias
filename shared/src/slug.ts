import type { Stop } from './index';

/** "Alcalá de Henares-Universidad" -> "alcala-de-henares-universidad". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slug de la página de cada estación (/estacion/{slug}/). Sale del nombre; si dos estaciones
 * se llaman igual (hoy no pasa), se les añade el núcleo para distinguirlas.
 */
export function stopSlugs(stops: Stop[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const s of stops) count.set(slugify(s.name), (count.get(slugify(s.name)) ?? 0) + 1);
  return new Map(
    stops.map((s) => {
      const base = slugify(s.name);
      return [s.id, (count.get(base) ?? 0) > 1 ? `${base}-${slugify(s.network)}` : base];
    }),
  );
}

/** Ruta de la página de una estación, p. ej. "/estacion/atocha/". */
export const stopPath = (slug: string) => `/estacion/${slug}/`;

/** Slug de la estación si la ruta es la de una página de estación. */
export function slugFromPath(pathname: string): string | null {
  return /^\/estacion\/([a-z0-9-]+)\/?$/.exec(pathname)?.[1] ?? null;
}
