// ============================================================
// Limpieza única de pedidos duplicados entre despachos.
//
// Antes de la validación de publicación, un mismo pedido podía quedar en
// varias hojas (DSP-2026-0003/0011/0013/0015). Este script:
//   · detecta pedidos con renglones activos en más de una hoja,
//   · conserva UNA hoja por pedido (por defecto la que coincide con la
//     entrega real de Profit, `SalesOrder.requestedDate`),
//   · anula los renglones duplicados de las demás (nunca borra),
//   · anula la hoja que se queda sin renglones,
//   · alinea la fecha de la hoja conservada con la de Profit.
//
// Nunca toca hojas con carga iniciada o factura entregada: si hay más de una
// hoja bloqueada para el mismo pedido, lo reporta para revisión manual.
//
// Uso (por defecto simula, no escribe):
//   pnpm --filter @nexo/api exec tsx scripts/cleanup-dispatch-duplicates.ts
//   pnpm --filter @nexo/api exec tsx scripts/cleanup-dispatch-duplicates.ts --apply
//   ... --apply --force=DSP-2026-0008   (resuelve un caso con varias facturadas)
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
// Hoja a conservar cuando hay varias facturadas (decisión manual explícita).
const FORCE = process.argv.find((arg) => arg.startsWith('--force='))?.split('=')[1] ?? null;

const REMOVAL = {
  removedByCode: 'SCRIPT',
  removedByName: 'Limpieza de duplicados',
  removalReason: 'DUPLICADO_EN_DESPACHO',
  removalSource: 'SYSTEM',
} as const;

interface Entry {
  sheetId: string;
  sheetNumber: string;
  sentAt: Date;
  sheetStatus: string;
  lineId: string;
  effectiveDate: string | null;
  checkedAt: Date | null;
  lineStatus: string;
  customerCode: string | null;
  customerName: string | null;
  locked: boolean;
  invoiced: boolean;
}

