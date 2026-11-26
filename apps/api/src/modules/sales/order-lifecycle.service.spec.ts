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
          if (where?.status) {
            if (typeof where.status === 'string' && order.status !== where.status) return false;
            if (
              typeof where.status === 'object' &&
              Array.isArray(where.status.in) &&
              !where.status.in.includes(order.status)
            ) {
              return false;
            }
          }
          const wanted = where?.externalNumber?.in as unknown[] | undefined;
          if (wanted && !wanted.includes(order.externalNumber)) return false;
          return true;
        });
      },
      updateMany: async ({ where, data }: Row) => {
        let count = 0;
        for (const order of orders) {
          if (where?.id?.in && !where.id.in.includes(order.id)) continue;
          if (where?.id && typeof where.id === 'string' && order.id !== where.id) continue;
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

type NoteFixture = {
  solicitud?: string | null;
  pedido?: string | null;
  nota: string;
  coArt: string;
  qty: number;
};

type PedidoFixture = {
  solicitud: string;
  pedido: string;
  coArt: string;
  qty: number;
  solicitudes?: number;
};

type AdapterInput = {
  headers: Record<string, { status: string; anulada?: boolean }>;
  pending?: Record<string, number>;
  lines?: Record<string, Record<string, number>>;
  notes?: NoteFixture[];
  pedidos?: PedidoFixture[];
};

function adapterFor(input: AdapterInput) {
  const numbersFrom = (params: Record<string, unknown>) =>
    Object.keys(params)
      .filter((key) => /^o\d+$/.test(key))
      .map((key) => String(params[key]));

  return {
    dialect: 'fixtures' as const,
    selectQuery: vi.fn(async (sql: string, _limit: number, params: Record<string, unknown> = {}) => {
      const numbers = numbersFrom(params);
      if (sql.includes('order_lifecycle_header')) {
        return numbers
          .filter((number) => input.headers[number])
          .map((number) => ({
            fact_num: Number(number),
            status: input.headers[number]!.status,
            anulada: input.headers[number]!.anulada ?? false,
          }));
      }
      if (sql.includes('order_lifecycle_pending')) {
        return numbers
          .filter((number) => input.pending?.[number] !== undefined)
          .map((number) => ({
            fact_num: Number(number),
            pendiente: input.pending![number],
            lineas: Object.keys(input.lines?.[number] ?? {}).length || 1,
          }));
      }
      if (sql.includes('order_lifecycle_lines')) {
        return numbers.flatMap((number) =>
          Object.entries(input.lines?.[number] ?? {}).map(([co_art, qty]) => ({
            solicitud: number,
            co_art,
            qty,
          })),
        );
      }
      if (sql.includes('order_lifecycle_pedidos')) {
        const linked = new Set(
          (input.pedidos ?? [])
            .filter((row) => numbers.includes(row.solicitud))
            .map((row) => row.pedido),
        );
        return (input.pedidos ?? [])
          .filter((row) => linked.has(row.pedido))
          .map((row) => ({
            solicitud: row.solicitud,
            pedido: row.pedido,
            co_art: row.coArt,
            qty: row.qty,
            pedido_solicitudes: row.solicitudes ?? 1,
          }));
      }
      if (sql.includes('order_lifecycle_notes')) {
        const linkedPedidos = new Set(
          (input.pedidos ?? [])
            .filter((row) => numbers.includes(row.solicitud))
            .map((row) => row.pedido),
        );
        return (input.notes ?? [])
          .filter(
            (row) =>
              (row.solicitud && numbers.includes(row.solicitud)) ||
              (row.pedido && linkedPedidos.has(row.pedido)),
          )
          .map((row) => ({
            solicitud: row.solicitud ?? null,
            pedido: row.pedido ?? null,
            nota: row.nota,
            co_art: row.coArt,
            qty: row.qty,
          }));
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

  it('cierra como NOTA_ENTREGA cuando la nota real cubre todas las cantidades', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '2' } },
        pending: { '1001': 0 },
        lines: { '1001': { AB: 10 } },
        notes: [{ solicitud: '1001', nota: 'N1', coArt: 'AB', qty: 10 }],
      }),
    );

    const run = await svc.reconcile({ dryRun: false });
    expect(run.closed).toBe(1);
    expect(prisma.orders[0]).toMatchObject({
      status: 'NOTA_ENTREGA',
      isActive: false,
      closedReason: 'NOTA_ENTREGA',
      billingStatus: 'FACTURADO_ASUMIDO',
      notaEntregaRefs: JSON.stringify(['N1']),
    });
    expect(prisma.events).toHaveLength(1);
    expect(prisma.events[0]).toMatchObject({ toStatus: 'NOTA_ENTREGA', reason: 'NOTA_ENTREGA' });
    expect(scenarios.pruneClosedOrders).toHaveBeenCalledWith([
      { orderNumber: '1001', reason: 'NOTA_ENTREGA' },
    ]);
  });

  it('cierra como NOTA_PARCIAL cuando la nota entregó menos cantidad', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '2' } },
        pending: { '1001': 0 },
        lines: { '1001': { AB: 10 } },
        notes: [{ solicitud: '1001', nota: 'N1', coArt: 'AB', qty: 6 }],
      }),
    );

    const run = await svc.reconcile({ dryRun: false });
    expect(run.closed).toBe(1);
    expect(prisma.orders[0]).toMatchObject({
      status: 'NOTA_PARCIAL',
      closedReason: 'NOTA_PARCIAL',
      billingStatus: 'PENDIENTE',
      notaEntregaRefs: JSON.stringify(['N1']),
    });
    const evidence = JSON.parse(prisma.events[0]!.evidence as string);
    expect(evidence.missingQty).toBe(4);
    expect(evidence.missing).toEqual([{ coArt: 'AB', ordered: 10, delivered: 6 }]);
  });

  it('marca SIN_NOTA cuando Profit dice procesado pero no existe ninguna nota', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '2' } },
        pending: { '1001': 0 },
        lines: { '1001': { AB: 10 } },
      }),
    );

    const run = await svc.reconcile({ dryRun: false });
    expect(run.canceled).toBe(1);
    expect(prisma.orders[0]).toMatchObject({
      status: 'CANCELADO',
      closedReason: 'SIN_NOTA',
      billingStatus: 'PENDIENTE',
    });
    expect(prisma.events[0]).toMatchObject({ toStatus: 'CANCELADO', reason: 'SIN_NOTA' });
  });

  it('anula desde Profit y no lo cuenta como despacho', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '0', anulada: true } },
        pending: { '1001': 10 },
        lines: { '1001': { AB: 10 } },
      }),
    );

    const run = await svc.reconcile({ dryRun: false });
    expect(run.canceled).toBe(1);
    expect(prisma.orders[0]).toMatchObject({ status: 'CANCELADO', billingStatus: 'PENDIENTE' });
    expect(prisma.events[0]).toMatchObject({ toStatus: 'CANCELADO', reason: 'CANCELADO' });
  });

  it('no cierra si status 2 conserva pendiente y no hay nota: queda en revisión', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '2' } },
        pending: { '1001': 5 },
        lines: { '1001': { AB: 10 } },
      }),
    );

    const run = await svc.reconcile({ dryRun: false });
    expect(run.closed).toBe(0);
    expect(run.review).toBe(1);
    expect(prisma.orders[0]).toMatchObject({ status: 'ABIERTO', reviewReason: 'STATUS_2_CON_PENDIENTE' });
    expect(prisma.events).toHaveLength(0);
  });

  it('no cierra por ausencia: si desapareció de la vista y sigue abierto, revisa', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder({ isActive: false }));
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '0' } },
        pending: { '1001': 10 },
        lines: { '1001': { AB: 10 } },
      }),
    );

    const run = await svc.reconcile({ dryRun: false });
    expect(run.review).toBe(1);
    expect(prisma.orders[0]).toMatchObject({ status: 'ABIERTO', reviewReason: 'FUERA_DE_VISTA' });
  });

  it('resuelve la nota vía pedido de Profit (tipo_doc = P)', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '2' } },
        pending: { '1001': 0 },
        lines: { '1001': { AB: 10 } },
        pedidos: [{ solicitud: '1001', pedido: 'P1', coArt: 'AB', qty: 10 }],
        notes: [{ pedido: 'P1', nota: 'N9', coArt: 'AB', qty: 10 }],
      }),
    );

    const run = await svc.reconcile({ dryRun: false });
    expect(run.closed).toBe(1);
    expect(prisma.orders[0]).toMatchObject({
      status: 'NOTA_ENTREGA',
      notaEntregaRefs: JSON.stringify(['N9']),
    });
  });

  it('en un pedido compartido no declara completa una solicitud si el pedido está incompleto', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder({ id: 'o-1', externalNumber: '1001' }));
    prisma.orders.push(
      seedOrder({ id: 'o-2', externalNumber: '1002', customerCode: 'C2', customerName: 'CLIENTE 2' }),
    );
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '2' }, '1002': { status: '2' } },
        pending: { '1001': 0, '1002': 0 },
        lines: { '1001': { AB: 10 }, '1002': { AB: 10 } },
        pedidos: [
          { solicitud: '1001', pedido: 'P1', coArt: 'AB', qty: 10, solicitudes: 2 },
          { solicitud: '1002', pedido: 'P1', coArt: 'AB', qty: 10, solicitudes: 2 },
        ],
        notes: [{ pedido: 'P1', nota: 'N9', coArt: 'AB', qty: 10 }],
      }),
    );

    const run = await svc.reconcile({ dryRun: false });
    expect(run.closed).toBe(2);
    expect(prisma.orders[0]).toMatchObject({ status: 'NOTA_PARCIAL' });
    expect(prisma.orders[1]).toMatchObject({ status: 'NOTA_PARCIAL' });
  });

  it('es idempotente: una segunda corrida no duplica eventos', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const adapter = adapterFor({
      headers: { '1001': { status: '2' } },
      pending: { '1001': 0 },
      lines: { '1001': { AB: 10 } },
      notes: [{ solicitud: '1001', nota: 'N1', coArt: 'AB', qty: 10 }],
    });
    const svc = service(prisma, adapter);

    await svc.reconcile({ dryRun: false });
    const second = await svc.reconcile({ dryRun: false });
    expect(second.checked).toBe(0);
    expect(prisma.events).toHaveLength(1);
  });

  it('dry-run calcula sin escribir ni crear eventos', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(seedOrder());
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '2' } },
        pending: { '1001': 0 },
        lines: { '1001': { AB: 10 } },
        notes: [{ solicitud: '1001', nota: 'N1', coArt: 'AB', qty: 10 }],
      }),
    );

    const run = await svc.reconcile({ dryRun: true });
    expect(run.closed).toBe(1);
    expect(run.dryRun).toBe(true);
    expect(prisma.orders[0]).toMatchObject({ status: 'ABIERTO', isActive: true });
    expect(prisma.events).toHaveLength(0);
    expect(scenarios.pruneClosedOrders).not.toHaveBeenCalled();
  });

  it('revalida un cierre histórico sin nota y lo pasa a CANCELADO / SIN_NOTA', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(
      seedOrder({
        status: 'NOTA_ENTREGA',
        isActive: false,
        closedAt: new Date('2026-11-20'),
        closedReason: 'NOTA_ENTREGA',
        billingStatus: 'FACTURADO_ASUMIDO',
      }),
    );
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '2' } },
        pending: { '1001': 0 },
        lines: { '1001': { AB: 10 } },
      }),
    );

    const run = await svc.reconcile({ includeClosed: true, dryRun: false });
    expect(run.canceled).toBe(1);
    expect(prisma.orders[0]).toMatchObject({
      status: 'CANCELADO',
      closedReason: 'SIN_NOTA',
      billingStatus: 'PENDIENTE',
    });
    expect(prisma.events[0]).toMatchObject({
      fromStatus: 'NOTA_ENTREGA',
      toStatus: 'CANCELADO',
      reason: 'SIN_NOTA',
    });
  });

  it('revalida un cierre correcto: rellena refs sin duplicar eventos', async () => {
    const prisma = createFakePrisma();
    prisma.orders.push(
      seedOrder({
        status: 'NOTA_ENTREGA',
        isActive: false,
        closedAt: new Date('2026-11-20'),
        closedReason: 'NOTA_ENTREGA',
        billingStatus: 'FACTURADO_ASUMIDO',
        notaEntregaRefs: null,
      }),
    );
    const svc = service(
      prisma,
      adapterFor({
        headers: { '1001': { status: '2' } },
        pending: { '1001': 0 },
        lines: { '1001': { AB: 10 } },
        notes: [{ solicitud: '1001', nota: 'N1', coArt: 'AB', qty: 10 }],
      }),
    );

    const run = await svc.reconcile({ includeClosed: true, dryRun: false });
    expect(run.closed).toBe(0);
    expect(prisma.orders[0]).toMatchObject({
      status: 'NOTA_ENTREGA',
      notaEntregaRefs: JSON.stringify(['N1']),
    });
    expect(prisma.events).toHaveLength(0);
  });
});
