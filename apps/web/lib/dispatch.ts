// ============================================================
// Motor PURO de despacho (sin React ni red).
//
// Construye la "cola de despacho": dado el stock por producto y lo que el
// usuario ya marcó como despachado, decide en orden de prioridad qué se
// puede entregar realmente y en qué orden mostrarlo.
//
//   modo 'disponible' → asigna solo la existencia; el resto es faltante.
//   modo 'total'      → asigna todo lo pedido (puede sobregirar el stock).
//
// Prioridad: fecha de entrega más próxima y, a igual fecha, mayor existencia.
// Al marcar un renglón se descuenta el stock y la cola se recalcula: si el
// que era 2º se queda sin existencia, baja y entra otro que sí la tiene.
//
// La vista muestra: marcados fijos en su sitio, luego los despachables en
// turno y al final los que quedaron sin existencia.
// ============================================================

export type DispatchMode = 'disponible' | 'total';
export type DispatchSort = 'prioridad' | 'disponibilidad' | 'pendiente';

export interface DispatchInput {
  key: string;
  productCode: string;
  pendingQty: number;
  pendingKg: number | null;
  requestedDate: string | null;
  orderNumber: string;
  customerName: string | null;
  stockTotal: number;
}

export interface QueueEntry {
  key: string;
  selected: boolean;
  pendingQty: number;
  pendingKg: number | null;
  // Despacho calculado con el stock VIVO (ya descontado lo marcado).
  assignedQty: number;
  missingQty: number;
  assignedKg: number;
  missingKg: number;
  // assignedQty > 0 → se puede entregar (total o parcial).
  dispatchable: boolean;
  // Existencia del producto tras asignar este renglón (puede ser negativa).
  productRemaining: number;
  // Turno dentro de su grupo (marcados / no marcados). 1 = primero.
  priority: number;
  // Posición final en la vista.
  sortIndex: number;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function timeOf(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY; // sin fecha = al final
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function kgPerUnit(line: DispatchInput): number | null {
  if (line.pendingKg === null || line.pendingQty === 0) return null;
  return line.pendingKg / line.pendingQty;
}

function compare(sort: DispatchSort) {
  return (a: DispatchInput, b: DispatchInput): number => {
    if (sort === 'pendiente') return b.pendingQty - a.pendingQty;
    if (sort === 'disponibilidad') {
      if (b.stockTotal !== a.stockTotal) return b.stockTotal - a.stockTotal;
      return timeOf(a.requestedDate) - timeOf(b.requestedDate);
    }
    // 'prioridad': entrega más próxima primero; a igual fecha, más existencia.
    const byDate = timeOf(a.requestedDate) - timeOf(b.requestedDate);
    if (byDate !== 0) return byDate;
    if (b.stockTotal !== a.stockTotal) return b.stockTotal - a.stockTotal;
    return b.pendingQty - a.pendingQty;
  };
}

// Asigna stock (mutando `remaining`) a un conjunto de líneas en orden de prioridad.
function allocate(
  lines: DispatchInput[],
  remaining: Map<string, number>,
  mode: DispatchMode,
  sort: DispatchSort,
): Map<string, { assigned: number; missing: number; after: number }> {
  const ordered = [...lines].sort(compare(sort));
  const out = new Map<string, { assigned: number; missing: number; after: number }>();
  for (const line of ordered) {
    const left = remaining.get(line.productCode) ?? 0;
    const assigned = mode === 'disponible' ? Math.max(0, Math.min(left, line.pendingQty)) : line.pendingQty;
    remaining.set(line.productCode, left - assigned);
    out.set(line.key, { assigned, missing: line.pendingQty - assigned, after: left - assigned });
  }
  return out;
}

export function buildDispatchQueue(
  inputs: DispatchInput[],
  selectedKeys: string[],
  mode: DispatchMode,
  sort: DispatchSort,
): QueueEntry[] {
  const selectedSet = new Set(selectedKeys);
  const selected = inputs.filter((l) => selectedSet.has(l.key));
  const unselected = inputs.filter((l) => !selectedSet.has(l.key));

  // Existencia inicial por producto.
  const remaining = new Map<string, number>();
  for (const line of inputs) {
    if (!remaining.has(line.productCode)) remaining.set(line.productCode, line.stockTotal);
  }

  // 1) Los marcados consumen primero; 2) el resto compite por lo que quede.
  const selectedAlloc = allocate(selected, remaining, mode, sort);
  const unselectedAlloc = allocate(unselected, remaining, mode, sort);

  const selectedPriority = new Map<string, number>();
  [...selected]
    .sort(compare(sort))
    .forEach((l, i) => selectedPriority.set(l.key, i + 1));

  const origIndex = new Map(inputs.map((l, i) => [l.key, i]));

  // No marcados: primero los despachables (turno por entrega), después los sin existencia.
  const unselectedOrdered = [...unselected].sort((a, b) => {
    const da = (unselectedAlloc.get(a.key)?.assigned ?? 0) > 0 ? 0 : 1;
    const db = (unselectedAlloc.get(b.key)?.assigned ?? 0) > 0 ? 0 : 1;
    if (da !== db) return da - db;
    const byDate = timeOf(a.requestedDate) - timeOf(b.requestedDate);
    if (byDate !== 0) return byDate;
    if (b.stockTotal !== a.stockTotal) return b.stockTotal - a.stockTotal;
    return a.key.localeCompare(b.key);
  });
  const unselectedPriority = new Map<string, number>();
  unselectedOrdered.forEach((l, i) => unselectedPriority.set(l.key, i + 1));

  // Vista: los marcados quedan FIJOS en su posición original; los demás llenan el resto.
  const fixedByIndex = new Map<number, DispatchInput>();
  for (const line of selected) {
    const i = origIndex.get(line.key);
    if (i !== undefined) fixedByIndex.set(i, line);
  }
  const orderedSlots: DispatchInput[] = [];
  let cursor = 0;
  for (let i = 0; i < inputs.length; i += 1) {
    const fixed = fixedByIndex.get(i);
    if (fixed) {
      orderedSlots.push(fixed);
      continue;
    }
    const next = unselectedOrdered[cursor];
    cursor += 1;
    if (next) orderedSlots.push(next);
  }

  return orderedSlots.map((l, index) => {
    const isSel = selectedSet.has(l.key);
    const alloc = isSel ? selectedAlloc.get(l.key) : unselectedAlloc.get(l.key);
    const assigned = alloc?.assigned ?? 0;
    const missing = alloc?.missing ?? l.pendingQty;
    const after = alloc?.after ?? (remaining.get(l.productCode) ?? 0);
    const kpu = kgPerUnit(l);
    return {
      key: l.key,
      selected: isSel,
      pendingQty: l.pendingQty,
      pendingKg: l.pendingKg,
      assignedQty: round3(assigned),
      missingQty: round3(missing),
      assignedKg: kpu === null ? 0 : round3(assigned * kpu),
      missingKg: kpu === null ? 0 : round3(missing * kpu),
      dispatchable: assigned > 0,
      productRemaining: round3(after),
      priority: isSel ? (selectedPriority.get(l.key) ?? 0) : (unselectedPriority.get(l.key) ?? 0),
      sortIndex: index,
    };
  });
}

// Resumen agregado (KPIs y gráficas).
export interface DispatchSummary {
  lines: number;
  pendingQty: number;
  pendingKg: number;
  assignedQty: number;
  missingQty: number;
  assignedKg: number;
  missingKg: number;
  coverage: number;
}

export function summarizeQueue(entries: QueueEntry[]): DispatchSummary {
  let pendingQty = 0;
  let pendingKg = 0;
  let assignedQty = 0;
  let missingQty = 0;
  let assignedKg = 0;
  let missingKg = 0;
  for (const e of entries) {
    pendingQty += e.pendingQty;
    pendingKg += e.pendingKg ?? 0;
    assignedQty += e.assignedQty;
    missingQty += e.missingQty;
    assignedKg += e.assignedKg;
    missingKg += e.missingKg;
  }
  return {
    lines: entries.length,
    pendingQty: round3(pendingQty),
    pendingKg: round3(pendingKg),
    assignedQty: round3(assignedQty),
    missingQty: round3(missingQty),
    assignedKg: round3(assignedKg),
    missingKg: round3(missingKg),
    coverage: pendingQty > 0 ? assignedQty / pendingQty : 1,
  };
}
