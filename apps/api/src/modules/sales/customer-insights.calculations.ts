import type {
  CustomerInsightAccount,
  CustomerInsightAlert,
  CustomerInsightCadence,
  CustomerInsightMonth,
  CustomerInsightProduct,
  CustomerInsightProductStatus,
  CustomerInsightSimilar,
  CustomerInsightTotals,
  CustomerInsightYear,
} from '@nexo/contracts';

// ============================================================
// Cálculos puros de la ficha 360 de clientes.
//
// Este módulo no conoce Nest, Prisma ni Profit: recibe filas ya normalizadas
// (volumen de notas de entrega y facturación mensual) y devuelve los agregados
// que consume el endpoint. Así las reglas de negocio se prueban sin base.
//
// Reglas:
//  · Volumen = notas de entrega (`not_ent` + `reng_nde`).
//  · Sacos = renglones con unidad de venta SAC; toneladas = kg / 1000.
//  · Facturación = `docum_cc` (FACT + N/DB − N/CR) en la moneda elegida.
//  · Ventana actual = últimos 12 meses; anteriores = los 12 previos.
//  · Producto PERDIDO = 0 t en la ventana actual y > 0 t en la anterior.
// ============================================================

export interface InsightVolumeRow {
  /** yyyy-MM */
  month: string;
  year: number;
  /** Número de nota de entrega: sirve para contar notas distintas. */
  note: string;
  productCode: string;
  description: string | null;
  uom: string | null;
  kgPerUom: number | null;
  /** Unidades de venta (sacos) del renglón. */
  units: number;
  /** Kilogramos del renglón. */
  kg: number;
  /** yyyy-MM-dd (fecha de emisión de la nota). */
  date: string;
}

export interface InsightBillingRow {
  /** yyyy-MM */
  month: string;
  /** Facturado neto del mes (FACT + N/DB − N/CR). */
  billed: number;
  documents: number;
  /** Documentos sin tasa utilizable: el importe USD queda incompleto. */
  missingRate: number;
}

export interface InsightWindows {
  months: number;
  /** Primer día del histórico incluido (para @desde). */
  from: Date;
  /** Día siguiente al corte (para @hasta, exclusivo). */
  to: Date;
  historyFromKey: string;
  historyToKey: string;
  currentFromKey: string;
  currentToKey: string;
  previousFromKey: string | null;
  previousToKey: string | null;
  todayKey: string;
}

export interface BuildInsightInput {
  rows: InsightVolumeRow[];
  billingRows: InsightBillingRow[];
  billingAvailable: boolean;
  billingPartial: boolean;
  windows: InsightWindows;
  account: CustomerInsightAccount | null;
  similar: CustomerInsightSimilar[];
  truncated: boolean;
}

export interface BuildInsightResult {
  totals: CustomerInsightTotals;
  previousTotals: CustomerInsightTotals | null;
  trend: {
    volumePct: number | null;
    billingPct: number | null;
    notesPct: number | null;
  };
  monthly: CustomerInsightMonth[];
  annual: CustomerInsightYear[];
  products: CustomerInsightProduct[];
  lostProducts: CustomerInsightProduct[];
  cadence: CustomerInsightCadence;
  alerts: CustomerInsightAlert[];
}

const MIN_SIGNIFICANT_KG = 1000; // 1 t: debajo de esto no se generan alertas de producto.
const LOST_PRODUCT_LIMIT = 10;
const ALERT_LIMIT = 5;

export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

export function dateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function firstOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

/** Todas las claves yyyy-MM entre dos meses inclusive. */
export function monthRange(fromKey: string, toKey: string): string[] {
  const [fromYear, fromMonth] = fromKey.split('-').map(Number) as [number, number];
  const [toYear, toMonth] = toKey.split('-').map(Number) as [number, number];
  const out: string[] = [];
  let year = fromYear;
  let month = fromMonth;
  for (let guard = 0; guard < 600; guard += 1) {
    const key = `${year}-${pad2(month)}`;
    if (key > toKey) break;
    out.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (year > toYear + 1) break;
  }
  return out;
}

