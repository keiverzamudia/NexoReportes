'use client';

// ============================================================
// Cruce Ventas + Cartera.
//
// El join es por código de cliente: la venta sale de la analítica comercial
// (notas de entrega + facturación CxC) y la deuda del análisis de vencimiento.
// La cartera es de HOY; la venta pertenece al año seleccionado. Esa diferencia
// se dice explícitamente en la vista.
// ============================================================

import type {
  Customer,
  ReceivablesClientRow,
  ReceivablesCurrency,
  SalesAnalyticsCurrency,
  SalesAnalyticsCustomer,
} from '@nexo/contracts';
import { RECEIVABLES_BUCKETS } from '@nexo/contracts';
import { bucketAmount, clientAging, type AgingSegment } from './receivables';

export type CxcSalesStatus = 'ACTIVO' | 'SIN_VENTA' | 'SIN_DEUDA' | 'MUY_VENCIDO';

export interface CxcSalesRow {
  code: string;
  name: string;
  vendor: string;
  client: ReceivablesClientRow | null;
  sales: SalesAnalyticsCustomer | null;
  cartera: number;
  vencido: number;
  pctVencido: number;
  documentos: number;
  vencidos: number;
  aging: AgingSegment[];
  status: CxcSalesStatus;
}

export function salesCurrencyFor(currency: ReceivablesCurrency): SalesAnalyticsCurrency {
  return currency === 'USD' ? 'USD' : 'VES';
}

/** Une dos listas de clientes de ventas sin duplicar códigos. */
export function mergeSalesCustomers(
  ...lists: SalesAnalyticsCustomer[][]
): SalesAnalyticsCustomer[] {
  const map = new Map<string, SalesAnalyticsCustomer>();
  for (const list of lists) {
    for (const row of list) {
      if (!map.has(row.code)) map.set(row.code, row);
    }
  }
  return [...map.values()];
}

function statusOf(
  client: ReceivablesClientRow | null,
  sales: SalesAnalyticsCustomer | null,
  salesKnown: boolean,
): CxcSalesStatus {
  const cartera = client?.cartera ?? 0;
  const kg = sales?.kg ?? 0;
  if (cartera <= 0 && kg > 0) return 'SIN_DEUDA';
  if (cartera > 0 && salesKnown && kg <= 0) return 'SIN_VENTA';
  if (cartera > 0) {
    const old =
      (client?.d91_120 ?? 0) +
      (client?.d121_150 ?? 0) +
      (client?.d150Desde2025 ?? 0) +
      (client?.d150Hasta2025 ?? 0);
    if ((client?.pctVencido ?? 0) >= 50 || old / Math.max(cartera, 1) >= 0.3) {
      return 'MUY_VENCIDO';
    }
  }
  return 'ACTIVO';
}

function makeRow(
  client: ReceivablesClientRow | null,
  sales: SalesAnalyticsCustomer | null,
  salesKnown: boolean,
): CxcSalesRow {
  const code = client?.codigo ?? sales?.code ?? '';
  return {
    code,
    name: client?.nombre ?? sales?.name ?? code,
    vendor: client?.vendedor || sales?.vendor || 'Sin vendedor',
    client,
    sales,
    cartera: client?.cartera ?? 0,
    vencido: client?.vencido ?? 0,
    pctVencido: client?.pctVencido ?? 0,
    documentos: client?.documentos ?? 0,
    vencidos: client?.vencidos ?? 0,
    aging: client ? clientAging(client) : [],
    status: statusOf(client, sales, salesKnown),
  };
}

/**
 * Cruce de clientes. Por defecto solo deudores (`includeWithoutDebt: false`);
 * con `true` también incluye clientes que compraron y hoy no deben.
 */
export function buildCxcSalesRows(
  clients: ReceivablesClientRow[],
  salesCustomers: SalesAnalyticsCustomer[],
  options: { includeWithoutDebt?: boolean; salesKnown?: boolean } = {},
): CxcSalesRow[] {
  const includeWithoutDebt = options.includeWithoutDebt ?? false;
  const salesKnown = options.salesKnown ?? true;
  const salesByCode = new Map(salesCustomers.map((row) => [row.code, row]));
  const seen = new Set<string>();
  const rows: CxcSalesRow[] = [];

  for (const client of clients) {
    const sales = salesByCode.get(client.codigo) ?? null;
    if (!includeWithoutDebt && client.cartera <= 0) continue;
    if (includeWithoutDebt && client.cartera <= 0 && (sales?.kg ?? 0) <= 0) continue;
    rows.push(makeRow(client, sales, salesKnown));
    seen.add(client.codigo);
  }

  if (includeWithoutDebt) {
    for (const sales of salesCustomers) {
      if (seen.has(sales.code)) continue;
      if (sales.kg <= 0) continue;
      rows.push(makeRow(null, sales, salesKnown));
    }
  }

  return rows.sort(
    (a, b) => b.cartera - a.cartera || a.name.localeCompare(b.name, 'es'),
  );
}

