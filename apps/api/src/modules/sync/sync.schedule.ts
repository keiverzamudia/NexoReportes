import { SYNC_DOMAINS, SyncDomain } from '@nexo/contracts';

// ============================================================
// Configuración del reloj de sincronización (sin dependencias de Nest, para
// poder probarse como función pura).
//
// SYNC_SCHEDULE = "EXISTENCIAS=120,PEDIDOS=300,PRODUCTOS=21600"
//   · vacío → cada dominio solo se sincroniza a mano.
//   · dominios desconocidos o valores inválidos se ignoran.
//   · MIN_DOMAIN_SECONDS protege el SQL Server de Profit de un reloj abusivo.
// ============================================================

export const MIN_DOMAIN_SECONDS = 60;

export function parseSyncSchedule(raw: string | null | undefined): Map<SyncDomain, number> {
  const schedule = new Map<SyncDomain, number>();
  for (const chunk of (raw ?? '').split(',')) {
    const [rawDomain, rawSeconds] = chunk.split('=');
    const domain = (rawDomain ?? '').trim().toUpperCase() as SyncDomain;
    const seconds = Number((rawSeconds ?? '').trim());
    if (!domain || !Number.isFinite(seconds) || seconds <= 0) continue;
    if (!(SYNC_DOMAINS as readonly string[]).includes(domain)) continue;
    schedule.set(domain, Math.max(MIN_DOMAIN_SECONDS, Math.floor(seconds)));
  }
  return schedule;
}

/** Intervalo configurado para un dominio (0 = solo manual). */
export function intervalFor(schedule: Map<SyncDomain, number>, domain: SyncDomain): number {
  return schedule.get(domain) ?? 0;
}
