import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderBillingStatus,
  OrderCloseReason,
  OrderLifecycleEvent,
  OrderLifecycleQuery,
  OrderLifecycleStatus,
  OrderReconciliationRun,
  OrderReopenInput,
  OrderReconcileInput,
  OrderStatus,
  OrderSummary,
} from '@nexo/contracts';
import { OrderLifecycleEvent as EventRow, OrderReconciliationRun as RunRow, SalesOrder, SalesOrderLine } from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { ScenariosService } from '../scenarios/scenarios.service';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';

// ============================================================
// Ciclo de vida del pedido: cierre automático por nota de entrega REAL.
//
// Regla de negocio (confirmada con Profit):
//   · cotiz_c.anulada = 1                         → CANCELADO
//   · hay notas no anuladas y cubren el pedido     → NOTA_ENTREGA + FACTURADO_ASUMIDO
//   · hay notas pero falta cantidad                → NOTA_PARCIAL + PENDIENTE
//   · status '2' sin ninguna nota                  → CANCELADO / SIN_NOTA
//   · status '2' sin nota y con pendiente > 0      → REVISAR (dato inconsistente)
//   · status 0/1 sin nota y fuera de la vista      → REVISAR (no se cierra por ausencia)
//
// `cotiz_c.status = '2'` significa «procesada», NO «despachada». Por eso la
// clasificación se apoya en `not_ent` + `reng_nde` y compara cantidades por
// artículo. El origen de la nota puede ser la solicitud (`tipo_doc='T'`) o un
// pedido de Profit (`tipo_doc='P'`, resuelto con `reng_ped`).
//
// Es idempotente y nunca escribe en Profit: solo SELECT parametrizados.
// Los pedidos cerrados se ocultan de la cartera (`isActive=false`) pero se
// conservan con todas sus líneas y eventos para auditoría.
// ============================================================

type ReconcileActor = { id?: string | null; code?: string | null };

type Candidate = Pick<
  SalesOrder,
  | 'id'
  | 'externalNumber'
  | 'customerCode'
  | 'customerName'
  | 'isActive'
  | 'status'
  | 'statusRaw'
  | 'closedReason'
>;

type OrderWithLines = SalesOrder & { lines: Pick<SalesOrderLine, 'pendingQty'>[] };

type MissingArticle = { coArt: string; ordered: number; delivered: number };

type PedidoCoverage = {
  number: string;
  solicitudes: number;
  complete: boolean;
  hasNotes: boolean;
};

// Resultado de comparar el pedido contra sus notas de entrega reales.
type Fulfillment = {
  orderedLines: number;
  orderedQty: number;
  deliveredQty: number;
  missingQty: number;
  missing: MissingArticle[];
  notes: string[];
  complete: boolean;
  hasNotes: boolean;
  pedidos: PedidoCoverage[];
};

type CloseResult = {
  kind: 'close';
  toStatus: 'NOTA_ENTREGA' | 'NOTA_PARCIAL' | 'CANCELADO';
  reason: OrderCloseReason;
  billingStatus: OrderBillingStatus;
  evidence: Record<string, unknown>;
  notes: string[];
};

type Classification = CloseResult | { kind: 'review'; reason: string } | { kind: 'open' };

