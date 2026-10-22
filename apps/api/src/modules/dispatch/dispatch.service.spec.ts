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
    events: [] as Row[],
    notifications: [] as Row[],
    users: [
      { id: 'u-plan', profitCode: 'KZ', displayName: 'KEIBER ZAMUDIA', role: 'PLANIFICADOR', isActive: true },
      { id: 'u-alm1', profitCode: 'ARIV', displayName: 'ALEXIS RIVAS', role: 'ALMACEN', isActive: true },
      { id: 'u-alm2', profitCode: 'AALV', displayName: 'ANA ALVAREZ', role: 'ALMACEN', isActive: true },
      { id: 'u-ger', profitCode: 'JGER', displayName: 'JEFA GERENCIA', role: 'GERENCIA', isActive: true },
      { id: 'u-con', profitCode: 'CONS', displayName: 'CONSULTA SOLO', role: 'CONSULTA', isActive: true },
    ],
    scenarios: [] as Row[],
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
    events: state.events.filter((event) => event.sheetId === sheet.id),
    assignedTo: sheet.assignedToId ? state.users.find((user) => user.id === sheet.assignedToId) ?? null : null,
  });

  const prisma = {
    state,
    dispatchScenario: {
      findFirst: async ({ where }: Row) => state.scenarios.find((row) => matches(where, row)) ?? null,
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
        state.sheets.push(sheet);

        for (const line of data.lines?.create ?? []) {
          state.lines.push({ id: id('line'), sheetId: sheet.id, loadedQty: null, loadedKg: null, note: null, checkedAt: null, checkedById: null, checkedByName: null, ...line });
        }
        for (const event of data.events?.create ? [data.events.create] : []) {
          state.events.push({ id: id('ev'), sheetId: sheet.id, createdAt: new Date(), ...event });
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
const operator1 = { id: 'u-alm1', role: 'ALMACEN', code: 'ARIV' };
const operator2 = { id: 'u-alm2', role: 'ALMACEN', code: 'AALV' };
const manager = { id: 'u-ger', role: 'GERENCIA', code: 'JGER' };
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

function seedScenario(prisma: ReturnType<typeof createFakePrisma>, ownerId = 'u-plan') {
  const lines = [snapshotLine(), snapshotLine({ productCode: 'ABABOV85', priority: 2, assignedQty: 10, assignedKg: 400 })];
  const scenario = {
    id: 'sc-1',
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
    }),
  };
  prisma.state.scenarios.push(scenario);
  return scenario;
}

async function publish(prisma: ReturnType<typeof createFakePrisma>, assignedToId: string | null = null) {
  const service = new DispatchService(prisma as never, audit, arrivals);
  seedScenario(prisma);
  return service.create(planner, {
    scenarioId: 'sc-1',
    title: 'Despacho lunes',
    instructions: 'Cargar por la puerta 2',
    assignedToId,
  });
}

describe('DispatchService — publicar', () => {
  it('crea la hoja con renglones, evento, notificación y correlativo', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma);

    const sheet = await service.create(planner, { scenarioId: 'sc-1', title: 'Despacho lunes' });

    expect(sheet.number).toBe(`DSP-${new Date().getFullYear()}-0001`);
    expect(sheet.status).toBe('ENVIADO');
    expect(sheet.lines).toHaveLength(2);
    expect(sheet.lines[0]!.plannedQty).toBe(60);
    expect(sheet.plannedKg).toBe(2800);
    expect(sheet.events[0]!.type).toBe('ENVIADO');
    // Bandeja compartida: se notifica a los dos operadores de almacén.
    expect(prisma.state.notifications).toHaveLength(2);
    expect(prisma.state.notifications.every((row) => row.type === 'DESPACHO_ENVIADO')).toBe(true);

    const second = await service.create(planner, { scenarioId: 'sc-1', title: 'Despacho martes' });
    expect(second.number).toBe(`DSP-${new Date().getFullYear()}-0002`);
  });

  it('rechaza publicar un escenario de otro usuario o sin plan', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma, 'u-alm1');

    await expect(service.create(planner, { scenarioId: 'sc-1', title: 'X' })).rejects.toThrow(/No encontramos/i);
    await expect(service.create(planner, { scenarioId: 'sc-otro', title: 'X' })).rejects.toThrow(/No encontramos/i);
  });

  it('exige que el operador asignado exista y sea de almacén', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma);

    await expect(service.create(planner, { scenarioId: 'sc-1', title: 'X', assignedToId: 'u-con' })).rejects.toThrow(
      /no está disponible/i,
    );

    const sheet = await service.create(planner, { scenarioId: 'sc-1', title: 'X', assignedToId: 'u-alm1' });
    expect(sheet.assignedToName).toBe('ALEXIS RIVAS');
    expect(prisma.state.notifications).toHaveLength(1);
    expect(prisma.state.notifications[0]!.recipientId).toBe('u-alm1');
  });

  it('bloquea la publicación cuando no hay operadores de almacén activos', async () => {
    const prisma = createFakePrisma();
    const service = new DispatchService(prisma as never, audit, arrivals);
    seedScenario(prisma);
    // Nadie con rol ALMACEN: el aviso no tendría a quién llegar.
    prisma.state.users = prisma.state.users.map((user) => (user.role === 'ALMACEN' ? { ...user, role: 'CONSULTA' } : user));

    await expect(service.create(planner, { scenarioId: 'sc-1', title: 'X' })).rejects.toThrow(/No hay operadores de almacén activos/i);
    expect(prisma.state.sheets).toHaveLength(0);

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

    const published = await service.create(planner, { scenarioId: 'sc-1', title: 'Ya se puede' });
    expect(published.status).toBe('ENVIADO');
  });
});

