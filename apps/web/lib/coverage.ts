// ============================================================
// Filas de la gráfica «Cobertura por producto».
//
// El eje Y de ECharts es de categoría. Cuando las etiquetas no caben,
// ECharts las oculta de forma alterna (`axisLabel.interval: 'auto'`), que
// se veía como «un código sí y uno no». Por eso:
//   · la altura se calcula con la cantidad de filas, y
//   · la página fuerza `interval: 0`.
//
// Se muestran los 12 productos de mayor volumen y el resto se agrega en
// «Otros (N)» para no perder kg del total de la demanda.
// ============================================================

export interface CoverageProduct {
  code: string;
  description: string;
  /** Existencia física combinada (Stock 03 + 9999 + 68). */
  stockUnits: number;
  /** Demanda pendiente en unidades. */
  demandUnits: number;
  /** Demanda pendiente en kg. */
  demandKg: number;
}

export interface CoverageCommitted {
  code: string;
  /** Unidades ya comprometidas por renglones marcados. */
  units: number;
  /** Pendiente de esos mismos renglones marcados. */
  pending: number;
}

export interface CoverageRow {
  code: string;
  description: string;
  /** `others` = fila agregada de los productos fuera del top; `product` = producto real. */
  kind: 'product' | 'others';
  committedKg: number;
  availableKg: number;
  missingKg: number;
  totalKg: number;
  /** (comprometido + cubrible) / demanda, 0–100. */
  coveragePct: number;
}

export interface CoverageSummary {
  /** Productos cuya demanda cabe completa en la existencia libre. */
  sufficient: number;
  /** Productos con alguna parte cubierta y otra faltante. */
  partial: number;
  /** Productos sin existencia para cubrir nada. */
  none: number;
}

export interface CoverageData {
  /** Orden de pintado: el primer elemento queda ABAJO en el eje Y. */
  rows: CoverageRow[];
  /**
   * Productos reales agregados en la fila «Otros», de mayor a menor kg.
   * Permite abrir el detalle sin recalcular nada en la vista.
   */
  omitted: CoverageRow[];
  totalProducts: number;
  omittedProducts: number;
  summary: CoverageSummary;
}

const TOP_PRODUCTS = 12;
const ROW_HEIGHT = 22;
const CHART_CHROME = 56;
const MIN_CHART_HEIGHT = 220;

/**
 * Altura del gráfico para que quepan todas las etiquetas del eje Y.
 * 12 filas → 320 px; 13 filas (con «Otros») → 342 px.
 */
export function coverageChartHeight(rowCount: number): number {
  return Math.max(MIN_CHART_HEIGHT, rowCount * ROW_HEIGHT + CHART_CHROME);
}

function displayCode(code: string, description: string): string {
  return code.trim() || description.trim() || 'S/C';
}

function buildRow(product: CoverageProduct, committed: CoverageCommitted | undefined): CoverageRow {
  // kg por unidad: se deriva de la demanda real (pendingKg / pendingQty) para
  // que los kg del gráfico cuadren con los totales de la pantalla. Si el
  // producto no trae kg, la fila queda en 0 y se filtra abajo.
  const kgPerUnit = product.demandUnits !== 0 ? product.demandKg / product.demandUnits : 0;
  const units = committed?.units ?? 0;
  const pending = committed?.pending ?? 0;

  // Existencia libre = existencia − comprometido. Con ella se cubre lo que
  // todavía no se ha marcado.
  const freeStock = Math.max(0, product.stockUnits - units);
  const unmarkedDemand = Math.max(0, product.demandUnits - pending);
  const available = Math.min(freeStock, unmarkedDemand);
  // Faltante = solicitado que no está comprometido ni se puede cubrir.
  const missing = Math.max(0, product.demandUnits - units - available);

  const committedKg = Math.round(units * kgPerUnit);
  const availableKg = Math.round(available * kgPerUnit);
  const missingKg = Math.round(missing * kgPerUnit);
  const totalKg = committedKg + availableKg + missingKg;

  return {
    code: displayCode(product.code, product.description),
    description: product.description.trim() || displayCode(product.code, product.description),
    kind: 'product',
    committedKg,
    availableKg,
    missingKg,
    totalKg,
    coveragePct: totalKg > 0 ? Math.round(((committedKg + availableKg) / totalKg) * 100) : 100,
  };
}

function summarize(rows: CoverageRow[]): CoverageSummary {
  let sufficient = 0;
  let partial = 0;
  let none = 0;
  for (const row of rows) {
    if (row.missingKg <= 0) sufficient += 1;
    else if (row.committedKg + row.availableKg > 0) partial += 1;
    else none += 1;
  }
  return { sufficient, partial, none };
}

export function buildCoverageRows(
  products: CoverageProduct[],
  committed: CoverageCommitted[],
  topProducts = TOP_PRODUCTS,
): CoverageData {
  const committedByCode = new Map(committed.map((item) => [item.code, item]));

  const all = products
    .map((product) => buildRow(product, committedByCode.get(product.code)))
    .filter((row) => row.totalKg > 0)
    .sort((a, b) => b.totalKg - a.totalKg);

  const top = all.slice(0, topProducts);
  const rest = all.slice(topProducts);
  let display = top;

  if (rest.length > 0) {
    const totalKg = rest.reduce((sum, row) => sum + row.totalKg, 0);
    const committedKg = rest.reduce((sum, row) => sum + row.committedKg, 0);
    const availableKg = rest.reduce((sum, row) => sum + row.availableKg, 0);
    const missingKg = rest.reduce((sum, row) => sum + row.missingKg, 0);
    const others: CoverageRow = {
      code: `Otros (${rest.length})`,
      description: `${rest.length} productos con menor volumen`,
      kind: 'others',
      committedKg,
      availableKg,
      missingKg,
      totalKg,
      coveragePct: totalKg > 0 ? Math.round(((committedKg + availableKg) / totalKg) * 100) : 100,
    };
    // «Otros» se coloca según su volumen, no siempre al final.
    display = [...top, others].sort((a, b) => b.totalKg - a.totalKg);
  }

  return {
    // ECharts pinta el índice 0 abajo: se invierte para que el mayor quede arriba.
    rows: [...display].reverse(),
    // `rest` ya viene ordenado de mayor a menor: es el detalle de «Otros».
    omitted: rest,
    totalProducts: all.length,
    omittedProducts: rest.length,
    summary: summarize(all),
  };
}