export function buildInsightWindows(months: number, now: Date = new Date()): InsightWindows {
  const currentMonth = firstOfMonth(now);
  const historyFrom = addMonths(currentMonth, -(months - 1));
  const currentFrom = addMonths(currentMonth, -11);
  const previousFrom = months >= 24 ? addMonths(currentMonth, -23) : null;
  const previousTo = months >= 24 ? addMonths(currentMonth, -12) : null;
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return {
    months,
    from: historyFrom,
    to,
    historyFromKey: monthKey(historyFrom),
    historyToKey: monthKey(currentMonth),
    currentFromKey: monthKey(currentFrom),
    currentToKey: monthKey(currentMonth),
    previousFromKey: previousFrom ? monthKey(previousFrom) : null,
    previousToKey: previousTo ? monthKey(previousTo) : null,
    todayKey: dateKey(now),
  };
}

function inKeys(month: string, fromKey: string | null, toKey: string | null): boolean {
  if (!fromKey || !toKey) return false;
  return month >= fromKey && month <= toKey;
}

function sumWindow(
  rows: InsightVolumeRow[],
  fromKey: string,
  toKey: string,
  billingByMonth: Map<string, number> | null,
): CustomerInsightTotals {
  const notes = new Set<string>();
  const products = new Set<string>();
  let sacks = 0;
  let kg = 0;
  let billed = 0;
  let billedComplete = true;
  let firstSale: string | null = null;
  let lastSale: string | null = null;

  for (const row of rows) {
    if (!inKeys(row.month, fromKey, toKey)) continue;
    notes.add(row.note);
    products.add(row.productCode);
    if ((row.uom ?? '').trim().toUpperCase() === 'SAC') sacks += row.units;
    kg += row.kg;
    if (!firstSale || row.date < firstSale) firstSale = row.date;
    if (!lastSale || row.date > lastSale) lastSale = row.date;
  }

  if (billingByMonth) {
    for (const [month, value] of billingByMonth) {
      if (!inKeys(month, fromKey, toKey)) continue;
      billed += value;
    }
  } else {
    billedComplete = false;
  }

  return {
    sacks: round2(sacks),
    kg: round2(kg),
    tonnes: round2(kg / 1000),
    notes: notes.size,
    billed: billedComplete ? round2(billed) : null,
    firstSaleDate: firstSale,
    lastSaleDate: lastSale,
    products: products.size,
  };
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round1(((current - previous) / previous) * 100);
}

interface ProductAggregate {
  code: string;
  description: string | null;
  uom: string | null;
  kgPerUom: number | null;
  currentKg: number;
  currentSacks: number;
  currentNotes: Set<string>;
  previousKg: number;
  previousSacks: number;
  previousNotes: Set<string>;
  firstSale: string | null;
  lastSale: string | null;
}

function productStatus(currentKg: number, previousKg: number): CustomerInsightProductStatus {
  if (currentKg > 0 && previousKg === 0) return 'NUEVO';
  if (currentKg === 0 && previousKg > 0) return 'PERDIDO';
  const delta = previousKg > 0 ? (currentKg - previousKg) / previousKg : 0;
  if (delta <= -0.3) return 'CAYENDO';
  if (delta >= 0.3) return 'CRECIENDO';
  return 'ESTABLE';
}