const TERMINAL = ['NOTA_ENTREGA', 'NOTA_PARCIAL', 'CERRADO', 'CANCELADO'];
const QUANTITY_EPSILON = 0.0001;
const EMPTY_FULFILLMENT: Fulfillment = {
  orderedLines: 0,
  orderedQty: 0,
  deliveredQty: 0,
  missingQty: 0,
  missing: [],
  notes: [],
  complete: false,
  hasNotes: false,
  pedidos: [],
};

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function startOfDay(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseEvidence(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function addQuantity(
  map: Map<string, Map<string, number>>,
  key: string,
  article: string,
  qty: number,
): void {
  const bucket = map.get(key) ?? new Map<string, number>();
  bucket.set(article, (bucket.get(article) ?? 0) + qty);
  map.set(key, bucket);
}

function addToSet(map: Map<string, Set<string>>, key: string, value: string): void {
  const bucket = map.get(key) ?? new Set<string>();
  bucket.add(value);
  map.set(key, bucket);
}

@Injectable()
export class OrderLifecycleService {
  private readonly logger = new Logger(OrderLifecycleService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scenarios: ScenariosService,
    private readonly config: ConfigService,
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
  ) {}

  // ---------- Reconciliación ----------

  async reconcile(input: OrderReconcileInput & { trigger?: string; actor?: ReconcileActor }): Promise<OrderReconciliationRun> {
    if (this.running) {
      throw new ConflictException('Ya hay una reconciliación de pedidos en curso.');
    }
    this.running = true;
    const dryRun = input.dryRun ?? (this.config.get<boolean>('orderLifecycle.dryRun') ?? false);
    const trigger = input.trigger ?? 'MANUAL';
    const now = new Date();
    const run = await this.prisma.orderReconciliationRun.create({
      data: {
        status: 'EN_CURSO',
        dryRun,
        trigger,
        startedAt: now,
        actorId: input.actor?.id ?? null,
        actorCode: input.actor?.code ?? null,
      },
    });

    let checked = 0;
    let closed = 0;
    let canceled = 0;
    let review = 0;
    let errorsCount = 0;
    const closedOrders: Array<{ orderNumber: string; reason: string }> = [];
    const includeClosed = input.includeClosed ?? false;

    try {
      const orders = await this.prisma.salesOrder.findMany({
        where: {
          // La corrida normal solo atiende la cartera viva. La revalidación
          // (includeClosed) revisa los cierres ya guardados para corregir la
          // clasificación histórica sin reabrir nada.
          status: includeClosed ? { in: ['NOTA_ENTREGA', 'NOTA_PARCIAL'] } : 'ABIERTO',
          ...(input.orderNumbers && input.orderNumbers.length > 0
            ? { externalNumber: { in: input.orderNumbers } }
            : {}),
        },
        select: {
          id: true,
          externalNumber: true,
          customerCode: true,
          customerName: true,
          isActive: true,
          status: true,
          statusRaw: true,
          closedReason: true,
        },
        orderBy: { externalNumber: 'asc' },
      });

      const batchSize = this.config.get<number>('orderLifecycle.batchSize') ?? 200;

      for (let index = 0; index < orders.length; index += batchSize) {
        const chunk = orders.slice(index, index + batchSize);
        try {
          checked += chunk.length;
          const numbers = chunk.map((order) => order.externalNumber);
          const [headers, pendings, fulfillments] = await Promise.all([
            this.readHeaders(numbers),
            this.readPending(numbers),
            this.readFulfillment(numbers),
          ]);

          if (!dryRun) {
            await this.prisma.salesOrder.updateMany({
              where: { id: { in: chunk.map((order) => order.id) } },
              data: { lastCheckedAt: now, reviewReason: null },
            });
          }

          for (const order of chunk) {
            const header = headers.get(order.externalNumber);
            const pending = pendings.get(order.externalNumber);
            const fulfillment = fulfillments.get(order.externalNumber);
            const result = this.classify(order, header, pending, fulfillment);
            if (result.kind === 'close') {
              if (includeClosed) {
                // Revalidación: solo cuentan los pedidos cuya clasificación
                // cambió. Los que ya eran correctos se actualizan (refs y
                // evidencia) pero no generan un evento nuevo.
                const changed = await this.reclassifyClosed(order, result, input.actor, dryRun);
                if (!changed) continue;
              } else if (!dryRun) {
                await this.closeOrder(order, result, input.actor);
              }
              if (result.toStatus === 'CANCELADO') canceled += 1;
              else closed += 1;
              closedOrders.push({ orderNumber: order.externalNumber, reason: result.reason });
            } else if (result.kind === 'review' && !includeClosed) {
              review += 1;
              if (!dryRun) {
                await this.prisma.salesOrder.update({
                  where: { id: order.id },
                  data: { reviewReason: result.reason },
                });
              }
            }
          }
        } catch (error) {
          // Un lote fallido no tumba la corrida: se registra y se sigue con el
          // siguiente. Los cierres ya confirmados se conservan.
          errorsCount += 1;
          this.logger.warn(
            `Lote de reconciliación falló (${chunk.length} pedidos): ${
              error instanceof Error ? error.message : 'Error desconocido'
            }`,
          );
        }
      }

      const status = errorsCount === 0 ? 'EXITOSA' : closed + canceled > 0 ? 'PARCIAL' : 'ERROR';
      const finished = await this.prisma.orderReconciliationRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          checked,
          closed,
          canceled,
          review,
          errorsCount,
        },
      });

      if (!dryRun && closedOrders.length > 0) {
        await this.scenarios.pruneClosedOrders(closedOrders).catch((error) => {
          this.logger.warn(`No se pudo limpiar el plan global: ${(error as Error).message}`);
        });
      }

      await this.audit.record({
        actorId: input.actor?.id ?? null,
        actorEmail: input.actor?.code ?? null,
        action: 'ORDER_RECONCILE_RUN',
        entityType: 'OrderReconciliationRun',
        entityId: run.id,
        context: { trigger, dryRun, includeClosed, checked, closed, canceled, review, errorsCount },
      });

      this.logger.log(
        `Reconciliación de pedidos (${trigger}${dryRun ? ', dry-run' : ''}${
          includeClosed ? ', con cierres históricos' : ''
        }): revisados=${checked}, cerrados=${closed}, anulados=${canceled}, revisar=${review}`,
      );
      return this.toRun(finished);
    } catch (error) {
      errorsCount += 1;
      const message = error instanceof Error ? error.message : 'Error desconocido';
      const failed = await this.prisma.orderReconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'ERROR',
          finishedAt: new Date(),
          checked,
          closed,
          canceled,
          review,
          errorsCount,
          errorDetail: message,
        },
      });
      this.logger.error(`Reconciliación de pedidos falló: ${message}`);
      return this.toRun(failed);
    } finally {
      this.running = false;
    }
  }

  // ---------- Estado para el panel de administración ----------

  async status(query: OrderLifecycleQuery): Promise<OrderLifecycleStatus> {
    const [lastRun, events, reviewRows, reviewCount, closedToday, partialToday] = await Promise.all([
      this.prisma.orderReconciliationRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.orderLifecycleEvent.findMany({
        where: { reason: { in: ['NOTA_ENTREGA', 'NOTA_PARCIAL', 'CANCELADO', 'SIN_NOTA'] } },
        orderBy: { detectedAt: 'desc' },
        take: query.limit,
      }),
      this.prisma.salesOrder.findMany({
        where: { status: 'ABIERTO', reviewReason: { not: null } },
        include: { lines: { select: { pendingQty: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      this.prisma.salesOrder.count({ where: { status: 'ABIERTO', reviewReason: { not: null } } }),
      this.prisma.orderLifecycleEvent.count({
        where: {
          toStatus: 'NOTA_ENTREGA',
          detectedAt: { gte: startOfDay() },
          // Las revalidaciones históricas no son cierres nuevos del día.
          source: { not: 'REVALIDACION' },
        },
      }),
      this.prisma.orderLifecycleEvent.count({
        where: {
          toStatus: 'NOTA_PARCIAL',
          detectedAt: { gte: startOfDay() },
          source: { not: 'REVALIDACION' },
        },
      }),
    ]);

    return {
      lastRun: lastRun ? this.toRun(lastRun) : null,
      recent: events.map((event) => this.toEvent(event)),
      review: reviewRows.map((order) => this.toSummary(order)),
      closedToday,
      partialToday,
      pendingReview: reviewCount,
    };
  }

  // ---------- Reapertura manual ----------

  async reopen(actor: ReconcileActor, id: string, input: OrderReopenInput): Promise<OrderSummary> {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: { lines: { select: { pendingQty: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado.');
    if (order.isActive && !TERMINAL.includes(order.status)) {
      throw new ConflictException('Ese pedido ya está abierto.');
    }

    const fromStatus = order.status;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          status: 'ABIERTO',
          isActive: true,
          closedAt: null,
          closedReason: null,
          billingStatus: 'PENDIENTE',
          notaEntregaRefs: null,
          reviewReason: null,
          lastSeenInViewAt: new Date(),
          removedAt: null,
        },
        include: { lines: { select: { pendingQty: true } } },
      });
      await tx.orderLifecycleEvent.create({
        data: {
          orderId: order.id,
          orderNumber: order.externalNumber,
          customerCode: order.customerCode,
          customerName: order.customerName,
          fromStatus,
          toStatus: 'ABIERTO',
          reason: 'REAPERTURA',
          source: 'MANUAL',
          evidence: JSON.stringify({ reason: input.reason }),
          actorId: actor.id ?? null,
          actorCode: actor.code ?? null,
          detectedAt: new Date(),
        },
      });
      return row;
    });

    await this.audit.record({
      actorId: actor.id ?? null,
      actorEmail: actor.code ?? null,
      action: 'ORDER_REOPEN',
      entityType: 'SalesOrder',
      entityId: order.id,
      context: { orderNumber: order.externalNumber, fromStatus, reason: input.reason },
    });

    return this.toSummary(updated);
  }

  // ---------- Clasificación pura ----------

  private classify(
    order: Candidate,
    header: Record<string, unknown> | undefined,
    pending: Record<string, unknown> | undefined,
    fulfillment: Fulfillment | undefined,
  ): Classification {
    if (!header) {
      return { kind: 'review', reason: 'NO_EN_PROFIT' };
    }
    const status = String(header.status ?? '').trim();
    const anulada = header.anulada === true || header.anulada === 1 || header.anulada === '1';
    const pendingQty = number(pending?.pendiente);
    const f = fulfillment ?? EMPTY_FULFILLMENT;
    const evidence = {
      cotizStatus: status,
      anulada,
      pendingQty,
      lines: number(pending?.lineas),
      notes: f.notes,
      orderedQty: f.orderedQty,
      deliveredQty: f.deliveredQty,
      missingQty: f.missingQty,
      missing: f.missing,
      pedidos: f.pedidos,
      checkedAt: new Date().toISOString(),
    };

    if (anulada) {
      return {
        kind: 'close',
        toStatus: 'CANCELADO',
        reason: 'CANCELADO',
        billingStatus: 'PENDIENTE',
        evidence,
        notes: [],
      };
    }

    // La nota real manda sobre `status='2'`: si hay entregas, se compara por
    // artículo; si no hay ninguna, recién ahí se aplica la regla de anulación.
    if (f.hasNotes) {
      if (f.orderedLines === 0) {
        return { kind: 'review', reason: 'SIN_RENGLONES' };
      }
      if (f.complete) {
        return {
          kind: 'close',
          toStatus: 'NOTA_ENTREGA',
          reason: 'NOTA_ENTREGA',
          billingStatus: 'FACTURADO_ASUMIDO',
          evidence,
          notes: f.notes,
        };
      }
      return {
        kind: 'close',
        toStatus: 'NOTA_PARCIAL',
        reason: 'NOTA_PARCIAL',
        billingStatus: 'PENDIENTE',
        evidence,
        notes: f.notes,
      };
    }

    if (!status) {
      return { kind: 'review', reason: 'SIN_ESTADO' };
    }

    if (status === '2') {
      if (pendingQty > 0) {
        return { kind: 'review', reason: 'STATUS_2_CON_PENDIENTE' };
      }
      return {
        kind: 'close',
        toStatus: 'CANCELADO',
        reason: 'SIN_NOTA',
        billingStatus: 'PENDIENTE',
        evidence,
        notes: [],
      };
    }

    if (!order.isActive) {
      return { kind: 'review', reason: 'FUERA_DE_VISTA' };
    }
    return { kind: 'open' };
  }

  private async closeOrder(order: Candidate, result: CloseResult, actor?: ReconcileActor): Promise<void> {
    const now = new Date();
    const fromStatus = order.status;
    const updated = await this.prisma.salesOrder.updateMany({
      where: { id: order.id, status: 'ABIERTO' },
      data: {
        status: result.toStatus,
        isActive: false,
        closedAt: now,
        closedReason: result.reason,
        billingStatus: result.billingStatus,
        notaEntregaRefs: result.notes.length > 0 ? JSON.stringify(result.notes) : null,
        reviewReason: null,
        lastCheckedAt: now,
      },
    });
    if (updated.count === 0) return;
    await this.createLifecycleEvent(order, result, fromStatus, actor);
    await this.recordCloseAudit(order, result, actor);
  }

  // Revalida un pedido ya cerrado. Devuelve true solo si la clasificación
  // cambió (para no duplicar eventos ni contarlo dos veces en la corrida).
  private async reclassifyClosed(
    order: Candidate,
    result: CloseResult,
    actor: ReconcileActor | undefined,
    dryRun: boolean,
  ): Promise<boolean> {
    const fromStatus = order.status;
    const fromReason = order.closedReason;
    const changed = fromStatus !== result.toStatus || fromReason !== result.reason;
    if (dryRun) return changed;

    const now = new Date();
    await this.prisma.salesOrder.updateMany({
      where: { id: order.id },
      data: {
        status: result.toStatus,
        isActive: false,
        closedReason: result.reason,
        billingStatus: result.billingStatus,
        notaEntregaRefs: result.notes.length > 0 ? JSON.stringify(result.notes) : null,
        reviewReason: null,
        lastCheckedAt: now,
      },
    });
    if (!changed) return false;

    await this.createLifecycleEvent(order, result, fromStatus, actor, 'REVALIDACION');
    await this.audit.record({
      actorId: actor?.id ?? null,
      actorEmail: actor?.code ?? null,
      action: 'ORDER_LIFECYCLE_RECLASSIFY',
      entityType: 'SalesOrder',
      entityId: order.id,
      context: {
        orderNumber: order.externalNumber,
        customerCode: order.customerCode,
        customerName: order.customerName,
        fromStatus,
        fromReason,
        toStatus: result.toStatus,
        toReason: result.reason,
        billingStatus: result.billingStatus,
        evidence: result.evidence,
      },
    });
    return true;
  }

  private async createLifecycleEvent(
    order: Candidate,
    result: CloseResult,
    fromStatus: string,
    actor?: ReconcileActor,
    source: 'PROFIT' | 'REVALIDACION' = 'PROFIT',
  ): Promise<void> {
    await this.prisma.orderLifecycleEvent.create({
      data: {
        orderId: order.id,
        orderNumber: order.externalNumber,
        customerCode: order.customerCode,
        customerName: order.customerName,
        fromStatus,
        toStatus: result.toStatus,
        reason: result.reason,
        source,
        evidence: JSON.stringify(result.evidence),
        actorId: actor?.id ?? null,
        actorCode: actor?.code ?? null,
        detectedAt: new Date(),
      },
    });
  }

  private async recordCloseAudit(
    order: Candidate,
    result: CloseResult,
    actor?: ReconcileActor,
  ): Promise<void> {
    const action =
      result.toStatus === 'CANCELADO'
        ? 'ORDER_LIFECYCLE_CANCEL'
        : result.toStatus === 'NOTA_PARCIAL'
          ? 'ORDER_LIFECYCLE_PARTIAL'
          : 'ORDER_LIFECYCLE_CLOSE';
    await this.audit.record({
      actorId: actor?.id ?? null,
      actorEmail: actor?.code ?? null,
      action,
      entityType: 'SalesOrder',
      entityId: order.id,
      context: {
        orderNumber: order.externalNumber,
        customerCode: order.customerCode,
        customerName: order.customerName,
        billingStatus: result.billingStatus,
        evidence: result.evidence,
      },
    });
  }

  // ---------- Lectura de Profit ----------

  private parametrize(numbers: string[]): {
    numeric: number[];
    placeholders: string;
    params: Record<string, unknown>;
  } {
    const numeric = [
      ...new Set(
        numbers
          .map((value) => Math.trunc(Number(value)))
          .filter((value) => Number.isFinite(value)),
      ),
    ];
    const params: Record<string, unknown> = {};
    const placeholders = numeric.map((value, index) => {
      params[`o${index}`] = value;
      return `@o${index}`;
    });
    return { numeric, placeholders: placeholders.join(', '), params };
  }

  private async readHeaders(numbers: string[]): Promise<Map<string, Record<string, unknown>>> {
    const { numeric, placeholders, params } = this.parametrize(numbers);
    if (numeric.length === 0) return new Map();
    const sql = `SELECT /* order_lifecycle_header */ f.fact_num, f.status, f.anulada, f.fec_emis
      FROM dbo.cotiz_c AS f
      WHERE f.fact_num IN (${placeholders})`;
    const rows = await this.profit.selectQuery(sql, numeric.length + 1, params);
    return new Map(rows.map((row) => [String(row.fact_num), row]));
  }

  private async readPending(numbers: string[]): Promise<Map<string, Record<string, unknown>>> {
    const { numeric, placeholders, params } = this.parametrize(numbers);
    if (numeric.length === 0) return new Map();
    const sql = `SELECT /* order_lifecycle_pending */ r.fact_num, SUM(r.pendiente) AS pendiente, COUNT(*) AS lineas
      FROM dbo.reng_cac AS r
      WHERE r.fact_num IN (${placeholders})
        AND r.anulado = 0
      GROUP BY r.fact_num`;
    const rows = await this.profit.selectQuery(sql, numeric.length + 1, params);
    return new Map(rows.map((row) => [String(row.fact_num), row]));
  }

  // Cantidad pedida por artículo (`reng_cac.total_art`).
  private async readOrderLines(numbers: string[]): Promise<Map<string, Map<string, number>>> {
    const { numeric, placeholders, params } = this.parametrize(numbers);
    if (numeric.length === 0) return new Map();
    const sql = `SELECT /* order_lifecycle_lines */
        CAST(r.fact_num AS varchar(30)) AS solicitud,
        RTRIM(r.co_art) AS co_art,
        SUM(r.total_art) AS qty
      FROM dbo.reng_cac AS r
      WHERE r.fact_num IN (${placeholders})
        AND r.anulado = 0
      GROUP BY r.fact_num, RTRIM(r.co_art)`;
    const rows = await this.profit.selectQuery(
      sql,
      Math.min(100_000, Math.max(numeric.length * 60, 5_000)),
      params,
    );
    const byOrder = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const solicitud = text(row.solicitud);
      const coArt = text(row.co_art);
      if (!solicitud || !coArt) continue;
      addQuantity(byOrder, solicitud, coArt, number(row.qty));
    }
    return byOrder;
  }

  // Pedidos de Profit vinculados a cada solicitud y sus líneas completas.
  // Las líneas se piden para TODO el pedido (puede fusionar varias
  // solicitudes): así la cobertura del pedido no se calcula a medias.
  private async readPedidos(numbers: string[]): Promise<{
    pedidosBySolicitud: Map<string, Set<string>>;
    orderedByPedido: Map<string, Map<string, number>>;
    solicitudesByPedido: Map<string, number>;
  }> {
    const { numeric, placeholders, params } = this.parametrize(numbers);
    if (numeric.length === 0) {
      return {
        pedidosBySolicitud: new Map(),
        orderedByPedido: new Map(),
        solicitudesByPedido: new Map(),
      };
    }
    const sql = `SELECT /* order_lifecycle_pedidos */
        CAST(rp.num_doc AS varchar(30)) AS solicitud,
        CAST(rp.fact_num AS varchar(30)) AS pedido,
        RTRIM(rp.co_art) AS co_art,
        SUM(rp.total_art) AS qty,
        (SELECT COUNT(DISTINCT rp2.num_doc)
           FROM dbo.reng_ped AS rp2
          WHERE rp2.tipo_doc = 'T' AND rp2.fact_num = rp.fact_num) AS pedido_solicitudes
      FROM dbo.reng_ped AS rp
      INNER JOIN (
        SELECT DISTINCT fact_num
        FROM dbo.reng_ped
        WHERE tipo_doc = 'T' AND num_doc IN (${placeholders})
      ) AS p ON p.fact_num = rp.fact_num
      INNER JOIN dbo.pedidos AS pe ON pe.fact_num = rp.fact_num AND pe.anulada = 0
      WHERE rp.tipo_doc = 'T' AND rp.anulado = 0
      GROUP BY rp.num_doc, rp.fact_num, RTRIM(rp.co_art)`;
    const rows = await this.profit.selectQuery(
      sql,
      Math.min(100_000, Math.max(numeric.length * 100, 5_000)),
      params,
    );

    const pedidosBySolicitud = new Map<string, Set<string>>();
    const orderedByPedido = new Map<string, Map<string, number>>();
    const solicitudesByPedido = new Map<string, number>();
    const wanted = new Set(numeric.map(String));
    for (const row of rows) {
      const solicitud = text(row.solicitud);
      const pedido = text(row.pedido);
      const coArt = text(row.co_art);
      if (!pedido) continue;
      if (coArt) addQuantity(orderedByPedido, pedido, coArt, number(row.qty));
      if (!solicitudesByPedido.has(pedido)) {
        solicitudesByPedido.set(pedido, Math.max(1, Math.trunc(number(row.pedido_solicitudes))));
      }
      if (!wanted.has(solicitud)) continue;
      const set = pedidosBySolicitud.get(solicitud) ?? new Set<string>();
      set.add(pedido);
      pedidosBySolicitud.set(solicitud, set);
    }
    return { pedidosBySolicitud, orderedByPedido, solicitudesByPedido };
  }

  // Notas de entrega no anuladas. Devuelve por separado las notas directas
  // (`tipo_doc='T'`, origen = solicitud) y las de pedido (`tipo_doc='P'`).
  private async readNotes(numbers: string[]): Promise<{
    directBySolicitud: Map<string, Map<string, number>>;
    directNotes: Map<string, Set<string>>;
    deliveredByPedido: Map<string, Map<string, number>>;
    notesByPedido: Map<string, Set<string>>;
  }> {
    const { numeric, placeholders, params } = this.parametrize(numbers);
    if (numeric.length === 0) {
      return {
        directBySolicitud: new Map(),
        directNotes: new Map(),
        deliveredByPedido: new Map(),
        notesByPedido: new Map(),
      };
    }
    const sql = `SELECT /* order_lifecycle_notes */
        x.solicitud, x.pedido, x.nota, x.co_art, SUM(x.qty) AS qty
      FROM (
        SELECT CAST(d.num_doc AS varchar(30)) AS solicitud,
               CAST(NULL AS varchar(30)) AS pedido,
               CAST(d.fact_num AS varchar(30)) AS nota,
               RTRIM(d.co_art) AS co_art,
               d.total_art AS qty
        FROM dbo.reng_nde AS d
        INNER JOIN dbo.not_ent AS n ON n.fact_num = d.fact_num AND n.anulada = 0
        WHERE d.tipo_doc = 'T' AND d.anulado = 0
          AND d.num_doc IN (${placeholders})
        UNION ALL
        SELECT CAST(rp.num_doc AS varchar(30)) AS solicitud,
               CAST(d.num_doc AS varchar(30)) AS pedido,
               CAST(d.fact_num AS varchar(30)) AS nota,
               RTRIM(d.co_art) AS co_art,
               d.total_art AS qty
        FROM dbo.reng_nde AS d
        INNER JOIN dbo.not_ent AS n ON n.fact_num = d.fact_num AND n.anulada = 0
        INNER JOIN dbo.pedidos AS p ON p.fact_num = d.num_doc AND p.anulada = 0
        INNER JOIN (
          SELECT DISTINCT fact_num, num_doc
          FROM dbo.reng_ped
          WHERE tipo_doc = 'T'
        ) AS rp ON rp.fact_num = d.num_doc
        WHERE d.tipo_doc = 'P' AND d.anulado = 0
          AND rp.num_doc IN (${placeholders})
      ) AS x
      GROUP BY x.solicitud, x.pedido, x.nota, x.co_art`;
    const rows = await this.profit.selectQuery(
      sql,
      Math.min(100_000, Math.max(numeric.length * 150, 10_000)),
      params,
    );

    const directBySolicitud = new Map<string, Map<string, number>>();
    const directNotes = new Map<string, Set<string>>();
    const deliveredByPedido = new Map<string, Map<string, number>>();
    const notesByPedido = new Map<string, Set<string>>();
    const seenPedidoLine = new Set<string>();

    for (const row of rows) {
      const solicitud = text(row.solicitud);
      const pedido = text(row.pedido);
      const nota = text(row.nota);
      const coArt = text(row.co_art);
      const qty = number(row.qty);
      if (!nota) continue;

      if (solicitud && !pedido) {
        if (coArt) addQuantity(directBySolicitud, solicitud, coArt, qty);
        addToSet(directNotes, solicitud, nota);
        continue;
      }

      if (pedido) {
        // El pedido puede estar vinculado a varias solicitudes: la misma
        // línea de nota llega una vez por solicitud. Se deduplica por
        // (pedido, nota, artículo) para no sumarla varias veces.
        const key = `${pedido}|${nota}|${coArt}`;
        if (seenPedidoLine.has(key)) continue;
        seenPedidoLine.add(key);
        if (coArt) addQuantity(deliveredByPedido, pedido, coArt, qty);
        addToSet(notesByPedido, pedido, nota);
      }
    }

    return { directBySolicitud, directNotes, deliveredByPedido, notesByPedido };
  }

  // Cruza pedido y notas y deja la cobertura lista por solicitud.
  private async readFulfillment(numbers: string[]): Promise<Map<string, Fulfillment>> {
    const { numeric } = this.parametrize(numbers);
    if (numeric.length === 0) return new Map();

    const [orderLines, pedidos, notes] = await Promise.all([
      this.readOrderLines(numbers),
      this.readPedidos(numbers),
      this.readNotes(numbers),
    ]);

    const result = new Map<string, Fulfillment>();
    for (const value of numeric) {
      const solicitud = String(value);
      const ordered = orderLines.get(solicitud) ?? new Map<string, number>();
      const directDelivered = notes.directBySolicitud.get(solicitud) ?? new Map<string, number>();
      const directNotes = notes.directNotes.get(solicitud) ?? new Set<string>();
      const linkedPedidos = pedidos.pedidosBySolicitud.get(solicitud) ?? new Set<string>();

      // Entregado atribuible a la solicitud: notas directas + notas de sus
      // pedidos. En pedidos compartidos esto puede incluir cantidades de otras
      // solicitudes; por eso la decisión final también exige que el pedido
      // completo esté cubierto.
      const deliveredForSolicitud = new Map<string, number>();
      for (const [coArt, qty] of directDelivered) {
        deliveredForSolicitud.set(coArt, (deliveredForSolicitud.get(coArt) ?? 0) + qty);
      }
      for (const pedido of linkedPedidos) {
        for (const [coArt, qty] of notes.deliveredByPedido.get(pedido) ?? new Map<string, number>()) {
          deliveredForSolicitud.set(coArt, (deliveredForSolicitud.get(coArt) ?? 0) + qty);
        }
      }

      let orderedQty = 0;
      let deliveredQty = 0;
      const missing: MissingArticle[] = [];
      for (const [coArt, qty] of ordered) {
        orderedQty += qty;
        const delivered = deliveredForSolicitud.get(coArt) ?? 0;
        deliveredQty += Math.min(qty, delivered);
        if (delivered + QUANTITY_EPSILON < qty) {
          missing.push({ coArt, ordered: qty, delivered });
        }
      }

      const pedidosCoverage: PedidoCoverage[] = [];
      let pedidosWithNotes = 0;
      let allPedidosComplete = true;
      for (const pedido of linkedPedidos) {
        const pedidoOrdered = pedidos.orderedByPedido.get(pedido) ?? new Map<string, number>();
        const pedidoDelivered = notes.deliveredByPedido.get(pedido) ?? new Map<string, number>();
        const pedidoNotes = notes.notesByPedido.get(pedido) ?? new Set<string>();
        const hasNotes = pedidoNotes.size > 0;
        let complete = pedidoOrdered.size > 0;
        for (const [coArt, qty] of pedidoOrdered) {
          if ((pedidoDelivered.get(coArt) ?? 0) + QUANTITY_EPSILON < qty) {
            complete = false;
            break;
          }
        }
        if (hasNotes) {
          pedidosWithNotes += 1;
          if (!complete) allPedidosComplete = false;
        }
        pedidosCoverage.push({
          number: pedido,
          solicitudes: pedidos.solicitudesByPedido.get(pedido) ?? 1,
          complete,
          hasNotes,
        });
      }

      const directMissing = [...ordered].some(
        ([coArt, qty]) => (directDelivered.get(coArt) ?? 0) + QUANTITY_EPSILON < qty,
      );
      const directComplete = ordered.size > 0 && !directMissing;
      const solicitudComplete = ordered.size > 0 && missing.length === 0;
      // Si el pedido de Profit tiene notas, la cobertura del pedido manda. Si
      // no las tiene, se usan las notas directas de la solicitud.
      const complete =
        pedidosWithNotes > 0
          ? allPedidosComplete &&
            solicitudComplete &&
            (directNotes.size === 0 || directComplete)
          : solicitudComplete;

      const allNotes = new Set(directNotes);
      for (const pedido of linkedPedidos) {
        for (const nota of notes.notesByPedido.get(pedido) ?? new Set<string>()) allNotes.add(nota);
      }

      result.set(solicitud, {
        orderedLines: ordered.size,
        orderedQty,
        deliveredQty,
        missingQty: Math.max(0, orderedQty - deliveredQty),
        missing,
        notes: [...allNotes].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
        complete: allNotes.size > 0 && complete && ordered.size > 0,
        hasNotes: allNotes.size > 0,
        pedidos: pedidosCoverage,
      });
    }
    return result;
  }

  // ---------- Mapeo ----------

  private toRun(row: RunRow): OrderReconciliationRun {
    return {
      id: row.id,
      status: row.status as OrderReconciliationRun['status'],
      dryRun: row.dryRun,
      trigger: row.trigger,
      startedAt: row.startedAt.toISOString(),
      finishedAt: iso(row.finishedAt),
      checked: row.checked,
      closed: row.closed,
      canceled: row.canceled,
      review: row.review,
      errorsCount: row.errorsCount,
      errorDetail: row.errorDetail,
    };
  }

  private toEvent(row: EventRow): OrderLifecycleEvent {
    return {
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      customerCode: row.customerCode,
      customerName: row.customerName,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      reason: row.reason as OrderLifecycleEvent['reason'],
      source: row.source,
      evidence: parseEvidence(row.evidence),
      actorId: row.actorId,
      actorCode: row.actorCode,
      actorName: row.actorName,
      detectedAt: row.detectedAt.toISOString(),
    };
  }

  private toSummary(order: OrderWithLines): OrderSummary {
    const totalPendingQty = order.lines.reduce((acc, line) => acc + number(line.pendingQty), 0);
    return {
      id: order.id,
      externalNumber: order.externalNumber,
      customerCode: order.customerCode,
      customerName: order.customerName,
      vendor: order.vendor,
      customerType: order.customerType,
      authorized: order.authorized,
      orderDate: iso(order.orderDate),
      requestedDate: iso(order.requestedDate),
      status: order.status as OrderStatus,
      linesCount: order.lines.length,
      totalPendingQty,
      closedAt: iso(order.closedAt),
      closedReason: order.closedReason,
      billingStatus: order.billingStatus as OrderBillingStatus,
      notaEntregaRefs: parseRefs(order.notaEntregaRefs),
      reviewReason: order.reviewReason,
    };
  }
}
