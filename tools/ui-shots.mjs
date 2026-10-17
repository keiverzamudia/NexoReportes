// ============================================================
// ui-shots — captura y AUDITA la interfaz en teléfono, tablet y escritorio.
//
// No necesita Playwright ni descargar navegadores: maneja por CDP el
// Chromium/Edge que ya está instalado (WebSocket y fetch nativos de Node 18+).
//
// Uso (con `pnpm start` corriendo):
//   node tools/ui-shots.mjs                       # todo, escritorio + teléfono
//   node tools/ui-shots.mjs --device phone        # solo el teléfono
//   node tools/ui-shots.mjs --only forca          # solo escenarios que contengan "forca"
//   node tools/ui-shots.mjs --full                # además, página completa
//
// Salida: PNGs + `manifest.json` con las mediciones de cada captura:
//   · overflowX     px de scroll horizontal de la PÁGINA (debe ser 0)
//   · smallTargets  controles visibles por debajo del mínimo táctil de 44px
//   · consoleErrors errores de consola/red durante la carga
// Esas tres cifras son las que deciden si una vista es usable en teléfono.
// ============================================================

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// ---------- argumentos ----------
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const APP = flag('app', 'http://localhost:4100');
const API = flag('api', 'http://localhost:4010');
const OUT = resolve(flag('out', 'artifacts/ui-shots'));
const ONLY = flag('only', '');
const ONLY_DEVICE = flag('device', '');
const FULL = has('full');
const MAX_FULL_HEIGHT = 6000;

