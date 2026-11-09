import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderLifecycleService } from './order-lifecycle.service';

type Row = Record<string, any>;

function createFakePrisma() {
  const orders: Row[] = [];
  const events: Row[] = [];
  const runs: Row[] = [];

  const prisma = {
    orders,
    events,
    runs,
    salesOrder: {
      findMany: async ({ where }: Row = {}) => {
        return orders.filter((order) => {
          if (where?.status && order.status !== where.status) return false;
          const wanted = where?.externalNumber?.in as unknown[] | undefined;
          if (wanted && !wanted.includes(order.externalNumber)) return false;
          return true;
        });
      },
      updateMany: async ({ where, data }: Row) => {
        let count = 0;
        for (const order of orders) {
          if (where?.id?.in && !where.id.in.includes(order.id)) continue;
          if (where?.status && order.status !== where.status) continue;
          Object.assign(order, data);
          count += 1;
        }
        return { count };
      },
      update: async ({ where, data }: Row) => {
        const order = orders.find((item) => item.id === where.id);
        if (!order) throw new Error('no encontrado');
        Object.assign(order, data);
        return order;
      },
      findUnique: async ({ where }: Row) => orders.find((item) => item.id === where.id) ?? null,
    },
    orderLifecycleEvent: {
      create: async ({ data }: Row) => {
        const row = { id: `ev-${events.length + 1}`, ...data };
        events.push(row);
        return row;
      },
      findMany: async ({ take }: Row = {}) => events.slice(0, take ?? events.length),
      count: async ({ where }: Row = {}) =>
        events.filter((event) => (where?.toStatus ? event.toStatus === where.toStatus : true)).length,
    },
    orderReconciliationRun: {
      create: async ({ data }: Row) => {
        const row = { id: `run-${runs.length + 1}`, ...data };
        runs.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => {
        const row = runs.find((item) => item.id === where.id);
        if (!row) throw new Error('no encontrado');
        Object.assign(row, data);
        return row;
      },
      findFirst: async () => runs[runs.length - 1] ?? null,
      count: async () => 0,
    },
    $transaction: async (operations: unknown[]) => Promise.all(operations),
  };
  return prisma;
}

function seedOrder(overrides: Row = {}) {
  return {
    id: 'o-1',
    externalNumber: '1001',
    customerCode: 'C1',
    customerName: 'CLIENTE 1',
    customerType: 'L1',
    vendor: 'VENDEDOR',
    authorized: true,
    orderDate: new Date('2026-10-01'),
    requestedDate: new Date('2026-10-05'),
    status: 'ABIERTO',
    statusRaw: '0',
    isActive: true,
    closedAt: null,
    closedReason: null,
    billingStatus: 'PENDIENTE',
    notaEntregaRefs: null,
    reviewReason: null,
    lines: [{ pendingQty: 10 }],
    ...overrides,
  };
}

function adapterFor(
  headers: Record<string, { status: string; anulada?: boolean }>,
  pending: Record<string, number>,
) {
  return {
    dialect: 'fixtures' as const,
    selectQuery: vi.fn(async (sql: string, _limit: number, params: Record<string, unknown> = {}) => {
      const numbers = Object.keys(params)
        .filter((key) => /^o\d+$/.test(key))
        .map((key) => String(params[key]));
      if (sql.includes('order_lifecycle_header')) {
        return numbers
          .filter((number) => headers[number])
          .map((number) => ({ fact_num: Number(number), status: headers[number]!.status, anulada: headers[number]!.anulada ?? false }));
      }
      if (sql.includes('order_lifecycle_pending')) {
        return numbers
          .filter((number) => pending[number] !== undefined)
          .map((number) => ({ fact_num: Number(number), pendiente: pending[number], lineas: 1 }));
      }
      return [];
    }),
  } as never;
}

const audit = { record: async () => undefined } as never;
const scenarios = { pruneClosedOrders: vi.fn(async () => ({ removed: 0 })) };
const config = {
  get: (key: string) => {
    if (key === 'orderLifecycle.dryRun') return false;
    if (key === 'orderLifecycle.batchSize') return 200;
    return undefined;
  },
} as never;

function service(prisma: ReturnType<typeof createFakePrisma>, adapter: unknown) {
  return new OrderLifecycleService(prisma as never, audit, scenarios as never, config, adapter as never);
}

describe('OrderLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cierra como NOTA_ENTREGA cuando Profit marca status 2 sin pendiente', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(prisma, adapterFor({ '1001': { status: '2' } }, { '1001': 0 }));

    const run = await svc.reconcile({ dryRun: false });
    expect(run.closed).toBe(1);
    expect(prisma.orders[0]).toMatchObject({
      status: 'NOTA_ENTREGA',
      isActive: false,
      closedReason: 'NOTA_ENTREGA',
      billingStatus: 'FACTURADO_ASUMIDO',
    });
    expect(prisma.events).toHaveLength(1);
    expect(prisma.events[0]).toMatchObject({ toStatus: 'NOTA_ENTREGA', reason: 'NOTA_ENTREGA' });
    expect(scenarios.pruneClosedOrders).toHaveBeenCalledWith([
      { orderNumber: '1001', reason: 'NOTA_ENTREGA' },
    ]);
  });

  it('anula desde Profit y no lo cuenta como despacho', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(prisma, adapterFor({ '1001': { status: '0', anulada: true } }, { '1001': 10 }));

    const run = await svc.reconcile({ dryRun: false });
    expect(run.canceled).toBe(1);
    expect(prisma.orders[0]).toMatchObject({ status: 'CANCELADO', billingStatus: 'PENDIENTE' });
    expect(prisma.events[0]).toMatchObject({ toStatus: 'CANCELADO' });
  });

  it('no cierra si status 2 conserva pendiente: queda en revisión', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(prisma, adapterFor({ '1001': { status: '2' } }, { '1001': 5 }));

    const run = await svc.reconcile({ dryRun: false });
    expect(run.closed).toBe(0);
    expect(run.review).toBe(1);
    expect(prisma.orders[0]).toMatchObject({ status: 'ABIERTO', reviewReason: 'STATUS_2_CON_PENDIENTE' });
    expect(prisma.events).toHaveLength(0);
  });

  it('no cierra por ausencia: si desapareció de la vista y sigue abierto, revisa', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder({ isActive: false }));
    const svc = service(prisma, adapterFor({ '1001': { status: '0' } }, { '1001': 10 }));

    const run = await svc.reconcile({ dryRun: false });
    expect(run.review).toBe(1);
    expect(prisma.orders[0]).toMatchObject({ status: 'ABIERTO', reviewReason: 'FUERA_DE_VISTA' });
  });

  it('es idempotente: una segunda corrida no duplica eventos', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const adapter = adapterFor({ '1001': { status: '2' } }, { '1001': 0 });
    const svc = service(prisma, adapter);

    await svc.reconcile({ dryRun: false });
    const second = await svc.reconcile({ dryRun: false });
    expect(second.checked).toBe(0);
    expect(prisma.events).toHaveLength(1);
  });

  it('dry-run calcula sin escribir ni crear eventos', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(prisma, adapterFor({ '1001': { status: '2' } }, { '1001': 0 }));

    const run = await svc.reconcile({ dryRun: true });
    expect(run.closed).toBe(1);
    expect(run.dryRun).toBe(true);
    expect(prisma.orders[0]).toMatchObject({ status: 'ABIERTO', isActive: true });
    expect(prisma.events).toHaveLength(0);
    expect(scenarios.pruneClosedOrders).not.toHaveBeenCalled();
  });
});
