import { describe, expect, it } from 'vitest';
import { SalesService } from './sales.service';

// Fake mínimo de Prisma: sólo los métodos que usa SalesService.
// Stub de la capa de fechas: estos tests cubren sólo la lectura de pedidos.
const deliveryDates = { resolveForLines: async () => new Map<string, string>() } as never;

type FakeSale = { sacks?: number; kg?: number; totalKg?: number; notes?: number; lastSaleDate?: string | null };

// Stub del agregado de ventas por periodo (notas de entrega en Profit).
function fakeCustomerSales(periods: Record<string, Record<string, FakeSale>> = {}, available = true) {
  return {
    aggregate: async (period: string) => ({
      available,
      byCode: new Map(
        Object.entries(periods[period] ?? {}).map(([code, sale]) => [
          code,
          { sacks: 0, kg: 0, totalKg: 0, notes: 0, lastSaleDate: null, ...sale },
        ]),
      ),
    }),
  } as never;
}

function createFakePrisma(orders: any[], customers: any[] = []) {
  return {
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    salesOrder: {
      findMany: async (args: any) => {
        const rows = orders.map((o) => ({
          ...o,
          lines: args?.include?.lines ? o.lines : undefined,
        }));
        return rows;
      },
      count: async () => orders.length,
      findUnique: async (args: any) => orders.find((o) => o.id === args.where.id) ?? null,
      groupBy: async () => {
        const counts = new Map<string, number>();
        for (const o of orders) {
          if (o.customerCode) counts.set(o.customerCode, (counts.get(o.customerCode) ?? 0) + 1);
        }
        return [...counts].map(([customerCode, count]) => ({ customerCode, _count: { _all: count } }));
      },
    },
    salesOrderLine: {
      aggregate: async () => ({
        _sum: { pendingQty: orders.reduce((acc, o) => acc + o.lines.reduce((a: number, l: any) => a + l.pendingQty, 0), 0) },
        _count: { _all: orders.reduce((acc, o) => acc + o.lines.length, 0) },
      }),
    },
    inventorySnapshot: {
      findFirst: async () => ({ takenAt: new Date('2025-09-10T00:00:00.000Z'), lines: [] }),
    },
    customer: {
      findMany: async (args: any) => {
        const codes = args?.where?.externalCode?.in;
        return Array.isArray(codes) ? customers.filter((c: any) => codes.includes(c.externalCode)) : customers;
      },
      findUnique: async (args: any) => customers.find((c: any) => c.externalCode === args.where.externalCode) ?? null,
      count: async () => customers.length,
    },
  } as never;
}

function order(id: string, externalNumber: string, pendings: number[], extra: Record<string, unknown> = {}) {
  return {
    id,
    externalNumber,
    customerCode: 'C1',
    customerName: 'CLIENTE UNO',
    orderDate: new Date('2025-09-03T00:00:00.000Z'),
    requestedDate: new Date('2025-09-10T00:00:00.000Z'),
    status: 'ABIERTO',
    isActive: true,
    lines: pendings.map((p, i) => ({
      lineNumber: i + 1,
      productCode: `ART${i + 1}`,
      description: `Artículo ${i + 1}`,
      uom: 'SAC',
      pendingQty: p,
      pendingKg: p * 35,
    })),
    ...extra,
  };
}

describe('SalesService.listOrders — total pendiente de la lista', () => {
  it('suma los pendientes de los renglones (regresión: antes devolvía 0)', async () => {
    const prisma = createFakePrisma([order('o1', '3346', [3]), order('o2', '3451', [217, 10])]);
    const service = new SalesService(prisma, deliveryDates, fakeCustomerSales());

    const result = await service.listOrders({ page: 1, pageSize: 25 });

    expect(result.total).toBe(2);
    expect(result.items[0]!.totalPendingQty).toBe(3);
    expect(result.items[1]!.totalPendingQty).toBe(227);
    expect(result.items[1]!.linesCount).toBe(2);
  });

  it('conserva el signo del sobre-compromiso en el total del pedido', async () => {
    const prisma = createFakePrisma([order('o1', '3561', [-247])]);
    const service = new SalesService(prisma, deliveryDates, fakeCustomerSales());

    const result = await service.listOrders({ page: 1, pageSize: 25 });

    expect(result.items[0]!.totalPendingQty).toBe(-247);
  });
});

