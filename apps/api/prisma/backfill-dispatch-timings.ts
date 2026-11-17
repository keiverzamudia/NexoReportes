// ============================================================
// Backfill idempotente de los relojes del despacho.
//
// Las hojas históricas no tienen `DispatchCustomerProgress`. Este script crea
// una fila por cliente y completa lo que se puede deducir:
//   · inicio de carga  = startedAt de la hoja o primer checkedAt
//   · cierre de carga  = completedAt o último checkedAt (si no quedan pendientes)
//   · factura          = nunca se inventa; queda null
//
// También completa el origen de T4 (`scenarioCreatedAt`) desde el escenario
// guardado o el borrador del equipo, y normaliza el estado legado CON_NOVEDAD.
//
// Solo escribe en la BD local. Ejecutar después de `db:push`:
//   pnpm --filter @nexo/api db:backfill:dispatch
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function customerKey(line: { customerCode: string | null; customerName: string | null }) {
  return line.customerCode?.trim() || line.customerName?.trim() || 'SIN_CLIENTE';
}

async function main() {
  const sheets = await prisma.dispatchSheet.findMany({
    include: { lines: true, customerProgress: true },
  });

  // Origen de T4: escenario guardado o borrador compartido.
  const scenarios = await prisma.dispatchScenario.findMany({ select: { id: true, createdAt: true } });
  const scenarioDates = new Map(scenarios.map((row) => [row.id, row.createdAt]));
  const draft = await prisma.dispatchDraft.findUnique({
    where: { id: 'GLOBAL' },
    select: { createdAt: true },
  });

  let origins = 0;
  let legacy = 0;
  for (const sheet of sheets) {
    const data: { scenarioCreatedAt?: Date; status?: string; startedAt?: Date } = {};
    if (!sheet.scenarioCreatedAt) {
      const origin = (sheet.scenarioId ? scenarioDates.get(sheet.scenarioId) : null) ?? draft?.createdAt ?? sheet.sentAt;
      data.scenarioCreatedAt = origin;
    }
    if (sheet.status === 'CON_NOVEDAD') data.status = 'EN_PROCESO';
    // La hoja nunca tuvo «Iniciar carga» pero sí marcas: ese es el arranque.
    if (!sheet.startedAt) {
      const firstChecked = sheet.lines
        .map((line) => line.checkedAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      if (firstChecked) data.startedAt = firstChecked;
    }
    if (Object.keys(data).length === 0) continue;
    await prisma.dispatchSheet.update({ where: { id: sheet.id }, data });
    if (data.scenarioCreatedAt) origins += 1;
    if (data.status) legacy += 1;
  }

  let created = 0;
  let updated = 0;

  for (const sheet of sheets) {
    const byCustomer = new Map<string, typeof sheet.lines>();
    for (const line of sheet.lines) {
      const key = customerKey(line);
      const bucket = byCustomer.get(key) ?? [];
      bucket.push(line);
      byCustomer.set(key, bucket);
    }
    const progressByKey = new Map(sheet.customerProgress.map((row) => [row.customerKey, row]));

    for (const [key, lines] of byCustomer) {
      const pending = lines.filter((line) => line.status === 'PENDIENTE').length;
      const checked = lines
        .map((line) => line.checkedAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime());
      const firstChecked = checked[0] ?? null;
      const lastChecked = checked.length > 0 ? checked[checked.length - 1] : null;
      const loadStartedAt = sheet.startedAt ?? firstChecked;
      const loadClosedAt = pending === 0 ? sheet.completedAt ?? lastChecked : null;
      const progress = progressByKey.get(key);

      if (!progress) {
        await prisma.dispatchCustomerProgress.create({
          data: {
            sheetId: sheet.id,
            customerKey: key,
            customerCode: lines[0]?.customerCode ?? null,
            customerName: lines[0]?.customerName ?? null,
            loadStartedAt,
            loadClosedAt,
          },
        });
        created += 1;
        continue;
      }

      const data: {
        customerCode?: string | null;
        customerName?: string | null;
        loadStartedAt?: Date;
        loadClosedAt?: Date;
      } = {};
      if (!progress.customerCode && lines[0]?.customerCode) data.customerCode = lines[0].customerCode;
      if (!progress.customerName && lines[0]?.customerName) data.customerName = lines[0].customerName;
      if (!progress.loadStartedAt && loadStartedAt) data.loadStartedAt = loadStartedAt;
      if (!progress.loadClosedAt && loadClosedAt) data.loadClosedAt = loadClosedAt;
      if (Object.keys(data).length > 0) {
        await prisma.dispatchCustomerProgress.update({ where: { id: progress.id }, data });
        updated += 1;
      }
    }
  }

  console.log(
    `Backfill de tiempos de despacho: ${sheets.length} hoja(s), ${origins} origen(es) T4, ${legacy} estado(s) legado(s), ${created} reloj(es) creado(s), ${updated} actualizado(s).`,
  );
}

main()
  .catch((error) => {
    console.error('No se pudo ejecutar el backfill de tiempos:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
