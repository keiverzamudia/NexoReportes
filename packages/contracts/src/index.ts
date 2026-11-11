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

export const PERMISSION_ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'view_all',
  'override',
  'view_summary',
  'view_history',
  'view_removals',
] as const;
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
    key: 'vendedoras',
    label: 'Vendedoras',
    href: '/vendedoras',
    actions: [{ action: 'read', label: 'Ver' }],
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
      { action: 'override', label: 'Quitar selecciones de otros' },
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
      { action: 'create', label: 'Armar y enviar simulación' },
      { action: 'update', label: 'Abrir' },
      { action: 'delete', label: 'Anular' },
      { action: 'view_all', label: 'Ver todos los despachos' },
      { action: 'view_summary', label: 'Ver indicadores' },
      // Vistas separadas de la bandeja. Se conceden por rol o por excepción
      // individual; por defecto solo ADMIN las tiene.
      { action: 'view_history', label: 'Ver historial' },
      { action: 'view_removals', label: 'Ver retiros de simulación' },
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
  | 'vendedoras'
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
    ['vendedoras', 'read'],
    ['pedidos', 'read'],
    ['pedidos', 'create'],
    ['pedidos', 'update'],
    ['pedidos', 'delete'],
    ['clientes', 'read'],
    ['despacho', 'read'],
    ['despacho', 'create'],
    ['despacho', 'delete'],
    ['despacho', 'view_all'],
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
    ['despacho', 'view_all'],
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

// Desglose del solicitado de UN producto por cliente (doble clic en
// Disponibilidad). Las cantidades se entregan en las dos lecturas que usa el
// negocio: sacos y kilogramos equivalentes. `sharePct` es la participación de
// cada cliente sobre el 100 % de lo solicitado de ese producto.
export const zAvailabilityCustomer = z.object({
  customerCode: z.string(),
  customerName: z.string(),
  // Pedidos activos distintos que aportan al solicitado del cliente.
  ordersCount: z.number().int(),
  sacks: z.number(),
  kg: z.number(),
  sharePct: z.number(),
});
export type AvailabilityCustomer = z.infer<typeof zAvailabilityCustomer>;

export const zAvailabilityProductCustomers = z.object({
  productCode: z.string(),
  description: z.string(),
  uom: z.string(),
  kgPerUom: z.number().nullable(),
  stockTotal: z.number(),
  // Totales del producto: deben coincidir con la fila de Disponibilidad.
  demandQty: z.number(),
  demandKg: z.number().nullable(),
  totalSacks: z.number(),
  totalKg: z.number(),
  customers: z.array(zAvailabilityCustomer),
});
export type AvailabilityProductCustomers = z.infer<typeof zAvailabilityProductCustomers>;

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
// Periodo de ventas del módulo Clientes. «todos» = actividad de los últimos
// 12 meses (pedido activo o venta); el resto son ventanas móviles por mes
// calendario (mes en curso + N-1 meses anteriores).
export const CUSTOMER_SALES_PERIODS = ['todos', 'mes', '3m', '6m', '12m'] as const;
export const zCustomerSalesPeriod = z.enum(CUSTOMER_SALES_PERIODS);
export type CustomerSalesPeriod = z.infer<typeof zCustomerSalesPeriod>;

// Ventas del periodo medidas con notas de entrega (dbo.not_ent/reng_nde).
// La unidad manda: los renglones con unidad de venta SAC se reportan en
// sacos; el resto (KG y otras) se reporta en kg. `totalKg` es el equivalente
// total del periodo y solo se usa para ordenar/agregar.
export const zCustomerSales = z.object({
  sacks: z.number(),
  kg: z.number(),
  totalKg: z.number(),
  notes: z.number().int(),
  lastSaleDate: z.string().nullable(),
});
export type CustomerSales = z.infer<typeof zCustomerSales>;

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
  // Ventas del periodo consultado; null si Profit no respondió.
  sales: zCustomerSales.nullable(),
});
export type Customer = z.infer<typeof zCustomer>;

export const zCustomerQuery = zPaginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  salesPeriod: zCustomerSalesPeriod.default('todos'),
  // Conserva el comportamiento histórico: solo clientes con pedido activo.
  onlyWithOrders: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type CustomerQuery = z.infer<typeof zCustomerQuery>;

// Respuesta de /customers: además de la página, el resumen del conjunto
// filtrado (no solo de la página) y si Profit pudo responder.
export const zCustomerListResponse = zPaginated(zCustomer).extend({
  salesAvailable: z.boolean(),
  salesPeriod: zCustomerSalesPeriod,
  summary: z.object({
    withSales: z.number().int(),
    // Sacos de renglones SAC y kg de los renglones que no son SAC: el resumen
    // respeta la unidad, igual que la columna por cliente.
    totalSacks: z.number(),
    totalKg: z.number(),
  }),
});
export type CustomerListResponse = z.infer<typeof zCustomerListResponse>;

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

// ---------- Ficha 360 de clientes ----------
// Informe comercial por cliente. El volumen sale de las notas de entrega
// (`not_ent`/`reng_nde`) y el dinero de la facturación neta (`docum_cc`).
// La ventana se mide en meses móviles; con 24 o 36 se compara contra los 12
// anteriores y se detectan productos que el cliente dejó de comprar.
export const CUSTOMER_INSIGHT_MONTH_OPTIONS = [12, 24, 36] as const;
export type CustomerInsightMonthOption = (typeof CUSTOMER_INSIGHT_MONTH_OPTIONS)[number];

export const zCustomerInsightQuery = z.object({
  months: z.coerce
    .number()
    .int()
    .refine((value) => (CUSTOMER_INSIGHT_MONTH_OPTIONS as readonly number[]).includes(value), {
      message: 'La ventana debe ser 12, 24 o 36 meses',
    })
    .default(24),
  currency: zCustomerStatementCurrency.default('USD'),
});
export type CustomerInsightQuery = z.infer<typeof zCustomerInsightQuery>;

export const CUSTOMER_INSIGHT_PRODUCT_STATUSES = ['NUEVO', 'CRECIENDO', 'ESTABLE', 'CAYENDO', 'PERDIDO'] as const;
export const zCustomerInsightProductStatus = z.enum(CUSTOMER_INSIGHT_PRODUCT_STATUSES);
export type CustomerInsightProductStatus = z.infer<typeof zCustomerInsightProductStatus>;

export const CUSTOMER_INSIGHT_SEGMENTS = ['ACTIVO', 'EN_RIESGO', 'INACTIVO', 'SIN_DATOS'] as const;
export const zCustomerInsightSegment = z.enum(CUSTOMER_INSIGHT_SEGMENTS);
export type CustomerInsightSegment = z.infer<typeof zCustomerInsightSegment>;

export const CUSTOMER_INSIGHT_SEVERITIES = ['critical', 'warning', 'info', 'success'] as const;
export const zCustomerInsightSeverity = z.enum(CUSTOMER_INSIGHT_SEVERITIES);
export type CustomerInsightSeverity = z.infer<typeof zCustomerInsightSeverity>;

// Bloque de volumen de una ventana (actual o anteriores 12 meses).
export const zCustomerInsightWindow = z.object({
  sacks: z.number(),
  kg: z.number(),
  tonnes: z.number(),
  notes: z.number().int(),
  // Importe estimado del producto (reparto del facturado según toneladas).
  // null si no hay facturación disponible.
  billed: z.number().nullable(),
  lastSaleDate: z.string().nullable(),
});
export type CustomerInsightWindow = z.infer<typeof zCustomerInsightWindow>;

export const zCustomerInsightProduct = z.object({
  code: z.string(),
  description: z.string().nullable(),
  uom: z.string().nullable(),
  kgPerUom: z.number().nullable(),
  status: zCustomerInsightProductStatus,
  // Participación en el volumen actual (0–100).
  sharePct: z.number(),
  // Variación de toneladas contra los 12 meses anteriores (null si no hay base).
  deltaPct: z.number().nullable(),
  current: zCustomerInsightWindow,
  previous: zCustomerInsightWindow,
});
export type CustomerInsightProduct = z.infer<typeof zCustomerInsightProduct>;

export const zCustomerInsightMonth = z.object({
  // yyyy-MM
  month: z.string(),
  sacks: z.number(),
  kg: z.number(),
  tonnes: z.number(),
  notes: z.number().int(),
  billed: z.number().nullable(),
});
export type CustomerInsightMonth = z.infer<typeof zCustomerInsightMonth>;

export const zCustomerInsightYear = z.object({
  year: z.number().int(),
  sacks: z.number(),
  kg: z.number(),
  tonnes: z.number(),
  notes: z.number().int(),
  billed: z.number().nullable(),
  monthsWithSales: z.number().int(),
});
export type CustomerInsightYear = z.infer<typeof zCustomerInsightYear>;

export const zCustomerInsightTotals = z.object({
  sacks: z.number(),
  kg: z.number(),
  tonnes: z.number(),
  notes: z.number().int(),
  billed: z.number().nullable(),
  firstSaleDate: z.string().nullable(),
  lastSaleDate: z.string().nullable(),
  products: z.number().int(),
});
export type CustomerInsightTotals = z.infer<typeof zCustomerInsightTotals>;

