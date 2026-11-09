// ============================================================
// Espejo de la BD local: main → pruebas (solo desarrollo).
//
// El worktree `main` es la fuente de verdad. Este módulo toma una foto
// consistente de su SQLite (aunque la API de main esté escribiendo) y la
// vuelca en la BD del worktree actual dentro de UNA transacción: o entra
// todo, o no cambia nada.
//
// Reglas de oro:
//   · Unidireccional. Nunca se escribe en la BD de main.
//   · Se niega a correr desde el worktree `main`.
//   · Verifica el esquema antes de tocar nada (evita dejar la BD a medias).
//   · Usa listas explícitas de columnas: las dos BD pueden tener las mismas
//     columnas en distinto orden (pasó con SalesOrder.reviewReason).
// ============================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DbMirrorCount, DbMirrorInfo, DbMirrorStatus } from '@nexo/contracts';

type SqliteModule = typeof import('node:sqlite');

let sqlitePromise: Promise<SqliteModule> | null = null;

/**
 * `node:sqlite` se carga en diferido: el módulo solo existe a partir de
 * Node 22.5 y no queremos romper el arranque de producción (donde el espejo
 * está deshabilitado) si el runtime es más viejo.
 */
function sqlite(): Promise<SqliteModule> {
  sqlitePromise ??= import('node:sqlite');
  return sqlitePromise;
}

/**
 * Conexión de solo lectura con espera: main puede estar en plena transacción
 * de escritura y no queremos que una consulta de estado falle con SQLITE_BUSY.
 */
async function openReadOnly(dbPath: string): Promise<import('node:sqlite').DatabaseSync> {
  const { DatabaseSync } = await sqlite();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface SchemaSnapshot {
  tables: string[];
  columns: Map<string, ColumnInfo[]>;
}

export interface SnapshotHandle {
  /** Archivo temporal con la foto de main. */
  path: string;
  /** Directorio temporal que hay que borrar al terminar. */
  dir: string;
}

export interface RestoreOutcome {
  tables: number;
  rows: number;
  durationMs: number;
}

// ---------- Rutas ----------

/** `apps/api` tanto en `dist/` como al ejecutarse con tsx desde `src/`. */
export function apiRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

/** Raíz del worktree actual (`Reportes-pruebas`). */
export function repoRoot(): string {
  return path.resolve(apiRoot(), '..', '..');
}

function readEnvValue(apiDir: string, key: string): string | null {
  try {
    const content = readFileSync(path.join(apiDir, '.env'), 'utf8');
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.startsWith(`${key}=`)) continue;
      return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // sin .env: se usa el default
  }
  return null;
}

/** Convierte `file:C:/...` (o `file:./dev.db`) en una ruta absoluta. */
function dbPathFromUrl(url: string | null, apiDir: string): string | null {
  if (!url || !url.startsWith('file:')) return null;
  let file = url.slice('file:'.length).trim();
  // `file:/C:/...` (forma que produce Prisma en Windows).
  if (/^\/[A-Za-z]:/.test(file)) file = file.slice(1);
  if (!file) return null;
  // El CLI de Prisma resuelve las rutas relativas contra `prisma/`.
  return path.isAbsolute(file) ? path.normalize(file) : path.resolve(apiDir, 'prisma', file);
}

function resolveDbForApiDir(apiDir: string): string {
  const url = process.env.DATABASE_URL ?? readEnvValue(apiDir, 'DATABASE_URL');
  const fromUrl = dbPathFromUrl(url, apiDir);
  return fromUrl ?? path.join(apiDir, 'prisma', 'nexo.db');
}

/** BD que se va a sobrescribir (la del worktree actual). */
export function resolveTargetDb(): string {
  const resolved = resolveDbForApiDir(apiRoot());
  if (!existsSync(resolved)) {
    throw new Error(`No existe la BD destino: ${resolved}`);
  }
  return resolved;
}

