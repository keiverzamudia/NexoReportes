import { z } from 'zod';

// ============================================================
// Dominios compartidos — Nexo Producción
// Fuente única de verdad de los contratos API (request/response).
// Los motores de cálculo viven en apps/api; aquí solo los DTOs.
// ============================================================

// ---------- Roles y permisos ----------
// Las 5 plantillas históricas. `baseRole` conserva la semántica fina de
// Despacho y sirve de punto de partida al crear un rol nuevo. Los roles
// efectivos viven en la tabla `Role` y pueden ser muchos más.
export const ROLES = ['ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA'] as const;
export const zRole = z.enum(ROLES);
export type Role = z.infer<typeof zRole>;

// Código de un rol dinámico (clave estable, en mayúsculas).
export const zRoleCode = z
  .string()
  .trim()
  .min(2, 'El código debe tener al menos 2 caracteres')
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Usa MAYÚSCULAS, números y guion bajo (ej. SUPERVISOR)');

export const PERMISSION_ACTIONS = ['read', 'create', 'update', 'delete'] as const;
export const zPermissionAction = z.enum(PERMISSION_ACTIONS);
export type PermissionAction = z.infer<typeof zPermissionAction>;

export interface ModuleActionDefinition {
  action: PermissionAction;
  /** Etiqueta contextual: en Pedidos «create» es guardar una simulación. */
  label: string;
}

export interface AppModuleDefinition {
  key: string;
  label: string;
  /** Ruta del menú; null = sin pantalla propia (solo API/botón global). */
  href: string | null;
  actions: ModuleActionDefinition[];
}

// Fuente única para la matriz de permisos (API y web). El orden es el del menú.
export const APP_MODULES: AppModuleDefinition[] = [
  {
    key: 'disponibilidad',
    label: 'Disponibilidad',
    href: '/disponibilidad',
    actions: [{ action: 'read', label: 'Ver' }],
  },
  {
    key: 'forecast',
    label: 'Forecast',
    href: '/forecast',
    actions: [
      { action: 'read', label: 'Ver' },
      { action: 'update', label: 'Editar semanas' },
    ],
  },
  {
    key: 'pedidos',
    label: 'Pedidos',
    href: '/pedidos',
    actions: [
      { action: 'read', label: 'Ver' },
      { action: 'create', label: 'Guardar simulación' },
      { action: 'update', label: 'Editar fechas' },
      { action: 'delete', label: 'Eliminar simulación' },
    ],
  },
  {
    key: 'clientes',
    label: 'Clientes',
    href: '/clientes',
    actions: [{ action: 'read', label: 'Ver' }],
  },
  {
    key: 'despacho',
    label: 'Despacho',
    href: '/despacho',
    actions: [
      { action: 'read', label: 'Ver' },
      { action: 'create', label: 'Publicar' },
      { action: 'update', label: 'Operar' },
      { action: 'delete', label: 'Anular' },
    ],
  },
  {
    key: 'llegadas',
    label: 'Llegadas PCP',
    href: '/llegadas',
    actions: [
      { action: 'read', label: 'Ver' },
      { action: 'create', label: 'Marcar llegada' },
      { action: 'update', label: 'Incidencias y cierre' },
      { action: 'delete', label: 'Corregir registros' },
    ],
  },
  {
    key: 'usuarios',
    label: 'Usuarios y roles',
    href: '/usuarios',
    actions: [
      { action: 'read', label: 'Ver' },
      { action: 'create', label: 'Crear roles' },
      { action: 'update', label: 'Gestionar usuarios y permisos' },
      { action: 'delete', label: 'Eliminar roles' },
    ],
  },
  {
    key: 'auditoria',
    label: 'Auditoría (API)',
    href: null,
    actions: [{ action: 'read', label: 'Ver' }],
  },
  {
    key: 'sincronizacion',
    label: 'Sincronización (botón global)',
    href: null,
    actions: [{ action: 'update', label: 'Ejecutar' }],
  },
];

export type AppModuleKey =
  | 'disponibilidad'
  | 'forecast'
  | 'pedidos'
  | 'clientes'
  | 'despacho'
  | 'llegadas'
  | 'usuarios'
  | 'auditoria'
  | 'sincronizacion';

export interface PermissionRef {
  module: AppModuleKey;
  action: PermissionAction;
}

/** Clave plana usada por el JWT/sesión y el frontend: «modulo:accion». */
export function permissionKey(module: string, action: string): string {
  return `${module}:${action}`;
}

/** Permisos iniciales (replican el comportamiento previo basado en @Roles). */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Array<[AppModuleKey, PermissionAction]>> = {
  ADMIN: APP_MODULES.flatMap((module) =>
    module.actions.map(({ action }) => [module.key as AppModuleKey, action] as [AppModuleKey, PermissionAction]),
  ),
  GERENCIA: [
    ['disponibilidad', 'read'],
    ['forecast', 'read'],
    ['forecast', 'update'],
    ['pedidos', 'read'],
    ['pedidos', 'create'],
    ['pedidos', 'update'],
    ['pedidos', 'delete'],
    ['clientes', 'read'],
    ['despacho', 'read'],
    ['despacho', 'create'],
    ['despacho', 'delete'],
    ['llegadas', 'read'],
    ['sincronizacion', 'update'],
  ],
  PLANIFICADOR: [
    ['disponibilidad', 'read'],
    ['forecast', 'read'],
    ['forecast', 'update'],
    ['pedidos', 'read'],
    ['pedidos', 'create'],
    ['pedidos', 'update'],
    ['pedidos', 'delete'],
    ['clientes', 'read'],
    ['despacho', 'read'],
    ['despacho', 'create'],
    ['despacho', 'delete'],
    ['llegadas', 'read'],
    ['llegadas', 'create'],
    ['llegadas', 'update'],
    ['sincronizacion', 'update'],
  ],
  ALMACEN: [
    ['disponibilidad', 'read'],
    ['forecast', 'read'],
    ['forecast', 'update'],
    ['pedidos', 'read'],
    ['pedidos', 'create'],
    ['pedidos', 'delete'],
    ['clientes', 'read'],
    ['despacho', 'read'],
    ['despacho', 'update'],
    ['llegadas', 'read'],
  ],
  CONSULTA: [
    ['disponibilidad', 'read'],
    ['forecast', 'read'],
    ['pedidos', 'read'],
    ['pedidos', 'create'],
    ['pedidos', 'delete'],
    ['clientes', 'read'],
  ],
};

// Matriz de permisos: cada entrada concede una acción sobre un módulo.
export const zPermissionEntry = z.object({
  module: z.string().trim().min(1).max(40),
  action: zPermissionAction,
});
export type PermissionEntry = z.infer<typeof zPermissionEntry>;

export const zRoleInput = z.object({
  code: zRoleCode,
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(80),
  description: z.string().trim().max(240).nullable().optional(),
  baseRole: zRole.default('CONSULTA'),
  permissions: z.array(zPermissionEntry).max(200).default([]),
});
export type RoleInput = z.infer<typeof zRoleInput>;

export const zRoleUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(240).nullable().optional(),
    baseRole: zRole.optional(),
    permissions: z.array(zPermissionEntry).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No hay cambios que guardar' });
export type RoleUpdateInput = z.infer<typeof zRoleUpdateInput>;

