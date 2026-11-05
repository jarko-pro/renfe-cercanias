import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { describe, expect, it } from 'vitest';
import { alertsForStop } from '../src/alerts.js';
import type { GtfsData } from '../src/gtfs/types.js';
import { cleanAlertText, parseAlerts, type AlertInfo } from '../src/realtime/alerts.js';

const { transit_realtime: rt } = GtfsRealtimeBindings;
const NOW = 1_793_878_800_000; // 2026-11-05 ~11:20 en Madrid
const S = NOW / 1000;

function feed(alerts: { text: string; start?: number; end?: number; routes?: string[]; stops?: string[] }[]) {
  return rt.FeedMessage.encode(
    rt.FeedMessage.fromObject({
      header: { gtfsRealtimeVersion: '2.0', timestamp: S },
      entity: alerts.map((a, i) => ({
        id: `A${i}`,
        alert: {
          activePeriod: [{ start: a.start ?? S - 3600, end: a.end ?? 0 }],
          informedEntity: [...(a.routes ?? []).map((routeId) => ({ routeId })), ...(a.stops ?? []).map((stopId) => ({ stopId }))],
          descriptionText: { translation: [{ text: a.text, language: 'es' }] },
        },
      })),
    }),
  ).finish();
}

describe('cleanAlertText', () => {
  it('se queda con el castellano de los avisos bilingües', () => {
    expect(cleanAlertText('ORDIZIA. 1. trenbideko igogailua zerbitzuz kanpo daude. // ORDIZIA. Ascensor de vía 1 fuera de servicio. ')).toBe(
      'ORDIZIA. Ascensor de vía 1 fuera de servicio.',
    );
  });
  it('quita etiquetas de redes y almohadillas', () => {
    expect(cleanAlertText('#MadC3 Por obras de mejora')).toBe('Por obras de mejora');
    expect(cleanAlertText('#NUEVOS HORARIOS# A partir del 31-10-26')).toBe('NUEVOS HORARIOS A partir del 31-10-26');
  });
  it('no confunde las URL con el separador de idiomas', () => {
    expect(cleanAlertText('Más información: https://renfe.com/x')).toBe('Más información: https://renfe.com/x');
  });
});

describe('parseAlerts', () => {
  it('trata la fecha de fin vacía (0) como "sin fin" y descarta los que aún no han empezado', () => {
    const res = parseAlerts(
      feed([{ text: 'Aviso vigente sin fecha de fin' }, { text: 'Aviso que empieza mañana mismo', start: S + 86400 }]),
      NOW,
    );
    expect(res.map((a) => a.text)).toEqual(['Aviso vigente sin fecha de fin']);
  });

  it('descarta avisos de trenes concretos de hace más de 3 horas, las pruebas y los duplicados', () => {
    const res = parseAlerts(
      feed([
        { text: 'Línea C-1 Tren con salida a las 7:00h de FUENGIROLA circula con demora', start: S - 4 * 3600 },
        { text: 'Línea C-1 Tren con salida a las 10:30h de FUENGIROLA circula con demora', start: S - 3600 },
        { text: 'Pruebas, disculpen las molestias' },
        { text: 'Incidencia entre Arc de Triomf y El Clot', routes: ['R1'] },
        { text: 'Incidencia entre Arc de Triomf y El Clot', routes: ['R2'] },
      ]),
      NOW,
    );
    expect(res.map((a) => a.text)).toEqual([
      'Línea C-1 Tren con salida a las 10:30h de FUENGIROLA circula con demora',
      'Incidencia entre Arc de Triomf y El Clot',
    ]);
  });
});

describe('alertsForStop', () => {
  const line = (name: string) => ({ name, color: '000000', textColor: 'FFFFFF' });
  const stop = (id: string, name: string) => [id, { id, name, lat: 0, lon: 0, network: 'Madrid', lines: [] }];
  const data = {
    stops: new Map([stop('P', 'Pinto'), stop('Z', 'Zarzaquemada'), stop('A', 'Madrid-Atocha Cercanías')] as never),
    lines: new Map([
      ['R3', line('C3')],
      ['R4', line('C4')],
    ]),
    routesByStop: new Map([
      ['P', new Set(['R3'])],
      ['Z', new Set(['R4'])],
      ['A', new Set(['R3', 'R4'])],
    ]),
  } as unknown as GtfsData;
  const alert = (text: string, routes: string[] = [], stops: string[] = []): AlertInfo => ({
    id: text.slice(0, 10),
    text,
    routeIds: new Set(routes),
    stopIds: new Set(stops),
    start: null,
  });

  const ALERTS = [
    alert('Por obras, el servicio entre Pinto y Aranjuez se verá reajustado', ['R3']),
    alert('Se encuentra suspendido el servicio entre Pinto y Aranjuez', ['R3']),
    alert('Ascensor de la estación de Zarzaquemada fuera de servicio', [], ['Z']),
    alert('Renfe informa que la estación de Pinto no es accesible para PMR', ['R3', 'R4']),
  ];

  it('marca como grave y "aquí" lo que corta el servicio y nombra la estación', () => {
    const res = alertsForStop(data, ALERTS, 'P');
    expect(res[0]).toMatchObject({ severe: true, here: true, kind: 'service' });
    expect(res[0].lines.map((l) => l.name)).toEqual(['C3']);
    expect(res.find((a) => a.text.startsWith('Por obras'))).toMatchObject({ severe: false, here: true });
  });

  it('en otras estaciones de la línea, lo grave sale pero no como "aquí"', () => {
    const res = alertsForStop(data, ALERTS, 'A');
    expect(res.find((a) => a.text.includes('suspendido'))).toMatchObject({ severe: true, here: false });
  });

  it('los avisos de accesibilidad solo salen en su estación', () => {
    expect(alertsForStop(data, ALERTS, 'Z').map((a) => a.kind)).toEqual(['access']);
    expect(alertsForStop(data, ALERTS, 'A').some((a) => a.kind === 'access')).toBe(false);
    expect(alertsForStop(data, ALERTS, 'P').some((a) => a.kind === 'access')).toBe(true);
  });

  it('no cuenta como "aquí" el nombre de la ciudad (Madrid aparece en casi todo)', () => {
    const res = alertsForStop(data, [alert('Trenes con origen o destino Madrid suspendidos', ['R3'])], 'A');
    expect(res[0].here).toBe(false);
  });
});
