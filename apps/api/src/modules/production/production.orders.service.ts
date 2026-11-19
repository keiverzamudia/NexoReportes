import { Injectable } from '@nestjs/common';
import {
  ProductionOrderGroup,
  ProductionOrderLine,
  ProductionOrderRisk,
  ProductionOrdersQuery,
  ProductionOrdersResponse,
  ProductionSimulationSelection,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { deliveryDateKey } from '../sales/delivery-dates.service';

// ============================================================
// Pedidos y clientes para la vista de selección de Producción.
//
// No duplica la sincronización: usa SalesOrder/SalesOrderLine (Profit) y
// DeliveryDateOverride (fecha tentativa local). La explosión y el plan
// consumen la misma selección.
// ============================================================

const PT_WAREHOUSES = new Set(['Stock 03', 'Stock 9999', 'Stock 68', 'Stock PTP']);
const WEEK_BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [1, 7],
  [8, 14],
  [15, 21],
  [22, 31],
];

const RISK_ORDER: Record<ProductionOrderRisk, number> = {
  SIN_DEMANDA: 0,
  CUBIERTO: 1,
  BAJO: 2,
  MEDIO: 3,
  ALTO: 4,
};

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function riskFor(stockKg: number, pendingKg: number, coverageDays: number | null): ProductionOrderRisk {
  if (pendingKg <= 0) return 'SIN_DEMANDA';
  if (stockKg >= pendingKg) return 'CUBIERTO';
  if (coverageDays !== null && coverageDays >= 3) return 'BAJO';
  if (coverageDays !== null && coverageDays >= 1) return 'MEDIO';
  return 'ALTO';
}

function worstRisk(lines: ProductionOrderLine[]): ProductionOrderRisk {
  return lines.reduce<ProductionOrderRisk>(
    (worst, line) => (RISK_ORDER[line.risk] > RISK_ORDER[worst] ? line.risk : worst),
    'SIN_DEMANDA',
  );
}

interface Period {
  start: Date;
  end: Date;
  days: number;
}

interface OrderContext {
  lines: ProductionOrderLine[];
  days: number;
}

@Injectable()
export class ProductionOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async group(query: ProductionOrdersQuery): Promise<ProductionOrdersResponse> {
    const { lines, days } = await this.loadContext(query);
    const filtered = lines.filter((line) => {
      if (query.productCode && line.productCode !== query.productCode) return false;
      if (query.customerCode && line.customerCode !== query.customerCode) return false;
      if (query.onlyRisk && line.risk !== 'ALTO' && line.risk !== 'MEDIO') return false;
      return true;
    });

    const groups = new Map<string, ProductionOrderGroup>();
    for (const line of filtered) {
      const key =
        query.by === 'producto'
          ? line.productCode
          : line.customerCode ?? '__sin_cliente__';
      const current = groups.get(key);
      if (!current) {
        groups.set(key, {
          key,
          code: query.by === 'producto' ? line.productCode : line.customerCode,
          label:
            query.by === 'producto'
              ? line.description
              : line.customerName ?? 'Sin cliente',
          ordersCount: 0,
          linesCount: 0,
          productsCount: 0,
          customersCount: 0,
          totalPendingQty: 0,
          totalPendingKg: 0,
          stockKg: query.by === 'producto' ? line.stockKg : null,
          coverageDays: null,
          risk: 'SIN_DEMANDA',
          lines: [],
        });
      }
      const group = groups.get(key)!;
      group.lines.push(line);
    }

