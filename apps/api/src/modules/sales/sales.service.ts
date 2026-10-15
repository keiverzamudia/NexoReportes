import { Injectable, NotFoundException } from '@nestjs/common';
import { Customer, CustomerQuery, OrderDetail, OrderQuery, OrderSummary } from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';

// ============================================================
// Pedidos y clientes (Fase 4): consulta de lo ya sincronizado.
// Todo desde pedidos/clientes activos; nunca escribe en Profit.
// Los campos que la vista de Profit no expone (vendedor, tipo de
// cliente, cantidad) se devuelven como null: NUNCA se inventan.
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

// Rango de fechas inclusivo sobre un campo date.
function dateRange(from?: string, to?: string) {
  if (!from && !to) return {};
  return {
    gte: from ? new Date(from) : undefined,
    lte: to ? new Date(new Date(to).getTime() + 86_400_000 - 1) : undefined,
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
    const emision = dateRange(query.emisionDesde, query.emisionHasta);
    const entrega = dateRange(query.entregaDesde, query.entregaHasta);

    const where = {
      isActive: true,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerCode ? { customerCode: query.customerCode } : {}),
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

    // Enriquecimiento con datos del cliente (vendedor / tipo de cliente).
    const codes = [...new Set(orders.map((o) => o.customerCode).filter((c): c is string => Boolean(c)))];
    const customers = codes.length
      ? await this.prisma.customer.findMany({ where: { externalCode: { in: codes } } })
      : [];
    const byCode = new Map(customers.map((c) => [c.externalCode, c]));

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
        const customer = o.customerCode ? byCode.get(o.customerCode) : undefined;
        const totalPendingQty = o.lines.reduce((acc, l) => acc + toNumber(l.pendingQty), 0);
        return this.toSummary(o, o.lines.length, totalPendingQty, customer?.vendor ?? null, customer?.customerType ?? null);
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
    const customer = order.customerCode
      ? await this.prisma.customer.findUnique({ where: { externalCode: order.customerCode } })
      : null;

    // Existencias del último snapshot para los artículos del pedido.
    const snapshot = productCodes.length
      ? await this.prisma.inventorySnapshot.findFirst({
          orderBy: { takenAt: 'desc' },
          include: { lines: { where: { productCode: { in: productCodes } } } },
        })
      : null;
    const stock = new Map<string, { s03: number | null; s68: number | null }>();
    for (const l of snapshot?.lines ?? []) {
      const entry = stock.get(l.productCode) ?? { s03: null, s68: null };
      if (l.warehouseCode === 'Stock 03') entry.s03 = toNumberOrNull(l.qty);
      if (l.warehouseCode === 'Stock 68') entry.s68 = toNumberOrNull(l.qty);
      stock.set(l.productCode, entry);
    }

    const totalPendingQty = order.lines.reduce((acc, l) => acc + toNumber(l.pendingQty), 0);
    return {
      order: this.toSummary(order, order.lines.length, totalPendingQty, customer?.vendor ?? null, customer?.customerType ?? null),
      lines: order.lines.map((l) => ({
        lineNumber: l.lineNumber,
        productCode: l.productCode,
        description: l.description,
        uom: l.uom,
        quantity: null, // no está en la vista
        pendingQty: toNumber(l.pendingQty),
        pendingKg: l.pendingKg === null ? null : toNumber(l.pendingKg),
        stock03: stock.get(l.productCode)?.s03 ?? null,
        stock68: stock.get(l.productCode)?.s68 ?? null,
      })),
    };
  }

  private toSummary(
    order: {
      id: string;
      externalNumber: string;
      customerCode: string | null;
      customerName: string | null;
      orderDate: Date | null;
      requestedDate: Date | null;
      status: string;
    },
    linesCount: number,
    totalPendingQty: number,
    vendor: string | null,
    customerType: string | null,
  ): OrderSummary {
    return {
      id: order.id,
      externalNumber: order.externalNumber,
      customerCode: order.customerCode,
      customerName: order.customerName,
      vendor,
      customerType,
      orderDate: toDate(order.orderDate),
      requestedDate: toDate(order.requestedDate),
      status: order.status as OrderSummary['status'],
      linesCount,
      totalPendingQty,
    };
  }
}
