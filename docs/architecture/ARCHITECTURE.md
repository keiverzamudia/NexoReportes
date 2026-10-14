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
| `auth` / `users` | 1 | JWT (access+refresh con rotación), RBAC |
| `audit` | 1 | Registro y consulta de eventos |
| `sync` | 1–2 | Adaptador Profit, descubrimiento de vistas, sincronización idempotente |
| `catalog` (productos, unidades, familias) | 3 | Catálogo normalizado |
| `inventory` | 3 | Existencias por almacén, reservas, disponibilidad neta |
| `orders` / `customers` | 4 | Pedidos y clientes normalizados |
| `availability` | 5 | Motor de disponibilidad y faltantes |
| `scenarios` | 6 | Simulador: selección de pedidos, asignaciones, versionado optimista |
| `production` | 7 | Planes de producción, lotes, merma, capacidad |
| `reports` | 8 | Reportes modulares y exportación |

## Base de datos

- **Desarrollo:** SQLite (`apps/api/prisma/nexo.db`) — sin dependencias externas.
- **Producción:** PostgreSQL — cambiar `provider` en `schema.prisma` y `DATABASE_URL`.
- Portabilidad SQLite↔PostgreSQL: sin `enum` ni `Json` de Prisma (estados como `String` validados con Zod; contextos como JSON serializado).

## Seguridad

- JWT access (15m) + refresh (7d) con rotación y revocación en BD.
- Contraseñas con bcrypt.
- Guards `JwtAuthGuard` + `RolesGuard` en todos los endpoints sensibles.
- CORS restringido a `CORS_ORIGINS`; helmet activo.
- Validación de entradas con Zod (pipe) y allowlist de identificadores SQL.
- Credenciales solo en variables de entorno (`.env` gitignoreado).

## Decisiones técnicas registradas (ADR resumido)

| Decisión | Motivo |
|---|---|
| NestJS 10 + Prisma 6 + `mssql` | Patrón ya probado en los proyectos Data-Maestra/Taller del ecosistema |
| SQLite en dev / PostgreSQL en prod | Requerimiento explícito del usuario; tipado portable desde el inicio |
| Adaptador con dialecto configurable (`mssql`/`fixtures`) | Permite desarrollar sin SQL Server sin presentar fixtures como datos reales |
| Sin Redis ni colas en Fase 1 | Volumen actual no lo justifica; se evalúa en Fase 2 midiendo la sync real |
