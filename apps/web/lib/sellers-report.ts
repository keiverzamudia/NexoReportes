import type {
  ForecastSellerBilling,
  ForecastSellerClientRow,
  ForecastSellerProductRow,
  ForecastSellerRow,
  ForecastSellersResponse,
} from '@nexo/contracts';
import {
  META_MARKER_PCT,
  MONTHS_ES_SHORT,
  SALES_THRESHOLDS,
  fmtKg,
  fmtPct,
  fmtTonnes,
  monthLabel,
  salesDeviationGeometry,
  salesTone,
  type DeviationGeometry,
  type SalesTone,
} from './sales-report';

// ============================================================
// Utilidades puras de «Vendedor vs Forecast» (probadas con vitest).
//
// El API calcula cuotas, metas y proyecciones; aquí solo se filtra, se da
// formato, se construyen las porciones de la franja de reparto y el CSV. Así
// la pantalla y el archivo descargado nunca divergen.
// ============================================================

// Paleta categórica de la franja de reparto: deriva de la identidad (navy,
// lima, menta, ámbar) y mantiene contraste sobre el hero oscuro.
export const SELLER_COLORS = [
  '#95C800',
  '#799DD6',
  '#4EDEA3',
  '#D18700',
  '#A3D71F',
  '#5FA8D3',
  '#C9E265',
  '#F0B33C',
  '#9B8AFB',
  '#67C6B0',
] as const;

