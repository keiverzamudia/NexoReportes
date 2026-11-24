'use client';

import {
  RECEIVABLES_BUCKETS,
  ReceivablesBucket,
  ReceivablesBucketKey,
  ReceivablesClientRow,
  ReceivablesCurrency,
  ReceivablesDocumentRow,
  ReceivablesResponse,
  ReceivablesTotals,
} from '@nexo/contracts';
import { formatStatementDate, formatStatementMoney } from './statement';

export { formatStatementDate };

// ============================================================
// Presentación pura de Cuentas por cobrar: colores de tramos, importes,
// fechas, ranking de vendedores y CSV. Sin React ni red; se prueba en
// `receivables.spec.ts`.
// ============================================================

export type ReceivablesTone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';

export const BUCKET_COLORS: Record<ReceivablesBucketKey, string> = {
  POR_VENCER: '#10b981',
  D1_30: '#eab308',
  D31_60: '#f59e0b',
  D61_90: '#f97316',
  D91_120: '#ef4444',
  D121_150: '#dc2626',
  D150_DESDE_2025: '#991b1b',
  D150_HASTA_2025: '#6b21a8',
};

export const BUCKET_TEXT_COLORS: Record<ReceivablesBucketKey, string> = {
  POR_VENCER: '#047857',
  D1_30: '#a16207',
  D31_60: '#b45309',
  D61_90: '#c2410c',
  D91_120: '#b91c1c',
  D121_150: '#991b1b',
  D150_DESDE_2025: '#7f1d1d',
  D150_HASTA_2025: '#581c87',
};

export const BUCKET_TONES: Record<ReceivablesBucketKey, ReceivablesTone> = {
  POR_VENCER: 'success',
  D1_30: 'warning',
  D31_60: 'warning',
  D61_90: 'danger',
  D91_120: 'danger',
  D121_150: 'danger',
  D150_DESDE_2025: 'danger',
  D150_HASTA_2025: 'danger',
};

// Contraste para las etiquetas que van DENTRO de la barra apilada. Los
// tramos claros (verde, amarillo, ámbar) llevan tinta oscura; los rojos, blanca.
export const BUCKET_LABEL_COLORS: Record<ReceivablesBucketKey, string> = {
  POR_VENCER: '#052e16',
  D1_30: '#422006',
  D31_60: '#451a03',
  D61_90: '#431407',
  D91_120: '#ffffff',
  D121_150: '#ffffff',
  D150_DESDE_2025: '#ffffff',
  D150_HASTA_2025: '#ffffff',
};

export interface AgingSegment {
  key: ReceivablesBucketKey;
  short: string;
  label: string;
  amount: number;
  pct: number;
}

export function agingSegments(
  amounts: Partial<Record<ReceivablesBucketKey, number>>,
): AgingSegment[] {
  const total = RECEIVABLES_BUCKETS.reduce((sum, bucket) => sum + (amounts[bucket.key] ?? 0), 0);
  if (total <= 0) return [];
  return RECEIVABLES_BUCKETS.map((bucket) => {
    const amount = Math.max(0, amounts[bucket.key] ?? 0);
    return {
      key: bucket.key,
      short: bucket.short,
      label: bucket.label,
      amount: round2(amount),
      pct: round2((amount / total) * 100),
    };
  }).filter((segment) => segment.amount > 0);
}

/** Mezcla de antigüedad de una fila de cliente, en orden cronológico. */
export function clientAging(row: ReceivablesClientRow): AgingSegment[] {
  const amounts: Partial<Record<ReceivablesBucketKey, number>> = {};
  for (const bucket of RECEIVABLES_BUCKETS) {
    amounts[bucket.key] = bucketAmount(row, bucket.key);
  }
  return agingSegments(amounts);
}

/** Mezcla global a partir de los buckets del reporte. */
export function segmentsFromBuckets(buckets: ReceivablesBucket[]): AgingSegment[] {
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  return RECEIVABLES_BUCKETS.map((bucket) => {
    const source = byKey.get(bucket.key);
    return {
      key: bucket.key,
      short: bucket.short,
      label: bucket.label,
      amount: round2(source?.amount ?? 0),
      pct: round2(source?.pct ?? 0),
    };
  }).filter((segment) => segment.amount > 0);
}

/**
 * Segmentos de la barra de cobranza. Conserva las etiquetas que devuelve el
 * API («A tiempo», «1–30», …) en lugar de los tramos de la cartera.
 */
export function segmentsFromPaymentBuckets(buckets: ReceivablesBucket[]): AgingSegment[] {
  return buckets
    .filter((bucket) => bucket.amount > 0)
    .map((bucket) => ({
      key: bucket.key,
      short: bucket.short,
      label: bucket.label,
      amount: bucket.amount,
      pct: bucket.pct,
    }));
}

