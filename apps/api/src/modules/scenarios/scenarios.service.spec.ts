import { describe, expect, it, vi } from 'vitest';
import { ScenariosService } from './scenarios.service';

// ============================================================
// Fake mínimo de Prisma para los escenarios del simulador.
// ============================================================

type Row = Record<string, any>;

function matchesWhere(where: Row, row: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'in' in (value as Row)) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === value;
  });
}

function createFakePrisma() {
  const state = { scenarios: [] as Row[], runs: [] as Row[], restores: [] as Row[], users: [] as Row[] };

  // Prisma devuelve el `_count` y las relaciones incluidas en la misma fila.
  const decorate = (row: Row) => ({
    ...row,
    _count: { restores: state.restores.filter((restore) => restore.scenarioId === row.id).length },
    restores: state.restores
      .filter((restore) => restore.scenarioId === row.id)
      .sort((a, b) => b.restoredAt.getTime() - a.restoredAt.getTime() || String(b.id).localeCompare(String(a.id))),
  });

  const prisma = {
    state,
    dispatchScenario: {
      findFirst: async ({ where }: Row) => {
        const row = state.scenarios.find((item) => matchesWhere(where, item));
        return row ? decorate(row) : null;
      },
      findMany: async ({ where }: Row) =>
        state.scenarios.filter((row) => matchesWhere(where, row)).map((row) => decorate(row)),
      count: async ({ where }: Row) => state.scenarios.filter((row) => matchesWhere(where, row)).length,
      create: async ({ data }: Row) => {
        const duplicate = state.scenarios.some(
          (row) => row.ownerId === data.ownerId && row.kind === data.kind && row.name === data.name,
        );
        if (duplicate) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row: Row = {
          id: `sc-${state.scenarios.length + 1}`,
          version: 1,
          restoredAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.scenarios.push(row);
        return decorate(row);
      },
      update: async ({ where, data }: Row) => {
        const row = state.scenarios.find((item) => item.id === where.id);
        if (!row) throw new Error('no encontrado');
        if (data.name !== undefined && data.name !== row.name) {
          const duplicate = state.scenarios.some(
            (item) => item.id !== row.id && item.ownerId === row.ownerId && item.kind === row.kind && item.name === data.name,
          );
          if (duplicate) throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const { version, ...rest } = data;
        Object.assign(row, rest);
        if (version && typeof version === 'object' && 'increment' in version) row.version += version.increment;
        row.updatedAt = new Date();
        return decorate(row);
      },
      delete: async ({ where }: Row) => {
        const index = state.scenarios.findIndex((item) => item.id === where.id);
        const [removed] = state.scenarios.splice(index, 1);
        // Cascada: el historial de restauraciones se va con el escenario.
        state.restores = state.restores.filter((restore) => restore.scenarioId !== where.id);
        return removed;
      },
    },
    dispatchScenarioRestore: {
      create: async ({ data }: Row) => {
        const row: Row = { id: `rs-${state.restores.length + 1}`, restoredAt: new Date(), ...data };
        state.restores.push(row);
        return row;
      },
      count: async ({ where }: Row) => state.restores.filter((row) => matchesWhere(where, row)).length,
    },
    user: {
      findUnique: async ({ where }: Row) => state.users.find((user) => user.id === where.id) ?? null,
    },
    syncRun: {
      findMany: async () => state.runs,
    },
    $transaction: async (operations: unknown[]) => Promise.all(operations),
  };
  return prisma;
}

function restoreInput(overrides: Row = {}) {
  return {
    restored: 0,
    missing: 0,
    pendingChanges: 0,
    stockChanges: 0,
    dateChanges: 0,
    carteraBefore: 0,
    carteraAfter: 0,
    beforeKg: 0,
    afterKg: 0,
    beforeCoverage: 0,
    afterCoverage: 0,
    ...overrides,
  } as never;
}

const audit = { record: async () => undefined } as never;

function snapshotLine(overrides: Row = {}) {
  return {
    orderNumber: '408251710',
    productCode: 'ABAPOR77',
    customerCode: '294201237',
    customerName: 'AGRICOLA LA CAÑADA',
    description: 'POLLO ENGORDE 35KG',
    uom: 'SAC',
    pendingQty: 10,
    pendingKg: 350,
    assignedQty: 10,
    assignedKg: 350,
    missingQty: 0,
    missingKg: 0,
    stockTotal: 500,
    effectiveDate: '2026-10-27',
    priority: 1,
    ...overrides,
  };
}

function saveInput(overrides: Row = {}) {
  const lines = [snapshotLine(), snapshotLine({ productCode: 'ABABOV85', priority: 2 })];
  return {
    name: 'Despacho lunes',
    recipe: {
      by: 'cliente',
      mode: 'disponible',
      sort: 'cobertura',
      filters: {},
    },
    selected: lines.map((line) => ({ orderNumber: line.orderNumber, productCode: line.productCode })),
    snapshot: {
      takenAt: new Date('2026-10-18T13:12:00.000Z').toISOString(),
      carteraLines: 31,
      totals: {
        lines: lines.length,
        sacks: 20,
        pendingQty: 20,
        pendingKg: 700,
        assignedQty: 20,
        assignedKg: 700,
        missingQty: 0,
        missingKg: 0,
        coverage: 1,
      },
      lines,
    },
    ...overrides,
  } as never;
}

describe('ScenariosService', () => {
  it('guarda la receta con su foto y deriva los totales de los renglones', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit);

    const detail = await service.create('u1', saveInput(), { id: 'u1', code: 'KZ' });

    expect(detail.name).toBe('Despacho lunes');
    expect(detail.lineCount).toBe(2);
    expect(detail.sacks).toBe(20);
    expect(detail.assignedKg).toBe(700);
    expect(detail.coverage).toBe(100);
    expect(detail.payload.recipe.mode).toBe('disponible');
    expect(detail.payload.snapshot?.carteraLines).toBe(31);
    expect(prisma.state.scenarios).toHaveLength(1);
  });

  it('aísla los escenarios por dueño: el ajeno no existe', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit);
    const created = await service.create('u1', saveInput(), {});

    const list = await service.list('u2');
    expect(list.items).toHaveLength(0);

    await expect(service.detail('u2', created.id)).rejects.toThrow(/no encontrada/i);
    await expect(service.remove('u2', created.id, {})).rejects.toThrow(/no encontrada/i);
    expect(prisma.state.scenarios).toHaveLength(1);
  });

  it('respeta el límite de simulaciones guardadas', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit);
    for (let index = 0; index < 25; index += 1) {
      await service.create('u1', saveInput({ name: `Plan ${index}` }), {});
    }
    await expect(service.create('u1', saveInput({ name: 'Plan 26' }), {})).rejects.toThrow(/límite/i);
  });

  it('no permite dos nombres iguales del mismo usuario', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit);
    await service.create('u1', saveInput(), {});
    await expect(service.create('u1', saveInput(), {})).rejects.toThrow(/ese nombre/i);
  });

  it('rechaza un renombrado con versión vieja (versionado optimista)', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit);
    const created = await service.create('u1', saveInput(), {});

    const renamed = await service.update('u1', created.id, { name: 'Despacho martes', version: 1 }, {});
    expect(renamed.name).toBe('Despacho martes');
    expect(renamed.version).toBe(2);

    await expect(service.update('u1', created.id, { name: 'Otra', version: 1 }, {})).rejects.toThrow(/otra pestaña/i);
  });

  it('el borrador es uno solo y no lleva foto', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit);

    const input = {
      recipe: { by: 'cliente', mode: 'disponible', sort: 'cobertura', filters: {} },
      selected: [{ orderNumber: '408251710', productCode: 'ABAPOR77' }],
    } as never;

    await service.saveDraft('u1', input);
    await service.saveDraft('u1', input);
    expect(prisma.state.scenarios).toHaveLength(1);
    expect(prisma.state.scenarios[0]!.kind).toBe('DRAFT');

    const draft = await service.getDraft('u1');
    expect(draft.scenario?.lineCount).toBe(1);
    expect(draft.scenario?.payload.snapshot).toBeNull();
    expect(draft.scenario?.coverage).toBe(0);
  });

  it('marca la simulación como desactualizada cuando cambió la sync', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit);
    prisma.state.runs = [{ domain: 'PEDIDOS', id: 'run-1' }];

    const created = await service.create('u1', saveInput(), {});
    expect(created.stale).toBe(false);

    prisma.state.runs = [
      { domain: 'PEDIDOS', id: 'run-2' },
      { domain: 'EXISTENCIAS', id: 'run-9' },
    ];
    const list = await service.list('u1');
    expect(list.items[0]!.stale).toBe(true);
  });

  it('deja traza al restaurar sin tocar la foto', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit);
    const created = await service.create('u1', saveInput(), {});

    const result = await service.markRestored('u1', created.id, restoreInput({ restored: 2, missing: 0 }), { id: 'u1', code: 'KZ' });
    expect(result.restoredAt).toBeTruthy();

    const detail = await service.detail('u1', created.id);
    expect(detail.restoredAt).toBeTruthy();
    expect(detail.version).toBe(1);
    expect(detail.payload.snapshot?.lines).toHaveLength(2);
  });

  it('guarda el historial visible de restauraciones con el diff completo', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit);
    prisma.state.users = [{ id: 'u1', displayName: 'KEIBER ZAMUDIA' }];
    const created = await service.create('u1', saveInput(), {});

    // Dos restauraciones en momentos distintos: el historial va del más
    // reciente al más antiguo.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T15:00:00.000Z'));
    await service.markRestored('u1', created.id, restoreInput({ restored: 2, missing: 0, carteraBefore: 31, carteraAfter: 31 }), {
      id: 'u1',
      code: 'KZ',
    });
    vi.setSystemTime(new Date('2026-10-21T16:30:00.000Z'));
    await service.markRestored(
      'u1',
      created.id,
      restoreInput({
        restored: 1,
        missing: 1,
        pendingChanges: 2,
        stockChanges: 3,
        dateChanges: 1,
        carteraBefore: 31,
        carteraAfter: 35,
        beforeKg: 2800,
        afterKg: 2600,
        beforeCoverage: 1,
        afterCoverage: 0.93,
      }),
      { id: 'u1', code: 'KZ' },
    );
    vi.useRealTimers();

    const detail = await service.detail('u1', created.id);
    expect(detail.restoreCount).toBe(2);
    expect(detail.restores).toHaveLength(2);
    // Más reciente primero, con el diff tal como lo calculó el cliente.
    expect(detail.restores[0]).toMatchObject({
      restored: 1,
      missing: 1,
      pendingChanges: 2,
      stockChanges: 3,
      dateChanges: 1,
      carteraAfter: 35,
      afterKg: 2600,
      restoredByName: 'KEIBER ZAMUDIA',
    });
    expect(detail.restores[1]).toMatchObject({ restored: 2, missing: 0, carteraAfter: 31 });
    expect(detail.restores[0]!.restoredAt > detail.restores[1]!.restoredAt).toBe(true);

    const list = await service.list('u1');
    expect(list.items[0]!.restoreCount).toBe(2);
  });

  it('borrar el escenario se lleva su historial en cascada', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit);
    const created = await service.create('u1', saveInput(), {});
    await service.markRestored('u1', created.id, restoreInput({ restored: 2 }), { id: 'u1' });
    expect(prisma.state.restores).toHaveLength(1);

    await service.remove('u1', created.id, { id: 'u1' });
    expect(prisma.state.restores).toHaveLength(0);
  });
});
