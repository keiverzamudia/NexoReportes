import type { ReceivablesClientRow, ReceivablesResponse } from '@nexo/contracts';
import { describe, expect, it } from 'vitest';
import {
  bucketAmount,
  buildDocumentsCsv,
  buildSummaryCsv,
  formatCompactMoney,
  formatCount,
  formatPct,
  paymentLabel,
  vendorRows,
} from './receivables';

function client(overrides: Partial<ReceivablesClientRow> = {}): ReceivablesClientRow {
  return {
    codigo: '153064128',
    nombre: 'JOSEF HENDRIX HERNANDEZ REYES',
    vendedor: 'JUILIARD ANGULO',
    vendedorCodigo: '031',
    tipoCliente: 'L1',
    tipoClienteLabel: 'EXCLUSIVOS',
    zona: '024',
    zonaLabel: 'LARA',
    segmento: '09',
    segmentoLabel: 'PRODUCTOR',
    limiteCredito: 25000,
    plazoPago: 15,
    cartera: 1000,
    aFavor: 100,
    neto: 900,
    porVencer: 100,
    d1_30: 100,
    d31_60: 100,
    d61_90: 100,
    d91_120: 100,
    d121_150: 100,
    d150Mas: 400,
    vencido: 900,
    pctVencido: 90,
    documentos: 7,
    vencidos: 6,
    notasCredito: 1,
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

const report = {
  asOf: '2026-11-18T12:00:00.000Z',
  generatedAt: '2026-11-18T12:00:01.000Z',
  moneda: 'USD',
  source: 'profit',
  filtros: {
    moneda: 'USD',
    q: '',
    vendedor: '',
    tipoCliente: '',
    zona: '',
    tipoDoc: '',
    desde: null,
    hasta: null,
    soloVencido: false,
    incluirAFavor: false,
  },
  totals: {
    cartera: 1000,
    aFavor: 100,
    neto: 900,
    porVencer: 100,
    d1_30: 100,
    d31_60: 100,
    d61_90: 100,
    d91_120: 100,
    d121_150: 100,
    d150Mas: 400,
    vencido: 900,
    pctVencido: 90,
    clientes: 1,
    clientesConDeuda: 1,
    clientesVencidos: 1,
    documentos: 7,
    documentosVencidos: 6,
    notasCredito: 1,
    diasMaxVencido: 200,
    diasPromedioVencido: 120,
    ticketPromedio: 142.86,
    concentracionTop5Pct: 100,
    cobrado90: 60,
    cobrado12m: 500,
    cobrado12mATiempo: 400,
    pctCobranzaATiempo: 80,
    pagos12m: 5,
    pagos12mATiempo: 4,
    clientesSinPago30: 0,
    montoSinPago30: 0,
    sinTasa: 0,
    sinVencimiento: 0,
  },
  buckets: [],
  risk: {
    topCliente: { codigo: '153064128', nombre: 'JOSEF', monto: 1000, pct: 100 },
    top5Pct: 100,
    clientesMas90: 1,
    montoMas90: 900,
    clientesMas150: 1,
    montoMas150: 400,
    clientesSinPago30: 0,
    montoSinPago30: 0,
    clientesSobreLimite: 0,
    montoSobreLimite: 0,
  },
  quality: { sinTasa: 0, sinVencimiento: 0, truncado: false },
  clientes: [client()],
  documentos: [
    {
      clienteCodigo: '153064128',
      clienteNombre: 'JOSEF HENDRIX HERNANDEZ REYES',
      vendedor: 'LIZ ANTONELLA PEREZ BAEZ',
      vendedorCodigo: '012',
      tipoDoc: 'FACT',
      nroDoc: 50001001,
      fechaEmision: '2026-10-01T00:00:00.000Z',
      fechaVencimiento: '2026-10-20T00:00:00.000Z',
      diasVencimiento: 10,
      tramo: 'D1_30',
      saldo: 100,
      montoOriginal: 120,
      esCredito: false,
      tipoCliente: 'L1',
      tipoClienteLabel: 'EXCLUSIVOS',
      zona: '024',
      segmento: '09',
    },
    {
      clienteCodigo: '153064128',
      clienteNombre: 'JOSEF HENDRIX HERNANDEZ REYES',
      vendedor: 'LIZ ANTONELLA PEREZ BAEZ',
      vendedorCodigo: '012',
      tipoDoc: 'ADEL',
      nroDoc: 60001,
      fechaEmision: '2026-11-01T00:00:00.000Z',
      fechaVencimiento: '2026-11-01T00:00:00.000Z',
      diasVencimiento: 3,
      tramo: null,
      saldo: 25,
      montoOriginal: 25,
      esCredito: true,
      tipoCliente: 'L1',
      tipoClienteLabel: 'EXCLUSIVOS',
      zona: '024',
      segmento: '09',
    },
  ],
  opciones: { vendedores: [], tipos: [], zonas: [], tiposDoc: [] },
} as unknown as ReceivablesResponse;

describe('formatCompactMoney', () => {
  it('compacta USD y Bs sin perder el orden de magnitud', () => {
    expect(formatCompactMoney(1_015_608.09, 'USD')).toBe('$ 1,0 M');
    expect(formatCompactMoney(820_053.52, 'USD')).toBe('$ 820 K');
    expect(formatCompactMoney(632_527_956.98, 'BS')).toBe('Bs 632,5 M');
    expect(formatCompactMoney(0, 'USD')).toBe('$ 0,00');
    expect(formatCompactMoney(null, 'USD')).toBe('—');
    expect(formatPct(80.7)).toBe('80,7 %');
    expect(formatCount(4388)).toBe('4.388');
    expect(formatCount(null)).toBe('—');
  });
});

describe('bucketAmount', () => {
  it('asigna cada llave a su columna del cliente', () => {
    const row = client();
    expect(bucketAmount(row, 'POR_VENCER')).toBe(100);
    expect(bucketAmount(row, 'D1_30')).toBe(100);
    expect(bucketAmount(row, 'D150_MAS')).toBe(400);
  });
});

describe('paymentLabel', () => {
  it('resume fecha y días sin abono', () => {
    expect(paymentLabel({ ultimoPago: '2026-11-01T00:00:00.000Z', diasSinPago: 17 })).toBe(
      '01/11/2026 · hace 17 d',
    );
    expect(paymentLabel({ ultimoPago: null, diasSinPago: null })).toBe('Sin abonos');
  });
});

describe('vendorRows', () => {
  it('agrupa la cartera por vendedor y calcula su mora', () => {
    const rows = vendorRows([
      client({ vendedorCodigo: '031', vendedor: 'JUILIARD ANGULO', cartera: 100, vencido: 50 }),
      client({ codigo: '2', vendedorCodigo: '031', vendedor: 'JUILIARD ANGULO', cartera: 300, vencido: 150 }),
      client({ codigo: '3', vendedorCodigo: '025', vendedor: 'MEIDY', cartera: 600, vencido: 0 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.vendedor).toBe('MEIDY');
    expect(rows[1]?.cartera).toBe(400);
    expect(rows[1]?.vencido).toBe(200);
    expect(rows[1]?.pctVencido).toBe(50);
    expect(rows[1]?.clientes).toBe(2);
  });
});

describe('CSV', () => {
  it('exporta el resumen con la matriz de tramos', () => {
    const csv = buildSummaryCsv(report);
    expect(csv.split('\n')[0]).toContain('Cartera');
    expect(csv.split('\n')[0]).toContain('1 a 30');
    expect(csv.split('\n')[0]).toContain('Más de 150');
    expect(csv.split('\n')[0]).toContain('Cobrado 12m');
    expect(csv.split('\n')[0]).toContain('% cobranza a tiempo');
    expect(csv).toContain('153064128');
    expect(csv).toContain('JUILIARD ANGULO');
    expect(csv.split('\n')[1]?.endsWith('500,80')).toBe(true);
  });

  it('exporta el detalle con la columna del tramo y el saldo a favor', () => {
    const csv = buildDocumentsCsv(report);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Tramo');
    expect(lines[0]).toContain('Más de 150');
    expect(lines[1]).toContain('FACT');
    expect(lines[1]).toContain('100');
    expect(lines[2]).toContain('A favor');
  });
});
