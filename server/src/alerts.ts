import type { Line, StopAlert } from '@renfe/shared';
import type { GtfsData } from './gtfs/types.js';
import type { AlertInfo } from './realtime/alerts.js';

/** Ascensores, escaleras, accesibilidad: útil, pero no afecta a los trenes. */
const ACCESS = /ascensor|escaleras? mec[aá]nica|movilidad reducida|\bPMR\b|accesib|accesible/i;

/** Avisos que cortan o alteran mucho el servicio. Renfe no marca la gravedad: va por el texto. */
const SEVERE =
  /suspendid|interrumpid|no presta servicio|no circula|no se presta|huelga|no se garantiza el servicio|servicio alternativo|plan alternativo|por (carretera|autob[uú]s)|demoras que pueden superar|sin servicio|cortad/i;

/** Nombres de ciudad que aparecen en casi todos los textos: no sirven para saber si nombran la estación. */
const CITIES = new Set([
  'madrid', 'barcelona', 'valencia', 'sevilla', 'malaga', 'bilbao', 'murcia', 'zaragoza', 'cadiz',
  'santander', 'asturias', 'oviedo', 'gijon', 'san sebastian', 'donostia', 'alicante', 'castellon',
]);

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Formas en que el texto de un aviso puede nombrar la estación ("Pinto", "Alcobendas"...). */
function nameVariants(name: string): string[] {
  const full = norm(name).replace(/\s+cercanias$/, '').trim();
  const parts = full.split(/\s*-\s*/).filter((p) => p.length >= 4 && !CITIES.has(p));
  return [...new Set([full, ...parts])].filter((p) => !CITIES.has(p));
}

function mentions(text: string, name: string): boolean {
  const t = ` ${norm(text).replace(/[^a-z0-9ñ]+/g, ' ')} `;
  return nameVariants(name).some((v) => t.includes(` ${v.replace(/[^a-z0-9ñ]+/g, ' ').trim()} `));
}

/** Avisos que afectan a una estación: los asociados a ella y los de las líneas que paran ahí. */
export function alertsForStop(data: GtfsData, alerts: AlertInfo[], stopId: string): StopAlert[] {
  const stop = data.stops.get(stopId);
  if (!stop) return [];
  const stopRoutes = data.routesByStop.get(stopId) ?? new Set<string>();
  const out: StopAlert[] = [];

  for (const a of alerts) {
    const atStop = a.stopIds.has(stopId);
    const routes = [...a.routeIds].filter((r) => stopRoutes.has(r));
    if (!atStop && !routes.length) continue;

    const lines = new Map<string, Line>();
    for (const r of routes) {
      const l = data.lines.get(r);
      if (l) lines.set(l.name, l);
    }
    const kind = ACCESS.test(a.text) ? 'access' : 'service';
    const here = atStop || mentions(a.text, stop.name);
    // Un ascensor roto en otra estación de la línea no le importa a quien está en esta.
    if (kind === 'access' && !here) continue;
    out.push({
      id: a.id,
      text: a.text,
      lines: [...lines.values()].sort((x, y) => x.name.localeCompare(y.name, 'es', { numeric: true })),
      kind,
      severe: kind === 'service' && SEVERE.test(a.text),
      here,
    });
  }

  const rank = (a: StopAlert) => (a.severe && a.here ? 0 : a.severe ? 1 : a.kind === 'service' ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}
