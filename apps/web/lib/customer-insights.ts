import type {
  CustomerInsightProduct,
  CustomerInsightProductStatus,
  CustomerInsightSegment,
  CustomerInsightSeverity,
  CustomerStatementCurrency,
} from '@nexo/contracts';
import { formatStatementMoney } from './statement';
import { fmtPct, MONTHS_ES_SHORT } from './sales-report';

// ============================================================
// Formato puro de la ficha 360 de clientes.
// Sin React ni red: se prueba en customer-insights.spec.ts.
// ============================================================

export type InsightTone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';

export const PRODUCT_STATUS_META: Record<
  CustomerInsightProductStatus,
  { label: string; tone: InsightTone; hint: string }
> = {
  NUEVO: {
    label: 'Nuevo',
    tone: 'primary',
    hint: 'Empezó a comprarlo en los últimos 12 meses.',
  },
  CRECIENDO: {
    label: 'Creciendo',
    tone: 'success',
    hint: 'Sube 30 % o más frente a los 12 meses anteriores.',
  },
  ESTABLE: {
    label: 'Estable',
    tone: 'muted',
    hint: 'Variación menor al 30 % frente a los 12 meses anteriores.',
  },
  CAYENDO: {
    label: 'Cayendo',
    tone: 'warning',
    hint: 'Baja 30 % o más frente a los 12 meses anteriores.',
  },
  PERDIDO: {
    label: 'Perdido',
    tone: 'danger',
    hint: 'No lo compra en los últimos 12 meses, pero sí antes.',
  },
};

export const SEGMENT_META: Record<
  CustomerInsightSegment,
  { label: string; tone: InsightTone; hint: string }
> = {
  ACTIVO: {
    label: 'Activo',
    tone: 'success',
    hint: 'Compra dentro de su cadencia habitual.',
  },
  EN_RIESGO: {
    label: 'En riesgo',
    tone: 'warning',
    hint: 'Superó su cadencia habitual de compra.',
  },
  INACTIVO: {
    label: 'Inactivo',
    tone: 'danger',
    hint: 'Sin compras en los últimos 12 meses.',
  },
  SIN_DATOS: {
    label: 'Sin datos',
    tone: 'muted',
    hint: 'Sin notas de entrega en el histórico consultado.',
  },
};

export const ALERT_META: Record<
  CustomerInsightSeverity,
  { label: string; tone: InsightTone }
> = {
  critical: { label: 'Crítico', tone: 'danger' },
  warning: { label: 'Atención', tone: 'warning' },
  info: { label: 'Oportunidad', tone: 'primary' },
  success: { label: 'Bien', tone: 'success' },
};

export function formatInsightMoney(
  value: number | null | undefined,
  currency: CustomerStatementCurrency,
): string {
  return formatStatementMoney(value, currency);
}

export function formatTonnesValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} t`;
}

export function formatTonnesFromKg(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '—';
  return formatTonnesValue(kg / 1000);
}

export function formatSignedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const base = fmtPct(value, 1);
  return value > 0 ? `+${base}` : base;
}

/** «2026-01» → «ene 26». */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  const label = MONTHS_ES_SHORT[month - 1] ?? key;
  return `${label} ${String(year).slice(2)}`;
}

/** «2025-12» + «2026-11» → «dic 2025 – nov 2026». */
export function periodLabel(from: string, to: string): string {
  const fromKey = from.slice(0, 7);
  const toKey = to.slice(0, 7);
  return `${monthLabelLong(fromKey)} – ${monthLabelLong(toKey)}`;
}

function monthLabelLong(key: string): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  const label = MONTHS_ES_SHORT[month - 1] ?? key;
  return `${label} ${year}`;
}

export function productLastSaleLabel(product: CustomerInsightProduct): string {
  return product.current.lastSaleDate ?? product.previous.lastSaleDate ?? '—';
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildProductsCsv(
  currency: CustomerStatementCurrency,
  products: CustomerInsightProduct[],
): string {
  const money = currency === 'USD' ? 'USD' : 'Bs';
  const headers = [
    'Código',
    'Producto',
    'Estado',
    'Sacos 12m',
    'Toneladas 12m',
    '% volumen',
    `Facturado estimado ${money} 12m`,
    'Toneladas 12m anteriores',
    'Variación %',
    'Última compra',
  ];
  const rows = products.map((product) => [
    product.code,
    product.description ?? '',
    PRODUCT_STATUS_META[product.status].label,
    product.current.sacks,
    product.current.tonnes,
    product.sharePct,
    product.current.billed ?? '',
    product.previous.tonnes,
    product.deltaPct ?? '',
    productLastSaleLabel(product),
  ]);
  return [headers, ...rows]
    .map((line) => line.map(csvCell).join(','))
    .join('\n');
}

export function productsCsvFileName(code: string, months: number): string {
  return `clientes-${code}-productos-${months}m.csv`;
}

/** Los productos que más aportan al volumen actual, para el resumen. */
export function topProducts(products: CustomerInsightProduct[], limit = 5): CustomerInsightProduct[] {
  return [...products].sort((a, b) => b.current.kg - a.current.kg).slice(0, limit);
}
