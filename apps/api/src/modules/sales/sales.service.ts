import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Customer,
  CustomerQuery,
  OrderDetail,
  OrderGroup,
  OrderGroupLine,
  OrderGroupQuery,
  OrderGroupedResponse,
  OrderLine,
  OrderQuery,
  OrderSummary,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';

// ============================================================
// Pedidos y clientes (Fase 4): consulta de lo ya sincronizado.
// Todo desde pedidos/clientes locales; nunca escribe en Profit.
// Los campos del reporte ampliado (vendedor, tipo, autorizado,
// cantidad, almacén) llegan por la sync; si faltan, son null.
// ============================================================

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

// Cantidad solicitada: 0 se reporta como "sin dato" (null) para no confundir
// con una cantidad real de cero (la fuente siempre trae pendiente > 0).
function toQuantityOrNull(value: unknown): number | null {
  const n = toNumberOrNull(value);
  return n === null || n === 0 ? null : n;
}

// Rango de fechas inclusivo sobre un campo date.
function dateRange(from?: string, to?: string) {
  if (!from && !to) return {};
  return {
    gte: from ? new Date(from) : undefined,
    lte: to ? new Date(new Date(to).getTime() + 86_400_000 - 1) : undefined,
  };
}

// Filtros de pedidos (sin paginación): compartidos por la lista y la agrupación.
type OrderFilters = Omit<OrderQuery, 'page' | 'pageSize'>;

