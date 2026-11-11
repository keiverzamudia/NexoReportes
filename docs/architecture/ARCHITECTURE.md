# Arquitectura — Corpoagro

## Visión general

Monorepo TypeScript (pnpm workspaces + Turborepo) con tres aplicaciones y un paquete de contratos:

```
┌────────────┐   HTTPS/REST    ┌────────────┐   vistas SQL (solo SELECT)   ┌──────────────┐
│  apps/web  │ ──────────────▶ │  apps/api  │ ───────────────────────────▶ │ Profit SQL   │
│  Next.js   │   /api/* proxy  │  NestJS    │  adaptador mssql (read-only) │ Server       │
└────────────┘                 └─────┬──────┘                              └──────────────┘
                                     │ Prisma (SQLite dev / PostgreSQL prod)
                               ┌─────▼──────┐
                               │ Base interna│  usuarios, auditoría, catálogo
                               └─────┬──────┘  normalizado, escenarios, planes
                                     │
                               ┌─────▼──────┐
                               │ apps/worker │  sync periódica y reportes pesados
                               └─────────────┘
```

## Principios

1. **Profit es externo y de solo lectura.** Todas las consultas pasan por `ProfitAdapter` (`apps/api/src/modules/sync/profit.adapter.ts`). Prohibido INSERT/UPDATE/DELETE sobre Profit. El nombre de vista se valida contra una allowlist de identificadores y los valores viajan como parámetros.
2. **Configuración por variables de entorno.** Servidor, base, usuario y nombres de vistas de Profit son configurables (`PROFIT_DB_*`, `PROFIT_VIEW_*`); nada está hardcodeado.
3. **Simulación ≠ operación.** Los escenarios y asignaciones del simulador se guardan en la base interna como datos del escenario; nunca generan movimientos en Profit.
4. **Lógica de negocio en servicios de dominio**, no en controladores ni en el navegador. Los controladores solo validan y delegan.
5. **Contratos compartidos.** Los DTOs y enums viven en `packages/contracts` (Zod) y se consumen en api y web.
6. **Errores consistentes.** Todo error responde `{ statusCode, message, details?, correlationId }` vía `AllExceptionsFilter`; los detalles técnicos quedan en el log, no en la respuesta.
7. **Auditoría.** Acciones sensibles se registran en `AuditEvent` (inmutable desde operaciones ordinarias).

## Módulos de la API (evolución por fases)

| Módulo | Fase | Responsabilidad |
|---|---|---|
| `health` | 1 | Estado de BD y conexión Profit |
| `auth` / `users` | 1 | JWT (access+refresh con rotación), usuarios de Profit |
| `permissions` | 1 | RBAC dinámico: módulos × acciones, rol + excepciones por usuario |
| `roles` | 1 | CRUD de roles y su matriz de permisos |
| `audit` | 1 | Registro y consulta de eventos |
| `sync` | 1–2 | Adaptador Profit, descubrimiento de vistas, sincronización idempotente |
| `catalog` (productos, unidades, familias) | 3 | Catálogo normalizado |
| `inventory` | 3 | Existencias por almacén, reservas, disponibilidad neta |
| `orders` / `customers` | 4 | Pedidos y clientes normalizados |
| `availability` | 5 | Motor de disponibilidad y faltantes |
| `scenarios` | 6 | Simulador: plan global compartido (borrador único con lock) + escenarios guardados con nombre; versionado optimista |
| `dispatch` | 6 | Despacho de almacén: hoja de trabajo, acuses, bitácora y notificaciones |
| `arrivals` | 6c | Llegadas de clientes (PCP): se crean al publicar el despacho; hora de llegada, incidencias y correcciones con rastro |
| `orders` (lifecycle) | 6d | Cierre automático de pedidos por nota de entrega de Profit; panel de cierres solo ADMIN |
| `production` | 7 | Planes de producción, lotes, merma, capacidad |
| `reports` | 8 | Reportes modulares y exportación |

## Base de datos

- **Desarrollo:** SQLite (`apps/api/prisma/nexo.db`) — sin dependencias externas.
- **Producción:** PostgreSQL — cambiar `provider` en `schema.prisma` y `DATABASE_URL`.
- Portabilidad SQLite↔PostgreSQL: sin `enum` ni `Json` de Prisma (estados como `String` validados con Zod; contextos como JSON serializado).

### Simulador de despacho (Fase 6)

