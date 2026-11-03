import {
  DraftAssignment,
  DraftFreeStock,
  OrderGroupLine,
  ScenarioLineRef,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';

// ============================================================
// Plan vivo compartido: resuelve los renglones marcados por el equipo contra
// la cartera real y reparte la existencia EN ORDEN DE MARCADO (el primero
// gana). Es la misma regla que aplica el motor del web para los renglones
// seleccionados, pero calculada una sola vez en el servidor para que las tres
// pantallas vean el mismo 30/20 aunque cada vendedora filtre clientes distintos.
//
// No escribe en Profit: solo lee pedidos y la última foto de existencias.
// ============================================================

const STOCK_WAREHOUSES = ['Stock 03', 'Stock 9999', 'Stock 68'];

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function draftLineKey(ref: { orderNumber: string; productCode: string }): string {
  return `${ref.orderNumber}#${ref.productCode}`;
}

function markTime(ref: ScenarioLineRef): number {
  if (!ref.selectedAt) return 0;
  const parsed = Date.parse(ref.selectedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export interface DraftPlan {
  /** Renglones resueltos, en el mismo orden de marcado del plan. */
  lines: OrderGroupLine[];
  assignments: DraftAssignment[];
  freeByProduct: DraftFreeStock[];
  /** Refs que ya no están en la cartera (pedido cerrado o línea eliminada). */
  missingRefs: ScenarioLineRef[];
}

export async function buildDraftPlan(
  prisma: PrismaService,
  refs: ScenarioLineRef[],
): Promise<DraftPlan> {
  const unique: ScenarioLineRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = draftLineKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  if (unique.length === 0) {
    return { lines: [], assignments: [], freeByProduct: [], missingRefs: [] };
  }

  const orderNumbers = [...new Set(unique.map((ref) => ref.orderNumber))];
  const productCodes = [...new Set(unique.map((ref) => ref.productCode))];

  const [rows, snapshot, overrides] = await Promise.all([
    prisma.salesOrderLine.findMany({
      where: {
        order: { externalNumber: { in: orderNumbers } },
        productCode: { in: productCodes },
      },
      include: { order: true },
    }),
    prisma.inventorySnapshot.findFirst({
      orderBy: { takenAt: 'desc' },
      include: {
        lines: {
          where: {
            productCode: { in: productCodes },
            warehouseCode: { in: STOCK_WAREHOUSES },
          },
        },
      },
    }),
    prisma.deliveryDateOverride.findMany({
      where: {
        orderNumber: { in: orderNumbers },
        productCode: { in: productCodes },
      },
      select: { orderNumber: true, productCode: true, tentativeDate: true },
    }),
  ]);

  const tentativeByKey = new Map<string, string>();
  for (const item of overrides) {
    tentativeByKey.set(
      draftLineKey({ orderNumber: item.orderNumber, productCode: item.productCode }),
      item.tentativeDate.toISOString(),
    );
  }

  const byKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    byKey.set(draftLineKey({ orderNumber: row.order.externalNumber, productCode: row.productCode }), row);
  }

  const stock = new Map<string, number>();
  for (const line of snapshot?.lines ?? []) {
    stock.set(line.productCode, round3((stock.get(line.productCode) ?? 0) + toNumber(line.qty)));
  }

  const remaining = new Map(stock);
  const lines: OrderGroupLine[] = [];
  const assignments: DraftAssignment[] = [];
  const missingRefs: ScenarioLineRef[] = [];

  // Orden de marcado (FIFO). Los refs históricos sin `selectedAt` van primero
  // para no quitarle lo suyo a quien ya estaba en el plan.
  const ordered = unique
    .map((ref, index) => ({ ref, index, at: markTime(ref) }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at));

  for (const { ref } of ordered) {
    const row = byKey.get(draftLineKey(ref));
    if (!row) {
      missingRefs.push(ref);
      continue;
    }

    const pendingQty = round3(toNumber(row.pendingQty));
    const pendingKg = toNumberOrNull(row.pendingKg);
    const kgPerUnit = pendingKg === null || pendingQty === 0 ? null : pendingKg / pendingQty;
    const stockTotal = round3(stock.get(ref.productCode) ?? 0);
    const free = remaining.get(ref.productCode) ?? stockTotal;
    // El plan del equipo SIEMPRE reserva en modo disponible: nunca promete
    // existencia que no existe. El modo «solicitado total» es solo análisis.
    const assignedQty = round3(Math.max(0, Math.min(free, pendingQty)));
    const freeAfter = round3(free - assignedQty);
    remaining.set(ref.productCode, freeAfter);
    const missingQty = round3(pendingQty - assignedQty);

    lines.push({
      orderId: row.orderId,
      orderNumber: row.order.externalNumber,
      customerCode: row.order.customerCode,
      customerName: row.order.customerName,
      requestedDate: row.order.requestedDate ? row.order.requestedDate.toISOString() : null,
      tentativeDate: tentativeByKey.get(draftLineKey(ref)) ?? null,
      authorized: row.order.authorized,
      productCode: row.productCode,
      description: row.description,
      uom: row.uom,
      quantity: toNumberOrNull(row.quantity),
      pendingQty,
      pendingKg,
      warehouseCode: row.warehouses,
      stock03: null,
      stock9999: null,
      stock68: null,
    });

    assignments.push({
      orderNumber: row.order.externalNumber,
      productCode: row.productCode,
      assignedQty,
      assignedKg: kgPerUnit === null ? 0 : round3(assignedQty * kgPerUnit),
      missingQty,
      missingKg: kgPerUnit === null ? 0 : round3(missingQty * kgPerUnit),
      stockTotal,
      freeAfter,
    });
  }

  const freeByProduct: DraftFreeStock[] = [...stock.entries()]
    .map(([productCode, total]) => {
      const free = round3(Math.max(0, remaining.get(productCode) ?? total));
      return {
        productCode,
        stock: total,
        committed: round3(total - free),
        free,
      };
    })
    .sort((a, b) => a.productCode.localeCompare(b.productCode));

  return { lines, assignments, freeByProduct, missingRefs };
}
