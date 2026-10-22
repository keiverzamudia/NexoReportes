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
    });
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
});