// ---------- perfiles ----------
const DEVICES = {
  phone: { width: 390, height: 844, dpr: 3, mobile: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'phone-small': { width: 360, height: 740, dpr: 2, mobile: true, ua: 'Mozilla/5.0 (Linux; Android 12; SM-A032M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' },
  tablet: { width: 834, height: 1112, dpr: 2, mobile: true, ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false },
  'desktop-wide': { width: 1920, height: 1080, dpr: 1, mobile: false },
};

// ---------- escenarios (path + interacciones a capturar) ----------
const clickByText = (text, selector = '[role="tab"], button, summary, a') =>
  `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => (x.textContent || '').trim().toLowerCase().includes(${JSON.stringify(
    text.toLowerCase(),
  )})); if (!el) return false; el.click(); return true; })()`;

// Enfoca el contenido desplegado para que la captura lo muestre (el viewport
// solo ve la parte alta de una página larga).
const scrollToExpanded = `(() => {
  const nodes = [...document.querySelectorAll('tbody td[colspan], main ul > li > div')];
  const el = nodes.find((n) => n.getBoundingClientRect().height > 40);
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  return true;
})()`;

// Cambia un <select> controlado por React (setter nativo + evento change).
const setSelectByLabel = (label, value) => `(() => {
  const sel = [...document.querySelectorAll('select')].find((s) => (s.getAttribute('aria-label') || '').toLowerCase().includes(${JSON.stringify(
    label.toLowerCase(),
  )}));
  if (!sel) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, ${JSON.stringify(value)});
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const SCENARIOS = [
  { name: 'portada', path: '/', devices: ['desktop', 'phone'] },
  { name: 'disponibilidad', path: '/disponibilidad', devices: ['desktop', 'phone'] },
  {
    name: 'disponibilidad-filtros',
    path: '/disponibilidad',
    devices: ['phone'],
    steps: [{ tag: 'abrir-filtros', js: clickByText('Filtros') }],
  },
  { name: 'forca-asignador', path: '/forca', devices: ['desktop', 'phone'] },
  {
    name: 'forca-reporte',
    path: '/forca',
    devices: ['desktop', 'phone'],
    steps: [{ tag: 'tab-reporte', js: clickByText('Reporte') }],
  },
  {
    name: 'forca-asignador-vermas',
    path: '/forca',
    devices: ['phone'],
    steps: [{ tag: 'abrir-vermas', js: `(() => { const d = document.querySelector('details'); if (!d) return false; d.open = true; return true; })()` }],
  },
  { name: 'pedidos', path: '/pedidos', devices: ['desktop', 'phone'] },
  {
    name: 'pedidos-grupo',
    path: '/pedidos',
    devices: ['desktop', 'phone'],
    steps: [
      { tag: 'abrir-grupo', js: clickByText('Renglones') },
      { tag: 'ver', js: scrollToExpanded },
    ],
  },
  {
    name: 'pedidos-plan',
    path: '/pedidos',
    devices: ['desktop', 'phone'],
    steps: [
      { tag: 'marcar-grupo', js: clickByText('Marcar todo') },
      { tag: 'abrir-turnos', js: clickByText('Ver turnos') },
      { tag: 'ver', js: scrollToExpanded },
    ],
  },
  {
    name: 'pedidos-por-producto',
    path: '/pedidos',
    devices: ['desktop', 'phone'],
    steps: [
      { tag: 'agrupar-producto', js: setSelectByLabel('agrupar', 'producto') },
      { tag: 'marcar-grupo', js: clickByText('Marcar todo') },
      { tag: 'abrir-turnos', js: clickByText('Ver turnos') },
      { tag: 'ver', js: scrollToExpanded },
    ],
  },
  { name: 'clientes', path: '/clientes', devices: ['desktop', 'phone'] },
];

// ---------- navegador ----------
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const AUDIT = `(() => {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const interactive = 'button, a[href], input, select, textarea, summary, [role="tab"], [role="button"]';
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05 && r.width > 0 && r.height > 0;
  };
  const smallTargets = [...document.querySelectorAll(interactive)]
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        el: el.tagName.toLowerCase() + (el.getAttribute('aria-label') ? '[aria-label]' : ''),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 34),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    })
    .filter((t) => t.w < 44 || t.h < 44)
    .slice(0, 25);
  return {
    url: location.pathname,
    title: document.title,
    h1: (document.querySelector('h1')?.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
    viewport: { w: vw, h: window.innerHeight },
    pageHeight: doc.scrollHeight,
    overflowX: Math.max(0, doc.scrollWidth - vw),
    // Qué elementos se salen del ancho: apunta al culpable del scroll horizontal.
    overflowSources: (() => {
      if (doc.scrollWidth <= vw + 1) return [];
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.right <= vw + 1) continue;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        out.push({
          el: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : '',
          text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24),
          w: Math.round(r.width),
          right: Math.round(r.right),
        });
      }
      return out.sort((a, b) => b.right - a.right).slice(0, 6);
    })(),
    smallTargets,
    tables: document.querySelectorAll('table').length,
    cards: document.querySelectorAll('main ul > li').length,
    nav: { bottom: Boolean(document.querySelector('nav[aria-label="Módulos"].fixed')), top: document.querySelectorAll('header nav').length },
    // Diagnóstico del ancho de la barra inferior (clave en teléfono).
    bottomNav: (() => {
      const n = [...document.querySelectorAll('nav[aria-label="Módulos"]')].pop();
      if (!n) return null;
      const cs = getComputedStyle(n);
      return { position: cs.position, left: cs.left, right: cs.right, width: Math.round(n.getBoundingClientRect().width) };
    })(),
    bodyBox: { width: Math.round(document.body.getBoundingClientRect().width), transform: getComputedStyle(document.body).transform },
    metaViewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
  };
})()`;

// ---------- arranque ----------
const executable = BROWSERS.find((p) => existsSync(p));
if (!executable) {
  console.error('No se encontró un navegador Chromium (Edge/Chrome) instalado.');
  process.exit(1);
}

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: flag('email', 'admin@nexo.local'), password: flag('password', 'CambiarAdmin123!') }),
}).catch(() => null);
if (!login || !login.ok) {
  console.error(`No se pudo autenticar en ${API}/api/auth/login (¿está corriendo la API?).`);
  process.exit(1);
}
const auth = await login.json();
const session = JSON.stringify({ accessToken: auth.accessToken, refreshToken: auth.refreshToken });

const userDir = mkdtempSync(join(tmpdir(), 'ui-shots-'));
const proc = spawn(
  executable,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    '--remote-debugging-port=9223',
    `--user-data-dir=${userDir}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 80 && !target; i += 1) {
  await sleep(400);
  try {
    const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    /* todavía no levantó */
  }
}
if (!target) {
  proc.kill();
  console.error('El navegador no expuso el depurador remoto.');
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let seq = 0;
const pending = new Map();
let consoleErrors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: res, reject: rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    return;
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text.slice(0, 200));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push((msg.params.exceptionDetails?.exception?.description ?? 'excepción').slice(0, 200));
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const detail = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
    throw new Error(String(detail).split('\n').slice(0, 4).join(' | '));
  }
  return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

