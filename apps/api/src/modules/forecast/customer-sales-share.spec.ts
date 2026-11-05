import { describe, expect, it } from 'vitest';
import { buildCustomerShare } from './customer-sales-share';

// ============================================================
// Participación de clientes en la venta real del mes a la fecha.
// ============================================================

const PRODUCTS = new Map([
  ['P1', { description: 'PRODUCTO UNO', uom: 'SAC', kgPerUom: 40 }],
  ['P2', { description: 'PRODUCTO DOS', uom: 'KG', kgPerUom: null }],
]);

describe('buildCustomerShare', () => {
  it('calcula la participación de cada cliente sobre la venta total', () => {
    const result = buildCustomerShare({
      sales: [
        { customerCode: 'C1', productCode: 'P1', kg: 600, units: 15 },
        { customerCode: 'C2', productCode: 'P1', kg: 400, units: 10 },
      ],
      catalog: [
        { code: 'C1', name: 'CLIENTE UNO', customerType: 'L1', vendor: 'V1' },
        { code: 'C2', name: 'CLIENTE DOS', customerType: 'L2', vendor: 'V2' },
      ],
      products: PRODUCTS,
    });

    expect(result.totals.actualKg).toBe(1_000);
    expect(result.customers.map((row) => row.customerCode)).toEqual(['C1', 'C2']);
    expect(result.customers[0]!.sharePct).toBe(60);
    expect(result.customers[1]!.sharePct).toBe(40);
    expect(result.totals.activeCustomerCount).toBe(2);
  });

  it('calcula el peso del producto dentro del cliente y del cliente dentro del producto', () => {
    const result = buildCustomerShare({
      sales: [
        { customerCode: 'C1', productCode: 'P1', kg: 300, units: 7.5 },
        { customerCode: 'C1', productCode: 'P2', kg: 100, units: 100 },
        { customerCode: 'C2', productCode: 'P1', kg: 600, units: 15 },
      ],
      catalog: [
        { code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null },
        { code: 'C2', name: 'CLIENTE DOS', customerType: null, vendor: null },
      ],
      products: PRODUCTS,
    });

    const uno = result.customers.find((row) => row.customerCode === 'C1')!;
    const p1 = uno.products.find((product) => product.productCode === 'P1')!;
    const p2 = uno.products.find((product) => product.productCode === 'P2')!;

    // C1 vendió 400 kg: P1 pesa 75 % dentro del cliente.
    expect(p1.shareOfCustomerPct).toBe(75);
    expect(p2.shareOfCustomerPct).toBe(25);
    // El total de P1 fue 900 kg: C1 representa 33,3 % y C2 66,7 %.
    expect(p1.shareOfProductPct).toBe(33.3);
    expect(result.customers.find((row) => row.customerCode === 'C2')!.products[0]!.shareOfProductPct).toBe(66.7);
  });

  it('incluye clientes del catálogo sin venta con 0 %', () => {
    const result = buildCustomerShare({
      sales: [{ customerCode: 'C1', productCode: 'P1', kg: 500, units: 12.5 }],
      catalog: [
        { code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null },
        { code: 'C0', name: 'CLIENTE SIN VENTA', customerType: null, vendor: null },
      ],
      products: PRODUCTS,
    });

    const sinVenta = result.customers.find((row) => row.customerCode === 'C0')!;
    expect(sinVenta.actualKg).toBe(0);
    expect(sinVenta.sharePct).toBe(0);
    expect(sinVenta.products).toEqual([]);
    expect(result.totals.customerCount).toBe(2);
    expect(result.totals.activeCustomerCount).toBe(1);
  });

  it('incluye un cliente con venta que no está en el catálogo', () => {
    const result = buildCustomerShare({
      sales: [{ customerCode: 'NUEVO', productCode: 'P1', kg: 100, units: 2.5 }],
      catalog: [{ code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null }],
      products: PRODUCTS,
    });

    const nuevo = result.customers.find((row) => row.customerCode === 'NUEVO')!;
    expect(nuevo.customerName).toBe('NUEVO');
    expect(nuevo.sharePct).toBe(100);
  });

  it('convierte a sacos solo los productos SAC', () => {
    const result = buildCustomerShare({
      sales: [
        { customerCode: 'C1', productCode: 'P1', kg: 400, units: 10 },
        { customerCode: 'C1', productCode: 'P2', kg: 250, units: 250 },
      ],
      catalog: [{ code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null }],
      products: PRODUCTS,
    });

    const [sac, granel] = result.customers[0]!.products;
    expect(sac!.sacks).toBe(10);
    expect(granel!.sacks).toBeNull();
  });

  it('ordena por venta descendente y deja los ceros al final', () => {
    const result = buildCustomerShare({
      sales: [
        { customerCode: 'C2', productCode: 'P1', kg: 100, units: 2.5 },
        { customerCode: 'C1', productCode: 'P1', kg: 900, units: 22.5 },
      ],
      catalog: [
        { code: 'C0', name: 'SIN VENTA', customerType: null, vendor: null },
        { code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null },
        { code: 'C2', name: 'CLIENTE DOS', customerType: null, vendor: null },
      ],
      products: PRODUCTS,
    });

    expect(result.customers.map((row) => row.customerCode)).toEqual(['C1', 'C2', 'C0']);
  });

  it('sin ventas no divide por cero', () => {
    const result = buildCustomerShare({
      sales: [],
      catalog: [{ code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null }],
      products: PRODUCTS,
    });

    expect(result.customers[0]!.sharePct).toBe(0);
    expect(result.totals.actualKg).toBe(0);
    expect(result.totals.activeCustomerCount).toBe(0);
  });
});
