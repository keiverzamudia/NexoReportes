import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderBillingStatus,
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
// Ciclo de vida del pedido: cierre automático por nota de entrega.
//
// Regla de negocio (confirmada):
//   · cotiz_c.anulada = 1                  → CANCELADO
//   · cotiz_c.status = '2' y pendiente = 0 → NOTA_ENTREGA + FACTURADO_ASUMIDO
//   · status '2' con pendiente > 0         → REVISAR (dato inconsistente)
//   · status 0/1 pero ya no está en la vista → REVISAR (no se cierra por ausencia)
//
// Es idempotente y nunca escribe en Profit: solo SELECT parametrizados.
// Los pedidos cerrados se ocultan de la cartera (`isActive=false`) pero se
// conservan con todas sus líneas y eventos para auditoría.
// ============================================================

type ReconcileActor = { id?: string | null; code?: string | null };

type Candidate = Pick<
  SalesOrder,
  'id' | 'externalNumber' | 'customerCode' | 'customerName' | 'isActive' | 'status' | 'statusRaw'
>;

type OrderWithLines = SalesOrder & { lines: Pick<SalesOrderLine, 'pendingQty'>[] };

const TERMINAL = ['NOTA_ENTREGA', 'CERRADO', 'CANCELADO'];

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

    try {
      const orders = await this.prisma.salesOrder.findMany({
        where: {
          status: 'ABIERTO',
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
        },
        orderBy: { externalNumber: 'asc' },
      });

      const batchSize = this.config.get<number>('orderLifecycle.batchSize') ?? 200;

      for (let index = 0; index < orders.length; index += batchSize) {
        const chunk = orders.slice(index, index + batchSize);
        try {
          checked += chunk.length;
          const numbers = chunk.map((order) => order.externalNumber);
          const [headers, pendings] = await Promise.all([
            this.readHeaders(numbers),
            this.readPending(numbers),
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
            const result = this.classify(order, header, pending);
            if (result.kind === 'close') {
              if (result.toStatus === 'CANCELADO') canceled += 1;
              else closed += 1;
              closedOrders.push({ orderNumber: order.externalNumber, reason: result.reason });
              if (!dryRun) {
                await this.closeOrder(order, result, input.actor);
              }
            } else if (result.kind === 'review') {
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
        context: { trigger, dryRun, checked, closed, canceled, review, errorsCount },
      });

      this.logger.log(
        `Reconciliación de pedidos (${trigger}${dryRun ? ', dry-run' : ''}): revisados=${checked}, nota=${closed}, cancelados=${canceled}, revisar=${review}`,
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
    const [lastRun, events, reviewRows, reviewCount, closedToday] = await Promise.all([
      this.prisma.orderReconciliationRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.orderLifecycleEvent.findMany({
        where: { reason: { in: ['NOTA_ENTREGA', 'CANCELADO'] } },
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
        where: { toStatus: 'NOTA_ENTREGA', detectedAt: { gte: startOfDay() } },
      }),
    ]);

    return {
      lastRun: lastRun ? this.toRun(lastRun) : null,
      recent: events.map((event) => this.toEvent(event)),
      review: reviewRows.map((order) => this.toSummary(order)),
      closedToday,
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
  ):
    | { kind: 'close'; toStatus: 'NOTA_ENTREGA' | 'CANCELADO'; reason: string; billingStatus: OrderBillingStatus; evidence: Record<string, unknown> }
    | { kind: 'review'; reason: string }
    | { kind: 'open' } {
    if (!header) {
      return { kind: 'review', reason: 'NO_EN_PROFIT' };
    }
    const status = String(header.status ?? '').trim();
    const anulada = header.anulada === true || header.anulada === 1 || header.anulada === '1';
    const pendingQty = number(pending?.pendiente);
    const evidence = {
      cotizStatus: status,
      anulada,
      pendingQty,
      lines: number(pending?.lineas),
      checkedAt: new Date().toISOString(),
    };

    if (anulada) {
      return { kind: 'close', toStatus: 'CANCELADO', reason: 'CANCELADO', billingStatus: 'PENDIENTE', evidence };
    }
    if (status === '2') {
      if (pendingQty > 0) {
        return { kind: 'review', reason: 'STATUS_2_CON_PENDIENTE' };
      }
      return {
        kind: 'close',
        toStatus: 'NOTA_ENTREGA',
        reason: 'NOTA_ENTREGA',
        billingStatus: 'FACTURADO_ASUMIDO',
        evidence,
      };
    }
    if (!status) {
      return { kind: 'review', reason: 'SIN_ESTADO' };
    }
    if (!order.isActive) {
      return { kind: 'review', reason: 'FUERA_DE_VISTA' };
    }
    return { kind: 'open' };
  }

  private async closeOrder(
    order: Candidate,
    result: { toStatus: 'NOTA_ENTREGA' | 'CANCELADO'; reason: string; billingStatus: OrderBillingStatus; evidence: Record<string, unknown> },
    actor?: ReconcileActor,
  ): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.salesOrder.updateMany({
      where: { id: order.id, status: 'ABIERTO' },
      data: {
        status: result.toStatus,
        isActive: false,
        closedAt: now,
        closedReason: result.reason,
        billingStatus: result.billingStatus,
        notaEntregaRefs: null,
        reviewReason: null,
        lastCheckedAt: now,
      },
    });
    if (updated.count === 0) return;
    await this.prisma.orderLifecycleEvent.create({
      data: {
        orderId: order.id,
        orderNumber: order.externalNumber,
        customerCode: order.customerCode,
        customerName: order.customerName,
        fromStatus: order.status,
        toStatus: result.toStatus,
        reason: result.reason,
        source: 'PROFIT',
        evidence: JSON.stringify(result.evidence),
        actorId: actor?.id ?? null,
        actorCode: actor?.code ?? null,
        detectedAt: now,
      },
    });
    await this.audit.record({
      actorId: actor?.id ?? null,
      actorEmail: actor?.code ?? null,
      action: result.toStatus === 'CANCELADO' ? 'ORDER_LIFECYCLE_CANCEL' : 'ORDER_LIFECYCLE_CLOSE',
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

  private async readHeaders(numbers: string[]): Promise<Map<string, Record<string, unknown>>> {
    const numeric = numbers.filter((value) => Number.isFinite(Number(value)));
    if (numeric.length === 0) return new Map();
    const params: Record<string, unknown> = {};
    const placeholders = numeric.map((value, index) => {
      params[`o${index}`] = Math.trunc(Number(value));
      return `@o${index}`;
    });
    const sql = `SELECT /* order_lifecycle_header */ f.fact_num, f.status, f.anulada, f.fec_emis
      FROM dbo.cotiz_c AS f
      WHERE f.fact_num IN (${placeholders.join(', ')})`;
    const rows = await this.profit.selectQuery(sql, numeric.length + 1, params);
    return new Map(rows.map((row) => [String(row.fact_num), row]));
  }

  private async readPending(numbers: string[]): Promise<Map<string, Record<string, unknown>>> {
    const numeric = numbers.filter((value) => Number.isFinite(Number(value)));
    if (numeric.length === 0) return new Map();
    const params: Record<string, unknown> = {};
    const placeholders = numeric.map((value, index) => {
      params[`o${index}`] = Math.trunc(Number(value));
      return `@o${index}`;
    });
    const sql = `SELECT /* order_lifecycle_pending */ r.fact_num, SUM(r.pendiente) AS pendiente, COUNT(*) AS lineas
      FROM dbo.reng_cac AS r
      WHERE r.fact_num IN (${placeholders.join(', ')})
        AND r.anulado = 0
      GROUP BY r.fact_num`;
    const rows = await this.profit.selectQuery(sql, numeric.length + 1, params);
    return new Map(rows.map((row) => [String(row.fact_num), row]));
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