// Construye el `where` de pedidos a partir de los filtros compartidos.
function orderWhere(query: OrderFilters): Prisma.SalesOrderWhereInput {
  const emision = dateRange(query.emisionDesde, query.emisionHasta);
  const entrega = dateRange(query.entregaDesde, query.entregaHasta);
  return {
    isActive: true,
    ...(query.status ? { status: query.status } : {}),
    ...(query.customerCode ? { customerCode: query.customerCode } : {}),
    ...(query.customerType ? { customerType: { contains: query.customerType } } : {}),
    ...(query.vendor ? { vendor: { contains: query.vendor } } : {}),
    ...(query.authorized ? { authorized: query.authorized === 'SI' } : {}),
    ...(Object.keys(emision).length ? { orderDate: emision } : {}),
    ...(Object.keys(entrega).length ? { requestedDate: entrega } : {}),
    ...(query.q
      ? {
          OR: [
            { externalNumber: { contains: query.q } },
            { customerName: { contains: query.q } },
            { customerCode: { contains: query.q } },
          ],
        }
      : {}),
  };
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async listCustomers(query: CustomerQuery) {
    const where = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.q
        ? { OR: [{ externalCode: { contains: query.q } }, { name: { contains: query.q } }] }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { externalCode: 'asc' },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const codes = items.map((c) => c.externalCode);
    const grouped = codes.length
      ? await this.prisma.salesOrder.groupBy({
          by: ['customerCode'],
          where: { isActive: true, customerCode: { in: codes } },
          _count: { _all: true },
        })
      : [];
    const countByCode = new Map(grouped.map((g) => [g.customerCode, g._count._all]));

    return {
      items: items.map(
        (c): Customer => ({
          id: c.id,
          externalCode: c.externalCode,
          name: c.name,
          customerType: c.customerType,
          vendor: c.vendor,
          isActive: c.isActive,
          ordersCount: countByCode.get(c.externalCode) ?? 0,
        }),
      ),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async listOrders(query: OrderQuery) {
    const where = orderWhere(query);

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.salesOrder.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ requestedDate: 'asc' }, { externalNumber: 'asc' }],
        include: { lines: { select: { pendingQty: true } } },
      }),
      this.prisma.salesOrder.count({ where }),
    ]);

    // Resumen agregado de TODO el conjunto filtrado (no sólo la página).
    const [linesAgg, openCount] = await Promise.all([
      this.prisma.salesOrderLine.aggregate({
        where: { order: where },
        _sum: { pendingQty: true },
        _count: { _all: true },
      }),
      this.prisma.salesOrder.count({ where: { ...where, status: 'ABIERTO' } }),
    ]);

    return {
      items: orders.map((o) => {
        const totalPendingQty = o.lines.reduce((acc, l) => acc + toNumber(l.pendingQty), 0);
        return this.toSummary(o, o.lines.length, totalPendingQty);
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
      summary: {
        totalPendingQty: toNumber(linesAgg._sum.pendingQty),
        linesTotal: linesAgg._count._all,
        openCount,
      },
    };
  }

  async orderDetail(id: string): Promise<OrderDetail> {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!order) {
      throw new NotFoundException(`Pedido ${id} no existe`);
    }

    const productCodes = order.lines.map((l) => l.productCode);
    const totalPendingQty = order.lines.reduce((acc, l) => acc + toNumber(l.pendingQty), 0);
    const stock = await this.stockByProduct(productCodes);

    return {
      order: this.toSummary(order, order.lines.length, totalPendingQty),
      lines: order.lines.map((l) => this.toLine(l, stock)),
    };
  }

  // ============================================================
  // Pedidos agrupados por cliente o por producto (para el acordeón).
  // Se agrega en memoria sobre el conjunto filtrado completo (volumen bajo:
  // ~cientos de renglones) para responder en una sola pasada.
  // ============================================================
  async listGrouped(query: OrderGroupQuery): Promise<OrderGroupedResponse> {
    const where = orderWhere(query);
    const byProduct = query.by === 'producto';

    const lines = await this.prisma.salesOrderLine.findMany({
      where: { order: where },
      include: { order: true },
      orderBy: [{ order: { externalNumber: 'asc' } }, { lineNumber: 'asc' }],
    });

    const stock = await this.stockByProduct(lines.map((l) => l.productCode));

    const groups = new Map<
      string,
      {
        key: string;
        code: string | null;
        label: string;
        orders: Set<string>;
        products: Set<string>;
        clients: Set<string>;
        totalPendingQty: number;
        totalPendingKg: number;
        lines: OrderGroupLine[];
      }
    >();

    for (const line of lines) {
      const key = byProduct ? line.productCode : (line.order.customerCode ?? '—');
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          code: byProduct ? line.productCode : line.order.customerCode,
          label: byProduct ? (line.description ?? line.productCode) : (line.order.customerName ?? key),
          orders: new Set<string>(),
          products: new Set<string>(),
          clients: new Set<string>(),
          totalPendingQty: 0,
          totalPendingKg: 0,
          lines: [],
        };
        groups.set(key, group);
      }
      const pendingQty = toNumber(line.pendingQty);
      const pendingKg = toNumberOrNull(line.pendingKg);
      group.orders.add(line.order.externalNumber);
      group.products.add(line.productCode);
      if (line.order.customerCode) group.clients.add(line.order.customerCode);
      group.totalPendingQty += pendingQty;
      group.totalPendingKg += pendingKg ?? 0;
      group.lines.push({
        orderId: line.orderId,
        orderNumber: line.order.externalNumber,
        customerCode: line.order.customerCode,
        customerName: line.order.customerName,
        requestedDate: toDate(line.order.requestedDate),
        authorized: line.order.authorized,
        productCode: line.productCode,
        description: line.description,
        uom: line.uom,
        quantity: toQuantityOrNull(line.quantity),
        pendingQty,
        pendingKg,
        warehouseCode: line.warehouses,
        stock03: stock.get(line.productCode)?.s03 ?? null,
        stock68: stock.get(line.productCode)?.s68 ?? null,
      });
    }

    const result: OrderGroup[] = [...groups.values()]
      .map((g) => ({
        key: g.key,
        code: g.code,
        label: g.label,
        ordersCount: g.orders.size,
        linesCount: g.lines.length,
        totalPendingQty: g.totalPendingQty,
        totalPendingKg: g.totalPendingKg,
        itemsCount: byProduct ? g.clients.size : g.products.size,
        lines: g.lines.sort((a, b) => b.pendingQty - a.pendingQty),
      }))
      .sort((a, b) => b.totalPendingQty - a.totalPendingQty);

    return {
      by: query.by,
      groups: result,
      totalPendingQty: result.reduce((acc, g) => acc + g.totalPendingQty, 0),
      totalPendingKg: result.reduce((acc, g) => acc + g.totalPendingKg, 0),
    };
  }

  // Existencias del último snapshot para un conjunto de artículos.
  private async stockByProduct(productCodes: string[]) {
    const codes = [...new Set(productCodes)];
    const snapshot = codes.length
      ? await this.prisma.inventorySnapshot.findFirst({
          orderBy: { takenAt: 'desc' },
          include: { lines: { where: { productCode: { in: codes } } } },
        })
      : null;
    const stock = new Map<string, { s03: number | null; s68: number | null }>();
    for (const l of snapshot?.lines ?? []) {
      const entry = stock.get(l.productCode) ?? { s03: null, s68: null };
      if (l.warehouseCode === 'Stock 03') entry.s03 = toNumberOrNull(l.qty);
      if (l.warehouseCode === 'Stock 68') entry.s68 = toNumberOrNull(l.qty);
      stock.set(l.productCode, entry);
    }
    return stock;
  }

  private toLine(
    line: {
      lineNumber: number;
      productCode: string;
      description: string | null;
      uom: string | null;
      quantity: unknown;
      pendingQty: unknown;
      pendingKg: unknown;
      warehouses: string | null;
    },
    stock: Map<string, { s03: number | null; s68: number | null }>,
  ): OrderLine {
    return {
      lineNumber: line.lineNumber,
      productCode: line.productCode,
      description: line.description,
      uom: line.uom,
      quantity: toQuantityOrNull(line.quantity),
      pendingQty: toNumber(line.pendingQty),
      pendingKg: toNumberOrNull(line.pendingKg),
      warehouseCode: line.warehouses,
      stock03: stock.get(line.productCode)?.s03 ?? null,
      stock68: stock.get(line.productCode)?.s68 ?? null,
    };
  }

  private toSummary(
    order: {
      id: string;
      externalNumber: string;
      customerCode: string | null;
      customerName: string | null;
      customerType: string | null;
      vendor: string | null;
      authorized: boolean | null;
      orderDate: Date | null;
      requestedDate: Date | null;
      status: string;
    },
    linesCount: number,
    totalPendingQty: number,
  ): OrderSummary {
    return {
      id: order.id,
      externalNumber: order.externalNumber,
      customerCode: order.customerCode,
      customerName: order.customerName,
      vendor: order.vendor,
      customerType: order.customerType,
      authorized: order.authorized,
      orderDate: toDate(order.orderDate),
      requestedDate: toDate(order.requestedDate),
      status: order.status as OrderSummary['status'],
      linesCount,
      totalPendingQty,
    };
  }
}