export function bucketMeta(key: ReceivablesBucketKey) {
  return RECEIVABLES_BUCKETS.find((bucket) => bucket.key === key) ?? RECEIVABLES_BUCKETS[0]!;
}

export function bucketAmount(row: ReceivablesClientRow, key: ReceivablesBucketKey): number {
  switch (key) {
    case 'POR_VENCER':
      return row.porVencer;
    case 'D1_30':
      return row.d1_30;
    case 'D31_60':
      return row.d31_60;
    case 'D61_90':
      return row.d61_90;
    case 'D91_120':
      return row.d91_120;
    case 'D121_150':
      return row.d121_150;
    case 'D150_DESDE_2025':
      return row.d150Desde2025;
    case 'D150_HASTA_2025':
      return row.d150Hasta2025;
  }
}

/** Mismo mapeo que `bucketAmount`, sobre los totales del reporte. */
export function bucketTotalAmount(totals: ReceivablesTotals, key: ReceivablesBucketKey): number {
  switch (key) {
    case 'POR_VENCER':
      return totals.porVencer;
    case 'D1_30':
      return totals.d1_30;
    case 'D31_60':
      return totals.d31_60;
    case 'D61_90':
      return totals.d61_90;
    case 'D91_120':
      return totals.d91_120;
    case 'D121_150':
      return totals.d121_150;
    case 'D150_DESDE_2025':
      return totals.d150Desde2025;
    case 'D150_HASTA_2025':
      return totals.d150Hasta2025;
  }
}

export function formatReceivablesMoney(
  value: number | null | undefined,
  currency: ReceivablesCurrency,
): string {
  return formatStatementMoney(value, currency);
}

/** Importe compacto para héroes, ejes y KPIs: $ 1,02 M / Bs 632,5 M. */
export function formatCompactMoney(
  value: number | null | undefined,
  currency: ReceivablesCurrency,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const symbol = currency === 'USD' ? '$' : 'Bs';
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    return `${sign}${symbol} ${new Intl.NumberFormat('es-VE', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(abs / 1_000_000)} M`;
  }
  if (abs >= 1_000) {
    return `${sign}${symbol} ${new Intl.NumberFormat('es-VE', {
      maximumFractionDigits: 0,
    }).format(abs / 1_000)} K`;
  }
  return `${sign}${symbol} ${new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs)}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('es-VE', { maximumFractionDigits: 1 }).format(value)} %`;
}

/** Porcentaje sin espacio, para etiquetas y chips estrechos: 96,1%. */
export function formatPctCompact(value: number | null | undefined): string {
  const formatted = formatPct(value);
  return formatted === '—' ? formatted : formatted.replace(' %', '%');
}

/** Conteos con separador de miles: 4.388 pagos, 2.393 a tiempo. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 }).format(value);
}

export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 }).format(value)} d`;
}

export function paymentLabel(row: Pick<ReceivablesClientRow, 'ultimoPago' | 'diasSinPago'>): string {
  if (!row.ultimoPago) return 'Sin abonos';
  const date = formatStatementDate(row.ultimoPago);
  if (row.diasSinPago === null) return date;
  return `${date} · hace ${formatDays(row.diasSinPago)}`;
}

export interface VendorBucketRow {
  codigo: string;
  vendedor: string;
  cartera: number;
  vencido: number;
  pctVencido: number;
  clientes: number;
  buckets: Record<ReceivablesBucketKey, number>;
  aging: AgingSegment[];
}

function emptyBucketAmounts(): Record<ReceivablesBucketKey, number> {
  return Object.fromEntries(
    RECEIVABLES_BUCKETS.map((bucket) => [bucket.key, 0]),
  ) as Record<ReceivablesBucketKey, number>;
}

/** Ranking de vendedores a partir de las filas de clientes ya filtradas. */
export function vendorRows(clients: ReceivablesClientRow[]): VendorBucketRow[] {
  const map = new Map<string, VendorBucketRow>();
  for (const row of clients) {
    if (row.cartera <= 0 && row.aFavor <= 0) continue;
    const key = row.vendedorCodigo || row.vendedor || '—';
    const current =
      map.get(key) ??
      {
        codigo: row.vendedorCodigo,
        vendedor: row.vendedor || 'Sin vendedor',
        cartera: 0,
        vencido: 0,
        pctVencido: 0,
        clientes: 0,
        buckets: emptyBucketAmounts(),
        aging: [],
      };
    current.cartera += row.cartera;
    current.vencido += row.vencido;
    current.clientes += 1;
    for (const bucket of RECEIVABLES_BUCKETS) {
      current.buckets[bucket.key] += bucketAmount(row, bucket.key);
    }
    map.set(key, current);
  }
  return [...map.values()]
    .map((row) => {
      const buckets = Object.fromEntries(
        RECEIVABLES_BUCKETS.map((bucket) => [bucket.key, round2(row.buckets[bucket.key])]),
      ) as Record<ReceivablesBucketKey, number>;
      return {
        ...row,
        cartera: round2(row.cartera),
        vencido: round2(row.vencido),
        pctVencido: row.cartera > 0 ? round2((row.vencido / row.cartera) * 100) : 0,
        buckets,
        aging: agingSegments(buckets),
      };
    })
    .sort((a, b) => b.cartera - a.cartera);
}

