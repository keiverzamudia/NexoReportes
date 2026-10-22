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

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
