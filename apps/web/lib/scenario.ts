'use client';

// ============================================================
// Escenarios del simulador: receta + foto + diff.
//
// Motor PURO (sin React ni red). Un escenario guardado no es «la lista de
// checks»: es la RECETA (agrupación, modo, orden, filtros y renglones) más
// una FOTO de los totales del momento. Al restaurar se vuelve a ejecutar el
// motor de despacho con los datos de hoy; la foto solo sirve para mostrar
// qué cambió y para el detalle congelado.
//
// Los renglones se identifican por `pedido#artículo` (no por el id interno),
// igual que la capa de fecha tentativa: es legible y sobrevive a la sync.
// ============================================================

import type {
  OrderGroup,
  OrderGroupBy,
  OrderGroupLine,
  OrderStatus,
  ScenarioFilters,
  ScenarioLineRef,
  ScenarioRecipe,
  ScenarioRestoreLog,
  ScenarioSnapshot,
  ScenarioSnapshotLine,
  ScenarioTotals,
} from '@nexo/contracts';
import type { DispatchInput, DispatchMode, DispatchSort, QueueEntry } from './dispatch';
import { formatNumber, relativeTime } from './dispatch-sheet';

export function scenarioRefKey(orderNumber: string, productCode: string): string {
  return `${orderNumber}#${productCode}`;
}

// Misma clave que usa la página para la selección (id de pedido + artículo).
export function lineKeyOf(line: { orderId: string; productCode: string }): string {
  return `${line.orderId}#${line.productCode}`;
}

export interface ScenarioStateInput {
  by: OrderGroupBy;
  mode: DispatchMode;
  sort: DispatchSort;
  q: string;
  status: OrderStatus | '';
  customerType: string;
  vendor: string;
  authorized: 'SI' | 'NO' | '';
  customerCode: string;
  emisionDesde: string;
  emisionHasta: string;
  entregaDesde: string;
  entregaHasta: string;
}

export function recipeFromState(state: ScenarioStateInput): ScenarioRecipe {
  return {
    by: state.by,
    mode: state.mode,
    sort: state.sort,
    filters: {
      q: state.q,
      status: state.status,
      customerType: state.customerType,
      vendor: state.vendor,
      authorized: state.authorized,
      customerCode: state.customerCode,
      emisionDesde: state.emisionDesde,
      emisionHasta: state.emisionHasta,
      entregaDesde: state.entregaDesde,
      entregaHasta: state.entregaHasta,
    } satisfies ScenarioFilters,
  };
}

// Query string de /orders/grouped para una receta (se usa al previsualizar
// una restauración sin mover los filtros de la pantalla).
export function scenarioQueryString(recipe: ScenarioRecipe): string {
  const params = new URLSearchParams();
  const f = recipe.filters;
  params.set('by', recipe.by);
  if (f.q.trim()) params.set('q', f.q.trim());
  if (f.status) params.set('status', f.status);
  if (f.customerType.trim()) params.set('customerType', f.customerType.trim());
  if (f.vendor.trim()) params.set('vendor', f.vendor.trim());
  if (f.authorized) params.set('authorized', f.authorized);
  if (f.customerCode.trim()) params.set('customerCode', f.customerCode.trim());
  if (f.emisionDesde) params.set('emisionDesde', f.emisionDesde);
  if (f.emisionHasta) params.set('emisionHasta', f.emisionHasta);
  if (f.entregaDesde) params.set('entregaDesde', f.entregaDesde);
  if (f.entregaHasta) params.set('entregaHasta', f.entregaHasta);
  return params.toString();
}

