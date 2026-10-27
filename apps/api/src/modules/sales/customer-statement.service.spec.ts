import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixturesProfitAdapter } from '../sync/fixtures.adapter';
import { ProfitAdapter } from '../sync/profit.adapter';
import { CustomerStatementService } from './customer-statement.service';

// ============================================================
// Estado de cuenta: mapeo de la cartera de Profit y totales.
// ============================================================

function createFakePrisma(
  customer: { name: string; customerType: string | null; vendor: string | null } | null = {
    name: 'JOSEF HENDRIX HERNANDEZ REYES',
    customerType: 'L1 EXCLUSIVOS',
    vendor: 'MEIDY CRISTINA ARIAS VIDAL',
  },
) {
  return {
    customer: { findUnique: async () => customer },
  } as never;
}

function rawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    co_cli: '153064128',
    cli_des: 'JOSEF HENDRIX HERNANDEZ REYES',
    tipo_doc: 'FACT',
    nro_doc: 50001002,
    fec_emis: new Date('2026-10-13T00:00:00.000Z'),
    fec_venc: new Date('2026-10-20T00:00:00.000Z'),
    dias_venc: 2,
    monto: 13500,
    saldo: 13500,
    signo: 1,
    as_of: new Date('2026-10-22T10:00:00.000Z'),
    ...overrides,
  };
}

