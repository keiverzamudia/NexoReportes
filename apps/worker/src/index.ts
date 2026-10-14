// ============================================================
// Worker Nexo Producción (Fase 1: esqueleto)
//
// Responsabilidades previstas (Fase 2+):
//  - Sincronización periódica desde Profit (vistas SQL de solo lectura).
//  - Agregaciones pesadas y generación de reportes en segundo plano.
//
// En la Fase 1 el worker solo informa su configuración y permanece en
// espera; la sincronización real se implementa en la Fase 2 (integración).
// ============================================================

const intervalSeconds = Number(process.env.SYNC_INTERVAL_SECONDS ?? 0);

console.log('[worker] Nexo Producción worker iniciado.');
console.log(`[worker] SYNC_INTERVAL_SECONDS=${intervalSeconds} (${intervalSeconds === 0 ? 'sincronización manual vía API' : 'automática'})`);
console.log('[worker] La sincronización con Profit se habilita en la Fase 2 (integración).');

if (intervalSeconds > 0) {
  const timer = setInterval(() => {
    console.log(`[worker] Tick de sincronización programada (${new Date().toISOString()}) — implementación pendiente en Fase 2.`);
  }, intervalSeconds * 1000);

  process.on('SIGINT', () => {
    clearInterval(timer);
    console.log('[worker] Detenido.');
    process.exit(0);
  });
} else {
  // Sin trabajo programado, el proceso se mantiene disponible para futuras colas.
  setInterval(() => {}, 1 << 30);
}