`DispatchDraft` guarda el **plan global** del equipo en una sola fila (`id =
GLOBAL`): receta, renglones seleccionados y guía de carga. El plan tiene un
**lock de edición** con TTL corto: solo el titular autoguarda; el resto ve la
última versión en modo lectura y puede «tomar control». La versión se controla
con `version` (409 si el cliente leyó una versión vieja).

`DispatchScenario` guarda **fotos con nombre** (receta + renglones + foto) para
volver a un plan anterior. Las ve todo el equipo; solo el creador o un ADMIN
puede renombrarlas, restaurarlas o borrarlas. Los borradores por usuario de la
versión anterior se migran una vez al arrancar: el más reciente se convierte en
el plan global y los demás se archivan como `SAVED` con el nombre
«Borrador de {usuario} (migrado)».

- **Receta** (`payload.recipe`): agrupación, modo, orden, filtros y renglones
  marcados como `pedido#artículo`. Al restaurar se vuelve a ejecutar el motor
  puro de despacho (`apps/web/lib/dispatch.ts`) con los datos de **hoy**.
- **Foto** (`payload.snapshot`): cantidades y totales del momento de guardar,
  usada solo para mostrar el diff «qué cambió» y el detalle congelado.

`dataVersion` es el fingerprint de las últimas syncs de `PEDIDOS` y
`EXISTENCIAS`: si cambia, la simulación se marca **desactualizada**. Cada
guardado/restauración/borrado deja traza en `AuditEvent`.

### Cierre de pedidos por nota de entrega (Fase 6d)

El sync trae las **cotizaciones pendientes** de Profit (`cotiz_c`). Cuando
Profit las convierte en nota de entrega, la cotización sale de esa vista y
`cotiz_c.status` pasa a `'2'`. `OrderLifecycleService` reconcilia los pedidos
abiertos contra Profit (solo `SELECT`) y aplica esta regla:

- `anulada = 1` → `CANCELADO`.
- `status = '2'` y pendiente total `0` → `NOTA_ENTREGA` +
  `billingStatus = FACTURADO_ASUMIDO`.
- `status = '2'` con pendiente `> 0` → **revisión** (no se cierra).
- `status 0/1` pero desapareció de la vista → **revisión** (no se cierra por
  ausencia sola).

Los pedidos cerrados se ocultan de la cartera (`isActive = false`) pero
conservan sus renglones y un `OrderLifecycleEvent` inmutable con la evidencia.
`OrderReconciliationRun` registra cada corrida. El panel «Cierres recientes»
es solo para ADMIN y permite reabrir con motivo. El scheduler corre cada
`ORDER_RECONCILE_SECONDS` (300 s por defecto) y `ORDER_RECONCILE_DRY_RUN=true`
calcula sin escribir. Al cerrar, se podan los renglones cerrados del plan
global si no está siendo editado.

### Despacho de almacén y túnel de acuses (Fase 6b)

Un **despacho** (`DispatchSheet`) nace de un escenario guardado y es la orden de
trabajo del almacén: renglones (`DispatchSheetLine`), bitácora
(`DispatchSheetEvent`) y notificaciones (`Notification`). Estados:
`ENVIADO → RECIBIDO → EN_PROCESO → { CON_NOVEDAD ⇄ EN_PROCESO } → DESPACHADO`,
con `CANCELADO` como salida lateral. La máquina de estados se valida en el
servicio (`apps/api/src/modules/dispatch/dispatch.service.ts`), no en el
controlador.

- **Acuses con sello temporal**: `sentAt`, `receivedAt`, `startedAt`,
  `completedAt`, `canceledAt`, cada uno con quién lo hizo (nombres
  desnormalizados: la bitácora es histórica y sobrevive a bajas de usuario).
- **Bandeja compartida**: si el despacho no se asigna a una persona, lo ve todo
  `ALMACEN` y el primero que lo abre lo reclama (`claimedById`); el resto lo ve
  pero no puede cargarlo.
- **Carga con diferencias**: el almacén digita la cantidad real en el input
  «Cargado» de cada renglón. Si iguala el plan queda `CARGADO`; si baja, se
  marca `PARCIAL` (X unidades; los kg se derivan del ratio de la unidad); si
  queda en 0, `FALTANTE` (no cargado). Parcial y no cargado exigen motivo, que
  se captura en un modal centrado y se guarda en la nota del renglón. Solo
  `PENDIENTE` bloquea el cierre: al cerrar se guardan los totales reales y la
  diferencia contra lo planificado. `NOVEDAD` queda como histórico de lectura.