export function toDispatchInputs(groups: OrderGroup[]): DispatchInput[] {
  return groups.flatMap((group) =>
    group.lines.map((line) => ({
      key: lineKeyOf(line),
      productCode: line.productCode,
      pendingQty: line.pendingQty,
      pendingKg: line.pendingKg,
      // La fecha efectiva manda: tentativa si existe, original si no.
      requestedDate: line.tentativeDate ?? line.requestedDate,
      orderNumber: line.orderNumber,
      customerName: line.customerName,
      stockTotal: (line.stock03 ?? 0) + (line.stock9999 ?? 0) + (line.stock68 ?? 0),
    })),
  );
}

// ---------- Refs ↔ selección ----------

// Renglones de la selección visible (para el borrador y el guardado).
export function refsFromSelection(
  keys: string[],
  lineByKey: Map<string, { line: OrderGroupLine }>,
): ScenarioLineRef[] {
  const seen = new Set<string>();
  const refs: ScenarioLineRef[] = [];
  for (const key of keys) {
    const ref = lineByKey.get(key);
    if (!ref) continue;
    const refKey = scenarioRefKey(ref.line.orderNumber, ref.line.productCode);
    if (seen.has(refKey)) continue;
    seen.add(refKey);
    refs.push({ orderNumber: ref.line.orderNumber, productCode: ref.line.productCode });
  }
  return refs;
}

export interface ScenarioLiveLine {
  orderId: string;
  productCode: string;
  pendingQty: number;
  pendingKg: number | null;
  stockTotal: number;
  effectiveDate: string | null;
}

export function buildLiveLines(groups: OrderGroup[]): Map<string, ScenarioLiveLine> {
  const map = new Map<string, ScenarioLiveLine>();
  for (const group of groups) {
    for (const line of group.lines) {
      const key = scenarioRefKey(line.orderNumber, line.productCode);
      if (map.has(key)) continue;
      map.set(key, {
        orderId: line.orderId,
        productCode: line.productCode,
        pendingQty: line.pendingQty,
        pendingKg: line.pendingKg,
        stockTotal: (line.stock03 ?? 0) + (line.stock9999 ?? 0) + (line.stock68 ?? 0),
        effectiveDate: normalizeDate(line.tentativeDate ?? line.requestedDate),
      });
    }
  }
  return map;
}

// Resuelve los renglones guardados contra la cartera viva. Los que ya no
// existen (pedido cerrado/cancelado o línea eliminada) se omiten.
export function resolveSelection(selected: ScenarioLineRef[], live: Map<string, ScenarioLiveLine>): string[] {
  const keys: string[] = [];
  for (const ref of selected) {
    const line = live.get(scenarioRefKey(ref.orderNumber, ref.productCode));
    if (line) keys.push(lineKeyOf(line));
  }
  return keys;
}

// ---------- Foto ----------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

export function totalsFromLines(lines: ScenarioSnapshotLine[]): ScenarioTotals {
  let sacks = 0;
  let pendingQty = 0;
  let pendingKg = 0;
  let assignedQty = 0;
  let assignedKg = 0;
  let missingQty = 0;
  let missingKg = 0;
  for (const line of lines) {
    if (line.uom === 'SAC') sacks += line.assignedQty;
    pendingQty += line.pendingQty;
    pendingKg += line.pendingKg ?? 0;
    assignedQty += line.assignedQty;
    assignedKg += line.assignedKg;
    missingQty += line.missingQty;
    missingKg += line.missingKg;
  }
  const totalKg = assignedKg + missingKg;
  return {
    lines: lines.length,
    sacks: round2(sacks),
    pendingQty: round2(pendingQty),
    pendingKg: round2(pendingKg),
    assignedQty: round2(assignedQty),
    assignedKg: round2(assignedKg),
    missingQty: round2(missingQty),
    missingKg: round2(missingKg),
    coverage: totalKg > 0 ? assignedKg / totalKg : 1,
  };
}