/** Ruta del worktree que tiene la rama `main` según git. */
function mainWorktreePath(): string | null {
  try {
    const out = execFileSync('git', ['-C', repoRoot(), 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
    });
    for (const block of out.split(/\r?\n\r?\n/)) {
      const lines = block.split(/\r?\n/);
      const worktree = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length).trim();
      const branch = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length).trim();
      if (worktree && branch === 'refs/heads/main') return path.normalize(worktree);
    }
  } catch {
    // git no disponible: se usa DB_MIRROR_SOURCE
  }
  return null;
}

/** BD de la que se copia (worktree main). */
export function resolveSourceDb(): string {
  const explicit = process.env.DB_MIRROR_SOURCE?.trim();
  if (explicit) {
    const resolved = path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot(), explicit);
    if (!existsSync(resolved)) throw new Error(`DB_MIRROR_SOURCE no existe: ${resolved}`);
    return resolved;
  }

  const mainRoot = mainWorktreePath();
  if (!mainRoot) {
    throw new Error(
      'No encontré el worktree de la rama main. Define DB_MIRROR_SOURCE con la ruta del .db de main.',
    );
  }
  const apiDir = path.join(mainRoot, 'apps', 'api');
  const resolved = resolveDbForApiDir(apiDir);
  if (!existsSync(resolved)) throw new Error(`No existe la BD de main: ${resolved}`);
  return resolved;
}

