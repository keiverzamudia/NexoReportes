#!/usr/bin/env node
// Detiene los servidores de desarrollo de ESTA carpeta.
//
// Uso:
//   pnpm stop                 apaga web y api segun apps/web/.env.local y apps/api/.env
//   pnpm stop 4130 4030       apaga los puertos indicados
//   pnpm stop:all             ademas cierra el relay de Browser Control (19989)
//
// No inventa puertos: si no hay .env, avisa y no toca nada. Asi cada worktree
// (Reportes, Reportes-pruebas, Reportes-nuevo) apaga lo suyo y nunca se
// versiona un puerto local.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const withRelay = args.includes('--all') || args.includes('--relay');
const explicitPorts = args.filter((arg) => /^\d+$/.test(arg)).map(Number);
const isWindows = process.platform === 'win32';

/** Lee una clave de un .env sin cargar el archivo completo. */
function readEnv(relativePath, key) {
  const file = path.join(root, relativePath);
  if (!existsSync(file)) return null;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.startsWith(`${key}=`)) continue;
    return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') || null;
  }
  return null;
}

/** PIDs que escuchan en un puerto TCP. */
function listeningPids(port) {
  if (isWindows) {
    let output;
    try {
      output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    } catch {
      return [];
    }
    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      const columns = line.trim().split(/\s+/);
      const local = columns[1] ?? '';
      if (!local.endsWith(`:${port}`)) continue;
      const pid = Number(columns.at(-1));
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  }
  try {
    return execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

/** Mata el proceso y su arbol (pnpm -> node -> next/nest). */
function stop(pid) {
  if (isWindows) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

// ---------- Que apagar ----------

const targets = [];
if (explicitPorts.length > 0) {
  for (const port of explicitPorts) targets.push({ port, label: 'indicado' });
} else {
  const webPort = readEnv('apps/web/.env.local', 'WEB_PORT') ?? readEnv('apps/web/.env', 'WEB_PORT');
  const apiPort = readEnv('apps/api/.env', 'API_PORT');
  if (webPort) targets.push({ port: Number(webPort), label: 'web' });
  if (apiPort) targets.push({ port: Number(apiPort), label: 'api' });
  if (targets.length === 0) {
    console.error('No encontre WEB_PORT en apps/web/.env.local ni API_PORT en apps/api/.env.');
    console.error('Ejecuta `pnpm stop <puerto>...` con los puertos que quieras apagar.');
    process.exit(1);
  }
  if (withRelay) {
    targets.push({ port: Number(process.env.BROWSER_CONTROL_PORT ?? 19989), label: 'relay' });
  }
}

// ---------- Apagar ----------

let killed = 0;
for (const { port, label } of targets) {
  const pids = listeningPids(port);
  if (pids.length === 0) {
    console.log(`  ${label.padEnd(6)} :${port}  ya estaba libre`);
    continue;
  }
  for (const pid of pids) {
    const ok = stop(pid);
    if (ok) {
      killed += 1;
      console.log(`  ${label.padEnd(6)} :${port}  detenido (PID ${pid})`);
    } else {
      console.log(`  ${label.padEnd(6)} :${port}  no se pudo detener el PID ${pid}`);
    }
  }
}

console.log('');
console.log(killed > 0 ? `${killed} proceso(s) detenido(s).` : 'Nada que detener.');