- **Anulación de renglones (soft-delete)**: cuando un renglón pendiente sale
  del plan vivo (el usuario lo desmarca en Pedidos, Profit anula el pedido o lo
  cierra por nota de entrega), **no se borra**. Pasa a `ANULADO` con
  `removedAt`, `removedBy*`, `removalReason` y `removalSource`; no cuenta en
  totales, progreso ni tiempos. El detalle del despacho ya **no** muestra el
  listado de anulados: vive en la pantalla hermana **Retiros de simulación**
  (`/despacho/retiros`, permiso `despacho:view_removals`), que agrupa por pedido
  y muestra motivo, autor, fecha y despachos. Si la hoja se queda sin renglones
  activos, se anula automáticamente (`CANCELADO`, motivo «El plan quedó vacío»),
  se cancelan las llegadas PCP y se notifica a planificación y almacén. Si el
  renglón vuelve al plan, se reactiva en la misma fila (`PENDIENTE`) sin
  duplicar.
- **Vistas separadas de la bandeja**: `/despacho` queda solo con pendientes y
  publicados por mí. El **Historial** (`/despacho/historial`, permiso
  `despacho:view_history`) contiene hojas cerradas o anuladas, el resumen y el
  reporte de tiempos. **Retiros de simulación** (`/despacho/retiros`, permiso
  `despacho:view_removals`) contiene los renglones `ANULADO` agrupados por
  pedido. Ambos permisos se asignan desde la matriz de roles o por excepción de
  usuario; por defecto solo los tiene ADMIN. El API exige `despacho:read` +
  el permiso de la vista (403 si falta).
- **Tiempos por cliente** (`DispatchCustomerProgress`): «Iniciar carga» arranca
  los relojes del cliente sin marcar productos; cada producto se cierra con
  «Cerrar carga» y detiene su reloj; la factura se marca por cliente o con
  «Facturar todo». Definiciones:
  - **Respuesta** = envío (`sentAt`) → primer inicio de carga.
  - **Carga por cliente** = inicio de carga → último producto cerrado.
  - **Solo despacho (ventana)** = primer inicio → último cierre del despacho;
    no es suma ni promedio.
  - **Espera de factura** = cierre de carga → factura entregada.
  - **Tiempo total** = envío → última factura.
  El reporte agrupa por **día de cierre de carga** y el cumplimiento «a tiempo»
  se mide contra la fecha planificada al cerrar la carga (no al facturar).
  `DispatchSheetLine.checkedAt` conserva la hora de la **primera** resolución:
  editar una nota o cantidad no mueve el reloj; reabrir a `PENDIENTE` lo limpia.
  Las hojas históricas se backfillean con `startedAt`/`completedAt`; el tiempo
  de factura solo existe desde que se usa el hito. La factura la puede entregar
  cualquier operador de almacén con `despacho:update`, aunque otro haya tomado
  la hoja; la carga sigue siendo exclusiva del operador que la tomó.
- **Bitácora solo ADMIN**: el detalle entrega `events` únicamente al rol ADMIN;
  el resto sigue el avance por los relojes y el reporte de cierre. El drawer
  ordena la lectura en tres capas: **Actividad** (hitos y mensajes), **Clientes**
  (relojes y productos plegados) y **Detalles** (todos los eventos, filtros
  avanzados y CSV). Los cambios internos del plan no saturan la vista principal.
  Cada evento guarda un `meta` congelado (cliente, factura, duración y productos
  con pedido, código, nombre y cantidad), de modo que el renglón muestra el dato
  concreto en vez de repetir el título; los eventos históricos se resuelven con
  los renglones vigentes y, si no coinciden, caen al texto original.
- **Reporte «Tiempos»**: `GET /dispatch-sheets/metrics` agrega por cliente,
  día o mes, con promedios, medianas, P90, facturas pendientes y cumplimiento
  contra la fecha planificada. La pestaña «Tiempos» reutiliza ECharts y
  exporta a Excel. Exige `despacho:read` + `despacho:view_history` y respeta la
  visibilidad de `despacho:view_all`.
- **Notificaciones bidireccionales**: cada transición avisa a la contraparte
  (recibido/en proceso/cerrado/novedad al planificador; anulación y mensajes al
  almacén). El aislamiento es por dueño: un despacho ajeno responde 404.