export const zUserPermissionOverride = z.object({
  module: z.string().trim().min(1).max(40),
  action: zPermissionAction,
  allowed: z.boolean(),
});
export type UserPermissionOverride = z.infer<typeof zUserPermissionOverride>;

export const zUserPermissionsInput = z.object({
  overrides: z.array(zUserPermissionOverride).max(200),
});
export type UserPermissionsInput = z.infer<typeof zUserPermissionsInput>;

// Respuestas compuestas (sin Zod en el cliente, solo tipos).
export interface RoleSummary {
  code: string;
  name: string;
  description: string | null;
  baseRole: Role;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

export interface UserPermissionsResponse {
  userId: string;
  role: string;
  roleName: string;
  baseRole: Role;
  rolePermissions: string[];
  overrides: UserPermissionOverride[];
  permissions: string[];
}

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
// El login es con un usuario de Profit: se elige de la lista sincronizada
// (`userId` local) y la contraseña se valida en Profit
// (MasterProfit.dbo.autenticar). Nunca hay contraseña local.
export const zLoginInput = z.object({
  userId: z.string().min(1),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof zLoginInput>;

export const zUserSummary = z.object({
  id: z.string(),
  profitCode: z.string(),
  displayName: z.string(),
  // Código del rol efectivo (puede ser un rol dinámico: COMPRAS, SUPERVISOR…).
  role: zRoleCode,
  isActive: z.boolean(),
  // Solo en /auth/me: nombre legible, plantilla y permisos efectivos.
  roleName: z.string().optional(),
  baseRole: zRole.optional(),
  permissions: z.array(z.string()).optional(),
});
export type UserSummary = z.infer<typeof zUserSummary>;

// Candidato del autocompletado del login (endpoint público): solo lo mínimo.
export const zLoginCandidate = z.object({
  id: z.string(),
  profitCode: z.string(),
  displayName: z.string(),
});
export type LoginCandidate = z.infer<typeof zLoginCandidate>;

// La sesión viaja en cookies HttpOnly: la respuesta solo informa quién entró.
export const zAuthResponse = z.object({
  user: zUserSummary,
});
export type AuthResponse = z.infer<typeof zAuthResponse>;

// Administración de usuarios: el usuario viene de Profit, aquí solo se
// administran su rol y si puede entrar.
export const zUpdateUserInput = z.object({
  // Se valida contra la tabla de roles en el servicio (roles dinámicos).
  role: zRoleCode.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof zUpdateUserInput>;

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
  // Frescura por dominio: qué tan viejo es cada dato y cada cuánto se refresca.
  domains: z.array(
    z.object({
      domain: zSyncDomain,
      lastRunAt: z.string().nullable(),
      status: zSyncRunStatus.nullable(),
      ageSeconds: z.number().int().nullable(),
      recordsRead: z.number().int(),
      // 0 = solo sincronización manual para ese dominio.
      intervalSeconds: z.number().int(),
    }),
  ),
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
  // Lo que falta producir expresado en KG (toProduceQty × kgPerUom);
  // null cuando el producto no tiene kg por unidad.
  toProduceKg: z.number().nullable(),
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

// ---------- Estado de cuenta del cliente (cartera) ----------
// Los documentos salen de Profit en vivo (`docum_cc`), no de la base local.
// El saldo viaja con signo: los adelantos y notas de crédito restan del total.
export const CUSTOMER_STATEMENT_CURRENCIES = ['USD', 'BS'] as const;
export const zCustomerStatementCurrency = z.enum(CUSTOMER_STATEMENT_CURRENCIES);
export type CustomerStatementCurrency = z.infer<typeof zCustomerStatementCurrency>;

export const zCustomerStatementQuery = z.object({
  // Mismo filtro que «Documentos pendientes» en Profit: si se omite, solo
  // saldo > 0; con true se incluyen los documentos ya saldados.
  incluirSaldados: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  moneda: zCustomerStatementCurrency.optional(),
});
export type CustomerStatementQuery = z.infer<typeof zCustomerStatementQuery>;

export const zCustomerStatementRow = z.object({
  tipoDoc: z.string(),
  nroDoc: z.number().int(),
  fechaEmision: z.string().nullable(),
  fechaVencimiento: z.string().nullable(),
  // Días transcurridos desde el vencimiento: > 0 vencido, 0 vence hoy,
  // < 0 aún no vence. `null` si el documento no tiene fecha de vencimiento.
  diasVencimiento: z.number().int().nullable(),
  // Con signo: negativo cuando el documento es un crédito (ADEL, N/CR, …).
  saldo: z.number().nullable(),
  montoNeto: z.number().nullable(),
  esCredito: z.boolean(),
});
export type CustomerStatementRow = z.infer<typeof zCustomerStatementRow>;

export const zCustomerStatementTotals = z.object({
  // Neto de los documentos listados (créditos restados).
  saldo: z.number(),
  // Solo documentos con saldo positivo y días vencidos > 0.
  saldoVencido: z.number(),
  // Valor absoluto de los créditos listados.
  credito: z.number(),
  documentos: z.number().int(),
  vencidos: z.number().int(),
  proximoVencimiento: z.string().nullable(),
});
export type CustomerStatementTotals = z.infer<typeof zCustomerStatementTotals>;

export const zCustomerStatementCustomer = z.object({
  code: z.string(),
  name: z.string(),
  customerType: z.string().nullable(),
  vendor: z.string().nullable(),
  // Límite de crédito del cliente (`dbo.clientes.mont_cre`). null = la fuente
  // no lo expone o el cliente no tiene límite configurado.
  limiteCredito: z.number().nullable(),
});
export type CustomerStatementCustomer = z.infer<typeof zCustomerStatementCustomer>;

export const zCustomerStatementSource = z.enum(['profit', 'fixtures']);
export type CustomerStatementSource = z.infer<typeof zCustomerStatementSource>;

export const zCustomerStatement = z.object({
  customer: zCustomerStatementCustomer,
  rows: z.array(zCustomerStatementRow),
  totals: zCustomerStatementTotals,
  asOf: z.string(),
  moneda: zCustomerStatementCurrency,
  incluyeSaldados: z.boolean(),
  // true si se alcanzó el tope de documentos y la lista viene recortada.
  truncated: z.boolean(),
  source: zCustomerStatementSource,
});
export type CustomerStatement = z.infer<typeof zCustomerStatement>;

// Resumen de cartera para varias cuentas (una fila por cliente). Lo usa la
// cartera de Pedidos para mostrar saldo y vencido sin abrir cada estado de
// cuenta. Misma fuente y mismas reglas de signo que `CustomerStatement`.
export const zCustomerStatementSummaryQuery = z.object({
  // Códigos separados por coma; el API los valida y deduplica.
  codes: z.string().trim().min(1).max(2500),
  moneda: zCustomerStatementCurrency.optional(),
});
export type CustomerStatementSummaryQuery = z.infer<typeof zCustomerStatementSummaryQuery>;

export const zCustomerStatementSummary = z.object({
  code: z.string(),
  name: z.string(),
  // Neto con signo: negativo = saldo a favor, positivo = deuda.
  saldo: z.number(),
  // Solo documentos con saldo positivo y días vencidos > 0.
  saldoVencido: z.number(),
  // Valor absoluto de los créditos listados.
  credito: z.number(),
  // `dbo.clientes.mont_cre`. null = sin dato en Profit.
  limiteCredito: z.number().nullable(),
  documentos: z.number().int(),
  vencidos: z.number().int(),
});
export type CustomerStatementSummary = z.infer<typeof zCustomerStatementSummary>;

export const zCustomerStatementSummaryResponse = z.object({
  items: z.array(zCustomerStatementSummary),
  asOf: z.string(),
  moneda: zCustomerStatementCurrency,
  source: zCustomerStatementSource,
});
export type CustomerStatementSummaryResponse = z.infer<typeof zCustomerStatementSummaryResponse>;

export const ORDER_STATUSES = ['ABIERTO', 'CERRADO', 'CANCELADO', 'DESCONOCIDO'] as const;
export const zOrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof zOrderStatus>;

export const zOrderSummary = z.object({
  id: z.string(),
  externalNumber: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  // Vendedor de la solicitud y tipo de cliente (del reporte ampliado de Profit).
  // Si no llegan, son null y se muestran como "—" (nunca inventados).
  vendor: z.string().nullable(),
  customerType: z.string().nullable(),
  // Autorizado (cotiz_c.status === '1'). null = sin dato.
  authorized: z.boolean().nullable(),
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
  // Cantidad solicitada original (reng_cac.total_art). null = sin dato.
  quantity: z.number().nullable(),
  pendingQty: z.number(),
  pendingKg: z.number().nullable(),
  // Fecha tentativa local (capa Nexo). null = usar requestedDate.
  tentativeDate: z.string().nullable(),
  // Almacén que surte el renglón (reng_cac.co_alma, p. ej. "6804").
  warehouseCode: z.string().nullable(),
  // Existencias del artículo por almacén (última fotografía de inventario).
  stock03: z.number().nullable(),
  stock9999: z.number().nullable(),
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
  // Filtros del reporte ampliado.
  customerType: z.string().trim().max(60).optional(),
  vendor: z.string().trim().max(100).optional(),
  authorized: z.enum(['SI', 'NO']).optional(),
  // Fecha de emisión (inclusive) en formato ISO 'yyyy-MM-dd'.
  emisionDesde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser yyyy-MM-dd')
    .optional(),
  emisionHasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser yyyy-MM-dd')
    .optional(),
  // Fecha de entrega (inclusive) en formato ISO 'yyyy-MM-dd'.
  // En /orders/grouped se compara contra la fecha efectiva:
  // tentativa local si existe, original de Profit si no.
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

// ---------- Pedidos agrupados (por cliente o por producto) ----------
export const ORDER_GROUP_BY = ['cliente', 'producto'] as const;
export const zOrderGroupBy = z.enum(ORDER_GROUP_BY);
export type OrderGroupBy = z.infer<typeof zOrderGroupBy>;

export const zOrderGroupQuery = zOrderQuery.omit({ page: true, pageSize: true }).extend({
  by: zOrderGroupBy.default('cliente'),
});
export type OrderGroupQuery = z.infer<typeof zOrderGroupQuery>;

export const zOrderGroupLine = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  requestedDate: z.string().nullable(),
  // Fecha tentativa local (capa Nexo). null = usar requestedDate.
  tentativeDate: z.string().nullable(),
  authorized: z.boolean().nullable(),
  productCode: z.string(),
  description: z.string().nullable(),
  uom: z.string().nullable(),
  quantity: z.number().nullable(),
  pendingQty: z.number(),
  pendingKg: z.number().nullable(),
  warehouseCode: z.string().nullable(),
  stock03: z.number().nullable(),
  stock9999: z.number().nullable(),
  stock68: z.number().nullable(),
});
export type OrderGroupLine = z.infer<typeof zOrderGroupLine>;

export const zOrderGroup = z.object({
  key: z.string(),
  code: z.string().nullable(),
  label: z.string(),
  ordersCount: z.number().int(),
  linesCount: z.number().int(),
  totalPendingQty: z.number(),
  totalPendingKg: z.number(),
  // Nº de productos distintos (agrupando por cliente) o de clientes distintos
  // (agrupando por producto).
  itemsCount: z.number().int(),
  lines: z.array(zOrderGroupLine),
});
export type OrderGroup = z.infer<typeof zOrderGroup>;

export const zOrderGroupedResponse = z.object({
  by: zOrderGroupBy,
  groups: z.array(zOrderGroup),
  totalPendingQty: z.number(),
  totalPendingKg: z.number(),
});
export type OrderGroupedResponse = z.infer<typeof zOrderGroupedResponse>;

// ---------- Fecha tentativa local (capa Nexo, nunca Profit) ----------
// Un renglón = pedido + artículo. La selección del plan envía varios ítems.
export const zDeliveryDateItem = z.object({
  orderNumber: z.string().trim().min(1).max(20),
  productCode: z.string().trim().min(1).max(40),
});
export type DeliveryDateItem = z.infer<typeof zDeliveryDateItem>;

export const zDeliveryDateSetInput = z.object({
  items: z.array(zDeliveryDateItem).min(1).max(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser yyyy-MM-dd'),
  note: z.string().trim().max(240).optional(),
});
export type DeliveryDateSetInput = z.infer<typeof zDeliveryDateSetInput>;

export const zDeliveryDateRestoreInput = z.object({
  items: z.array(zDeliveryDateItem).min(1).max(500),
  note: z.string().trim().max(240).optional(),
});
export type DeliveryDateRestoreInput = z.infer<typeof zDeliveryDateRestoreInput>;

export const zDeliveryDateApplyResponse = z.object({
  updated: z.number().int(),
  restored: z.number().int(),
  unchanged: z.number().int(),
});
export type DeliveryDateApplyResponse = z.infer<typeof zDeliveryDateApplyResponse>;

// ============================================================
// Simulador de despacho: escenarios guardados (Fase 6).
//
// La simulación vive en el navegador hasta que el usuario la guarda. Aquí
// viaja como RECETA (qué se marcó y con qué filtros/modo) + FOTO (totales y
// cantidades del momento). Nunca escribe en Profit.
// ============================================================
export const MAX_SCENARIOS = 25;
export const MAX_SCENARIO_LINES = 5000;

export const DISPATCH_MODES = ['disponible', 'total'] as const;
export const zDispatchMode = z.enum(DISPATCH_MODES);
export type DispatchMode = z.infer<typeof zDispatchMode>;

export const DISPATCH_SORTS = ['prioridad', 'cobertura'] as const;
export const zDispatchSort = z.enum(DISPATCH_SORTS);
export type DispatchSort = z.infer<typeof zDispatchSort>;

export const SCENARIO_KINDS = ['DRAFT', 'SAVED'] as const;
export const zScenarioKind = z.enum(SCENARIO_KINDS);
export type ScenarioKind = z.infer<typeof zScenarioKind>;

// Filtros de la cartera que forman parte de la receta. Sin ellos la
// repartición de stock cambia y el escenario no se reproduce.
const zScenarioDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser yyyy-MM-dd'), z.literal('')])
  .default('');

export const zScenarioFilters = z.object({
  q: z.string().trim().max(100).default(''),
  status: z.union([zOrderStatus, z.literal('')]).default(''),
  customerType: z.string().trim().max(60).default(''),
  vendor: z.string().trim().max(100).default(''),
  authorized: z.union([z.enum(['SI', 'NO']), z.literal('')]).default(''),
  customerCode: z.string().trim().max(20).default(''),
  emisionDesde: zScenarioDate,
  emisionHasta: zScenarioDate,
  entregaDesde: zScenarioDate,
  entregaHasta: zScenarioDate,
});
export type ScenarioFilters = z.infer<typeof zScenarioFilters>;

// Renglón identificado por pedido + artículo (misma convención que la fecha
// tentativa). Sobrevive a la sincronización y es legible en la base.
export const zScenarioLineRef = z.object({
  orderNumber: z.string().trim().min(1).max(40),
  productCode: z.string().trim().min(1).max(60),
});
export type ScenarioLineRef = z.infer<typeof zScenarioLineRef>;

export const zScenarioRecipe = z.object({
  by: zOrderGroupBy,
  mode: zDispatchMode,
  sort: zDispatchSort,
  filters: zScenarioFilters,
});
export type ScenarioRecipe = z.infer<typeof zScenarioRecipe>;

export const zScenarioTotals = z.object({
  lines: z.number().int().min(0),
  sacks: z.number(),
  pendingQty: z.number(),
  pendingKg: z.number(),
  assignedQty: z.number(),
  assignedKg: z.number(),
  missingQty: z.number(),
  missingKg: z.number(),
  // 0..1 (kg asignados / kg de la demanda simulada).
  coverage: z.number(),
});
export type ScenarioTotals = z.infer<typeof zScenarioTotals>;

// Foto por renglón: permite el diff «esto cambió» sin recalcular a ciegas.
export const zScenarioSnapshotLine = zScenarioLineRef.extend({
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  description: z.string().nullable(),
  uom: z.string().nullable(),
  pendingQty: z.number(),
  pendingKg: z.number().nullable(),
  assignedQty: z.number(),
  assignedKg: z.number(),
  missingQty: z.number(),
  missingKg: z.number(),
  stockTotal: z.number(),
  effectiveDate: z.string().nullable(),
  priority: z.number().int(),
});
export type ScenarioSnapshotLine = z.infer<typeof zScenarioSnapshotLine>;

export const zScenarioSnapshot = z.object({
  // ISO del momento en que se tomó la foto.
  takenAt: z.string(),
  // Renglones totales de la cartera (con los filtros de la receta).
  carteraLines: z.number().int().min(0).default(0),
  totals: zScenarioTotals,
  lines: z.array(zScenarioSnapshotLine).max(MAX_SCENARIO_LINES),
});
export type ScenarioSnapshot = z.infer<typeof zScenarioSnapshot>;

export const zScenarioPayload = z.object({
  recipe: zScenarioRecipe,
  selected: z.array(zScenarioLineRef).max(MAX_SCENARIO_LINES),
  // null en el borrador: siempre se recalcula en vivo.
  snapshot: zScenarioSnapshot.nullable(),
});
export type ScenarioPayload = z.infer<typeof zScenarioPayload>;

// Borrador: solo receta + renglones (sin foto) para no escribir de más.
export const zScenarioDraftInput = z.object({
  recipe: zScenarioRecipe,
  selected: z.array(zScenarioLineRef).max(MAX_SCENARIO_LINES),
});
export type ScenarioDraftInput = z.infer<typeof zScenarioDraftInput>;

export const zScenarioSaveInput = zScenarioDraftInput.extend({
  name: z.string().trim().min(1, 'Ponle un nombre').max(80),
  snapshot: zScenarioSnapshot,
});
export type ScenarioSaveInput = z.infer<typeof zScenarioSaveInput>;

export const zScenarioUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    payload: zScenarioPayload.optional(),
    // Versión leída por el cliente (versionado optimista).
    version: z.number().int().min(1).optional(),
  })
  .refine((value) => value.name !== undefined || value.payload !== undefined, {
    message: 'No hay cambios que guardar',
  });
export type ScenarioUpdateInput = z.infer<typeof zScenarioUpdateInput>;

export const zScenarioRestoreInput = z.object({
  restored: z.number().int().min(0).default(0),
  missing: z.number().int().min(0).default(0),
  // Diff calculado por el cliente antes de confirmar (opcional: un cliente
  // viejo sigue funcionando y el historial queda con ceros).
  pendingChanges: z.number().int().min(0).default(0),
  stockChanges: z.number().int().min(0).default(0),
  dateChanges: z.number().int().min(0).default(0),
  carteraBefore: z.number().int().min(0).default(0),
  carteraAfter: z.number().int().min(0).default(0),
  beforeKg: z.number().min(0).default(0),
  afterKg: z.number().min(0).default(0),
  beforeCoverage: z.number().min(0).max(1).default(0),
  afterCoverage: z.number().min(0).max(1).default(0),
});
export type ScenarioRestoreInput = z.infer<typeof zScenarioRestoreInput>;

// Una restauración del historial visible de un escenario.
export const zScenarioRestoreLog = z.object({
  id: z.string(),
  restoredAt: z.string(),
  restoredById: z.string().nullable(),
  restoredByName: z.string().nullable(),
  restored: z.number().int(),
  missing: z.number().int(),
  pendingChanges: z.number().int(),
  stockChanges: z.number().int(),
  dateChanges: z.number().int(),
  carteraBefore: z.number().int(),
  carteraAfter: z.number().int(),
  beforeKg: z.number(),
  afterKg: z.number(),
  beforeCoverage: z.number(),
  afterCoverage: z.number(),
});
export type ScenarioRestoreLog = z.infer<typeof zScenarioRestoreLog>;

export const zScenarioListItem = z.object({
  id: z.string(),
  name: z.string(),
  kind: zScenarioKind,
  lineCount: z.number().int(),
  sacks: z.number(),
  assignedKg: z.number(),
  missingKg: z.number(),
  // % entero (0-100) para pintar la tarjeta sin abrir el payload.
  coverage: z.number().int(),
  // true = hubo sync de pedidos/existencias después de guardar.
  stale: z.boolean(),
  version: z.number().int(),
  restoredAt: z.string().nullable(),
  // Cuántas veces se ha restaurado (historial visible en el modal).
  restoreCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScenarioListItem = z.infer<typeof zScenarioListItem>;

export const zScenarioDetail = zScenarioListItem.extend({
  payload: zScenarioPayload,
  // Últimas restauraciones, de la más reciente a la más antigua.
  restores: z.array(zScenarioRestoreLog),
});
export type ScenarioDetail = z.infer<typeof zScenarioDetail>;

export const zScenarioListResponse = z.object({
  draft: zScenarioListItem.nullable(),
  items: z.array(zScenarioListItem),
  limit: z.number().int(),
  dataVersion: z.string().nullable(),
});
export type ScenarioListResponse = z.infer<typeof zScenarioListResponse>;

export const zScenarioDraftResponse = z.object({
  scenario: zScenarioDetail.nullable(),
});
export type ScenarioDraftResponse = z.infer<typeof zScenarioDraftResponse>;

// ============================================================
// Despacho de almacén (Fase 6b): hoja de despacho + túnel de acuses.
//
// Un despacho nace de un escenario guardado del simulador y es la orden de
// trabajo que el almacén ejecuta. Cada transición deja sello temporal, evento
// en la bitácora y notificación al planificador: el «túnel» es de dos vías.
// Nunca escribe en Profit.
// ============================================================
export const DISPATCH_SHEET_STATUSES = [
  'ENVIADO',
  'RECIBIDO',
  'EN_PROCESO',
  'CON_NOVEDAD',
  'DESPACHADO',
  'CANCELADO',
] as const;
export const zDispatchSheetStatus = z.enum(DISPATCH_SHEET_STATUSES);
export type DispatchSheetStatus = z.infer<typeof zDispatchSheetStatus>;

export const DISPATCH_LINE_STATUSES = ['PENDIENTE', 'CARGADO', 'PARCIAL', 'FALTANTE', 'NOVEDAD'] as const;
export const zDispatchLineStatus = z.enum(DISPATCH_LINE_STATUSES);
export type DispatchLineStatus = z.infer<typeof zDispatchLineStatus>;

// Marcas que el almacén puede aplicar hoy: todo o nada. Los estados
// históricos (PARCIAL/FALTANTE/NOVEDAD) se conservan solo para lectura.
export const DISPATCH_LINE_MARKS = ['PENDIENTE', 'CARGADO'] as const;
export const zDispatchLineMark = z.enum(DISPATCH_LINE_MARKS);
export type DispatchLineMark = z.infer<typeof zDispatchLineMark>;

export const DISPATCH_ACK_EVENTS = ['RECIBIDO', 'EN_PROCESO'] as const;
export const zDispatchAckEvent = z.enum(DISPATCH_ACK_EVENTS);
export type DispatchAckEvent = z.infer<typeof zDispatchAckEvent>;

export const NOTIFICATION_TYPES = [
  'DESPACHO_ENVIADO',
  'DESPACHO_RECIBIDO',
  'DESPACHO_EN_PROCESO',
  'DESPACHO_CERRADO',
  'DESPACHO_NOVEDAD',
  'DESPACHO_CANCELADO',
  'MENSAJE',
  // PCP: clientes esperados por un despacho publicado y sus hitos en planta.
  'LLEGADA_ESPERADA',
  'LLEGADA_MARCADA',
  'LLEGADA_INCIDENCIA',
] as const;
export const zNotificationType = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof zNotificationType>;

export const zDispatchSheetLine = z.object({
  id: z.string(),
  position: z.number().int(),
  orderNumber: z.string(),
  productCode: z.string(),
  description: z.string().nullable(),
  uom: z.string().nullable(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  warehouseCode: z.string().nullable(),
  effectiveDate: z.string().nullable(),
  plannedQty: z.number(),
  plannedKg: z.number(),
  loadedQty: z.number().nullable(),
  loadedKg: z.number().nullable(),
  status: zDispatchLineStatus,
  note: z.string().nullable(),
  checkedAt: z.string().nullable(),
  checkedByName: z.string().nullable(),
});
export type DispatchSheetLine = z.infer<typeof zDispatchSheetLine>;

export const zDispatchSheetEvent = z.object({
  id: z.string(),
  // SYSTEM = transición de estado; MESSAGE = conversación entre las partes.
  kind: z.enum(['SYSTEM', 'MESSAGE']),
  type: z.string(),
  body: z.string().nullable(),
  authorId: z.string().nullable(),
  authorCode: z.string().nullable(),
  authorName: z.string().nullable(),
  createdAt: z.string(),
});
export type DispatchSheetEvent = z.infer<typeof zDispatchSheetEvent>;

// Resumen para la bandeja (sin renglones ni bitácora).
export const zDispatchSheetSummary = z.object({
  id: z.string(),
  number: z.string(),
  title: z.string(),
  status: zDispatchSheetStatus,
  instructions: z.string().nullable(),
  assignedToId: z.string().nullable(),
  assignedToName: z.string().nullable(),
  assignedRole: z.string(),
  claimedById: z.string().nullable(),
  claimedByName: z.string().nullable(),
  claimedAt: z.string().nullable(),
  createdById: z.string(),
  createdByName: z.string().nullable(),
  createdByCode: z.string().nullable(),
  sentAt: z.string(),
  receivedAt: z.string().nullable(),
  receivedByName: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedByName: z.string().nullable(),
  canceledAt: z.string().nullable(),
  canceledByName: z.string().nullable(),
  plannedLines: z.number().int(),
  plannedSacks: z.number(),
  plannedKg: z.number(),
  loadedSacks: z.number(),
  loadedKg: z.number(),
  differenceKg: z.number(),
  linesDone: z.number().int(),
  progress: z.number(),
  customers: z.array(z.string()),
  nextDeliveryDate: z.string().nullable(),
  updatedAt: z.string(),
  // Permisos resueltos para quien consulta (evita duplicar reglas en el web).
  canOperate: z.boolean(),
  canCancel: z.boolean(),
});
export type DispatchSheetSummary = z.infer<typeof zDispatchSheetSummary>;

export const zDispatchSheetDetail = zDispatchSheetSummary.extend({
  lines: z.array(zDispatchSheetLine),
  events: z.array(zDispatchSheetEvent),
});
export type DispatchSheetDetail = z.infer<typeof zDispatchSheetDetail>;

export const zDispatchSheetListResponse = z.object({
  items: z.array(zDispatchSheetSummary),
  total: z.number().int(),
  // Contadores del pulso para el hero, ya resueltos por el servidor.
  counters: z.object({
    pending: z.number().int(),
    inProgress: z.number().int(),
    doneToday: z.number().int(),
    kgPending: z.number(),
    kgDoneToday: z.number(),
  }),
});
export type DispatchSheetListResponse = z.infer<typeof zDispatchSheetListResponse>;

export const zDispatchAssignee = z.object({
  id: z.string(),
  code: z.string(),
  displayName: z.string(),
  // Código del rol efectivo (dinámico).
  role: zRoleCode,
});
export type DispatchAssignee = z.infer<typeof zDispatchAssignee>;

// Preparación del almacén para publicar: sin operadores activos no se publica
// (el aviso no tendría a quién llegar).
export const zDispatchAssigneesResponse = z.object({
  operators: z.array(zDispatchAssignee),
  hasWarehouseOperators: z.boolean(),
});
export type DispatchAssigneesResponse = z.infer<typeof zDispatchAssigneesResponse>;

export const zDispatchSheetQuery = z.object({
  // all = todo lo que puedo ver · assigned = lo mío por operar · created = lo que publiqué.
  scope: z.enum(['all', 'assigned', 'created']).default('all'),
  status: zDispatchSheetStatus.optional(),
  q: z.string().trim().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type DispatchSheetQuery = z.infer<typeof zDispatchSheetQuery>;

export const zDispatchSheetCreateInput = z.object({
  scenarioId: z.string().min(1, 'Elige un escenario guardado'),
  title: z.string().trim().min(1, 'Ponle un título').max(120),
  instructions: z.string().trim().max(500).optional(),
  // null/omitido = «todo almacén» (bandeja compartida).
  assignedToId: z.string().min(1).nullable().optional(),
});
export type DispatchSheetCreateInput = z.infer<typeof zDispatchSheetCreateInput>;

export const zDispatchAckInput = z.object({ event: zDispatchAckEvent });
export type DispatchAckInput = z.infer<typeof zDispatchAckInput>;

export const zDispatchLineInput = z.object({
  // CARGADO = completado (toma la cantidad planificada); PENDIENTE = deshacer.
  status: zDispatchLineMark,
});
export type DispatchLineInput = z.infer<typeof zDispatchLineInput>;

export const zDispatchCompleteInput = z.object({ note: z.string().trim().max(500).optional() });
export type DispatchCompleteInput = z.infer<typeof zDispatchCompleteInput>;

export const zDispatchCancelInput = z.object({ reason: z.string().trim().min(3, 'Indica el motivo').max(240) });
export type DispatchCancelInput = z.infer<typeof zDispatchCancelInput>;

export const zDispatchMessageInput = z.object({ body: z.string().trim().min(1).max(500) });
export type DispatchMessageInput = z.infer<typeof zDispatchMessageInput>;

// ============================================================
// Llegadas de clientes (PCP).
//
// Al publicar un despacho se crea, sin paso adicional, un registro por
// cliente del plan: quién viene, cuándo se espera y qué trae. En planta se
// marca la llegada (hora del servidor), se reportan incidencias y queda todo
// en una bitácora que no se borra. Corregir un registro ya cerrado exige el
// permiso «Corregir registros» y un motivo, y deja rastro del cambio.
// ============================================================
export const ARRIVAL_STATUSES = [
  'ESPERADO',
  'EN_PLANTA',
  'ATENDIDO',
  'AUSENTE',
  'CON_INCIDENCIA',
  'CANCELADO',
] as const;
export const zArrivalStatus = z.enum(ARRIVAL_STATUSES);
export type ArrivalStatus = z.infer<typeof zArrivalStatus>;

export const ARRIVAL_INCIDENT_KINDS = ['FALTANTE', 'DEMORA', 'DANO', 'DOCUMENTO', 'RECHAZO', 'OTRO'] as const;
export const zArrivalIncidentKind = z.enum(ARRIVAL_INCIDENT_KINDS);
export type ArrivalIncidentKind = z.infer<typeof zArrivalIncidentKind>;

export const ARRIVAL_INCIDENT_SEVERITIES = ['BAJA', 'MEDIA', 'ALTA'] as const;
export const zArrivalIncidentSeverity = z.enum(ARRIVAL_INCIDENT_SEVERITIES);
export type ArrivalIncidentSeverity = z.infer<typeof zArrivalIncidentSeverity>;

export const ARRIVAL_INCIDENT_STATUSES = ['ABIERTA', 'RESUELTA'] as const;
export const zArrivalIncidentStatus = z.enum(ARRIVAL_INCIDENT_STATUSES);
export type ArrivalIncidentStatus = z.infer<typeof zArrivalIncidentStatus>;

export const zArrivalIncident = z.object({
  id: z.string(),
  kind: zArrivalIncidentKind,
  severity: zArrivalIncidentSeverity,
  body: z.string(),
  status: zArrivalIncidentStatus,
  resolution: z.string().nullable(),
  reportedById: z.string().nullable(),
  reportedByName: z.string().nullable(),
  resolvedById: z.string().nullable(),
  resolvedByName: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ArrivalIncident = z.infer<typeof zArrivalIncident>;

export const zArrivalEvent = z.object({
  id: z.string(),
  kind: z.enum(['SYSTEM', 'MESSAGE']),
  type: z.string(),
  body: z.string().nullable(),
  authorId: z.string().nullable(),
  authorCode: z.string().nullable(),
  authorName: z.string().nullable(),
  createdAt: z.string(),
});
export type ArrivalEvent = z.infer<typeof zArrivalEvent>;

export const zArrivalSummary = z.object({
  id: z.string(),
  number: z.string(),
  // Desnormalizado: la bitácora debe sobrevivir a cambios del despacho.
  customerCode: z.string(),
  customerName: z.string(),
  expectedDate: z.string().nullable(),
  sheetId: z.string(),
  sheetNumber: z.string(),
  sheetTitle: z.string(),
  status: zArrivalStatus,
  arrivedAt: z.string().nullable(),
  arrivedById: z.string().nullable(),
  arrivedByCode: z.string().nullable(),
  arrivedByName: z.string().nullable(),
  closedAt: z.string().nullable(),
  note: z.string().nullable(),
  orderNumbers: z.array(z.string()),
  lineCount: z.number().int(),
  plannedSacks: z.number(),
  plannedKg: z.number(),
  incidentCount: z.number().int(),
  openIncidentCount: z.number().int(),
  updatedAt: z.string(),
  updatedByName: z.string().nullable(),
  // Permisos resueltos para quien consulta.
  canCheckIn: z.boolean(),
  canClose: z.boolean(),
  canReportIncident: z.boolean(),
  canEdit: z.boolean(),
});
export type ArrivalSummary = z.infer<typeof zArrivalSummary>;

export const zArrivalDetail = zArrivalSummary.extend({
  incidents: z.array(zArrivalIncident),
  events: z.array(zArrivalEvent),
});
export type ArrivalDetail = z.infer<typeof zArrivalDetail>;

export const zArrivalListResponse = z.object({
  items: z.array(zArrivalSummary),
  total: z.number().int(),
  counters: z.object({
    expected: z.number().int(),
    onSite: z.number().int(),
    attended: z.number().int(),
    withIncident: z.number().int(),
    missed: z.number().int(),
    kgExpected: z.number(),
  }),
});
export type ArrivalListResponse = z.infer<typeof zArrivalListResponse>;

export const zArrivalQuery = z.object({
  // yyyy-MM-dd de negocio; omitido = todas las fechas (histórico).
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: zArrivalStatus.optional(),
  q: z.string().trim().max(80).optional(),
  // Tope para el histórico (evita traer años de registros).
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ArrivalQuery = z.infer<typeof zArrivalQuery>;

export const zArrivalCheckInInput = z.object({
  note: z.string().trim().max(240).optional(),
  // Hora del cliente si la marcó el operador desde el formulario; por defecto
  // se usa la hora del servidor.
  at: z.string().datetime().optional(),
});
export type ArrivalCheckInInput = z.infer<typeof zArrivalCheckInInput>;

export const zArrivalCloseInput = z.object({
  status: z.enum(['ATENDIDO', 'AUSENTE']),
  note: z.string().trim().max(500).optional(),
});
export type ArrivalCloseInput = z.infer<typeof zArrivalCloseInput>;

// Corrección de un registro ya hecho (jefe de PCP / administrador).
export const zArrivalEditInput = z
  .object({
    arrivedAt: z.string().datetime().nullable().optional(),
    status: zArrivalStatus.optional(),
    expectedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    note: z.string().trim().max(500).nullable().optional(),
    reason: z.string().trim().min(3, 'Explica el motivo de la corrección').max(240),
  })
  .refine(
    (value) =>
      value.arrivedAt !== undefined || value.status !== undefined || value.expectedDate !== undefined || value.note !== undefined,
    { message: 'Indica qué quieres corregir' },
  );
export type ArrivalEditInput = z.infer<typeof zArrivalEditInput>;

export const zArrivalIncidentInput = z.object({
  kind: zArrivalIncidentKind,
  severity: zArrivalIncidentSeverity.default('MEDIA'),
  body: z.string().trim().min(3, 'Describe la incidencia').max(500),
});
export type ArrivalIncidentInput = z.infer<typeof zArrivalIncidentInput>;

export const zArrivalIncidentResolveInput = z.object({
  resolution: z.string().trim().min(3, 'Explica cómo se resolvió').max(500),
  severity: zArrivalIncidentSeverity.optional(),
});
export type ArrivalIncidentResolveInput = z.infer<typeof zArrivalIncidentResolveInput>;

export const zArrivalMessageInput = z.object({ body: z.string().trim().min(1).max(500) });
export type ArrivalMessageInput = z.infer<typeof zArrivalMessageInput>;

// ---------- Notificaciones (campana + acuses) ----------
export const zNotification = z.object({
  id: z.string(),
  type: zNotificationType,
  title: z.string(),
  body: z.string().nullable(),
  entityType: z.string(),
  entityId: z.string(),
  linkPath: z.string(),
  actorName: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof zNotification>;

export const zNotificationListResponse = z.object({
  items: z.array(zNotification),
  unread: z.number().int(),
});
export type NotificationListResponse = z.infer<typeof zNotificationListResponse>;

export const zNotificationReadInput = z
  .object({
    ids: z.array(z.string().min(1)).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((value) => value.all === true || (value.ids?.length ?? 0) > 0, {
    message: 'Indica ids o all=true',
  });
export type NotificationReadInput = z.infer<typeof zNotificationReadInput>;

export const zNotificationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export type NotificationQuery = z.infer<typeof zNotificationQuery>;

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

// ============================================================
// Forecast (pronóstico de producción).
//   - Forecast MENSUAL por artículo: se lee de Profit (`xart_fore.kg_mes`),
//     sin conversión. Solo lectura.
//   - Reparto en 4 semanas (bloques 1-7 / 8-14 / 15-21 / 22-fin), editable
//     en Nexo. Por defecto = forecast mensual / 4.
// ============================================================
export const FORECAST_WEEK_INDEXES = [1, 2, 3, 4] as const;

const zYear = z.coerce.number().int().min(2020).max(2100);
const zMonth = z.coerce.number().int().min(1).max(12);

export const zForecastQuery = z.object({ year: zYear, month: zMonth });
export type ForecastQuery = z.infer<typeof zForecastQuery>;

export const zForecastSetWeeks = z.object({
  year: zYear,
  month: zMonth,
  weeks: z
    .array(z.object({ weekIndex: z.number().int().min(1).max(4), qty: z.coerce.number().min(0) }))
    .min(1),
});
export type ForecastSetWeeks = z.infer<typeof zForecastSetWeeks>;

export const zForecastWeekRange = z.object({
  weekIndex: z.number().int(),
  label: z.string(),
  from: z.string(),
  to: z.string(),
});
export type ForecastWeekRange = z.infer<typeof zForecastWeekRange>;

export const zForecastWeekRow = z.object({
  weekIndex: z.number().int(),
  // Cantidad asignada a la semana (editable). Por defecto = mensual / 4.
  qty: z.number(),
});
export type ForecastWeekRow = z.infer<typeof zForecastWeekRow>;

export const zForecastRow = z.object({
  productCode: z.string(),
  description: z.string(),
  uom: z.string(),
  category: z.string().nullable(),
  kgPerUom: z.number().nullable(),
  stockTotal: z.number(),
  demandMonthQty: z.number(),
  demandMonthKg: z.number(),
  // Forecast mensual leído de Profit (`xart_fore.kg_mes`), sin conversión.
  monthlyQty: z.number(),
  // Promedio sugerido por semana = forecast mensual / 4 (valor por defecto de `weeks`).
  averageQty: z.number(),
  weeks: z.array(zForecastWeekRow),
  weeksTotalQty: z.number(),
});
export type ForecastRow = z.infer<typeof zForecastRow>;

export const zForecastResponse = z.object({
  year: z.number().int(),
  month: z.number().int(),
  weekRanges: z.array(zForecastWeekRange),
  rows: z.array(zForecastRow),
  // false = no se pudo leer `xart_fore`; la UI avisa y muestra 0.
  profitForecastAvailable: z.boolean(),
});
export type ForecastResponse = z.infer<typeof zForecastResponse>;

// Reporte/plan de producción semanal.
// Cada semana trae, además del forecast, los mismos campos de la tabla de
// Disponibilidad por Producto (existencia, disponible, a producir, neto,
// estado) calculados con el motor de disponibilidad sobre la demanda OBJETIVO
// = max(forecast de la semana, demanda de la semana).
export const zForecastPlanWeek = z.object({
  weekIndex: z.number().int(),
  // Forecast asignado a esa semana (cantidad editable en el Asignador).
  forecastQty: z.number(),
  // Demanda real de pedidos activos cuya entrega cae en esa semana.
  demandQty: z.number(),
  demandKg: z.number(),
  // Objetivo de la semana = max(forecast, demanda). Es la "demanda" que usa el
  // motor de disponibilidad.
  objectiveQty: z.number(),
  // Campos de disponibilidad por producto (misma semántica que /availability).
  availableQty: z.number(),
  toProduceQty: z.number(),
  toProduceKg: z.number().nullable(),
  netQty: z.number(),
  status: zAvailabilityStatus,
});
export type ForecastPlanWeek = z.infer<typeof zForecastPlanWeek>;

export const zForecastPlanRow = z.object({
  productCode: z.string(),
  description: z.string(),
  uom: z.string(),
  category: z.string().nullable(),
  kgPerUom: z.number().nullable(),
  // Existencia global y desglose por almacén (Stock 03 / Stock 9999 / Stock 68).
  stockTotal: z.number(),
  stock03: z.number(),
  stock9999: z.number(),
  stock68: z.number(),
  forecastMonthQty: z.number(),
  averageQty: z.number(),
  demandMonthQty: z.number(),
  productionMonthQty: z.number(),
  productionMonthKg: z.number(),
  weeks: z.array(zForecastPlanWeek),
});
export type ForecastPlanRow = z.infer<typeof zForecastPlanRow>;

export const zForecastPlanResponse = z.object({
  year: z.number().int(),
  month: z.number().int(),
  weekRanges: z.array(zForecastWeekRange),
  rows: z.array(zForecastPlanRow),
  totals: z.object({
    forecastQty: z.number(),
    demandQty: z.number(),
    productionQty: z.number(),
    productionKg: z.number(),
  }),
});
export type ForecastPlanResponse = z.infer<typeof zForecastPlanResponse>;

// ============================================================
// Bitácora de auditoría (Usuarios → Bitácoras)
//
// Fuente principal: `AuditEvent`. Se complementa con las notas/mensajes de
// las bitácoras operativas (despacho y llegadas), que no tienen acción de
// auditoría propia. El catálogo de acciones traduce el código técnico a una
// etiqueta en español, un módulo y una severidad, para que el panel no
// dependa de strings sueltos.
// ============================================================
export const AUDIT_SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;
export const zAuditSeverity = z.enum(AUDIT_SEVERITIES);
export type AuditSeverity = z.infer<typeof zAuditSeverity>;

export const AUDIT_MODULES = [
  { key: 'auth', label: 'Sesiones' },
  { key: 'users', label: 'Usuarios' },
  { key: 'roles', label: 'Roles y permisos' },
  { key: 'dispatch', label: 'Despacho' },
  { key: 'arrivals', label: 'Llegadas PCP' },
  { key: 'sync', label: 'Sincronización' },
  { key: 'scenarios', label: 'Simulador' },
  { key: 'forecast', label: 'Forecast' },
  { key: 'orders', label: 'Pedidos' },
  { key: 'system', label: 'Sistema' },
] as const;

export type AuditModuleKey = (typeof AUDIT_MODULES)[number]['key'];

export interface AuditActionDefinition {
  module: AuditModuleKey;
  label: string;
  severity: AuditSeverity;
}

export const AUDIT_ACTIONS: Record<string, AuditActionDefinition> = {
  LOGIN_OK: { module: 'auth', label: 'Inició sesión', severity: 'INFO' },
  LOGIN_FAILED: { module: 'auth', label: 'Intento de acceso fallido', severity: 'WARN' },
  LOGOUT: { module: 'auth', label: 'Cerró sesión', severity: 'INFO' },
  USER_UPDATED: { module: 'users', label: 'Actualizó un usuario', severity: 'INFO' },
  USER_PERMISSIONS_UPDATED: { module: 'users', label: 'Cambió permisos de un usuario', severity: 'WARN' },
  USER_PERMISSIONS_RESET: { module: 'users', label: 'Restableció permisos de un usuario', severity: 'WARN' },
  PROFIT_USERS_SYNCED: { module: 'users', label: 'Sincronizó usuarios de Profit', severity: 'INFO' },
  PROFIT_USERS_SYNC_FAILED: { module: 'users', label: 'Falló la sincronización de usuarios', severity: 'CRITICAL' },
  ROLE_CREATED: { module: 'roles', label: 'Creó un rol', severity: 'WARN' },
  ROLE_UPDATED: { module: 'roles', label: 'Editó un rol o su matriz', severity: 'WARN' },
  ROLE_DELETED: { module: 'roles', label: 'Eliminó un rol', severity: 'CRITICAL' },
  DISPATCH_SEND: { module: 'dispatch', label: 'Publicó un despacho', severity: 'INFO' },
  DISPATCH_ACK: { module: 'dispatch', label: 'Acusó un despacho', severity: 'INFO' },
  DISPATCH_LINE: { module: 'dispatch', label: 'Actualizó la carga de un renglón', severity: 'INFO' },
  DISPATCH_COMPLETE: { module: 'dispatch', label: 'Cerró un despacho', severity: 'INFO' },
  DISPATCH_CANCEL: { module: 'dispatch', label: 'Anuló un despacho', severity: 'WARN' },
  ARRIVAL_CHECK_IN: { module: 'arrivals', label: 'Marcó la llegada de un cliente', severity: 'INFO' },
  ARRIVAL_CLOSE: { module: 'arrivals', label: 'Cerró la atención de un cliente', severity: 'INFO' },
  ARRIVAL_EDIT: { module: 'arrivals', label: 'Corrigió un registro de llegada', severity: 'WARN' },
  ARRIVAL_INCIDENT: { module: 'arrivals', label: 'Registró una incidencia', severity: 'WARN' },
  ARRIVAL_INCIDENT_RESOLVE: { module: 'arrivals', label: 'Resolvió una incidencia', severity: 'INFO' },
  SYNC_RUN: { module: 'sync', label: 'Ejecutó una sincronización', severity: 'INFO' },
  SYNC_TEST_CONNECTION: { module: 'sync', label: 'Probó la conexión con Profit', severity: 'INFO' },
  SCENARIO_SAVE: { module: 'scenarios', label: 'Guardó una simulación', severity: 'INFO' },
  SCENARIO_UPDATE: { module: 'scenarios', label: 'Renombró una simulación', severity: 'INFO' },
  SCENARIO_DELETE: { module: 'scenarios', label: 'Eliminó una simulación', severity: 'WARN' },
  SCENARIO_RESTORE: { module: 'scenarios', label: 'Restauró una simulación', severity: 'INFO' },
  FORECAST_SET_WEEKS: { module: 'forecast', label: 'Editó semanas del forecast', severity: 'INFO' },
  DELIVERY_DATE_SET: { module: 'orders', label: 'Asignó fecha tentativa a pedidos', severity: 'INFO' },
  DELIVERY_DATE_RESTORE: { module: 'orders', label: 'Restauró la fecha tentativa', severity: 'INFO' },
};

const ACTION_PREFIX_MODULE: Array<[string, AuditModuleKey]> = [
  ['PROFIT_USERS', 'users'],
  ['LOGIN', 'auth'],
  ['LOGOUT', 'auth'],
  ['USER', 'users'],
  ['ROLE', 'roles'],
  ['DISPATCH', 'dispatch'],
  ['ARRIVAL', 'arrivals'],
  ['SYNC', 'sync'],
  ['SCENARIO', 'scenarios'],
  ['FORECAST', 'forecast'],
  ['DELIVERY', 'orders'],
  ['ORDER', 'orders'],
];

/** Etiqueta, módulo y severidad de una acción; tolera acciones nuevas. */
export function auditMeta(action: string): AuditActionDefinition {
  const known = AUDIT_ACTIONS[action];
  if (known) return known;
  const found = ACTION_PREFIX_MODULE.find(([prefix]) => action.startsWith(prefix));
  const module = found ? found[1] : 'system';
  const readable = action.replaceAll('_', ' ').toLowerCase();
  const label = readable.charAt(0).toUpperCase() + readable.slice(1);
  const severity: AuditSeverity = /FAIL|ERROR|DELETE|CANCEL|RESET/.test(action) ? 'WARN' : 'INFO';
  return { module, label, severity };
}

export function auditModuleLabel(moduleKey: string): string {
  return AUDIT_MODULES.find((entry) => entry.key === moduleKey)?.label ?? 'Sistema';
}

export const zAuditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(30),
  // Fechas de negocio (yyyy-MM-dd). `to` es inclusivo.
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  module: z.string().trim().max(40).optional(),
  action: z.string().trim().max(80).optional(),
  severity: zAuditSeverity.optional(),
  actorId: z.string().trim().max(60).optional(),
  q: z.string().trim().max(80).optional(),
  // all = auditoría + notas operativas · audit = solo acciones · notes = solo notas.
  source: z.enum(['all', 'audit', 'notes']).default('all'),
  // hide = oculta las corridas automáticas de sincronización (ruido del scheduler).
  automation: z.enum(['hide', 'show']).default('hide'),
});
export type AuditQuery = z.infer<typeof zAuditQuery>;

export const zAuditEntry = z.object({
  id: z.string(),
  source: z.enum(['audit', 'dispatch-note', 'arrival-note']),
  at: z.string(),
  module: z.string(),
  moduleLabel: z.string(),
  action: z.string(),
  label: z.string(),
  severity: zAuditSeverity,
  actorId: z.string().nullable(),
  actorCode: z.string().nullable(),
  actorName: z.string().nullable(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  linkPath: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  context: z.record(z.string(), z.unknown()).nullable(),
});
export type AuditEntry = z.infer<typeof zAuditEntry>;

export const zAuditFacets = z.object({
  actors: z.array(z.object({ id: z.string(), name: z.string(), code: z.string().nullable(), count: z.number().int() })),
  actions: z.array(z.object({ action: z.string(), label: z.string(), module: z.string(), count: z.number().int() })),
  modules: z.array(z.object({ key: z.string(), label: z.string(), count: z.number().int() })),
});
export type AuditFacets = z.infer<typeof zAuditFacets>;

export const zAuditFeedResponse = z.object({
  items: z.array(zAuditEntry),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  stats: z.object({
    today: z.number().int(),
    critical7d: z.number().int(),
    actorsToday: z.number().int(),
    syncErrors7d: z.number().int(),
  }),
  facets: zAuditFacets,
});
export type AuditFeedResponse = z.infer<typeof zAuditFeedResponse>;