export const zCustomerInsightCadence = z.object({
  avgDaysBetweenNotes: z.number().nullable(),
  daysSinceLastSale: z.number().int().nullable(),
  expectedNextDate: z.string().nullable(),
  purchasesPerMonth: z.number().nullable(),
  segment: zCustomerInsightSegment,
});
export type CustomerInsightCadence = z.infer<typeof zCustomerInsightCadence>;

export const zCustomerInsightAccount = z.object({
  saldo: z.number(),
  saldoVencido: z.number(),
  credito: z.number(),
  limiteCredito: z.number().nullable(),
  documentos: z.number().int(),
  vencidos: z.number().int(),
});
export type CustomerInsightAccount = z.infer<typeof zCustomerInsightAccount>;

export const zCustomerInsightOrders = z.object({
  activeCount: z.number().int(),
  pendingQty: z.number(),
  pendingKg: z.number(),
  nextDeliveryDate: z.string().nullable(),
});
export type CustomerInsightOrders = z.infer<typeof zCustomerInsightOrders>;

export const zCustomerInsightSimilar = z.object({
  code: z.string(),
  description: z.string().nullable(),
  uom: z.string().nullable(),
  kgPerUom: z.number().nullable(),
  adopters: z.number().int(),
  adoptersPct: z.number().nullable(),
  avgTonnes: z.number(),
  totalTonnes: z.number(),
});
export type CustomerInsightSimilar = z.infer<typeof zCustomerInsightSimilar>;

export const zCustomerInsightAlert = z.object({
  key: z.string(),
  severity: zCustomerInsightSeverity,
  title: z.string(),
  detail: z.string(),
  // Monto asociado (facturado estimado en riesgo / recuperable), si aplica.
  amount: z.number().nullable(),
});
export type CustomerInsightAlert = z.infer<typeof zCustomerInsightAlert>;

export const zCustomerInsightCustomer = z.object({
  code: z.string(),
  name: z.string(),
  customerType: z.string().nullable(),
  vendor: z.string().nullable(),
  isActive: z.boolean(),
});
export type CustomerInsightCustomer = z.infer<typeof zCustomerInsightCustomer>;

export const zCustomerInsightResponse = z.object({
  customer: zCustomerInsightCustomer,
  asOf: z.string(),
  currency: zCustomerStatementCurrency,
  months: z.number().int(),
  currentPeriod: z.object({ from: z.string(), to: z.string() }),
  previousPeriod: z.object({ from: z.string(), to: z.string() }).nullable(),
  totals: zCustomerInsightTotals,
  previousTotals: zCustomerInsightTotals.nullable(),
  trend: z.object({
    volumePct: z.number().nullable(),
    billingPct: z.number().nullable(),
    notesPct: z.number().nullable(),
  }),
  monthly: z.array(zCustomerInsightMonth),
  annual: z.array(zCustomerInsightYear),
  products: z.array(zCustomerInsightProduct),
  // Subconjunto de `products` con estado PERDIDO (ordenado por volumen perdido).
  lostProducts: z.array(zCustomerInsightProduct),
  similarProducts: z.array(zCustomerInsightSimilar),
  cadence: zCustomerInsightCadence,
  account: zCustomerInsightAccount.nullable(),
  orders: zCustomerInsightOrders,
  alerts: z.array(zCustomerInsightAlert),
  available: z.boolean(),
  billingAvailable: z.boolean(),
  billingPartial: z.boolean(),
  // true si el $ por producto se repartió por toneladas (no es precio real).
  productBillingEstimated: z.boolean(),
  truncated: z.boolean(),
  source: z.enum(['profit', 'fixtures']),
});
export type CustomerInsightResponse = z.infer<typeof zCustomerInsightResponse>;

export const ORDER_STATUSES = ['ABIERTO', 'NOTA_ENTREGA', 'CERRADO', 'CANCELADO', 'DESCONOCIDO'] as const;
export const zOrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof zOrderStatus>;

// Estado de facturación separado del estado comercial: una nota de entrega
// no es una factura. `FACTURADO_ASUMIDO` es la regla de negocio del cierre
// automático; cuando llegue la factura real se reemplaza por `FACTURADO`.
export const ORDER_BILLING_STATUSES = ['PENDIENTE', 'FACTURADO_ASUMIDO', 'FACTURADO'] as const;
export const zOrderBillingStatus = z.enum(ORDER_BILLING_STATUSES);
export type OrderBillingStatus = z.infer<typeof zOrderBillingStatus>;

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
  // Ciclo de vida local (cierre por nota de entrega / anulación).
  closedAt: z.string().nullable().optional(),
  closedReason: z.string().nullable().optional(),
  billingStatus: zOrderBillingStatus.optional(),
  notaEntregaRefs: z.array(z.string()).optional(),
  // Motivo de revisión cuando la reconciliación no cierra el pedido.
  reviewReason: z.string().nullable().optional(),
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
  // Por defecto solo se ve la cartera viva (isActive=true). El historial de
  // cierres se consulta con includeClosed=true.
  includeClosed: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
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
  // Fecha de emisión del pedido en Profit (día en que se creó).
  orderDate: z.string().nullable(),
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
// ============================================================
// Ciclo de vida del pedido (cierre por nota de entrega).
//
// El sync trae cotizaciones pendientes. Cuando Profit las convierte en nota
// de entrega (`cotiz_c.status = '2'` y no anulada), el pedido sale de la
// cartera y se registra un evento inmutable. Es una capa LOCAL: nunca se
// escribe en Profit.
// ============================================================
export const ORDER_CLOSE_REASONS = [
  'NOTA_ENTREGA',
  'CANCELADO',
  'SIN_PENDIENTE',
  'MANUAL',
  'FUERA_DE_VISTA',
  'REAPERTURA',
] as const;
export const zOrderCloseReason = z.enum(ORDER_CLOSE_REASONS);
export type OrderCloseReason = z.infer<typeof zOrderCloseReason>;

export const zOrderLifecycleEvent = z.object({
  id: z.string(),
  orderId: z.string().nullable(),
  orderNumber: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  fromStatus: z.string(),
  toStatus: z.string(),
  reason: zOrderCloseReason,
  source: z.string(),
  // JSON parseado con la evidencia de Profit (status, anulada, pendiente…).
  evidence: z.record(z.string(), z.unknown()).nullable(),
  actorId: z.string().nullable(),
  actorCode: z.string().nullable(),
  actorName: z.string().nullable(),
  detectedAt: z.string(),
});
export type OrderLifecycleEvent = z.infer<typeof zOrderLifecycleEvent>;

export const zOrderReconciliationRun = z.object({
  id: z.string(),
  status: z.enum(['EN_CURSO', 'EXITOSA', 'PARCIAL', 'ERROR']),
  dryRun: z.boolean(),
  trigger: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  checked: z.number().int(),
  closed: z.number().int(),
  canceled: z.number().int(),
  review: z.number().int(),
  errorsCount: z.number().int(),
  errorDetail: z.string().nullable(),
});
export type OrderReconciliationRun = z.infer<typeof zOrderReconciliationRun>;

export const zOrderLifecycleStatus = z.object({
  lastRun: zOrderReconciliationRun.nullable(),
  // Cierres/anulaciones recientes (máximo 50).
  recent: z.array(zOrderLifecycleEvent),
  // Pedidos que desaparecieron o tienen datos inconsistentes y necesitan
  // revisión humana. No se cierran solos.
  review: z.array(zOrderSummary),
  // Totales de la cartera viva vs cerrada (para el panel).
  closedToday: z.number().int(),
  pendingReview: z.number().int(),
});
export type OrderLifecycleStatus = z.infer<typeof zOrderLifecycleStatus>;

export const zOrderReconcileInput = z.object({
  // Si se omite, usa ORDER_RECONCILE_DRY_RUN del servidor.
  dryRun: z.boolean().optional(),
  // Opcional: limitar a pedidos concretos (pruebas o corrección puntual).
  orderNumbers: z.array(z.string().trim().min(1).max(40)).max(2000).optional(),
});
export type OrderReconcileInput = z.infer<typeof zOrderReconcileInput>;

export const zOrderReopenInput = z.object({
  reason: z.string().trim().min(4, 'Explica por qué se reabre').max(240),
});
export type OrderReopenInput = z.infer<typeof zOrderReopenInput>;

export const zOrderLifecycleQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type OrderLifecycleQuery = z.infer<typeof zOrderLifecycleQuery>;