    for (const group of groups.values()) {
      const orderNumbers = new Set(group.lines.map((line) => line.orderNumber));
      const customers = new Set(group.lines.map((line) => line.customerCode ?? '__sin_cliente__'));
      const products = new Set(group.lines.map((line) => line.productCode));
      group.ordersCount = orderNumbers.size;
      group.customersCount = customers.size;
      group.productsCount = products.size;
      group.linesCount = group.lines.length;
      group.totalPendingQty = round(group.lines.reduce((acc, line) => acc + line.pendingQty, 0));
      group.totalPendingKg = round(group.lines.reduce((acc, line) => acc + line.pendingKg, 0));
      group.lines.sort((a, b) => {
        const date = (a.effectiveDate ?? '').localeCompare(b.effectiveDate ?? '');
        return date !== 0 ? date : a.orderNumber.localeCompare(b.orderNumber);
      });

      if (query.by === 'producto') {
        const stockKg = group.lines[0]?.stockKg ?? 0;
        group.stockKg = stockKg;
        group.coverageDays =
          group.totalPendingKg > 0 && days > 0
            ? round(stockKg / (group.totalPendingKg / days), 1)
            : null;
        group.risk = riskFor(stockKg, group.totalPendingKg, group.coverageDays);
      } else {
        group.stockKg = null;
        group.coverageDays = null;
        group.risk = worstRisk(group.lines);
      }
    }

    const sorted = Array.from(groups.values()).sort((a, b) => {
      const risk = RISK_ORDER[b.risk] - RISK_ORDER[a.risk];
      if (risk !== 0) return risk;
      return b.totalPendingKg - a.totalPendingKg;
    });

