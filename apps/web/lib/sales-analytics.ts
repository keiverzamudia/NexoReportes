'use client';

// ============================================================
// Formato y series de la analítica comercial de Pedidos.
// Los cálculos viven en el API; aquí solo se presenta.
// ============================================================

import type {
  SalesAnalyticsCurrency,
  SalesAnalyticsCustomer,
  SalesAnalyticsResponse,
} from '@nexo/contracts';

const NUMBER = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function fmtKg(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${NUMBER.format(value)} kg`;
}

export function fmtTonnes(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return '—';
  const tonnes = value / 1000;
  const formatted = decimals === 0 ? NUMBER.format(tonnes) : ONE_DECIMAL.format(tonnes);
  return `${formatted} t`;
}

export function fmtMoney(value: number | null | undefined, currency: SalesAnalyticsCurrency): string {
  if (value === null || value === undefined) return '—';
  const formatted = new Intl.NumberFormat('es-VE', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);
  return currency === 'USD' ? `$ ${formatted}` : `Bs ${formatted}`;
}

export function fmtPct(value: number | null | undefined, signed = true): string {
  if (value === null || value === undefined) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${new Intl.NumberFormat('es-VE', { maximumFractionDigits: 1 }).format(value)} %`;
}

export function pctTone(value: number | null | undefined): 'up' | 'down' | 'neutral' {
  if (value === null || value === undefined || value === 0) return 'neutral';
  return value > 0 ? 'up' : 'down';
}

export function statusLabel(status: SalesAnalyticsCustomer['status']): string {
  switch (status) {
    case 'NUEVO':
      return 'Nuevo';
    case 'PERDIDO':
      return 'Sin compra';
    case 'EN_RIESGO':
      return 'En riesgo';
    default:
      return 'Activo';
  }
}

export function statusTone(
  status: SalesAnalyticsCustomer['status'],
): 'success' | 'warning' | 'danger' | 'muted' {
  switch (status) {
    case 'NUEVO':
      return 'success';
    case 'PERDIDO':
      return 'danger';
    case 'EN_RIESGO':
      return 'warning';
    default:
      return 'muted';
  }
}

/** CSV de la tabla de clientes (se abre en Excel sin pasos extra). */
export function buildCustomersCsv(
  report: SalesAnalyticsResponse,
  rows: SalesAnalyticsCustomer[],
): string {
  const header = [
    'Código',
    'Cliente',
    'Vendedor',
    'Tipo',
    'Vendido YTD (kg)',
    'Vendido YTD (t)',
    'Año anterior (kg)',
    'Variación %',
    'Notas',
    'Facturado',
    'Pendiente (kg)',
    'Pedidos pendientes',
    'Última compra',
    'Estado',
  ];
  const lines = rows.map((row) => [
    row.code,
    row.name,
    row.vendor ?? '',
    row.customerType ?? '',
    row.kg,
    (row.kg / 1000).toFixed(1),
    row.prevYearKg,
    row.yoyPct ?? '',
    row.notes,
    row.billed ?? '',
    row.pendingKg,
    row.pendingOrders,
    row.lastSaleDate ?? '',
    statusLabel(row.status),
  ]);
  return [header, ...lines]
    .map((line) =>
      line
        .map((cell) => {
          const value = String(cell ?? '');
          return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(';'),
    )
    .join('\r\n') + `\r\n# ${report.period.label} · ${report.currency}\r\n`;
}

/** Descarga directa sin librerías externas. */
export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const ANALYTICS_COLORS = {
  navy: '#003366',
  navySoft: '#3a5f94',
  lime: '#95c800',
  limeSoft: '#bbf23d',
  amber: '#d18700',
  red: '#ba1a1a',
  outline: '#737780',
  grid: '#e6eff9',
  ink: '#081d2c',
} as const;

export const ANALYTICS_TOOLTIP = {
  backgroundColor: '#001a33',
  borderWidth: 0,
  padding: [8, 12] as [number, number],
  textStyle: { color: '#ffffff', fontSize: 12 },
  extraCssText: 'border-radius:12px;box-shadow:0 16px 40px -20px rgba(0,30,64,.6);',
};
