import type { ForecastCustomerSalesRow } from '@nexo/contracts';

// ============================================================
// Participación de clientes en la venta del mes a la fecha.
//
// Sin histórico ni meta: se suman los kg reales del mes por cliente y por
// producto, y se calculan dos porcentajes:
//  · producto dentro del cliente,
//  · cliente dentro de la venta total del producto.
//
// La función es pura para poder probar los porcentajes sin Prisma ni Profit.
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
  customerCount: number;
  activeCustomerCount: number;
  productCount: number;
  lastInvoiceDate: string | null;
}

export interface CustomerShareResult {
  customers: ForecastCustomerSalesRow[];
  totals: CustomerShareTotals;
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

export function buildCustomerShare(input: {
  sales: CustomerProductSale[];
  catalog: CustomerInfo[];
  products: Map<string, ProductInfo>;
  lastInvoiceByCustomer?: Map<string, string>;
}): CustomerShareResult {
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

  const catalogByCode = new Map(input.catalog.map((customer) => [customer.code, customer]));
  const codes = new Set<string>([...catalogByCode.keys(), ...salesCustomerCodes]);

  const customers: ForecastCustomerSalesRow[] = [...codes].map((customerCode) => {
    const info = catalogByCode.get(customerCode);
    const perCustomer = byCustomer.get(customerCode) ?? new Map<string, { kg: number; units: number }>();
    const customerKg = [...perCustomer.values()].reduce((acc, item) => acc + item.kg, 0);
    const customerUnits = [...perCustomer.values()].reduce((acc, item) => acc + item.units, 0);

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
      actualKg: round3(customerKg),
      actualUnits: round3(customerUnits),
      sharePct: pct(customerKg, totalKg),
      productCount: products.length,
      lastInvoiceDate: input.lastInvoiceByCustomer?.get(customerCode) ?? null,
      products,
    };
  });

  customers.sort(
    (a, b) =>
      b.actualKg - a.actualKg ||
      a.customerName.localeCompare(b.customerName, 'es') ||
      a.customerCode.localeCompare(b.customerCode, 'es'),
  );

  const lastInvoiceDates = customers
    .map((customer) => customer.lastInvoiceDate)
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    customers,
    totals: {
      actualKg: round3(totalKg),
      actualUnits: round3(totalUnits),
      customerCount: customers.length,
      activeCustomerCount: customers.filter((customer) => customer.actualKg > 0).length,
      productCount: productTotals.size,
      lastInvoiceDate: lastInvoiceDates.at(-1) ?? null,
    },
  };
}
