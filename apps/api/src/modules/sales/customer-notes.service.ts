import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CustomerInsightQuery,
  CustomerNote,
  CustomerNoteOrder,
  CustomerNotesResponse,
} from '@nexo/contracts';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';
import { buildInsightWindows, round2, toNumber } from './customer-insights.calculations';
import { normalizeCustomerCode } from './customer-code';

// ============================================================
// Notas de entrega de un cliente con su pedido de origen (solo lectura).
//
// El vínculo vive en el renglón de la nota (`reng_nde`):
//   · tipo_doc = 'T' → `num_doc` es la solicitud/cotización de Profit, que es
//     el número que la app muestra como «Pedido».
//   · tipo_doc = 'P' → `num_doc` es un pedido de Profit (`dbo.pedidos`). Ese
//     pedido nace de una solicitud (`reng_ped.tipo_doc = 'T'`), así que se
//     resuelve la cadena hasta `cotiz_c.fact_num`.
//
// Una nota puede venir de varios pedidos (renglones fusionados): se devuelven
// todos. La consulta se cachea 5 minutos por cliente/ventana/moneda.
// ============================================================

export const CUSTOMER_NOTES_TOTALS_SQL = `
SELECT /* nexo:customer_notes_totals */
  CAST(f.fact_num AS varchar(30)) AS nota,
  MAX(f.fec_emis) AS fecha,
  CASE WHEN @moneda = 'USD'
       THEN ROUND(MAX(f.tot_neto) / NULLIF(MAX(f.tasa), 0), 2)
       ELSE ROUND(MAX(f.tot_neto), 2) END AS monto,
  SUM(CASE WHEN RTRIM(ISNULL(a.uni_venta, '')) = 'SAC' THEN r.total_art ELSE 0 END) AS sacos,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  COUNT(*) AS lineas
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num AND r.anulado = 0
LEFT JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND RTRIM(f.co_cli) = @co_cli
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY CAST(f.fact_num AS varchar(30))
`;

export const CUSTOMER_NOTES_ORDERS_SQL = `
SELECT DISTINCT /* nexo:customer_notes_orders */
  CAST(r.fact_num AS varchar(30)) AS nota,
  CAST(CASE WHEN r.tipo_doc = 'T' THEN r.num_doc ELSE cot.fact_num END AS varchar(30)) AS pedido,
  CASE WHEN r.tipo_doc = 'P' THEN CAST(p.fact_num AS varchar(30)) ELSE NULL END AS pedido_profit
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num AND r.anulado = 0
LEFT JOIN dbo.pedidos AS p
  ON r.tipo_doc = 'P'
 AND p.fact_num = r.num_doc
 AND RTRIM(p.co_cli) = RTRIM(f.co_cli)
LEFT JOIN dbo.reng_ped AS rp
  ON rp.fact_num = p.fact_num
 AND rp.tipo_doc = 'T'
LEFT JOIN dbo.cotiz_c AS cot
  ON cot.fact_num = rp.num_doc
 AND RTRIM(cot.co_cli) = RTRIM(f.co_cli)
WHERE f.anulada = 0
  AND RTRIM(f.co_cli) = @co_cli
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
  AND (r.tipo_doc = 'T' OR p.fact_num IS NOT NULL)
`;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const QUERY_LIMIT = 5_000;

