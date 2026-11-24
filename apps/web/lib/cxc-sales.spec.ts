import type { ReceivablesClientRow, SalesAnalyticsCustomer } from '@nexo/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildCxcSalesKpis,
  buildCxcSalesRows,
  cxcSalesStatusLabel,
  mergeSalesCustomers,
} from './cxc-sales';

function client(overrides: Partial<ReceivablesClientRow> = {}): ReceivablesClientRow {
  return {
    codigo: '153064128',
    nombre: 'JOSEF HENDRIX',
    vendedor: 'MEIDY',
    vendedorCodigo: '025',
    tipoCliente: 'L1',
    tipoClienteLabel: 'EXCLUSIVOS',
    zona: '024',
    zonaLabel: 'LARA',
    segmento: '09',
    segmentoLabel: 'PRODUCTOR',
    limiteCredito: 25000,
    plazoPago: 15,
    cartera: 1000,
    aFavor: 0,
    neto: 1000,
    porVencer: 100,
    d1_30: 100,
    d31_60: 100,
    d61_90: 100,
    d91_120: 100,
    d121_150: 100,
    d150Desde2025: 400,
    d150Hasta2025: 0,
    vencido: 900,
    pctVencido: 90,
    documentos: 7,
    vencidos: 6,
    notasCredito: 0,
    diasMaxVencido: 200,
    vencimientoMasAntiguo: '2026-04-01',
    ultimaEmision: '2026-11-01',
    ultimoPago: '2026-11-01T00:00:00.000Z',
    diasSinPago: 17,
    cobrado90: 60,
    cobrado12m: 500,
    cobrado12mATiempo: 400,
    pctCobranzaATiempo: 80,
    excedeLimite: false,
    ...overrides,
  };
}

function sale(overrides: Partial<SalesAnalyticsCustomer> = {}): SalesAnalyticsCustomer {
  return {
    code: '153064128',
    name: 'JOSEF HENDRIX',
    vendor: 'MEIDY',
    customerType: 'EXCLUSIVOS',
    kg: 5000,
    sacks: 140,
    notes: 3,
    billed: 1200,
    lastSaleDate: '2026-10-15',
    prevYearKg: 4000,
    yoyPct: 25,
    pendingKg: 0,
    pendingOrders: 0,
    status: 'ACTIVO',
    ...overrides,
  };
}

describe('buildCxcSalesRows', () => {
  it('cruza por código y marca al deudor sin compra', () => {
    const rows = buildCxcSalesRows(
      [
        client({ codigo: '1', nombre: 'CON VENTA' }),
        client({ codigo: '2', nombre: 'SIN VENTA' }),
      ],
      [sale({ code: '1' })],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.code === '1')?.status).toBe('MUY_VENCIDO');
    expect(rows.find((row) => row.code === '2')?.status).toBe('SIN_VENTA');
    expect(rows.find((row) => row.code === '2')?.sales).toBeNull();
  });

  it('incluye clientes con venta y sin deuda solo en el modo Todos', () => {
    const onlyDebt = buildCxcSalesRows([], [sale({ code: '9', name: 'SOLO VENTA' })]);
    expect(onlyDebt).toHaveLength(0);

    const all = buildCxcSalesRows([], [sale({ code: '9', name: 'SOLO VENTA' })], {
      includeWithoutDebt: true,
    });
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe('SIN_DEUDA');
    expect(cxcSalesStatusLabel(all[0]!.status)).toBe('Sin deuda');
  });
});

describe('buildCxcSalesKpis', () => {
  it('separa cartera de deudores con y sin compra', () => {
    const rows = buildCxcSalesRows(
      [
        client({ codigo: '1', cartera: 1000, vencido: 500 }),
        client({
          codigo: '2',
          cartera: 4000,
          vencido: 0,
          pctVencido: 0,
          porVencer: 4000,
          d1_30: 0,
          d31_60: 0,
          d61_90: 0,
          d91_120: 0,
          d121_150: 0,
          d150Desde2025: 0,
          d150Hasta2025: 0,
        }),
      ],
      [sale({ code: '1', billed: 200 })],
    );
    const kpis = buildCxcSalesKpis(rows);
    expect(kpis.cartera).toBe(5000);
    expect(kpis.vencido).toBe(500);
    expect(kpis.deudores).toBe(2);
    expect(kpis.deudoresConVenta).toBe(1);
    expect(kpis.carteraConVenta).toBe(1000);
    expect(kpis.pctCarteraConVenta).toBe(20);
    expect(kpis.deudoresSinVenta).toBe(1);
    expect(kpis.billed).toBe(200);
  });
});

describe('mergeSalesCustomers', () => {
  it('deduplica por código y conserva la primera fila', () => {
    const merged = mergeSalesCustomers(
      [sale({ code: '1', name: 'UNO' })],
      [sale({ code: '1', name: 'UNO DUPLICADO' }), sale({ code: '2', name: 'DOS' })],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.code === '1')?.name).toBe('UNO');
  });
});
