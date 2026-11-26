import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeliveryNoteDocument, DeliveryNoteLine, DeliveryNotesResponse } from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';

// ============================================================
// Documento de la nota de entrega real de un pedido.
//
// El panel de cierres y la ficha del pedido muestran el documento que Profit
// emitió: cabecera, cliente, renglones, totales y origen. Se lee en vivo de
// `not_ent` + `reng_nde` (solo SELECT) y se normaliza a la moneda de
// presentación de la nota (USD si Profit la muestra en dólares).
//
// Si el pedido ya tiene `notaEntregaRefs` se usan esas notas; si es un cierre
// antiguo sin refs, se resuelven por origen (`tipo_doc='T'` o cadena `P`).
// ============================================================

type HeaderRow = Record<string, unknown>;
type LineRow = Record<string, unknown>;

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function day(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function parseRefs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseDiscount(raw: unknown): number | null {
  const value = text(raw);
  if (!value) return null;
  const first = value.split('+')[0]?.replace(',', '.') ?? '';
  const parsed = Number(first);
  return Number.isFinite(parsed) ? parsed : null;
}

function paymentTerms(raw: unknown): string | null {
  const days = numberOrNull(raw);
  if (days === null) return null;
  if (days <= 0) return 'Contado';
  return `${Math.trunc(days)} días`;
}

@Injectable()
export class DeliveryNoteService {
  private readonly logger = new Logger(DeliveryNoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
  ) {}

  async getByOrder(orderId: string): Promise<DeliveryNotesResponse> {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: { id: true, externalNumber: true, notaEntregaRefs: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado.');

    const refs = parseRefs(order.notaEntregaRefs);

    try {
      const numbers = refs.length > 0 ? refs : await this.findNoteNumbers(order.externalNumber);
      if (numbers.length === 0) return this.empty(order, true);
      const [headers, lines] = await Promise.all([
        this.readHeaders(numbers),
        this.readLines(numbers),
      ]);
      return {
        orderId: order.id,
        orderNumber: order.externalNumber,
        notes: this.buildNotes(headers, lines),
        available: true,
        source: this.profit.dialect === 'mssql' ? 'profit' : 'fixtures',
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la nota de entrega del pedido ${order.externalNumber}: ${
          error instanceof Error ? error.message : 'Error desconocido'
        }`,
      );
      return this.empty(order, false);
    }
  }

  private empty(
    order: { id: string; externalNumber: string },
    available: boolean,
  ): DeliveryNotesResponse {
    return {
      orderId: order.id,
      orderNumber: order.externalNumber,
      notes: [],
      available,
      source: this.profit.dialect === 'mssql' ? 'profit' : 'fixtures',
    };
  }

  // Notas vinculadas al pedido cuando el cierre no guardó `notaEntregaRefs`.
  private async findNoteNumbers(orderNumber: string): Promise<string[]> {
    const numeric = Number(orderNumber);
    if (!Number.isFinite(numeric)) return [];
    const rows = await this.profit.selectQuery(
      `SELECT DISTINCT /* nexo:delivery_note_numbers */
          CAST(d.fact_num AS varchar(30)) AS note
        FROM dbo.reng_nde AS d
        INNER JOIN dbo.not_ent AS n ON n.fact_num = d.fact_num AND n.anulada = 0
        WHERE d.anulado = 0
          AND (
            (d.tipo_doc = 'T' AND d.num_doc = @order)
            OR (d.tipo_doc = 'P' AND d.num_doc IN (
              SELECT DISTINCT fact_num
              FROM dbo.reng_ped
              WHERE tipo_doc = 'T' AND num_doc = @order
            ))
          )`,
      100,
      { order: Math.trunc(numeric) },
    );
    return [...new Set(rows.map((row) => text(row.note)).filter(Boolean))];
  }

  private async readHeaders(numbers: string[]): Promise<Map<string, HeaderRow>> {
    const { placeholders, params } = this.parametrize(numbers);
    if (!placeholders) return new Map();
    const rows = await this.profit.selectQuery(
      `SELECT /* nexo:delivery_note_header */
          CAST(n.fact_num AS varchar(30)) AS number,
          n.fec_emis AS date,
          n.fec_venc AS due_date,
          RTRIM(n.status) AS status,
          n.anulada AS annulled,
          RTRIM(n.co_cli) AS customer_code,
          RTRIM(ISNULL(NULLIF(RTRIM(c.cli_des), ''), RTRIM(n.nombre))) AS customer_name,
          RTRIM(ISNULL(NULLIF(RTRIM(c.rif), ''), RTRIM(n.rif))) AS customer_rif,
          RTRIM(ISNULL(NULLIF(RTRIM(CONVERT(varchar(max), n.dir_ent)), ''),
            RTRIM(CONVERT(varchar(max), c.direc1)))) AS customer_address,
          RTRIM(c.telefonos) AS customer_phone,
          RTRIM(v.ven_des) AS vendor,
          RTRIM(n.moneda) AS currency,
          n.tasa AS exchange_rate,
          n.tot_bruto AS subtotal,
          n.glob_desc AS discount,
          n.iva AS tax,
          n.tot_neto AS total,
          RTRIM(CONVERT(varchar(max), n.comentario)) AS comments,
          c.plaz_pag AS payment_terms
        FROM dbo.not_ent AS n
        LEFT JOIN dbo.clientes AS c ON c.co_cli = n.co_cli
        LEFT JOIN dbo.vendedor AS v ON v.co_ven = n.co_ven
        WHERE n.fact_num IN (${placeholders})`,
      100,
      params,
    );
    return new Map(rows.map((row) => [text(row.number), row]));
  }

  private async readLines(numbers: string[]): Promise<LineRow[]> {
    const { placeholders, params } = this.parametrize(numbers);
    if (!placeholders) return [];
    return this.profit.selectQuery(
      `SELECT /* nexo:delivery_note_lines */
          CAST(d.fact_num AS varchar(30)) AS note,
          d.reng_num AS line,
          RTRIM(d.co_art) AS product_code,
          RTRIM(ISNULL(NULLIF(RTRIM(CONVERT(varchar(500), d.des_art)), ''), a.art_des)) AS description,
          RTRIM(d.co_alma) AS warehouse,
          RTRIM(d.uni_venta) AS unit,
          d.total_art AS quantity,
          d.prec_vta AS price,
          d.porc_desc AS discount_pct,
          d.reng_neto AS net,
          d.total_art * ISNULL(a.uni_relac, 1) AS kg,
          CAST(d.num_doc AS varchar(30)) AS origin,
          RTRIM(d.tipo_doc) AS origin_type
        FROM dbo.reng_nde AS d
        LEFT JOIN dbo.art AS a ON a.co_art = d.co_art
        WHERE d.fact_num IN (${placeholders})
          AND d.anulado = 0`,
      Math.min(20_000, Math.max(numbers.length * 200, 2_000)),
      params,
    );
  }

  private parametrize(numbers: string[]): {
    placeholders: string;
    params: Record<string, unknown>;
  } {
    const numeric = [...new Set(numbers.map((value) => Math.trunc(Number(value))).filter(Number.isFinite))];
    const params: Record<string, unknown> = {};
    const placeholders = numeric.map((value, index) => {
      params[`n${index}`] = value;
      return `@n${index}`;
    });
    return { placeholders: placeholders.join(', '), params };
  }

  private buildNotes(headers: Map<string, HeaderRow>, rows: LineRow[]): DeliveryNoteDocument[] {
    const linesByNote = new Map<string, LineRow[]>();
    for (const row of rows) {
      const note = text(row.note);
      if (!note) continue;
      const bucket = linesByNote.get(note) ?? [];
      bucket.push(row);
      linesByNote.set(note, bucket);
    }

    const source = this.profit.dialect === 'mssql' ? 'profit' : 'fixtures';
    const notes: DeliveryNoteDocument[] = [];
    for (const [noteNumber, header] of headers) {
      const rawCurrency = text(header.currency).toUpperCase();
      const rate = numberOrNull(header.exchange_rate);
      const isUsd = rawCurrency.includes('US$') || rawCurrency.includes('USD');
      const converted = isUsd && rate !== null && rate > 0;
      const factor = converted ? 1 / (rate as number) : 1;
      const money = (value: unknown) => round(number(value) * factor, 2);

      const lines: DeliveryNoteLine[] = (linesByNote.get(noteNumber) ?? [])
        .map((row) => ({
          line: Math.trunc(number(row.line)),
          productCode: text(row.product_code),
          description: text(row.description),
          warehouse: text(row.warehouse) || null,
          unit: text(row.unit) || null,
          quantity: round(number(row.quantity), 3),
          price: money(row.price),
          discountPct: parseDiscount(row.discount_pct),
          net: money(row.net),
          kg: round(number(row.kg), 3),
          origin: text(row.origin) || null,
          originType: text(row.origin_type) || null,
        }))
        .sort((a, b) => a.line - b.line);

      const orders = [
        ...new Set(lines.map((line) => line.origin).filter((origin): origin is string => Boolean(origin) && origin !== '0')),
      ];

      notes.push({
        number: noteNumber,
        date: day(header.date),
        dueDate: day(header.due_date),
        status: text(header.status) || null,
        annulled: header.annulled === true || header.annulled === 1 || header.annulled === '1',
        customerCode: text(header.customer_code),
        customerName: text(header.customer_name) || text(header.customer_code),
        customerRif: text(header.customer_rif) || null,
        customerAddress: text(header.customer_address) || null,
        customerPhone: text(header.customer_phone) || null,
        vendor: text(header.vendor) || null,
        currency: isUsd ? 'USD' : rawCurrency.includes('BS') || rawCurrency.includes('VES') ? 'VES' : rawCurrency || '—',
        exchangeRate: rate,
        amountsConverted: converted,
        paymentTerms: paymentTerms(header.payment_terms),
        comments: text(header.comments) || null,
        subtotal: money(header.subtotal),
        discount: money(header.discount),
        tax: money(header.tax),
        total: money(header.total),
        totalLocal: converted ? round(number(header.total), 2) : null,
        lines,
        orders,
        source,
      });
    }

    return notes.sort(
      (a, b) =>
        (a.date ?? '').localeCompare(b.date ?? '') ||
        a.number.localeCompare(b.number, 'es', { numeric: true }),
    );
  }
}
