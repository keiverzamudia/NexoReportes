#!/usr/bin/env node
// Detiene los servidores de desarrollo de ESTA carpeta.
//
// Uso:
//   pnpm stop                 apaga web y api segun apps/web/.env.local y apps/api/.env
//   pnpm stop 4130 4030       apaga los puertos indicados (solo ese arbol)
//   pnpm stop:all             ademas cierra el relay de Browser Control (19989)
//   pnpm stop:list            muestra que cerraria, sin detener nada (--dry-run)
//
// No inventa puertos: si no hay .env, avisa y no toca nada. Asi cada worktree
// (Reportes, Reportes-pruebas, Reportes-nuevo) apaga lo suyo y nunca se
// versiona un puerto local.
//
// Diferencia clave frente a la version anterior:
//   - En modo normal sube por el arbol de procesos hasta el `pnpm dev`/turbo que
//     los lanzo y mata esa raiz, de modo que no queden `next dev` huerfanos
//     ocupando el puerto.
//   - Tambien limpia procesos Next de este worktree que ya no escuchan.
//   - Tras matar, verifica que el puerto quedo libre y, si no, muestra el PID y
//     la linea de comandos que lo sigue ocupando.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  devStackRoot,
  killTree,
  listeningPids,
  listProcesses,
  processMatchesRoot,
  shortCommand,
  waitForPortsFree,
} from './dev-ports.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const withRelay = args.includes('--all') || args.includes('--relay');
const dryRun = args.includes('--dry-run') || args.includes('--list') || args.includes('-n');
const explicitPorts = args.filter((arg) => /^\d+$/.test(arg)).map(Number);

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

/** Procesos Next de este worktree que no necesariamente estan escuchando. */
function isOrphanCandidate(proc) {
  // Solo Node: evita marcar shells/editores cuyo texto de comando menciona la ruta.
  if (proc.name && !/^node(\.exe)?$/i.test(proc.name)) return false;
  if (!processMatchesRoot(proc, root)) return false;
  const cmd = proc.cmd ?? '';
  return (
    /next[\\/]dist[\\/]server[\\/]lib[\\/]start-server\.js/i.test(cmd) ||
    /next[\\/]dist[\\/]bin[\\/]next(?:\.js)?["']?\s+dev\b/i.test(cmd)
  );
}

async function main() {
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
      process.exitCode = 1;
      return;
    }
    if (withRelay) {
      targets.push({ port: Number(process.env.BROWSER_CONTROL_PORT ?? 19989), label: 'relay' });
    }
  }

  // Con puertos explicitos solo se toca el arbol de quien escucha; en modo normal
  // se sube hasta el `pnpm dev`/turbo para no dejar huerfanos.
  const stackMode = explicitPorts.length === 0;
  const processes = listProcesses();
  const byPid = new Map(processes.map((proc) => [proc.pid, proc]));

  // ---------- Plan: raiz del arbol -> puertos ----------

  /** @type {Map<number, { pid: number, ports: Set<number>, labels: Set<string> }>} */
  const planned = new Map();

  const plan = (rootPid) => {
    let entry = planned.get(rootPid);
    if (!entry) {
      entry = { pid: rootPid, ports: new Set(), labels: new Set() };
      planned.set(rootPid, entry);
    }
    return entry;
  };

  for (const { port, label } of targets) {
    const pids = listeningPids(port);
    if (pids.length === 0) {
      console.log(`  ${label.padEnd(8)} :${String(port).padEnd(6)} ya estaba libre`);
      continue;
    }
    for (const pid of pids) {
      const targetPid = stackMode ? devStackRoot(pid, byPid) : pid;
      const entry = plan(targetPid);
      entry.ports.add(port);
      entry.labels.add(label);
    }
  }

  // Huerfanos: `next dev` de este worktree cuyo servidor ya no escucha.
  if (stackMode) {
    for (const proc of processes) {
      if (!isOrphanCandidate(proc)) continue;
      const rootPid = devStackRoot(proc.pid, byPid);
      if (planned.has(rootPid)) continue;
      plan(rootPid).labels.add('huerfano');
    }
  }

  // ---------- Apagar ----------

  if (planned.size === 0) {
    console.log('\nNada que detener.');
    return;
  }

  let killed = 0;
  for (const entry of planned.values()) {
    const info = byPid.get(entry.pid);
    const portsText = entry.ports.size ? [...entry.ports].map((port) => `:${port}`).join(', ') : 'sin puerto';
    const label = entry.labels.size > 1 ? 'stack' : [...entry.labels][0] ?? 'proceso';
    const detail = shortCommand(info?.cmd);

    if (dryRun) {
      console.log(`  ${label.padEnd(8)} ${portsText.padEnd(14)} mataria el arbol PID ${entry.pid}${detail ? ` — ${detail}` : ''}`);
      continue;
    }

    if (killTree(entry.pid)) {
      killed += 1;
      console.log(`  ${label.padEnd(8)} ${portsText.padEnd(14)} detenido (arbol PID ${entry.pid})${detail ? ` — ${detail}` : ''}`);
    } else {
      console.log(`  ${label.padEnd(8)} ${portsText.padEnd(14)} no se pudo detener el arbol PID ${entry.pid}`);
    }
  }

  if (dryRun) {
    console.log('\n(dry-run: no se detuvo nada)');
    return;
  }

  // ---------- Verificacion ----------

  const leftover = await waitForPortsFree(targets.map((target) => target.port), 4000);
  console.log('');
  if (leftover.length === 0) {
    console.log(killed > 0 ? `${killed} arbol(es) de proceso detenido(s).` : 'Nada que detener.');
    return;
  }

  const remaining = listProcesses();
  const byRemainingPid = new Map(remaining.map((proc) => [proc.pid, proc]));
  for (const port of leftover) {
    const pids = listeningPids(port);
    console.error(`  ! :${port} sigue ocupado${pids.length ? ` (PID ${pids.join(', ')})` : ''}`);
    for (const pid of pids) {
      const cmd = shortCommand(byRemainingPid.get(pid)?.cmd);
      if (cmd) console.error(`      PID ${pid}  ${cmd}`);
    }
  }
  console.error('');
  console.error('Revisa el proceso manualmente o ejecuta la terminal como administrador.');
  process.exitCode = 1;
}

await main();