export interface CxcSalesKpis {
  cartera: number;
  vencido: number;
  pctVencido: number;
  kg: number;
  billed: number;
  notas: number;
  clientes: number;
  deudores: number;
  deudoresConVenta: number;
  carteraConVenta: number;
  pctCarteraConVenta: number;
  deudoresSinVenta: number;
  carteraSinVenta: number;
  clientesSinDeuda: number;
}

export function buildCxcSalesKpis(rows: CxcSalesRow[]): CxcSalesKpis {
  let cartera = 0;
  let vencido = 0;
  let kg = 0;
  let billed = 0;
  let notas = 0;
  let deudores = 0;
  let deudoresConVenta = 0;
  let carteraConVenta = 0;
  let deudoresSinVenta = 0;
  let carteraSinVenta = 0;
  let clientesSinDeuda = 0;

  for (const row of rows) {
    cartera += row.cartera;
    vencido += row.vencido;
    kg += row.sales?.kg ?? 0;
    billed += row.sales?.billed ?? 0;
    notas += row.sales?.notes ?? 0;
    if (row.cartera > 0) {
      deudores += 1;
      if ((row.sales?.kg ?? 0) > 0) {
        deudoresConVenta += 1;
        carteraConVenta += row.cartera;
      } else {
        deudoresSinVenta += 1;
        carteraSinVenta += row.cartera;
      }
    } else if ((row.sales?.kg ?? 0) > 0) {
      clientesSinDeuda += 1;
    }
  }

  return {
    cartera,
    vencido,
    pctVencido: cartera > 0 ? (vencido / cartera) * 100 : 0,
    kg,
    billed,
    notas,
    clientes: rows.length,
    deudores,
    deudoresConVenta,
    carteraConVenta,
    pctCarteraConVenta: cartera > 0 ? (carteraConVenta / cartera) * 100 : 0,
    deudoresSinVenta,
    carteraSinVenta,
    clientesSinDeuda,
  };
}

export function cxcSalesStatusLabel(status: CxcSalesStatus): string {
  switch (status) {
    case 'SIN_VENTA':
      return 'Sin compra';
    case 'SIN_DEUDA':
      return 'Sin deuda';
    case 'MUY_VENCIDO':
      return 'Muy vencido';
    default:
      return 'Activo';
  }
}

export function cxcSalesStatusTone(
  status: CxcSalesStatus,
): 'success' | 'warning' | 'danger' | 'muted' {
  switch (status) {
    case 'SIN_VENTA':
      return 'warning';
    case 'SIN_DEUDA':
      return 'success';
    case 'MUY_VENCIDO':
      return 'danger';
    default:
      return 'success';
  }
}

export function cxcRowToCustomer(row: CxcSalesRow): Customer {
  return {
    id: row.code,
    externalCode: row.code,
    name: row.name,
    customerType: row.client?.tipoClienteLabel ?? row.sales?.customerType ?? null,
    vendor: row.vendor,
    isActive: true,
    ordersCount: row.sales?.pendingOrders ?? 0,
    sales: null,
  };
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value) : value;
  return /[",;\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(values: Array<string | number | null | undefined>): string {
  return values.map(csvCell).join(',');
}

export function buildCxcSalesCsv(
  rows: CxcSalesRow[],
  currency: ReceivablesCurrency,
  year: number,
): string {
  const header = csvLine([
    'Código',
    'Cliente',
    'Vendedor',
    `Vendido ${year} (kg)`,
    `Facturado ${year}`,
    'Cartera actual',
    'Vencido',
    '% vencido',
    'Por vencer',
    '1 a 30',
    '31 a 60',
    '61 a 90',
    '91 a 120',
    '121 a 150',
    'Más de 150 · 2025+',
    'Más de 150 · ≤ 2024',
    'Estado',
    'Notas',
    'Última compra',
  ]);

  const body = rows.map((row) => {
    const amounts = Object.fromEntries(
      RECEIVABLES_BUCKETS.map((bucket) => [
        bucket.key,
        row.client ? bucketAmount(row.client, bucket.key) : 0,
      ]),
    ) as Record<string, number>;
    return csvLine([
      row.code,
      row.name,
      row.vendor,
      row.sales?.kg ?? '',
      row.sales?.billed ?? '',
      row.cartera,
      row.vencido,
      row.pctVencido,
      amounts.POR_VENCER,
      amounts.D1_30,
      amounts.D31_60,
      amounts.D61_90,
      amounts.D91_120,
      amounts.D121_150,
      amounts.D150_DESDE_2025,
      amounts.D150_HASTA_2025,
      cxcSalesStatusLabel(row.status),
      row.sales?.notes ?? '',
      row.sales?.lastSaleDate ?? '',
    ]);
  });

  return [
    `# Cruce ventas + cartera · ${year} · ${currency} · cartera al día`,
    header,
    ...body,
  ].join('\n');
}