export function totalsForEntries(entries: QueueEntry[], sacks: number): ScenarioTotals {
  const totals = entries.reduce(
    (acc, entry) => {
      acc.pendingQty += entry.pendingQty;
      acc.pendingKg += entry.pendingKg ?? 0;
      acc.assignedQty += entry.assignedQty;
      acc.assignedKg += entry.assignedKg;
      acc.missingQty += entry.missingQty;
      acc.missingKg += entry.missingKg;
      return acc;
    },
    { pendingQty: 0, pendingKg: 0, assignedQty: 0, assignedKg: 0, missingQty: 0, missingKg: 0 },
  );
  const totalKg = totals.assignedKg + totals.missingKg;
  return {
    lines: entries.length,
    sacks: round2(sacks),
    pendingQty: round2(totals.pendingQty),
    pendingKg: round2(totals.pendingKg),
    assignedQty: round2(totals.assignedQty),
    assignedKg: round2(totals.assignedKg),
    missingQty: round2(totals.missingQty),
    missingKg: round2(totals.missingKg),
    coverage: totalKg > 0 ? totals.assignedKg / totalKg : 1,
  };
}

export function buildSnapshot(args: {
  entries: QueueEntry[];
  lineByKey: Map<string, { line: OrderGroupLine }>;
  carteraLines: number;
  takenAt: Date;
}): ScenarioSnapshot {
  const lines: ScenarioSnapshotLine[] = [];
  for (const entry of args.entries) {
    const ref = args.lineByKey.get(entry.key);
    if (!ref) continue;
    const line = ref.line;
    lines.push({
      orderNumber: line.orderNumber,
      productCode: line.productCode,
      customerCode: line.customerCode,
      customerName: line.customerName,
      description: line.description,
      uom: line.uom,
      pendingQty: round2(entry.pendingQty),
      pendingKg: entry.pendingKg === null ? null : round2(entry.pendingKg),
      assignedQty: round2(entry.assignedQty),
      assignedKg: round2(entry.assignedKg),
      missingQty: round2(entry.missingQty),
      missingKg: round2(entry.missingKg),
      stockTotal: round2((line.stock03 ?? 0) + (line.stock9999 ?? 0) + (line.stock68 ?? 0)),
      effectiveDate: normalizeDate(line.tentativeDate ?? line.requestedDate),
      priority: entry.priority,
    });
  }
  lines.sort((a, b) => a.priority - b.priority || a.orderNumber.localeCompare(b.orderNumber));
  return {
    takenAt: args.takenAt.toISOString(),
    carteraLines: args.carteraLines,
    totals: totalsFromLines(lines),
    lines,
  };
}

// ---------- Historial de restauraciones ----------

export interface ScenarioRestoreSummary {
  restored: number;
  missing: number;
  pendingChanges: number;
  stockChanges: number;
  dateChanges: number;
  carteraBefore: number;
  carteraAfter: number;
  beforeKg: number;
  afterKg: number;
  beforeCoverage: number;
  afterCoverage: number;
}

/**
 * Resume el diff (que ya calculó el cliente) para guardarlo en el historial
 * visible del escenario. Los kg son los ASIGNADOS: es lo que lleva el plan.
 */
export function restoreSummaryFromDiff(drift: ScenarioDrift, restoredCount: number): ScenarioRestoreSummary {
  return {
    restored: restoredCount,
    missing: drift.missing.length,
    pendingChanges: drift.pendingChanges.length,
    stockChanges: drift.stockChanges.length,
    dateChanges: drift.dateChanges.length,
    carteraBefore: drift.carteraBefore,
    carteraAfter: drift.carteraAfter,
    beforeKg: Math.round(drift.before.assignedKg),
    afterKg: Math.round(drift.after.assignedKg),
    beforeCoverage: drift.before.coverage,
    afterCoverage: drift.after.coverage,
  };
}

export interface RestoreLogParts {
  when: string;
  author: string;
  lines: string;
  kg: string;
  coverage: string;
  changes: string[];
}