function buildProducts(
  rows: InsightVolumeRow[],
  windows: InsightWindows,
  totals: CustomerInsightTotals,
  previousTotals: CustomerInsightTotals | null,
): { products: CustomerInsightProduct[]; lostProducts: CustomerInsightProduct[] } {
  const map = new Map<string, ProductAggregate>();

  for (const row of rows) {
    if (!inKeys(row.month, windows.historyFromKey, windows.historyToKey)) continue;
    let agg = map.get(row.productCode);
    if (!agg) {
      agg = {
        code: row.productCode,
        description: row.description,
        uom: row.uom,
        kgPerUom: row.kgPerUom,
        currentKg: 0,
        currentSacks: 0,
        currentNotes: new Set(),
        previousKg: 0,
        previousSacks: 0,
        previousNotes: new Set(),
        firstSale: row.date,
        lastSale: row.date,
      };
      map.set(row.productCode, agg);
    }
    if (!agg.description && row.description) agg.description = row.description;
    if (!agg.uom && row.uom) agg.uom = row.uom;
    if (agg.kgPerUom === null && row.kgPerUom !== null) agg.kgPerUom = row.kgPerUom;
    if (!agg.firstSale || row.date < agg.firstSale) agg.firstSale = row.date;
    if (!agg.lastSale || row.date > agg.lastSale) agg.lastSale = row.date;

    if (inKeys(row.month, windows.currentFromKey, windows.currentToKey)) {
      agg.currentKg += row.kg;
      agg.currentSacks += (row.uom ?? '').trim().toUpperCase() === 'SAC' ? row.units : 0;
      agg.currentNotes.add(row.note);
    } else if (
      windows.previousFromKey &&
      windows.previousToKey &&
      inKeys(row.month, windows.previousFromKey, windows.previousToKey)
    ) {
      agg.previousKg += row.kg;
      agg.previousSacks += (row.uom ?? '').trim().toUpperCase() === 'SAC' ? row.units : 0;
      agg.previousNotes.add(row.note);
    }
  }

  const currentTotalKg = totals.kg;
  const previousTotalKg = previousTotals?.kg ?? 0;
  const currentBilled = totals.billed;
  const previousBilled = previousTotals?.billed ?? null;

  const products: CustomerInsightProduct[] = [...map.values()]
    .filter((agg) => agg.currentKg !== 0 || agg.previousKg !== 0)
    .map((agg) => {
      const currentTonnes = agg.currentKg / 1000;
      const previousTonnes = agg.previousKg / 1000;
      const currentBilledAllocated =
        currentBilled !== null && currentTotalKg > 0 ? (currentBilled * agg.currentKg) / currentTotalKg : null;
      const previousBilledAllocated =
        previousBilled !== null && previousTotalKg > 0 ? (previousBilled * agg.previousKg) / previousTotalKg : null;
      return {
        code: agg.code,
        description: agg.description,
        uom: agg.uom,
        kgPerUom: agg.kgPerUom,
        status: productStatus(agg.currentKg, agg.previousKg),
        sharePct: currentTotalKg > 0 ? round1((agg.currentKg / currentTotalKg) * 100) : 0,
        deltaPct: agg.previousKg > 0 ? round1(((agg.currentKg - agg.previousKg) / agg.previousKg) * 100) : null,
        current: {
          sacks: round2(agg.currentSacks),
          kg: round2(agg.currentKg),
          tonnes: round2(currentTonnes),
          notes: agg.currentNotes.size,
          billed: currentBilledAllocated === null ? null : round2(currentBilledAllocated),
          lastSaleDate: agg.lastSale,
        },
        previous: {
          sacks: round2(agg.previousSacks),
          kg: round2(agg.previousKg),
          tonnes: round2(previousTonnes),
          notes: agg.previousNotes.size,
          billed: previousBilledAllocated === null ? null : round2(previousBilledAllocated),
          lastSaleDate: agg.lastSale,
        },
      };
    })
    .sort((a, b) => b.current.kg - a.current.kg || b.previous.kg - a.previous.kg || a.code.localeCompare(b.code));

  const lostProducts = products
    .filter((product) => product.status === 'PERDIDO' && product.previous.kg >= MIN_SIGNIFICANT_KG)
    .sort((a, b) => b.previous.kg - a.previous.kg)
    .slice(0, LOST_PRODUCT_LIMIT);

  return { products, lostProducts };
}

function buildMonthly(
  rows: InsightVolumeRow[],
  windows: InsightWindows,
  billingByMonth: Map<string, number> | null,
): CustomerInsightMonth[] {
  const buckets = new Map<string, { sacks: number; kg: number; notes: Set<string> }>();
  for (const key of monthRange(windows.historyFromKey, windows.historyToKey)) {
    buckets.set(key, { sacks: 0, kg: 0, notes: new Set() });
  }
  for (const row of rows) {
    if (!inKeys(row.month, windows.historyFromKey, windows.historyToKey)) continue;
    const bucket = buckets.get(row.month);
    if (!bucket) continue;
    if ((row.uom ?? '').trim().toUpperCase() === 'SAC') bucket.sacks += row.units;
    bucket.kg += row.kg;
    bucket.notes.add(row.note);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => {
      // Un mes sin documentos de facturación no es «facturado 0»: es «sin
      // dato». La diferencia importa en la gráfica (corta la línea en vez de
      // dibujarla pegada al eje) y en el tooltip.
      const billed = billingByMonth?.get(month);
      return {
        month,
        sacks: round2(bucket.sacks),
        kg: round2(bucket.kg),
        tonnes: round2(bucket.kg / 1000),
        notes: bucket.notes.size,
        billed: billingByMonth ? (billed === undefined ? null : round2(billed)) : null,
      };
    });
}