// Simulador de despacho: escenarios guardados (Fase 6).
//
// La simulación vive en el navegador hasta que el usuario la guarda. Aquí
// viaja como RECETA (qué se marcó y con qué filtros/modo) + FOTO (totales y
// cantidades del momento). Nunca escribe en Profit.
// ============================================================
export const MAX_SCENARIOS = 25;
export const MAX_SCENARIO_LINES = 5000;
// TTL del lock de edición del plan global (el cliente renueva por heartbeat).
export const SCENARIO_LOCK_SECONDS = 120;

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
// `selectedBy*` y `selectedAt` solo existen en el plan vivo del equipo: quien
// marca primero reserva el renglón y el resto lo ve tomado. En una foto
// guardada se conservan como referencia histórica.
export const zScenarioLineRef = z.object({
  orderNumber: z.string().trim().min(1).max(40),
  productCode: z.string().trim().min(1).max(60),
  selectedById: z.string().nullable().optional(),
  selectedByName: z.string().nullable().optional(),
  selectedAt: z.string().nullable().optional(),
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
  // Comentario del planificador para el almacén (por pedido/artículo).
  comment: z.string().trim().max(240).nullable().default(null),
});
export type ScenarioSnapshotLine = z.infer<typeof zScenarioSnapshotLine>;

// ---------- Plan de carga del camión ----------
// El planificador define los espacios del vehículo y ubica exactamente un
// pedido en cada uno (sin reparto automático). Los `segments` son posicionales:
// el índice del arreglo es el espacio físico dentro del tráiler. `orderNumbers`
// es la fuente de verdad; `label`, `kg` y `sacks` se derivan de los renglones.
// `grouping` quedó como campo legado de los planes anteriores y ya no se usa.
// Es una guía visual, no escribe en Profit.
export const LOAD_PLAN_GROUPINGS = ['cliente', 'pedido'] as const;
export const zLoadPlanGrouping = z.enum(LOAD_PLAN_GROUPINGS);
export type LoadPlanGrouping = z.infer<typeof zLoadPlanGrouping>;

// Tope técnico del contrato (compatibilidad con planes históricos). La UI
// limita la edición a 6 espacios.
export const MAX_LOAD_PLAN_SEGMENTS = 24;

export const zLoadPlanSegment = z.object({
  id: z.string().trim().min(1).max(40),
  // Etiqueta visible: nombre del cliente o número de pedido.
  label: z.string().trim().min(1).max(80),
  customerCode: z.string().trim().max(40).nullable().default(null),
  orderNumbers: z.array(z.string().trim().max(40)).max(200).default([]),
  kg: z.number().min(0),
  sacks: z.number().min(0).default(0),
  // Color del bloque (hex). Si falta, se usa la paleta del componente.
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type LoadPlanSegment = z.infer<typeof zLoadPlanSegment>;

export const zLoadPlan = z.object({
  grouping: zLoadPlanGrouping.default('cliente'),
  segments: z.array(zLoadPlanSegment).max(MAX_LOAD_PLAN_SEGMENTS).default([]),
  note: z.string().trim().max(240).optional(),
});
export type LoadPlan = z.infer<typeof zLoadPlan>;

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
  // Guía visual de carga del camión. Opcional para payloads históricos.
  loadPlan: zLoadPlan.nullable().default(null),
  // Comentarios del planificador por renglón (clave «pedido#artículo»).
  // Viajan al almacén y se conservan en el plan vivo.
  comments: z.record(z.string(), z.string().trim().max(240)).default({}),
});
export type ScenarioPayload = z.infer<typeof zScenarioPayload>;

// Lock del plan global: solo el titular autoguarda. `token` se devuelve
// únicamente a quien lo posee (el cliente lo reenvía en cada guardado).
export const zScenarioLock = z.object({
  holderId: z.string().nullable(),
  holderName: z.string().nullable(),
  until: z.string().nullable(),
  isMine: z.boolean().default(false),
  token: z.string().nullable().default(null),
});
export type ScenarioLock = z.infer<typeof zScenarioLock>;

// Borrador: solo receta + renglones (sin foto) para no escribir de más.
export const zScenarioDraftInput = z.object({
  recipe: zScenarioRecipe,
  selected: z.array(zScenarioLineRef).max(MAX_SCENARIO_LINES),
  loadPlan: zLoadPlan.nullable().optional(),
  comments: z.record(z.string(), z.string().trim().max(240)).optional(),
  // Versionado optimista y lock del plan global.
  version: z.number().int().min(1).optional(),
  lockToken: z.string().trim().max(120).optional(),
});
export type ScenarioDraftInput = z.infer<typeof zScenarioDraftInput>;

export const zScenarioSaveInput = zScenarioDraftInput.extend({
  name: z.string().trim().min(1, 'Ponle un nombre').max(80),
  snapshot: zScenarioSnapshot,
});
export type ScenarioSaveInput = z.infer<typeof zScenarioSaveInput>;

// Envío de una simulación guardada al almacén. El título nace del nombre del
// escenario si no se envía uno; el destino vacío = bandeja compartida.
export const zScenarioSendDispatchInput = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  instructions: z.string().trim().max(500).optional(),
  assignedToId: z.string().min(1).nullable().optional(),
});
export type ScenarioSendDispatchInput = z.infer<typeof zScenarioSendDispatchInput>;

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
  // Creador del escenario (para auditoría y para el borrado restringido).
  ownerId: z.string(),
  ownerCode: z.string().nullable(),
  ownerName: z.string().nullable(),
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
  // Permisos calculados para el usuario que consulta.
  canEdit: z.boolean().default(true),
  canDelete: z.boolean().default(true),
  canRestore: z.boolean().default(true),
  // Renglones del escenario cuyo pedido ya salió de la cartera (nota de
  // entrega, anulación o cierre). Es informativo: la foto no se muta.
  closedLines: z.number().int().default(0),
  // Lock del plan global (solo aplica al borrador DRAFT).
  lock: zScenarioLock.nullable().default(null),
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
  // true = la lista incluye escenarios de todos los usuarios (ADMIN).
  allOwners: z.boolean().default(false),
  dataVersion: z.string().nullable(),
});
export type ScenarioListResponse = z.infer<typeof zScenarioListResponse>;

// Enriquecimiento del plan vivo. El servidor resuelve los renglones
// seleccionados contra la cartera y calcula la asignación en orden de marcado:
// así las tres pantallas ven el mismo 30/20 aunque cada una filtre clientes
// distintos. `freeByProduct` es el stock que queda tras descontar TODO lo que
// el equipo ya marcó.
export const zDraftAssignment = z.object({
  orderNumber: z.string(),
  productCode: z.string(),
  assignedQty: z.number(),
  assignedKg: z.number(),
  missingQty: z.number(),
  missingKg: z.number(),
  stockTotal: z.number(),
  freeAfter: z.number(),
});
export type DraftAssignment = z.infer<typeof zDraftAssignment>;

export const zDraftFreeStock = z.object({
  productCode: z.string(),
  stock: z.number(),
  committed: z.number(),
  free: z.number(),
});
export type DraftFreeStock = z.infer<typeof zDraftFreeStock>;

export const zDraftActiveSheet = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
});
export type DraftActiveSheet = z.infer<typeof zDraftActiveSheet>;

// Efecto de un guardado/liberación sobre las hojas de despacho abiertas.
// El web lo usa para avisar sin que el usuario tenga que abrir el despacho.
export const zDraftDispatchImpact = z.object({
  removedLines: z.number().int(),
  sheetNumbers: z.array(z.string()),
  canceledSheets: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
    }),
  ),
});
export type DraftDispatchImpact = z.infer<typeof zDraftDispatchImpact>;

export const zScenarioDraftResponse = z.object({
  scenario: zScenarioDetail.nullable(),
  lines: z.array(zOrderGroupLine).default([]),
  assignments: z.array(zDraftAssignment).default([]),
  freeByProduct: z.array(zDraftFreeStock).default([]),
  activeSheet: zDraftActiveSheet.nullable().default(null),
  dispatchImpact: zDraftDispatchImpact.nullable().default(null),
});
export type ScenarioDraftResponse = z.infer<typeof zScenarioDraftResponse>;

// Liberar selecciones: sin `all` ni `lines` libera solo las mías; `all` exige
// el permiso «Quitar selecciones de otros».
export const zDraftReleaseInput = z.object({
  all: z.boolean().optional(),
  lines: z.array(zScenarioLineRef).max(MAX_SCENARIO_LINES).optional(),
});
export type DraftReleaseInput = z.infer<typeof zDraftReleaseInput>;

// Respuesta al tomar/renovar el lock del plan global.
export const zScenarioLockResponse = zScenarioLock.extend({
  version: z.number().int(),
  until: z.string(),
  token: z.string(),
});
export type ScenarioLockResponse = z.infer<typeof zScenarioLockResponse>;

export const zScenarioLockInput = z.object({
  // true = un ADMIN puede arrebatar el lock a otro usuario.
  force: z.boolean().optional(),
});
export type ScenarioLockInput = z.infer<typeof zScenarioLockInput>;

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
  // Solo histórico: el flujo nuevo va de ENVIADO a EN_PROCESO al primer renglón.
  'RECIBIDO',
  'EN_PROCESO',
  'CON_NOVEDAD',
  'DESPACHADO',
  'CANCELADO',
] as const;
export const zDispatchSheetStatus = z.enum(DISPATCH_SHEET_STATUSES);
export type DispatchSheetStatus = z.infer<typeof zDispatchSheetStatus>;

