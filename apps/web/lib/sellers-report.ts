import type {
  ForecastSellerClientRow,
  ForecastSellerRow,
  ForecastSellersResponse,
} from '@nexo/contracts';
import {
  META_MARKER_PCT,
  MONTHS_ES_SHORT,
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
// Utilidades puras de «Vendedoras vs Forecast» (probadas con vitest).
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

export interface SellerFilters {
  search: string;
  onlyWithSales: boolean;
  onlyWithQuota: boolean;
}

export function filterSellers(sellers: ForecastSellerRow[], filters: SellerFilters): ForecastSellerRow[] {
  const needle = filters.search.trim().toLowerCase();
  return sellers.filter(
    (seller) =>
      (!filters.onlyWithSales || seller.actualKg > 0) &&
      (!filters.onlyWithQuota || seller.targetKg > 0) &&
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

/** Vendedora con la cuota más alta (la que más meta debe cumplir). */
export function topQuotaSeller(report: ForecastSellersResponse): ForecastSellerRow | null {
  return [...report.sellers].sort((a, b) => b.targetKg - a.targetKg)[0] ?? null;
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
    return `No hay vendedoras con ventas registradas para ${month}.`;
  }

  const people = count === 1 ? '1 vendedora' : `${fmtKg(count, 0)} vendedoras`;

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

  return `${people} llevan ${fmtKg(totals.actualKg)} kg de ${fmtKg(totals.forecastKg)} kg; al ritmo actual cerrarían en ~${fmtKg(
    totals.projectedKg,
  )} kg (${fmtPct(totals.projectedAttainmentPct)}), así que ${closing}.${leaderText}`;
}

export interface SellerShareSlice {
  code: string;
  name: string;
  kg: number;
  pct: number;
  color: string;
  /** Suma de las vendedoras que no entran en el top. */
  other: boolean;
}

/**
 * Porciones de la franja de reparto de la venta del mes: top `max` vendedoras
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

/** Geometría de la barra de una vendedora/cliente contra su meta asignada. */
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
 * Porcentaje de cumplimiento listo para mostrar. Una vendedora con una cuota
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

/** Últimos N meses de la vendedora con la cuota actual como referencia. */
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
  'Vendedora',
  'Código',
  'Clientes',
  'Clientes con venta',
  'Histórico kg',
  'Cuota %',
  'Meta kg',
  'Venta kg',
  'Unidades',
  'Cumplimiento %',
  'Proyección kg',
  'Cumplimiento proyectado %',
  'Brecha kg',
  'Ritmo necesario kg/día',
  'Reparto del mes %',
  'Última nota',
] as const;

const CLIENT_CSV_HEADERS = [
  'Cliente',
  'Código',
  'Tipo',
  'Histórico kg',
  '% de la vendedora',
  'Cuota empresa %',
  'Meta kg',
  'Venta kg',
  'Cumplimiento %',
  'Proyección kg',
  'Cumplimiento proyectado %',
  'Brecha kg',
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

/** CSV de vendedoras con BOM (Excel en español) y fila de totales. */
export function buildSellersCsv(report: ForecastSellersResponse): string {
  const lines = [SELLER_CSV_HEADERS.map(csvCell).join(',')];

  for (const seller of report.sellers) {
    lines.push(
      [
        seller.sellerName,
        seller.sellerCode,
        seller.clientCount,
        seller.activeClientCount,
        csvNumber(seller.historicalKg),
        csvNumber(seller.quotaPct),
        csvNumber(seller.targetKg),
        csvNumber(seller.actualKg),
        csvNumber(seller.actualUnits),
        csvNumber(seller.attainmentPct),
        csvNumber(seller.projectedKg),
        csvNumber(seller.projectedAttainmentPct),
        csvNumber(seller.gapKg),
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
      '',
      '',
      '',
      csvNumber(totals.forecastKg),
      csvNumber(totals.actualKg),
      csvNumber(totals.actualUnits),
      csvNumber(totals.attainmentPct),
      csvNumber(totals.projectedKg),
      csvNumber(totals.projectedAttainmentPct),
      csvNumber(totals.gapKg),
      csvNumber(totals.requiredDailyKg),
      // No se suman repartos de vendedoras en el total: la red siempre es 100 %.
      '',
      totals.lastInvoiceDate ?? '',
    ]
      .map(csvCell)
      .join(','),
  );

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** CSV de los clientes de una vendedora. */
export function buildSellerClientsCsv(seller: ForecastSellerRow): string {
  const lines = [CLIENT_CSV_HEADERS.map(csvCell).join(',')];

  for (const client of seller.clients) {
    lines.push(
      [
        client.clientName,
        client.clientCode,
        client.customerType ?? '',
        csvNumber(client.historicalKg),
        csvNumber(client.shareOfSellerPct),
        csvNumber(client.quotaPct),
        csvNumber(client.targetKg),
        csvNumber(client.actualKg),
        csvNumber(client.attainmentPct),
        csvNumber(client.projectedKg),
        csvNumber(client.projectedAttainmentPct),
        csvNumber(client.gapKg),
        client.lastInvoiceDate ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function sellersCsvFileName(report: ForecastSellersResponse): string {
  return `vendedoras-vs-forecast-${report.year}-${String(report.month).padStart(2, '0')}.csv`;
}

export function sellerClientsCsvFileName(seller: ForecastSellerRow, report: ForecastSellersResponse): string {
  const code = seller.sellerCode || 'sin-codigo';
  return `clientes-${code}-${report.year}-${String(report.month).padStart(2, '0')}.csv`;
}

// Reexport para que la UI no importe dos módulos solo por el marcador.
export { META_MARKER_PCT, fmtKg, fmtPct, fmtTonnes, monthLabel, quotaGeometry as sellerQuotaGeometry };
