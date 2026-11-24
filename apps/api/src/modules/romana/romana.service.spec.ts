import { describe, expect, it } from 'vitest';
import type { RomanaArrivalDetail } from '@nexo/contracts';
import { RomanaService } from './romana.service';

// ============================================================
// Fake mínimo de Prisma para Romana. Cubre solo las consultas del servicio.
// ============================================================

type Row = Record<string, any>;

function matches(where: Row | undefined, row: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object') {
      if ('not' in value) return row[key] !== (value as { not: unknown }).not;
      if ('in' in value) return (value as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === value;
  });
}

function createHarness() {
  const state: {
    arrivals: Row[];
    documents: Row[];
    events: Row[];
    incidents: Row[];
    users: Row[];
  } = {
    arrivals: [],
    documents: [],
    events: [],
    incidents: [],
    users: [{ id: 'u1', profitCode: 'ROM1', displayName: 'OPERADOR ROMANA' }],
  };

  const removedKeys: string[] = [];
  const audit: Row[] = [];

  const storage = {
    async store() {
      return {
        storageKey: '2026/11/a1/PED-1__CEDULA.webp',
        thumbKey: '2026/11/a1/PED-1__CEDULA.thumb.webp',
        mimeType: 'image/webp',
        bytes: 120_000,
        width: 1440,
        height: 1080,
        sha256: 'abc',
      };
    },
    async read() {
      return { stream: null, bytes: 0 };
    },
    async removeKeys(keys: Array<string | null | undefined>) {
      for (const key of keys) if (key) removedKeys.push(key);
      return [];
    },
    async removeFolder() {},
    async listArrivalFolders() {
      return [];
    },
  };

  const prisma: any = {
    customerArrival: {
      async findUnique({ where }: Row) {
        const row = state.arrivals.find((item) => item.id === where.id);
        if (!row) return null;
        return {
          ...row,
          incidents: state.incidents.filter((item) => item.arrivalId === row.id).map((item) => ({ ...item })),
          events: state.events.filter((item) => item.arrivalId === row.id).map((item) => ({ ...item })),
          romanaDocuments: state.documents
            .filter((item) => item.arrivalId === row.id)
            .map((item) => ({ ...item })),
        };
      },
      async findMany() {
        return state.arrivals.map((row) => ({
          ...row,
          incidents: state.incidents.filter((item) => item.arrivalId === row.id),
          romanaDocuments: state.documents.filter((item) => item.arrivalId === row.id),
        }));
      },
      async update({ where, data }: Row) {
        const row = state.arrivals.find((item) => item.id === where.id);
        if (!row) throw new Error('arrival no encontrada');
        Object.assign(row, data);
        return { ...row };
      },
    },
    arrivalOrderDocument: {
      async findMany({ where }: Row) {
        return state.documents
          .filter((row) => matches(where, row))
          .map((row) => ({
            ...row,
            arrival: state.arrivals.find((arrival) => arrival.id === row.arrivalId),
          }));
      },
      async findFirst({ where }: Row) {
        return state.documents.find((row) => matches(where, row)) ?? null;
      },
      async create({ data }: Row) {
        const row = { id: `doc-${state.documents.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.documents.push(row);
        return { ...row };
      },
      async update({ where, data }: Row) {
        const row = state.documents.find((item) => item.id === where.id);
        if (!row) throw new Error('documento no encontrado');
        Object.assign(row, data);
        return { ...row };
      },
      async delete({ where }: Row) {
        const index = state.documents.findIndex((item) => item.id === where.id);
        if (index >= 0) state.documents.splice(index, 1);
        return {};
      },
      async updateMany({ where, data }: Row) {
        const ids: string[] = where.id.in;
        for (const row of state.documents) if (ids.includes(row.id)) Object.assign(row, data);
        return { count: ids.length };
      },
      async count({ where }: Row) {
        return state.documents.filter((row) => matches(where, row)).length;
      },
    },
    arrivalEvent: {
      async create({ data }: Row) {
        const row = { id: `ev-${state.events.length + 1}`, createdAt: new Date(), ...data };
        state.events.push(row);
        return row;
      },
    },
    arrivalIncident: {
      async create({ data }: Row) {
        const row = { id: `inc-${state.incidents.length + 1}`, createdAt: new Date(), ...data };
        state.incidents.push(row);
        return row;
      },
      async update({ where, data }: Row) {
        const row = state.incidents.find((item) => item.id === where.id);
        Object.assign(row!, data);
        return row;
      },
      async count({ where }: Row) {
        return state.incidents.filter((row) => matches(where, row)).length;
      },
    },
    user: {
      async findUnique({ where }: Row) {
        return state.users.find((user) => user.id === where.id) ?? null;
      },
    },
    dispatchSheet: {
      async findUnique() {
        return null;
      },
    },
    notification: {
      async create({ data }: Row) {
        return data;
      },
    },
    async $transaction(input: unknown) {
      if (Array.isArray(input)) return Promise.all(input);
      throw new Error('transacción interactiva no soportada en el fake');
    },
  };

  const auditService: any = {
    async record(entry: Row) {
      audit.push(entry);
    },
  };

  const service = new RomanaService(prisma, auditService, storage as any);

  return { service, state, storage, removedKeys, audit };
}

function arrival(overrides: Row = {}): Row {
  return {
    id: 'a1',
    number: 'LLG-2026-0001',
    sheetId: 's1',
    sheetNumber: 'DSP-2026-0001',
    sheetTitle: 'Plan de hoy',
    customerCode: 'C1',
    customerName: 'CLIENTE UNO',
    expectedDate: '2026-11-19',
    orderNumbers: 'PED-1,PED-2',
    lineCount: 2,
    plannedSacks: 10,
    plannedKg: 500,
    status: 'ESPERADO',
    arrivedAt: null,
    arrivedById: null,
    arrivedByCode: null,
    arrivedByName: null,
    closedAt: null,
    note: null,
    createdById: 'u0',
    createdByCode: 'PL',
    createdByName: 'PLANIFICADOR',
    updatedById: null,
    updatedByName: null,
    romanaRequired: true,
    romanaArrivedAt: null,
    romanaArrivedById: null,
    romanaArrivedByName: null,
    romanaValidatedAt: null,
    romanaValidatedById: null,
    romanaValidatedByName: null,
    romanaPhotosPurgedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function documents(): Row[] {
  return ['PED-1', 'PED-2'].flatMap((orderNumber) =>
    ['CEDULA', 'CARNET'].map((kind, index) => ({
      id: `${orderNumber}-${kind}`,
      arrivalId: 'a1',
      orderNumber,
      kind,
      storageKey: `2026/11/a1/${orderNumber}__${kind}.webp`,
      thumbKey: `2026/11/a1/${orderNumber}__${kind}.thumb.webp`,
      mimeType: 'image/webp',
      bytes: 100_000 + index,
      width: 1440,
      height: 1080,
      sha256: `hash-${orderNumber}-${kind}`,
      uploadedById: 'u1',
      uploadedByName: 'OPERADOR ROMANA',
      purgedAt: null,
      purgedById: null,
      purgedByName: null,
      purgeReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
}

describe('RomanaService', () => {
  it('bloquea el marcado si falta una sola foto', async () => {
    const { service, state } = createHarness();
    state.arrivals.push(arrival());
    state.documents.push(...documents().filter((document) => document.id !== 'PED-2-CARNET'));

    await expect(
      service.checkIn(
        { id: 'u1', permissions: ['pcp:read', 'pcp:upload'] },
        'a1',
        {},
      ),
    ).rejects.toThrow(/Faltan fotos/);
  });

  it('marca la llegada y sella también la hora física si PCP no la marcó', async () => {
    const { service, state } = createHarness();
    state.arrivals.push(arrival());
    state.documents.push(...documents());

    const detail = await service.checkIn(
      { id: 'u1', permissions: ['pcp:read', 'pcp:upload'] },
      'a1',
      { note: 'chofer con documentos' },
    );

    const row = state.arrivals[0]!;
    expect(row.romanaArrivedAt).toBeInstanceOf(Date);
    expect(row.arrivedAt).toBeInstanceOf(Date);
    expect(row.status).toBe('EN_PLANTA');
    expect(row.romanaArrivedByName).toBe('OPERADOR ROMANA');
    expect(detail.romana.status).toBe('EN_ROMANA');
    expect(state.events.some((event) => event.type === 'ROMANA_LLEGADA')).toBe(true);
  });

  it('validar borra archivos, vacía las claves y deja la huella', async () => {
    const { service, state, removedKeys, audit } = createHarness();
    state.arrivals.push(arrival({ romanaArrivedAt: new Date(), arrivedAt: new Date(), status: 'EN_PLANTA' }));
    state.documents.push(...documents());

    const detail = await service.validate(
      { id: 'u1', permissions: ['pcp:read', 'pcp:validate'] },
      'a1',
      {},
    );

    expect(removedKeys).toHaveLength(8);
    expect(state.documents.every((document) => document.storageKey === null)).toBe(true);
    expect(state.documents.every((document) => document.purgeReason === 'VALIDACION')).toBe(true);
    expect(state.arrivals[0]!.romanaValidatedAt).toBeInstanceOf(Date);
    expect(state.arrivals[0]!.romanaPhotosPurgedAt).toBeInstanceOf(Date);
    expect(detail.romana.status).toBe('VALIDADO');
    expect(detail.romana.uploadedDocs).toBe(4);
    expect(audit.some((entry) => entry.action === 'ROMANA_VALIDATE')).toBe(true);
    expect(state.events.some((event) => event.type === 'ROMANA_FOTOS_ELIMINADAS')).toBe(true);
  });

  it('rechaza fotos de un pedido que no pertenece a la llegada', async () => {
    const { service, state } = createHarness();
    state.arrivals.push(arrival());

    await expect(
      service.saveDocument(
        { id: 'u1', permissions: ['pcp:read', 'pcp:upload'] },
        'a1',
        'PED-999',
        'CEDULA',
        Buffer.from('fake'),
      ),
    ).rejects.toThrow(/no pertenece/);
  });

  it('una foto nueva limpia el estado de expiración', async () => {
    const { service, state } = createHarness();
    state.arrivals.push(arrival({ romanaPhotosPurgedAt: new Date() }));

    const result = await service.saveDocument(
      { id: 'u1', permissions: ['pcp:read', 'pcp:upload'] },
      'a1',
      'PED-1',
      'CEDULA',
      Buffer.from('fake'),
    );

    expect(state.arrivals[0]!.romanaPhotosPurgedAt).toBeNull();
    expect(result.document.url).toBeTruthy();
  });

  it('el barrido no expira fotos recientes aunque la llegada sea vieja', async () => {
    const { service, state } = createHarness();
    state.arrivals.push(arrival({ createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }));
    state.documents.push(...documents());

    const result = await service.cleanup({ retentionHours: 168 });
    expect(result.purged).toBe(0);
  });

  it('el barrido expira cuando todas las fotos superan la retención', async () => {
    const { service, state } = createHarness();
    state.arrivals.push(arrival({ createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }));
    state.documents.push(
      ...documents().map((document) => ({
        ...document,
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      })),
    );

    const result = await service.cleanup({ retentionHours: 168 });
    expect(result.purged).toBe(4);
    expect(result.expired).toBe(1);
  });

  it('el barrido purga las fotos de una llegada cancelada', async () => {
    const { service, state, removedKeys } = createHarness();
    state.arrivals.push(arrival({ status: 'CANCELADO' }));
    state.documents.push(...documents());

    const result = await service.cleanup({ retentionHours: 168 });

    expect(result.purged).toBe(4);
    expect(removedKeys).toHaveLength(8);
    expect(state.documents.every((document) => document.storageKey === null)).toBe(true);
  });

  it('el barrido respeta las fotos recientes de una llegada sin validar', async () => {
    const { service, state } = createHarness();
    state.arrivals.push(arrival());
    state.documents.push(...documents());

    const result = await service.cleanup({ retentionHours: 168 });

    expect(result.purged).toBe(0);
    expect(state.documents.every((document) => document.storageKey)).toBe(true);
  });

  it('expone el detalle con permisos resueltos', async () => {
    const { service, state } = createHarness();
    state.arrivals.push(arrival());
    state.documents.push(...documents());

    const detail: RomanaArrivalDetail = await service.detail(
      { id: 'u1', permissions: ['pcp:read', 'pcp:upload', 'pcp:validate'] },
      'a1',
    );

    expect(detail.romana.orders).toHaveLength(2);
    expect(detail.romana.requiredDocs).toBe(4);
    expect(detail.romana.uploadedDocs).toBe(4);
    expect(detail.romana.canCheckIn).toBe(true);
    expect(detail.romana.canValidate).toBe(false);
  });
});