    return {
      year: query.year,
      month: query.month,
      week: query.week,
      by: query.by,
      asOf: new Date().toISOString(),
      groups: sorted,
      totals: {
        orders: new Set(filtered.map((line) => line.orderNumber)).size,
        lines: filtered.length,
        products: new Set(filtered.map((line) => line.productCode)).size,
        customers: new Set(filtered.map((line) => line.customerCode ?? '__sin_cliente__')).size,
        pendingKg: round(filtered.reduce((acc, line) => acc + line.pendingKg, 0)),
        riskLines: filtered.filter((line) => line.risk === 'ALTO' || line.risk === 'MEDIO').length,
      },
      alerts: [],
    };
  }

  async demandAndSelection(
    query: ProductionOrdersQuery,
    keys: string[],
  ): Promise<{ demandByProduct: Map<string, number>; selection: ProductionSimulationSelection }> {
    const { lines } = await this.loadContext(query);
    const selected = new Set(keys);
    const chosen = lines.filter((line) => selected.has(line.selectionKey));
    const demandByProduct = new Map<string, number>();
    for (const line of chosen) {
      demandByProduct.set(line.productCode, (demandByProduct.get(line.productCode) ?? 0) + line.pendingKg);
    }
    return {
      demandByProduct,
      selection: {
        keys: chosen.length,
        orders: new Set(chosen.map((line) => line.orderNumber)).size,
        lines: chosen.length,
        products: new Set(chosen.map((line) => line.productCode)).size,
        customers: new Set(chosen.map((line) => line.customerCode ?? '__sin_cliente__')).size,
        pendingKg: round(chosen.reduce((acc, line) => acc + line.pendingKg, 0)),
      },
    };
  }

  private period(query: ProductionOrdersQuery): Period {
    if (query.week > 0) {
      const bounds = WEEK_BOUNDS[query.week - 1] ?? WEEK_BOUNDS[WEEK_BOUNDS.length - 1];
      const start = new Date(Date.UTC(query.year, query.month - 1, bounds![0]));
      const end = new Date(Date.UTC(query.year, query.month - 1, bounds![1] + 1));
      return { start, end, days: (end.getTime() - start.getTime()) / 86_400_000 };
    }
    const start = new Date(Date.UTC(query.year, query.month - 1, 1));
    const end = new Date(Date.UTC(query.year, query.month, 1));
    return { start, end, days: (end.getTime() - start.getTime()) / 86_400_000 };
  }

  private async loadContext(query: ProductionOrdersQuery): Promise<OrderContext> {
    const period = this.period(query);

    const [orders, overrides, snapshot] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: { isActive: true, status: 'ABIERTO' },
        include: { lines: { include: { product: true } } },
      }),
      this.prisma.deliveryDateOverride.findMany(),
      this.prisma.inventorySnapshot.findFirst({
        orderBy: { takenAt: 'desc' },
        include: { lines: true },
      }),
    ]);

    // Solo los despachos de los pedidos vivos: no se recorre todo el historial.
    const orderNumbers = orders.map((order) => order.externalNumber);
    const dispatchLines = orderNumbers.length
      ? await this.prisma.dispatchSheetLine.findMany({
          where: {
            orderNumber: { in: orderNumbers },
            removedAt: null,
            status: { not: 'ANULADO' },
          },
          select: {
            orderNumber: true,
            productCode: true,
            sheet: { select: { number: true, status: true } },
          },
        })
      : [];

    const overrideByKey = new Map(
      overrides.map((override) => [
        deliveryDateKey(override.orderNumber, override.productCode),
        override,
      ]),
    );
    const dispatchByKey = new Map<string, string>();
    for (const line of dispatchLines) {
      if (!line.sheet || line.sheet.status === 'CANCELADO' || line.sheet.status === 'DESPACHADO') continue;
      dispatchByKey.set(`${line.orderNumber}|${line.productCode}`, line.sheet.number);
    }

    const productMeta = new Map<string, { description: string; uom: string; kgPerUom: number }>();
    for (const order of orders) {
      for (const line of order.lines) {
        if (!productMeta.has(line.productCode)) {
          productMeta.set(line.productCode, {
            description: line.description ?? line.product?.description ?? line.productCode,
            uom: line.uom ?? line.product?.uom ?? 'KG',
            kgPerUom: line.product?.kgPerUom ? asNumber(line.product.kgPerUom) : 1,
          });
        }
      }
    }

    const stockKgByProduct = new Map<string, number>();
    for (const line of snapshot?.lines ?? []) {
      if (!PT_WAREHOUSES.has(line.warehouseCode)) continue;
      const kgPerUom = productMeta.get(line.productCode)?.kgPerUom ?? 1;
      stockKgByProduct.set(
        line.productCode,
        (stockKgByProduct.get(line.productCode) ?? 0) + asNumber(line.qty) * kgPerUom,
      );
    }

    const lines: ProductionOrderLine[] = [];
    for (const order of orders) {
      for (const line of order.lines) {
        const override = overrideByKey.get(deliveryDateKey(order.externalNumber, line.productCode));
        const effectiveDate = override?.tentativeDate ?? order.requestedDate ?? null;
        if (!effectiveDate) continue;
        const effectiveTime = effectiveDate.getTime();
        if (effectiveTime < period.start.getTime() || effectiveTime >= period.end.getTime()) continue;

        const meta = productMeta.get(line.productCode);
        const pendingQty = asNumber(line.pendingQty);
        const pendingKg =
          line.pendingKg !== null
            ? asNumber(line.pendingKg)
            : pendingQty * (meta?.kgPerUom ?? 1);
        const stockKg = stockKgByProduct.get(line.productCode) ?? 0;
        const coverageDays =
          pendingKg > 0 && period.days > 0
            ? round(stockKg / (pendingKg / period.days), 1)
            : null;

        lines.push({
          selectionKey: `${order.externalNumber}|${line.productCode}|${line.lineNumber}`,
          orderNumber: order.externalNumber,
          orderDate: iso(order.orderDate),
          requestedDate: iso(order.requestedDate),
          effectiveDate: iso(effectiveDate),
          customerCode: order.customerCode,
          customerName: order.customerName,
          customerType: order.customerType,
          vendor: order.vendor,
          productCode: line.productCode,
          description: meta?.description ?? line.description ?? line.productCode,
          uom: meta?.uom ?? line.uom ?? 'KG',
          pendingQty: round(pendingQty),
          pendingKg: round(pendingKg),
          warehouseCode: line.warehouses ?? null,
          authorized: order.authorized,
          stockKg: round(stockKg),
          coverageDays,
          risk: riskFor(stockKg, pendingKg, coverageDays),
          dispatchSheetNumber: dispatchByKey.get(`${order.externalNumber}|${line.productCode}`) ?? null,
        });
      }
    }

    return { lines, days: period.days };
  }
}