// ANULADO = renglón retirado del plan antes de cargarse. Se conserva con
// soft-delete (quién, cuándo y por qué) y no cuenta en totales ni tiempos.
export const DISPATCH_LINE_STATUSES = ['PENDIENTE', 'CARGADO', 'PARCIAL', 'FALTANTE', 'NOVEDAD', 'ANULADO'] as const;
export const zDispatchLineStatus = z.enum(DISPATCH_LINE_STATUSES);
export type DispatchLineStatus = z.infer<typeof zDispatchLineStatus>;

// Marcas que el almacén puede aplicar hoy. Cargado toma el plan completo;
// parcial guarda X unidades; faltante (= no cargado) deja todo en cero.
// NOVEDAD se conserva solo como histórico de lectura.
export const DISPATCH_LINE_MARKS = ['PENDIENTE', 'CARGADO', 'PARCIAL', 'FALTANTE'] as const;
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
  // Tiempos: cierre de carga por cliente y factura entregada.
  'DESPACHO_CARGA_CERRADA',
  'DESPACHO_FACTURADO',
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
  // Anulación del renglón (solo status ANULADO). `removalReason` explica si
  // salió del plan o si Profit anuló/cerró el pedido.
  removedAt: z.string().nullable(),
  removedByName: z.string().nullable(),
  removalReason: z.string().nullable(),
  removalSource: z.string().nullable(),
  // Relojes derivados del cliente al que pertenece el renglón. `loadClosedAt`
  // es el momento en que el almacén cerró ESTE producto (coincide con
  // `checkedAt`); `loadStartedAt` es el inicio de carga del cliente.
  loadStartedAt: z.string().nullable(),
  loadClosedAt: z.string().nullable(),
  loadClosedByName: z.string().nullable(),
});
export type DispatchSheetLine = z.infer<typeof zDispatchSheetLine>;

// Relojes y factura de un cliente dentro del despacho.
export const zDispatchCustomerProgress = z.object({
  customerKey: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  loadStartedAt: z.string().nullable(),
  loadStartedByName: z.string().nullable(),
  loadClosedAt: z.string().nullable(),
  invoiceDeliveredAt: z.string().nullable(),
  invoiceDeliveredByName: z.string().nullable(),
  invoiceRef: z.string().nullable(),
  note: z.string().nullable(),
  // Conteos de productos del cliente (los calcula el servidor).
  products: z.number().int(),
  pendingProducts: z.number().int(),
  loadedProducts: z.number().int(),
  partialProducts: z.number().int(),
  missingProducts: z.number().int(),
});
export type DispatchCustomerProgress = z.infer<typeof zDispatchCustomerProgress>;

// Renglón congelado dentro de un evento de la bitácora. Se guarda al momento
// del hito para que el detalle no dependa de cómo evolucione el plan.
export const zDispatchEventProduct = z.object({
  orderNumber: z.string(),
  productCode: z.string(),
  description: z.string().nullable(),
  qty: z.number().nullable(),
  uom: z.string().nullable(),
  status: z.string().nullable(),
});
export type DispatchEventProduct = z.infer<typeof zDispatchEventProduct>;

export const zDispatchEventMeta = z.object({
  customerKey: z.string().nullable(),
  customerName: z.string().nullable(),
  invoiceRef: z.string().nullable(),
  // Duración del hito (minutos): carga del cliente o espera hasta factura.
  minutes: z.number().nullable(),
  products: z.array(zDispatchEventProduct),
});
export type DispatchEventMeta = z.infer<typeof zDispatchEventMeta>;

export const zDispatchSheetEvent = z.object({
  id: z.string(),
  // SYSTEM = transición de estado; MESSAGE = conversación entre las partes.
  kind: z.enum(['SYSTEM', 'MESSAGE']),
  type: z.string(),
  body: z.string().nullable(),
  meta: zDispatchEventMeta.nullable(),
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
  // Motivo de la anulación (manual o automática por plan vacío).
  cancelReason: z.string().nullable(),
  plannedLines: z.number().int(),
  // Pedidos distintos (nº de orden) en los renglones activos de la hoja.
  plannedOrders: z.number().int(),
  // Pedidos con al menos un renglón por cargar (solo hojas abiertas).
  pendingOrders: z.number().int(),
  // Renglones anulados (soft-delete): no cuentan en totales ni progreso.
  annulledLines: z.number().int(),
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
  // Tiempos agregados de la hoja (mín. inicio y máx. cierre / factura).
  loadStartedAt: z.string().nullable(),
  loadClosedAt: z.string().nullable(),
  invoiceDeliveredAt: z.string().nullable(),
  pendingInvoiceCustomers: z.number().int(),
  // Avance de los relojes por cliente (para mostrar parciales en la UI).
  totalCustomers: z.number().int(),
  closedCustomers: z.number().int(),
  invoicedCustomers: z.number().int(),
  // Permisos resueltos para quien consulta (evita duplicar reglas en el web).
  canOperate: z.boolean(),
  canCancel: z.boolean(),
  // Puede marcar «Factura entregada», incluso después de cerrar el despacho.
  canInvoice: z.boolean(),
});
export type DispatchSheetSummary = z.infer<typeof zDispatchSheetSummary>;

export const zDispatchSheetDetail = zDispatchSheetSummary.extend({
  lines: z.array(zDispatchSheetLine),
  events: z.array(zDispatchSheetEvent),
  // Guía de carga del camión copiada de la simulación. null = sin guía.
  loadPlan: zLoadPlan.nullable(),
  // Un registro por cliente con sus relojes y factura.
  customerProgress: z.array(zDispatchCustomerProgress),
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

// ============================================================
// Pulso de carga de la bandeja (`GET /dispatch-sheets/pulse`).
//
// No es el total de la hoja: es SOLO lo que falta por cargar
// (`plannedQty - loadedQty > 0` en hojas abiertas). La vista de Despacho lo
// muestra como un «brief de carga»: una cifra protagonista (renglones), tres
// métricas de apoyo, el termómetro de urgencia y el desglose por despacho.
//
//   · openSheets= hojas abiertas, tengan o no algo por cargar.
//   · sheets    = hojas abiertas que todavía tienen algo por cargar.
//   · orders    = pedidos distintos (`orderNumber`) con algo por cargar.
//   · lines     = renglones por cargar.
//   · customers = clientes distintos con algo por cargar.
//   · sacks     = unidades SAC por cargar; sacksKg = su equivalente en kg.
//   · bulkKg    = kg pendientes de renglones KG (granel).
//   · otherKg   = kg pendientes de otras unidades (no SAC / no KG).
//   · urgency   = pedidos agrupados por su fecha de entrega más próxima.
//   · oldestDue = fecha de entrega más antigua entre los pedidos pendientes.
//   · bySheet   = desglose de lo pendiente por hoja (para «Ver desglose»).
// ============================================================
export const zDispatchPulseSheet = z.object({
  id: z.string(),
  number: z.string(),
  orders: z.number().int(),
  lines: z.number().int(),
  sacks: z.number(),
  kg: z.number(),
  oldestDue: z.string().nullable(),
});
export type DispatchPulseSheet = z.infer<typeof zDispatchPulseSheet>;

export const zDispatchPulse = z.object({
  generatedAt: z.string(),
  // Hojas abiertas en total (con o sin pendientes).
  openSheets: z.number().int(),
  // Hojas abiertas que todavía tienen al menos un renglón por cargar.
  sheets: z.number().int(),
  orders: z.number().int(),
  lines: z.number().int(),
  customers: z.number().int(),
  sacks: z.number(),
  sacksKg: z.number(),
  bulkKg: z.number(),
  otherKg: z.number(),
  totalKg: z.number(),
  // yyyy-MM-dd de la entrega más antigua todavía pendiente.
  oldestDue: z.string().nullable(),
  // Nombres de los clientes con carga pendiente (máx. 4, para el tooltip).
  customerNames: z.array(z.string()),
  urgency: z.object({
    overdue: z.number().int(),
    today: z.number().int(),
    week: z.number().int(),
    later: z.number().int(),
    noDate: z.number().int(),
  }),
  bySheet: z.array(zDispatchPulseSheet),
});
export type DispatchPulse = z.infer<typeof zDispatchPulse>;

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
  // pending  = todo lo abierto (bandeja de trabajo, sin importar quién publicó)
  // created  = lo que publiqué
  // history  = cerrados/anulados
  // all      = compatibilidad: visibilidad base del rol
  // assigned = compatibilidad: lo mío por operar
  scope: z.enum(['all', 'pending', 'assigned', 'created', 'history']).default('pending'),
  status: zDispatchSheetStatus.optional(),
  q: z.string().trim().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type DispatchSheetQuery = z.infer<typeof zDispatchSheetQuery>;

// ============================================================
// Retiros de simulación (`GET /dispatch-sheets/removals`).
//
// Renglones que salieron del plan de una hoja de despacho antes de cargarse.
// Se agrupan por pedido para revisar qué se cayó, por qué y en qué despacho:
//   · RETIRADO_DEL_PLAN          → ajuste manual desde Pedidos.
//   · PEDIDO_ANULADO_EN_PROFIT   → el pedido se anuló en Profit.
//   · PEDIDO_CERRADO_EN_PROFIT   → Profit lo cerró/facturó (nota de entrega).
// Solo lectura: no toca Profit ni modifica la hoja.
// ============================================================
export const DISPATCH_REMOVAL_REASONS = [
  'RETIRADO_DEL_PLAN',
  'PEDIDO_ANULADO_EN_PROFIT',
  'PEDIDO_CERRADO_EN_PROFIT',
] as const;
export const zDispatchRemovalReason = z.enum(DISPATCH_REMOVAL_REASONS);
export type DispatchRemovalReason = z.infer<typeof zDispatchRemovalReason>;

export const zDispatchRemovalsQuery = z
  .object({
    // Rango sobre la fecha del retiro. Sin rango = todo el histórico visible.
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    reason: zDispatchRemovalReason.optional(),
    q: z.string().trim().max(80).optional(),
    sheetId: z.string().trim().min(1).max(60).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'La fecha final debe ser mayor o igual a la inicial.',
      });
    }
  });
