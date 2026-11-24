import { describe, expect, it } from 'vitest';
import {
  aggregate,
  bucketOfDays,
  bucketOfDoc,
  documentsForOutput,
  filterDocs,
  mapPaymentAging,
  mapPayments,
  mapRawDoc,
  optionsFromDocs,
  ReceivablesDoc,
} from './receivables.calculations';

// ============================================================
// Reglas de negocio de CxC: tramos, signo de créditos, conversión,
// filtros y agregados por cliente.
// ============================================================

function rawDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    co_cli: '153064128',
    cli_des: 'JOSEF HENDRIX HERNANDEZ REYES',
    co_ven: '012',
    ven_des: 'LIZ ANTONELLA PEREZ BAEZ',
    co_ven_cartera: '031',
    ven_des_cartera: 'JUILIARD ANGULO',
    tipo_doc: 'FACT',
    nro_doc: 50001001,
    fec_emis: '2026-10-01T00:00:00.000Z',
    fec_venc: '2026-10-20T00:00:00.000Z',
    dias_venc: 10,
    monto_net: 9200,
    saldo: 8800,
    tasa: 880,
    tipo_cli: 'L1',
    tipo_des: 'EXCLUSIVOS',
    co_zon: '024',
    zona_des: 'LARA',
    co_seg: '09',
    seg_des: 'PRODUCTOR',
    mont_cre: 25000,
    plaz_pag: 15,
    as_of: '2026-11-18T12:00:00.000Z',
    ...overrides,
  };
}

function doc(overrides: Partial<ReceivablesDoc> = {}): ReceivablesDoc {
  return {
    ...mapRawDoc(rawDoc()),
    ...overrides,
  };
}

describe('bucketOfDays', () => {
  it('respeta los límites de los tramos del reporte de Profit', () => {
    expect(bucketOfDays(null)).toBe('POR_VENCER');
    expect(bucketOfDays(-20)).toBe('POR_VENCER');
    expect(bucketOfDays(0)).toBe('POR_VENCER');
    expect(bucketOfDays(1)).toBe('D1_30');
    expect(bucketOfDays(30)).toBe('D1_30');
    expect(bucketOfDays(31)).toBe('D31_60');
    expect(bucketOfDays(60)).toBe('D31_60');
    expect(bucketOfDays(61)).toBe('D61_90');
    expect(bucketOfDays(90)).toBe('D61_90');
    expect(bucketOfDays(91)).toBe('D91_120');
    expect(bucketOfDays(120)).toBe('D91_120');
    expect(bucketOfDays(121)).toBe('D121_150');
    expect(bucketOfDays(150)).toBe('D121_150');
    expect(bucketOfDays(151)).toBe('D150_DESDE_2025');
  });
});

describe('bucketOfDoc', () => {
  it('parte la mora extrema en dos según la fecha de vencimiento', () => {
    expect(bucketOfDoc(200, '2026-05-01T00:00:00.000Z')).toBe('D150_DESDE_2025');
    expect(bucketOfDoc(200, '2024-03-01T00:00:00.000Z')).toBe('D150_HASTA_2025');
    // El 01/01/2025 entra en el tramo viejo.
    expect(bucketOfDoc(700, '2025-01-01T00:00:00.000Z')).toBe('D150_HASTA_2025');
    expect(bucketOfDoc(699, '2025-01-02T00:00:00.000Z')).toBe('D150_DESDE_2025');
  });

  it('no toca los tramos anteriores ni los documentos sin vencimiento', () => {
    expect(bucketOfDoc(10, '2024-01-01T00:00:00.000Z')).toBe('D1_30');
    expect(bucketOfDoc(null, null)).toBe('POR_VENCER');
  });
});

describe('mapRawDoc', () => {
  it('convierte el saldo con la tasa del documento y conserva el monto original', () => {
    const mapped = mapRawDoc(rawDoc());
    expect(mapped.saldoBs).toBe(8800);
    expect(mapped.saldoUsd).toBe(10);
    expect(mapped.montoOriginalUsd).toBe(10.45);
    expect(mapped.tramo).toBe('D1_30');
    expect(mapped.vendedor).toBe('LIZ ANTONELLA PEREZ BAEZ');
    expect(mapped.vendedorCartera).toBe('JUILIARD ANGULO');
    expect(mapped.esCredito).toBe(false);
  });

  it('marca adelantos y notas de crédito como a favor, sin tramo de mora', () => {
    const mapped = mapRawDoc(rawDoc({ tipo_doc: 'ADEL', nro_doc: 60001 }));
    expect(mapped.esCredito).toBe(true);
    expect(mapped.tramo).toBeNull();
  });

  it('no inventa USD cuando el documento no tiene tasa', () => {
    const mapped = mapRawDoc(rawDoc({ tasa: 0 }));
    expect(mapped.sinTasa).toBe(true);
    expect(mapped.saldoUsd).toBeNull();
    expect(mapped.saldoBs).toBe(8800);
  });

  it('trata un documento sin vencimiento como por vencer y lo reporta', () => {
    const mapped = mapRawDoc(rawDoc({ fec_venc: null, dias_venc: null }));
    expect(mapped.sinVencimiento).toBe(true);
    expect(mapped.diasVencimiento).toBe(0);
    expect(mapped.tramo).toBe('POR_VENCER');
  });
});