function buildAnnual(
  rows: InsightVolumeRow[],
  monthly: CustomerInsightMonth[],
  billingByMonth: Map<string, number> | null,
): CustomerInsightYear[] {
  const map = new Map<
    number,
    { sacks: number; kg: number; notes: Set<string>; months: Set<string> }
  >();
  for (const item of monthly) {
    const year = Number(item.month.slice(0, 4));
    if (!map.has(year)) map.set(year, { sacks: 0, kg: 0, notes: new Set(), months: new Set() });
  }
  for (const row of rows) {
    const agg = map.get(row.year);
    if (!agg) continue;
    if ((row.uom ?? '').trim().toUpperCase() === 'SAC') agg.sacks += row.units;
    agg.kg += row.kg;
    agg.notes.add(row.note);
    agg.months.add(row.month);
  }

  return [...map.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, agg]) => {
      let billed = 0;
      if (billingByMonth) {
        for (const [month, value] of billingByMonth) {
          if (Number(month.slice(0, 4)) === year) billed += value;
        }
      }
      return {
        year,
        sacks: round2(agg.sacks),
        kg: round2(agg.kg),
        tonnes: round2(agg.kg / 1000),
        notes: agg.notes.size,
        billed: billingByMonth ? round2(billed) : null,
        monthsWithSales: agg.months.size,
      };
    });
}