/** Texto de una entrada del historial de restauraciones (puro y probado). */
export function restoreLogParts(log: ScenarioRestoreLog, now: Date = new Date()): RestoreLogParts {
  const applied = log.restored + log.missing;
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const changes: string[] = [];
  if (log.missing > 0) changes.push(`${log.missing} fuera de cartera`);
  if (log.pendingChanges > 0) changes.push(`${log.pendingChanges} pendiente(s)`);
  if (log.stockChanges > 0) changes.push(`${log.stockChanges} existencia(s)`);
  if (log.dateChanges > 0) changes.push(`${log.dateChanges} fecha(s)`);
  if (log.carteraBefore !== log.carteraAfter) changes.push(`cartera ${log.carteraBefore} → ${log.carteraAfter}`);

  return {
    when: relativeTime(log.restoredAt, now),
    author: log.restoredByName ?? 'Alguien',
    lines: `${log.restored}/${applied} renglones`,
    kg: `${formatNumber(log.beforeKg)} → ${formatNumber(log.afterKg)} kg`,
    coverage: `${pct(log.beforeCoverage)} → ${pct(log.afterCoverage)}`,
    changes,
  };
}


// ---------- Diff (qué cambió desde que se guardó) ----------

export interface ScenarioDrift {
  // Renglones guardados que ya no están en la cartera activa.
  missing: ScenarioSnapshotLine[];
  pendingChanges: { line: ScenarioSnapshotLine; after: number }[];
  dateChanges: { line: ScenarioSnapshotLine; after: string | null }[];
  stockChanges: { productCode: string; description: string | null; before: number; after: number }[];
  carteraBefore: number;
  carteraAfter: number;
  before: ScenarioTotals;
  after: ScenarioTotals;
  hasChanges: boolean;
}

export function diffScenario(
  snapshot: ScenarioSnapshot | null,
  live: Map<string, ScenarioLiveLine>,
  options: { after: ScenarioTotals; carteraAfter: number },
): ScenarioDrift {
  if (!snapshot) {
    return {
      missing: [],
      pendingChanges: [],
      dateChanges: [],
      stockChanges: [],
      carteraBefore: 0,
      carteraAfter: options.carteraAfter,
      before: options.after,
      after: options.after,
      hasChanges: false,
    };
  }

  const missing: ScenarioSnapshotLine[] = [];
  const pendingChanges: ScenarioDrift['pendingChanges'] = [];
  const dateChanges: ScenarioDrift['dateChanges'] = [];
  const stock = new Map<string, { description: string | null; before: number; after: number }>();

  for (const saved of snapshot.lines) {
    const current = live.get(scenarioRefKey(saved.orderNumber, saved.productCode));
    if (!current) {
      missing.push(saved);
      continue;
    }
    if (Math.abs(current.pendingQty - saved.pendingQty) > 0.001) {
      pendingChanges.push({ line: saved, after: current.pendingQty });
    }
    if ((current.effectiveDate ?? null) !== (saved.effectiveDate ?? null)) {
      dateChanges.push({ line: saved, after: current.effectiveDate });
    }
    const entry = stock.get(saved.productCode);
    if (entry) {
      entry.after = current.stockTotal;
    } else {
      stock.set(saved.productCode, {
        description: saved.description,
        before: saved.stockTotal,
        after: current.stockTotal,
      });
    }
  }

  const stockChanges = [...stock.entries()]
    .filter(([, value]) => Math.abs(value.after - value.before) > 0.001)
    .map(([productCode, value]) => ({
      productCode,
      description: value.description,
      before: value.before,
      after: value.after,
    }));

  return {
    missing,
    pendingChanges,
    dateChanges,
    stockChanges,
    carteraBefore: snapshot.carteraLines,
    carteraAfter: options.carteraAfter,
    before: snapshot.totals,
    after: options.after,
    hasChanges:
      missing.length > 0 ||
      pendingChanges.length > 0 ||
      dateChanges.length > 0 ||
      stockChanges.length > 0 ||
      snapshot.carteraLines !== options.carteraAfter,
  };
}
