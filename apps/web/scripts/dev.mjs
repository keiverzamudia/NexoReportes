#!/usr/bin/env node
/**
 * Arranca `next dev` en el puerto indicado por `WEB_PORT` (variable de entorno o `.env.local`).
 *
 * Motivo: varios worktrees del repo (Reportes, Reportes-pruebas, Reportes-nuevo) corren a la
 * vez y el puerto del script `dev` es el mismo para todos, así que Next toma el primero libre
 * y termina mostrando la app de otro worktree. Con `WEB_PORT` cada copia local usa su puerto
 * sin tocar archivos versionados.
 *
 * Uso:
 *   WEB_PORT=4130 pnpm --filter @nexo/web dev    (o WEB_PORT=4130 en apps/web/.env.local)
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  killTree,
  portInUse,
  portOwners,
  processMatchesRoot,
  shortCommand,
  waitForPortFree,
} from '../../../scripts/dev-ports.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worktreeRoot = path.resolve(webRoot, '..', '..');
const DEFAULT_PORT = '4120';

function readEnvFile(key) {
  for (const file of ['.env.local', '.env']) {
    try {
      const content = readFileSync(path.join(webRoot, file), 'utf8');
      for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || !line.startsWith(`${key}=`)) continue;
        return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
      }
    } catch {
      // archivo ausente: se prueba el siguiente
    }
  }
  return null;
}

const port = String(process.env.WEB_PORT || readEnvFile('WEB_PORT') || DEFAULT_PORT).trim();

// Preflight: dos `next dev` del mismo worktree comparten `apps/web/.next` y lo
// corrompen ("Cannot find module './NNN.js'"). Si el puerto ya está ocupado,
// mostramos quién lo tiene y, si es de este mismo worktree, lo cerramos.
if (await portInUse(port)) {
  const owners = portOwners(port);
  const sameWorktree = owners.length > 0 && owners.every((owner) => processMatchesRoot(owner, worktreeRoot));

  console.error(`[web] el puerto ${port} ya está en uso:`);
  for (const owner of owners) {
    console.error(`      PID ${owner.pid}  ${shortCommand(owner.cmd) || '(sin línea de comandos)'}`);
  }

  if (sameWorktree && process.env.WEB_DEV_NO_AUTOSTOP !== '1') {
    console.error('      es de este mismo worktree: lo cierro para no compartir apps/web/.next');
    for (const owner of owners) killTree(owner.pid);
    if (await waitForPortFree(port, 6000)) {
      console.error(`      puerto ${port} liberado; continúo`);
    } else {
      console.error(`      no se pudo liberar el puerto ${port}; revisa con \`pnpm stop ${port}\``);
      process.exit(1);
    }
  } else {
    console.error(`      Ciérralo con \`pnpm stop ${port}\` o con Ctrl+C en la otra terminal.`);
    console.error('      (dos instancias comparten apps/web/.next y lo corrompen)');
    process.exit(1);
  }
}

let nextBin;
try {
  nextBin = createRequire(path.join(webRoot, 'package.json')).resolve('next/dist/bin/next');
} catch {
  console.error('[web] no se encontró Next; ejecuta `pnpm install` en la raíz del repo.');
  process.exit(1);
}

console.log(`[web] next dev en el puerto ${port} (WEB_PORT en apps/web/.env.local)`);

const child = spawn(process.execPath, [nextBin, 'dev', '-p', port], {
  cwd: webRoot,
  stdio: 'inherit',
  env: { ...process.env, PORT: port },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code) => process.exit(code ?? 0));
