// ============================================================
// Exporta desde la base SQLite vieja SOLO los datos que no vienen de Profit
// (fechas tentativas, forecast y configuración) a un JSON portable a Postgres.
//
// Uso (Windows, Node 22+):
//   node scripts/export-legacy.mjs --db="C:/.../Reportes/apps/api/prisma/nexo.db" --out=import/legacy.json
// ============================================================
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);

const dbPath = resolve(args.db ?? 'C:/Users/desarrollador02/Documents/porgramacion/Reportes/apps/api/prisma/nexo.db');
const outPath = resolve(args.out ?? 'import/legacy.json');

// Columnas DateTime (Prisma las guarda como enteros ms en SQLite).
const TABLES = {
  DeliveryDateOverride: ['tentativeDate', 'createdAt', 'updatedAt'],
  DeliveryDateChange: ['previousDate', 'newDate', 'changedAt'],
  Forecast: ['lockedAt', 'createdAt', 'updatedAt'],
  ForecastWeek: [],
  SystemSetting: ['updatedAt'],
};

function toDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'bigint') return new Date(Number(value)).toISOString();
  // Algunas versiones viejas de Prisma guardaban texto ISO.
  return new Date(value).toISOString();
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const existing = new Set(db.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name));

const out = {};
let total = 0;
for (const [table, dateColumns] of Object.entries(TABLES)) {
  if (!existing.has(table)) {
    out[table] = [];
    console.log(`${table}: (no existe en el origen)`);
    continue;
  }
  const rows = db.prepare(`select * from "${table}"`).all();
  out[table] = rows.map((row) => {
    const copy = { ...row };
    for (const column of dateColumns) if (column in copy) copy[column] = toDate(copy[column]);
    return copy;
  });
  total += rows.length;
  console.log(`${table}: ${rows.length}`);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`\nOK: ${total} filas exportadas a ${outPath}`);
