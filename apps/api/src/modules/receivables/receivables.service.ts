import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  ReceivablesCurrency,
  ReceivablesQuery,
  ReceivablesResponse,
} from '@nexo/contracts';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';
import {
  aggregate,
  documentsForOutput,
  filterDocs,
  mapPayments,
  mapRawDoc,
  optionsFromDocs,
  PaymentMap,
  ReceivablesDoc,
} from './receivables.calculations';

// ============================================================
// Cuentas por cobrar — análisis de vencimiento (solo lectura).
//
// Una sola lectura a Profit por ventana de caché: documentos abiertos de
// `dbo.docum_cc` enriquecidos con cliente, cartera, tipo, zona y segmento,
// más los abonos de `dbo.cobros`/`dbo.reng_cob` (último pago, cobrado de 90
// días y cobranza de 12 meses con su cumplimiento).
//
// El saldo de `docum_cc` es vivo. Se incluyen adelantos y notas de crédito
// (`saldo > 0`) para poder mostrar el «a favor» y el neto; el cálculo separa
// débitos y créditos por `tipo_doc`.
//
// La consulta es estática y parametrizada; los filtros del usuario se aplican
// en memoria sobre la foto. Nunca se escribe en Profit.
// ============================================================

const MAX_DOCUMENTS = 5000;
const QUERY_LIMIT = MAX_DOCUMENTS + 1;
const CACHE_TTL_MS = 60_000;

const PROFIT_RECEIVABLES_DOCS_SQL = `
SELECT TOP (${QUERY_LIMIT}) /* nexo:receivables_docs */
  RTRIM(cc.co_cli) AS co_cli,
  RTRIM(ISNULL(c.cli_des, '')) AS cli_des,
  RTRIM(ISNULL(cc.co_ven, '')) AS co_ven,
  RTRIM(ISNULL(v.ven_des, '')) AS ven_des,
  RTRIM(ISNULL(c.co_ven, '')) AS co_ven_cartera,
  RTRIM(ISNULL(vc.ven_des, '')) AS ven_des_cartera,
  RTRIM(ISNULL(cc.tipo_doc, '')) AS tipo_doc,
  cc.nro_doc,
  cc.fec_emis,
  cc.fec_venc,
  DATEDIFF(DAY, cc.fec_venc, CAST(GETDATE() AS date)) AS dias_venc,
  cc.monto_net,
  cc.saldo,
  cc.tasa,
  RTRIM(ISNULL(c.tipo, '')) AS tipo_cli,
  RTRIM(ISNULL(tc.des_tipo, '')) AS tipo_des,
  RTRIM(ISNULL(c.co_zon, '')) AS co_zon,
  RTRIM(ISNULL(z.zon_des, '')) AS zona_des,
  RTRIM(ISNULL(c.co_seg, '')) AS co_seg,
  RTRIM(ISNULL(s.seg_des, '')) AS seg_des,
  c.mont_cre,
  c.plaz_pag,
  SYSUTCDATETIME() AS as_of
FROM dbo.docum_cc AS cc
INNER JOIN dbo.clientes AS c ON c.co_cli = cc.co_cli
LEFT JOIN dbo.vendedor AS v ON v.co_ven = cc.co_ven
LEFT JOIN dbo.vendedor AS vc ON vc.co_ven = c.co_ven
LEFT JOIN dbo.tipo_cli AS tc ON tc.tip_cli = c.tipo
LEFT JOIN dbo.zona AS z ON z.co_zon = c.co_zon
LEFT JOIN dbo.segmento AS s ON s.co_seg = c.co_seg
WHERE cc.anulado = 0
  AND cc.saldo > 0
ORDER BY cc.fec_emis DESC, cc.co_cli, cc.tipo_doc, cc.nro_doc
`;