/** Rama del worktree actual (vacío si git no responde). */
export function currentBranch(): string {
  try {
    return execFileSync('git', ['-C', repoRoot(), 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

/**
 * El espejo es unidireccional: si estamos en `main`, se aborta. La válvula
 * `DB_MIRROR_FORCE=1` existe solo para casos excepcionales y conscientes.
 */
export function assertMirrorAllowed(): void {
  if (process.env.DB_MIRROR_FORCE === '1') return;
  if (currentBranch() === 'main') {
    throw new Error(
      'Estás en el worktree main: el espejo va de main → pruebas y nunca al revés. ' +
        'Usa DB_MIRROR_FORCE=1 solo si sabes exactamente lo que haces.',
    );
  }
}

// ---------- Snapshot ----------

/**
 * Foto consistente de la BD origen con la API de backup online de SQLite.
 * No bloquea ni modifica la BD de main aunque su API esté escribiendo.
 */
export async function snapshotDatabase(sourcePath: string): Promise<SnapshotHandle> {
  const { backup } = await sqlite();
  const dir = mkdtempSync(path.join(tmpdir(), 'nexo-db-mirror-'));
  const dest = path.join(dir, 'snapshot.db');
  const db = await openReadOnly(sourcePath);
  try {
    await backup(db, dest);
  } finally {
    db.close();
  }
  return { path: dest, dir };
}

export function disposeSnapshot(snapshot: SnapshotHandle): void {
  rmSync(snapshot.dir, { recursive: true, force: true });
}

// ---------- Esquema ----------

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

async function readSchema(dbPath: string): Promise<SchemaSnapshot> {
  const db = await openReadOnly(dbPath);
  try {
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);

    const columns = new Map<string, ColumnInfo[]>();
    for (const table of tables) {
      columns.set(table, db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as unknown as ColumnInfo[]);
    }
    return { tables, columns };
  } finally {
    db.close();
  }
}

/**
 * Compara por nombre de columna, no por orden. Devuelve la lista de
 * incompatibilidades que impiden un volcado seguro.
 */
export async function compareSchemas(
  sourcePath: string,
  targetPath: string,
): Promise<{ issues: string[]; tables: string[] }> {
  const source = await readSchema(sourcePath);
  const target = await readSchema(targetPath);
  const issues: string[] = [];

  const targetTables = new Set(target.tables);
  for (const table of source.tables) {
    if (!targetTables.has(table)) {
      issues.push(`Falta la tabla "${table}" en la BD local.`);
      continue;
    }
    const sourceColumns = source.columns.get(table) ?? [];
    const targetColumns = new Map((target.columns.get(table) ?? []).map((column) => [column.name, column]));

    for (const column of sourceColumns) {
      const match = targetColumns.get(column.name);
      if (!match) {
        issues.push(`Falta la columna "${table}.${column.name}" en la BD local.`);
        continue;
      }
      if (match.type.toUpperCase() !== column.type.toUpperCase()) {
        issues.push(
          `Tipo distinto en "${table}.${column.name}": main=${column.type || '∅'} local=${match.type || '∅'}.`,
        );
      }
    }

    for (const column of target.columns.get(table) ?? []) {
      const inSource = sourceColumns.some((entry) => entry.name === column.name);
      if (!inSource && column.notnull === 1 && column.dflt_value === null && column.pk === 0) {
        issues.push(`La BD local exige "${table}.${column.name}" y main no la trae.`);
      }
    }
  }

  const sourceTables = new Set(source.tables);
  for (const table of target.tables) {
    if (!sourceTables.has(table)) {
      issues.push(`La BD local tiene la tabla "${table}" y main no (¿main está atrasado?).`);
    }
  }

  return { issues, tables: source.tables };
}

// ---------- Restauración ----------

async function rowCounts(dbPath: string, tables: string[]): Promise<Map<string, number>> {
  const db = await openReadOnly(dbPath);
  const counts = new Map<string, number>();
  try {
    for (const table of tables) {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`).get() as { c: number } | undefined;
      counts.set(table, Number(row?.c ?? 0));
    }
  } finally {
    db.close();
  }
  return counts;
}

/**
 * Vuelca el snapshot sobre la BD destino en una sola transacción.
 * Las FK se desactivan solo en esta conexión y se reactivan al terminar.
 */
export async function restoreFromSnapshot(targetPath: string, snapshotPath: string): Promise<RestoreOutcome> {
  const { DatabaseSync } = await sqlite();
  const schema = await readSchema(snapshotPath);
  const counts = await rowCounts(snapshotPath, schema.tables);
  const started = Date.now();

  const db = new DatabaseSync(targetPath);
  try {
    db.exec('PRAGMA busy_timeout = 10000');
    // Fuera de la transacción: SQLite no permite cambiarlo dentro de una.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`ATTACH DATABASE '${escapeSqlString(snapshotPath)}' AS mirror`);

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of schema.tables) {
        const columns = (schema.columns.get(table) ?? []).map((column) => quoteIdent(column.name)).join(', ');
        db.exec(`DELETE FROM ${quoteIdent(table)}`);
        db.exec(
          `INSERT INTO ${quoteIdent(table)} (${columns}) SELECT ${columns} FROM mirror.${quoteIdent(table)}`,
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }

    db.exec('DETACH DATABASE mirror');
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }

  const rows = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return { tables: schema.tables.length, rows, durationMs: Date.now() - started };
}

// ---------- Estado ----------

async function dbInfo(dbPath: string): Promise<DbMirrorInfo> {
  const stats = statSync(dbPath);
  const db = await openReadOnly(dbPath);
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get() as { c: number } | undefined;
    return {
      path: dbPath,
      modifiedAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
      tables: Number(row?.c ?? 0),
    };
  } finally {
    db.close();
  }
}

export async function dbMirrorStatus(busy = false): Promise<DbMirrorStatus> {
  const sourcePath = resolveSourceDb();
  const targetPath = resolveTargetDb();
  const { issues, tables } = await compareSchemas(sourcePath, targetPath);
  const [source, target] = await Promise.all([dbInfo(sourcePath), dbInfo(targetPath)]);
  const sourceCounts = await rowCounts(sourcePath, tables);
  const targetCounts = await rowCounts(targetPath, tables);

  const counts: DbMirrorCount[] = tables.map((table) => ({
    table,
    source: sourceCounts.get(table) ?? 0,
    target: targetCounts.get(table) ?? 0,
  }));

  return {
    enabled: true,
    source,
    target,
    schemaOk: issues.length === 0,
    schemaIssues: issues,
    counts,
    busy,
  };
}
