#!/usr/bin/env node
/**
 * Comprobaciones de Prisma antes de `nest start --watch` (script `dev`).
 *
 * 1. Cliente generado: `node_modules` no está versionado, así que al mergear o hacer pull de
 *    un schema nuevo en un worktree distinto el cliente queda desactualizado y `tsc` reporta
 *    cientos de errores del tipo "Property 'dispatchSheet' does not exist on type 'PrismaService'".
 *    Se compara un hash del schema con el de la última generación y solo se regenera si cambió.
 *
 *    En Windows `prisma generate` falla con EPERM al reemplazar `query_engine-windows.dll.node`
 *    si otro proceso (un dev server anterior, por ejemplo) tiene la DLL abierta. En ese caso se
 *    advierte y se continúa: bloquear el arranque sería peor que el aviso.
 *
 * 2. Base local: si `prisma/schema.prisma` trae tablas que la base de desarrollo todavía no
 *    tiene, la API arranca pero falla al usarlas (p.ej. "The table `main.Role` does not exist").
 *    Se detecta con `migrate diff --exit-code` y se sugiere el comando; nunca se aplica solo,
 *    porque `db push` puede ser destructivo.
 *
 * Variables:
 *   SKIP_PRISMA_CHECK=1  omite ambas comprobaciones (útil en CI o scripts).
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

if (process.env.SKIP_PRISMA_CHECK === '1') {
  console.log('[prisma] comprobaciones omitidas (SKIP_PRISMA_CHECK=1)');
  process.exit(0);
}

let cli;
try {
  const pkgPath = require.resolve('prisma/package.json');
  cli = path.resolve(path.dirname(pkgPath), JSON.parse(readFileSync(pkgPath, 'utf8')).bin.prisma);
} catch {
  console.warn('[prisma] no se encontró el CLI de Prisma; se usa el cliente y la base existentes.');
  process.exit(0);
}

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
} else {
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
}

// 0 = base al día · 2 = hay diferencias · 1 = no se pudo comparar (sin base, credenciales, etc.)
const diff = spawnSync(
  process.execPath,
  [
    cli,
    'migrate',
    'diff',
    '--from-schema-datasource',
    'prisma/schema.prisma',
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--exit-code',
  ],
  { cwd: apiRoot, stdio: 'ignore' },
);

if (diff.status === 2) {
  console.warn(
    '\n[prisma] la base local no coincide con el schema (faltan tablas o columnas).\n' +
      '         Ejecuta `pnpm --filter @nexo/api db:push` y reinicia el dev server.\n' +
      '         La API puede igualmente arrancar, pero fallará al tocar lo que falta.\n',
  );
}

process.exit(0);
