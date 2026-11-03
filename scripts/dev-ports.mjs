/**
 * Utilidades compartidas para localizar y cerrar servidores de desarrollo.
 *
 * Las usan `scripts/stop-dev.mjs` (comando `pnpm stop`) y `apps/web/scripts/dev.mjs`
 * (preflight del puerto antes de arrancar Next).
 *
 * En Windows, `netstat -ano` identifica a los PID que escuchan y `wmic` aporta la
 * línea de comandos y el árbol de procesos (`Get-CimInstance` queda como respaldo:
 * en esta máquina tarda ~35 s). Si ninguno de los dos está disponible, las funciones
 * de proceso devuelven listas vacías y los scripts siguen funcionando solo con el puerto.
 */
import { execFileSync } from 'node:child_process';
import net from 'node:net';

export const isWindows = process.platform === 'win32';

/** Shells y editores: nunca se matan al subir por el árbol de procesos. */
const PROTECTED = new Set([
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'windowsterminal',
  'windowsterminal.exe',
  'wt',
  'wt.exe',
  'conhost',
  'conhost.exe',
  'explorer',
  'explorer.exe',
  'code',
  'code.exe',
  'bash',
  'bash.exe',
  'zsh',
  'sh',
  'wsl',
  'wsl.exe',
  'csrss.exe',
  'services.exe',
  'wininit.exe',
  'svchost.exe',
]);

/**
 * Nombres de proceso que pueden formar parte de la cadena de desarrollo.
 * Deliberadamente estrecho: evita subir hasta el editor/terminal del usuario
 * (opencode, VS Code, browser-control, etc.).
 */
const DEV_PROCESS_NAMES =
  /^(node|node\.exe|cmd|cmd\.exe|turbo|turbo\.exe|pnpm|pnpm\.exe|pnpm\.cmd|npm|npm\.exe|npm\.cmd|npx|npx\.cmd)$/i;

/** Líneas de comandos de la cadena de desarrollo (turbo/pnpm/next/nest). */
const DEV_COMMAND = new RegExp(
  [
    'scripts[\\\\/]dev\\.mjs',
    'next[\\\\/]dist[\\\\/](bin[\\\\/]next|server[\\\\/]lib[\\\\/]start-server)',
    'next\\s+dev',
    '(^|[\\\\/\\s])turbo(\\.exe)?($|[\\s"])',
    '[\\\\/]dist[\\\\/]main\\.js',
    'nest\\s+(build|start)',
    'ensure-prisma-client',
    'concurrently',
    'pnpm(\\.mjs|\\.cmd)?["\\s]+(run\\s+)?dev\\b',
    '["\\s]run\\s+dev["\\s]',
  ].join('|'),
  'i',
);

/** Normaliza rutas para comparar (Windows ignora mayúsculas y separadores). */
export function normalizePath(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\\/g, '/');
}

