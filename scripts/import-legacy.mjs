// ============================================================
// Importa a PostgreSQL (vía Prisma) el JSON generado por export-legacy.mjs.
// Idempotente: se puede correr varias veces sin duplicar.
//
// Uso dentro del contenedor api (el WORKDIR de la imagen es /app/apps/api):
//   docker compose run --rm -v "$PWD/import:/import" api node /app/scripts/import-legacy.mjs /import/legacy.json
// ============================================================
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

// Resuelve @prisma/client desde apps/api (ahí se generó el cliente).
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const file = resolve(process.argv[2] ?? 'import/legacy.json');
const data = JSON.parse(readFileSync(file, 'utf8'));
const prisma = new PrismaClient();

const iso = (value) => (value ? new Date(value) : null);

async function importDeliveryDates() {
  let overrides = 0;
  for (const row of data.DeliveryDateOverride ?? []) {
    await prisma.deliveryDateOverride.upsert({
      where: { orderNumber_productCode: { orderNumber: row.orderNumber, productCode: row.productCode } },
      update: {
        customerCode: row.customerCode ?? null,
        tentativeDate: iso(row.tentativeDate),
        note: row.note ?? null,
        updatedById: row.updatedById ?? null,
        updatedByCode: row.updatedByCode ?? null,
      },
      create: {
        id: row.id,
        orderNumber: row.orderNumber,
        productCode: row.productCode,
        customerCode: row.customerCode ?? null,
        tentativeDate: iso(row.tentativeDate),
        note: row.note ?? null,
        createdById: row.createdById ?? null,
        createdByCode: row.createdByCode ?? null,
        updatedById: row.updatedById ?? null,
        updatedByCode: row.updatedByCode ?? null,
        createdAt: iso(row.createdAt) ?? undefined,
        updatedAt: iso(row.updatedAt) ?? undefined,
      },
    });
    overrides += 1;
  }

  let changes = 0;
  for (const row of data.DeliveryDateChange ?? []) {
    await prisma.deliveryDateChange.upsert({
      where: { id: row.id },
      update: {},
      create: {
        id: row.id,
        batchId: row.batchId ?? null,
        orderNumber: row.orderNumber,
        productCode: row.productCode,
        customerCode: row.customerCode ?? null,
        previousDate: iso(row.previousDate),
        newDate: iso(row.newDate),
        action: row.action,
        note: row.note ?? null,
        changedById: row.changedById ?? null,
        changedByCode: row.changedByCode ?? null,
        changedAt: iso(row.changedAt) ?? undefined,
      },
    });
    changes += 1;
  }

  return { overrides, changes };
}

async function importForecast() {
  const idMap = new Map();
  let forecasts = 0;
  for (const row of data.Forecast ?? []) {
    const saved = await prisma.forecast.upsert({
      where: { productCode_year_month: { productCode: row.productCode, year: row.year, month: row.month } },
      update: {
        monthlyQty: row.monthlyQty ?? 0,
        locked: row.locked ?? false,
        lockedAt: iso(row.lockedAt),
        updatedBy: row.updatedBy ?? null,
      },
      create: {
        id: row.id,
        productCode: row.productCode,
        year: row.year,
        month: row.month,
        monthlyQty: row.monthlyQty ?? 0,
        locked: row.locked ?? false,
        lockedAt: iso(row.lockedAt),
        updatedBy: row.updatedBy ?? null,
        createdAt: iso(row.createdAt) ?? undefined,
        updatedAt: iso(row.updatedAt) ?? undefined,
      },
    });
    idMap.set(row.id, saved.id);
    forecasts += 1;
  }

  let weeks = 0;
  for (const row of data.ForecastWeek ?? []) {
    const forecastId = idMap.get(row.forecastId) ?? row.forecastId;
    await prisma.forecastWeek.upsert({
      where: { forecastId_weekIndex: { forecastId, weekIndex: row.weekIndex } },
      update: { qty: row.qty ?? 0 },
      create: { id: row.id, forecastId, weekIndex: row.weekIndex, qty: row.qty ?? 0 },
    });
    weeks += 1;
  }

  return { forecasts, weeks };
}

async function importSettings() {
  let settings = 0;
  for (const row of data.SystemSetting ?? []) {
    await prisma.systemSetting.upsert({
      where: { key: row.key },
      update: { value: row.value, description: row.description ?? null },
      create: { key: row.key, value: row.value, description: row.description ?? null },
    });
    settings += 1;
  }
  return { settings };
}

async function main() {
  const dates = await importDeliveryDates();
  const forecast = await importForecast();
  const settings = await importSettings();
  console.log('Import completado:');
  console.log(`  fechas tentativas: ${dates.overrides} (historial ${dates.changes})`);
  console.log(`  forecast: ${forecast.forecasts} (semanas ${forecast.weeks})`);
  console.log(`  configuración: ${settings.settings}`);
}

main()
  .catch((error) => {
    console.error('Error importando:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
