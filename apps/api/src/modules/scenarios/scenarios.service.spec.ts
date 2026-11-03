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
  const state = {
    scenarios: [] as Row[],
    drafts: [] as Row[],
    orders: [] as Row[],
    runs: [] as Row[],
    restores: [] as Row[],
    users: [] as Row[],
    sheets: [] as Row[],
  };

  // Prisma devuelve el `_count` y las relaciones incluidas en la misma fila.
  const decorate = (row: Row) => ({
    ...row,
    owner: state.users.find((user) => user.id === row.ownerId) ?? null,
    _count: { restores: state.restores.filter((restore) => restore.scenarioId === row.id).length },
    restores: state.restores
      .filter((restore) => restore.scenarioId === row.id)
      .sort((a, b) => b.restoredAt.getTime() - a.restoredAt.getTime() || String(b.id).localeCompare(String(a.id))),
  });

  const prisma = {
    state,
    dispatchSheet: {
      findFirst: async ({ where }: Row) =>
        state.sheets.find((row) => matchesWhere(where, row)) ?? null,
    },
    salesOrderLine: {
      findMany: async () => [],
    },
    inventorySnapshot: {
      findFirst: async () => null,
    },
    deliveryDateOverride: {
      findMany: async () => [],
    },
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
    dispatchDraft: {
      findUnique: async ({ where }: Row) => state.drafts.find((row) => row.id === where.id) ?? null,
      create: async ({ data }: Row) => {
        const row: Row = { version: 1, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.drafts.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => {
        const row = state.drafts.find((item) => item.id === where.id);
        if (!row) throw new Error('no encontrado');
        const { version, ...rest } = data;
        Object.assign(row, rest);
        if (version && typeof version === 'object' && 'increment' in version) row.version += version.increment;
        row.updatedAt = new Date();
        return row;
      },
    },
    salesOrder: {
      findMany: async ({ where }: Row) => {
        const wanted = where?.externalNumber?.in as unknown[] | undefined;
        return state.orders.filter((row) => !wanted || wanted.includes(row.externalNumber));
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
const dispatch = { syncFromDraft: async () => undefined, createFromDraft: async () => ({}) } as never;

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
    const service = new ScenariosService(prisma as never, audit, dispatch);

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

  it('el equipo ve las simulaciones de todos, pero solo el creador o ADMIN las elimina', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit, dispatch);
    const created = await service.create('u1', saveInput(), {});

    // u2 puede verla, pero no restaurarla ni borrarla.
    const list = await service.list('u2');
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.canDelete).toBe(false);
    expect(list.items[0]!.canRestore).toBe(false);

    const detail = await service.detail('u2', created.id);
    expect(detail.name).toBe('Despacho lunes');
    await expect(service.remove('u2', created.id, {})).rejects.toThrow(/administrador/i);
    await expect(service.markRestored('u2', created.id, restoreInput(), {})).rejects.toThrow(/administrador/i);

    // El creador sí puede.
    await service.remove('u1', created.id, {});
    expect(prisma.state.scenarios).toHaveLength(0);
  });

  it('un ADMIN ve y elimina cualquier simulación del equipo', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit, dispatch);
    prisma.state.users.push(
      { id: 'u1', profitCode: 'AAA', displayName: 'ANA' },
      { id: 'u2', profitCode: 'BBB', displayName: 'BETO' },
    );
    await service.create('u2', saveInput({ name: 'De Beto' }), {});
    const ana = await service.create('u1', saveInput({ name: 'De Ana' }), {});

    const all = await service.list({ id: 'u1', isAdmin: true });
    expect(all.allOwners).toBe(true);
    expect(all.items).toHaveLength(2);
    expect(all.items.every((item) => item.canDelete)).toBe(true);

    await service.remove({ id: 'u1', isAdmin: true }, ana.id, {});
    expect(prisma.state.scenarios).toHaveLength(1);
  });

  it('respeta el límite de simulaciones guardadas', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit, dispatch);
    for (let index = 0; index < 25; index += 1) {
      await service.create('u1', saveInput({ name: `Plan ${index}` }), {});
    }
    await expect(service.create('u1', saveInput({ name: 'Plan 26' }), {})).rejects.toThrow(/límite/i);
  });

  it('no permite dos nombres iguales del mismo usuario', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit, dispatch);
    await service.create('u1', saveInput(), {});
    await expect(service.create('u1', saveInput(), {})).rejects.toThrow(/ese nombre/i);
  });

  it('rechaza un renombrado con versión vieja (versionado optimista)', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit, dispatch);
    const created = await service.create('u1', saveInput(), {});

    const renamed = await service.update('u1', created.id, { name: 'Despacho martes', version: 1 }, {});
    expect(renamed.name).toBe('Despacho martes');
    expect(renamed.version).toBe(2);

    await expect(service.update('u1', created.id, { name: 'Otra', version: 1 }, {})).rejects.toThrow(/otra pestaña/i);
  });

  it('el borrador global es uno solo y no lleva foto', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit, dispatch);

    const input = {
      recipe: { by: 'cliente', mode: 'disponible', sort: 'cobertura', filters: {} },
      selected: [{ orderNumber: '408251710', productCode: 'ABAPOR77' }],
    } as never;

    await service.saveDraft('u1', input);
    await service.saveDraft('u1', input);
    expect(prisma.state.drafts).toHaveLength(1);
    expect(prisma.state.drafts[0]!.id).toBe('GLOBAL');
    expect(prisma.state.scenarios).toHaveLength(0);

    const draft = await service.getDraft('u1');
    expect(draft.scenario?.lineCount).toBe(1);
    expect(draft.scenario?.payload.snapshot).toBeNull();
    expect(draft.scenario?.coverage).toBe(0);
  });

  it('el plan es compartido: el primero que marca reserva y nadie más lo quita sin permiso', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit, dispatch);
    const base = { by: 'cliente', mode: 'disponible', sort: 'cobertura', filters: {} } as const;
    const inputA = {
      recipe: base,
      selected: [{ orderNumber: 'A', productCode: 'P' }],
    } as never;
    const inputB = {
      recipe: base,
      selected: [{ orderNumber: 'B', productCode: 'P' }],
    } as never;

    await service.saveDraft({ id: 'u1', code: 'AAA' }, inputA, { id: 'u1', isAdmin: false });
    // u2 envía su selección SIN la línea de u1: el servidor la conserva.
    const after = await service.saveDraft({ id: 'u2', code: 'BBB' }, inputB, { id: 'u2', isAdmin: false });
    const keys = after.scenario?.payload.selected.map((ref) => `${ref.orderNumber}#${ref.productCode}`);
    expect(keys).toEqual(['A#P', 'B#P']);
    expect(after.scenario?.payload.selected[0]!.selectedById).toBe('u1');
    expect(after.scenario?.payload.selected[1]!.selectedById).toBe('u2');

    // Sin permiso, liberar la línea ajena no hace nada.
    const withoutPermission = await service.releaseDraftLines(
      { id: 'u2' },
      { lines: [{ orderNumber: 'A', productCode: 'P' }] },
      { id: 'u2', isAdmin: false },
    );
    expect(withoutPermission.scenario?.payload.selected).toHaveLength(2);

    // Con «Quitar selecciones de otros» sí se libera.
    const withPermission = await service.releaseDraftLines(
      { id: 'u2' },
      { lines: [{ orderNumber: 'A', productCode: 'P' }] },
      { id: 'u2', isAdmin: false, canOverride: true },
    );
    expect(withPermission.scenario?.payload.selected.map((ref) => ref.orderNumber)).toEqual(['B']);
  });

  it('marca la simulación como desactualizada cuando cambió la sync', async () => {
    const prisma = createFakePrisma();
    const service = new ScenariosService(prisma as never, audit, dispatch);
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
    const service = new ScenariosService(prisma as never, audit, dispatch);
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
    const service = new ScenariosService(prisma as never, audit, dispatch);
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
    const service = new ScenariosService(prisma as never, audit, dispatch);
    const created = await service.create('u1', saveInput(), {});
    await service.markRestored('u1', created.id, restoreInput({ restored: 2 }), { id: 'u1' });
    expect(prisma.state.restores).toHaveLength(1);

    await service.remove('u1', created.id, { id: 'u1' });
    expect(prisma.state.restores).toHaveLength(0);
  });
});