export type DispatchRemovalsQuery = z.infer<typeof zDispatchRemovalsQuery>;

export const zDispatchRemovalLine = z.object({
  id: z.string(),
  sheetId: z.string(),
  sheetNumber: z.string(),
  orderNumber: z.string(),
  productCode: z.string(),
  description: z.string().nullable(),
  uom: z.string().nullable(),
  plannedQty: z.number(),
  plannedKg: z.number(),
  removalReason: z.string().nullable(),
  removedAt: z.string().nullable(),
  removedByName: z.string().nullable(),
});
export type DispatchRemovalLine = z.infer<typeof zDispatchRemovalLine>;

export const zDispatchRemovalSheet = z.object({
  id: z.string(),
  number: z.string(),
  status: zDispatchSheetStatus,
});
export type DispatchRemovalSheet = z.infer<typeof zDispatchRemovalSheet>;

export const zDispatchRemovalOrder = z.object({
  orderNumber: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  // Despachos donde se retiró al menos un renglón de este pedido.
  sheets: z.array(zDispatchRemovalSheet),
  linesCount: z.number().int(),
  plannedKg: z.number(),
  // Motivos presentes en el pedido (pueden convivir varios).
  reasons: z.array(z.string()),
  // Retiro más reciente del pedido.
  removedAt: z.string().nullable(),
  removedByNames: z.array(z.string()),
  lines: z.array(zDispatchRemovalLine),
});
export type DispatchRemovalOrder = z.infer<typeof zDispatchRemovalOrder>;

export const zDispatchRemovalsResponse = z.object({
  orders: z.array(zDispatchRemovalOrder),
  totals: z.object({
    orders: z.number().int(),
    lines: z.number().int(),
    plannedKg: z.number(),
    byReason: z.record(z.string(), z.number().int()),
  }),
  generatedAt: z.string(),
});
export type DispatchRemovalsResponse = z.infer<typeof zDispatchRemovalsResponse>;

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

export const zDispatchLineInput = z
  .object({
    // CARGADO = plan completo; PARCIAL = X unidades; FALTANTE = no cargado;
    // PENDIENTE = deshacer la marca.
    status: zDispatchLineMark,
    // Unidades cargadas en la unidad del renglón (solo para PARCIAL).
    loadedQty: z.coerce.number().min(0).max(1_000_000).optional(),
    // Motivo de la diferencia. Obligatorio en PARCIAL/FALTANTE.
    note: z.string().trim().max(240).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status !== 'PARCIAL' && value.status !== 'FALTANTE') return;
    if (!value.note || value.note.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'Escribe el motivo de la diferencia.',
      });
    }
    if (value.status === 'PARCIAL' && (value.loadedQty === undefined || value.loadedQty <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['loadedQty'],
        message: 'Indica cuántas unidades cargaste.',
      });
    }
  });
export type DispatchLineInput = z.infer<typeof zDispatchLineInput>;

export const zDispatchCompleteInput = z.object({ note: z.string().trim().max(500).optional() });
export type DispatchCompleteInput = z.infer<typeof zDispatchCompleteInput>;

export const zDispatchCancelInput = z.object({ reason: z.string().trim().min(3, 'Indica el motivo').max(240) });
export type DispatchCancelInput = z.infer<typeof zDispatchCancelInput>;

export const zDispatchMessageInput = z.object({ body: z.string().trim().min(1).max(500) });
export type DispatchMessageInput = z.infer<typeof zDispatchMessageInput>;

// Factura entregada por cliente (o para todo el despacho). El número es
// opcional: el hito lo marca la hora del servidor.
export const zDispatchInvoiceInput = z.object({
  invoiceRef: z.string().trim().max(60).optional(),
  note: z.string().trim().max(240).optional(),
});
export type DispatchInvoiceInput = z.infer<typeof zDispatchInvoiceInput>;

export const zDispatchCustomerKeyInput = z.object({
  customerKey: z.string().trim().min(1).max(240),
});
export type DispatchCustomerKeyInput = z.infer<typeof zDispatchCustomerKeyInput>;

export const zDispatchCustomerInvoiceInput = zDispatchInvoiceInput.extend({
  customerKey: z.string().trim().min(1).max(240),
});
export type DispatchCustomerInvoiceInput = z.infer<typeof zDispatchCustomerInvoiceInput>;

// Corrección de una factura ya marcada: exige motivo y deja rastro.
export const zDispatchReopenInvoiceInput = z.object({
  reason: z.string().trim().min(3, 'Indica el motivo').max(240),
});
export type DispatchReopenInvoiceInput = z.infer<typeof zDispatchReopenInvoiceInput>;

export const zDispatchCustomerReopenInput = zDispatchReopenInvoiceInput.extend({
  customerKey: z.string().trim().min(1).max(240),
});
export type DispatchCustomerReopenInput = z.infer<typeof zDispatchCustomerReopenInput>;

// ============================================================
// Reporte de tiempos de despacho.
//
// Los relojes viven por cliente (`DispatchCustomerProgress`). El reporte se
// puede agrupar por día o mes y filtrar por cliente o por facturas pendientes.
// ============================================================
export const DISPATCH_METRIC_GRANULARITIES = ['day', 'month'] as const;
export const zDispatchMetricGranularity = z.enum(DISPATCH_METRIC_GRANULARITIES);
export type DispatchMetricGranularity = z.infer<typeof zDispatchMetricGranularity>;

export const zDispatchMetricsQuery = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    granularity: zDispatchMetricGranularity.default('day'),
    customerCode: z.string().trim().max(240).optional(),
    invoiceStatus: z.enum(['all', 'pending', 'delivered']).default('all'),
    // El historial solo cuenta despachos cerrados: deja fuera hojas abiertas.
    onlyClosed: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
  })
  .superRefine((value, ctx) => {
    if (value.from > value.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'La fecha final debe ser mayor o igual a la inicial.' });
    }
  });
export type DispatchMetricsQuery = z.infer<typeof zDispatchMetricsQuery>;

const zDispatchDurationStats = z.object({
  groups: z.number().int(),
  avgMinutes: z.number().nullable(),
  medianMinutes: z.number().nullable(),
  p90Minutes: z.number().nullable(),
});
export type DispatchDurationStats = z.infer<typeof zDispatchDurationStats>;

export const zDispatchMetricsSummary = z.object({
  dispatches: z.number().int(),
  customers: z.number().int(),
  // Pedidos distintos (nº de orden), no renglones.
  orders: z.number().int(),
  // Renglones/productos involucrados.
  lines: z.number().int(),
  kg: z.number(),
  load: zDispatchDurationStats,
  invoice: zDispatchDurationStats.extend({
    pending: z.number().int(),
  }),
  // Tiempos globales de la hoja. `response` = envío → primer inicio de carga;
  // `loadWindow` = primer inicio → último cierre (solo despachar);
  // `dispatchCycle` = envío → último cierre; `invoiceWait` = cierre → factura.
  response: zDispatchDurationStats,
  loadWindow: zDispatchDurationStats,
  dispatchCycle: zDispatchDurationStats,
  totalCycle: zDispatchDurationStats,
  invoiceWait: zDispatchDurationStats,
  onTime: z.object({
    orders: z.number().int(),
    late: z.number().int(),
    pct: z.number().nullable(),
  }),
});
export type DispatchMetricsSummary = z.infer<typeof zDispatchMetricsSummary>;

export const zDispatchMetricsSeriesPoint = z.object({
  period: z.string(),
  label: z.string(),
  loadGroups: z.number().int(),
  loadAvgMinutes: z.number().nullable(),
  invoiceGroups: z.number().int(),
  invoiceAvgMinutes: z.number().nullable(),
  onTimePct: z.number().nullable(),
});
export type DispatchMetricsSeriesPoint = z.infer<typeof zDispatchMetricsSeriesPoint>;