describe('DispatchService — acuses (túnel)', () => {
  it('sella el recibo, reclama la hoja y avisa al planificador', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    const received = await service.ack(operator1, sheet.id, { event: 'RECIBIDO' });

    expect(received.status).toBe('RECIBIDO');
    expect(received.receivedAt).toBeTruthy();
    expect(received.receivedByName).toBe('ALEXIS RIVAS');
    expect(received.claimedByName).toBe('ALEXIS RIVAS');
    expect(received.events.some((event) => event.type === 'RECIBIDO')).toBe(true);
    expect(prisma.state.notifications.some((row) => row.type === 'DESPACHO_RECIBIDO' && row.recipientId === 'u-plan')).toBe(true);
  });

  it('es idempotente: repetir el acuse no duplica sellos ni eventos', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    await service.ack(operator1, sheet.id, { event: 'RECIBIDO' });
    const eventsAfterFirst = prisma.state.events.length;
    const notificationsAfterFirst = prisma.state.notifications.length;

    const again = await service.ack(operator1, sheet.id, { event: 'RECIBIDO' });
    expect(again.status).toBe('RECIBIDO');
    expect(prisma.state.events).toHaveLength(eventsAfterFirst);
    expect(prisma.state.notifications).toHaveLength(notificationsAfterFirst);
  });

  it('la bandeja compartida la toma el primero: el segundo recibe 409', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    await service.ack(operator1, sheet.id, { event: 'RECIBIDO' });
    await expect(service.ack(operator2, sheet.id, { event: 'RECIBIDO' })).rejects.toThrow(/ya lo tomó/i);
  });

  it('no se puede pasar a EN_PROCESO sin recibir primero', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    await expect(service.ack(operator1, sheet.id, { event: 'EN_PROCESO' })).rejects.toThrow(/recibir/i);
  });

  it('un despacho asignado a otro operador no aparece en su bandeja ni se puede operar', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma, 'u-alm1');
    const service = new DispatchService(prisma as never, audit, arrivals);

    // Ni en la bandeja ni por detalle: 404 para el operador equivocado.
    const inbox = await service.list(operator2, { scope: 'all' });
    expect(inbox.items).toHaveLength(0);
    await expect(service.ack(operator2, sheet.id, { event: 'RECIBIDO' })).rejects.toThrow(/no encontrado/i);
    // El asignado sí lo ve.
    expect((await service.list(operator1, { scope: 'all' })).items).toHaveLength(1);
  });

  it('un no participante no ve el despacho (404)', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    await expect(service.detail(outsider, sheet.id)).rejects.toThrow(/no encontrado/i);
    // Gerencia sí lo ve (sigue el túnel).
    await expect(service.detail(manager, sheet.id)).resolves.toMatchObject({ id: sheet.id });
  });
});

describe('DispatchService — carga y cierre', () => {
  async function inProgress() {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);
    await service.ack(operator1, sheet.id, { event: 'RECIBIDO' });
    await service.ack(operator1, sheet.id, { event: 'EN_PROCESO' });
    return { prisma, service, sheet };
  }

  it('deriva los kg reales del ratio planificado y acumula el avance', async () => {
    const { service, sheet } = await inProgress();

    const updated = await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, {
      loadedQty: 40,
      status: 'PARCIAL',
    });

    const line = updated.lines.find((item) => item.id === sheet.lines[0]!.id)!;
    // 40 unidades de un renglón planificado a 2400 kg / 60 unid = 1600 kg.
    expect(line.loadedKg).toBe(1600);
    expect(line.loadedQty).toBe(40);
    expect(updated.linesDone).toBe(1);
    expect(updated.progress).toBeCloseTo(0.5, 5);
    expect(updated.loadedKg).toBe(1600);
    expect(updated.differenceKg).toBe(-800);
  });

  it('pasa a CON_NOVEDAD y avisa al planificador', async () => {
    const { prisma, service, sheet } = await inProgress();

    const updated = await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, {
      loadedQty: 0,
      status: 'FALTANTE',
      note: 'No alcanzó la existencia',
    });

    expect(updated.status).toBe('CON_NOVEDAD');
    expect(updated.events.some((event) => event.type === 'NOVEDAD')).toBe(true);
    expect(prisma.state.notifications.some((row) => row.type === 'DESPACHO_NOVEDAD')).toBe(true);

    // Al resolver la diferencia vuelve a EN_PROCESO.
    const resolved = await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { loadedQty: 60, status: 'CARGADO' });
    expect(resolved.status).toBe('EN_PROCESO');
  });

  it('no cierra con renglones pendientes y cierra con totales reales', async () => {
    const { prisma, service, sheet } = await inProgress();

    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { loadedQty: 60, status: 'CARGADO' });
    await expect(service.complete(operator1, sheet.id, {})).rejects.toThrow(/por confirmar/i);

    await service.updateLine(operator1, sheet.id, sheet.lines[1]!.id, { loadedQty: 8, status: 'PARCIAL' });
    const closed = await service.complete(operator1, sheet.id, { note: 'Faltaron 2 sacos' });

    expect(closed.status).toBe('DESPACHADO');
    expect(closed.completedAt).toBeTruthy();
    expect(closed.completedByName).toBe('ALEXIS RIVAS');
    expect(closed.loadedSacks).toBe(68);
    expect(closed.loadedKg).toBe(2720);
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
    await expect(service.ack(operator1, sheet.id, { event: 'RECIBIDO' })).rejects.toThrow(/ya está cerrado/i);
  });
});