function round2(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(round2(value)) : value;
  return /[",;\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(values: Array<string | number | null | undefined>): string {
  return values.map(csvCell).join(',');
}

function amountFor(row: ReceivablesDocumentRow, key: ReceivablesBucketKey): number | '' {
  if (row.esCredito || row.tramo !== key) return '';
  return row.saldo;
}

export function buildSummaryCsv(report: ReceivablesResponse): string {
  const header = csvLine([
    'Código',
    'Cliente',
    'Vendedor',
    'Tipo',
    'Zona',
    'Segmento',
    'Cartera',
    'A favor',
    'Neto',
    'Por vencer',
    '1 a 30',
    '31 a 60',
    '61 a 90',
    '91 a 120',
    '121 a 150',
    'Más de 150 · 2025+',
    'Más de 150 · ≤ 2024',
    'Vencido',
    '% vencido',
    'Documentos',
    'Vencidos',
    'Último pago',
    'Días sin pago',
    'Cobrado 90d',
    'Cobrado 12m',
    '% cobranza a tiempo',
  ]);
  const body = report.clientes.map((row) =>
    csvLine([
      row.codigo,
      row.nombre,
      row.vendedor,
      row.tipoClienteLabel || row.tipoCliente,
      row.zonaLabel || row.zona,
      row.segmentoLabel || row.segmento,
      row.cartera,
      row.aFavor,
      row.neto,
      row.porVencer,
      row.d1_30,
      row.d31_60,
      row.d61_90,
      row.d91_120,
      row.d121_150,
      row.d150Desde2025,
      row.d150Hasta2025,
      row.vencido,
      row.pctVencido,
      row.documentos,
      row.vencidos,
      row.ultimoPago ? formatStatementDate(row.ultimoPago) : '',
      row.diasSinPago ?? '',
      row.cobrado90,
      row.cobrado12m,
      row.pctCobranzaATiempo ?? '',
    ]),
  );
  return [header, ...body].join('\n');
}

export function buildDocumentsCsv(report: ReceivablesResponse): string {
  const header = csvLine([
    'Cliente',
    'Código',
    'Tipo Doc',
    'Nro Doc',
    'Emisión',
    'Vencimiento',
    'Días',
    'Tramo',
    'Saldo',
    'Monto original',
    'Por vencer',
    '1 a 30',
    '31 a 60',
    '61 a 90',
    '91 a 120',
    '121 a 150',
    'Más de 150 · 2025+',
    'Más de 150 · ≤ 2024',
    'Vencido',
    'Vendedor',
  ]);
  const body = report.documentos.map((row) =>
    csvLine([
      row.clienteNombre,
      row.clienteCodigo,
      row.tipoDoc,
      row.nroDoc,
      row.fechaEmision ? formatStatementDate(row.fechaEmision) : '',
      row.fechaVencimiento ? formatStatementDate(row.fechaVencimiento) : '',
      row.esCredito ? '' : row.diasVencimiento,
      row.esCredito ? 'A favor' : bucketMeta(row.tramo ?? 'POR_VENCER').label,
      row.saldo,
      row.montoOriginal ?? '',
      amountFor(row, 'POR_VENCER'),
      amountFor(row, 'D1_30'),
      amountFor(row, 'D31_60'),
      amountFor(row, 'D61_90'),
      amountFor(row, 'D91_120'),
      amountFor(row, 'D121_150'),
      amountFor(row, 'D150_DESDE_2025'),
      amountFor(row, 'D150_HASTA_2025'),
      row.esCredito || row.diasVencimiento <= 0 ? '' : row.saldo,
      row.vendedor,
    ]),
  );
  return [header, ...body].join('\n');
}

export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function csvFileName(view: 'clientes' | 'documentos', currency: ReceivablesCurrency): string {
  return `cxc-${view}-${currency.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
}