export const zDispatchMetricsCustomer = z.object({
  customerCode: z.string().nullable(),
  customerName: z.string(),
  dispatches: z.number().int(),
  orders: z.number().int(),
  lines: z.number().int(),
  kg: z.number(),
  loadAvgMinutes: z.number().nullable(),
  loadMedianMinutes: z.number().nullable(),
  loadP90Minutes: z.number().nullable(),
  invoiceAvgMinutes: z.number().nullable(),
  invoiceMedianMinutes: z.number().nullable(),
  invoiceP90Minutes: z.number().nullable(),
  pendingInvoices: z.number().int(),
  onTimePct: z.number().nullable(),
  lastInvoiceAt: z.string().nullable(),
});
export type DispatchMetricsCustomer = z.infer<typeof zDispatchMetricsCustomer>;

export const zDispatchMetricsOrder = z.object({
  orderNumber: z.string(),
  dispatchId: z.string(),
  dispatchNumber: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string(),
  productCode: z.string(),
  description: z.string().nullable(),
  effectiveDate: z.string().nullable(),
  loadStartedAt: z.string().nullable(),
  loadClosedAt: z.string().nullable(),
  loadMinutes: z.number().nullable(),
  invoiceDeliveredAt: z.string().nullable(),
  invoiceMinutes: z.number().nullable(),
  onTime: z.boolean().nullable(),
  status: zDispatchLineStatus,
  kg: z.number(),
});
export type DispatchMetricsOrder = z.infer<typeof zDispatchMetricsOrder>;

export const zDispatchMetricsResponse = z.object({
  range: z.object({
    from: z.string(),
    to: z.string(),
    granularity: zDispatchMetricGranularity,
  }),
  summary: zDispatchMetricsSummary,
  series: z.array(zDispatchMetricsSeriesPoint),
  customers: z.array(zDispatchMetricsCustomer),
  orders: z.array(zDispatchMetricsOrder),
  generatedAt: z.string(),
});
export type DispatchMetricsResponse = z.infer<typeof zDispatchMetricsResponse>;

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
//   - Forecast MENSUAL por artículo: se lee de Profit
//     (`forecast.kg_mensual`), que viene en la presentación del artículo y se
//     normaliza a KILOGRAMOS (SAC × `uni_relac`; KG tal cual). Solo lectura.
//     `forecast.fecha` indica el mes de vigencia (primer día del mes).
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
  // Forecast mensual leído de Profit (`forecast.kg_mensual`), convertido a kg
  // según la presentación del artículo.
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
  // false = no se pudo leer `forecast`; la UI avisa y muestra 0.
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
  // Kg despachados en la semana según notas de entrega (0 si Profit no respondió).
  soldKg: z.number(),
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
  // Demanda del mes en kg (pedidos activos), para comparar con forecast y venta.
  demandMonthKg: z.number(),
  // Kg despachados en el mes según notas de entrega.
  soldMonthKg: z.number(),
  productionMonthQty: z.number(),
  productionMonthKg: z.number(),
  weeks: z.array(zForecastPlanWeek),
});
export type ForecastPlanRow = z.infer<typeof zForecastPlanRow>;