describe('aggregate', () => {
  const docs: ReceivablesDoc[] = [
    doc({ nroDoc: 1, tipoDoc: 'FACT', diasVencimiento: 10, tramo: 'D1_30', saldoUsd: 100, saldoBs: 100 }),
    doc({ nroDoc: 2, tipoDoc: 'FACT', diasVencimiento: 45, tramo: 'D31_60', saldoUsd: 200, saldoBs: 200 }),
    doc({
      nroDoc: 3,
      tipoDoc: 'FACT',
      diasVencimiento: 200,
      tramo: 'D150_DESDE_2025',
      fechaVencimiento: '2026-05-01T00:00:00.000Z',
      saldoUsd: 300,
      saldoBs: 300,
    }),
    doc({ nroDoc: 4, tipoDoc: 'FACT', diasVencimiento: 0, tramo: 'POR_VENCER', saldoUsd: 50, saldoBs: 50 }),
    doc({
      nroDoc: 5,
      tipoDoc: 'ADEL',
      esCredito: true,
      tramo: null,
      diasVencimiento: 3,
      saldoUsd: 25,
      saldoBs: 25,
      montoOriginalUsd: 25,
      montoOriginalBs: 25,
    }),
  ];
  const payments = mapPayments([
    {
      co_cli: '153064128',
      ultimo_pago: '2026-11-01T00:00:00.000Z',
      dias_sin_pago: 17,
      cobrado_90_bs: 60000,
      cobrado_90_usd: 60,
      cobrado_12m_bs: 180000,
      cobrado_12m_usd: 200,
      cobrado_12m_a_tiempo_bs: 120000,
      cobrado_12m_a_tiempo_usd: 130,
      pagos_12m: 5,
      pagos_12m_a_tiempo: 3,
    },
  ]);

  it('separa créditos, calcula tramos y deja el neto', () => {
    const result = aggregate(docs, payments, 'USD');
    expect(result.clientes).toHaveLength(1);
    const row = result.clientes[0]!;
    expect(row.cartera).toBe(650);
    expect(row.aFavor).toBe(25);
    expect(row.neto).toBe(625);
    expect(row.porVencer).toBe(50);
    expect(row.d1_30).toBe(100);
    expect(row.d31_60).toBe(200);
    expect(row.d150Desde2025).toBe(300);
    expect(row.d150Hasta2025).toBe(0);
    expect(row.vencido).toBe(600);
    expect(row.documentos).toBe(4);
    expect(row.vencidos).toBe(3);
    expect(row.notasCredito).toBe(1);
    expect(row.pctVencido).toBe(92.31);
    expect(row.ultimoPago).toBe('2026-11-01T00:00:00.000Z');
    expect(row.diasSinPago).toBe(17);
    expect(row.cobrado90).toBe(60);
    expect(row.cobrado12m).toBe(200);
    expect(row.cobrado12mATiempo).toBe(130);
    expect(row.pctCobranzaATiempo).toBe(65);
  });

  it('cuadra los totales con las filas y calcula la antigüedad ponderada', () => {
    const result = aggregate(docs, payments, 'USD');
    const totals = result.totals;
    expect(totals.cartera).toBe(650);
    expect(totals.aFavor).toBe(25);
    expect(totals.neto).toBe(625);
    expect(totals.vencido).toBe(600);
    expect(totals.pctVencido).toBe(92.31);
    expect(totals.clientes).toBe(1);
    expect(totals.clientesConDeuda).toBe(1);
    expect(totals.clientesVencidos).toBe(1);
    expect(totals.documentos).toBe(4);
    expect(totals.documentosVencidos).toBe(3);
    expect(totals.notasCredito).toBe(1);
    expect(totals.diasMaxVencido).toBe(200);
    expect(totals.diasPromedioVencido).toBe(116.67);
    expect(totals.ticketPromedio).toBe(162.5);
    expect(totals.concentracionTop5Pct).toBe(100);
    expect(totals.cobrado90).toBe(60);
    expect(totals.cobrado12m).toBe(200);
    expect(totals.cobrado12mATiempo).toBe(130);
    expect(totals.pctCobranzaATiempo).toBe(65);
    expect(totals.pagos12m).toBe(5);
    expect(totals.pagos12mATiempo).toBe(3);
    expect(result.buckets.map((bucket) => bucket.amount)).toEqual([
      50, 100, 200, 0, 0, 0, 300, 0,
    ]);
    expect(result.buckets.map((bucket) => bucket.documentos)).toEqual([
      1, 1, 1, 0, 0, 0, 1, 0,
    ]);
  });

  it('calcula concentración y riesgo de mora', () => {
    const result = aggregate(docs, payments, 'USD');
    expect(result.risk.topCliente?.codigo).toBe('153064128');
    expect(result.risk.topCliente?.pct).toBe(100);
    expect(result.risk.clientesMas90).toBe(1);
    expect(result.risk.montoMas90).toBe(300);
    expect(result.risk.clientesMas150).toBe(1);
    expect(result.risk.montoMas150).toBe(300);
    expect(result.risk.clientesSinPago30).toBe(0);
  });

  it('en Bs usa el saldo nativo y no compara el límite USD', () => {
    const result = aggregate(docs, payments, 'BS');
    const row = result.clientes[0]!;
    expect(row.cartera).toBe(650);
    expect(row.cobrado90).toBe(60000);
    expect(row.cobrado12m).toBe(180000);
    expect(row.cobrado12mATiempo).toBe(120000);
    expect(row.pctCobranzaATiempo).toBe(66.67);
    expect(row.excedeLimite).toBe(false);
  });

  it('pondera el % a tiempo por monto, no por cantidad de clientes', () => {
    const twoClients = [
      doc({ clienteCodigo: 'A', clienteNombre: 'CLIENTE A', nroDoc: 1 }),
      doc({ clienteCodigo: 'B', clienteNombre: 'CLIENTE B', nroDoc: 2 }),
    ];
    const weighted = mapPayments([
      {
        co_cli: 'A',
        cobrado_12m_usd: 900,
        cobrado_12m_a_tiempo_usd: 900,
        pagos_12m: 1,
        pagos_12m_a_tiempo: 1,
      },
      {
        co_cli: 'B',
        cobrado_12m_usd: 100,
        cobrado_12m_a_tiempo_usd: 0,
        pagos_12m: 1,
        pagos_12m_a_tiempo: 0,
      },
    ]);

    const result = aggregate(twoClients, weighted, 'USD');
    expect(result.clientes.find((row) => row.codigo === 'A')?.pctCobranzaATiempo).toBe(100);
    expect(result.clientes.find((row) => row.codigo === 'B')?.pctCobranzaATiempo).toBe(0);
    expect(result.totals.pctCobranzaATiempo).toBe(90);
    expect(result.totals.pagos12m).toBe(2);
    expect(result.totals.pagos12mATiempo).toBe(1);
  });

  it('deja el % a tiempo en null cuando el cliente no tiene cobros', () => {
    const result = aggregate([doc()], new Map(), 'USD');
    expect(result.clientes[0]?.cobrado12m).toBe(0);
    expect(result.clientes[0]?.pctCobranzaATiempo).toBeNull();
    expect(result.totals.cobrado12m).toBe(0);
    expect(result.totals.pctCobranzaATiempo).toBeNull();
    expect(result.totals.pagos12m).toBe(0);
  });
});

