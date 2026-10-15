// ============================================================
// Motor PURO de simulación de despacho (sin React ni red).
//
// Recibe los renglones candidatos y el stock por producto y decide,
// en orden de prioridad, qué se puede despachar realmente:
//
//   modo 'disponible' → asigna solo lo que hay en existencia; el resto
//                       queda como faltante (despacho "tipo real").
//   modo 'total'      → asigna todo lo pedido; el stock proyectado puede
//                       quedar negativo (sobre-compromiso).
//
// Prioridad por defecto: fecha de entrega más próxima primero y, a igual
// fecha, el producto con más existencia disponible.
// ============================================================

export type DispatchMode = 'disponible' | 'total';
export type DispatchSort = 'prioridad' | 'disponibilidad' | 'pendiente';

export interface DispatchInput {
  key: string;
  productCode: string;
  pendingQty: number;
  pendingKg: number | null;
  // Fecha de entrega comprometida (ISO) o null.
  requestedDate: string | null;
  orderNumber: string;
  customerName: string | null;
  // Existencia total del producto (suma de almacenes).
  stockTotal: number;
}

export interface DispatchResult {
  key: string;
  // Turno de despacho (1 = primero).
  priority: number;
  assignedQty: number;
  missingQty: number;
  assignedKg: number;
  missingKg: number;
  // Existencia del producto que queda tras asignar (puede ser negativa en 'total').
  productRemaining: number;
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
    if (sort === 'pendiente') {
      return b.pendingQty - a.pendingQty;
    }
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

export function simulateDispatch(inputs: DispatchInput[], mode: DispatchMode, sort: DispatchSort): DispatchResult[] {
  const ordered = [...inputs].sort(compare(sort));

  // Existencia viva por producto (se va descontando en orden de prioridad).
  const remaining = new Map<string, number>();
  for (const line of inputs) {
    if (!remaining.has(line.productCode)) remaining.set(line.productCode, line.stockTotal);
  }

  return ordered.map((line, index) => {
    const stockLeft = remaining.get(line.productCode) ?? 0;
    const assignedQty =
      mode === 'disponible' ? Math.max(0, Math.min(stockLeft, line.pendingQty)) : line.pendingQty;
    const missingQty = line.pendingQty - assignedQty;
    remaining.set(line.productCode, stockLeft - assignedQty);

    const kpu = kgPerUnit(line);
    return {
      key: line.key,
      priority: index + 1,
      assignedQty: round3(assignedQty),
      missingQty: round3(missingQty),
      assignedKg: kpu === null ? 0 : round3(assignedQty * kpu),
      missingKg: kpu === null ? 0 : round3(missingQty * kpu),
      productRemaining: round3(stockLeft - assignedQty),
    };
  });
}

// Resumen agregado de una simulación (para KPIs y gráficas).
export interface DispatchSummary {
  lines: number;
  pendingQty: number;
  pendingKg: number;
  assignedQty: number;
  missingQty: number;
  assignedKg: number;
  missingKg: number;
  // 0..1 (1 = todo despachable con el stock actual).
  coverage: number;
}

export function summarize(inputs: DispatchInput[], results: DispatchResult[]): DispatchSummary {
  const byKey = new Map(results.map((r) => [r.key, r]));
  let pendingQty = 0;
  let pendingKg = 0;
  let assignedQty = 0;
  let missingQty = 0;
  let assignedKg = 0;
  let missingKg = 0;
  for (const line of inputs) {
    const r = byKey.get(line.key);
    if (!r) continue;
    pendingQty += line.pendingQty;
    pendingKg += line.pendingKg ?? 0;
    assignedQty += r.assignedQty;
    missingQty += r.missingQty;
    assignedKg += r.assignedKg;
    missingKg += r.missingKg;
  }
  return {
    lines: inputs.length,
    pendingQty: round3(pendingQty),
    pendingKg: round3(pendingKg),
    assignedQty: round3(assignedQty),
    missingQty: round3(missingQty),
    assignedKg: round3(assignedKg),
    missingKg: round3(missingKg),
    coverage: pendingQty > 0 ? assignedQty / pendingQty : 1,
  };
}
