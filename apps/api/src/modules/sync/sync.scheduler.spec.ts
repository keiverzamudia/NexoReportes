import { describe, expect, it, vi } from 'vitest';
import { SyncScheduler } from './sync.scheduler';

// ============================================================
// El reloj automático es la garantía de que la data no envejezca. Estas
// pruebas cubren las dos reglas que evitan el fallo real observado
// («Connection is closed» al leer Profit con dos dominios a la vez):
//   1. Nunca hay dos corridas concurrentes (se encolan).
//   2. Un error de conexión se reintenta una vez.
// ============================================================

function configFor(schedule: string, intervalSeconds = 0) {
  return {
    get: (key: string) =>
      key === 'sync.schedule' ? schedule : key === 'sync.intervalSeconds' ? intervalSeconds : undefined,
  } as never;
}

function runStub(behaviour: (domain: string, call: number) => 'EXITOSA' | 'ERROR') {
  const state = { active: 0, maxActive: 0, order: [] as string[], calls: new Map<string, number>() };
  const sync = {
    run: async (domain: string) => {
      const call = (state.calls.get(domain) ?? 0) + 1;
      state.calls.set(domain, call);
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      state.order.push(`start:${domain}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      state.active -= 1;
      state.order.push(`end:${domain}`);
      const status = behaviour(domain, call);
      return { status, recordsRead: 10, recordsUpserted: 10, errorsCount: status === 'ERROR' ? 1 : 0, errorDetail: status === 'ERROR' ? 'Connection is closed.' : null };
    },
    runAll: async () => ({ domains: [], totalRead: 0, totalErrors: 0 }),
  };
  return { sync, state };
}

describe('SyncScheduler', () => {
  it('serializa los dominios: nunca dos lecturas de Profit a la vez', async () => {
    vi.useFakeTimers();
    const { sync, state } = runStub(() => 'EXITOSA');
    const scheduler = new SyncScheduler(sync as never, configFor('EXISTENCIAS=60,PEDIDOS=60'));

    scheduler.onModuleInit();
    // Los dos relojes disparan (con 5 s de escalonado) y el segundo espera.
    await vi.advanceTimersByTimeAsync(12_000);

    expect(state.maxActive).toBe(1);
    expect(state.order.slice(0, 4)).toEqual(['start:EXISTENCIAS', 'end:EXISTENCIAS', 'start:PEDIDOS', 'end:PEDIDOS']);
    scheduler.onModuleDestroy();
    vi.useRealTimers();
  });

  it('reintenta una vez cuando la conexión con Profit falla', async () => {
    vi.useFakeTimers();
    const { sync, state } = runStub((domain, call) => (domain === 'EXISTENCIAS' && call === 1 ? 'ERROR' : 'EXITOSA'));
    const scheduler = new SyncScheduler(sync as never, configFor('EXISTENCIAS=600'));

    scheduler.onModuleInit();
    // Primer tick a los 5 s: falla, espera 5 s y reintenta.
    await vi.advanceTimersByTimeAsync(15_000);

    expect(state.calls.get('EXISTENCIAS')).toBe(2);
    expect(state.order.filter((entry) => entry.startsWith('start:'))).toHaveLength(2);
    scheduler.onModuleDestroy();
    vi.useRealTimers();
  });

  it('no arranca relojes sin configuración (sincronización manual)', async () => {
    vi.useFakeTimers();
    const { sync, state } = runStub(() => 'EXITOSA');
    const scheduler = new SyncScheduler(sync as never, configFor(''));

    scheduler.onModuleInit();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(state.order).toHaveLength(0);
    scheduler.onModuleDestroy();
    vi.useRealTimers();
  });
});
