import type { ForecastCustomerSalesHistoryMonth, ForecastCustomerSalesRow } from '@nexo/contracts';
import { CUSTOMER_TARGET_HISTORY_MONTHS, customerTargetMetrics } from './customer-targets';
import { MonthCalendar } from './sales-run-rate';

// ============================================================
// Clientes vs meta histórica.
//
// Cada cliente se mide contra su PROPIO promedio de los últimos 3 meses
// cerrados (solo meses con compra). La venta del mes a la fecha y su
// proyección de cierre salen de `customerTargetMetrics`.
//
// Además de la meta, se conservan las dos lecturas de participación:
//  · shareOfCustomerPct: peso del producto dentro de la compra del cliente.
//  · shareOfProductPct: peso del cliente dentro de la venta total del producto.
//
// Función PURA para poder probar la meta y el orden sin Prisma ni Profit.
// ============================================================

export interface CustomerProductSale {
  customerCode: string;
  productCode: string;
  kg: number;
  units: number;
}

export interface CustomerInfo {
  code: string;
  name: string;
  customerType: string | null;
  vendor: string | null;
}

export interface ProductInfo {
  description: string;
  uom: string;
  kgPerUom: number | null;
}

export interface CustomerShareTotals {
  actualKg: number;
  actualUnits: number;
  /** Suma de las metas históricas de los clientes. */
  targetKg: number;
  /** Suma de las proyecciones de cierre (null si el mes aún no tiene venta). */
  projectedKg: number | null;
  attainmentPct: number | null;
  projectedAttainmentPct: number | null;
  customerCount: number;
  activeCustomerCount: number;
  targetCustomerCount: number;
  productCount: number;
  lastInvoiceDate: string | null;
}

export interface CustomerShareResult {
  customers: ForecastCustomerSalesRow[];
  totals: CustomerShareTotals;
}

