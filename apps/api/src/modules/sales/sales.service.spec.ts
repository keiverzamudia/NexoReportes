import { describe, expect, it } from 'vitest';
import { SalesService } from './sales.service';

// Fake mínimo de Prisma: sólo los métodos que usa SalesService.
// Stub de la capa de fechas: estos tests cubren sólo la lectura de pedidos.
const deliveryDates = { resolveForLines: async () => new Map<string, string>() } as never;

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
      groupBy: async () => [],
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
      findMany: async () => customers,
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
    const service = new SalesService(prisma, deliveryDates);

    const result = await service.listOrders({ page: 1, pageSize: 25 });

    expect(result.total).toBe(2);
    expect(result.items[0]!.totalPendingQty).toBe(3);
    expect(result.items[1]!.totalPendingQty).toBe(227);
    expect(result.items[1]!.linesCount).toBe(2);
  });

  it('conserva el signo del sobre-compromiso en el total del pedido', async () => {
    const prisma = createFakePrisma([order('o1', '3561', [-247])]);
    const service = new SalesService(prisma, deliveryDates);

    const result = await service.listOrders({ page: 1, pageSize: 25 });

    expect(result.items[0]!.totalPendingQty).toBe(-247);
  });
});

describe('SalesService.orderDetail', () => {
  it('devuelve el encabezado y los renglones con su kg crudo', async () => {
    const prisma = createFakePrisma([order('o1', '3346', [3, -1])]);
    const service = new SalesService(prisma, deliveryDates);

    const detail = await service.orderDetail('o1');

    expect(detail.order.externalNumber).toBe('3346');
    expect(detail.order.totalPendingQty).toBe(2);
    expect(detail.lines).toHaveLength(2);
    expect(detail.lines[0]!.pendingKg).toBe(105);
    expect(detail.lines[0]!.uom).toBe('SAC');
  });

  it('falla con NotFound si el pedido no existe', async () => {
    const prisma = createFakePrisma([]);
    const service = new SalesService(prisma, deliveryDates);

    await expect(service.orderDetail('no-existe')).rejects.toThrow(/no existe/);
  });
});

describe('SalesService.listCustomers', () => {
  it('expone tipo/vendedor nulos cuando la sync no los trae y el conteo de pedidos', async () => {
    const prisma = createFakePrisma([], [
      { id: 'c1', externalCode: '153064128', name: 'JOSEF HENDRIX', customerType: null, vendor: null, isActive: true },
    ]);
    const service = new SalesService(prisma, deliveryDates);

    const result = await service.listCustomers({ page: 1, pageSize: 50 });

    expect(result.total).toBe(1);
    expect(result.items[0]!.customerType).toBeNull();
    expect(result.items[0]!.vendor).toBeNull();
  });
});
