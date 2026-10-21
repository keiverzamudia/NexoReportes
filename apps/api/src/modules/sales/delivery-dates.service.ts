import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DeliveryDateApplyResponse, DeliveryDateItem } from '@nexo/contracts';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';

// ============================================================
// Fecha de entrega TENTATIVA por renglón (pedido + artículo).
//
// Es una capa 100% local: nunca escribe en Profit ni modifica
// SalesOrder.requestedDate. El renglón conserva su fecha original y
// el reporte usa `tentativeDate ?? requestedDate` como fecha efectiva.
// ============================================================

export interface DeliveryDateActor {
  id?: string | null;
  code?: string | null;
}

export function deliveryDateKey(orderNumber: string, productCode: string): string {
  return `${orderNumber}#${productCode}`;
}

function startOfDayUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function uniqueItems(items: DeliveryDateItem[]): DeliveryDateItem[] {
  return [...new Map(items.map((item) => [deliveryDateKey(item.orderNumber, item.productCode), item])).values()];
}

@Injectable()
export class DeliveryDatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Mapa `pedido#artículo` → fecha tentativa ISO para los renglones dados. */
  async resolveForLines(lines: { orderNumber: string; productCode: string }[]): Promise<Map<string, string>> {
    if (lines.length === 0) return new Map();
    const orderNumbers = [...new Set(lines.map((line) => line.orderNumber))];
    const productCodes = new Set(lines.map((line) => line.productCode));
    const overrides = await this.prisma.deliveryDateOverride.findMany({
      where: { orderNumber: { in: orderNumbers } },
    });
    return new Map(
      overrides
        .filter((override) => productCodes.has(override.productCode))
        .map((override) => [
          deliveryDateKey(override.orderNumber, override.productCode),
          override.tentativeDate.toISOString(),
        ]),
    );
  }

  async setDates(items: DeliveryDateItem[], date: string, note: string | undefined, actor: DeliveryDateActor): Promise<DeliveryDateApplyResponse> {
    return this.apply(items, date, note, actor);
  }

  async restoreDates(items: DeliveryDateItem[], note: string | undefined, actor: DeliveryDateActor): Promise<DeliveryDateApplyResponse> {
    return this.apply(items, null, note, actor);
  }

  private async apply(
    items: DeliveryDateItem[],
    nextDate: string | null,
    note: string | undefined,
    actor: DeliveryDateActor,
  ): Promise<DeliveryDateApplyResponse> {
    const unique = uniqueItems(items);
    if (unique.length === 0) throw new BadRequestException('No hay renglones para actualizar.');

    const orderNumbers = [...new Set(unique.map((item) => item.orderNumber))];
    const productCodes = [...new Set(unique.map((item) => item.productCode))];
    const lines = await this.prisma.salesOrderLine.findMany({
      where: {
        productCode: { in: productCodes },
        order: { externalNumber: { in: orderNumbers }, isActive: true },
      },
      include: {
        order: { select: { externalNumber: true, requestedDate: true, customerCode: true } },
      },
    });

    const lineByKey = new Map<string, (typeof lines)[number]>();
    for (const line of lines) {
      lineByKey.set(deliveryDateKey(line.order.externalNumber, line.productCode), line);
    }

    const missing = unique.filter((item) => !lineByKey.has(deliveryDateKey(item.orderNumber, item.productCode)));
    if (missing.length > 0) {
      const list = missing
        .slice(0, 5)
        .map((item) => `${item.orderNumber}/${item.productCode}`)
        .join(', ');
      throw new BadRequestException(
        `No se encontraron renglones activos para: ${list}${missing.length > 5 ? '…' : ''}. Actualiza la lista e intenta de nuevo.`,
      );
    }

    const overrides = await this.prisma.deliveryDateOverride.findMany({
      where: { orderNumber: { in: orderNumbers } },
    });
    const overrideByKey = new Map(
      overrides.map((override) => [deliveryDateKey(override.orderNumber, override.productCode), override]),
    );

    const tentative = nextDate ? startOfDayUtc(nextDate) : null;
    if (nextDate && (!tentative || Number.isNaN(tentative.getTime()) || dateOnly(tentative) !== nextDate)) {
      throw new BadRequestException('La fecha no es válida.');
    }
    const batchId = randomUUID();
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    let updated = 0;
    let restored = 0;
    let unchanged = 0;

    for (const item of unique) {
      const key = deliveryDateKey(item.orderNumber, item.productCode);
      const line = lineByKey.get(key)!;
      const existing = overrideByKey.get(key);
      const original = dateOnly(line.order.requestedDate);
      // Elegir la fecha original equivale a restaurar: así el verde solo
      // aparece cuando la fecha realmente difiere de Profit.
      const wantsRestore = tentative === null || (original !== null && nextDate === original);
      const newDate = wantsRestore ? null : tentative;

      if (wantsRestore) {
        if (!existing) {
          unchanged += 1;
          continue;
        }
        ops.push(
          this.prisma.deliveryDateOverride.delete({ where: { id: existing.id } }),
          this.prisma.deliveryDateChange.create({
            data: {
              batchId,
              orderNumber: item.orderNumber,
              productCode: item.productCode,
              customerCode: line.order.customerCode,
              previousDate: existing.tentativeDate,
              newDate: null,
              action: 'RESTORE',
              note: note ?? null,
              changedById: actor.id ?? null,
              changedByCode: actor.code ?? null,
            },
          }),
        );
        restored += 1;
        continue;
      }

      if (existing && dateOnly(existing.tentativeDate) === nextDate) {
        unchanged += 1;
        continue;
      }

      const action = existing ? 'UPDATE' : 'SET';
      ops.push(
        this.prisma.deliveryDateOverride.upsert({
          where: { orderNumber_productCode: { orderNumber: item.orderNumber, productCode: item.productCode } },
          update: {
            customerCode: line.order.customerCode,
            tentativeDate: newDate!,
            note: note ?? null,
            updatedById: actor.id ?? null,
            updatedByCode: actor.code ?? null,
          },
          create: {
            orderNumber: item.orderNumber,
            productCode: item.productCode,
            customerCode: line.order.customerCode,
            tentativeDate: newDate!,
            note: note ?? null,
            createdById: actor.id ?? null,
            createdByCode: actor.code ?? null,
          },
        }),
        this.prisma.deliveryDateChange.create({
          data: {
            batchId,
            orderNumber: item.orderNumber,
            productCode: item.productCode,
            customerCode: line.order.customerCode,
            previousDate: existing?.tentativeDate ?? null,
            newDate,
            action,
            note: note ?? null,
            changedById: actor.id ?? null,
            changedByCode: actor.code ?? null,
          },
        }),
      );
      updated += 1;
    }

    if (ops.length > 0) await this.prisma.$transaction(ops);

    await this.audit.record({
      actorId: actor.id ?? null,
      action: nextDate ? 'DELIVERY_DATE_SET' : 'DELIVERY_DATE_RESTORE',
      entityType: 'DeliveryDate',
      entityId: batchId,
      context: {
        items: unique.length,
        updated,
        restored,
        unchanged,
        date: nextDate,
        note: note ?? null,
        orderNumbers: [...new Set(unique.map((item) => item.orderNumber))],
      },
    });

    return { updated, restored, unchanged };
  }
}