describe('filterDocs', () => {
  const docs = [
    doc({ clienteCodigo: '153064128', clienteNombre: 'JOSEF HERNÁNDEZ', vendedorCarteraCodigo: '031' }),
    doc({
      clienteCodigo: '505835220',
      clienteNombre: 'AGRO INVERSIONES MP',
      vendedorCarteraCodigo: '025',
      tipoCliente: 'L2',
      zona: '014',
      tipoDoc: 'ADEL',
      fechaEmision: '2026-09-01T00:00:00.000Z',
      esCredito: true,
      tramo: null,
    }),
  ];

  it('busca sin acentos ni mayúsculas', () => {
    expect(filterDocs(docs, { q: 'hernandez' })).toHaveLength(1);
    expect(filterDocs(docs, { q: 'agro' })[0]?.clienteCodigo).toBe('505835220');
  });

  it('filtra por vendedor, tipo, zona, tipo de documento y fecha', () => {
    expect(filterDocs(docs, { vendedor: '025' })[0]?.clienteCodigo).toBe('505835220');
    expect(filterDocs(docs, { tipoCliente: 'L1' })).toHaveLength(1);
    expect(filterDocs(docs, { zona: '014' })).toHaveLength(1);
    expect(filterDocs(docs, { tipoDoc: 'ADEL' })[0]?.clienteCodigo).toBe('505835220');
    expect(filterDocs(docs, { desde: '2026-09-02' })).toHaveLength(1);
    expect(filterDocs(docs, { hasta: '2026-09-02' })).toHaveLength(1);
  });

  it('con Solo vencido elimina por vencer y créditos, sin afectar el resumen normal', () => {
    const normal = filterDocs(docs, {});
    expect(normal).toHaveLength(2);
    const overdue = filterDocs(docs, { soloVencido: true });
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.clienteCodigo).toBe('153064128');
  });
});