mkdirSync(OUT, { recursive: true });
const manifest = [];
let bootstrapped = false;

for (const scenario of SCENARIOS) {
  if (ONLY && !scenario.name.includes(ONLY)) continue;
  for (const deviceName of scenario.devices) {
    if (ONLY_DEVICE && deviceName !== ONLY_DEVICE) continue;
    const device = DEVICES[deviceName];

    await send('Emulation.setDeviceMetricsOverride', {
      width: device.width,
      height: device.height,
      deviceScaleFactor: device.dpr,
      mobile: device.mobile,
    });
    if (device.mobile) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
    if (device.ua) await send('Emulation.setUserAgentOverride', { userAgent: device.ua });

    consoleErrors = [];
    await send('Page.navigate', { url: `${APP}${scenario.path}` });
    for (let i = 0; i < 80; i += 1) {
      await sleep(200);
      if ((await evaluate('document.readyState')) === 'complete') break;
    }
    await sleep(2200);

    if (!bootstrapped) {
      await evaluate(`localStorage.setItem('nexo.session', ${JSON.stringify(session)})`);
      bootstrapped = true;
      await send('Page.navigate', { url: `${APP}${scenario.path}` });
      for (let i = 0; i < 80; i += 1) {
        await sleep(200);
        if ((await evaluate('document.readyState')) === 'complete') break;
      }
      await sleep(2200);
    }

    const stepResults = [];
    for (const step of scenario.steps ?? []) {
      try {
        stepResults.push({ tag: step.tag, applied: await evaluate(step.js) });
      } catch (err) {
        stepResults.push({ tag: step.tag, applied: false, error: err.message });
        console.log(`   ⚠ paso "${step.tag}" falló: ${err.message}`);
      }
      await sleep(1400);
    }

    const view = await evaluate(AUDIT);
    const suffix = `${scenario.name}${stepResults.length ? '-' + stepResults.map((s) => s.tag).join('-') : ''}.${deviceName}`;
    const viewportShot = join(OUT, `${suffix}.png`);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(viewportShot, Buffer.from(shot.data, 'base64'));

    let fullShot = null;
    if (FULL && !device.mobile) {
      const metrics = await send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize ?? metrics.contentSize;
      const height = Math.min(Math.round(size.height), MAX_FULL_HEIGHT);
      const image = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: Math.round(size.width), height, scale: 1 },
      });
      fullShot = join(OUT, `${suffix}.full.png`);
      writeFileSync(fullShot, Buffer.from(image.data, 'base64'));
    }

    manifest.push({ scenario: scenario.name, device: deviceName, steps: stepResults, files: { viewport: viewportShot, full: fullShot }, consoleErrors: [...consoleErrors], ...view });
    const warn = view.overflowX > 1 ? ` ⚠ overflowX=${view.overflowX}px` : '';
    const touch = view.smallTargets.length ? ` ⚠ ${view.smallTargets.length} controles <44px` : '';
    console.log(
      `${suffix.padEnd(38)} h1="${view.h1}" tablas=${view.tables} tarjetas=${view.cards} navInf=${view.nav.bottom ? 'sí' : 'no'}${warn}${touch}`,
    );
  }
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length} capturas en ${OUT}`);
console.log(`manifest: ${join(OUT, 'manifest.json')}`);

ws.close();
proc.kill();
process.exit(0);
