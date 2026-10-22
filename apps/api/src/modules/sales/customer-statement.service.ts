import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  CustomerStatement,
  CustomerStatementCurrency,
  CustomerStatementQuery,
  CustomerStatementRow,
  CustomerStatementTotals,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';

// ============================================================
// Estado de cuenta por cliente (cartera de Profit, solo lectura).
//
// Fuente: `dbo.docum_cc` + `dbo.clientes`. La vista
// `dbo.Documentos_Pendientes` es la referencia de Profit para los saldos en
// USD (anulado = 0, saldo > 0, conversión monto_net / tasa y signo negativo
// para adelantos/notas de crédito), pero no expone `fec_venc`; por eso la
// consulta va directo a `docum_cc` y reproduce la misma fórmula.
//
// `clientes.saldo` NO se usa: en la base real puede quedar en 0 aunque el
// cliente tenga facturas pendientes. El saldo del estado de cuenta se calcula
// sumando los documentos listados.
//
// Nunca escribe en Profit: el adaptador solo acepta SELECT y bindea el código
// del cliente como parámetro.
// ============================================================

const MAX_DOCUMENTS = 1000;
const QUERY_LIMIT = MAX_DOCUMENTS + 1;

// Documentos que Profit considera débito; el resto (ADEL, N/CR, …) resta.
const DEBIT_DOCS = new Set(['FACT', 'N/DB', 'AJPM', 'GIRO']);

// `TOP` + `ORDER BY` dentro de la tabla derivada permite que el adaptador
// aplique su propio TOP sin romper la consulta. Se piden 1001 para detectar
// si la lista quedó recortada.
const PROFIT_STATEMENT_SQL = `
SELECT TOP (${QUERY_LIMIT})
  RTRIM(cc.co_cli) AS co_cli,
  RTRIM(c.cli_des) AS cli_des,
  RTRIM(cc.tipo_doc) AS tipo_doc,
  cc.nro_doc,
  cc.fec_emis,
  cc.fec_venc,
  DATEDIFF(DAY, cc.fec_venc, GETDATE()) AS dias_venc,
  CASE WHEN @moneda = 'USD' THEN ROUND(cc.monto_net / NULLIF(cc.tasa, 0), 2) ELSE cc.monto_net END AS monto,
  CASE WHEN @moneda = 'USD' THEN ROUND(cc.saldo / NULLIF(cc.tasa, 0), 2) ELSE cc.saldo END AS saldo,
  CASE WHEN RTRIM(cc.tipo_doc) IN ('FACT', 'N/DB', 'AJPM', 'GIRO') THEN 1 ELSE -1 END AS signo,
  SYSUTCDATETIME() AS as_of
FROM dbo.docum_cc AS cc
INNER JOIN dbo.clientes AS c ON c.co_cli = cc.co_cli
WHERE RTRIM(cc.co_cli) = @co_cli
  AND cc.anulado = 0
  AND (@incluir_saldados = 1 OR cc.saldo > 0)
ORDER BY cc.fec_emis DESC, cc.tipo_doc, cc.nro_doc
`;

function normalizeCode(value: string): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,10}$/.test(code)) {
    throw new BadRequestException('Código de cliente inválido');
  }
  return code;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function integerOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n === null ? null : Math.trunc(n);
}

function isoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  // Evita exponer -0 cuando los créditos igualan exactamente los débitos.
  return Object.is(rounded, -0) ? 0 : rounded;
}

@Injectable()
export class CustomerStatementService {
  private readonly logger = new Logger(CustomerStatementService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
  ) {}

