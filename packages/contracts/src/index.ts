import { z } from 'zod';

// ============================================================
// Dominios compartidos — Nexo Producción
// Fuente única de verdad de los contratos API (request/response).
// Los motores de cálculo viven en apps/api; aquí solo los DTOs.
// ============================================================

// ---------- Roles y permisos ----------
export const ROLES = ['ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA'] as const;
export const zRole = z.enum(ROLES);
export type Role = z.infer<typeof zRole>;

// ---------- Paginación ----------
export const zPaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type PaginationQuery = z.infer<typeof zPaginationQuery>;

export function zPaginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

// ---------- Autenticación ----------
export const zLoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type LoginInput = z.infer<typeof zLoginInput>;

export const zUserSummary = z.object({
  id: z.string(),
  email: z.string().email(),
  fullName: z.string(),
  role: zRole,
  isActive: z.boolean(),
});
export type UserSummary = z.infer<typeof zUserSummary>;

export const zAuthResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: zUserSummary,
});
export type AuthResponse = z.infer<typeof zAuthResponse>;

// ---------- Sincronización con Profit ----------
export const SYNC_RUN_STATUSES = ['EN_CURSO', 'EXITOSA', 'PARCIAL', 'ERROR'] as const;
export const zSyncRunStatus = z.enum(SYNC_RUN_STATUSES);
export type SyncRunStatus = z.infer<typeof zSyncRunStatus>;

export const SYNC_DOMAINS = ['PRODUCTOS', 'CLIENTES', 'PEDIDOS', 'EXISTENCIAS', 'ALMACENES'] as const;
export const zSyncDomain = z.enum(SYNC_DOMAINS);
export type SyncDomain = z.infer<typeof zSyncDomain>;

export const zSyncRun = z.object({
  id: z.string(),
  domain: zSyncDomain,
  status: zSyncRunStatus,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  recordsRead: z.number().int(),
  recordsUpserted: z.number().int(),
  errorsCount: z.number().int(),
  errorDetail: z.string().nullable(),
  sourceRef: z.string().nullable(),
});
export type SyncRun = z.infer<typeof zSyncRun>;

export const zSyncStatusResponse = z.object({
  dialect: z.enum(['mssql', 'fixtures']),
  connected: z.boolean(),
  lastSuccessfulRun: zSyncRun.nullable(),
  pendingDomains: z.array(zSyncDomain),
  message: z.string().nullable(),
});
export type SyncStatusResponse = z.infer<typeof zSyncStatusResponse>;

// ---------- Salud del sistema ----------
export const zHealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number(),
  database: z.enum(['up', 'down']),
  profit: z.enum(['connected', 'fixtures', 'unreachable', 'not_configured']),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof zHealthResponse>;

// ---------- Respuesta de error consistente ----------
export const zApiError = z.object({
  statusCode: z.number().int(),
  message: z.string(),
  details: z.unknown().optional(),
  correlationId: z.string().optional(),
});
export type ApiError = z.infer<typeof zApiError>;