function adapterWith(
  rows: Record<string, unknown>[],
  capture?: Array<Record<string, unknown> | undefined>,
  dialect: 'mssql' | 'fixtures' = 'fixtures',
): ProfitAdapter {
  return {
    dialect,
    selectQuery: async (_sql: string, _limit: number, params?: Record<string, unknown>) => {
      capture?.push(params);
      return rows;
    },
  } as unknown as ProfitAdapter;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CustomerStatementService', () => {
  it('ordena por fecha, marca créditos y calcula el saldo neto', async () => {
    const rows = [
      rawRow({
        tipo_doc: 'ADEL',
        nro_doc: 56220,
        fec_emis: new Date('2026-10-20T00:00:00.000Z'),
        fec_venc: new Date('2026-10-20T00:00:00.000Z'),
        dias_venc: 2,
        monto: 21017.5,
        saldo: 21017.5,
        signo: -1,
      }),
      rawRow({
        tipo_doc: 'FACT',
        nro_doc: 50001001,
        fec_emis: new Date('2026-09-28T00:00:00.000Z'),
        fec_venc: new Date('2026-10-05T00:00:00.000Z'),
        dias_venc: 17,
        monto: 7750,
        saldo: 175.71,
      }),
    ];
    const service = new CustomerStatementService(createFakePrisma(), adapterWith(rows));

    const result = await service.statement('153064128');

    expect(result.source).toBe('fixtures');
    expect(result.moneda).toBe('USD');
    expect(result.incluyeSaldados).toBe(false);
    expect(result.rows.map((row) => row.nroDoc)).toEqual([50001001, 56220]);
    expect(result.rows[1]).toMatchObject({
      tipoDoc: 'ADEL',
      esCredito: true,
      saldo: -21017.5,
      montoNeto: -21017.5,
    });
    expect(result.totals).toMatchObject({
      saldo: -20841.79,
      saldoVencido: 175.71,
      credito: 21017.5,
      documentos: 2,
      vencidos: 1,
    });
    expect(result.totals.proximoVencimiento).toBeNull();
    expect(result.asOf).toBe('2026-10-22T10:00:00.000Z');
    expect(result.customer).toMatchObject({
      code: '153064128',
      name: 'JOSEF HENDRIX HERNANDEZ REYES',
      customerType: 'L1 EXCLUSIVOS',
      vendor: 'MEIDY CRISTINA ARIAS VIDAL',
      limiteCredito: null,
    });
  });

  it('incluye el límite de crédito de dbo.clientes (mont_cre)', async () => {
    const service = new CustomerStatementService(
      createFakePrisma(),
      adapterWith([rawRow({ limite_credito: 25000 })]),
    );

    const result = await service.statement('153064128');

    expect(result.customer.limiteCredito).toBe(25000);
  });

  it('envía los filtros al adaptador como parámetros (saldados + moneda)', async () => {
    const captured: Array<Record<string, unknown> | undefined> = [];
    const service = new CustomerStatementService(createFakePrisma(), adapterWith([], captured));

    const result = await service.statement('153064128', { incluirSaldados: true, moneda: 'BS' });

    expect(captured[0]).toEqual({
      co_cli: '153064128',
      incluir_saldados: 1,
      moneda: 'BS',
    });
    expect(result.incluyeSaldados).toBe(true);
    expect(result.moneda).toBe('BS');
    expect(result.customer.name).toBe('JOSEF HENDRIX HERNANDEZ REYES');
  });

  it('rechaza códigos inválidos antes de consultar Profit', async () => {
    let called = false;
    const adapter = {
      dialect: 'fixtures',
      selectQuery: async () => {
        called = true;
        return [];
      },
    } as unknown as ProfitAdapter;
    const service = new CustomerStatementService(createFakePrisma(), adapter);

    await expect(service.statement('ABC DEF')).rejects.toThrow('Código de cliente inválido');
    expect(called).toBe(false);
  });

  it('devuelve 503 si Profit no responde', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const adapter = {
      dialect: 'mssql',
      selectQuery: async () => {
        throw new Error('timeout');
      },
    } as unknown as ProfitAdapter;
    const service = new CustomerStatementService(createFakePrisma(), adapter);

    await expect(service.statement('153064128')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('marca truncated cuando supera el tope de 1000 documentos', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) =>
      rawRow({
        nro_doc: 60000000 + i,
        fec_emis: new Date(Date.UTC(2026, 0, 1 + (i % 300))),
      }),
    );
    const service = new CustomerStatementService(createFakePrisma(), adapterWith(rows));

    const result = await service.statement('153064128');

    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(1000);
    expect(result.totals.documentos).toBe(1000);
  });

  it('resume la cartera de varios clientes en una sola consulta', async () => {
    const captured: Array<Record<string, unknown> | undefined> = [];
    const adapter = {
      dialect: 'fixtures',
      selectQuery: async (
        _sql: string,
        _limit: number,
        params?: Record<string, unknown>,
      ) => {
        captured.push(params);
        return [
          {
            co_cli: '153064128',
            cli_des: 'JOSEF HENDRIX HERNANDEZ REYES',
            limite_credito: 25000,
            saldo: -812.43,
            saldo_vencido: 0,
            credito: 812.43,
            documentos: 1,
            vencidos: 0,
            as_of: new Date('2026-10-22T10:00:00.000Z'),
          },
        ];
      },
    } as unknown as ProfitAdapter;
    const service = new CustomerStatementService(createFakePrisma(), adapter);

    const result = await service.summaries('153064128, 505835220,153064128', { moneda: 'USD' });

    // Deduplica y valida antes de consultar; los códigos van parametrizados.
    expect(captured[0]).toEqual({
      moneda: 'USD',
      co_cli_0: '153064128',
      co_cli_1: '505835220',
    });
    expect(result.items).toEqual([
      {
        code: '153064128',
        name: 'JOSEF HENDRIX HERNANDEZ REYES',
        saldo: -812.43,
        saldoVencido: 0,
        credito: 812.43,
        limiteCredito: 25000,
        documentos: 1,
        vencidos: 0,
      },
    ]);
    expect(result.asOf).toBe('2026-10-22T10:00:00.000Z');
    expect(result.source).toBe('fixtures');
  });

  it('rechaza listas de clientes inválidas o demasiado grandes', async () => {
    const service = new CustomerStatementService(createFakePrisma(), adapterWith([]));

    await expect(service.summaries('153064128,ABC DEF')).rejects.toThrow('Código de cliente inválido');
    await expect(service.summaries(',,,')).rejects.toThrow('Indica al menos un cliente');
  });

  it('funciona con el adaptador de fixtures y reproduce el neto de la captura', async () => {
    const service = new CustomerStatementService(createFakePrisma(), new FixturesProfitAdapter());

    const result = await service.statement('153064128');

    expect(result.rows).toHaveLength(5);
    expect(result.totals.documentos).toBe(5);
    expect(result.totals.saldo).toBe(0);
    expect(result.totals.credito).toBe(21193.21);
    expect(result.totals.saldoVencido).toBe(21193.21);
    expect(result.totals.vencidos).toBe(3);
  });

  it('el resumen de fixtures coincide con el estado de cuenta y trae mont_cre', async () => {
    const service = new CustomerStatementService(createFakePrisma(), new FixturesProfitAdapter());

    const summary = await service.summaries('153064128,505835220');
    const josef = summary.items.find((item) => item.code === '153064128');

    expect(summary.items).toHaveLength(2);
    expect(josef).toMatchObject({
      saldo: 0,
      saldoVencido: 21193.21,
      credito: 21193.21,
      limiteCredito: 25000,
      documentos: 5,
      vencidos: 3,
    });
    expect(summary.source).toBe('fixtures');
    expect(summary.asOf).toBe('2026-10-22T10:00:00.000Z');
  });
});
