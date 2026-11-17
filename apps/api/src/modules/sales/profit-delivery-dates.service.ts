import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  ProfitDeliveryDateApplyResponse,
  ProfitDeliveryDateOrderResult,
  ProfitDeliveryDateSetInput,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { loadOrderDispatchStates } from '../dispatch/dispatch-order-state';
import { PROFIT_WRITER } from '../sync/profit-writer.adapter';
import type { ProfitWriter } from '../sync/profit-writer.adapter';
import type { DeliveryDateActor } from './delivery-dates.service';
import { CustomerInsightsService } from './customer-insights.service';

// ============================================================
// Cambio de la fecha de ENTREGA real del pedido.
//
// · Vive en el encabezado de Profit (`dbo.cotiz_c.fec_venc`): mover un renglón
//   mueve todo el pedido. Aquí se deduplica por número de pedido.
// · Se escribe PRIMERO en Profit y solo si Profit confirma se actualiza lo
//   local (SalesOrder.requestedDate) y se retira la fecha estimada vieja.
// · Si el pedido ya está en despacho con la carga iniciada, NO se toca: la
//   fecha quedó bloqueada en ambos sistemas (`cotiz_c.aux01 = 1`).
// · Si el despacho está abierto y la carga no ha iniciado, la hoja se MUEVE a
//   la nueva fecha (no se crea otra).
// · Queda registrado quién lo hizo (DeliveryDateChange + bitácora). La
//   pantalla de Pedidos no muestra ese dato.
// ============================================================

const CLOSED_STATUSES = new Set(['NOTA_ENTREGA', 'CERRADO', 'CANCELADO', 'DESCONOCIDO']);

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function startOfDayUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