// Último abono y cobranza por cliente en dos ventanas: 90 días y 12 meses.
// Los recibos pueden traer montos en US$ (expresados en Bs con su tasa) y en
// Bs; solo se cuentan las aplicaciones a facturas, no los adelantos ni los
// ajustes. La cobranza usa los recibos en US$/USD de Profit: los montos en Bs
// de esos recibos son nativos y la conversión a USD usa la tasa del recibo.
// El cobrado a tiempo compara la fecha del recibo con el vencimiento que
// Profit copia en `reng_cob`; la ventana y el numerador son los mismos para
// que el porcentaje sea consistente.
const PROFIT_RECEIVABLES_PAYMENTS_SQL = `
SELECT /* nexo:receivables_payments */
  RTRIM(c.co_cli) AS co_cli,
  MAX(c.fec_cob) AS ultimo_pago,
  DATEDIFF(DAY, MAX(c.fec_cob), CAST(GETDATE() AS date)) AS dias_sin_pago,
  SUM(CASE WHEN (rc.moneda LIKE 'US$%' OR rc.moneda LIKE 'USD%')
    AND c.fec_cob >= DATEADD(DAY, -90, CAST(GETDATE() AS date))
    THEN rc.mont_cob ELSE 0 END) AS cobrado_90_bs,
  SUM(CASE WHEN (rc.moneda LIKE 'US$%' OR rc.moneda LIKE 'USD%')
    AND rc.tasa > 0
    AND c.fec_cob >= DATEADD(DAY, -90, CAST(GETDATE() AS date))
    THEN rc.mont_cob / NULLIF(rc.tasa, 0) ELSE 0 END) AS cobrado_90_usd,
  SUM(CASE WHEN (rc.moneda LIKE 'US$%' OR rc.moneda LIKE 'USD%')
    AND c.fec_cob >= DATEADD(MONTH, -12, CAST(GETDATE() AS date))
    THEN rc.mont_cob ELSE 0 END) AS cobrado_12m_bs,
  SUM(CASE WHEN (rc.moneda LIKE 'US$%' OR rc.moneda LIKE 'USD%')
    AND rc.tasa > 0
    AND c.fec_cob >= DATEADD(MONTH, -12, CAST(GETDATE() AS date))
    THEN rc.mont_cob / NULLIF(rc.tasa, 0) ELSE 0 END) AS cobrado_12m_usd,
  SUM(CASE WHEN (rc.moneda LIKE 'US$%' OR rc.moneda LIKE 'USD%')
    AND rc.fec_venc IS NOT NULL
    AND rc.fec_venc > '1990-01-01'
    AND c.fec_cob >= DATEADD(MONTH, -12, CAST(GETDATE() AS date))
    AND c.fec_cob <= rc.fec_venc
    THEN rc.mont_cob ELSE 0 END) AS cobrado_12m_a_tiempo_bs,
  SUM(CASE WHEN (rc.moneda LIKE 'US$%' OR rc.moneda LIKE 'USD%')
    AND rc.tasa > 0
    AND rc.fec_venc IS NOT NULL
    AND rc.fec_venc > '1990-01-01'
    AND c.fec_cob >= DATEADD(MONTH, -12, CAST(GETDATE() AS date))
    AND c.fec_cob <= rc.fec_venc
    THEN rc.mont_cob / NULLIF(rc.tasa, 0) ELSE 0 END) AS cobrado_12m_a_tiempo_usd,
  SUM(CASE WHEN (rc.moneda LIKE 'US$%' OR rc.moneda LIKE 'USD%')
    AND c.fec_cob >= DATEADD(MONTH, -12, CAST(GETDATE() AS date))
    THEN 1 ELSE 0 END) AS pagos_12m,
  SUM(CASE WHEN (rc.moneda LIKE 'US$%' OR rc.moneda LIKE 'USD%')
    AND rc.fec_venc IS NOT NULL
    AND rc.fec_venc > '1990-01-01'
    AND c.fec_cob >= DATEADD(MONTH, -12, CAST(GETDATE() AS date))
    AND c.fec_cob <= rc.fec_venc
    THEN 1 ELSE 0 END) AS pagos_12m_a_tiempo
FROM dbo.cobros AS c
INNER JOIN dbo.reng_cob AS rc ON rc.cob_num = c.cob_num
WHERE c.anulado = 0
  AND rc.mont_cob > 0
  AND rc.tp_doc_cob IN ('FACT', 'N/DB', 'AJPM', 'GIRO')
GROUP BY RTRIM(c.co_cli)
`;