  async statement(codeRaw: string, query: CustomerStatementQuery = {}): Promise<CustomerStatement> {
    const code = normalizeCode(codeRaw);
    const includeSettled = query.incluirSaldados ?? false;
    const currency: CustomerStatementCurrency = query.moneda ?? 'USD';

    // El nombre/tipo/vendedor locales se usan como respaldo; la cartera manda
    // desde Profit. Un fallo de la BD local no debe impedir la consulta.
    let customer: { name: string; customerType: string | null; vendor: string | null } | null = null;
    try {
      customer = await this.prisma.customer.findUnique({
        where: { externalCode: code },
        select: { name: true, customerType: true, vendor: true },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo leer el cliente ${code} en la BD local: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    let rawRows: Record<string, unknown>[];
    try {
      rawRows = await this.profit.selectQuery(PROFIT_STATEMENT_SQL, QUERY_LIMIT, {
        co_cli: code,
        incluir_saldados: includeSettled ? 1 : 0,
        moneda: currency,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo consultar la cartera de ${code} en Profit: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException('No se pudo consultar la cartera del cliente en Profit.');
    }

    const truncated = rawRows.length > MAX_DOCUMENTS;
    const visible = truncated ? rawRows.slice(0, MAX_DOCUMENTS) : rawRows;

    const rows: CustomerStatementRow[] = visible.map((raw) => {
      const tipoDoc = text(raw.tipo_doc);
      const rawSign = numberOrNull(raw.signo);
      const signo = rawSign === null ? (DEBIT_DOCS.has(tipoDoc) ? 1 : -1) : rawSign < 0 ? -1 : 1;
      const saldo = numberOrNull(raw.saldo);
      const montoNeto = numberOrNull(raw.monto);
      return {
        tipoDoc,
        nroDoc: integerOrNull(raw.nro_doc) ?? 0,
        fechaEmision: isoDate(raw.fec_emis),
        fechaVencimiento: isoDate(raw.fec_venc),
        diasVencimiento: integerOrNull(raw.dias_venc),
        saldo: saldo === null ? null : round2(saldo * signo),
        montoNeto: montoNeto === null ? null : round2(montoNeto * signo),
        esCredito: signo < 0,
      };
    });

    // Profit muestra la lista por fecha ascendente; el TOP de la consulta va
    // descendente solo para conservar los documentos más recientes al recortar.
    rows.sort(
      (a, b) =>
        (a.fechaEmision ?? '').localeCompare(b.fechaEmision ?? '') ||
        a.tipoDoc.localeCompare(b.tipoDoc) ||
        a.nroDoc - b.nroDoc,
    );

    const totals: CustomerStatementTotals = {
      saldo: 0,
      saldoVencido: 0,
      credito: 0,
      documentos: rows.length,
      vencidos: 0,
      proximoVencimiento: null,
    };
    const upcoming: string[] = [];

    for (const row of rows) {
      const saldo = row.saldo ?? 0;
      totals.saldo += saldo;
      if (saldo < 0) totals.credito += Math.abs(saldo);
      if (saldo > 0 && (row.diasVencimiento ?? 0) > 0) {
        totals.saldoVencido += saldo;
        totals.vencidos += 1;
      }
      if (saldo > 0 && row.diasVencimiento !== null && row.diasVencimiento <= 0 && row.fechaVencimiento) {
        upcoming.push(row.fechaVencimiento);
      }
    }

    totals.saldo = round2(totals.saldo);
    totals.saldoVencido = round2(totals.saldoVencido);
    totals.credito = round2(totals.credito);
    totals.proximoVencimiento = upcoming.sort()[0] ?? null;

    const liveName = text(rawRows[0]?.cli_des);
    const asOf = isoDate(rawRows[0]?.as_of) ?? new Date().toISOString();

    return {
      customer: {
        code,
        name: liveName || customer?.name?.trim() || code,
        customerType: customer?.customerType ?? null,
        vendor: customer?.vendor ?? null,
      },
      rows,
      totals,
      asOf,
      moneda: currency,
      incluyeSaldados: includeSettled,
      truncated,
      source: this.profit.dialect === 'mssql' ? 'profit' : 'fixtures',
    };
  }
}
