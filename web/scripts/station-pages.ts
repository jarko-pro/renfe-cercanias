/**
 * Tras `vite build`: genera una página estática por estación (dist/estacion/{slug}/index.html)
 * para que Google pueda indexarlas, más el 404.html (abre la app en rutas desconocidas) y el
 * sitemap.xml. Cada página es la app normal con título, descripción y texto de esa estación;
 * al arrancar, la app abre el panel de la estación de la URL.
 *
 * Las estaciones se piden al servidor (VITE_API_URL). Sin esa variable (build local) no se
 * generan; en CI, si el servidor no responde, el build falla y producción no se toca.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopPath, stopSlugs, type Stop } from '@renfe/shared';

const SITE = 'https://cercaniasendirecto.com';
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const API = (process.env.VITE_API_URL ?? '').replace(/\/$/, '');

async function fetchStops(): Promise<Stop[]> {
  // El servidor gratuito puede estar dormido: tarda hasta un minuto en despertar.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}/api/stops`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const stops = (await res.json()) as Stop[];
      if (!Array.isArray(stops) || stops.length < 100) throw new Error(`solo ${stops.length} estaciones`);
      return stops;
    } catch (e) {
      if (attempt >= 5) throw e;
      console.warn(`station-pages: intento ${attempt} fallido (${(e as Error).message}); reintentando…`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const networkLabel = (network: string) =>
  network === 'Rodalies de Catalunya' ? 'Rodalies' : `Cercanías ${network}`;

/** Sustituye el valor de un atributo en la etiqueta que case con `tag`; falla si no la encuentra. */
function setAttr(html: string, tag: RegExp, value: string): string {
  if (!tag.test(html)) throw new Error(`station-pages: no encuentro ${tag} en index.html`);
  return html.replace(tag, (_m, pre: string, post: string) => `${pre}${esc(value)}${post}`);
}

/** Rutas absolutas: las páginas viven en /estacion/x/ y los recursos son relativos ("./assets"). */
const withBase = (html: string) => html.replace(/<meta charset="UTF-8" \/>/, '$&\n    <base href="/" />');

function stationPage(template: string, stop: Stop, slug: string): string {
  const label = networkLabel(stop.network);
  const lines = stop.lines.map((l) => l.name).join(', ');
  const url = SITE + stopPath(slug);
  const title = `${stop.name}: próximos trenes de ${label} en directo`;
  const description =
    `Próximos trenes en ${stop.name} (${label}) en tiempo real: cuánto falta, retraso, andén y avisos.` +
    (lines ? ` Líneas ${lines}.` : '');

  let html = withBase(template);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = setAttr(html, /(<meta\s+name="description"\s+content=")[^"]*(")/, description);
  html = setAttr(html, /(<link rel="canonical" href=")[^"]*(")/, url);
  html = setAttr(html, /(<meta property="og:url" content=")[^"]*(")/, url);
  html = setAttr(html, /(<meta property="og:title" content=")[^"]*(")/, title);
  html = setAttr(html, /(<meta property="og:description" content=")[^"]*(")/, description);

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TrainStation',
    name: stop.name,
    url,
    geo: { '@type': 'GeoCoordinates', latitude: stop.lat, longitude: stop.lon },
  };
  html = html.replace(
    '</head>',
    `  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n  </head>`,
  );

  const shell =
    `<main class="shell">\n        <h1>${esc(stop.name)}</h1>\n` +
    `        <p>Próximos trenes de ${esc(label)} en ${esc(stop.name)}, en tiempo real: cuánto le falta a cada tren, retraso, andén y avisos.</p>\n` +
    (lines ? `        <p>Líneas: ${esc(lines)}</p>\n` : '') +
    `        <p class="loading">Cargando…</p>\n      </main>`;
  if (!/<main class="shell">[\s\S]*?<\/main>/.test(html)) throw new Error('station-pages: no encuentro el shell');
  return html.replace(/<main class="shell">[\s\S]*?<\/main>/, shell);
}

async function main() {
  if (!API) {
    console.warn('station-pages: sin VITE_API_URL, no se generan las páginas de estación.');
    return;
  }
  const template = await readFile(join(DIST, 'index.html'), 'utf8');
  const stops = await fetchStops();
  const slugs = stopSlugs(stops);

  for (const stop of stops) {
    const slug = slugs.get(stop.id)!;
    const dir = join(DIST, 'estacion', slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), stationPage(template, stop, slug));
  }

  // GitHub Pages sirve 404.html en cualquier ruta que no exista: así una estación nueva
  // (sin página todavía) también abre la app, que la busca por su slug.
  await writeFile(join(DIST, '404.html'), withBase(template));

  const urls = ['/', '/privacidad.html', ...stops.map((s) => stopPath(slugs.get(s.id)!))];
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${SITE}${encodeURI(u)}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  await writeFile(join(DIST, 'sitemap.xml'), sitemap);

  console.log(`station-pages: ${stops.length} páginas de estación y sitemap con ${urls.length} URLs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
