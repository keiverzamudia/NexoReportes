#!/usr/bin/env node
/**
 * Regenera el cliente de Prisma solo si el schema cambió respecto al cliente ya generado.
 *
 * Se ejecuta antes de `nest start --watch` (script `dev`).
 *
 * Motivo: `node_modules` no está versionado, así que al mergear o hacer pull de un schema
 * nuevo en un worktree distinto el cliente queda desactualizado y `tsc` reporta cientos de
 * errores del tipo "Property 'dispatchSheet' does not exist on type 'PrismaService'".
 *
 * En Windows, `prisma generate` falla con EPERM al reemplazar `query_engine-windows.dll.node`
 * si otro proceso (un dev server anterior, por ejemplo) tiene la DLL abierta. En ese caso se
 * advierte y se continúa con el cliente existente: bloquear el arranque sería peor que el aviso.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(apiRoot, 'prisma', 'schema.prisma');
const require = createRequire(path.join(apiRoot, 'package.json'));

const mtime = (file) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

function generatedClientTypes() {
  try {
    const entry = require.resolve('@prisma/client');
    return path.resolve(path.dirname(entry), '..', '.prisma', 'client', 'index.d.ts');
  } catch {
    return null;
  }
}

function prismaCliEntry() {
  try {
    const pkgPath = require.resolve('prisma/package.json');
    const { bin } = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return path.resolve(path.dirname(pkgPath), bin.prisma);
  } catch {
    return null;
  }
}

const typesPath = generatedClientTypes();
const clientMtime = typesPath ? mtime(typesPath) : 0;
const schemaMtime = mtime(schemaPath);

if (clientMtime > 0 && clientMtime >= schemaMtime) {
  console.log('[prisma] cliente generado al día');
  process.exit(0);
}

const cli = prismaCliEntry();
if (!cli) {
  console.warn('[prisma] no se encontró el CLI de Prisma; se usa el cliente existente.');
  process.exit(0);
}

console.log('[prisma] el schema cambió desde la última generación: regenerando cliente...');
const result = spawnSync(process.execPath, [cli, 'generate'], { cwd: apiRoot, stdio: 'inherit' });

if (result.status !== 0) {
  console.warn(
    '\n[prisma] no se pudo regenerar el cliente. Si Windows bloqueó `query_engine-windows.dll.node`,\n' +
      '         detén el dev server que sigue en ejecución y vuelve a intentarlo.\n' +
      '         Se continúa con el cliente existente.\n',
  );
}

process.exit(0);
