import { describe, expect, it } from 'vitest';
import { umamiPayload } from '../src/stats.js';

const W = '7f703cd1-7662-449f-8100-8c59c01b53c6';

describe('umamiPayload', () => {
  it('reenvía una visita con la IP y el navegador del usuario', () => {
    const p = umamiPayload({ website: W, url: '/renfe-cercanias/', language: 'es-ES' }, '88.27.1.10', 'Mozilla/5.0')!;
    expect(p.payload).toMatchObject({ website: W, url: '/renfe-cercanias/', ip: '88.27.1.10', userAgent: 'Mozilla/5.0' });
    expect(p.payload).not.toHaveProperty('name');
  });

  it('reenvía eventos conocidos con sus datos recortados', () => {
    const p = umamiPayload(
      { website: W, name: 'estacion', data: { estacion: 'x'.repeat(500), n: 3, malo: { a: 1 } } },
      '1.2.3.4',
      '',
    )!;
    expect(p.payload).toMatchObject({ name: 'estacion', data: { estacion: 'x'.repeat(100), n: 3 } });
    expect((p.payload as { data: object }).data).not.toHaveProperty('malo');
  });

  it('rechaza otras webs y eventos desconocidos', () => {
    expect(umamiPayload({ website: 'otra', name: 'estacion' }, '1.2.3.4', '')).toBeNull();
    expect(umamiPayload({ website: W, name: 'cualquier-cosa' }, '1.2.3.4', '')).toBeNull();
  });
});
