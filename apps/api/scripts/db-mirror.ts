#!/usr/bin/env node
/**
 * Espejo de la base de datos local: worktree `main` → worktree actual.
 *
 * Uso:
 *   pnpm db:mirror            # copia main → pruebas (reemplaza la BD local)
 *   pnpm db:mirror:status     # compara esquema y filas, sin tocar nada
 *
 * El volcado es atómico (una transacción) y no requiere reiniciar la API:
 * Prisma ve los datos nuevos al instante. Es unidireccional: si se ejecuta
 * desde el worktree main, se aborta.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import {
  assertMirrorAllowed,
  compareSchemas,
  currentBranch,
  dbMirrorStatus,
  disposeSnapshot,
  resolveSourceDb,
  resolveTargetDb,
  restoreFromSnapshot,
  snapshotDatabase,
} from '../src/modules/db-mirror/db-mirror.core';

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function status(): Promise<void> {
  const data = await dbMirrorStatus();
  console.log(`Rama actual : ${currentBranch() || '(desconocida)'}`);
  console.log(`Origen      : ${data.source.path}`);
  console.log(`              ${data.source.modifiedAt} · ${bytes(data.source.sizeBytes)} · ${data.source.tables} tablas`);
  console.log(`Destino     : ${data.target.path}`);
  console.log(`              ${data.target.modifiedAt} · ${bytes(data.target.sizeBytes)} · ${data.target.tables} tablas`);
  console.log(`Esquema     : ${data.schemaOk ? 'compatible' : 'INCOMPATIBLE'}`);
  for (const issue of data.schemaIssues) console.log(`  - ${issue}`);

  const differences = data.counts.filter((row) => row.source !== row.target);
  console.log(`Tablas con diferencias de filas: ${differences.length}/${data.counts.length}`);
  for (const row of differences.slice(0, 12)) {
    console.log(`  ${row.table.padEnd(28)} main=${row.source} local=${row.target}`);
  }
  if (differences.length > 12) console.log(`  … y ${differences.length - 12} más`);
}

async function pull(): Promise<void> {
  assertMirrorAllowed();
  const sourcePath = resolveSourceDb();
  const targetPath = resolveTargetDb();
  console.log(`Origen : ${sourcePath}`);
  console.log(`Destino: ${targetPath}`);

  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    throw new Error('Origen y destino son el mismo archivo: no hay nada que espejar.');
  }

  const { issues } = await compareSchemas(sourcePath, targetPath);
  if (issues.length > 0) {
    console.error('\nEl esquema no coincide; no se tocó nada:');
    for (const issue of issues) console.error(`  - ${issue}`);
    console.error('\nCorre `pnpm db:push` en el worktree que esté atrasado y vuelve a intentar.');
    process.exitCode = 1;
    return;
  }

  const sourceModifiedAt = statSync(sourcePath).mtime.toISOString();
  const snapshot = await snapshotDatabase(sourcePath);
  try {
    const outcome = await restoreFromSnapshot(targetPath, snapshot.path);
    console.log(
      `\nOK · ${outcome.tables} tablas y ${outcome.rows} filas en ${outcome.durationMs} ms ` +
        `(foto de main: ${sourceModifiedAt}).`,
    );
  } finally {
    disposeSnapshot(snapshot);
  }
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'pull').toLowerCase();
  if (command === 'status') return status();
  if (command === 'pull') return pull();
  console.error(`Comando desconocido: ${command}. Usa "pull" o "status".`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