- **Sin websockets**: el shell refresca la campana cada 15 s y el tablero cada
  20 s (TanStack Query) y anuncia por `aria-live`. SSE queda como mejora futura.
  Esos refrescos **no se pausan cuando la pestaña pierde el foco**
  (`refetchIntervalInBackground`), y el contador de no leídas viaja en el
  título de la pestaña: en planta el aviso no puede depender de mirar la campana.
- **Una sola corrida a la vez**: los dominios se encolan (nunca dos lecturas
  concurrentes de Profit: el pool devolvía `Connection is closed`) y cada uno
  arranca escalonado 5 s. Si una corrida falla, se reintenta una vez.
- **Sin operadores, no hay despacho**: publicar exige al menos un usuario
  activo con rol `ALMACEN` (409 con explicación y botón deshabilitado en el
  modal). Así el aviso nunca se pierde «en el vacío».
- **Nada escribe en Profit**: el despacho es una capa local de trabajo.

### Llegadas de clientes (PCP)

Los **registros de llegada** (`CustomerArrival`) no se crean a mano. Al
publicar un despacho, `DispatchService.create` agrupa sus renglones por cliente
y crea una llegada por cada uno **en el mismo `create` anidado**: o queda el
despacho con sus llegadas, o no queda nada. De ahí nacen también el correlativo
`LLG-AAAA-NNNN`, el total de sacos/kg y la fecha esperada (la entrega más
próxima del cliente en el plan).

- **Estados**: `ESPERADO → EN_PLANTA → { ATENDIDO | AUSENTE }`, con
  `CON_INCIDENCIA` mientras haya una incidencia abierta y `CANCELADO` si se
  anula el despacho antes de que el cliente llegue. Si ya había llegado, el
  registro se conserva como atendido.
- **La hora la sella el servidor** (`checkIn`): se guarda el instante y el
  usuario, no lo que diga el navegador. Marcar dos veces responde 409 con la
  hora y el nombre del primero.
- **Incidencias** (`ArrivalIncident`): tipo (`FALTANTE`, `DEMORA`, `DANO`,
  `DOCUMENTO`, `RECHAZO`, `OTRO`), severidad (`BAJA|MEDIA|ALTA`) y resolución
  escrita. Al resolver la última abierta, el cliente vuelve a `EN_PLANTA` o
  `ESPERADO` según tenga hora.
- **Bitácora inmutable** (`ArrivalEvent`): cada hito, incidencia, nota y
  corrección. Corregir un registro ya hecho exige `llegadas:delete` (jefe de
  PCP o administrador) y un **motivo**; el evento guarda el antes → después.
- **Permisos**: `llegadas:read` (ver), `create` (marcar llegada / reportar
  incidencia), `update` (resolver y cerrar), `delete` (corregir). Los permisos
  por defecto del módulo se siembran al arrancar para los roles que aún no los
  tengan (`PermissionsService.seedMissingModule`), sin resucitar los que un
  administrador haya quitado.
- **Quién se entera**: PCP recibe `LLEGADA_ESPERADA` al publicarse el despacho;
  el despacho recibe `LLEGADA_MARCADA` e `LLEGADA_INCIDENCIA` (campana del
  shell, refresco cada 15 s).
- **Nada escribe en Profit**: es la bitácora operativa de portería.

### Sincronización: cadencia y sostenibilidad

`SyncScheduler` (API) admite dos modos combinables, ambos **apagados por
defecto**:

- `SYNC_INTERVAL_SECONDS` → corrida completa cada N segundos (modo simple).
- `SYNC_SCHEDULE` → reloj **por dominio** (`EXISTENCIAS=120,PEDIDOS=300,…`),
  con piso de 60 s por dominio. Es la forma sostenible: lo volátil se refresca
  seguido y el catálogo (PRODUCTOS ≈ 17 s de lectura) solo unas veces al día.

Medido contra la vista real: una corrida completa lee ~130 renglones y tarda
~30 s, dominada por `PRODUCTOS` (17,6 s) y `PEDIDOS_DETALLE` (7,3 s). Cada
corrida de `EXISTENCIAS` crea una fotografía de inventario, por lo que
`SYNC_SNAPSHOT_RETENTION` (240 por defecto) poda las viejas y mantiene la base
plana. `GET /sync/status` expone la frescura por dominio (`lastRunAt`,
`ageSeconds`, `recordsRead`, `intervalSeconds`) y el shell muestra el dato más
viejo junto al botón «Sincronizar».