export function sellerInitials(name: string): string {
  const parts = name
    .replace(/[(),.]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export type SellerMetricFocus = 'facturado' | 'cartera' | 'meta' | null;

export interface SellerFilters {
  search: string;
  onlyWithSales: boolean;
  onlyWithQuota: boolean;
  /** Filtro aplicado desde una tarjeta KPI del encabezado. */
  metricFocus?: SellerMetricFocus;
}

export function filterSellers(sellers: ForecastSellerRow[], filters: SellerFilters): ForecastSellerRow[] {
  const needle = filters.search.trim().toLowerCase();
  return sellers.filter(
    (seller) =>
      (!filters.onlyWithSales || seller.actualKg > 0 || sellerBilling(seller).facturadoKg > 0) &&
      (!filters.onlyWithQuota || seller.targetKg > 0) &&
      (!filters.metricFocus ||
        (filters.metricFocus === 'facturado'
          ? sellerBilling(seller).facturadoKg > 0
          : filters.metricFocus === 'cartera'
            ? sellerBilling(seller).carteraKg > 0
            : seller.targetKg > 0)) &&
      (!needle ||
        seller.sellerName.toLowerCase().includes(needle) ||
        seller.sellerCode.toLowerCase().includes(needle)),
  );
}

export interface ClientFilters {
  search: string;
  onlyWithSales: boolean;
  onlyWithoutBase: boolean;
}

export function filterSellerClients(
  clients: ForecastSellerClientRow[],
  filters: ClientFilters,
): ForecastSellerClientRow[] {
  const needle = filters.search.trim().toLowerCase();
  return clients.filter(
    (client) =>
      (!filters.onlyWithSales || client.actualKg > 0) &&
      (!filters.onlyWithoutBase || client.targetKg <= 0) &&
      (!needle ||
        client.clientName.toLowerCase().includes(needle) ||
        client.clientCode.toLowerCase().includes(needle)),
  );
}

/** Vendedor con la cuota más alta (el que más meta debe cumplir). */
export function topQuotaSeller(report: ForecastSellersResponse): ForecastSellerRow | null {
  return [...report.sellers].sort((a, b) => b.targetKg - a.targetKg)[0] ?? null;
}

// ============================================================
// Facturación del vendedor: dos libros y una fuga.
//
// El API calcula los splits; estas funciones solo los resuelven con un
// respaldo para una respuesta cacheada de una versión anterior (sin `billing`).
// ============================================================

export const EMPTY_BILLING: ForecastSellerBilling = {
  facturadoKg: 0,
  facturadoOwnPortfolioKg: 0,
  facturadoOutsideKg: 0,
  carteraKg: 0,
  carteraByOthersKg: 0,
  carteraByOthersExternalKg: 0,
  carteraByOthersInternalKg: 0,
  carteraByOthersPct: null,
  facturadoClients: 0,
  leakedClients: 0,
  internalClients: 0,
};

function clientExternalKg(client: ForecastSellerClientRow): number {
  return (client as { otherSellerExternalKg?: number }).otherSellerExternalKg ?? client.otherSellerKg;
}

function clientInternalKg(client: ForecastSellerClientRow): number {
  return (client as { otherSellerInternalKg?: number }).otherSellerInternalKg ?? 0;
}

/** Resuelve la facturación del vendedor, con respaldo si el API es antiguo. */
export function sellerBilling(seller: ForecastSellerRow): ForecastSellerBilling {
  const raw = (seller as { billing?: ForecastSellerBilling }).billing;
  if (raw) return raw;

  const carteraKg = seller.carteraCurrentKg;
  const byOthers = seller.otherSellerKg;
  const external = seller.clients.reduce((acc, client) => acc + clientExternalKg(client), 0);
  const internal = seller.clients.reduce((acc, client) => acc + clientInternalKg(client), 0);
  const ownPortfolio = Math.max(0, carteraKg - byOthers);
  const facturado = seller.noteCurrentKg;

  return {
    facturadoKg: facturado,
    facturadoOwnPortfolioKg: Math.max(0, Math.min(facturado, ownPortfolio)),
    facturadoOutsideKg: Math.max(0, facturado - ownPortfolio),
    carteraKg,
    carteraByOthersKg: byOthers,
    carteraByOthersExternalKg: external,
    carteraByOthersInternalKg: internal,
    carteraByOthersPct: carteraKg > 0 ? roundTab((byOthers / carteraKg) * 100) : null,
    facturadoClients: seller.clients.filter((client) => client.noteCurrentKg > 0).length,
    leakedClients: seller.clients.filter((client) => clientExternalKg(client) > 0).length,
    internalClients: seller.clients.filter((client) => clientInternalKg(client) > 0).length,
  };
}

/** Clientes de la cartera del vendedor que compraron y les facturó otro. */
export function clientsBilledByOthers(
  seller: ForecastSellerRow,
  options: { externalOnly?: boolean } = {},
): ForecastSellerClientRow[] {
  return seller.clients
    .filter((client) =>
      options.externalOnly ? clientExternalKg(client) > 0 : client.otherSellerKg > 0,
    )
    .sort(
      (a, b) =>
        b.otherSellerKg - a.otherSellerKg ||
        b.carteraCurrentKg - a.carteraCurrentKg ||
        a.clientName.localeCompare(b.clientName, 'es'),
    );
}

/** % de un importe sobre un total (null si el total no es positivo). */
export function pctOfTotal(value: number, total: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return roundTab((value / total) * 100);
}


/**
 * Frase ejecutiva del hero. Se arma con el propio payload para que nunca quede
 * desactualizada.
 */
export function buildSellerNarrative(report: ForecastSellersResponse): string {
  const totals = report.totals;
  const month = monthLabel(report.year, report.month);
  const count = totals.sellerCount;

  if (count === 0) {
    return `No hay vendedores con ventas registradas para ${month}.`;
  }

  const people = count === 1 ? '1 vendedor' : `${fmtKg(count, 0)} vendedores`;

  if (report.status === 'FUTURE') {
    return totals.forecastKg > 0
      ? `Meta de ${fmtKg(totals.forecastKg)} kg para ${month}: ${people} ya tienen su cuota repartida. Todavía no hay entregas.`
      : `Sin meta ni entregas registradas para ${month}.`;
  }

  if (totals.forecastKg <= 0) {
    return `${people} llevan ${fmtKg(totals.actualKg)} kg vendidos; Profit no tiene meta cargada para ${month}.`;
  }

  if (totals.projectedKg === null || totals.projectedAttainmentPct === null) {
    return `${people} llevan ${fmtKg(totals.actualKg)} kg de una meta de ${fmtKg(totals.forecastKg)} kg.`;
  }

  const gap = totals.gapKg ?? 0;
  const closing = gap < 0 ? `faltarían ~${fmtKg(Math.abs(gap))} kg` : `iríamos ~${fmtKg(gap)} kg por encima`;
  const leader = topQuotaSeller(report);
  const leaderText =
    leader && leader.quotaPct !== null
      ? ` La mayor cuota es de ${leader.sellerName} (${fmtPct(leader.quotaPct)}).`
      : '';
  const billing = report.totals.billing;
  const billingText = billing
    ? ` Facturado ${fmtKg(billing.facturadoKg)} kg · cartera ${fmtKg(billing.carteraKg)} kg · por otros ${fmtKg(
        billing.carteraByOthersExternalKg,
      )} kg.`
    : '';

  return `${people} llevan ${fmtKg(totals.actualKg)} kg de ${fmtKg(totals.forecastKg)} kg; al ritmo actual cerrarían en ~${fmtKg(
    totals.projectedKg,
  )} kg (${fmtPct(totals.projectedAttainmentPct)}), así que ${closing}.${leaderText}${billingText}`;
}

export interface SellerShareSlice {
  code: string;
  name: string;
  kg: number;
  pct: number;
  color: string;
  /** Suma de los vendedores que no entran en el top. */
  other: boolean;
}

/**
 * Porciones de la franja de reparto de la venta del mes: top `max` vendedores
 * + «Otras». Los porcentajes se ajustan al último tramo para sumar 100 %.
 */
export function buildShareSlices(report: ForecastSellersResponse, max = 6): SellerShareSlice[] {
  const withSales = [...report.sellers]
    .filter((seller) => seller.actualKg > 0)
    .sort((a, b) => b.actualKg - a.actualKg || a.sellerName.localeCompare(b.sellerName, 'es'));
  const total = withSales.reduce((acc, seller) => acc + seller.actualKg, 0);
  if (total <= 0) return [];

  const visible = withSales.slice(0, max);
  const rest = withSales.slice(max);
  const slices: SellerShareSlice[] = visible.map((seller, index) => ({
    code: seller.sellerCode,
    name: seller.sellerName,
    kg: seller.actualKg,
    pct: Math.round((seller.actualKg / total) * 1000) / 10,
    color: SELLER_COLORS[index % SELLER_COLORS.length]!,
    other: false,
  }));

  if (rest.length > 0) {
    const kg = rest.reduce((acc, seller) => acc + seller.actualKg, 0);
    slices.push({
      code: '__otras__',
      name: `Otras ${rest.length}`,
      kg,
      pct: Math.round((kg / total) * 1000) / 10,
      color: '#737780',
      other: true,
    });
  }

  // Residuo de redondeo en el último tramo (misma regla que las metas).
  const sum = Math.round(slices.reduce((acc, slice) => acc + slice.pct, 0) * 10) / 10;
  const last = slices[slices.length - 1];
  if (last) last.pct = Math.round((last.pct + (100 - sum)) * 10) / 10;

  return slices;
}

// ============================================================
// Reparto de la cuota del vendedor entre sus clientes.
//
// El vendedor es el «todo» (100 % de su meta) y cada cliente es una porción:
// su meta asignada ÷ la meta del vendedor. Con eso se ve quién carga la cuota
// y, al compararlo con su venta, con qué cliente se está cayendo el mes.
// ============================================================

/** Peso de un cliente dentro de la cuota de su vendedor. */
export function clientQuotaSharePct(targetKg: number, sellerTargetKg: number): number | null {
  if (!Number.isFinite(targetKg) || !Number.isFinite(sellerTargetKg) || sellerTargetKg <= 0) return null;
  return roundTab((targetKg / sellerTargetKg) * 100);
}

/**
 * Parte de la brecha del vendedor que explica un cliente: su brecha ÷ la
 * brecha total. Negativa cuando el cliente va por encima de su parte (compensa).
 * Null si el vendedor no tiene brecha o al cliente le falta la meta.
 */
export function clientGapContributionPct(
  gapKg: number | null,
  sellerGapKg: number | null,
): number | null {
  if (gapKg === null || sellerGapKg === null) return null;
  if (!Number.isFinite(gapKg) || !Number.isFinite(sellerGapKg) || sellerGapKg >= 0) return null;
  return roundTab((gapKg / sellerGapKg) * 100);
}

export interface ClientQuotaRisk {
  /** Clientes con meta que, al ritmo actual, no llegan a su parte (100 %). */
  atRisk: ForecastSellerClientRow[];
  /** Peso de los 3 clientes más grandes en la cuota del vendedor. */
  top3SharePct: number | null;
  /** Brecha de la cartera: Σ de las brechas de los clientes con meta. */
  gapKg: number | null;
}

/** Radiografía de la cartera: concentración y quién explica la brecha. */
export function buildClientQuotaRisk(
  seller: ForecastSellerRow,
  report: ForecastSellersResponse,
): ClientQuotaRisk {
  const withTarget = seller.clients.filter((client) => client.carteraTargetKg > 0);
  const rows = withTarget.map((client) => ({
    client,
    metrics: tabRunRate(client.carteraCurrentKg, client.carteraTargetKg, report),
  }));

  const gapKg =
    seller.carteraTargetKg > 0
      ? roundTab(rows.reduce((acc, row) => acc + (row.metrics.gapKg ?? 0), 0))
      : null;

  const atRisk = rows
    .filter(
      (row) =>
        (row.metrics.projectedAttainmentPct ?? row.metrics.attainmentPct ?? 0) <
        SALES_THRESHOLDS.good,
    )
    .map((row) => row.client);

  const top3 = [...withTarget].sort((a, b) => b.carteraTargetKg - a.carteraTargetKg).slice(0, 3);
  const top3SharePct =
    seller.carteraTargetKg > 0
      ? roundTab(
          (top3.reduce((acc, client) => acc + client.carteraTargetKg, 0) /
            seller.carteraTargetKg) *
            100,
        )
      : null;

  return { atRisk, top3SharePct, gapKg };
}

// ============================================================
// Run-rate de una pestaña (Cartera o Nota) calculado en el cliente.
//
// El API ya entrega las métricas del criterio activo. El expediente necesita
// las dos vistas a la vez (cartera y nota) sin duplicar 16 campos en el
// contrato: se recalculan con el mismo calendario del informe.
// ============================================================
export interface TabRunRate {
  dailyAvgKg: number;
  projectedKg: number | null;
  attainmentPct: number | null;
  projectedAttainmentPct: number | null;
  gapKg: number | null;
  requiredDailyKg: number | null;
}

function roundTab(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function tabRunRate(
  actualKg: number,
  targetKg: number,
  report: ForecastSellersResponse,
): TabRunRate {
  const working = report.basis === 'WORKING';
  const elapsed = working ? report.days.workingElapsed : report.days.elapsed;
  const total = working ? report.days.workingInMonth : report.days.inMonth;
  const remaining = working ? report.days.workingRemaining : report.days.remaining;
  const actual = Number.isFinite(actualKg) ? actualKg : 0;
  const target = Number.isFinite(targetKg) ? targetKg : 0;
  const dailyAvgKg = elapsed > 0 ? actual / elapsed : 0;
  const projectedKg =
    report.status === 'FUTURE'
      ? null
      : report.status === 'CLOSED'
        ? roundTab(actual)
        : elapsed > 0
          ? roundTab(dailyAvgKg * total)
          : roundTab(actual);
  const attainmentPct = target > 0 ? roundTab((actual / target) * 100, 1) : null;
  const projectedAttainmentPct =
    target > 0 && projectedKg !== null ? roundTab((projectedKg / target) * 100, 1) : null;
  const gapKg = target > 0 && projectedKg !== null ? roundTab(projectedKg - target) : null;
  const requiredDailyKg =
    report.status === 'OPEN' && target > 0
      ? roundTab(Math.max(0, target - actual) / Math.max(1, remaining), 1)
      : null;

  return { dailyAvgKg, projectedKg, attainmentPct, projectedAttainmentPct, gapKg, requiredDailyKg };
}

/** Geometría de la barra de un vendedor/cliente contra su meta asignada. */
export function quotaGeometry(row: {
  targetKg: number;
  actualKg: number;
  projectedKg: number | null;
}): DeviationGeometry {
  return salesDeviationGeometry({
    forecastKg: row.targetKg,
    actualKg: row.actualKg,
    projectedKg: row.projectedKg,
  });
}

/** Semáforo según el cumplimiento proyectado (mismos umbrales que Ventas). */
export function quotaTone(row: {
  projectedAttainmentPct: number | null;
  attainmentPct: number | null;
}): SalesTone {
  return salesTone(row.projectedAttainmentPct ?? row.attainmentPct);
}

/**
 * Porcentaje de cumplimiento listo para mostrar. Un vendedor con una cuota
 * casi nula (base histórica mínima) puede superar el 1000 %: se acota a
 * «> 999 %» para que la cifra no rompa la fila. El CSV conserva el valor real.
 */
export function fmtAttainmentPct(pct: number | null | undefined, decimals = 1): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  if (pct > 999) return '> 999 %';
  return fmtPct(pct, decimals);
}

export interface SellerHistoryPoint {
  label: string;
  year: number;
  month: number;
  actualKg: number;
  /** Cuota mensual de referencia (la meta del mes del informe). */
  quotaKg: number;
}

/** Últimos N meses del vendedor con la cuota actual como referencia. */
export function sellerHistoryPoints(seller: ForecastSellerRow): SellerHistoryPoint[] {
  return seller.history.map((entry) => ({
    label: MONTHS_ES_SHORT[entry.month - 1] ?? `${entry.month}`,
    year: entry.year,
    month: entry.month,
    actualKg: entry.actualKg,
    quotaKg: seller.targetKg,
  }));
}

/** Texto corto del origen de la cuota. */
export function allocationLabel(report: ForecastSellersResponse): string {
  switch (report.allocationBasis) {
    case 'HISTORY':
      return 'cuota por participación histórica';
    case 'EQUAL_FALLBACK':
      return 'cuota igualitaria (sin histórico)';
    default:
      return 'sin meta para repartir';
  }
}

// ---------- CSV ----------

const SELLER_CSV_HEADERS = [
  'Vendedor',
  'Código',
  'Clientes',
  'Clientes con venta',
  'Clientes en cartera',
  'Histórico kg',
  'Cuota %',
  'Meta kg',
  'Venta kg',
  'Facturado kg',
  'Cartera kg',
  'Por otros kg',
  'Unidades',
  'Cumplimiento %',
  'Proyección kg',
  'Cumplimiento proyectado %',
  'Brecha kg',
  'Plan cierre kg',
  'Ritmo necesario kg/día',
  'Reparto del mes %',
  'Última nota',
] as const;

const CLIENT_CSV_HEADERS = [
  'Cliente',
  'Código',
  'Tipo',
  'Vendedor asignado',
  'Otras notas kg',
  'Histórico kg',
  '% del vendedor',
  'Cuota empresa %',
  'Meta kg',
  'Venta kg',
  'Cumplimiento %',
  'Proyección kg',
  'Cumplimiento proyectado %',
  'Brecha kg',
  'Pendiente mes kg',
  'Esperado kg',
  'Capacidad kg',
  'Plan cierre kg',
  'Última nota',
] as const;

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvNumber(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(Number(value.toFixed(decimals)));
}

/** CSV de vendedores con BOM (Excel en español) y fila de totales. */
export function buildSellersCsv(report: ForecastSellersResponse): string {
  const lines = [SELLER_CSV_HEADERS.map(csvCell).join(',')];

  for (const seller of report.sellers) {
    const billing = sellerBilling(seller);
    lines.push(
      [
        seller.sellerName,
        seller.sellerCode,
        seller.clientCount,
        seller.activeClientCount,
        seller.assignedClientCount,
        csvNumber(seller.historicalKg),
        csvNumber(seller.quotaPct),
        csvNumber(seller.targetKg),
        csvNumber(seller.actualKg),
        csvNumber(billing.facturadoKg),
        csvNumber(billing.carteraKg),
        csvNumber(billing.carteraByOthersKg),
        csvNumber(seller.actualUnits),
        csvNumber(seller.attainmentPct),
        csvNumber(seller.projectedKg),
        csvNumber(seller.projectedAttainmentPct),
        csvNumber(seller.gapKg),
        csvNumber(seller.closingPlanKg),
        csvNumber(seller.requiredDailyKg),
        csvNumber(seller.currentSharePct),
        seller.lastInvoiceDate ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  const totals = report.totals;
  lines.push(
    [
      'TOTALES',
      '',
      totals.sellerCount,
      totals.activeClientCount,
      totals.assignedClientCount,
      '',
      '',
      csvNumber(totals.forecastKg),
      csvNumber(totals.actualKg),
      csvNumber(totals.billing?.facturadoKg ?? 0),
      csvNumber(totals.billing?.carteraKg ?? 0),
      csvNumber(totals.billing?.carteraByOthersKg ?? 0),
      csvNumber(totals.actualUnits),
      csvNumber(totals.attainmentPct),
      csvNumber(totals.projectedKg),
      csvNumber(totals.projectedAttainmentPct),
      csvNumber(totals.gapKg),
      csvNumber(totals.closingCoveredKg),
      csvNumber(totals.requiredDailyKg),
      // No se suman repartos de vendedores en el total: la red siempre es 100 %.
      '',
      totals.lastInvoiceDate ?? '',
    ]
      .map(csvCell)
      .join(','),
  );

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** CSV de los clientes de un vendedor. */
export function buildSellerClientsCsv(seller: ForecastSellerRow): string {
  const lines = [CLIENT_CSV_HEADERS.map(csvCell).join(',')];

  for (const client of seller.clients) {
    lines.push(
      [
        client.clientName,
        client.clientCode,
        client.customerType ?? '',
        client.assignedSellerName,
        csvNumber(client.otherSellerKg),
        csvNumber(client.historicalKg),
        csvNumber(client.shareOfSellerPct),
        csvNumber(client.quotaPct),
        csvNumber(client.targetKg),
        csvNumber(client.actualKg),
        csvNumber(client.attainmentPct),
        csvNumber(client.projectedKg),
        csvNumber(client.projectedAttainmentPct),
        csvNumber(client.gapKg),
        csvNumber(client.pendingKg),
        csvNumber(client.expectedKg),
        csvNumber(client.capacityKg),
        csvNumber(client.closingPlanKg),
        client.lastInvoiceDate ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const CARTERA_CSV_HEADERS = [
  'Cliente',
  'Código',
  'Tipo',
  'Cartera mes kg',
  'Firmado por él kg',
  'Otros kg',
  'Histórico cartera kg',
  'Meta cartera kg',
  '% de su cuota',
  'Cumplimiento %',
  'Proyección kg',
  'Brecha kg',
  'Aporte brecha %',
  'Pendiente mes kg',
  'Esperado kg',
  'Capacidad kg',
  'Plan cierre kg',
  'Última nota',
] as const;

const PRODUCT_CSV_HEADERS = [
  'Producto',
  'Código',
  'UOM',
  'Cartera mes kg',
  'Firmado por él kg',
  'Otros kg',
  'Histórico cartera kg',
  'Histórico nota kg',
  'Clientes cartera',
  'Clientes nota',
  '% cartera',
  'Última nota',
] as const;

/** CSV de la pestaña Cartera del expediente. */
export function buildSellerCarteraCsv(seller: ForecastSellerRow, report: ForecastSellersResponse): string {
  const lines = [CARTERA_CSV_HEADERS.map(csvCell).join(',')];
  const sellerGap =
    seller.carteraTargetKg > 0
      ? roundTab(
          seller.clients.reduce(
            (acc, client) =>
              acc + (tabRunRate(client.carteraCurrentKg, client.carteraTargetKg, report).gapKg ?? 0),
            0,
          ),
        )
      : null;

  for (const client of seller.clients) {
    const metrics = tabRunRate(client.carteraCurrentKg, client.carteraTargetKg, report);
    lines.push(
      [
        client.clientName,
        client.clientCode,
        client.customerType ?? '',
        csvNumber(client.carteraCurrentKg),
        csvNumber(client.noteCurrentKg),
        csvNumber(client.otherSellerKg),
        csvNumber(client.carteraHistoricalKg),
        csvNumber(client.carteraTargetKg),
        csvNumber(clientQuotaSharePct(client.carteraTargetKg, seller.carteraTargetKg)),
        csvNumber(metrics.projectedAttainmentPct ?? metrics.attainmentPct),
        csvNumber(metrics.projectedKg),
        csvNumber(metrics.gapKg),
        csvNumber(clientGapContributionPct(metrics.gapKg, sellerGap)),
        csvNumber(client.pendingKg),
        csvNumber(client.expectedKg),
        csvNumber(client.capacityKg),
        csvNumber(client.closingPlanKg),
        client.lastInvoiceDate ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** CSV de la pestaña Facturado del expediente. */
export function buildSellerFacturadoCsv(seller: ForecastSellerRow): string {
  const billing = sellerBilling(seller);
  const headers = [
    'Cliente',
    'Código',
    'Tipo',
    'Cartera asignada a',
    'Facturado por él kg',
    'De su cartera kg',
    'Fuera de cartera kg',
    'Notas',
    '% de su facturación',
    'Cartera del cliente kg',
    'Última nota',
  ] as const;
  const lines = [headers.map(csvCell).join(',')];

  for (const client of seller.clients.filter(
    (row) => row.noteCurrentKg > 0 || row.noteHistoricalKg > 0,
  )) {
    const own = Math.max(0, client.carteraCurrentKg - client.otherSellerKg);
    const outside = Math.max(0, client.noteCurrentKg - own);
    lines.push(
      [
        client.clientName,
        client.clientCode,
        client.customerType ?? '',
        client.assignedSellerName || 'Sin cartera',
        csvNumber(client.noteCurrentKg),
        csvNumber(own),
        csvNumber(outside),
        client.noteInvoiceCount,
        csvNumber(pctOfTotal(client.noteCurrentKg, billing.facturadoKg)),
        csvNumber(client.carteraCurrentKg),
        client.lastInvoiceDate ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** CSV de la pestaña Facturado por otros: la fuga de la cartera. */
export function buildSellerLeakCsv(seller: ForecastSellerRow): string {
  const headers = [
    'Cliente',
    'Código',
    'Tipo',
    'Cartera del cliente kg',
    'Facturado por él kg',
    'Otros kg',
    'Otros vendedores kg',
    'Cuentas internas kg',
    '% por otros',
    'Otros vendedores',
    'Última nota',
  ] as const;
  const lines = [headers.map(csvCell).join(',')];

  for (const client of clientsBilledByOthers(seller)) {
    const total = client.carteraCurrentKg;
    const names =
      client.otherSellers.length > 0
        ? client.otherSellers
            .map((entry) => `${entry.code} ${entry.name}${entry.internal ? ' (interna)' : ''}`)
            .join(' / ')
        : client.otherSellerNames.join(' / ');
    lines.push(
      [
        client.clientName,
        client.clientCode,
        client.customerType ?? '',
        csvNumber(total),
        csvNumber(client.noteCurrentKg),
        csvNumber(client.otherSellerKg),
        csvNumber(clientExternalKg(client)),
        csvNumber(clientInternalKg(client)),
        csvNumber(pctOfTotal(client.otherSellerKg, total)),
        names,
        client.lastInvoiceDate ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** CSV de la pestaña Productos del expediente. */
export function buildSellerProductsCsv(products: ForecastSellerProductRow[]): string {
  const lines = [PRODUCT_CSV_HEADERS.map(csvCell).join(',')];
  for (const product of products) {
    lines.push(
      [
        product.description,
        product.productCode,
        product.uom,
        csvNumber(product.carteraCurrentKg),
        csvNumber(product.noteCurrentKg),
        csvNumber(product.otherCurrentKg),
        csvNumber(product.carteraHistoricalKg),
        csvNumber(product.noteHistoricalKg),
        product.clientCount,
        product.noteClientCount,
        csvNumber(product.carteraShareOfSellerPct),
        product.lastInvoiceDate ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function sellersCsvFileName(report: ForecastSellersResponse): string {
  return `vendedor-vs-forecast-${report.year}-${String(report.month).padStart(2, '0')}.csv`;
}

export function sellerClientsCsvFileName(seller: ForecastSellerRow, report: ForecastSellersResponse): string {
  const code = seller.sellerCode || 'sin-codigo';
  return `clientes-${code}-${report.year}-${String(report.month).padStart(2, '0')}.csv`;
}

// Reexport para que la UI no importe dos módulos solo por el marcador.
export { META_MARKER_PCT, fmtKg, fmtPct, fmtTonnes, monthLabel, quotaGeometry as sellerQuotaGeometry };