function dayDiff(fromKey: string, toKey: string): number | null {
  const from = Date.parse(`${fromKey}T00:00:00.000Z`);
  const to = Date.parse(`${toKey}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function addDaysToKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return key;
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function buildCadence(
  rows: InsightVolumeRow[],
  windows: InsightWindows,
  totals: CustomerInsightTotals,
): CustomerInsightCadence {
  const allDates = [...new Set(rows.map((row) => row.date))].sort();
  const currentDates = [
    ...new Set(
      rows
        .filter((row) => inKeys(row.month, windows.currentFromKey, windows.currentToKey))
        .map((row) => row.date),
    ),
  ].sort();

  const lastSaleDate = allDates.length > 0 ? allDates[allDates.length - 1]! : null;
  const daysSinceLastSale = lastSaleDate ? dayDiff(lastSaleDate, windows.todayKey) : null;

  function averageGap(dates: string[]): number | null {
    if (dates.length < 2) return null;
    let total = 0;
    let count = 0;
    for (let i = 1; i < dates.length; i += 1) {
      const previous = dates[i - 1]!;
      const current = dates[i]!;
      const diff = dayDiff(previous, current);
      if (diff === null || diff <= 0) continue;
      total += diff;
      count += 1;
    }
    return count > 0 ? round1(total / count) : null;
  }

  const avgDaysBetweenNotes = averageGap(currentDates) ?? averageGap(allDates);

  let segment: CustomerInsightCadence['segment'] = 'ACTIVO';
  if (allDates.length === 0) segment = 'SIN_DATOS';
  else if (currentDates.length === 0) segment = 'INACTIVO';
  else if (
    daysSinceLastSale !== null &&
    avgDaysBetweenNotes !== null &&
    daysSinceLastSale > Math.max(60, avgDaysBetweenNotes * 2)
  ) {
    segment = 'EN_RIESGO';
  }

  return {
    avgDaysBetweenNotes,
    daysSinceLastSale,
    expectedNextDate:
      segment === 'INACTIVO' || segment === 'SIN_DATOS'
        ? null
        : lastSaleDate && avgDaysBetweenNotes !== null
          ? addDaysToKey(lastSaleDate, Math.max(1, Math.round(avgDaysBetweenNotes)))
          : null,
    purchasesPerMonth: round1(totals.notes / 12),
    segment,
  };
}

function moneyPerTonne(billed: number | null, tonnes: number): number | null {
  if (billed === null || tonnes <= 0) return null;
  return billed / tonnes;
}

function fmtTonnes(kg: number): string {
  return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(kg / 1000);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function buildAlerts(
  input: BuildInsightInput,
  totals: CustomerInsightTotals,
  previousTotals: CustomerInsightTotals | null,
  products: CustomerInsightProduct[],
  lostProducts: CustomerInsightProduct[],
  cadence: CustomerInsightCadence,
  trend: BuildInsightResult['trend'],
): CustomerInsightAlert[] {
  const alerts: CustomerInsightAlert[] = [];
  const lastSale = totals.lastSaleDate ?? previousTotals?.lastSaleDate ?? null;
  const previousMoneyPerTonne = moneyPerTonne(previousTotals?.billed ?? null, previousTotals?.tonnes ?? 0);
  const currentMoneyPerTonne = moneyPerTonne(totals.billed, totals.tonnes);

  if (cadence.segment === 'INACTIVO' && previousTotals && previousTotals.tonnes > 0) {
    alerts.push({
      key: 'inactivo',
      severity: 'critical',
      title: 'Cliente inactivo',
      detail: `Sin compras en los últimos 12 meses. Última compra: ${fmtDate(lastSale)}${
        cadence.daysSinceLastSale !== null ? ` (hace ${cadence.daysSinceLastSale} días)` : ''
      }. Antes compraba ${fmtTonnes(previousTotals.kg)} t.`,
      amount: previousTotals.billed,
    });
  } else if (cadence.segment === 'EN_RIESGO') {
    alerts.push({
      key: 'riesgo',
      severity: 'warning',
      title: 'Riesgo de abandono',
      detail: `Lleva ${cadence.daysSinceLastSale ?? '—'} días sin comprar; su cadencia habitual es de ${
        cadence.avgDaysBetweenNotes ?? '—'
      } días. Última compra: ${fmtDate(lastSale)}.`,
      amount: currentMoneyPerTonne !== null ? round2(currentMoneyPerTonne * Math.max(1, totals.tonnes / 12)) : null,
    });
  }

  if (lostProducts.length > 0) {
    const top = lostProducts
      .slice(0, 2)
      .map((product) => `${product.description ?? product.code} (${fmtTonnes(product.previous.kg)} t)`)
      .join(', ');
    const lostTonnes = lostProducts.reduce((acc, product) => acc + product.previous.tonnes, 0);
    alerts.push({
      key: 'productos-perdidos',
      severity: 'warning',
      title:
        lostProducts.length === 1
          ? 'Producto que dejó de comprar'
          : `${lostProducts.length} productos que dejó de comprar`,
      detail: `${top}. Oportunidad de reactivación con el cliente.`,
      amount: previousMoneyPerTonne !== null ? round2(lostTonnes * previousMoneyPerTonne) : null,
    });
  }

  const declining = products
    .filter(
      (product) =>
        product.previous.kg >= MIN_SIGNIFICANT_KG &&
        product.current.kg >= MIN_SIGNIFICANT_KG &&
        product.deltaPct !== null &&
        product.deltaPct <= -30,
    )
    .sort((a, b) => b.previous.kg - b.current.kg - (a.previous.kg - a.current.kg))[0];
  if (declining) {
    const lostKg = Math.max(0, declining.previous.kg - declining.current.kg);
    alerts.push({
      key: 'producto-caida',
      severity: 'warning',
      title: 'Producto principal en caída',
      detail: `${declining.description ?? declining.code} cayó de ${fmtTonnes(declining.previous.kg)} t a ${fmtTonnes(
        declining.current.kg,
      )} t (${declining.deltaPct}%).`,
      amount: currentMoneyPerTonne !== null ? round2((lostKg / 1000) * currentMoneyPerTonne) : null,
    });
  }

  const topProduct = products[0];
  if (topProduct && topProduct.sharePct >= 60 && totals.tonnes >= 1) {
    alerts.push({
      key: 'concentracion',
      severity: 'info',
      title: 'Alta concentración',
      detail: `${topProduct.description ?? topProduct.code} representa el ${topProduct.sharePct}% del volumen. Conviene ampliar el mix.`,
      amount: null,
    });
  }

  if (trend.volumePct !== null && trend.volumePct >= 15) {
    alerts.push({
      key: 'crecimiento',
      severity: 'success',
      title: 'Cliente en crecimiento',
      detail: `Subió ${trend.volumePct}% frente a los 12 meses anteriores (${fmtTonnes(totals.kg)} t). Asegura stock y acompaña con surtido.`,
      amount: null,
    });
  }

  if (input.account && input.account.saldoVencido > 0) {
    alerts.push({
      key: 'cobranza',
      severity: 'critical',
      title: 'Cobranza vencida',
      detail: `${input.account.vencidos} documento(s) vencido(s). Prioriza el cobro antes de ampliar el crédito.`,
      amount: input.account.saldoVencido,
    });
  } else if (
    input.account &&
    input.account.limiteCredito !== null &&
    input.account.limiteCredito > 0 &&
    input.account.saldo / input.account.limiteCredito >= 0.8
  ) {
    alerts.push({
      key: 'limite-credito',
      severity: 'warning',
      title: 'Límite de crédito casi agotado',
      detail: `Usa ${Math.round((input.account.saldo / input.account.limiteCredito) * 100)}% del límite disponible.`,
      amount: input.account.saldo,
    });
  }

  if (input.similar.length > 0) {
    const suggestion = input.similar[0]!;
    alerts.push({
      key: 'mix',
      severity: 'info',
      title: 'Oportunidad de ampliar mix',
      detail: `Clientes del mismo segmento también compran ${suggestion.description ?? suggestion.code}${
        suggestion.adoptersPct !== null ? ` (${suggestion.adoptersPct}% del segmento)` : ''
      }.`,
      amount: null,
    });
  }

  if (totals.notes > 0 && totals.notes <= 2) {
    alerts.push({
      key: 'frecuencia',
      severity: 'info',
      title: 'Compra esporádica',
      detail: `Solo ${totals.notes} nota(s) de entrega en los últimos 12 meses. Revisa si el cliente concentra sus compras en un solo pedido.`,
      amount: null,
    });
  }

  const weight: Record<CustomerInsightAlert['severity'], number> = {
    critical: 3,
    warning: 2,
    info: 1,
    success: 0,
  };
  return alerts
    .sort(
      (a, b) =>
        (weight[b.severity] ?? 0) - (weight[a.severity] ?? 0) || (b.amount ?? 0) - (a.amount ?? 0),
    )
    .slice(0, ALERT_LIMIT);
}

export function buildCustomerInsights(input: BuildInsightInput): BuildInsightResult {
  const billingByMonth = input.billingAvailable
    ? new Map(input.billingRows.map((row) => [row.month, row.billed]))
    : null;

  const totals = sumWindow(
    input.rows,
    input.windows.currentFromKey,
    input.windows.currentToKey,
    billingByMonth,
  );
  const previousTotals =
    input.windows.previousFromKey && input.windows.previousToKey
      ? sumWindow(input.rows, input.windows.previousFromKey, input.windows.previousToKey, billingByMonth)
      : null;

  const trend = {
    volumePct: previousTotals ? pctChange(totals.kg, previousTotals.kg) : null,
    billingPct: previousTotals ? pctChange(totals.billed, previousTotals.billed) : null,
    notesPct: previousTotals ? pctChange(totals.notes, previousTotals.notes) : null,
  };

  const monthly = buildMonthly(input.rows, input.windows, billingByMonth);
  const annual = buildAnnual(input.rows, monthly, billingByMonth);
  const { products, lostProducts } = buildProducts(input.rows, input.windows, totals, previousTotals);
  const cadence = buildCadence(input.rows, input.windows, totals);
  const alerts = buildAlerts(input, totals, previousTotals, products, lostProducts, cadence, trend);

  return {
    totals,
    previousTotals,
    trend,
    monthly,
    annual,
    products,
    lostProducts,
    cadence,
    alerts,
  };
}