describe('SalesService.orderDetail', () => {
  it('devuelve el encabezado y los renglones con su kg crudo', async () => {
    const prisma = createFakePrisma([order('o1', '3346', [3, -1])]);
    const service = new SalesService(prisma, deliveryDates, fakeCustomerSales());

    const detail = await service.orderDetail('o1');

    expect(detail.order.externalNumber).toBe('3346');
    expect(detail.order.totalPendingQty).toBe(2);
    expect(detail.lines).toHaveLength(2);
    expect(detail.lines[0]!.pendingKg).toBe(105);
    expect(detail.lines[0]!.uom).toBe('SAC');
  });

  it('falla con NotFound si el pedido no existe', async () => {
    const prisma = createFakePrisma([]);
    const service = new SalesService(prisma, deliveryDates, fakeCustomerSales());

    await expect(service.orderDetail('no-existe')).rejects.toThrow(/no existe/);
  });
});

describe('SalesService.listCustomers', () => {
  const customers = [
    { id: 'c1', externalCode: '153064128', name: 'JOSEF HENDRIX', customerType: null, vendor: null, isActive: true },
    { id: 'c2', externalCode: '505835220', name: 'AGRO INVERSIONES', customerType: 'L2 DISTRIBUIDORES', vendor: 'LIZ PEREZ', isActive: true },
  ];

  it('expone tipo/vendedor nulos cuando la sync no los trae y las ventas del periodo', async () => {
    const prisma = createFakePrisma([], [customers[0]]);
    const service = new SalesService(
      prisma,
      deliveryDates,
      fakeCustomerSales({ '12m': { '153064128': { sacks: 140, totalKg: 4900, notes: 3, lastSaleDate: '2026-10-31' } } }),
    );

    const result = await service.listCustomers({ page: 1, pageSize: 50, salesPeriod: 'todos' });

    expect(result.total).toBe(1);
    expect(result.items[0]!.customerType).toBeNull();
    expect(result.items[0]!.vendor).toBeNull();
    expect(result.items[0]!.sales).toMatchObject({ sacks: 140, totalKg: 4900 });
    expect(result.summary.withSales).toBe(1);
  });

  it('«todos» incluye clientes con pedido activo aunque no tengan ventas', async () => {
    const prisma = createFakePrisma([order('o1', '3346', [3], { customerCode: '153064128' })], customers);
    const service = new SalesService(
      prisma,
      deliveryDates,
      fakeCustomerSales({ '12m': { '505835220': { kg: 4200, totalKg: 4200 } } }),
    );

    const result = await service.listCustomers({ page: 1, pageSize: 50, salesPeriod: 'todos' });

    expect(result.total).toBe(2);
    const withOrder = result.items.find((c) => c.externalCode === '153064128');
    expect(withOrder?.ordersCount).toBe(1);
    expect(withOrder?.sales).toBeNull();
  });

  it('el filtro de periodo recorta a los clientes con ventas en la ventana', async () => {
    const prisma = createFakePrisma([], customers);
    const service = new SalesService(
      prisma,
      deliveryDates,
      fakeCustomerSales({
        '12m': { '153064128': { sacks: 140, totalKg: 4900 }, '505835220': { kg: 4200, totalKg: 4200 } },
        '3m': { '505835220': { kg: 900, totalKg: 900 } },
      }),
    );

    const result = await service.listCustomers({ page: 1, pageSize: 50, salesPeriod: '3m' });

    expect(result.total).toBe(1);
    expect(result.items[0]!.externalCode).toBe('505835220');
    expect(result.items[0]!.sales?.totalKg).toBe(900);
  });

  it('«Solo con pedidos activos» intersecta el periodo con la cartera', async () => {
    const prisma = createFakePrisma([order('o1', '3346', [3], { customerCode: '153064128' })], customers);
    const service = new SalesService(
      prisma,
      deliveryDates,
      fakeCustomerSales({
        '12m': { '153064128': { sacks: 10, totalKg: 350 }, '505835220': { kg: 4200, totalKg: 4200 } },
        '3m': { '153064128': { sacks: 10, totalKg: 350 }, '505835220': { kg: 900, totalKg: 900 } },
      }),
    );

    const result = await service.listCustomers({
      page: 1,
      pageSize: 50,
      salesPeriod: '3m',
      onlyWithOrders: true,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]!.externalCode).toBe('153064128');
  });

  it('si Profit falla conserva la cartera de pedidos y marca salesAvailable=false', async () => {
    const prisma = createFakePrisma([order('o1', '3346', [3], { customerCode: '153064128' })], customers);
    const service = new SalesService(prisma, deliveryDates, fakeCustomerSales({}, false));

    const result = await service.listCustomers({ page: 1, pageSize: 50, salesPeriod: 'mes' });

    expect(result.salesAvailable).toBe(false);
    expect(result.total).toBe(1);
    expect(result.items[0]!.sales).toBeNull();
  });
});
