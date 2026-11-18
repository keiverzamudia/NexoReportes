import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProfitAdapter } from '../sync/profit.adapter';
import { ReceivablesService } from './receivables.service';

// ============================================================
// Servicio CxC: snapshot, caché, filtros y tolerancia a fallos.
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

function adapterWith(options: {
  docs?: Record<string, unknown>[];
  payments?: Record<string, unknown>[];
  failDocs?: boolean;
  failPayments?: boolean;
  onCall?: (sql: string) => void;
}): ProfitAdapter {
  return {
    dialect: 'mssql',
    selectQuery: async (sql: string) => {
      options.onCall?.(sql);
      if (sql.includes('nexo:receivables_docs')) {
        if (options.failDocs) throw new Error('Profit caído');
        return options.docs ?? [];
      }
      if (sql.includes('nexo:receivables_payments')) {
        if (options.failPayments) throw new Error('Cobros caídos');
        return options.payments ?? [];
      }
      return [];
    },
  } as unknown as ProfitAdapter;
}

describe('ReceivablesService', () => {
  const docs = [
    rawDoc(),
    rawDoc({
      co_cli: '505835220',
      cli_des: 'AGRO INVERSIONES MP, C.A',
      co_ven: '025',
      ven_des: 'MEIDY CRISTINA ARIAS VIDAL',
      co_ven_cartera: '025',
      ven_des_cartera: 'MEIDY CRISTINA ARIAS VIDAL',
      tipo_doc: 'FACT',
      nro_doc: 50003102,
      dias_venc: 180,
      saldo: 17600,
      monto_net: 17600,
      tipo_cli: 'L2',
      tipo_des: 'DISTRIBUIDORES',
      co_zon: '014',
      zona_des: 'DISTRITO CAPITAL',
      co_seg: '05',
      seg_des: 'DISTRIBUIDORES',
    }),
    rawDoc({
      co_cli: '153064128',
      tipo_doc: 'ADEL',
      nro_doc: 60001,
      dias_venc: 3,
      saldo: 4400,
      monto_net: 4400,
    }),
  ];
  const payments = [
    {
      co_cli: '153064128',
      ultimo_pago: '2026-11-01T00:00:00.000Z',
      dias_sin_pago: 17,
      cobrado_90_bs: 8800,
      cobrado_90_usd: 10,
      cobrado_12m_bs: 8800,
      cobrado_12m_usd: 10,
      cobrado_12m_a_tiempo_bs: 8800,
      cobrado_12m_a_tiempo_usd: 10,
      pagos_12m: 1,
      pagos_12m_a_tiempo: 1,
    },
  ];

  it('arma el reporte por cliente y excluye créditos de la lista por defecto', async () => {
    const service = new ReceivablesService(adapterWith({ docs, payments }));
    const report = await service.report({ moneda: 'USD' });

    expect(report.source).toBe('profit');
    expect(report.clientes).toHaveLength(2);
    expect(report.totals.cartera).toBe(30);
    expect(report.totals.aFavor).toBe(5);
    expect(report.totals.neto).toBe(25);
    expect(report.totals.vencido).toBe(30);
    expect(report.totals.diasMaxVencido).toBe(180);
    expect(report.documentos).toHaveLength(2);
    expect(report.documentos.every((row) => !row.esCredito)).toBe(true);
    expect(report.buckets.find((bucket) => bucket.key === 'D150_MAS')?.amount).toBe(20);
    expect(report.opciones.vendedores.map((option) => option.value)).toContain('031');
    expect(report.risk.topCliente?.codigo).toBe('505835220');
    expect(report.filtros.moneda).toBe('USD');
    expect(report.totals.cobrado12m).toBe(10);
    expect(report.totals.cobrado12mATiempo).toBe(10);
    expect(report.totals.pctCobranzaATiempo).toBe(100);
    expect(report.totals.pagos12m).toBe(1);
    expect(report.totals.pagos12mATiempo).toBe(1);
    expect(report.clientes.find((row) => row.codigo === '153064128')?.pctCobranzaATiempo).toBe(100);
    expect(report.clientes.find((row) => row.codigo === '505835220')?.pctCobranzaATiempo).toBeNull();
  });

  it('incluye adelantos cuando se piden y respeta soloVencido', async () => {
    const service = new ReceivablesService(adapterWith({ docs, payments }));
    const withCredits = await service.report({ moneda: 'USD', incluirAFavor: true });
    expect(withCredits.documentos).toHaveLength(3);
    expect(withCredits.documentos.some((row) => row.esCredito)).toBe(true);

    const overdue = await service.report({ moneda: 'USD', soloVencido: true });
    expect(overdue.documentos).toHaveLength(2);
    expect(overdue.totals.aFavor).toBe(0);
    expect(overdue.totals.porVencer).toBe(0);
    expect(overdue.totals.cartera).toBe(30);
  });

  it('convierte a Bs sin usar la tasa y conserva el cobrado nativo', async () => {
    const service = new ReceivablesService(adapterWith({ docs, payments }));
    const report = await service.report({ moneda: 'BS' });
    expect(report.totals.cartera).toBe(26400);
    const josef = report.clientes.find((row) => row.codigo === '153064128');
    expect(josef?.cobrado90).toBe(8800);
    expect(josef?.cobrado12m).toBe(8800);
    expect(josef?.pctCobranzaATiempo).toBe(100);
  });

  it('usa la caché de 60 s y la ignora con refresh', async () => {
    let calls = 0;
    const service = new ReceivablesService(
      adapterWith({ docs, payments, onCall: () => (calls += 1) }),
    );
    await service.report({ moneda: 'USD' });
    expect(calls).toBe(2);
    await service.report({ moneda: 'USD' });
    expect(calls).toBe(2);
    await service.report({ moneda: 'USD', refresh: true });
    expect(calls).toBe(4);
  });

  it('si falla la cobranza la cartera sigue disponible', async () => {
    const service = new ReceivablesService(adapterWith({ docs, payments, failPayments: true }));
    const report = await service.report({ moneda: 'USD' });
    expect(report.totals.cartera).toBe(30);
    expect(report.clientes[0]?.ultimoPago).toBeNull();
    expect(report.clientes[0]?.cobrado90).toBe(0);
    expect(report.clientes[0]?.cobrado12m).toBe(0);
    expect(report.totals.cobrado12m).toBe(0);
    expect(report.totals.pctCobranzaATiempo).toBeNull();
    expect(report.totals.pagos12m).toBe(0);
  });

  it('si falla la cartera responde 503 con un mensaje claro', async () => {
    const service = new ReceivablesService(adapterWith({ failDocs: true }));
    await expect(service.report({ moneda: 'USD' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('filtra por vendedor y búsqueda', async () => {
    const service = new ReceivablesService(adapterWith({ docs, payments }));
    const report = await service.report({ moneda: 'USD', vendedor: '025' });
    expect(report.clientes).toHaveLength(1);
    expect(report.clientes[0]?.codigo).toBe('505835220');

    const search = await service.report({ moneda: 'USD', q: 'josef' });
    expect(search.clientes).toHaveLength(1);
    expect(search.clientes[0]?.codigo).toBe('153064128');
  });

  it('marca truncamiento cuando la lectura supera el tope', async () => {
    const many = Array.from({ length: 5001 }, (_, index) =>
      rawDoc({ nro_doc: index + 1, co_cli: `CLI-${index}` }),
    );
    const service = new ReceivablesService(adapterWith({ docs: many }));
    const report = await service.report({ moneda: 'USD' });
    expect(report.quality.truncado).toBe(true);
  });
});