@Injectable()
export class ProfitDeliveryDatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Inject(PROFIT_WRITER) private readonly writer: ProfitWriter,
    // La ficha 360 cachea 5 minutos; al mover una entrega se invalida para que
    // la reputación del cliente refleje el cambio de inmediato.
    private readonly insights: CustomerInsightsService,
  ) {}

  async setDates(
    input: Pick<ProfitDeliveryDateSetInput, 'items' | 'date' | 'cause' | 'reason' | 'note'>,
    actor: DeliveryDateActor,
  ): Promise<ProfitDeliveryDateApplyResponse> {
    const { items, date, cause, reason, note } = input;
    if (!this.writer.enabled) {
      throw new ServiceUnavailableException(
        'El cambio de entrega en Profit no está habilitado. Falta configurar PROFIT_WRITE_ENABLED y las credenciales de escritura.',
      );
    }

    // Con qué usuario de Profit queda firmado el cambio en `co_us_mo`.
    const userCode = (actor.code ?? '').trim();
    if (!userCode) {
      throw new BadRequestException(
        'La sesión no tiene código de Profit: no se puede atribuir el cambio en Profit.',
      );
    }

    const orderNumbers = [...new Set(items.map((item) => item.orderNumber.trim()).filter(Boolean))];
    if (orderNumbers.length === 0) {
      throw new BadRequestException('No hay pedidos para actualizar.');
    }
    const maxOrders = this.config.get<number>('profit.write.maxOrders') ?? 50;
    if (orderNumbers.length > maxOrders) {
      throw new BadRequestException(`Máximo ${maxOrders} pedidos por operación.`);
    }

    const orders = await this.prisma.salesOrder.findMany({
      where: { externalNumber: { in: orderNumbers } },
      include: { lines: { select: { productCode: true } } },
    });
    const orderByNumber = new Map(orders.map((order) => [order.externalNumber, order]));

    const results: ProfitDeliveryDateOrderResult[] = [];
    const previousByOrder: Record<string, string | null> = {};
    const dryRun = this.writer.dryRun;
    const batchId = `profit-${randomUUID()}`;
    // Estado en despacho: un pedido en carga ya no acepta cambios y, si solo
    // está publicado, su hoja se mueve a la nueva fecha.
    const dispatchStates = await loadOrderDispatchStates(this.prisma, orderNumbers);

    for (const orderNumber of orderNumbers) {
      const order = orderByNumber.get(orderNumber);
      if (!order) {
        results.push({
          orderNumber,
          previousDate: null,
          newDate: null,
          status: 'FAILED',
          message: 'El pedido no está sincronizado en Nexo.',
        });
        continue;
      }

      const current = dateOnly(order.requestedDate);
      previousByOrder[orderNumber] = current;
      const dispatchState = dispatchStates.get(orderNumber);

      if (!order.isActive || CLOSED_STATUSES.has(order.status)) {
        results.push({
          orderNumber,
          previousDate: current,
          newDate: null,
          status: 'SKIPPED',
          message: 'El pedido ya está cerrado o anulado en Profit.',
        });
        continue;
      }

      if (dispatchState?.started) {
        results.push({
          orderNumber,
          previousDate: current,
          newDate: null,
          status: 'SKIPPED',
          message: `La carga ya inició en el despacho ${dispatchState.sheetNumber}: la fecha no se puede cambiar.`,
        });
        continue;
      }

      const overrides = await this.prisma.deliveryDateOverride.count({ where: { orderNumber } });

      if (current === date) {
        if (!dryRun) {
          // Aun sin escribir en Profit, la hoja abierta debe seguir la fecha.
          await this.moveDispatchDate(orderNumber, date, actor, current);
        }
        if (overrides === 0) {
          results.push({ orderNumber, previousDate: current, newDate: date, status: 'UNCHANGED', message: null });
          continue;
        }
        // La fecha real ya coincide: solo se retira la capa estimada vieja.
        if (!dryRun) {
          await this.prisma.deliveryDateOverride.deleteMany({ where: { orderNumber } });
        }
        results.push({
          orderNumber,
          previousDate: current,
          newDate: date,
          status: 'APPLIED',
          message: 'Sin cambios en Profit; se retiró la fecha estimada local.',
        });
        continue;
      }

      if (dryRun) {
        results.push({
          orderNumber,
          previousDate: current,
          newDate: date,
          status: 'APPLIED',
          message: 'Simulación: no se escribió en Profit.',
        });
        continue;
      }

      let written;
      try {
        written = await this.writer.updateOrderDeliveryDate(orderNumber, date, userCode);
      } catch (error) {
        results.push({
          orderNumber,
          previousDate: current,
          newDate: null,
          status: 'FAILED',
          message: error instanceof Error ? error.message : 'Profit rechazó el cambio.',
        });
        continue;
      }

      if (written.affected !== 1) {
        results.push({
          orderNumber,
          previousDate: current,
          newDate: null,
          status: 'FAILED',
          message: 'Profit no modificó el pedido (¿anulado o sin permiso de UPDATE?).',
        });
        continue;
      }

      await this.prisma.$transaction([
        this.prisma.salesOrder.update({
          where: { id: order.id },
          data: { requestedDate: startOfDayUtc(date), lastSyncedAt: new Date() },
        }),
        this.prisma.deliveryDateOverride.deleteMany({ where: { orderNumber } }),
        this.prisma.deliveryDateChange.create({
          data: {
            batchId,
            orderNumber,
            // El cambio es del encabezado: no pertenece a un artículo puntual.
            productCode: '*',
            customerCode: order.customerCode ? order.customerCode.trim().toUpperCase() : null,
            previousDate: order.requestedDate,
            newDate: startOfDayUtc(date),
            action: 'PROFIT_UPDATE',
            // Causa/motivo del cambio: alimenta la reputación de fechas.
            cause,
            reason: cause === 'CUSTOMER' ? (reason ?? null) : null,
            note: note ?? null,
            changedById: actor.id ?? null,
            changedByCode: actor.code ?? null,
          },
        }),
      ]);

      results.push({
        orderNumber,
        previousDate: written.previousDate ?? current,
        newDate: written.nextDate ?? date,
        status: 'APPLIED',
        message: null,
      });
      // La hoja de despacho abierta sigue la fecha de Profit: mismo registro,
      // sin publicar un despacho nuevo.
      await this.moveDispatchDate(orderNumber, date, actor, current);
    }

    const count = (status: ProfitDeliveryDateOrderResult['status']) =>
      results.filter((result) => result.status === status).length;

    if (count('APPLIED') > 0) this.insights.invalidate();

    await this.audit.record({
      actorId: actor.id ?? null,
      action: 'PROFIT_DELIVERY_DATE_SET',
      entityType: 'SalesOrder',
      entityId: orderNumbers.join(','),
      context: {
        date,
        cause,
        reason: cause === 'CUSTOMER' ? (reason ?? null) : null,
        note: note ?? null,
        dryRun,
        // Código de Profit con el que se firmó la modificación (co_us_mo).
        actorCode: userCode,
        requested: orderNumbers.length,
        applied: count('APPLIED'),
        unchanged: count('UNCHANGED'),
        skipped: count('SKIPPED'),
        failed: count('FAILED'),
        previousByOrder,
      },
    });

    return {
      dryRun,
      applied: count('APPLIED'),
      unchanged: count('UNCHANGED'),
      skipped: count('SKIPPED'),
      failed: count('FAILED'),
      orders: results,
    };
  }

  /**
   * Mueve la fecha de las líneas del pedido en los despachos abiertos y deja
   * el hito en la bitácora. Nunca crea una hoja: el despacho es el mismo.
   * También recalcula la fecha esperada de las llegadas (PCP) del cliente.
   */
  private async moveDispatchDate(
    orderNumber: string,
    date: string,
    actor: DeliveryDateActor,
    previousDate: string | null,
  ): Promise<void> {
    const sheets = await this.prisma.dispatchSheet.findMany({
      where: {
        status: { not: 'CANCELADO' },
        lines: { some: { orderNumber, status: { not: 'ANULADO' } } },
      },
      include: {
        lines: {
          where: { status: { not: 'ANULADO' } },
          select: { customerCode: true, effectiveDate: true },
        },
      },
    });
    if (sheets.length === 0) return;

    for (const sheet of sheets) {
      const needsMove = sheet.lines.some((line) => line.effectiveDate !== date);
      if (needsMove) {
        await this.prisma.dispatchSheetLine.updateMany({
          where: { sheetId: sheet.id, orderNumber, status: { not: 'ANULADO' } },
          data: { effectiveDate: date },
        });
        await this.prisma.dispatchSheetEvent.create({
          data: {
            sheetId: sheet.id,
            kind: 'SYSTEM',
            type: 'FECHA_MOVIDA',
            body: `La entrega del pedido ${orderNumber} se movió de ${previousDate ?? '—'} a ${date} desde Pedidos.`,
            authorId: actor.id ?? null,
            authorCode: actor.code ?? null,
            authorName: 'Pedidos',
          },
        });
      }

      // La llegada del cliente (PCP) se reprograma a la entrega más próxima.
      const earliest = new Map<string, string>();
      for (const line of sheet.lines) {
        const key = line.customerCode?.trim();
        const value = line.effectiveDate;
        if (!key || !value) continue;
        const current = earliest.get(key);
        if (!current || value < current) earliest.set(key, value);
      }
      for (const [customerCode, expectedDate] of earliest) {
        await this.prisma.customerArrival.updateMany({
          where: { sheetId: sheet.id, customerCode, status: 'ESPERADO' },
          data: { expectedDate },
        });
      }
    }
  }
}
