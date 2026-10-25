import { AsyncLocalStorage } from 'node:async_hooks';

// ============================================================
// Contexto de la petición (IP y dispositivo) para la bitácora.
//
// Se llena en `main.ts` con un middleware y lo consume `AuditService` sin
// obligar a cada servicio a arrastrar el `Request`: los `audit.record(...)`
// existentes quedan intactos y aun así guardan desde dónde se hizo el cambio.
// ============================================================

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestMeta>();

export function runWithRequestMeta(meta: RequestMeta, next: () => void): void {
  storage.run(meta, next);
}

export function currentRequestMeta(): RequestMeta {
  return storage.getStore() ?? { ip: null, userAgent: null };
}

/** IPv4 mapeada desde IPv6 (`::ffff:10.0.0.5`) → `10.0.0.5`. */
export function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const mapped = trimmed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return mapped ? mapped[1]! : trimmed;
}
