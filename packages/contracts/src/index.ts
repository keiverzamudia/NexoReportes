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

export const SYNC_DOMAINS = ['PRODUCTOS', 'CLIENTES', 'PEDIDOS', 'PEDIDOS_DETALLE', 'EXISTENCIAS', 'ALMACENES'] as const;
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

// Resultado de una sincronización completa (todos los dominios en orden de dependencia).
export const zSyncRunAll = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  domains: z.array(zSyncRun),
  totalRead: z.number().int(),
  totalUpserted: z.number().int(),
  totalErrors: z.number().int(),
  failedDomains: z.array(z.string()),
});
export type SyncRunAll = z.infer<typeof zSyncRunAll>;

export const zSyncStatusResponse = z.object({
  dialect: z.enum(['mssql', 'fixtures']),
  connected: z.boolean(),
  lastSuccessfulRun: zSyncRun.nullable(),
  pendingDomains: z.array(zSyncDomain),
  message: z.string().nullable(),
});
export type SyncStatusResponse = z.infer<typeof zSyncStatusResponse>;

// ---------- Catálogo, inventario y disponibilidad (Fase 3) ----------
export const zProduct = z.object({
  id: z.string(),
  externalCode: z.string(),
  description: z.string(),
  uom: z.string(),
  family: z.string().nullable(),
  // kg por unidad de venta (relacion_empaque de Profit); null si no está disponible.
  kgPerUom: z.number().nullable(),
  isActive: z.boolean(),
  lastSyncedAt: z.string(),
});
export type Product = z.infer<typeof zProduct>;

export const zProductQuery = zPaginationQuery.extend({
  // Búsqueda por código o descripción.
  q: z.string().trim().max(100).optional(),
  // Por defecto sólo activos; con includeInactive=true se incluyen bajas lógicas.
  // (z.coerce.boolean() convertiría el string 'false' a true; se valida explícito.)
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type ProductQuery = z.infer<typeof zProductQuery>;

export const zInventoryByWarehouse = z.object({
  warehouseCode: z.string(),
  warehouseName: z.string().nullable(),
  qty: z.number(),
  reservedQty: z.number(),
});
export type InventoryByWarehouse = z.infer<typeof zInventoryByWarehouse>;

export const AVAILABILITY_STATUSES = ['SIN_DEMANDA', 'DISPONIBLE', 'PARCIAL', 'FALTANTE'] as const;
export const zAvailabilityStatus = z.enum(AVAILABILITY_STATUSES);
export type AvailabilityStatus = z.infer<typeof zAvailabilityStatus>;

export const zAvailabilityRow = z.object({
  productCode: z.string(),
  description: z.string(),
  uom: z.string(),
  kgPerUom: z.number().nullable(),
  // Existencia física combinada de los almacenes (última fotografía).
  stockTotal: z.number(),
  stockByWarehouse: z.array(zInventoryByWarehouse),
  // Demanda pendiente agregada (pedidos activos); puede ser negativa.
  demandQty: z.number(),
  demandKg: z.number().nullable(),
  // Disponibilidad neta = existencia − demanda (puede ser negativa).
  netQty: z.number(),
  // Lo que se puede despachar de la demanda con lo existente.
  availableQty: z.number(),
  // Lo que falta y debe producirse (0 si no falta).
  toProduceQty: z.number(),
  status: zAvailabilityStatus,
});
export type AvailabilityRow = z.infer<typeof zAvailabilityRow>;

export const zAvailabilityResponse = z.object({
  // Momento de la fotografía de inventario usada (null si nunca hubo sync).
  snapshotAt: z.string().nullable(),
  source: z.string().nullable(),
  rows: z.array(zAvailabilityRow),
});
export type AvailabilityResponse = z.infer<typeof zAvailabilityResponse>;

export const zProductDetail = z.object({
  product: zProduct,
  inventory: z.array(zInventoryByWarehouse),
  snapshotAt: z.string().nullable(),
  availability: zAvailabilityRow.nullable(),
});
export type ProductDetail = z.infer<typeof zProductDetail>;

export const zInventorySnapshotSummary = z.object({
  id: z.string(),
  takenAt: z.string(),
  source: z.string(),
  runId: z.string().nullable(),
  linesCount: z.number().int(),
});
export type InventorySnapshotSummary = z.infer<typeof zInventorySnapshotSummary>;

// ---------- Pedidos y clientes (Fase 4) ----------
export const zCustomer = z.object({
  id: z.string(),
  externalCode: z.string(),
  name: z.string(),
  // La vista actual de Profit no trae estos campos: quedan null (no inventados).
  customerType: z.string().nullable(),
  vendor: z.string().nullable(),
  isActive: z.boolean(),
  // Número de pedidos activos del cliente.
  ordersCount: z.number().int(),
});
export type Customer = z.infer<typeof zCustomer>;

export const zCustomerQuery = zPaginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type CustomerQuery = z.infer<typeof zCustomerQuery>;

export const ORDER_STATUSES = ['ABIERTO', 'CERRADO', 'CANCELADO', 'DESCONOCIDO'] as const;
export const zOrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof zOrderStatus>;

export const zOrderSummary = z.object({
  id: z.string(),
  externalNumber: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  // Vendedor y tipo de cliente: la vista actual de Profit NO los trae → null
  // (se muestran como "—", nunca inventados).
  vendor: z.string().nullable(),
  customerType: z.string().nullable(),
  orderDate: z.string().nullable(),
  requestedDate: z.string().nullable(),
  status: zOrderStatus,
  linesCount: z.number().int(),
  // Suma de pendientes del pedido (puede ser negativa por sobre-compromiso).
  totalPendingQty: z.number(),
});
export type OrderSummary = z.infer<typeof zOrderSummary>;

export const zOrderLine = z.object({
  lineNumber: z.number().int(),
  productCode: z.string(),
  description: z.string().nullable(),
  uom: z.string().nullable(),
  // Cantidad solicitada original: no está en la vista → null.
  quantity: z.number().nullable(),
  pendingQty: z.number(),
  pendingKg: z.number().nullable(),
  // Existencias del artículo por almacén (última fotografía de inventario).
  stock03: z.number().nullable(),
  stock68: z.number().nullable(),
});
export type OrderLine = z.infer<typeof zOrderLine>;

export const zOrderDetail = z.object({
  order: zOrderSummary,
  lines: z.array(zOrderLine),
});
export type OrderDetail = z.infer<typeof zOrderDetail>;

// Lista paginada de pedidos + resumen agregado de TODO el conjunto filtrado.
export const zOrderListResponse = z.object({
  items: z.array(zOrderSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  summary: z.object({
    totalPendingQty: z.number(),
    linesTotal: z.number().int(),
    openCount: z.number().int(),
  }),
});
export type OrderListResponse = z.infer<typeof zOrderListResponse>;

export const zOrderQuery = zPaginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  customerCode: z.string().trim().max(20).optional(),
  status: zOrderStatus.optional(),
  // Fecha de emisión (inclusive) en formato ISO 'yyyy-MM-dd'.
  emisionDesde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser yyyy-MM-dd')
    .optional(),
  emisionHasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser yyyy-MM-dd')
    .optional(),
  // Fecha de entrega comprometida (inclusive) en formato ISO 'yyyy-MM-dd'.
  entregaDesde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser yyyy-MM-dd')
    .optional(),
  entregaHasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser yyyy-MM-dd')
    .optional(),
});
export type OrderQuery = z.infer<typeof zOrderQuery>;

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