interface SheetGroup {
  sheetId: string;
  sheetNumber: string;
  sentAt: Date;
  sheetStatus: string;
  entries: Entry[];
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function shortDate(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function customerKey(line: { customerCode: string | null; customerName: string | null }): string {
  return line.customerCode?.trim() || line.customerName?.trim() || 'SIN_CLIENTE';
}

function groupBySheet(entries: Entry[]): SheetGroup[] {
  const groups = new Map<string, SheetGroup>();
  for (const entry of entries) {
    const group = groups.get(entry.sheetId) ?? {
      sheetId: entry.sheetId,
      sheetNumber: entry.sheetNumber,
      sentAt: entry.sentAt,
      sheetStatus: entry.sheetStatus,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(entry.sheetId, group);
  }
  return [...groups.values()];
}

/**
 * Hoja que se conserva:
 *   1. la que ya tiene factura entregada (es el despacho oficial),
 *   2. si hay varias facturadas, no se decide (revisión manual),
 *   3. si no hay factura, la que coincide con la entrega de Profit,
 *   4. a igualdad, la publicación más reciente (la corrección posterior).
 */
function pickTarget(entries: Entry[], profitDate: string | null): SheetGroup | null {
  const sheets = groupBySheet(entries);
  if (FORCE) {
    const forced = sheets.find((sheet) => sheet.sheetNumber === FORCE);
    if (forced) return forced;
  }
  const invoiced = sheets.filter((sheet) => sheet.entries.some((entry) => entry.invoiced));
  if (invoiced.length > 1) return null;
  if (invoiced.length === 1) return invoiced[0]!;

  const matchesProfit = (sheet: SheetGroup) =>
    Boolean(profitDate) && sheet.entries.some((entry) => entry.effectiveDate === profitDate);
  return [...sheets].sort((a, b) => {
    const byProfit = Number(matchesProfit(b)) - Number(matchesProfit(a));
    if (byProfit !== 0) return byProfit;
    return b.sentAt.getTime() - a.sentAt.getTime();
  })[0]!;
}

async function main() {
  console.log(`Limpieza de despachos duplicados · modo ${APPLY ? 'APLICAR' : 'SIMULACIÓN'}`);

  const sheets = await prisma.dispatchSheet.findMany({
    where: { status: { not: 'CANCELADO' } },
    include: { lines: true, customerProgress: true },
    orderBy: { sentAt: 'asc' },
  });

  const byOrder = new Map<string, Entry[]>();
  for (const sheet of sheets) {
    const progressByKey = new Map(sheet.customerProgress.map((row) => [row.customerKey, row]));
    for (const line of sheet.lines) {
      if (line.status === 'ANULADO') continue;
      const progress = progressByKey.get(customerKey(line));
      const locked =
        sheet.status === 'DESPACHADO' ||
        line.checkedAt !== null ||
        line.status !== 'PENDIENTE' ||
        Boolean(progress?.loadStartedAt) ||
        Boolean(progress?.invoiceDeliveredAt);
      const entry: Entry = {
        sheetId: sheet.id,
        sheetNumber: sheet.number,
        sentAt: sheet.sentAt,
        sheetStatus: sheet.status,
        lineId: line.id,
        effectiveDate: shortDate(line.effectiveDate),
        checkedAt: line.checkedAt,
        lineStatus: line.status,
        customerCode: line.customerCode,
        customerName: line.customerName,
        locked,
        invoiced: Boolean(progress?.invoiceDeliveredAt),
      };
      const bucket = byOrder.get(line.orderNumber) ?? [];
      bucket.push(entry);
      byOrder.set(line.orderNumber, bucket);
    }
  }

  const duplicated = [...byOrder.entries()].filter(
    ([, entries]) => new Set(entries.map((entry) => entry.sheetId)).size > 1,
  );
  if (duplicated.length === 0) {
    console.log('No hay pedidos duplicados entre despachos abiertos.');
    return;
  }
  console.log(`Pedidos en más de un despacho: ${duplicated.length}`);

  const orders = await prisma.salesOrder.findMany({
    where: { externalNumber: { in: duplicated.map(([orderNumber]) => orderNumber) } },
    select: { externalNumber: true, requestedDate: true },
  });
  const profitDateByOrder = new Map(orders.map((order) => [order.externalNumber, dateOnly(order.requestedDate)]));

  let removed = 0;
  let canceled = 0;
  let pendingReview = 0;

  for (const [orderNumber, entries] of duplicated) {
    const profitDate = profitDateByOrder.get(orderNumber) ?? null;
    const target = pickTarget(entries, profitDate);
    if (!target) {
      pendingReview += 1;
      console.log(
        `  ! ${orderNumber}: más de una hoja con factura entregada (${groupBySheet(entries)
          .filter((sheet) => sheet.entries.some((entry) => entry.invoiced))
          .map((sheet) => sheet.sheetNumber)
          .join(', ')}). Revisión manual (usa --force=DSP-XXXX para elegir).`,
      );
      continue;
    }

    const duplicates = entries.filter((entry) => entry.sheetId !== target.sheetId);
    const targetDate = target.entries.find((entry) => entry.effectiveDate)?.effectiveDate ?? null;
    console.log(
      `  · ${orderNumber}: se conserva ${target.sheetNumber} (${targetDate ?? 'sin fecha'}), ` +
        `Profit ${profitDate ?? '—'}, se anulan ${[...new Set(duplicates.map((entry) => entry.sheetNumber))].join(', ')}`,
    );

    if (!APPLY) continue;

    for (const entry of duplicates) {
      await prisma.dispatchSheetLine.update({
        where: { id: entry.lineId },
        data: {
          status: 'ANULADO',
          loadedQty: null,
          loadedKg: null,
          removedAt: new Date(),
          removedByCode: REMOVAL.removedByCode,
          removedByName: REMOVAL.removedByName,
          removalReason: REMOVAL.removalReason,
          removalSource: REMOVAL.removalSource,
        },
      });
      await prisma.dispatchSheetEvent.create({
        data: {
          sheetId: entry.sheetId,
          kind: 'SYSTEM',
          type: 'RENGLON_ANULADO',
          body: `Pedido ${orderNumber} retirado: ya estaba en el despacho ${target.sheetNumber}.`,
          authorCode: REMOVAL.removedByCode,
          authorName: REMOVAL.removedByName,
        },
      });
      removed += 1;
    }

    // La hoja conservada sigue la entrega de Profit (una sola fecha).
    if (profitDate && targetDate !== profitDate) {
      await prisma.dispatchSheetLine.updateMany({
        where: { sheetId: target.sheetId, orderNumber, status: { not: 'ANULADO' } },
        data: { effectiveDate: profitDate },
      });
    }

    // Recalcula totales y anula la hoja que quedó vacía.
    for (const sheetId of new Set(duplicates.map((entry) => entry.sheetId))) {
      const active = await prisma.dispatchSheetLine.findMany({
        where: { sheetId, status: { not: 'ANULADO' } },
        select: { uom: true, plannedQty: true, plannedKg: true },
      });
      const round2 = (value: number) => Math.round(value * 100) / 100;
      const plannedSacks = round2(
        active.reduce((sum, line) => sum + (line.uom === 'SAC' ? Number(line.plannedQty) : 0), 0),
      );
      const plannedKg = round2(active.reduce((sum, line) => sum + Number(line.plannedKg), 0));
      if (active.length === 0) {
        canceled += 1;
        await prisma.dispatchSheet.update({
          where: { id: sheetId },
          data: {
            status: 'CANCELADO',
            canceledAt: new Date(),
            canceledByName: REMOVAL.removedByName,
            cancelReason: 'Limpieza de duplicados: el pedido ya estaba en otro despacho.',
            plannedLines: 0,
            plannedSacks: 0,
            plannedKg: 0,
          },
        });
        await prisma.dispatchSheetEvent.create({
          data: {
            sheetId,
            kind: 'SYSTEM',
            type: 'CANCELADO',
            body: 'Anulado automáticamente: todos sus pedidos ya estaban en otro despacho.',
            authorCode: REMOVAL.removedByCode,
            authorName: REMOVAL.removedByName,
          },
        });
      } else {
        await prisma.dispatchSheet.update({
          where: { id: sheetId },
          data: { plannedLines: active.length, plannedSacks, plannedKg },
        });
      }
    }
  }

  console.log(
    `${APPLY ? 'Aplicado' : 'Simulación'}: ${removed} renglón(es) anulados, ${canceled} hoja(s) anuladas, ${pendingReview} pedido(s) para revisión manual.`,
  );
  if (!APPLY) console.log('Vuelve a ejecutarlo con --apply para escribir los cambios.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
