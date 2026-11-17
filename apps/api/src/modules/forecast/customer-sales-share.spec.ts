import { describe, expect, it } from 'vitest';
import { buildCustomerShare } from './customer-sales-share';
import { monthCalendar } from './sales-run-rate';

// ============================================================
// Clientes vs meta histórica.
// ============================================================

const PRODUCTS = new Map([
  ['P1', { description: 'PRODUCTO UNO', uom: 'SAC', kgPerUom: 40 }],
  ['P2', { description: 'PRODUCTO DOS', uom: 'KG', kgPerUom: null }],
]);

// Octubre 2026 en curso con corte al 28 (hoy 29 en Caracas).
const CALENDAR = monthCalendar({
  year: 2026,
  month: 10,
  basis: 'WORKING',
  today: '2026-10-29',
});

describe('buildCustomerShare', () => {
  it('calcula la participación y la meta histórica de cada cliente', () => {
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
      historyWindow: [
        { year: 2026, month: 7 },
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ],
      history: new Map([
        // C1 compró los 3 meses: meta = (300 + 300 + 600) / 3 = 400.
        ['C1', [300, 300, 600]],
        // C2 compró solo septiembre: meta = 400 (ese mes pesa 100 %).
        ['C2', [0, 0, 400]],
      ]),
      calendar: CALENDAR,
    });

    expect(result.totals.actualKg).toBe(1_000);
    expect(result.totals.targetKg).toBe(800);
    expect(result.totals.targetCustomerCount).toBe(2);
    expect(result.customers.map((row) => row.customerCode)).toEqual(['C1', 'C2']);

    const uno = result.customers.find((row) => row.customerCode === 'C1')!;
    const dos = result.customers.find((row) => row.customerCode === 'C2')!;
    expect(uno.targetKg).toBe(400);
    expect(uno.targetMonths).toBe(3);
    expect(dos.targetKg).toBe(400);
    expect(dos.targetMonths).toBe(1);
    expect(uno.actualKg).toBe(600);
    expect(uno.sharePct).toBe(60);
    expect(dos.sharePct).toBe(40);
  });

  it('los meses sin compra no entran al promedio', () => {
    const result = buildCustomerShare({
      sales: [],
      catalog: [{ code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null }],
      products: PRODUCTS,
      historyWindow: [
        { year: 2026, month: 7 },
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ],
      history: new Map([['C1', [0, 150, 450]]]),
      calendar: CALENDAR,
    });

    const uno = result.customers[0]!;
    expect(uno.targetKg).toBe(300);
    expect(uno.targetMonths).toBe(2);
    expect(uno.actualKg).toBe(0);
    // Sin venta este mes: proyección 0 al ritmo actual.
    expect(uno.projectedKg).toBe(0);
    expect(uno.projectedAttainmentPct).toBe(0);
  });

  it('proyecta el cierre del cliente con el run-rate del mes en curso', () => {
    const result = buildCustomerShare({
      sales: [{ customerCode: 'C1', productCode: 'P1', kg: 60_000, units: 1_500 }],
      catalog: [{ code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null }],
      products: PRODUCTS,
      historyWindow: [
        { year: 2026, month: 7 },
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ],
      history: new Map([['C1', [90_000, 90_000, 90_000]]]),
      calendar: CALENDAR,
    });

    const uno = result.customers[0]!;
    expect(uno.targetKg).toBe(90_000);
    expect(uno.attainmentPct).toBeCloseTo(66.7, 1);
    // La proyección de cierre siempre supera lo vendido a mitad de mes.
    expect(uno.projectedKg).toBeGreaterThan(uno.actualKg);
    expect(uno.projectedAttainmentPct).toBeGreaterThan(uno.attainmentPct!);
    expect(uno.requiredDailyKg).toBeGreaterThan(0);
  });

  it('ordena por meta histórica y deja los ceros al final', () => {
    const result = buildCustomerShare({
      sales: [
        { customerCode: 'C1', productCode: 'P1', kg: 900, units: 22.5 },
        { customerCode: 'C2', productCode: 'P1', kg: 100, units: 2.5 },
      ],
      catalog: [
        { code: 'C0', name: 'SIN VENTA', customerType: null, vendor: null },
        { code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null },
        { code: 'C2', name: 'CLIENTE DOS', customerType: null, vendor: null },
      ],
      products: PRODUCTS,
      historyWindow: [
        { year: 2026, month: 7 },
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ],
      // C2 venía comprando mucho más que C1 aunque este mes venda menos.
      history: new Map([
        ['C1', [100, 100, 100]],
        ['C2', [900, 900, 900]],
      ]),
      calendar: CALENDAR,
    });

    expect(result.customers.map((row) => row.customerCode)).toEqual(['C2', 'C1', 'C0']);
  });

  it('incluye clientes del histórico que no compraron este mes', () => {
    const result = buildCustomerShare({
      sales: [],
      catalog: [],
      products: PRODUCTS,
      historyWindow: [
        { year: 2026, month: 7 },
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ],
      history: new Map([['C9', [1_000, 2_000, 3_000]]]),
      calendar: CALENDAR,
    });

    const recuperar = result.customers.find((row) => row.customerCode === 'C9')!;
    expect(recuperar.targetKg).toBe(2_000);
    expect(recuperar.actualKg).toBe(0);
    expect(recuperar.customerName).toBe('C9');
    expect(result.totals.activeCustomerCount).toBe(0);
    expect(result.totals.targetCustomerCount).toBe(1);
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
      calendar: CALENDAR,
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

  it('incluye clientes del catálogo sin venta con 0 % y sin meta', () => {
    const result = buildCustomerShare({
      sales: [{ customerCode: 'C1', productCode: 'P1', kg: 500, units: 12.5 }],
      catalog: [
        { code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null },
        { code: 'C0', name: 'CLIENTE SIN VENTA', customerType: null, vendor: null },
      ],
      products: PRODUCTS,
      calendar: CALENDAR,
    });

    const sinVenta = result.customers.find((row) => row.customerCode === 'C0')!;
    expect(sinVenta.actualKg).toBe(0);
    expect(sinVenta.sharePct).toBe(0);
    expect(sinVenta.targetKg).toBe(0);
    expect(sinVenta.targetMonths).toBe(0);
    expect(sinVenta.projectedAttainmentPct).toBeNull();
    expect(sinVenta.products).toEqual([]);
    expect(result.totals.customerCount).toBe(2);
    expect(result.totals.activeCustomerCount).toBe(1);
  });

  it('incluye un cliente con venta que no está en el catálogo', () => {
    const result = buildCustomerShare({
      sales: [{ customerCode: 'NUEVO', productCode: 'P1', kg: 100, units: 2.5 }],
      catalog: [{ code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null }],
      products: PRODUCTS,
      calendar: CALENDAR,
    });

    const nuevo = result.customers.find((row) => row.customerCode === 'NUEVO')!;
    expect(nuevo.customerName).toBe('NUEVO');
    expect(nuevo.sharePct).toBe(100);
    expect(nuevo.targetKg).toBe(0);
  });

  it('convierte a sacos solo los productos SAC', () => {
    const result = buildCustomerShare({
      sales: [
        { customerCode: 'C1', productCode: 'P1', kg: 400, units: 10 },
        { customerCode: 'C1', productCode: 'P2', kg: 250, units: 250 },
      ],
      catalog: [{ code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null }],
      products: PRODUCTS,
      calendar: CALENDAR,
    });

    const [sac, granel] = result.customers[0]!.products;
    expect(sac!.sacks).toBe(10);
    expect(granel!.sacks).toBeNull();
  });

  it('sin ventas no divide por cero', () => {
    const result = buildCustomerShare({
      sales: [],
      catalog: [{ code: 'C1', name: 'CLIENTE UNO', customerType: null, vendor: null }],
      products: PRODUCTS,
      calendar: CALENDAR,
    });

    expect(result.customers[0]!.sharePct).toBe(0);
    expect(result.totals.actualKg).toBe(0);
    expect(result.totals.targetKg).toBe(0);
    expect(result.totals.projectedAttainmentPct).toBeNull();
    expect(result.totals.activeCustomerCount).toBe(0);
  });
});
