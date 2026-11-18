import { describe, expect, it } from 'vitest';
import { ProfitDeliveryDatesService } from './profit-delivery-dates.service';

// Fake mínimo de Prisma para el cambio de entrega en Profit.
function createFakePrisma(options: { overrides?: number; dispatchStarted?: boolean } = {}) {
  const state = {
    orders: [
      {
        id: 'o1',
        externalNumber: '6819',
        customerCode: '294201237',
        requestedDate: new Date('2026-10-20T00:00:00.000Z'),
        status: 'ABIERTO',
        isActive: true,
        lines: [{ productCode: 'ABABOV85' }],
      },
      {
        id: 'o2',
        externalNumber: '6820',
        customerCode: '294201237',
        requestedDate: new Date('2026-10-20T00:00:00.000Z'),
        status: 'NOTA_ENTREGA',
        isActive: false,
        lines: [{ productCode: 'ABAPOR77' }],
      },
    ],
    overrides: options.overrides ?? 1,
    changes: [] as any[],
    updates: [] as any[],
    deletedOverrides: 0,
  };
  const prisma = {
    state,
    salesOrder: {
      findMany: async (args: any) =>
        state.orders.filter((order) => args.where.externalNumber.in.includes(order.externalNumber)),
      update: async (args: any) => {
        state.updates.push(args);
        return args.data;
      },
    },
    deliveryDateOverride: {
      count: async () => state.overrides,
      deleteMany: async () => {
        state.deletedOverrides += 1;
        state.overrides = 0;
        return { count: 0 };
      },
    },
    deliveryDateChange: {
      create: async (args: any) => {
        state.changes.push(args.data);
        return args.data;
      },
    },
    // Despacho mínimo: sin hojas, el cambio solo escribe en Profit/local.
    dispatchSheetLine: {
      findMany: async () =>
        options.dispatchStarted
          ? [
              {
                orderNumber: '6819',
                status: 'PENDIENTE',
                checkedAt: null,
                customerCode: '294201237',
                customerName: 'CLIENTE',
                sheet: {
                  id: 'sheet-1',
                  number: 'DSP-2026-0007',
                  status: 'EN_PROCESO',
                  customerProgress: [
                    {
                      customerKey: '294201237',
                      loadStartedAt: new Date('2026-10-20T13:00:00.000Z'),
                      invoiceDeliveredAt: null,
                    },
                  ],
                },
              },
            ]
          : [],
      updateMany: async () => ({ count: 0 }),
    },
    dispatchSheet: {
      findMany: async () => [] as any[],
    },
    dispatchSheetEvent: {
      create: async (args: any) => args.data,
    },
    customerArrival: {
      updateMany: async () => ({ count: 0 }),
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  return prisma;
}

function createFakeWriter(overrides: { enabled?: boolean; dryRun?: boolean; affected?: number } = {}) {
  const calls: { orderNumber: string; date: string; userCode: string }[] = [];
  return {
    calls,
    enabled: overrides.enabled ?? true,
    dryRun: overrides.dryRun ?? false,
    updateOrderDeliveryDate: async (orderNumber: string, date: string, userCode: string) => {
      calls.push({ orderNumber, date, userCode });
      return {
        affected: overrides.affected ?? 1,
        previousDate: '2026-10-20',
        nextDate: date,
      };
    },
  };
}

const audit = { record: async () => undefined } as never;
const config = { get: (key: string) => (key === 'profit.write.maxOrders' ? 50 : undefined) } as never;
const insights = { invalidate: () => undefined } as never;
const items = [{ orderNumber: '6819', productCode: 'ABABOV85' }];

function build(prisma: any, writer: any) {
  return new ProfitDeliveryDatesService(prisma as never, audit, config, writer as never, insights);
}

describe('ProfitDeliveryDatesService', () => {
  it('escribe en Profit, actualiza local, retira la estimada y registra causa/motivo', async () => {
    const prisma = createFakePrisma();
    const writer = createFakeWriter();
    const service = build(prisma, writer);

    const result = await service.setDates(
      {
        items,
        date: '2026-10-27',
        cause: 'CUSTOMER',
        reason: 'FINANCIAL',
        note: 'el cliente no tenía crédito',
      },
      { id: 'u1', code: 'KZ' },
    );

    expect(writer.calls).toEqual([{ orderNumber: '6819', date: '2026-10-27', userCode: 'KZ' }]);
    expect(result).toMatchObject({ applied: 1, failed: 0, unchanged: 0, dryRun: false });
    expect(prisma.state.updates).toHaveLength(1);
    expect(prisma.state.updates[0].data.requestedDate.toISOString()).toContain('2026-10-27');
    expect(prisma.state.deletedOverrides).toBe(1);
    expect(prisma.state.changes[0]).toMatchObject({
      orderNumber: '6819',
      productCode: '*',
      customerCode: '294201237',
      action: 'PROFIT_UPDATE',
      cause: 'CUSTOMER',
      reason: 'FINANCIAL',
      changedById: 'u1',
      changedByCode: 'KZ',
    });
  });

  it('cuando el cambio lo origina la empresa no guarda motivo', async () => {
    const prisma = createFakePrisma();
    const writer = createFakeWriter();
    const service = build(prisma, writer);

    await service.setDates(
      { items, date: '2026-10-27', cause: 'COMPANY' },
      { id: 'u1', code: 'KZ' },
    );

    expect(prisma.state.changes[0]).toMatchObject({ cause: 'COMPANY', reason: null });
  });

  it('omite pedidos ya cerrados sin escribir en Profit', async () => {
    const prisma = createFakePrisma();
    const writer = createFakeWriter();
    const service = build(prisma, writer);

    const result = await service.setDates(
      {
        items: [{ orderNumber: '6820', productCode: 'ABAPOR77' }],
        date: '2026-10-27',
        cause: 'COMPANY',
      },
      { id: 'u1', code: 'KZ' },
    );

    expect(writer.calls).toHaveLength(0);
    expect(result).toMatchObject({ applied: 0, skipped: 1 });
  });

  it('no escribe si la fecha ya coincide', async () => {
    const prisma = createFakePrisma({ overrides: 0 });
    const writer = createFakeWriter();
    const service = build(prisma, writer);

    const result = await service.setDates(
      { items, date: '2026-10-20', cause: 'COMPANY' },
      { id: 'u1', code: 'KZ' },
    );

    expect(writer.calls).toHaveLength(0);
    expect(result).toMatchObject({ applied: 0, unchanged: 1 });
  });

  it('omite el pedido si la carga ya inició en despacho (fecha bloqueada)', async () => {
    const prisma = createFakePrisma({ dispatchStarted: true });
    const writer = createFakeWriter();
    const service = build(prisma, writer);

    const result = await service.setDates(
      { items, date: '2026-10-27', cause: 'COMPANY' },
      { id: 'u1', code: 'KZ' },
    );

    expect(writer.calls).toHaveLength(0);
    expect(result).toMatchObject({ applied: 0, skipped: 1 });
    expect(result.orders[0]!.message).toMatch(/DSP-2026-0007/);
  });

  it('en dry-run no toca lo local', async () => {
    const prisma = createFakePrisma();
    const writer = createFakeWriter({ dryRun: true });
    const service = build(prisma, writer);

    const result = await service.setDates(
      { items, date: '2026-10-27', cause: 'COMPANY' },
      { id: 'u1', code: 'KZ' },
    );

    expect(writer.calls).toHaveLength(0);
    expect(prisma.state.updates).toHaveLength(0);
    expect(result).toMatchObject({ applied: 1, dryRun: true });
  });

  it('responde 503 si la escritura no está habilitada', async () => {
    const prisma = createFakePrisma();
    const writer = createFakeWriter({ enabled: false });
    const service = build(prisma, writer);

    await expect(
      service.setDates({ items, date: '2026-10-27', cause: 'COMPANY' }, { id: 'u1', code: 'KZ' }),
    ).rejects.toThrow(/deshabilitado/);
  });

  it('exige el código de Profit de la sesión para poder atribuir el cambio', async () => {
    const prisma = createFakePrisma();
    const writer = createFakeWriter();
    const service = build(prisma, writer);

    await expect(
      service.setDates({ items, date: '2026-10-27', cause: 'COMPANY' }, { id: 'u1' }),
    ).rejects.toThrow(/código de Profit/);
    expect(writer.calls).toHaveLength(0);
  });

  it('reporta el pedido cuando Profit no modifica filas', async () => {
    const prisma = createFakePrisma();
    const writer = createFakeWriter({ affected: 0 });
    const service = build(prisma, writer);

    const result = await service.setDates(
      { items, date: '2026-10-27', cause: 'COMPANY' },
      { id: 'u1', code: 'KZ' },
    );

    expect(result).toMatchObject({ applied: 0, failed: 1 });
    expect(prisma.state.updates).toHaveLength(0);
  });
});
