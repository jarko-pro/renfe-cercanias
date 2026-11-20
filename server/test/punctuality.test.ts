import type { Arrival } from '@renfe/shared';
import { describe, expect, it } from 'vitest';
import type { GtfsData } from '../src/gtfs/types.js';
import type { Insights } from '../src/history/insights.js';
import { withPunctuality } from '../src/punctuality.js';

const data = {
  trips: new Map([
    ['1008J19799C1', { routeId: '10T0001C1' }],
    ['1008J19801C1', { routeId: '10T0001C1' }],
  ]),
} as unknown as GtfsData;

const arrival = (tripId: string, trainNumber?: string) => ({ tripId, trainNumber }) as Arrival;

// 19799: 9 días en S2 (7 puntuales); 19801: solo 4 días.
const calls: string[] = [];
const insights = {
  atStop: (network: string, train: string, dt: string, stopId: string) => {
    calls.push(`${network}|${train}|${dt}|${stopId}`);
    if (train === '19799') return { days: 9, punctualDays: 7, medianDelaySec: 60 };
    if (train === '19801') return { days: 4, punctualDays: 4, medianDelaySec: 0 };
    return null;
  },
} as unknown as Insights;

// Viernes 20-11-2026 a mediodía (laborable).
const NOW = Date.UTC(2026, 10, 20, 11, 0);

describe('withPunctuality', () => {
  it('añade el histórico del tren en esta estación, con su núcleo y tipo de día', () => {
    const [a] = withPunctuality([arrival('1008J19799C1', '19799')], data, insights, 'S2', NOW);
    expect(a.punctuality).toEqual({ days: 9, punctualDays: 7, medianDelaySec: 60 });
    expect(calls).toContain('10|19799|lab|S2');
  });

  it('no lo da con menos de 5 días, sin número de tren o sin estadísticas', () => {
    const res = withPunctuality(
      [arrival('1008J19801C1', '19801'), arrival('1008J19799C1'), arrival('X', '12345')],
      data,
      insights,
      'S2',
      NOW,
    );
    expect(res.map((a) => a.punctuality)).toEqual([undefined, undefined, undefined]);
    expect(withPunctuality([arrival('1008J19799C1', '19799')], data, null, 'S2', NOW)[0].punctuality).toBeUndefined();
  });
});
