# Arquitectura — Nexo Producción

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
| `scenarios` | 6 | Simulador: escenarios por usuario (borrador + guardados con nombre), versionado optimista |
| `dispatch` | 6 | Despacho de almacén: hoja de trabajo, acuses, bitácora y notificaciones |
| `arrivals` | 6c | Llegadas de clientes (PCP): se crean al publicar el despacho; hora de llegada, incidencias y correcciones con rastro |
| `production` | 7 | Planes de producción, lotes, merma, capacidad |
| `reports` | 8 | Reportes modulares y exportación |

## Base de datos

- **Desarrollo:** SQLite (`apps/api/prisma/nexo.db`) — sin dependencias externas.
- **Producción:** PostgreSQL — cambiar `provider` en `schema.prisma` y `DATABASE_URL`.
- Portabilidad SQLite↔PostgreSQL: sin `enum` ni `Json` de Prisma (estados como `String` validados con Zod; contextos como JSON serializado).

### Simulador de despacho (Fase 6)

`DispatchScenario` guarda la simulación del usuario en dos capas, siempre local
(nunca escribe en Profit):

- **Receta** (`payload.recipe`): agrupación, modo, orden, filtros y renglones
  marcados como `pedido#artículo`. Al restaurar se vuelve a ejecutar el motor
  puro de despacho (`apps/web/lib/dispatch.ts`) con los datos de **hoy**.
- **Foto** (`payload.snapshot`): cantidades y totales del momento de guardar,
  usada solo para mostrar el diff «qué cambió» y el detalle congelado.

`kind = DRAFT` es el trabajo en curso (uno por usuario, `name = ''`, sin foto,
autoguardado con debounce); `kind = SAVED` son los guardados con nombre
(máx. 25). `dataVersion` es el fingerprint de las últimas syncs de `PEDIDOS` y
`EXISTENCIAS`: si cambia, la simulación se marca **desactualizada**. `version`
implementa el versionado optimista en renombrados y ediciones (409 si el
cliente leyó una versión vieja). Los escenarios son privados: un id ajeno
responde 404. `save`/`restore`/`delete` dejan traza en `AuditEvent`.

**Historial visible de restauraciones**: `DispatchScenarioRestore` guarda, por
cada restauración, el diff que el cliente calculó antes de confirmar (renglones
aplicados/omitidos, pendientes y existencias cambiadas, fechas, cartera y kg y
cobertura antes→después). El modal de Pedidos muestra «restaurada N veces» y el
detalle devuelve las últimas 20 entradas; borrar el escenario las elimina en
cascada.

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

## Decisiones técnicas registradas (ADR resumido)

| Decisión | Motivo |
|---|---|
| NestJS 10 + Prisma 6 + `mssql` | Patrón ya probado en los proyectos Data-Maestra/Taller del ecosistema |
| SQLite en dev / PostgreSQL en prod | Requerimiento explícito del usuario; tipado portable desde el inicio |
| Adaptador con dialecto configurable (`mssql`/`fixtures`) | Permite desarrollar sin SQL Server sin presentar fixtures como datos reales |
| Sin Redis ni colas en Fase 1 | Volumen actual no lo justifica; se evalúa en Fase 2 midiendo la sync real |
