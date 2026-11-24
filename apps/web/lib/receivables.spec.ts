import type { ReceivablesClientRow, ReceivablesResponse } from '@nexo/contracts';
import { describe, expect, it } from 'vitest';
import {
  bucketAmount,
  buildDocumentsCsv,
  buildSummaryCsv,
  clientAging,
  formatCompactMoney,
  formatCount,
  formatPct,
  formatPctCompact,
  paymentLabel,
  segmentsFromBuckets,
  segmentsFromPaymentBuckets,
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
    d150Desde2025: 150,
    d150Hasta2025: 250,
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
    d150Desde2025: 150,
    d150Hasta2025: 250,
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
    expect(formatPctCompact(80.7)).toBe('80,7%');
    expect(formatCount(4388)).toBe('4.388');
    expect(formatCount(null)).toBe('—');
  });
});

describe('bucketAmount', () => {
  it('asigna cada llave a su columna del cliente', () => {
    const row = client();
    expect(bucketAmount(row, 'POR_VENCER')).toBe(100);
    expect(bucketAmount(row, 'D1_30')).toBe(100);
    expect(bucketAmount(row, 'D150_DESDE_2025')).toBe(150);
    expect(bucketAmount(row, 'D150_HASTA_2025')).toBe(250);
  });
});

describe('clientAging', () => {
  it('ordena los tramos y calcula el porcentaje de la barra', () => {
    const segments = clientAging(client());
    expect(segments.map((segment) => segment.key)).toEqual([
      'POR_VENCER',
      'D1_30',
      'D31_60',
      'D61_90',
      'D91_120',
      'D121_150',
      'D150_DESDE_2025',
      'D150_HASTA_2025',
    ]);
    expect(segments.map((segment) => segment.pct)).toEqual([10, 10, 10, 10, 10, 10, 15, 25]);
    expect(segments.reduce((sum, segment) => sum + segment.pct, 0)).toBe(100);
  });

  it('omite los tramos en cero y arma la mezcla global', () => {
    const row = client({
      porVencer: 300,
      d1_30: 0,
      d31_60: 100,
      d61_90: 0,
      d91_120: 0,
      d121_150: 0,
      d150Desde2025: 0,
      d150Hasta2025: 600,
    });
    expect(clientAging(row).map((segment) => segment.key)).toEqual([
      'POR_VENCER',
      'D31_60',
      'D150_HASTA_2025',
    ]);
    expect(segmentsFromBuckets([
      { key: 'POR_VENCER', label: 'Por vencer', short: 'Por vencer', amount: 300, pct: 30, documentos: 1 },
      { key: 'D1_30', label: '1 a 30 días', short: '1–30', amount: 700, pct: 70, documentos: 2 },
    ]).map((segment) => segment.pct)).toEqual([30, 70]);
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

describe('segmentsFromPaymentBuckets', () => {
  it('conserva las etiquetas de cobranza y descarta tramos vacíos', () => {
    const segments = segmentsFromPaymentBuckets([
      {
        key: 'POR_VENCER',
        label: 'Pagado a tiempo o antes del vencimiento',
        short: 'A tiempo',
        amount: 60,
        pct: 60,
        documentos: 4,
      },
      {
        key: 'D31_60',
        label: 'Pagado con 31 a 60 días de atraso',
        short: '31–60',
        amount: 0,
        pct: 0,
        documentos: 0,
      },
      {
        key: 'D1_30',
        label: 'Pagado con 1 a 30 días de atraso',
        short: '1–30',
        amount: 40,
        pct: 40,
        documentos: 1,
      },
    ]);
    expect(segments.map((segment) => segment.short)).toEqual(['A tiempo', '1–30']);
    expect(segments.map((segment) => segment.pct)).toEqual([60, 40]);
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

  it('suma los tramos de antigüedad de todos sus clientes', () => {
    const zero = {
      porVencer: 0,
      d1_30: 0,
      d31_60: 0,
      d61_90: 0,
      d91_120: 0,
      d121_150: 0,
      d150Desde2025: 0,
      d150Hasta2025: 0,
    };
    const rows = vendorRows([
      client({
        codigo: '1',
        vendedorCodigo: '031',
        vendedor: 'JUILIARD ANGULO',
        cartera: 100,
        vencido: 0,
        ...zero,
        porVencer: 100,
      }),
      client({
        codigo: '2',
        vendedorCodigo: '031',
        vendedor: 'JUILIARD ANGULO',
        cartera: 300,
        vencido: 300,
        ...zero,
        d1_30: 300,
      }),
    ]);
    expect(rows[0]?.buckets.POR_VENCER).toBe(100);
    expect(rows[0]?.buckets.D1_30).toBe(300);
    expect(rows[0]?.aging.map((segment) => segment.pct)).toEqual([25, 75]);
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