export interface BuildCustomerShareInput {
  sales: CustomerProductSale[];
  catalog: CustomerInfo[];
  products: Map<string, ProductInfo>;
  lastInvoiceByCustomer?: Map<string, string>;
  /** Meses cerrados de la ventana histórica, en orden cronológico. */
  historyWindow?: { year: number; month: number }[];
  /** Kg por cliente en el MISMO orden que `historyWindow` (ceros incluidos). */
  history?: Map<string, number[]>;
  /** Calendario del mes del informe: base del run-rate y de la proyección. */
  calendar: MonthCalendar;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function pct(part: number, total: number): number {
  return total > 0 ? round1((part / total) * 100) : 0;
}

/** Porcentaje que admite «sin meta» (null), a diferencia de `pct`. */
function ratioPct(part: number | null, total: number): number | null {
  if (part === null || total <= 0) return null;
  return round1((part / total) * 100);
}

export function buildCustomerShare(input: BuildCustomerShareInput): CustomerShareResult {
  const productTotals = new Map<string, { kg: number; units: number }>();
  const byCustomer = new Map<string, Map<string, { kg: number; units: number }>>();
  const salesCustomerCodes = new Set<string>();
  let totalKg = 0;
  let totalUnits = 0;

  for (const row of input.sales) {
    const customerCode = row.customerCode.trim();
    const productCode = row.productCode.trim();
    const kg = positive(row.kg);
    const units = positive(row.units);
    if (!customerCode || !productCode) continue;

    salesCustomerCodes.add(customerCode);
    totalKg += kg;
    totalUnits += units;

    const product = productTotals.get(productCode) ?? { kg: 0, units: 0 };
    product.kg += kg;
    product.units += units;
    productTotals.set(productCode, product);

    const perCustomer = byCustomer.get(customerCode) ?? new Map<string, { kg: number; units: number }>();
    const item = perCustomer.get(productCode) ?? { kg: 0, units: 0 };
    item.kg += kg;
    item.units += units;
    perCustomer.set(productCode, item);
    byCustomer.set(customerCode, perCustomer);
  }

  const historyWindow = (input.historyWindow ?? []).slice(0, CUSTOMER_TARGET_HISTORY_MONTHS);

  // Los clientes del histórico también entran: si compraron en los últimos
  // meses y este mes no, deben aparecer con su meta y 0 venta (a recuperar).
  const catalogByCode = new Map(input.catalog.map((customer) => [customer.code, customer]));
  const codes = new Set<string>([
    ...catalogByCode.keys(),
    ...salesCustomerCodes,
    ...(input.history?.keys() ?? []),
  ]);

  const customers: ForecastCustomerSalesRow[] = [...codes].map((customerCode) => {
    const info = catalogByCode.get(customerCode);
    const perCustomer = byCustomer.get(customerCode) ?? new Map<string, { kg: number; units: number }>();
    const customerKg = [...perCustomer.values()].reduce((acc, item) => acc + item.kg, 0);
    const customerUnits = [...perCustomer.values()].reduce((acc, item) => acc + item.units, 0);

    const historyValues = input.history?.get(customerCode) ?? [];
    const history: ForecastCustomerSalesHistoryMonth[] = historyWindow.map((month, index) => ({
      year: month.year,
      month: month.month,
      kg: positive(historyValues[index] ?? 0),
    }));
    const target = customerTargetMetrics({
      actualKg: customerKg,
      history,
      calendar: input.calendar,
    });

    const products = [...perCustomer.entries()]
      .map(([productCode, item]) => {
        const meta = input.products.get(productCode);
        const uom = meta?.uom ?? 'KG';
        const kgPerUom = meta?.kgPerUom ?? null;
        return {
          productCode,
          description: meta?.description ?? productCode,
          uom,
          kgPerUom,
          kg: round3(item.kg),
          units: round3(item.units),
          sacks:
            uom === 'SAC'
              ? round3(kgPerUom !== null && kgPerUom > 0 ? item.kg / kgPerUom : item.units)
              : null,
          shareOfCustomerPct: pct(item.kg, customerKg),
          shareOfProductPct: pct(item.kg, productTotals.get(productCode)?.kg ?? 0),
        };
      })
      .filter((product) => product.kg > 0)
      .sort(
        (a, b) =>
          b.kg - a.kg ||
          b.shareOfCustomerPct - a.shareOfCustomerPct ||
          a.productCode.localeCompare(b.productCode, 'es'),
      );

    return {
      customerCode,
      customerName: info?.name?.trim() || customerCode,
      customerType: info?.customerType ?? null,
      vendor: info?.vendor ?? null,
      history,
      targetKg: target.targetKg,
      targetMonths: target.targetMonths,
      actualKg: round3(customerKg),
      actualUnits: round3(customerUnits),
      sharePct: pct(customerKg, totalKg),
      productCount: products.length,
      lastInvoiceDate: input.lastInvoiceByCustomer?.get(customerCode) ?? null,
      dailyAvgKg: target.dailyAvgKg,
      projectedKg: target.projectedKg,
      attainmentPct: target.attainmentPct,
      projectedAttainmentPct: target.projectedAttainmentPct,
      gapKg: target.gapKg,
      requiredDailyKg: target.requiredDailyKg,
      products,
    };
  });

  // Prioridad comercial: primero el mayor promedio histórico (volumen que el
  // cliente venía comprando) y después la venta del mes. Los clientes sin meta
  // ni venta quedan al final.
  customers.sort(
    (a, b) =>
      b.targetKg - a.targetKg ||
      b.actualKg - a.actualKg ||
      a.customerName.localeCompare(b.customerName, 'es') ||
      a.customerCode.localeCompare(b.customerCode, 'es'),
  );

  const lastInvoiceDates = customers
    .map((customer) => customer.lastInvoiceDate)
    .filter((value): value is string => Boolean(value))
    .sort();

  const targetKg = round3(customers.reduce((acc, customer) => acc + customer.targetKg, 0));
  const projectedKg = customers.every((customer) => customer.projectedKg === null)
    ? null
    : round3(customers.reduce((acc, customer) => acc + (customer.projectedKg ?? 0), 0));

  return {
    customers,
    totals: {
      actualKg: round3(totalKg),
      actualUnits: round3(totalUnits),
      targetKg,
      projectedKg,
      attainmentPct: ratioPct(round3(totalKg), targetKg),
      projectedAttainmentPct: ratioPct(projectedKg, targetKg),
      customerCount: customers.length,
      activeCustomerCount: customers.filter((customer) => customer.actualKg > 0).length,
      targetCustomerCount: customers.filter((customer) => customer.targetKg > 0).length,
      productCount: productTotals.size,
      lastInvoiceDate: lastInvoiceDates.at(-1) ?? null,
    },
  };
}