describe('documentsForOutput', () => {
  const docs = [
    doc({ nroDoc: 1, diasVencimiento: 10, tramo: 'D1_30', saldoUsd: 100 }),
    doc({ nroDoc: 2, esCredito: true, tramo: null, diasVencimiento: 0, saldoUsd: 20 }),
    doc({ nroDoc: 3, diasVencimiento: 200, tramo: 'D150_DESDE_2025', saldoUsd: 300 }),
  ];

  it('excluye créditos por defecto y los incluye cuando se piden', () => {
    expect(documentsForOutput(docs, 'USD', false).map((row) => row.nroDoc)).toEqual([3, 1]);
    expect(documentsForOutput(docs, 'USD', true).map((row) => row.nroDoc)).toEqual([3, 1, 2]);
  });

  it('ordena por mora descendente y deja los créditos al final', () => {
    const rows = documentsForOutput(docs, 'USD', true);
    expect(rows[0]?.nroDoc).toBe(3);
    expect(rows[rows.length - 1]?.esCredito).toBe(true);
  });
});

describe('optionsFromDocs', () => {
  it('arma las opciones de filtros sin duplicados y con etiquetas legibles', () => {
    const options = optionsFromDocs([
      doc(),
      doc({ vendedorCarteraCodigo: '031', vendedorCartera: 'JUILIARD ANGULO' }),
      doc({ tipoCliente: 'L2', tipoClienteLabel: 'DISTRIBUIDORES' }),
      doc({ tipoDoc: 'ADEL' }),
    ]);
    expect(options.vendedores).toHaveLength(1);
    expect(options.vendedores[0]?.label).toContain('JUILIARD ANGULO');
    expect(options.tipos.map((option) => option.value)).toContain('L2');
    expect(options.zonas[0]?.label).toContain('LARA');
    expect(options.tiposDoc.map((option) => option.value)).toEqual(['ADEL', 'FACT']);
  });
});

describe('mapPaymentAging', () => {
  const rows = [
    { tramo: 'POR_VENCER', monto_bs: 52800, monto_usd: 60, pagos: 4 },
    { tramo: 'D1_30', monto_bs: 17600, monto_usd: 20, pagos: 2 },
    { tramo: 'D150_DESDE_2025', monto_bs: 8800, monto_usd: 10, pagos: 1 },
    // El tramo heredado no existe en cobranza: se ignora.
    { tramo: 'D150_HASTA_2025', monto_bs: 999, monto_usd: 9, pagos: 9 },
  ];

  it('reparte lo cobrado en USD por atraso al pagar', () => {
    const buckets = mapPaymentAging(rows, 'USD');
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      'POR_VENCER',
      'D1_30',
      'D150_DESDE_2025',
    ]);
    expect(buckets[0]?.short).toBe('A tiempo');
    expect(buckets[0]?.amount).toBe(60);
    expect(buckets[1]?.pct).toBe(22.22);
    expect(buckets[2]?.documentos).toBe(1);
    expect(buckets.reduce((sum, bucket) => sum + bucket.amount, 0)).toBe(90);
  });

  it('usa el monto nativo en Bs y devuelve vacío sin pagos', () => {
    const buckets = mapPaymentAging(rows, 'BS');
    expect(buckets[0]?.amount).toBe(52800);
    expect(buckets.reduce((sum, bucket) => sum + bucket.amount, 0)).toBe(79200);
    expect(mapPaymentAging([], 'USD')).toEqual([]);
  });
});