export const zForecastPlanResponse = z.object({
  year: z.number().int(),
  month: z.number().int(),
  weekRanges: z.array(zForecastWeekRange),
  // false si Profit no devolvió los despachos: la UI avisa y no pinta ceros falsos.
  salesAvailable: z.boolean(),
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
// Ventas del mes vs Forecast (run-rate).
//
//  · Fuente de venta: notas de entrega NO anuladas de Profit (`dbo.not_ent` +
//    `dbo.reng_nde` + `dbo.art`), solo línea `ABA`. En este Profit ambas tablas
//    usan `fact_num` como llave. Venta neta = venta bruta (no hay renglones
//    anulados ni negativos en `reng_nde`). NUNCA se escribe en Profit.
//  · Corte: se comparan días COMPLETOS (ayer). El día en curso se puede
//    incluir con `includeToday`, pero por defecto queda fuera para no hundir
//    la proyección con un despacho parcial.
//  · Días hábiles: lunes a sábado (el domingo casi no se despacha). El modo
//    `CALENDAR` existe para contrastar contra el calendario completo.
// ============================================================
export const FORECAST_SALES_BASES = ['WORKING', 'CALENDAR'] as const;
export const zForecastSalesBasis = z.enum(FORECAST_SALES_BASES);
export type ForecastSalesBasis = z.infer<typeof zForecastSalesBasis>;

export const FORECAST_SALES_STATUSES = ['OPEN', 'CLOSED', 'FUTURE'] as const;
export const zForecastSalesStatus = z.enum(FORECAST_SALES_STATUSES);
export type ForecastSalesStatus = z.infer<typeof zForecastSalesStatus>;

// De dónde salió la meta del mes del informe:
//   LIVE     = leída de `forecast` ahora mismo (mes en curso/futuro o cerrado
//              sin snapshot).
//   CAPTURED = mes en curso sin lectura viva disponible; se usa la captura local.
//   SNAPSHOT = mes cerrado con la meta guardada en `ForecastTarget`.
//   NONE     = no hay meta para ese mes.
export const FORECAST_SALES_SOURCES = ['LIVE', 'CAPTURED', 'SNAPSHOT', 'NONE'] as const;
export const zForecastSalesSource = z.enum(FORECAST_SALES_SOURCES);
export type ForecastSalesSource = z.infer<typeof zForecastSalesSource>;

// `?includeToday=false` llega como string: z.coerce.boolean() lo volvería
// `true` (cualquier cadena no vacía es truthy), por eso se normaliza a mano.
const zForecastSalesBool = z.preprocess(
  (value) => value === true || value === 'true' || value === '1' || value === 1,
  z.boolean(),
);

export const zForecastSalesQuery = z.object({
  // Sin año/mes se usa el mes en curso en America/Caracas.
  year: zYear.optional(),
  month: zMonth.optional(),
  // Ventana histórica para el promedio de comparación (meses cerrados).
  months: z.coerce.number().int().min(3).max(24).default(6),
  basis: zForecastSalesBasis.default('WORKING'),
  includeToday: zForecastSalesBool.default(false),
});
export type ForecastSalesQuery = z.infer<typeof zForecastSalesQuery>;

export const zForecastSalesDays = z.object({
  inMonth: z.number().int(),
  elapsed: z.number().int(),
  remaining: z.number().int(),
  workingInMonth: z.number().int(),
  workingElapsed: z.number().int(),
  workingRemaining: z.number().int(),
  // Hoy en la zona del negocio (America/Caracas), no la del servidor.
  today: z.string(),
  // Último día completo contado (null en un mes futuro).
  cut: z.string().nullable(),
});
export type ForecastSalesDays = z.infer<typeof zForecastSalesDays>;

// Desglose por artículo de un día con despachos (panel «Ventas del día»).
// La descripción y la UOM se resuelven con `rows` para no duplicarlas.
export const zForecastSalesDayProduct = z.object({
  productCode: z.string(),
  kg: z.number(),
  units: z.number(),
});
export type ForecastSalesDayProduct = z.infer<typeof zForecastSalesDayProduct>;

export const zForecastSalesDaily = z.object({
  date: z.string(),
  actualKg: z.number(),
  actualUnits: z.number(),
  invoiceCount: z.number().int(),
  // Artículos despachados ese día, ordenados por kg descendente.
  products: z.array(zForecastSalesDayProduct).default([]),
  // Null después del corte: la línea real no se dibuja a futuro.
  cumulativeKg: z.number().nullable(),
  // Proyección desde el corte hasta fin de mes (null antes del corte).
  projectedCumulativeKg: z.number().nullable(),
  // Ritmo uniforme del forecast (null sin meta).
  forecastCumulativeKg: z.number().nullable(),
});
export type ForecastSalesDaily = z.infer<typeof zForecastSalesDaily>;

export const zForecastSalesHistory = z.object({
  year: z.number().int(),
  month: z.number().int(),
  actualKg: z.number(),
  actualUnits: z.number(),
  // Meta histórica: snapshot congelado o, si no hay, la de `forecast`.
  forecastKg: z.number().nullable(),
});
export type ForecastSalesHistory = z.infer<typeof zForecastSalesHistory>;

export const zForecastSalesRow = z.object({
  productCode: z.string(),
  description: z.string(),
  uom: z.string(),
  kgPerUom: z.number().nullable(),
  // Meta que usa el informe: viva de `forecast` o capturada (mes cerrado).
  forecastKg: z.number(),
  // Meta guardada en `ForecastTarget` (histórico). Puede diferir de `forecastKg`
  // si Profit cambió la meta después de congelarla.
  forecastCapturedKg: z.number().nullable().default(null),
  // Meta leída de `forecast` cuando manda la lectura viva; null si el mes
  // cerrado conserva su snapshot congelado.
  forecastLiveKg: z.number().nullable().default(null),
  // Primera captura de la meta y detección de un cambio posterior.
  forecastCapturedAt: z.string().nullable().default(null),
  forecastDriftAt: z.string().nullable().default(null),
  actualKg: z.number(),
  actualUnits: z.number(),
  // Solo para artículos SAC (kg / kg por saco). Null en granel.
  actualSacks: z.number().nullable(),
  dailyAvgKg: z.number(),
  projectedKg: z.number().nullable(),
  attainmentPct: z.number().nullable(),
  projectedAttainmentPct: z.number().nullable(),
  gapKg: z.number().nullable(),
  requiredDailyKg: z.number().nullable(),
  historicalAvgKg: z.number().nullable(),
  vsHistoricalPct: z.number().nullable(),
  lastInvoiceDate: z.string().nullable(),
  history: z.array(zForecastSalesHistory),
});
export type ForecastSalesRow = z.infer<typeof zForecastSalesRow>;

export const zForecastSalesResponse = z.object({
  year: z.number().int(),
  month: z.number().int(),
  // Fecha de corte efectiva (yyyy-mm-dd) en America/Caracas.
  asOf: z.string().nullable(),
  basis: zForecastSalesBasis,
  status: zForecastSalesStatus,
  // false = Profit no respondió: la UI avisa, no muestra ceros como ventas.
  salesAvailable: z.boolean(),
  // false = no se pudo leer `forecast`.
  forecastAvailable: z.boolean(),
  // Origen de la meta: `forecast` en vivo, snapshot local o sin meta.
  forecastSource: zForecastSalesSource,
  days: zForecastSalesDays,
  totals: z.object({
    forecastKg: z.number(),
    actualKg: z.number(),
    actualUnits: z.number(),
    dailyAvgKg: z.number(),
    projectedKg: z.number().nullable(),
    attainmentPct: z.number().nullable(),
    projectedAttainmentPct: z.number().nullable(),
    gapKg: z.number().nullable(),
    requiredDailyKg: z.number().nullable(),
    historicalAvgKg: z.number().nullable(),
    vsHistoricalPct: z.number().nullable(),
    invoiceCount: z.number().int(),
    lastInvoiceDate: z.string().nullable(),
  }),
  daily: z.array(zForecastSalesDaily),
  history: z.array(zForecastSalesHistory),
  rows: z.array(zForecastSalesRow),
  generatedAt: z.string(),
});
export type ForecastSalesResponse = z.infer<typeof zForecastSalesResponse>;

// ============================================================
// Detalle de un día (`GET /forecast/sales/day`).
//
// Alimenta el modal «Desglose del día»: se pide solo al abrir un día concreto
// para no engordar el informe mensual con todas las combinaciones
// cliente × artículo. La venta es la misma fuente que `salesReport` (notas de
// entrega no anuladas, línea ABA), así los kg del modal cuadran con la barra.
// ============================================================

export const zForecastSalesDayQuery = z.object({
  // Día concreto en la zona del negocio (`yyyy-mm-dd`).
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato yyyy-mm-dd'),
});
export type ForecastSalesDayQuery = z.infer<typeof zForecastSalesDayQuery>;

// Producto comprado por un cliente dentro del día.
export const zForecastSalesDayCustomerProduct = z.object({
  productCode: z.string(),
  description: z.string(),
  uom: z.string(),
  // Kg de la presentación (uni_relac). Null en granel o sin relación.
  kgPerUom: z.number().nullable(),
  kg: z.number(),
  units: z.number(),
  // Solo para artículos SAC (kg / kg por saco). Null en granel.
  sacks: z.number().nullable(),
});
export type ForecastSalesDayCustomerProduct = z.infer<typeof zForecastSalesDayCustomerProduct>;

export const zForecastSalesDayCustomer = z.object({
  customerCode: z.string(),
  customerName: z.string(),
  kg: z.number(),
  units: z.number(),
  /** Participación del cliente en el total del día (% sobre kg). */
  sharePct: z.number().nullable(),
  products: z.array(zForecastSalesDayCustomerProduct),
});
export type ForecastSalesDayCustomer = z.infer<typeof zForecastSalesDayCustomer>;

export const zForecastSalesDayDetailProduct = z.object({
  productCode: z.string(),
  description: z.string(),
  uom: z.string(),
  kgPerUom: z.number().nullable(),
  kg: z.number(),
  units: z.number(),
  // Solo para artículos SAC (kg / kg por saco). Null en granel.
  sacks: z.number().nullable(),
  /** Participación del producto en el total del día (% sobre kg). */
  sharePct: z.number().nullable(),
});
export type ForecastSalesDayDetailProduct = z.infer<typeof zForecastSalesDayDetailProduct>;

export const zForecastSalesDayDetail = z.object({
  date: z.string(),
  // false = Profit no respondió: el modal avisa, no pinta ceros como ventas.
  available: z.boolean(),
  kg: z.number(),
  units: z.number(),
  products: z.array(zForecastSalesDayDetailProduct),
  customers: z.array(zForecastSalesDayCustomer),
  // true si Profit devolvió más filas que el límite de la consulta.
  truncated: z.boolean(),
  generatedAt: z.string(),
});
export type ForecastSalesDayDetail = z.infer<typeof zForecastSalesDayDetail>;

// ============================================================
// Vendedoras vs Forecast (módulo `/vendedoras`)
//
// La venta se atribuye al VENDEDOR DE LA NOTA (`not_ent.co_ven`), no al
// vendedor asignado al cliente. La meta de la empresa (la misma del informe
// «Ventas vs Forecast») se reparte entre las vendedoras según su
// participación histórica en los meses cerrados de la ventana consultada y,
// dentro de cada vendedora, entre sus clientes con la misma regla.
//
// Σ cuotas = 100 % y Σ metas por vendedora = meta de la empresa (el residuo
// de redondeo se ajusta en la vendedora/cliente de mayor peso). Sin histórico
// se usa un reparto igualitario marcado como `EQUAL_FALLBACK`; sin meta los
// porcentajes son `null`, nunca `Infinity`.
// ============================================================
export const FORECAST_SELLER_ALLOCATION_BASES = ['HISTORY', 'EQUAL_FALLBACK', 'NONE'] as const;
export const zForecastSellerAllocationBasis = z.enum(FORECAST_SELLER_ALLOCATION_BASES);
export type ForecastSellerAllocationBasis = z.infer<typeof zForecastSellerAllocationBasis>;

// Métricas de run-rate compartidas por vendedoras y clientes (mismo motor que
// el informe de ventas: corte a ayer y días hábiles lun–sáb).
const zForecastRunRateFields = {
  dailyAvgKg: z.number(),
  projectedKg: z.number().nullable(),
  attainmentPct: z.number().nullable(),
  projectedAttainmentPct: z.number().nullable(),
  gapKg: z.number().nullable(),
  requiredDailyKg: z.number().nullable(),
  historicalAvgKg: z.number().nullable(),
  vsHistoricalPct: z.number().nullable(),
};

export const zForecastSellerHistory = z.object({
  year: z.number().int(),
  month: z.number().int(),
  actualKg: z.number(),
});
export type ForecastSellerHistory = z.infer<typeof zForecastSellerHistory>;

export const zForecastSellerDaily = z.object({
  date: z.string(),
  actualKg: z.number(),
  invoiceCount: z.number().int(),
  // Null después del corte (la línea real no se dibuja a futuro).
  cumulativeKg: z.number().nullable(),
  projectedCumulativeKg: z.number().nullable(),
  // Ritmo uniforme de la cuota (null sin meta).
  forecastCumulativeKg: z.number().nullable(),
});
export type ForecastSellerDaily = z.infer<typeof zForecastSellerDaily>;

export const zForecastSellerClientRow = z.object({
  clientCode: z.string(),
  clientName: z.string(),
  customerType: z.string().nullable(),
  // Kg de los meses cerrados de la ventana: base de la cuota del cliente.
  historicalKg: z.number(),
  // % de la venta histórica de su vendedora (null si la vendedora no tiene base).
  shareOfSellerPct: z.number().nullable(),
  // % de la meta de la empresa que le toca a este cliente.
  quotaPct: z.number().nullable(),
  // Meta asignada al cliente = meta de la vendedora × shareOfSellerPct.
  targetKg: z.number(),
  actualKg: z.number(),
  actualUnits: z.number(),
  invoiceCount: z.number().int(),
  lastInvoiceDate: z.string().nullable(),
  // Cliente sin histórico que ya compró en el mes: suma venta, no tiene meta.
  isNew: z.boolean(),
  ...zForecastRunRateFields,
});
export type ForecastSellerClientRow = z.infer<typeof zForecastSellerClientRow>;

export const zForecastSellerRow = z.object({
  sellerCode: z.string(),
  sellerName: z.string(),
  clientCount: z.number().int(),
  activeClientCount: z.number().int(),
  invoiceCount: z.number().int(),
  // Kg históricos de la ventana (base de la cuota).
  historicalKg: z.number(),
  // % de la venta histórica de la empresa. Null si no hay histórico.
  sharePct: z.number().nullable(),
  // % de la venta DEL MES de la empresa (representación actual).
  currentSharePct: z.number().nullable(),
  // % de la meta de la empresa que le toca (la cuota que debe cumplir).
  quotaPct: z.number().nullable(),
  // Meta asignada (kg) = meta de la empresa × quotaPct.
  targetKg: z.number(),
  actualKg: z.number(),
  actualUnits: z.number(),
  lastInvoiceDate: z.string().nullable(),
  ...zForecastRunRateFields,
  history: z.array(zForecastSellerHistory),
  daily: z.array(zForecastSellerDaily),
  clients: z.array(zForecastSellerClientRow),
});
export type ForecastSellerRow = z.infer<typeof zForecastSellerRow>;

export const zForecastSellersResponse = z.object({
  year: z.number().int(),
  month: z.number().int(),
  asOf: z.string().nullable(),
  basis: zForecastSalesBasis,
  status: zForecastSalesStatus,
  // false = Profit no respondió: la UI avisa, no muestra ceros como ventas.
  salesAvailable: z.boolean(),
  forecastAvailable: z.boolean(),
  forecastSource: zForecastSalesSource,
  // Cómo se repartió la meta: histórico, igualitario de respaldo o sin meta.
  allocationBasis: zForecastSellerAllocationBasis,
  days: zForecastSalesDays,
  totals: z.object({
    forecastKg: z.number(),
    actualKg: z.number(),
    actualUnits: z.number(),
    ...zForecastRunRateFields,
    invoiceCount: z.number().int(),
    lastInvoiceDate: z.string().nullable(),
    sellerCount: z.number().int(),
    clientCount: z.number().int(),
  }),
  // Serie de la red completa (misma forma que el informe de ventas).
  daily: z.array(zForecastSalesDaily),
  sellers: z.array(zForecastSellerRow),
  generatedAt: z.string(),
});
export type ForecastSellersResponse = z.infer<typeof zForecastSellersResponse>;

// ============================================================
// Participación por cliente (`/forecast/sales/customers`).
//
// Sin histórico ni meta por cliente: la venta real de cada cliente se mide
// contra la venta total ABA del mes hasta el corte. Cada producto del cliente
// lleva dos porcentajes:
//  · shareOfCustomerPct: peso del producto dentro de la compra del cliente.
//  · shareOfProductPct: peso del cliente dentro de la venta total del producto.
// ============================================================

export const zForecastCustomerProductRow = z.object({
  productCode: z.string(),
  description: z.string(),
  uom: z.string(),
  kgPerUom: z.number().nullable(),
  /** Kg vendidos de este producto al cliente en el mes a la fecha. */
  kg: z.number(),
  units: z.number(),
  // Solo para artículos SAC (kg / kg por saco). Null en granel.
  sacks: z.number().nullable(),
  /** Peso del producto dentro de la compra total del cliente. */
  shareOfCustomerPct: z.number(),
  /** Peso del cliente dentro de la venta total de ese producto. */
  shareOfProductPct: z.number(),
});
export type ForecastCustomerProductRow = z.infer<typeof zForecastCustomerProductRow>;

export const zForecastCustomerSalesRow = z.object({
  customerCode: z.string(),
  customerName: z.string(),
  customerType: z.string().nullable(),
  vendor: z.string().nullable(),
  actualKg: z.number(),
  actualUnits: z.number(),
  /** % de la venta ABA del mes a la fecha que representa este cliente. */
  sharePct: z.number(),
  /** Productos con venta en el mes a la fecha. */
  productCount: z.number().int(),
  lastInvoiceDate: z.string().nullable(),
  products: z.array(zForecastCustomerProductRow),
});
export type ForecastCustomerSalesRow = z.infer<typeof zForecastCustomerSalesRow>;

export const zForecastCustomerSalesResponse = z.object({
  year: z.number().int(),
  month: z.number().int(),
  // Fecha de corte efectiva (yyyy-mm-dd) en America/Caracas.
  asOf: z.string().nullable(),
  status: zForecastSalesStatus,
  // false = Profit no respondió: la UI avisa, no muestra ceros como ventas.
  salesAvailable: z.boolean(),
  days: zForecastSalesDays,
  totals: z.object({
    actualKg: z.number(),
    actualUnits: z.number(),
    /** Clientes incluidos en la tabla (catálogo activo + clientes con venta). */
    customerCount: z.number().int(),
    /** Clientes con venta > 0. */
    activeCustomerCount: z.number().int(),
    /** Productos distintos con venta en el mes. */
    productCount: z.number().int(),
    lastInvoiceDate: z.string().nullable(),
  }),
  customers: z.array(zForecastCustomerSalesRow),
  // true si Profit devolvió más filas que el límite de la consulta.
  truncated: z.boolean(),
  generatedAt: z.string(),
});
export type ForecastCustomerSalesResponse = z.infer<typeof zForecastCustomerSalesResponse>;

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
  DISPATCH_LOAD_START: { module: 'dispatch', label: 'Inició la carga de un cliente', severity: 'INFO' },
  DISPATCH_LOAD_CLOSE: { module: 'dispatch', label: 'Cerró la carga de un cliente', severity: 'INFO' },
  DISPATCH_INVOICE: { module: 'dispatch', label: 'Registró una factura entregada', severity: 'INFO' },
  DISPATCH_REOPEN: { module: 'dispatch', label: 'Reabrió la carga o factura de un cliente', severity: 'WARN' },
  DISPATCH_COMPLETE: { module: 'dispatch', label: 'Cerró un despacho', severity: 'INFO' },
  DISPATCH_CANCEL: { module: 'dispatch', label: 'Anuló un despacho', severity: 'WARN' },
  DISPATCH_LINE_ANNUL: { module: 'dispatch', label: 'Anuló un renglón de un despacho', severity: 'WARN' },
  DISPATCH_AUTO_CANCEL: { module: 'dispatch', label: 'Anuló un despacho porque el plan quedó vacío', severity: 'WARN' },
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
  SCENARIO_LOCK: { module: 'scenarios', label: 'Tomó el control del plan global', severity: 'INFO' },
  SCENARIO_UNLOCK: { module: 'scenarios', label: 'Liberó el control del plan global', severity: 'INFO' },
  SCENARIO_TAKEOVER: { module: 'scenarios', label: 'Arrebató el control del plan global', severity: 'WARN' },
  SCENARIO_RELEASE: { module: 'scenarios', label: 'Liberó renglones de la simulación del equipo', severity: 'INFO' },
  ORDER_LIFECYCLE_CLOSE: { module: 'orders', label: 'Cerró un pedido por nota de entrega', severity: 'INFO' },
  ORDER_LIFECYCLE_CANCEL: { module: 'orders', label: 'Anuló un pedido desde Profit', severity: 'WARN' },
  ORDER_LIFECYCLE_REVIEW: { module: 'orders', label: 'Marcó un pedido para revisión', severity: 'WARN' },
  ORDER_REOPEN: { module: 'orders', label: 'Reabrió un pedido cerrado', severity: 'WARN' },
  ORDER_RECONCILE_RUN: { module: 'orders', label: 'Ejecutó la reconciliación de pedidos', severity: 'INFO' },
  FORECAST_SET_WEEKS: { module: 'forecast', label: 'Editó semanas del forecast', severity: 'INFO' },
  FORECAST_TARGET_ACCEPTED: {
    module: 'forecast',
    label: 'Aceptó un cambio de meta de Profit',
    severity: 'WARN',
  },
  DELIVERY_DATE_SET: { module: 'orders', label: 'Asignó fecha tentativa a pedidos', severity: 'INFO' },
  DELIVERY_DATE_RESTORE: { module: 'orders', label: 'Restauró la fecha tentativa', severity: 'INFO' },
  DB_MIRROR_RESTORE: { module: 'system', label: 'Restauró la base de datos desde main', severity: 'WARN' },
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

// ============================================================
// Espejo de la base de datos local (solo desarrollo).
//
// El worktree `pruebas` puede reemplazar su SQLite por una foto del worktree
// `main`. Es unidireccional: main manda y nunca se escribe al revés. El API
// solo expone estos endpoints cuando `DB_MIRROR_ENABLED=1` y NODE_ENV no es
// producción; el botón vive en Usuarios → Bitácoras.
// ============================================================

export const zDbMirrorInfo = z.object({
  path: z.string(),
  modifiedAt: z.string(),
  sizeBytes: z.number().int(),
  tables: z.number().int(),
});
export type DbMirrorInfo = z.infer<typeof zDbMirrorInfo>;

export const zDbMirrorCount = z.object({
  table: z.string(),
  source: z.number().int(),
  target: z.number().int(),
});
export type DbMirrorCount = z.infer<typeof zDbMirrorCount>;

export const zDbMirrorStatus = z.object({
  enabled: z.boolean(),
  source: zDbMirrorInfo,
  target: zDbMirrorInfo,
  schemaOk: z.boolean(),
  schemaIssues: z.array(z.string()),
  counts: z.array(zDbMirrorCount),
  busy: z.boolean(),
});
export type DbMirrorStatus = z.infer<typeof zDbMirrorStatus>;

export const zDbMirrorRestoreResult = z.object({
  ok: z.boolean(),
  tables: z.number().int(),
  rows: z.number().int(),
  sourceModifiedAt: z.string(),
  durationMs: z.number().int(),
});
export type DbMirrorRestoreResult = z.infer<typeof zDbMirrorRestoreResult>;
