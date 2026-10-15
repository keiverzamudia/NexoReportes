import { Injectable, NotFoundException } from '@nestjs/common';
import {
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
