import { Injectable, NotFoundException } from '@nestjs/common';
import { Customer, CustomerQuery, OrderDetail, OrderQuery, OrderSummary } from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';

// ============================================================
// Pedidos y clientes (Fase 4): consulta de lo ya sincronizado.
// Todo desde pedidos/clientes activos; nunca escribe en Profit.
// ============================================================

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
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

    // Conteo de pedidos activos por cliente (sólo los de la página).
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
    const requestedDateFilter =
      query.entregaDesde || query.entregaHasta
        ? {
            requestedDate: {
              ...(query.entregaDesde ? { gte: new Date(query.entregaDesde) } : {}),
              ...(query.entregaHasta
                ? // inclusive: suma un día para cubrir todo el día 'entregaHasta'
                  { lte: new Date(new Date(query.entregaHasta).getTime() + 86_400_000 - 1) }
                : {}),
            },
          }
        : {};

    const where = {
      isActive: true,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerCode ? { customerCode: query.customerCode } : {}),
      ...requestedDateFilter,
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

    return {
      items: orders.map((o) => {
        const totalPendingQty = o.lines.reduce((acc, l) => acc + toNumber(l.pendingQty), 0);
        return this.toSummary(o, o.lines.length, totalPendingQty);
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
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

    const totalPendingQty = order.lines.reduce((acc, l) => acc + toNumber(l.pendingQty), 0);
    return {
      order: this.toSummary(order, order.lines.length, totalPendingQty),
      lines: order.lines.map((l) => ({
        lineNumber: l.lineNumber,
        productCode: l.productCode,
        description: l.description,
        uom: l.uom,
        pendingQty: toNumber(l.pendingQty),
        pendingKg: l.pendingKg === null ? null : toNumber(l.pendingKg),
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
    precomputedTotal?: number,
  ): OrderSummary {
    return {
      id: order.id,
      externalNumber: order.externalNumber,
      customerCode: order.customerCode,
      customerName: order.customerName,
      orderDate: toDate(order.orderDate),
      requestedDate: toDate(order.requestedDate),
      status: order.status as OrderSummary['status'],
      linesCount,
      totalPendingQty: precomputedTotal ?? 0,
    };
  }
}