## Seguridad

- JWT access (15m) + refresh (7d) con rotación y revocación en BD.
- La contraseña se valida **siempre** en Profit (`MasterProfit.dbo.autenticar`); no hay contraseñas locales.
- Guards `JwtAuthGuard` + `PermissionsGuard` en todos los endpoints sensibles.
- CORS restringido a `CORS_ORIGINS`; helmet activo.
- Validación de entradas con Zod (pipe) y allowlist de identificadores SQL.
- Credenciales solo en variables de entorno (`.env` gitignoreado).

### Roles y permisos (RBAC dinámico)

El acceso se define con una matriz **módulo × acción** (`read`, `create`,
`update`, `delete`):

- `Role` = rol efectivo (`ADMIN`, `GERENCIA`… o uno creado desde Usuarios).
  Cada rol guarda una **plantilla** (`baseRole`) que conserva la semántica fina
  de Despacho (bandeja, reclamo y propiedad).
- `RolePermission` = acciones concedidas por el rol.
- `UserPermission` = excepción puntual del usuario (`allowed=true/false`) que
  gana sobre el rol. Permite «este usuario sí/este usuario no» sin duplicar
  roles.
- `ADMIN` es rol de sistema: siempre tiene todo, no se edita ni se borra. Un rol
  con usuarios asignados tampoco se puede eliminar.
- `PermissionsGuard` resuelve los permisos en cada petición: los cambios aplican
  sin cerrar sesión. `/auth/me` devuelve `permissions` para que el web filtre el
  menú y las acciones.
- Todos los cambios de rol/permisos quedan auditados (`ROLE_CREATED`,
  `ROLE_UPDATED`, `ROLE_DELETED`, `USER_PERMISSIONS_UPDATED`,
  `USER_PERMISSIONS_RESET`).

La matriz se administra en **Usuarios → pestaña Roles y permisos**; el botón
«Permisos» de cada fila gestiona las excepciones individuales.

## Identidad gráfica (Corpoagro)

La marca del producto es **Corpoagro · Nutrición Animal**. Los assets viven en
`apps/web/public/brand/` y son **vectores extraídos de la Guía de Identidad
Gráfica Corpoagro** (no capturas de pantalla).

| Archivo | Uso |
|---|---|
| `corpoagro-logo.svg` | Lockup completo (incluye la razón social): login y material |
| `corpoagro-logo-compacto.svg` | Sin la línea de razón social: navegación |
| `corpoagro-isotipo.svg` | Solo las hojas: iconos y espacios pequeños |
| `corpoagro-*-negativo.svg` | Sobre navy/negro (fondos oscuros, OG) |
| `corpoagro-*-mono.svg` | Una sola tinta (impresión, documentos) |
| `corpoagro-og.jpg` | Imagen OpenGraph 1200×630 |
| `icon.svg` · `apple-icon.png` · `favicon.ico` | Iconos de la app (isologo sobre navy) |

- **Colores oficiales**: navy `#003366` (principal) y lima `#95C800` (secundario).
  El lima **nunca** se usa como texto sobre blanco (contraste 1,9:1): solo como
  relleno, acento o sobre navy.
- **Tipografía**: **Asap** para toda la interfaz (`--font-sans`) y **Anton**
  únicamente en display (`--font-display`: título de página, cifras del hero y
  login). Ambas se cargan con `next/font/google` en `app/layout.tsx`.
- **El logo no se recrea con texto**: se usa el SVG oficial a través de
  `components/Logo.tsx`, con `size: 'full' | 'compact'` y
  `variant: 'color' | 'negative' | 'mono'`.

## Decisiones técnicas registradas (ADR resumido)

| Decisión | Motivo |
|---|---|
| NestJS 10 + Prisma 6 + `mssql` | Patrón ya probado en los proyectos Data-Maestra/Taller del ecosistema |
| SQLite en dev / PostgreSQL en prod | Requerimiento explícito del usuario; tipado portable desde el inicio |
| Adaptador con dialecto configurable (`mssql`/`fixtures`) | Permite desarrollar sin SQL Server sin presentar fixtures como datos reales |
| Sin Redis ni colas en Fase 1 | Volumen actual no lo justifica; se evalúa en Fase 2 midiendo la sync real |
