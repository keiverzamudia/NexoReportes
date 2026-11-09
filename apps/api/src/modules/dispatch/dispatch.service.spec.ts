import { describe, expect, it } from 'vitest';
import { DispatchService } from './dispatch.service';

// ============================================================
// Fake mínimo de Prisma para el despacho de almacén.
// ============================================================

type Row = Record<string, any>;

function matchValue(where: Row, row: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object') {
      if ('in' in value) return (value as { in: unknown[] }).in.includes(row[key]);
      if ('notIn' in value) return !(value as { notIn: unknown[] }).notIn.includes(row[key]);
      if ('startsWith' in value) return String(row[key] ?? '').startsWith((value as { startsWith: string }).startsWith);
      if ('gte' in value) return new Date(row[key]) >= new Date((value as { gte: Date }).gte);
      if ('lte' in value) return new Date(row[key]) <= new Date((value as { lte: Date }).lte);
      if ('not' in value) return row[key] !== (value as { not: unknown }).not;
    }
    return row[key] === value;
  });
}

function matches(where: Row | undefined, row: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (value as Row[]).every((clause) => matches(clause, row));
    if (key === 'OR') return (value as Row[]).some((clause) => matches(clause, row));
    return matchValue({ [key]: value }, row);
  });
}

function createFakePrisma() {
  const state = {
    sheets: [] as Row[],
    lines: [] as Row[],
    progress: [] as Row[],
    events: [] as Row[],
    notifications: [] as Row[],
    users: [
      { id: 'u-plan', profitCode: 'KZ', displayName: 'KEIBER ZAMUDIA', role: 'PLANIFICADOR', isActive: true },
      { id: 'u-alm1', profitCode: 'ARIV', displayName: 'ALEXIS RIVAS', role: 'ALMACEN', isActive: true },
      { id: 'u-alm2', profitCode: 'AALV', displayName: 'ANA ALVAREZ', role: 'ALMACEN', isActive: true },
      { id: 'u-ger', profitCode: 'JGER', displayName: 'JEFA GERENCIA', role: 'GERENCIA', isActive: true },
      { id: 'u-admin', profitCode: 'ADM', displayName: 'ADMINISTRADOR', role: 'ADMIN', isActive: true },
      { id: 'u-con', profitCode: 'CONS', displayName: 'CONSULTA SOLO', role: 'CONSULTA', isActive: true },
    ],
    scenarios: [] as Row[],
    // Plan vivo y cartera mínima para probar la sincronización de renglones.
    draft: null as Row | null,
    orderLines: [] as Row[],
    inventory: { lines: [] as Row[] },
    // RBAC: solo estos roles pueden operar despachos (acción «Operar»).
    rolePermissions: [
      { roleCode: 'ALMACEN', module: 'despacho', action: 'update' },
      { roleCode: 'ADMIN', module: 'despacho', action: 'update' },
    ] as Row[],
    roles: [
      { code: 'ADMIN', baseRole: 'ADMIN' },
      { code: 'GERENCIA', baseRole: 'GERENCIA' },
      { code: 'PLANIFICADOR', baseRole: 'PLANIFICADOR' },
      { code: 'ALMACEN', baseRole: 'ALMACEN' },
      { code: 'CONSULTA', baseRole: 'CONSULTA' },
    ] as Row[],
  };

  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${++sequence}`;

  const withRelations = (sheet: Row) => ({
    ...sheet,
    lines: state.lines.filter((line) => line.sheetId === sheet.id),
    customerProgress: state.progress.filter((row) => row.sheetId === sheet.id),
    events: state.events.filter((event) => event.sheetId === sheet.id),
    assignedTo: sheet.assignedToId ? state.users.find((user) => user.id === sheet.assignedToId) ?? null : null,
  });

  const prisma = {
    state,
    dispatchScenario: {
      findFirst: async ({ where }: Row) => state.scenarios.find((row) => matches(where, row)) ?? null,
    },
    dispatchDraft: {
      findUnique: async ({ where }: Row) =>
        state.draft && matches(where, state.draft) ? state.draft : null,
    },
    salesOrderLine: {
      findMany: async ({ where }: Row) =>
        state.orderLines.filter((line) => {
          const orders = where?.order?.externalNumber?.in as string[] | undefined;
          const products = where?.productCode?.in as string[] | undefined;
          return (
            (!orders || orders.includes(line.order.externalNumber)) &&
            (!products || products.includes(line.productCode))
          );
        }),
    },
    inventorySnapshot: {
      findFirst: async () => state.inventory,
    },
    deliveryDateOverride: {
      findMany: async () => [] as Row[],
    },
    user: {
      findUnique: async ({ where }: Row) => state.users.find((user) => user.id === where.id) ?? null,
      findFirst: async ({ where }: Row = {}) => state.users.find((user) => matches(where, user)) ?? null,
      findMany: async ({ where }: Row = {}) => state.users.filter((user) => matches(where, user)),
      count: async ({ where }: Row = {}) => state.users.filter((user) => matches(where, user)).length,
    },
    rolePermission: {
      findMany: async ({ where }: Row = {}) =>
        state.rolePermissions.filter((row) => matches(where, row)),
    },
    userPermission: {
      findMany: async ({ where }: Row = {}) => [] as Row[],
    },
    role: {
      findMany: async ({ where }: Row = {}) => state.roles.filter((row) => matches(where, row)),
      findUnique: async ({ where }: Row) => state.roles.find((row) => row.code === where.code) ?? null,
    },
    dispatchSheet: {
      findMany: async ({ where }: Row = {}) => state.sheets.filter((row) => matches(where, row)).map(withRelations),
      findUnique: async ({ where }: Row) => {
        const found = state.sheets.find((row) => row.id === where.id);
        return found ? withRelations(found) : null;
      },
      findFirst: async ({ where }: Row) => {
        const rows = state.sheets.filter((row) => matches(where, row));
        return rows.length > 0 ? rows[rows.length - 1] : null;
      },
      count: async ({ where }: Row = {}) => state.sheets.filter((row) => matches(where, row)).length,
      create: async ({ data }: Row) => {
        if (state.sheets.some((row) => row.number === data.number)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const now = new Date();
        const sheet: Row = {
          id: id('sheet'),
          status: 'ENVIADO',
          plannedLines: 0,
          plannedSacks: 0,
          plannedKg: 0,
          loadedSacks: 0,
          loadedKg: 0,
          differenceKg: 0,
          assignedRole: 'ALMACEN',
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        delete sheet.lines;
        delete sheet.events;
        delete sheet.customerProgress;
        state.sheets.push(sheet);

        for (const line of data.lines?.create ?? []) {
          state.lines.push({ id: id('line'), sheetId: sheet.id, loadedQty: null, loadedKg: null, note: null, checkedAt: null, checkedById: null, checkedByName: null, ...line });
        }
        for (const event of data.events?.create ? [data.events.create] : []) {
          state.events.push({ id: id('ev'), sheetId: sheet.id, createdAt: new Date(), ...event });
        }
        for (const progress of data.customerProgress?.create ?? []) {
          state.progress.push({
            id: id('progress'),
            sheetId: sheet.id,
            loadStartedAt: null,
            loadClosedAt: null,
            invoiceDeliveredAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...progress,
          });
        }
        return withRelations(sheet);
      },
      update: async ({ where, data }: Row) => {
        const sheet = state.sheets.find((row) => row.id === where.id);
        if (!sheet) throw new Error('no encontrado');
        Object.assign(sheet, data, { updatedAt: new Date() });
        return withRelations(sheet);
      },
    },
    dispatchSheetLine: {
      findFirst: async ({ where }: Row) => state.lines.find((line) => matches(where, line)) ?? null,
      update: async ({ where, data }: Row) => {
        const line = state.lines.find((row) => row.id === where.id);
        if (!line) throw new Error('no encontrado');
        Object.assign(line, data);
        return line;
      },
    },
    dispatchSheetEvent: {
      create: async ({ data }: Row) => {
        const event = { id: id('ev'), createdAt: new Date(), ...data };
        state.events.push(event);
        return event;
      },
    },
    dispatchCustomerProgress: {
      create: async ({ data }: Row) => {
        const row = {
          id: id('progress'),
          loadStartedAt: null,
          loadClosedAt: null,
          invoiceDeliveredAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.progress.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => {
        const row = state.progress.find((item) => item.id === where.id);
        if (!row) throw new Error('no encontrado');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      updateMany: async ({ where, data }: Row) => {
        const rows = state.progress.filter((row) => matches(where, row));
        for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
        return { count: rows.length };
      },
      delete: async ({ where }: Row) => {
        const index = state.progress.findIndex((row) => row.id === where.id);
        if (index < 0) throw new Error('no encontrado');
        return state.progress.splice(index, 1)[0];
      },
      deleteMany: async ({ where }: Row = {}) => {
        const before = state.progress.length;
        state.progress = state.progress.filter((row) => !matches(where, row));
        return { count: before - state.progress.length };
      },
    },
    notification: {
      create: async ({ data }: Row) => {
        const notification = { id: id('ntf'), readAt: null, createdAt: new Date(), ...data };
        state.notifications.push(notification);
        return notification;
      },
      findMany: async ({ where, take }: Row) =>
        state.notifications.filter((row) => matches(where, row)).slice(0, take ?? 100),
      count: async ({ where }: Row = {}) => state.notifications.filter((row) => matches(where, row)).length,
      updateMany: async ({ where, data }: Row) => {
        const rows = state.notifications.filter((row) => matches(where, row));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    },
    $transaction: async (operations: unknown[]) => Promise.all(operations),
  };
  return prisma;
}

const audit = { record: async () => undefined } as never;

// PCP: el despacho delega la creación de llegadas. Aquí se neutraliza para
// probar solo el túnel de despacho (las llegadas tienen su propia suite).
const arrivals = {
  rowsForSheet: async () => [],
  notifyExpected: async () => undefined,
  cancelForSheet: async () => undefined,
} as never;

const planner = { id: 'u-plan', role: 'PLANIFICADOR', code: 'KZ' };
// Quien publica en las pruebas: gerencia conserva el mismo id que el dueño del
// escenario sembrado (`seedScenario`), y tiene el permiso de publicar.
const publisher = { id: 'u-plan', role: 'GERENCIA', code: 'KZ', canPublish: true };
const almacenPublisher = { id: 'u-alm1', role: 'ALMACEN', code: 'ARIV', canPublish: true };
const operator1 = { id: 'u-alm1', role: 'ALMACEN', code: 'ARIV' };
const operator2 = { id: 'u-alm2', role: 'ALMACEN', code: 'AALV' };
const manager = { id: 'u-ger', role: 'GERENCIA', code: 'JGER' };
const admin = { id: 'u-admin', role: 'ADMIN', isAdmin: true, code: 'ADM' };
const outsider = { id: 'u-con', role: 'CONSULTA', code: 'CONS' };

function snapshotLine(overrides: Row = {}) {
  return {
    orderNumber: '408251710',
    productCode: 'ABAPOR77',
    customerCode: '294201237',
    customerName: 'AGRICOLA LA CAÑADA',
    description: 'POLLO ENGORDE 35KG',
    uom: 'SAC',
    pendingQty: 60,
    pendingKg: 2400,
    assignedQty: 60,
    assignedKg: 2400,
    missingQty: 0,
    missingKg: 0,
    stockTotal: 500,
    effectiveDate: '2026-10-21',
    priority: 1,
    ...overrides,
  };
}

function seedScenario(prisma: ReturnType<typeof createFakePrisma>, ownerId = 'u-plan', id = 'sc-1') {
  const lines = [
    snapshotLine({ comment: 'Retira Elías Lozada' }),
    snapshotLine({ productCode: 'ABABOV85', priority: 2, assignedQty: 10, assignedKg: 400 }),
  ];
  const scenario = {
    id,
    ownerId,
    name: 'Despacho lunes',
    kind: 'SAVED',
    payload: JSON.stringify({
      recipe: { by: 'cliente', mode: 'disponible', sort: 'cobertura', filters: {} },
      selected: lines.map((line) => ({ orderNumber: line.orderNumber, productCode: line.productCode })),
      snapshot: {
        takenAt: '2026-10-18T13:12:00.000Z',
        carteraLines: 31,
        totals: {
          lines: lines.length,
          sacks: 70,
          pendingQty: 70,
          pendingKg: 2800,
          assignedQty: 70,
          assignedKg: 2800,
          missingQty: 0,
          missingKg: 0,
          coverage: 1,
        },
        lines,
      },
      loadPlan: {
        grouping: 'cliente',
        segments: [
          {
            id: 'seg-1',
            label: 'AGRICOLA LA CAÑADA',
            customerCode: '294201237',
            orderNumbers: ['408251710'],
            kg: 2800,
            sacks: 70,
            color: '#0F4C5C',
          },
        ],
      },
    }),
  };
  prisma.state.scenarios.push(scenario);
  return scenario;
}

async function publish(prisma: ReturnType<typeof createFakePrisma>, assignedToId: string | null = null) {
  const service = new DispatchService(prisma as never, audit, arrivals);
  seedScenario(prisma);
  return service.create(publisher, {
    scenarioId: 'sc-1',
    title: 'Despacho lunes',
    instructions: 'Cargar por la puerta 2',
    assignedToId,
  });
}

// Cartera mínima + plan vivo para probar la sincronización de renglones.
function seedDraft(
  prisma: ReturnType<typeof createFakePrisma>,
  selected: Array<{ orderNumber: string; productCode: string }>,
) {
  const order = {
    externalNumber: '408251710',
    customerCode: '294201237',
    customerName: 'AGRICOLA LA CAÑADA',
    orderDate: null,
    requestedDate: null,
    authorized: true,
  };
  prisma.state.orderLines = [
    {
      orderId: 'o-1',
      order,
      productCode: 'ABAPOR77',
      description: 'POLLO ENGORDE 35KG',
      uom: 'SAC',
      pendingQty: 60,
      pendingKg: 2400,
    },
    {
      orderId: 'o-1',
      order,
      productCode: 'ABABOV85',
      description: 'BOVINO 85',
      uom: 'SAC',
      pendingQty: 10,
      pendingKg: 400,
    },
  ];
  prisma.state.inventory = {
    lines: [
      { productCode: 'ABAPOR77', warehouseCode: 'Stock 03', qty: 500 },
      { productCode: 'ABABOV85', warehouseCode: 'Stock 03', qty: 500 },
    ],
  };
  prisma.state.draft = {
    id: 'GLOBAL',
    version: 2,
    payload: JSON.stringify({
      recipe: { by: 'cliente', mode: 'disponible', sort: 'cobertura', filters: {} },
      selected,
      snapshot: null,
      loadPlan: null,
      comments: {},
    }),
  };
}

describe('DispatchService — anulación de renglones', () => {
  it('marca ANULADO con autor y motivo sin borrar el renglón', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    const sheet = await publish(prisma);
    prisma.state.sheets[0]!.draftId = 'GLOBAL';
    seedDraft(prisma, [{ orderNumber: '408251710', productCode: 'ABAPOR77' }]);

    const report = await service.syncFromDraft('GLOBAL', {
      actor: { id: 'u-plan', code: 'KZ', name: 'KEIBER ZAMUDIA' },
      defaultReason: 'RETIRADO_DEL_PLAN',
      source: 'PLAN',
    });

    expect(report.removedLines).toBe(1);
    expect(report.canceledSheets).toHaveLength(0);
    const removed = prisma.state.lines.find((line) => line.productCode === 'ABABOV85')!;
    expect(removed.status).toBe('ANULADO');
    expect(removed.removedByName).toBe('KEIBER ZAMUDIA');
    expect(removed.removalReason).toBe('RETIRADO_DEL_PLAN');

    const fresh = await service.detail(admin, sheet.id);
    expect(fresh.status).toBe('ENVIADO');
    expect(fresh.plannedLines).toBe(1);
    expect(fresh.annulledLines).toBe(1);
    expect(fresh.lines.find((line) => line.productCode === 'ABABOV85')!.status).toBe('ANULADO');
  });

  it('anula la hoja cuando el plan queda vacío', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    const sheet = await publish(prisma);
    prisma.state.sheets[0]!.draftId = 'GLOBAL';
    seedDraft(prisma, []);

    const report = await service.syncFromDraft('GLOBAL', {
      actor: { id: 'u-plan', code: 'KZ', name: 'KEIBER ZAMUDIA' },
      defaultReason: 'RETIRADO_DEL_PLAN',
      source: 'PLAN',
    });

    expect(report.removedLines).toBe(2);
    expect(report.canceledSheets).toEqual([{ id: sheet.id, number: sheet.number }]);
    const fresh = await service.detail(admin, sheet.id);
    expect(fresh.status).toBe('CANCELADO');
    expect(fresh.cancelReason).toContain('plan quedó vacío');
    expect(fresh.plannedLines).toBe(0);
    expect(fresh.annulledLines).toBe(2);
    expect(prisma.state.events.some((event) => event.type === 'PLAN_VACIO')).toBe(true);
  });

  it('reactiva el renglón si vuelve al plan', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    const sheet = await publish(prisma);
    prisma.state.sheets[0]!.draftId = 'GLOBAL';
    seedDraft(prisma, [{ orderNumber: '408251710', productCode: 'ABAPOR77' }]);
    await service.syncFromDraft('GLOBAL', {
      actor: { id: 'u-plan', code: 'KZ', name: 'KEIBER ZAMUDIA' },
      defaultReason: 'RETIRADO_DEL_PLAN',
      source: 'PLAN',
    });

    seedDraft(prisma, [
      { orderNumber: '408251710', productCode: 'ABAPOR77' },
      { orderNumber: '408251710', productCode: 'ABABOV85' },
    ]);
    const report = await service.syncFromDraft('GLOBAL', {
      actor: { id: 'u-plan', code: 'KZ', name: 'KEIBER ZAMUDIA' },
      defaultReason: 'RETIRADO_DEL_PLAN',
      source: 'PLAN',
    });

    expect(report.removedLines).toBe(0);
    const revived = prisma.state.lines.find((line) => line.productCode === 'ABABOV85')!;
    expect(revived.status).toBe('PENDIENTE');
    expect(revived.removedAt).toBeNull();
    expect(revived.removalReason).toBeNull();
    const fresh = await service.detail(admin, sheet.id);
    expect(fresh.plannedLines).toBe(2);
    expect(fresh.annulledLines).toBe(0);
  });
});

describe('DispatchService — publicar', () => {
  it('crea la hoja con renglones, evento, notificación y correlativo', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma);

    const sheet = await service.create(publisher, { scenarioId: 'sc-1', title: 'Despacho lunes' });

    expect(sheet.number).toBe(`DSP-${new Date().getFullYear()}-0001`);
    expect(sheet.status).toBe('ENVIADO');
    expect(sheet.lines).toHaveLength(2);
    expect(sheet.lines[0]!.plannedQty).toBe(60);
    // El comentario de la simulación viaja al renglón del almacén.
    expect(sheet.lines[0]!.note).toBe('Retira Elías Lozada');
    expect(sheet.loadPlan?.segments).toHaveLength(1);
    expect(sheet.plannedKg).toBe(2800);
    // La bitácora solo se entrega al ADMIN: se consulta con ese rol.
    expect((await service.detail(admin, sheet.id)).events[0]!.type).toBe('ENVIADO');
    // Bandeja compartida: se notifica a los dos operadores de almacén.
    expect(prisma.state.notifications).toHaveLength(2);
    expect(prisma.state.notifications.every((row) => row.type === 'DESPACHO_ENVIADO')).toBe(true);

    const second = await service.create(publisher, { scenarioId: 'sc-1', title: 'Despacho martes' });
    expect(second.number).toBe(`DSP-${new Date().getFullYear()}-0002`);
  });

  it('solo con el permiso «Armar y enviar simulación» se puede publicar', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma);
    seedScenario(prisma, 'u-alm1', 'sc-2');
    await expect(service.create(planner, { scenarioId: 'sc-1', title: 'Planificador' })).rejects.toThrow(
      /Armar y enviar simulación/i,
    );
    await expect(service.create(outsider, { scenarioId: 'sc-1', title: 'Consulta' })).rejects.toThrow(
      /Armar y enviar simulación/i,
    );
    // Almacén tampoco publica por defecto; solo si se le concede el permiso.
    await expect(service.create(operator1, { scenarioId: 'sc-1', title: 'Almacén' })).rejects.toThrow(
      /Armar y enviar simulación/i,
    );
    await expect(service.create(almacenPublisher, { scenarioId: 'sc-2', title: 'Almacén con permiso' })).resolves.toMatchObject({
      status: 'ENVIADO',
    });
  });

  it('publica un escenario del equipo y rechaza uno inexistente', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma, 'u-alm1');

    // El escenario es del equipo: otro usuario con permiso puede enviarlo.
    await expect(service.create(publisher, { scenarioId: 'sc-1', title: 'X' })).resolves.toMatchObject({
      status: 'ENVIADO',
    });
    await expect(service.create(publisher, { scenarioId: 'sc-otro', title: 'X' })).rejects.toThrow(/No encontramos/i);
  });

  it('exige que el operador asignado exista y sea de almacén', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma);

    await expect(service.create(publisher, { scenarioId: 'sc-1', title: 'X', assignedToId: 'u-con' })).rejects.toThrow(
      /no está disponible/i,
    );

    const sheet = await service.create(publisher, { scenarioId: 'sc-1', title: 'X', assignedToId: 'u-alm1' });
    expect(sheet.assignedToName).toBe('ALEXIS RIVAS');
    expect(prisma.state.notifications).toHaveLength(1);
    expect(prisma.state.notifications[0]!.recipientId).toBe('u-alm1');
  });

  it('sin operadores de almacén envía igual a la bandeja compartida (sin bloqueo)', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma);
    // Nadie con rol ALMACEN: la hoja queda en la bandeja compartida.
    prisma.state.users = prisma.state.users.map((user) => (user.role === 'ALMACEN' ? { ...user, role: 'CONSULTA' } : user));

    const published = await service.create(publisher, { scenarioId: 'sc-1', title: 'Sin operadores' });
    expect(published.status).toBe('ENVIADO');
    expect(prisma.state.sheets).toHaveLength(1);
    expect(prisma.state.notifications).toHaveLength(0);

    const readiness = await service.assignees();
    expect(readiness.hasWarehouseOperators).toBe(false);
    // Un operador bloqueado (isActive=false) tampoco cuenta.
    prisma.state.users.push({ id: 'u-alm3', profitCode: 'BLOQ', displayName: 'BLOQUEADO', role: 'ALMACEN', isActive: false });
    expect((await service.assignees()).hasWarehouseOperators).toBe(false);

    prisma.state.users.push({ id: 'u-alm4', profitCode: 'NUEV', displayName: 'NUEVO OPERADOR', role: 'ALMACEN', isActive: true });
    const ready = await service.assignees();
    expect(ready.hasWarehouseOperators).toBe(true);
    // ALMACEN primero en la lista (es quien realmente opera).
    expect(ready.operators[0]!.role).toBe('ALMACEN');
    expect(ready.operators.map((operator) => operator.code)).toContain('NUEV');
  });
});

describe('DispatchService — toma al empezar la carga', () => {
  it('el primer renglón inicia la hoja, la reclama y deja el evento', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    const started = await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' });

    expect(started.status).toBe('EN_PROCESO');
    expect(started.startedAt).toBeTruthy();
    expect(started.claimedByName).toBe('ALEXIS RIVAS');
    // El operador no recibe la bitácora; el admin sí la ve.
    expect(started.events).toHaveLength(0);
    expect((await service.detail(admin, sheet.id)).events.some((event) => event.type === 'EN_PROCESO')).toBe(true);
    // La toma no genera un aviso de acuse al planificador.
    expect(prisma.state.notifications.some((row) => row.recipientId === 'u-plan')).toBe(false);
  });

  it('la bandeja compartida la toma el primero: el segundo no puede operar', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' });
    await expect(service.updateLine(operator2, sheet.id, sheet.lines[1]!.id, { status: 'CARGADO' })).rejects.toThrow(
      /ya lo tomó/i,
    );
  });

  it('un despacho asignado a otro operador se ve en la bandeja pero no se puede operar', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma, 'u-alm1');
    const service = new DispatchService(prisma as never, audit, arrivals);

    // Todo almacén ve todo lo publicado; solo el asignado puede operarlo.
    const inbox = await service.list(operator2, { scope: 'all' });
    expect(inbox.items).toHaveLength(1);
    await expect(service.updateLine(operator2, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' })).rejects.toThrow(
      /asignado a otro operador/i,
    );
    // El asignado sí lo ve y lo puede tomar.
    expect((await service.list(operator1, { scope: 'all' })).items).toHaveLength(1);
    await expect(service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' })).resolves.toMatchObject({
      status: 'EN_PROCESO',
    });
  });

  it('sin «Ver todos» no se ve lo ajeno; con el permiso se ve pero no se opera', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    // Sin el permiso, el despacho ajeno no existe para este usuario.
    await expect(service.detail(outsider, sheet.id)).rejects.toThrow(/no encontrado/i);
    // Con «Ver todos» puede consultarlo, pero sigue sin poder operarlo.
    const granted = { ...outsider, canViewAll: true };
    await expect(service.detail(granted, sheet.id)).resolves.toMatchObject({ id: sheet.id });
    await expect(service.updateLine(granted, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' })).rejects.toThrow(
      /Solo el personal de almacén/i,
    );
    await expect(service.detail(manager, sheet.id)).resolves.toMatchObject({ id: sheet.id });
  });
});

describe('DispatchService — carga y cierre', () => {
  async function inProgress() {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);
    // Marcar el primer renglón inicia la hoja: no hay paso de acuse.
    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' });
    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'PENDIENTE' });
    return { prisma, service, sheet };
  }

  it('completar toma la cantidad planificada y acumula el avance', async () => {
    const { service, sheet } = await inProgress();

    const updated = await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' });

    const line = updated.lines.find((item) => item.id === sheet.lines[0]!.id)!;
    expect(line.loadedQty).toBe(60);
    expect(line.loadedKg).toBe(2400);
    // Completar no borra el comentario del planificador.
    expect(line.note).toBe('Retira Elías Lozada');
    expect(updated.linesDone).toBe(1);
    expect(updated.progress).toBeCloseTo(0.5, 5);
    expect(updated.loadedKg).toBe(2400);
    expect(updated.differenceKg).toBe(0);
  });

  it('cuenta pedidos distintos aunque el pedido traiga varios renglones', async () => {
    const { service, sheet } = await inProgress();
    const listed = await service.list(admin, { scope: 'all' });
    const row = listed.items.find((item) => item.id === sheet.id)!;
    expect(row.plannedLines).toBe(2);
    expect(row.plannedOrders).toBe(1);
    expect(row.pendingOrders).toBe(1);

    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' });
    await service.updateLine(operator1, sheet.id, sheet.lines[1]!.id, { status: 'CARGADO' });
    const closed = (await service.list(admin, { scope: 'all' })).items.find((item) => item.id === sheet.id)!;
    expect(closed.pendingOrders).toBe(0);
  });

  it('deshacer devuelve el renglón a pendiente sin tocar las demás marcas', async () => {
    const { service, sheet } = await inProgress();

    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' });
    await service.updateLine(operator1, sheet.id, sheet.lines[1]!.id, { status: 'CARGADO' });
    const reset = await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'PENDIENTE' });

    const line = reset.lines.find((item) => item.id === sheet.lines[0]!.id)!;
    expect(line.status).toBe('PENDIENTE');
    expect(line.loadedQty).toBeNull();
    expect(line.loadedKg).toBeNull();
    expect(reset.linesDone).toBe(1);
    // La otra marca sigue intacta.
    expect(reset.lines.find((item) => item.id === sheet.lines[1]!.id)!.status).toBe('CARGADO');
  });

  it('completar una marca histórica devuelve la hoja a EN_PROCESO', async () => {
    const { prisma, service, sheet } = await inProgress();
    const legacy = prisma.state.lines.find((line) => line.id === sheet.lines[0]!.id)!;
    legacy.status = 'FALTANTE';
    legacy.loadedQty = 0;
    legacy.loadedKg = 0;
    prisma.state.sheets.find((row) => row.id === sheet.id)!.status = 'CON_NOVEDAD';

    const updated = await service.updateLine(operator1, sheet.id, legacy.id, { status: 'CARGADO' });
    expect(updated.lines.find((item) => item.id === legacy.id)!.status).toBe('CARGADO');
    expect(updated.status).toBe('EN_PROCESO');
  });

  it('guarda una entrega parcial con motivo, kg derivados y estado con novedad', async () => {
    const { service, sheet } = await inProgress();

    const updated = await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, {
      status: 'PARCIAL',
      loadedQty: 24,
      note: 'Solo había 24 sacos en el lote',
    });

    const line = updated.lines.find((item) => item.id === sheet.lines[0]!.id)!;
    expect(line.status).toBe('PARCIAL');
    expect(line.loadedQty).toBe(24);
    // 60 SAC = 2.400 kg → 24 SAC = 960 kg (kg por ratio de la unidad).
    expect(line.loadedKg).toBe(960);
    expect(line.note).toBe('Solo había 24 sacos en el lote');
    expect(updated.status).toBe('CON_NOVEDAD');
    expect(updated.linesDone).toBe(1);
  });

  it('conserva la hora de cierre al corregir una nota o volver a marcar cargado', async () => {
    const { prisma, service, sheet } = await inProgress();
    const lineId = sheet.lines[0]!.id;
    await service.updateLine(operator1, sheet.id, lineId, { status: 'CARGADO' });
    const firstCheck = prisma.state.lines.find((line) => line.id === lineId)!.checkedAt;
    expect(firstCheck).toBeInstanceOf(Date);

    await service.updateLine(operator1, sheet.id, lineId, { status: 'CARGADO' });
    const afterSame = prisma.state.lines.find((line) => line.id === lineId)!.checkedAt;
    expect(afterSame).toBe(firstCheck);

    // Reabrir sí limpia el sello; volver a cerrar toma una hora nueva.
    await service.updateLine(operator1, sheet.id, lineId, { status: 'PENDIENTE' });
    expect(prisma.state.lines.find((line) => line.id === lineId)!.checkedAt).toBeNull();
    await service.updateLine(operator1, sheet.id, lineId, { status: 'CARGADO' });
    expect(prisma.state.lines.find((line) => line.id === lineId)!.checkedAt).toBeInstanceOf(Date);
  });

  it('guarda pedido, código y nombre del producto al cerrar la carga', async () => {
    const { prisma, service, sheet } = await inProgress();
    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' });
    await service.updateLine(operator1, sheet.id, sheet.lines[1]!.id, { status: 'CARGADO' });

    const stored = prisma.state.events.find((row) => row.type === 'CARGA_CERRADA');
    expect(stored?.meta).toBeTruthy();
    const meta = JSON.parse(stored!.meta);
    expect(meta.customerName).toBe('AGRICOLA LA CAÑADA');
    expect(meta.products).toHaveLength(2);
    expect(meta.products[0]).toMatchObject({
      orderNumber: '408251710',
      productCode: 'ABAPOR77',
      description: 'POLLO ENGORDE 35KG',
      qty: 60,
      uom: 'SAC',
      status: 'CARGADO',
    });
    expect(meta.minutes).toBeGreaterThanOrEqual(0);

    // El detalle entrega el meta ya parseado, no el JSON crudo.
    const fresh = await service.detail(admin, sheet.id);
    const closed = fresh.events.find((event) => event.type === 'CARGA_CERRADA');
    expect(closed?.meta?.products[0]?.productCode).toBe('ABAPOR77');
    expect(closed?.meta?.customerName).toBe('AGRICOLA LA CAÑADA');
  });

  it('rechaza parciales sin motivo o fuera de rango y faltantes sin motivo', async () => {
    const { service, sheet } = await inProgress();
    const lineId = sheet.lines[0]!.id;

    await expect(service.updateLine(operator1, sheet.id, lineId, { status: 'PARCIAL', loadedQty: 10 })).rejects.toThrow(
      /motivo/i,
    );
    await expect(
      service.updateLine(operator1, sheet.id, lineId, { status: 'PARCIAL', loadedQty: 0, note: 'Sin stock' }),
    ).rejects.toThrow(/mayor que cero/i);
    await expect(
      service.updateLine(operator1, sheet.id, lineId, { status: 'PARCIAL', loadedQty: 60, note: 'Todo el lote' }),
    ).rejects.toThrow(/Cargado/i);
    await expect(service.updateLine(operator1, sheet.id, lineId, { status: 'FALTANTE' })).rejects.toThrow(/motivo/i);
  });

  it('cierra con un parcial y un no cargado (cada uno con motivo) y totales reales', async () => {
    const { service, sheet } = await inProgress();

    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, {
      status: 'PARCIAL',
      loadedQty: 24,
      note: 'Solo había 24 sacos',
    });
    await service.updateLine(operator1, sheet.id, sheet.lines[1]!.id, {
      status: 'FALTANTE',
      note: 'El cliente no lo recibió',
    });
    const closed = await service.complete(operator1, sheet.id, { note: 'Se despachó lo disponible' });

    expect(closed.status).toBe('DESPACHADO');
    expect(closed.loadedSacks).toBe(24);
    expect(closed.loadedKg).toBe(960);
    // 960 kg reales contra 2.800 kg planificados.
    expect(closed.differenceKg).toBe(-1840);
  });

  it('no cierra si una diferencia quedó sin motivo', async () => {
    const { prisma, service, sheet } = await inProgress();

    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, {
      status: 'PARCIAL',
      loadedQty: 24,
      note: 'Solo había 24 sacos',
    });
    await service.updateLine(operator1, sheet.id, sheet.lines[1]!.id, { status: 'CARGADO' });
    // Simula una marca vieja sin motivo (antes el motivo no era obligatorio).
    prisma.state.lines.find((line) => line.id === sheet.lines[0]!.id)!.note = null;

    await expect(service.complete(operator1, sheet.id, {})).rejects.toThrow(/sin motivo/i);
  });

  it('no cierra con renglones incompletos y cierra con totales reales', async () => {
    const { prisma, service, sheet } = await inProgress();

    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' });
    await expect(service.complete(operator1, sheet.id, {})).rejects.toThrow(/por resolver/i);

    await service.updateLine(operator1, sheet.id, sheet.lines[1]!.id, { status: 'CARGADO' });
    const closed = await service.complete(operator1, sheet.id, { note: 'Carga completa' });

    expect(closed.status).toBe('DESPACHADO');
    expect(closed.completedAt).toBeTruthy();
    expect(closed.completedByName).toBe('ALEXIS RIVAS');
    expect(closed.loadedSacks).toBe(70);
    expect(closed.loadedKg).toBe(2800);
    expect(closed.differenceKg).toBe(0);
    expect(prisma.state.notifications.some((row) => row.type === 'DESPACHO_CERRADO' && row.recipientId === 'u-plan')).toBe(true);

    // Cerrar dos veces no rompe.
    await expect(service.complete(operator1, sheet.id, {})).resolves.toMatchObject({ status: 'DESPACHADO' });
  });

  it('anular exige motivo y solo lo hace el creador o gerencia', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    await expect(service.cancel(operator1, sheet.id, { reason: 'no aplica' })).rejects.toThrow(/publicó el despacho/i);

    const canceled = await service.cancel(planner, sheet.id, { reason: 'El cliente canceló' });
    expect(canceled.status).toBe('CANCELADO');
    expect(canceled.canOperate).toBe(false);
    await expect(service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' })).rejects.toThrow(
      /ya está cerrado/i,
    );
  });
});

describe('DispatchService — bitácora y notificaciones', () => {
  it('la bitácora y sus mensajes son exclusivos del ADMIN', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    // Ningún otro rol ve los eventos ni puede escribir en la bitácora.
    expect((await service.detail(operator1, sheet.id)).events).toHaveLength(0);
    expect((await service.detail(planner, sheet.id)).events).toHaveLength(0);
    await expect(service.message(planner, sheet.id, { body: 'Prioriza el pedido' })).rejects.toThrow(/administradores/i);
    await expect(service.message(operator1, sheet.id, { body: 'Entendido' })).rejects.toThrow(/administradores/i);

    // El admin sí la ve y su mensaje viaja a la contraparte (el creador).
    expect((await service.detail(admin, sheet.id)).events.length).toBeGreaterThan(0);
    await service.message(admin, sheet.id, { body: 'Prioriza el pedido 408251710' });
    const message = prisma.state.notifications.find((row) => row.type === 'MENSAJE');
    expect(message).toBeTruthy();
    expect(message!.recipientId).toBe('u-plan');
  });

  it('lista y marca notificaciones (idempotente)', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    const inbox = await service.listNotifications(operator1, 10);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.unread).toBe(1);

    const first = await service.markNotificationsRead(operator1, { all: true });
    expect(first.updated).toBe(1);
    const second = await service.markNotificationsRead(operator1, { all: true });
    expect(second.updated).toBe(0);
    expect((await service.listNotifications(operator1, 10)).unread).toBe(0);

    // El otro operador conserva la suya sin leer.
    expect((await service.listNotifications(operator2, 10)).unread).toBe(1);
    expect(sheet.id).toBeTruthy();
  });

  it('la bandeja del planificador solo trae lo que publicó y los contadores del día', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma);
    await service.create(publisher, { scenarioId: 'sc-1', title: 'Uno' });
    await service.create(publisher, { scenarioId: 'sc-1', title: 'Dos' });

    const plannerInbox = await service.list(planner, { scope: 'all' });
    expect(plannerInbox.items).toHaveLength(2);
    expect(plannerInbox.counters.pending).toBe(2);
    expect(plannerInbox.counters.kgPending).toBe(5600);

    const operatorInbox = await service.list(operator1, { scope: 'all' });
    expect(operatorInbox.items).toHaveLength(2);

    const outsiderInbox = await service.list(outsider, { scope: 'all' });
    expect(outsiderInbox.items).toHaveLength(0);
  });

  it('notifica al enviar y al cerrar; la toma de la hoja no genera acuse', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);
    const typesFor = (recipientId: string) =>
      prisma.state.notifications.filter((row) => row.recipientId === recipientId).map((row) => row.type);

    // Publicar avisa a los DOS operadores de almacén (bandeja compartida).
    expect(typesFor('u-alm1')).toEqual(['DESPACHO_ENVIADO']);
    expect(typesFor('u-alm2')).toEqual(['DESPACHO_ENVIADO']);
    // El autor nunca se auto-notifica.
    expect(typesFor('u-plan')).toEqual([]);

    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { status: 'CARGADO' });
    // Tomar la hoja no avisa: no hay acuse.
    expect(typesFor('u-plan')).toEqual([]);

    await service.updateLine(operator1, sheet.id, sheet.lines[1]!.id, { status: 'CARGADO' });
    await service.complete(operator1, sheet.id, {});
    // El último renglón cierra la carga del cliente y, al completar, el
    // despacho: el planificador recibe ambos hitos.
    expect(typesFor('u-plan')).toEqual(['DESPACHO_CARGA_CERRADA', 'DESPACHO_CERRADO']);

    // El aviso lleva a la hoja y firma a quien actuó.
    const last = prisma.state.notifications.filter((row) => row.recipientId === 'u-plan').at(-1)!;
    expect(last.linkPath).toBe(`/despacho/${sheet.id}`);
    expect(last.actorName).toBe('ALEXIS RIVAS');
    expect(last.entityType).toBe('DispatchSheet');

    // Anular avisa al lado almacén.
    const second = await service.create(publisher, { scenarioId: 'sc-1', title: 'Para anular' });
    await service.cancel(planner, second.id, { reason: 'El cliente reprogramó' });
    expect(typesFor('u-alm1')).toContain('DESPACHO_CANCELADO');
    expect(typesFor('u-alm2')).toContain('DESPACHO_CANCELADO');
  });

  it('la bandeja de pendientes ve todo lo abierto y el historial los cerrados', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma);
    seedScenario(prisma, 'u-alm1', 'sc-2');
    const first = await service.create(publisher, { scenarioId: 'sc-1', title: 'Pendiente' });
    const second = await service.create(publisher, { scenarioId: 'sc-1', title: 'Cerrado' });
    await service.updateLine(operator1, second.id, second.lines[0]!.id, { status: 'CARGADO' });
    await service.updateLine(operator1, second.id, second.lines[1]!.id, { status: 'CARGADO' });
    await service.complete(operator1, second.id, {});

    // Otro usuario publica y cierra su propio despacho.
    const third = await service.create(almacenPublisher, { scenarioId: 'sc-2', title: 'Cerrado por almacén' });
    await service.updateLine(operator1, third.id, third.lines[0]!.id, { status: 'CARGADO' });
    await service.updateLine(operator1, third.id, third.lines[1]!.id, { status: 'CARGADO' });
    await service.complete(operator1, third.id, {});

    expect((await service.list(operator2, { scope: 'pending' })).items.map((row) => row.id)).toEqual([first.id]);
    expect((await service.list(planner, { scope: 'pending' })).items.map((row) => row.id)).toEqual([first.id]);
    // El historial también es visible para todo almacén (ve todo lo publicado).
    const allHistory = [second.id, third.id];
    for (const viewer of [operator1, operator2]) {
      const history = (await service.list(viewer, { scope: 'history' })).items.map((row) => row.id);
      expect(history).toHaveLength(2);
      expect(history).toEqual(expect.arrayContaining(allHistory));
    }
    // El permiso individual `despacho:view_all` da la misma visibilidad total.
    const granted = { ...outsider, canViewAll: true };
    const grantedHistory = (await service.list(granted, { scope: 'history' })).items.map((row) => row.id);
    expect(grantedHistory).toHaveLength(2);
    expect(grantedHistory).toEqual(expect.arrayContaining(allHistory));
    // Sin el permiso, no ve el historial ajeno.
    expect((await service.list(outsider, { scope: 'history' })).items).toHaveLength(0);
    // «Publicados por mí» solo trae lo propio.
    expect((await service.list(planner, { scope: 'created' })).items).toHaveLength(2);
  });
});

describe('DispatchService — tiempos por cliente', () => {
  it('inicia la carga sin marcar productos, cierra por producto y factura después', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);
    const customerKey = '294201237';

    const started = await service.startLoad(operator1, sheet.id, { customerKey });
    expect(started.lines.every((line) => line.status === 'PENDIENTE')).toBe(true);
    const progress = started.customerProgress.find((row) => row.customerKey === customerKey)!;
    expect(progress.loadStartedAt).not.toBeNull();
    expect(progress.loadClosedAt).toBeNull();
    expect(started.status).toBe('EN_PROCESO');
    expect(started.claimedByName).toBe('ALEXIS RIVAS');

    // Cerrar el primer producto no cierra el cliente todavía.
    const afterFirst = await service.updateLine(operator1, sheet.id, started.lines[0]!.id, { status: 'CARGADO' });
    expect(afterFirst.customerProgress.find((row) => row.customerKey === customerKey)!.loadClosedAt).toBeNull();

    // El último producto cierra la carga del cliente.
    const afterLast = await service.updateLine(operator1, sheet.id, started.lines[1]!.id, { status: 'CARGADO' });
    const closed = afterLast.customerProgress.find((row) => row.customerKey === customerKey)!;
    expect(closed.loadClosedAt).not.toBeNull();
    expect(closed.pendingProducts).toBe(0);

    const invoiced = await service.deliverInvoice(operator1, sheet.id, {
      customerKey,
      invoiceRef: 'FAC-001',
    });
    const invoice = invoiced.customerProgress.find((row) => row.customerKey === customerKey)!;
    expect(invoice.invoiceDeliveredAt).not.toBeNull();
    expect(invoice.invoiceRef).toBe('FAC-001');
    // La bitácora solo la ve el ADMIN, pero el evento quedó registrado.
    const adminView = await service.detail(admin, sheet.id);
    expect(adminView.events.some((event) => event.type === 'FACTURA_ENTREGADA')).toBe(true);

    // Con factura entregada, la carga queda bloqueada.
    await expect(
      service.updateLine(operator1, sheet.id, invoiced.lines[0]!.id, { status: 'PENDIENTE' }),
    ).rejects.toThrow(/factura/i);
  });

  it('factura todo solo cuando la carga completa está cerrada y permite reabrir con ADMIN', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    await expect(service.deliverAllInvoices(operator1, sheet.id, {})).rejects.toThrow(/producto/i);

    await service.startLoad(operator1, sheet.id, { customerKey: '294201237' });
    for (const line of sheet.lines) {
      await service.updateLine(operator1, sheet.id, line.id, { status: 'CARGADO' });
    }

    const all = await service.deliverAllInvoices(operator1, sheet.id, { note: 'Factura global' });
    expect(all.customerProgress.every((row) => row.invoiceDeliveredAt !== null)).toBe(true);
    expect(all.pendingInvoiceCustomers).toBe(0);

    await expect(
      service.reopenInvoice(operator1, sheet.id, { customerKey: '294201237', reason: 'Error de número' }),
    ).rejects.toThrow(/administrador/i);

    const reopened = await service.reopenInvoice(admin, sheet.id, {
      customerKey: '294201237',
      reason: 'Error de número',
    });
    expect(reopened.customerProgress.find((row) => row.customerKey === '294201237')!.invoiceDeliveredAt).toBeNull();
    expect(reopened.events.some((event) => event.type === 'FACTURA_REABIERTA')).toBe(true);
  });
});
