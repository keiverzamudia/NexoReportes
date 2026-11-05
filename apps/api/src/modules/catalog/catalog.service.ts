import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AvailabilityProductCustomers,
  AvailabilityResponse,
  InventoryByWarehouse,
  InventorySnapshotSummary,
  Product,
  ProductDetail,
  ProductQuery,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AvailabilityInput, computeAvailability } from '../availability/availability.engine';

// ============================================================
// Catálogo, inventario y disponibilidad (Fase 3).
// Todo se calcula desde lo sincronizado desde Profit:
//  - existencia: ÚLTIMA fotografía (InventorySnapshot) por almacén
//  - demanda: suma de pendientes de renglones de pedidos ACTIVOS
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

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(query: ProductQuery) {
    const where = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.q
        ? { OR: [{ externalCode: { contains: query.q } }, { description: { contains: query.q } }] }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { externalCode: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: items.map((p) => this.toProduct(p)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async productDetail(code: string): Promise<ProductDetail> {
    const product = await this.prisma.product.findUnique({ where: { externalCode: code } });
    if (!product) {
      throw new NotFoundException(`Producto ${code} no existe en el catálogo sincronizado`);
    }

    const snapshot = await this.latestSnapshot();
    const inventory: InventoryByWarehouse[] = (snapshot?.lines ?? [])
      .filter((l) => l.productCode === code)
      .map((l) => ({
        warehouseCode: l.warehouseCode,
        warehouseName: l.warehouse?.name ?? null,
        qty: toNumber(l.qty),
        reservedQty: toNumber(l.reservedQty),
      }));

    const demand = await this.demandByProduct(code);
    const availability = computeAvailability(this.toInput(product, inventory, demand));

    return {
      product: this.toProduct(product),
      inventory,
      snapshotAt: snapshot ? snapshot.takenAt.toISOString() : null,
      availability,
    };
  }

  async availability(): Promise<AvailabilityResponse> {
    const [products, snapshot, demands] = await Promise.all([
      this.prisma.product.findMany({ where: { isActive: true }, orderBy: { externalCode: 'asc' } }),
      this.latestSnapshot(),
      this.allDemands(),
    ]);

    // Índice de la fotografía: producto → existencias por almacén.
    const stockByProduct = new Map<string, InventoryByWarehouse[]>();
    for (const line of snapshot?.lines ?? []) {
      const entry: InventoryByWarehouse = {
        warehouseCode: line.warehouseCode,
        warehouseName: line.warehouse?.name ?? null,
        qty: toNumber(line.qty),
        reservedQty: toNumber(line.reservedQty),
      };
      const bucket = stockByProduct.get(line.productCode);
      if (bucket) bucket.push(entry);
      else stockByProduct.set(line.productCode, [entry]);
    }

    const rows = products.map((product) => {
      const demand = demands.get(product.externalCode) ?? { pendingQty: 0, pendingKg: null };
      const inventory = stockByProduct.get(product.externalCode) ?? [];
      return computeAvailability(this.toInput(product, inventory, demand));
    });

    return {
      snapshotAt: snapshot ? snapshot.takenAt.toISOString() : null,
      source: snapshot?.source ?? null,
      rows,
    };
  }

  // Desglose del solicitado de un producto por cliente. Se usa al hacer doble
  // clic en una fila de Disponibilidad. Parte de los mismos renglones activos
  // que alimentan `availability()`, así que los totales cuadran con la tabla.
  async availabilityCustomers(code: string): Promise<AvailabilityProductCustomers> {
    const product = await this.prisma.product.findUnique({ where: { externalCode: code } });
    if (!product) {
      throw new NotFoundException(`Producto ${code} no existe en el catálogo sincronizado`);
    }

    const [snapshot, lines] = await Promise.all([
      this.prisma.inventorySnapshot.findFirst({
        orderBy: { takenAt: 'desc' },
        include: { lines: { where: { productCode: code }, include: { warehouse: true } } },
      }),
      this.prisma.salesOrderLine.findMany({
        where: { productCode: code, order: { isActive: true } },
        select: {
          pendingQty: true,
          pendingKg: true,
          uom: true,
          order: {
            select: {
              externalNumber: true,
              customerCode: true,
              customerName: true,
              customer: { select: { externalCode: true, name: true } },
            },
          },
        },
      }),
    ]);

    const inventory: InventoryByWarehouse[] = (snapshot?.lines ?? []).map((line) => ({
      warehouseCode: line.warehouseCode,
      warehouseName: line.warehouse?.name ?? null,
      qty: toNumber(line.qty),
      reservedQty: toNumber(line.reservedQty),
    }));

    const demandQty = lines.reduce((acc, line) => acc + toNumber(line.pendingQty), 0);
    // Igual que Prisma.aggregate: si ningún renglón trae kg, el total es null.
    const demandKg = lines.some((line) => line.pendingKg !== null && line.pendingKg !== undefined)
      ? lines.reduce((acc, line) => acc + toNumber(line.pendingKg), 0)
      : null;
    const row = computeAvailability(this.toInput(product, inventory, { pendingQty: demandQty, pendingKg: demandKg }));
    const kgPerUom = toNumberOrNull(product.kgPerUom);

    const byCustomer = new Map<
      string,
      {
        customerCode: string;
        customerName: string;
        sacks: number;
        kg: number;
        orders: Set<string>;
      }
    >();

    for (const line of lines) {
      const customerCode = line.order.customerCode ?? line.order.customer?.externalCode ?? 'SIN_CLIENTE';
      const customerName =
        line.order.customerName ?? line.order.customer?.name ?? (customerCode === 'SIN_CLIENTE' ? 'Sin cliente' : customerCode);
      const key = customerCode;
      let entry = byCustomer.get(key);
      if (!entry) {
        entry = { customerCode, customerName, sacks: 0, kg: 0, orders: new Set<string>() };
        byCustomer.set(key, entry);
      }

      const pendingQty = toNumber(line.pendingQty);
      const pendingKg = toNumberOrNull(line.pendingKg);
      const uom = (line.uom ?? product.uom ?? '').toUpperCase();
      // SAC manda en sacos; el resto (KG y unidades no reconocidas) se lee en
      // kg y, si el artículo declara empaque, se muestra el equivalente en sacos.
      if (uom === 'SAC') {
        entry.sacks += pendingQty;
        entry.kg += pendingKg ?? (kgPerUom === null ? 0 : pendingQty * kgPerUom);
      } else {
        const lineKg = pendingKg ?? (kgPerUom === null ? pendingQty : pendingQty * kgPerUom);
        entry.kg += lineKg;
        if (kgPerUom !== null && kgPerUom > 0) entry.sacks += lineKg / kgPerUom;
      }
      entry.orders.add(line.order.externalNumber);
    }

    const customers = [...byCustomer.values()].sort(
      (a, b) => b.kg - a.kg || b.sacks - a.sacks || a.customerName.localeCompare(b.customerName, 'es'),
    );
    const totalSacks = round3(customers.reduce((acc, customer) => acc + customer.sacks, 0));
    const totalKg = round3(customers.reduce((acc, customer) => acc + customer.kg, 0));
    // La participación se mide en la unidad de venta del producto. Si no hay
    // sacos utilizables (p. ej. producto a granel), se usa kg como denominador.
    const shareInSacks = row.uom === 'SAC' && totalSacks > 0;

    return {
      productCode: row.productCode,
      description: row.description,
      uom: row.uom,
      kgPerUom: row.kgPerUom,
      stockTotal: row.stockTotal,
      demandQty: row.demandQty,
      demandKg: row.demandKg,
      totalSacks,
      totalKg,
      customers: customers.map((customer) => {
        const base = shareInSacks ? customer.sacks : customer.kg;
        const total = shareInSacks ? totalSacks : totalKg;
        return {
          customerCode: customer.customerCode,
          customerName: customer.customerName,
          ordersCount: customer.orders.size,
          sacks: round3(customer.sacks),
          kg: round3(customer.kg),
          sharePct: total > 0 ? round3((base / total) * 100) : 0,
        };
      }),
    };
  }

  async latestSnapshotSummary(): Promise<InventorySnapshotSummary | null> {
    const snapshot = await this.prisma.inventorySnapshot.findFirst({
      orderBy: { takenAt: 'desc' },
      include: { _count: { select: { lines: true } } },
    });
    if (!snapshot) return null;
    return {
      id: snapshot.id,
      takenAt: snapshot.takenAt.toISOString(),
      source: snapshot.source,
      runId: snapshot.runId,
      linesCount: snapshot._count.lines,
    };
  }

  // ---------- carga interna ----------

  private latestSnapshot() {
    return this.prisma.inventorySnapshot.findFirst({
      orderBy: { takenAt: 'desc' },
      include: { lines: { include: { warehouse: true } } },
    });
  }

  private async demandByProduct(productCode: string) {
    const agg = await this.prisma.salesOrderLine.aggregate({
      where: { productCode, order: { isActive: true } },
      _sum: { pendingQty: true, pendingKg: true },
    });
    return {
      pendingQty: toNumber(agg._sum.pendingQty),
      pendingKg: toNumberOrNull(agg._sum.pendingKg),
    };
  }

  private async allDemands(): Promise<Map<string, { pendingQty: number; pendingKg: number | null }>> {
    const grouped = await this.prisma.salesOrderLine.groupBy({
      by: ['productCode'],
      where: { order: { isActive: true } },
      _sum: { pendingQty: true, pendingKg: true },
    });
    return new Map(
      grouped.map((g) => [
        g.productCode,
        { pendingQty: toNumber(g._sum.pendingQty), pendingKg: toNumberOrNull(g._sum.pendingKg) },
      ]),
    );
  }

  private toInput(
    product: { externalCode: string; description: string; uom: string; kgPerUom: unknown },
    stockByWarehouse: InventoryByWarehouse[],
    demand: { pendingQty: number; pendingKg: number | null },
  ): AvailabilityInput {
    return {
      productCode: product.externalCode,
      description: product.description,
      uom: product.uom,
      kgPerUom: toNumberOrNull(product.kgPerUom),
      stockByWarehouse,
      demandQty: demand.pendingQty,
      demandKg: demand.pendingKg,
    };
  }

  private toProduct(p: {
    id: string;
    externalCode: string;
    description: string;
    uom: string;
    family: string | null;
    kgPerUom: unknown;
    isActive: boolean;
    lastSyncedAt: Date;
  }): Product {
    return {
      id: p.id,
      externalCode: p.externalCode,
      description: p.description,
      uom: p.uom,
      family: p.family,
      kgPerUom: toNumberOrNull(p.kgPerUom),
      isActive: p.isActive,
      lastSyncedAt: p.lastSyncedAt.toISOString(),
    };
  }
}