interface Snapshot {
  docs: ReceivablesDoc[];
  payments: PaymentMap;
  asOf: string;
  truncated: boolean;
  loadedAt: number;
}

function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

@Injectable()
export class ReceivablesService {
  private readonly logger = new Logger(ReceivablesService.name);
  private snapshot: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;

  constructor(@Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter) {}

  async report(query: ReceivablesQuery): Promise<ReceivablesResponse> {
    const snapshot = await this.getSnapshot(query.refresh === true);
    const currency: ReceivablesCurrency = query.moneda ?? 'USD';
    const solVencido = query.soloVencido === true;
    const incluirAFavor = query.incluirAFavor === true;

    const filtered = filterDocs(snapshot.docs, {
      q: query.q,
      vendedor: query.vendedor,
      tipoCliente: query.tipoCliente,
      zona: query.zona,
      tipoDoc: query.tipoDoc,
      desde: query.desde,
      hasta: query.hasta,
      soloVencido: solVencido,
    });

    const result = aggregate(filtered, snapshot.payments, currency);
    // Un tipo de documento explícito siempre se lista: el filtro ya restringe
    // a ese tipo, así que ocultar sus créditos (ADEL, N/CR) dejaría la tabla
    // vacía aunque el usuario los haya pedido.
    const documentos = documentsForOutput(filtered, currency, incluirAFavor || Boolean(query.tipoDoc));

    return {
      asOf: snapshot.asOf,
      generatedAt: new Date().toISOString(),
      moneda: currency,
      source: this.profit.dialect === 'mssql' ? 'profit' : 'fixtures',
      filtros: {
        moneda: currency,
        q: query.q ?? '',
        vendedor: query.vendedor ?? '',
        tipoCliente: query.tipoCliente ?? '',
        zona: query.zona ?? '',
        tipoDoc: query.tipoDoc ?? '',
        desde: query.desde ?? null,
        hasta: query.hasta ?? null,
        soloVencido: solVencido,
        incluirAFavor,
      },
      totals: result.totals,
      buckets: result.buckets,
      risk: result.risk,
      quality: {
        sinTasa: result.totals.sinTasa,
        sinVencimiento: result.totals.sinVencimiento,
        truncado: snapshot.truncated,
      },
      clientes: result.clientes,
      documentos,
      opciones: optionsFromDocs(snapshot.docs),
    };
  }

  private async getSnapshot(refresh: boolean): Promise<Snapshot> {
    const now = Date.now();
    if (!refresh && this.snapshot && now - this.snapshot.loadedAt < CACHE_TTL_MS) {
      return this.snapshot;
    }
    if (this.loading) return this.loading;

    this.loading = this.loadSnapshot()
      .then((snapshot) => {
        this.snapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private async loadSnapshot(): Promise<Snapshot> {
    let rawDocs: Record<string, unknown>[];
    try {
      rawDocs = await this.profit.selectQuery(PROFIT_RECEIVABLES_DOCS_SQL, QUERY_LIMIT);
    } catch (error) {
      this.logger.error(
        `No se pudo leer la cartera en Profit: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException('No se pudo consultar la cartera en Profit.');
    }

    let rawPayments: Record<string, unknown>[] = [];
    try {
      rawPayments = await this.profit.selectQuery(PROFIT_RECEIVABLES_PAYMENTS_SQL, QUERY_LIMIT);
    } catch (error) {
      // La cobranza es complementaria: si falla, la cartera sigue siendo útil.
      this.logger.warn(
        `No se pudo leer la cobranza en Profit: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const docs = rawDocs.map((row) => mapRawDoc(row));
    const truncated = rawDocs.length > MAX_DOCUMENTS;
    const asOf =
      isoDate(rawDocs[0]?.as_of) ?? new Date().toISOString();

    return {
      docs,
      payments: mapPayments(rawPayments),
      asOf,
      truncated,
      loadedAt: Date.now(),
    };
  }
}
