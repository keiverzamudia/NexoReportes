import { describe, expect, it } from 'vitest';
import { ArrivalsService } from './arrivals.service';

// ============================================================
// Fake mínimo de Prisma para las llegadas de PCP.
// No pretende ser un ORM: solo cubre las consultas que usa el servicio.
// ============================================================

type Row = Record<string, any>;

function matches(where: Row | undefined, row: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (value as Row[]).every((clause) => matches(clause, row));
    if (key === 'OR') return (value as Row[]).some((clause) => matches(clause, row));
    if (value && typeof value === 'object') {
      if ('in' in value) return (value as { in: unknown[] }).in.includes(row[key]);
      if ('not' in value) return row[key] !== (value as { not: unknown }).not;
      if ('startsWith' in value) return String(row[key] ?? '').startsWith((value as { startsWith: string }).startsWith);
      if ('contains' in value) return String(row[key] ?? '').toLowerCase().includes(String((value as Row).contains).toLowerCase());
    }
    return row[key] === value;
  });
}

function createFakePrisma() {
  const state = {
    arrivals: [] as Row[],
    incidents: [] as Row[],
    events: [] as Row[],
    notifications: [] as Row[],
    sheets: [
      { id: 'sheet-1', number: 'DSP-2026-0001', createdById: 'u-plan', assignedToId: null, claimedById: null },
    ] as Row[],
    users: [
      { id: 'u-plan', profitCode: 'KZ', displayName: 'KEIBER ZAMUDIA', role: 'PLANIFICADOR', isActive: true },
      { id: 'u-alm', profitCode: 'ARIV', displayName: 'ALEXIS RIVAS', role: 'ALMACEN', isActive: true },
      { id: 'u-pcp', profitCode: 'PCP1', displayName: 'PCP UNO', role: 'PLANIFICADOR', isActive: true },
    ] as Row[],
    rolePermissions: [
      { roleCode: 'PLANIFICADOR', module: 'llegadas', action: 'read' },
      { roleCode: 'ALMACEN', module: 'llegadas', action: 'read' },
    ] as Row[],
  };

  let sequence = 0;

  const client: any = {
    customerArrival: {
      async findMany({ where }: Row = {}) {
        return state.arrivals
          .filter((row) => matches(where, row))
          .map((row) => ({
            ...row,
            incidents: state.incidents.filter((incident) => incident.arrivalId === row.id).map((incident) => ({ ...incident })),
          }));
      },
      async findFirst({ where }: Row) {
        const candidates = state.arrivals
          .filter((row) => matches(where, row))
          .sort((a, b) => String(b.number).localeCompare(String(a.number)));
        return candidates[0] ? { ...candidates[0] } : null;
      },
      async findUnique({ where }: Row) {
        const row = state.arrivals.find((item) => item.id === where.id);
        if (!row) return null;
        return {
          ...row,
          incidents: state.incidents
            .filter((incident) => incident.arrivalId === row.id)
            .map((incident) => ({ ...incident })),
          events: state.events
            .filter((event) => event.arrivalId === row.id)
            .map((event) => ({ ...event }))
            .sort((a, b) => a.createdAt - b.createdAt),
        };
      },
      async update({ where, data }: Row) {
        const row = state.arrivals.find((item) => item.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
    },
    arrivalIncident: {
      async create({ data }: Row) {
        const row = { id: `inc-${++sequence}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.incidents.push(row);
        return row;
      },
      async update({ where, data }: Row) {
        const row = state.incidents.find((item) => item.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      async count({ where }: Row) {
        return state.incidents.filter((row) => matches(where, row)).length;
      },
    },
    arrivalEvent: {
      async create({ data }: Row) {
        const row = { id: `ev-${++sequence}`, createdAt: new Date(), ...data };
        state.events.push(row);
        return row;
      },
    },
    notification: {
      async create({ data }: Row) {
        const row = { id: `nt-${++sequence}`, createdAt: new Date(), readAt: null, ...data };
        state.notifications.push(row);
        return row;
      },
    },
    dispatchSheet: {
      async findUnique({ where }: Row) {
        return state.sheets.find((row) => row.id === where.id) ?? null;
      },
    },
    user: {
      async findUnique({ where }: Row) {
        return state.users.find((row) => row.id === where.id) ?? null;
      },
      async findMany({ where }: Row) {
        return state.users.filter((row) => matches(where, row));
      },
    },
    rolePermission: {
      async findMany({ where }: Row) {
        return state.rolePermissions.filter((row) => matches(where, row));
      },
    },
    userPermission: {
      async findMany() {
        return [];
      },
    },
    async $transaction(input: unknown) {
      if (Array.isArray(input)) return Promise.all(input);
      return (input as (tx: unknown) => Promise<unknown>)(client);
    },
  };

  return { client, state };
}

const audit = { record: async () => undefined } as never;

const viewer = {
  id: 'u-pcp',
  code: 'PCP1',
  permissions: ['llegadas:read', 'llegadas:create', 'llegadas:update', 'llegadas:delete'],
};

const actor = { id: 'u-plan', code: 'KZ', name: 'KEIBER ZAMUDIA' };

function build() {
  const { client, state } = createFakePrisma();
  const service = new ArrivalsService(client as never, audit);
  return { service, state };
}

function seedArrival(state: ReturnType<typeof createFakePrisma>['state'], overrides: Row = {}) {
  const row: Row = {
    id: 'arr-1',
    number: 'LLG-2026-0001',
    sheetId: 'sheet-1',
    sheetNumber: 'DSP-2026-0001',
    sheetTitle: 'Despacho lunes',
    customerCode: 'C001',
    customerName: 'CLIENTE UNO',
    expectedDate: '2026-10-22',
    orderNumbers: '408251710',
    lineCount: 1,
    plannedSacks: 10,
    plannedKg: 500,
    status: 'ESPERADO',
    arrivedAt: null,
    arrivedById: null,
    arrivedByCode: null,
    arrivedByName: null,
    closedAt: null,
    note: null,
    createdById: 'u-plan',
    createdByCode: 'KZ',
    createdByName: 'KEIBER ZAMUDIA',
    updatedById: null,
    updatedByName: null,
    createdAt: new Date('2026-10-22T12:00:00Z'),
    updatedAt: new Date('2026-10-22T12:00:00Z'),
    ...overrides,
  };
  state.arrivals.push(row);
  return row;
}

describe('ArrivalsService — creación automática desde el despacho', () => {
  it('agrupa por cliente, suma sacos/kg y toma la fecha más próxima', async () => {
    const { service, state } = build();

    const rows = await service.rowsForSheet({
      sheetNumber: 'DSP-2026-0001',
      sheetTitle: 'Despacho lunes',
      actor,
      lines: [
        { orderNumber: '408251710', customerCode: 'C001', customerName: 'CLIENTE UNO', uom: 'SAC', effectiveDate: '2026-10-24', plannedQty: 10, plannedKg: 500 },
        { orderNumber: '408251710', customerCode: 'C001', customerName: 'CLIENTE UNO', uom: 'GRANEL', effectiveDate: '2026-10-22', plannedQty: 1, plannedKg: 800 },
        { orderNumber: '408251799', customerCode: 'C002', customerName: 'CLIENTE DOS', uom: 'SAC', effectiveDate: '2026-10-23', plannedQty: 4, plannedKg: 200 },
      ],
    });

    expect(rows).toHaveLength(2);
    const uno = rows.find((row) => row.customerCode === 'C001')!;
    expect(uno.plannedSacks).toBe(10);
    expect(uno.plannedKg).toBe(1300);
    expect(uno.lineCount).toBe(2);
    expect(uno.expectedDate).toBe('2026-10-22');
    expect(uno.orderNumbers).toBe('408251710');
    expect(uno.events?.create).toMatchObject({ type: 'CREADO' });
    expect(rows.every((row) => String(row.number).startsWith('LLG-'))).toBe(true);
    expect(state.arrivals).toHaveLength(0);
  });

  it('notifica solo a quienes tienen llegadas:read y no al autor', async () => {
    const { service, state } = build();

    await service.notifyExpected({ id: 'sheet-1', number: 'DSP-2026-0001', title: 'Despacho lunes' }, { customers: 2, kg: 1300 }, {
      id: 'u-pcp',
      code: 'PCP1',
      name: 'PCP UNO',
    });

    const recipients = state.notifications.map((row) => row.recipientId).sort();
    expect(recipients).toEqual(['u-alm', 'u-plan']);
  });
});

describe('ArrivalsService — marcar llegada', () => {
  it('sella la hora, deja evento y avisa al despacho', async () => {
    const { service, state } = build();
    seedArrival(state);

    const detail = await service.checkIn(viewer, 'arr-1', { note: 'Llegó con el camión 12' });

    expect(detail.status).toBe('EN_PLANTA');
    expect(detail.arrivedAt).not.toBeNull();
    expect(detail.arrivedByName).toBe('PCP UNO');
    expect(detail.events.at(-1)).toMatchObject({ type: 'LLEGADA' });
    expect(state.notifications.some((row) => row.recipientId === 'u-plan' && row.type === 'LLEGADA_MARCADA')).toBe(true);
  });

  it('no permite marcar dos veces la misma llegada', async () => {
    const { service, state } = build();
    seedArrival(state, { status: 'EN_PLANTA', arrivedAt: new Date('2026-10-22T13:05:00Z'), arrivedByName: 'PCP UNO' });

    await expect(service.checkIn(viewer, 'arr-1', {})).rejects.toThrow(/ya estaba marcada/);
  });

  it('respeta la hora enviada por el operador', async () => {
    const { service, state } = build();
    seedArrival(state);

    const detail = await service.checkIn(viewer, 'arr-1', { at: '2026-10-22T13:07:00.000Z' });
    expect(detail.arrivedAt).toBe('2026-10-22T13:07:00.000Z');
  });
});

describe('ArrivalsService — incidencias', () => {
  it('abre la incidencia y deja el cliente con incidencia', async () => {
    const { service, state } = build();
    seedArrival(state, { status: 'EN_PLANTA', arrivedAt: new Date(), arrivedByName: 'PCP UNO' });

    const detail = await service.addIncident(viewer, 'arr-1', {
      kind: 'FALTANTE',
      severity: 'ALTA',
      body: 'Faltan 2 sacos en el pedido',
    });

    expect(detail.status).toBe('CON_INCIDENCIA');
    expect(detail.openIncidentCount).toBe(1);
    expect(detail.incidents[0]).toMatchObject({ kind: 'FALTANTE', severity: 'ALTA', status: 'ABIERTA' });
    expect(detail.events.at(-1)).toMatchObject({ type: 'INCIDENCIA' });
  });

  it('al resolver la última incidencia el cliente vuelve a estar en planta', async () => {
    const { service, state } = build();
    seedArrival(state, { status: 'EN_PLANTA', arrivedAt: new Date(), arrivedByName: 'PCP UNO' });
    const withIncident = await service.addIncident(viewer, 'arr-1', { kind: 'DEMORA', severity: 'MEDIA', body: 'Camión tarde' });

    const detail = await service.resolveIncident(viewer, 'arr-1', withIncident.incidents[0]!.id, {
      resolution: 'Se cargó al final del turno',
    });

    expect(detail.status).toBe('EN_PLANTA');
    expect(detail.openIncidentCount).toBe(0);
    expect(detail.incidents[0]).toMatchObject({ status: 'RESUELTA', resolution: 'Se cargó al final del turno' });
  });
});

describe('ArrivalsService — correcciones del jefe', () => {
  it('exige motivo y deja el antes → después en la bitácora', async () => {
    const { service, state } = build();
    seedArrival(state, { status: 'EN_PLANTA', arrivedAt: new Date('2026-10-22T13:00:00Z'), arrivedByName: 'PCP UNO' });

    const detail = await service.update(viewer, 'arr-1', {
      arrivedAt: '2026-10-22T13:25:00.000Z',
      reason: 'Se marcó al revés en la tablet',
    });

    expect(detail.arrivedAt).toBe('2026-10-22T13:25:00.000Z');
    const edit = detail.events.find((event) => event.type === 'EDICION');
    expect(edit?.body).toContain('Se marcó al revés en la tablet');
    expect(edit?.body).toContain('hora');
  });

  it('sin cambios reales no ensucia la bitácora', async () => {
    const { service, state } = build();
    seedArrival(state, { status: 'EN_PLANTA', arrivedAt: new Date('2026-10-22T13:00:00Z') });

    const detail = await service.update(viewer, 'arr-1', {
      arrivedAt: '2026-10-22T13:00:00.000Z',
      reason: 'Revisión',
    });

    expect(detail.events.some((event) => event.type === 'EDICION')).toBe(false);
  });
});