interface CachedNotes {
  at: number;
  result: CustomerNotesResponse;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function day(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

@Injectable()
export class CustomerNotesService {
  private readonly logger = new Logger(CustomerNotesService.name);
  private readonly cache = new Map<string, CachedNotes>();

  constructor(@Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter) {}

  async get(codeRaw: string, query: CustomerInsightQuery): Promise<CustomerNotesResponse> {
    const code = normalizeCustomerCode(codeRaw);
    const months = query.months;
    const currency = query.currency;
    const cacheKey = `${code}|${months}|${currency}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

    const windows = buildInsightWindows(months);

    const [totalsRes, linksRes] = await Promise.allSettled([
      this.profit.selectQuery(CUSTOMER_NOTES_TOTALS_SQL, QUERY_LIMIT, {
        co_cli: code,
        desde: windows.from,
        hasta: windows.to,
        moneda: currency,
      }),
      this.profit.selectQuery(CUSTOMER_NOTES_ORDERS_SQL, QUERY_LIMIT, {
        co_cli: code,
        desde: windows.from,
        hasta: windows.to,
      }),
    ]);

    const totalsOk = totalsRes.status === 'fulfilled';
    const linksOk = linksRes.status === 'fulfilled';

    if (!totalsOk) {
      this.logger.error(
        `No se pudieron leer las notas de ${code} en Profit: ${
          totalsRes.status === 'rejected' && totalsRes.reason instanceof Error
            ? totalsRes.reason.message
            : 'Error desconocido'
        }`,
      );
    }
    if (!linksOk) {
      this.logger.warn(
        `No se pudo resolver el pedido de las notas de ${code}: ${
          linksRes.status === 'rejected' && linksRes.reason instanceof Error
            ? linksRes.reason.message
            : 'Error desconocido'
        }`,
      );
    }

    const notes = totalsOk ? this.buildNotes(totalsRes.value, linksOk ? linksRes.value : []) : [];

    const result: CustomerNotesResponse = {
      code,
      months,
      currency,
      asOf: new Date().toISOString(),
      notes,
      available: totalsOk,
      ordersAvailable: linksOk,
      source: this.profit.dialect === 'mssql' ? 'profit' : 'fixtures',
    };

    // Solo se cachea una lectura completa: un fallo debe reintentarse.
    if (result.available && result.ordersAvailable) this.remember(cacheKey, result);

    return result;
  }

  /** Solo para pruebas/operación: fuerza la próxima lectura. */
  invalidate(): void {
    this.cache.clear();
  }

  private remember(key: string, result: CustomerNotesResponse): void {
    this.cache.set(key, { at: Date.now(), result });
    if (this.cache.size <= CACHE_MAX_ENTRIES) return;
    const oldest = this.cache.keys().next().value;
    if (oldest) this.cache.delete(oldest);
  }

  private buildNotes(
    totalsRows: Record<string, unknown>[],
    linkRows: Record<string, unknown>[],
  ): CustomerNote[] {
    const notes: CustomerNote[] = [];
    for (const raw of totalsRows) {
      const number = text(raw.nota);
      if (!number) continue;
      const kg = toNumber(raw.kg);
      notes.push({
        number,
        date: day(raw.fecha),
        amount: raw.monto === null || raw.monto === undefined ? null : round2(toNumber(raw.monto)),
        sacks: round2(toNumber(raw.sacos)),
        kg: round2(kg),
        tonnes: round2(kg / 1000),
        lines: Math.trunc(toNumber(raw.lineas)),
        orders: [],
      });
    }

    const byNumber = new Map(notes.map((note) => [note.number, note]));
    const ordersByNote = new Map<string, Map<string, CustomerNoteOrder>>();

    for (const raw of linkRows) {
      const note = byNumber.get(text(raw.nota));
      if (!note) continue;
      const direct = text(raw.pedido);
      const profitOrder = text(raw.pedido_profit) || null;
      // Sin cadena hasta la solicitud, el pedido de Profit es la única
      // referencia disponible: se muestra como número y no se duplica.
      const number = direct || profitOrder;
      if (!number) continue;

      let bucket = ordersByNote.get(note.number);
      if (!bucket) {
        bucket = new Map<string, CustomerNoteOrder>();
        ordersByNote.set(note.number, bucket);
      }
      const existing = bucket.get(number);
      if (existing) {
        if (!existing.profitOrder && direct && profitOrder) existing.profitOrder = profitOrder;
      } else {
        bucket.set(number, { number, profitOrder: direct ? profitOrder : null });
      }
    }

    for (const note of notes) {
      const bucket = ordersByNote.get(note.number);
      if (!bucket) continue;
      note.orders = [...bucket.values()].sort((a, b) => a.number.localeCompare(b.number, 'es'));
    }

    // Más reciente primero; el número desempata dos notas del mismo día.
    notes.sort(
      (a, b) =>
        (b.date ?? '').localeCompare(a.date ?? '') ||
        b.number.localeCompare(a.number, 'es', { numeric: true }),
    );

    return notes;
  }
}