/** Recorta una línea de comandos para mostrarla en consola. */
export function shortCommand(command, max = 110) {
  const text = String(command ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** PIDs que están escuchando en un puerto TCP. */
export function listeningPids(port) {
  if (isWindows) {
    let output;
    try {
      output = execFileSync('netstat', ['-ano'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
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

/**
 * Lista de procesos: `{ pid, ppid, name, cmd }`.
 * Devuelve [] si el sistema no permite consultarlos.
 *
 * En Windows se usa `wmic` (rápido) y se deja `Get-CimInstance` como respaldo:
 * en algunas máquinas WMI tarda decenas de segundos en enumerar procesos.
 */
export function listProcesses() {
  if (isWindows) {
    const viaWmic = listProcessesWmic();
    if (viaWmic) return viaWmic;
    return listProcessesCim();
  }
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (!match) return null;
        return { pid: Number(match[1]), ppid: Number(match[2]), name: '', cmd: match[3] };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Formato CSV: Node,CommandLine,Name,ParentProcessId,ProcessId (CommandLine puede llevar comas). */
function listProcessesWmic() {
  let output;
  try {
    output = execFileSync(
      'wmic',
      ['process', 'get', 'ProcessId,ParentProcessId,Name,CommandLine', '/format:csv'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20000, windowsHide: true },
    );
  } catch {
    return null;
  }
  const rows = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes(',')) continue;
    if (/^Node,CommandLine,Name,ParentProcessId,ProcessId$/i.test(line)) continue;
    const columns = line.split(',');
    if (columns.length < 5) continue;
    const pid = Number(columns.at(-1));
    const ppid = Number(columns.at(-2));
    const name = String(columns.at(-3) ?? '').trim();
    const cmd = columns.slice(1, -3).join(',');
    if (!Number.isInteger(pid) || pid < 0) continue;
    rows.push({ pid, ppid: Number(ppid) || 0, name, cmd });
  }
  return rows.length > 0 ? rows : null;
}

/** Respaldo lento (WMI sin `wmic`): en esta máquina puede tardar ~35 s. */
function listProcessesCim() {
  let output;
  try {
    output = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 90000, windowsHide: true },
    );
  } catch {
    return [];
  }
  const trimmed = output.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return [];
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const rows = Array.isArray(data) ? data : [data];
  return rows
    .map((row) => ({
      pid: Number(row.ProcessId),
      ppid: Number(row.ParentProcessId),
      name: String(row.Name ?? ''),
      cmd: String(row.CommandLine ?? ''),
    }))
    .filter((row) => Number.isInteger(row.pid) && row.pid > 0);
}

/** Procesos que tienen el puerto abierto, con su línea de comandos si se pudo leer. */
export function portOwners(port, processes = listProcesses()) {
  const byPid = new Map(processes.map((proc) => [proc.pid, proc]));
  return listeningPids(port).map((pid) => ({ pid, ...(byPid.get(pid) ?? { name: '', cmd: '' }) }));
}

/** ¿La línea de comandos del proceso menciona esta ruta (worktree)? */
export function processMatchesRoot(proc, root) {
  if (!proc?.cmd || !root) return false;
  return normalizePath(proc.cmd).includes(normalizePath(root));
}

/** ¿Es parte de la cadena de desarrollo (node/pnpm/turbo/cmd), no un shell del usuario? */
function isDevProcess(proc) {
  if (!proc) return false;
  const name = String(proc.name ?? '').toLowerCase();
  if (PROTECTED.has(name) || !DEV_PROCESS_NAMES.test(name)) return false;
  return DEV_COMMAND.test(proc.cmd ?? '');
}

/**
 * Sube por los padres mientras sigan siendo parte de la cadena de desarrollo y
 * devuelve el PID de la raíz. Matar esa raíz con todo su árbol evita que queden
 * huérfanos (`next dev` sin su `pnpm dev`, etc.).
 */
export function devStackRoot(pid, processes) {
  const byPid = processes instanceof Map ? processes : new Map(processes.map((proc) => [proc.pid, proc]));
  let current = byPid.get(pid) ?? { pid, ppid: 0, name: '', cmd: '' };
  const seen = new Set([current.pid]);
  while (true) {
    const parent = byPid.get(current.ppid);
    if (!parent || seen.has(parent.pid) || !isDevProcess(parent)) break;
    current = parent;
    seen.add(parent.pid);
  }
  return current.pid;
}

/** Mata un proceso y todos sus descendientes. */
export function killTree(pid) {
  if (isWindows) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
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

/** ¿Alguien acepta conexiones en el puerto? */
export function portInUse(port, timeout = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Espera a que un puerto quede libre. Devuelve true si lo logró. */
export async function waitForPortFree(port, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listeningPids(port).length === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return listeningPids(port).length === 0;
}

/** Espera a que varios puertos queden libres y devuelve los que siguen ocupados. */
export async function waitForPortsFree(ports, timeoutMs = 4000) {
  const pending = new Set(ports);
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0) {
    for (const port of [...pending]) {
      if (listeningPids(port).length === 0) pending.delete(port);
    }
    if (pending.size === 0 || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return [...pending];
}
