import type {
  DispatchRemovalLine,
  DispatchRemovalOrder,
  DispatchRemovalSheet,
  DispatchRemovalsResponse,
  DispatchSheetStatus,
} from '@nexo/contracts';

// ============================================================
// Retiros de simulación: agrupación pura (sin Prisma ni red).
//
// El servicio entrega los renglones ANULADOS de las hojas visibles; aquí se
// agrupan por pedido para que la pantalla responda «qué pedidos se cayeron,
// por qué motivo y en qué despachos». Un pedido puede tener varios motivos
// (p. ej. una parte retirada a mano y otra cerrada por Profit) y puede
// aparecer en más de una hoja.
// ============================================================

export interface RemovalLineRow {
  id: string;
  sheetId: string;
  orderNumber: string;
  productCode: string;
  description: string | null;
  uom: string | null;
  customerCode: string | null;
  customerName: string | null;
  plannedQty: unknown;
  plannedKg: unknown;
  removalReason: string | null;
  removedAt: Date | null;
  removedByName: string | null;
  sheet: {
    id: string;
    number: string;
    status: string;
  };
}

const SIN_PEDIDO = 'SIN_PEDIDO';
const KNOWN_REASONS = ['RETIRADO_DEL_PLAN', 'PEDIDO_ANULADO_EN_PROFIT', 'PEDIDO_CERRADO_EN_PROFIT'];

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function orderKey(row: RemovalLineRow): string {
  return row.orderNumber?.trim() || SIN_PEDIDO;
}

function byNewestRemoval(a: { removedAt: Date | null }, b: { removedAt: Date | null }): number {
  const left = a.removedAt?.getTime() ?? 0;
  const right = b.removedAt?.getTime() ?? 0;
  return right - left;
}

export function buildDispatchRemovals(
  rows: RemovalLineRow[],
  generatedAt: Date = new Date(),
): DispatchRemovalsResponse {
  const groups = new Map<
    string,
    {
      orderNumber: string;
      customerCode: string | null;
      customerName: string | null;
      sheets: Map<string, DispatchRemovalSheet>;
      lines: RemovalLineRow[];
      reasons: Set<string>;
      removedByNames: Set<string>;
      plannedKg: number;
      removedAt: Date | null;
    }
  >();

  for (const row of rows) {
    const key = orderKey(row);
    let group = groups.get(key);
    if (!group) {
      group = {
        orderNumber: key === SIN_PEDIDO ? '' : key,
        customerCode: row.customerCode ?? null,
        customerName: row.customerName ?? null,
        sheets: new Map(),
        lines: [],
        reasons: new Set(),
        removedByNames: new Set(),
        plannedKg: 0,
        removedAt: null,
      };
      groups.set(key, group);
    }

    // El cliente del pedido debe ser el mismo en todos sus renglones; si el
    // primero venía vacío, se completa con el siguiente que sí lo traiga.
    group.customerCode ??= row.customerCode ?? null;
    group.customerName ??= row.customerName ?? null;

    group.sheets.set(row.sheet.id, {
      id: row.sheet.id,
      number: row.sheet.number,
      status: row.sheet.status as DispatchSheetStatus,
    });
    group.lines.push(row);
    group.plannedKg += toNumber(row.plannedKg);
    if (row.removalReason) group.reasons.add(row.removalReason);
    if (row.removedByName) group.removedByNames.add(row.removedByName);
    if (!group.removedAt || (row.removedAt && row.removedAt > group.removedAt)) {
      group.removedAt = row.removedAt ?? group.removedAt;
    }
  }

  const orders: DispatchRemovalOrder[] = [...groups.values()]
    .map((group) => {
      const lines: DispatchRemovalLine[] = [...group.lines]
        .sort((a, b) => {
          const byDate = byNewestRemoval(a, b);
          return byDate !== 0 ? byDate : a.productCode.localeCompare(b.productCode, 'es');
        })
        .map((row) => ({
          id: row.id,
          sheetId: row.sheetId,
          sheetNumber: row.sheet.number,
          orderNumber: row.orderNumber?.trim() || '',
          productCode: row.productCode,
          description: row.description ?? null,
          uom: row.uom ?? null,
          plannedQty: toNumber(row.plannedQty),
          plannedKg: toNumber(row.plannedKg),
          removalReason: row.removalReason ?? null,
          removedAt: row.removedAt ? row.removedAt.toISOString() : null,
          removedByName: row.removedByName ?? null,
        }));

      const sheets = [...group.sheets.values()].sort((a, b) => a.number.localeCompare(b.number, 'es'));
      const reasons = [...group.reasons].sort((a, b) => a.localeCompare(b, 'es'));

      return {
        orderNumber: group.orderNumber,
        customerCode: group.customerCode,
        customerName: group.customerName,
        sheets,
        linesCount: lines.length,
        plannedKg: round2(group.plannedKg),
        reasons,
        removedAt: group.removedAt ? group.removedAt.toISOString() : null,
        removedByNames: [...group.removedByNames].sort((a, b) => a.localeCompare(b, 'es')),
        lines,
      };
    })
    .sort((a, b) => {
      const byDate = (b.removedAt ?? '').localeCompare(a.removedAt ?? '');
      if (byDate !== 0) return byDate;
      return a.orderNumber.localeCompare(b.orderNumber, 'es');
    });

  const byReason: Record<string, number> = Object.fromEntries(KNOWN_REASONS.map((reason) => [reason, 0]));
  for (const row of rows) {
    const reason = row.removalReason ?? 'SIN_MOTIVO';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }

  return {
    orders,
    totals: {
      orders: orders.length,
      lines: rows.length,
      plannedKg: round2(orders.reduce((sum, order) => sum + order.plannedKg, 0)),
      byReason,
    },
    generatedAt: generatedAt.toISOString(),
  };
}
