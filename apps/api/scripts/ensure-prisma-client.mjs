#!/usr/bin/env node
/**
 * Regenera el cliente de Prisma solo si el contenido de `prisma/schema.prisma` cambió
 * desde la última generación. Se ejecuta antes de `nest start --watch` (script `dev`).
 *
 * Motivo: `node_modules` no está versionado, así que al mergear o hacer pull de un schema
 * nuevo en un worktree distinto el cliente generado queda desactualizado y `tsc` reporta
 * cientos de errores del tipo "Property 'dispatchSheet' does not exist on type 'PrismaService'".
 *
 * En Windows, `prisma generate` falla con EPERM al reemplazar `query_engine-windows.dll.node`
 * si otro proceso (un dev server anterior, por ejemplo) tiene la DLL abierta. En ese caso se
 * advierte y se continúa con el cliente existente: bloquear el arranque sería peor que el aviso.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(apiRoot, 'prisma', 'schema.prisma');
const stampPath = path.join(apiRoot, 'node_modules', '.prisma-client.hash');
const require = createRequire(path.join(apiRoot, 'package.json'));

let schemaHash;
try {
  schemaHash = createHash('sha256').update(readFileSync(schemaPath)).digest('hex');
} catch {
  console.warn('[prisma] no se encontró prisma/schema.prisma; se usa el cliente existente.');
  process.exit(0);
}

let stamp = null;
try {
  stamp = readFileSync(stampPath, 'utf8').trim();
} catch {
  // sin sello: se genera una vez
}

if (stamp === schemaHash) {
  console.log('[prisma] cliente generado al día');
  process.exit(0);
}

let cli;
try {
  const pkgPath = require.resolve('prisma/package.json');
  cli = path.resolve(path.dirname(pkgPath), JSON.parse(readFileSync(pkgPath, 'utf8')).bin.prisma);
} catch {
  console.warn('[prisma] no se encontró el CLI de Prisma; se usa el cliente existente.');
  process.exit(0);
}

console.log('[prisma] el schema cambió desde la última generación: regenerando cliente...');
const result = spawnSync(process.execPath, [cli, 'generate'], { cwd: apiRoot, stdio: 'inherit' });

if (result.status === 0) {
  try {
    writeFileSync(stampPath, schemaHash);
  } catch {
    // el sello es una optimización: si no se puede escribir, se reintenta en el próximo arranque
  }
} else {
  console.warn(
    '\n[prisma] no se pudo regenerar el cliente. Si Windows bloqueó `query_engine-windows.dll.node`,\n' +
      '         detén el dev server que sigue en ejecución y vuelve a intentarlo.\n' +
      '         Se continúa con el cliente existente.\n',
  );
}

process.exit(0);