describe('DispatchService — bitácora y notificaciones', () => {
  it('el mensaje viaja a la contraparte y no al autor', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);
    await service.ack(operator1, sheet.id, { event: 'RECIBIDO' });

    await service.message(planner, sheet.id, { body: 'Prioriza el pedido 408251710' });
    const toOperator = prisma.state.notifications.filter((row) => row.type === 'MENSAJE');
    expect(toOperator).toHaveLength(1);
    expect(toOperator[0]!.recipientId).toBe('u-alm1');

    await service.message(operator1, sheet.id, { body: 'Entendido, ya voy' });
    const toPlanner = prisma.state.notifications.filter((row) => row.type === 'MENSAJE' && row.recipientId === 'u-plan');
    expect(toPlanner).toHaveLength(1);
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
    await service.create(planner, { scenarioId: 'sc-1', title: 'Uno' });
    await service.create(planner, { scenarioId: 'sc-1', title: 'Dos' });

    const plannerInbox = await service.list(planner, { scope: 'all' });
    expect(plannerInbox.items).toHaveLength(2);
    expect(plannerInbox.counters.pending).toBe(2);
    expect(plannerInbox.counters.kgPending).toBe(5600);

    const operatorInbox = await service.list(operator1, { scope: 'all' });
    expect(operatorInbox.items).toHaveLength(2);

    const outsiderInbox = await service.list(outsider, { scope: 'all' });
    expect(outsiderInbox.items).toHaveLength(0);
  });

  // El «túnel» se prueba tipo por tipo: cada transición avisa a la
  // contraparte, con enlace al despacho y sin auto-notificarse.
  it('cada acuse del túnel emite su tipo de aviso al lado correcto', async () => {
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

    await service.ack(operator1, sheet.id, { event: 'RECIBIDO' });
    await service.ack(operator1, sheet.id, { event: 'EN_PROCESO' });
    expect(typesFor('u-plan')).toEqual(['DESPACHO_RECIBIDO', 'DESPACHO_EN_PROCESO']);

    await service.updateLine(operator1, sheet.id, sheet.lines[0]!.id, { loadedQty: 0, status: 'FALTANTE', note: 'No alcanzó' });
    await service.updateLine(operator1, sheet.id, sheet.lines[1]!.id, { loadedQty: 10, status: 'CARGADO' });
    await service.complete(operator1, sheet.id, {});
    expect(typesFor('u-plan')).toEqual(['DESPACHO_RECIBIDO', 'DESPACHO_EN_PROCESO', 'DESPACHO_NOVEDAD', 'DESPACHO_CERRADO']);

    // El aviso lleva a la hoja y firma a quien actuó.
    const last = prisma.state.notifications.filter((row) => row.recipientId === 'u-plan').at(-1)!;
    expect(last.linkPath).toBe(`/despacho/${sheet.id}`);
    expect(last.actorName).toBe('ALEXIS RIVAS');
    expect(last.entityType).toBe('DispatchSheet');

    // Anular avisa al lado almacén.
    const second = await service.create(planner, { scenarioId: 'sc-1', title: 'Para anular' });
    await service.cancel(planner, second.id, { reason: 'El cliente reprogramó' });
    expect(typesFor('u-alm1')).toContain('DESPACHO_CANCELADO');
    expect(typesFor('u-alm2')).toContain('DESPACHO_CANCELADO');
  });

  it('un acuse repetido no vuelve a notificar', async () => {
    const prisma = createFakePrisma();
    const sheet = await publish(prisma);
    const service = new DispatchService(prisma as never, audit, arrivals);

    await service.ack(operator1, sheet.id, { event: 'RECIBIDO' });
    const afterFirst = prisma.state.notifications.length;
    await service.ack(operator1, sheet.id, { event: 'RECIBIDO' });
    await service.ack(operator1, sheet.id, { event: 'EN_PROCESO' });
    await service.ack(operator1, sheet.id, { event: 'EN_PROCESO' });
    // Solo se suman los dos avisos reales (recibido + en proceso).
    expect(prisma.state.notifications).toHaveLength(afterFirst + 1);
  });
});
