# Corpoagro — Gestión de producción

Sistema inteligente de planificación de producción alimenticia, inventarios, pedidos, simulación y reportes. Obtiene datos de **Profit Plus (SQL Server) mediante vistas SQL de solo lectura**, los normaliza en una base interna y permite responder: ¿qué pedidos se pueden cumplir?, ¿qué hay que producir? y ¿a quién atender primero?

> **Regla de oro:** ninguna simulación modifica Profit. El adaptador SQL Server es de solo lectura y las asignaciones del simulador viven únicamente en la base interna del sistema.

## Monorepo

```
apps/
  web/       Next.js (App Router) + Tailwind 4 + TanStack Query/Table + ECharts
  api/       NestJS + Prisma + JWT/RBAC + adaptador Profit (solo lectura)
  worker/    Sincronización periódica y trabajos pesados (Fase 2+)
packages/
  contracts/ Contratos Zod compartidos entre api, web y worker
```

## Requisitos

- Node.js >= 20 (probado con v24)
- pnpm >= 9 (probado con 11.24)
- SQL Server de Profit **solo** para la sincronización (en desarrollo se usan fixtures)

## Arranque rápido

```bash
pnpm install
cp .env.example apps/api/.env   # ajusta credenciales; por defecto PROFIT_DB_DIALECT=fixtures
pnpm db:generate
pnpm db:push
pnpm db:seed                    # crea admin@nexo.local
pnpm dev                        # api (4000) + web (4100)
```

- API: `http://localhost:4000/api` — Swagger en `/api/docs`
- Web: `http://localhost:4100`

Nota: si el puerto 4000 está ocupado por otro proyecto, usa `API_PORT=4010`. En esta máquina el 4000 está ocupado, por eso la API de desarrollo y la de `pnpm start` usan **4010** (configúralo en `apps/api/.env`).

### Producción (un solo comando)

```bash
pnpm build            # compila api + web
pnpm start            # levanta API (4010) y Web (4100) juntos vía Turbo
```

`pnpm start` compila primero (con caché de Turbo) y luego arranca ambos procesos en la misma terminal; `Ctrl+C` detiene los dos. Si quieres incluir también el worker, usa `npx turbo run start --parallel` (agrega `@nexo/worker`).

> No corras `pnpm build` mientras `pnpm dev` está activo: build y dev comparten la carpeta `.next` y se corrompen entre sí.

## Comandos útiles

| Comando | Descripción |
|---|---|
| `pnpm dev` | Desarrollo de todos los paquetes (api 4010 + web 4100) |
| `pnpm build` | Build de producción |
| `pnpm start` | Producción: build + API y Web juntos (Turbo) |
| `pnpm typecheck` | Verificación de tipos |
| `pnpm test` | Pruebas unitarias (Vitest) |
| `pnpm db:migrate` | Migraciones Prisma |
| `pnpm db:studio` | Prisma Studio |

## Roles y permisos

Roles iniciales: `ADMIN` · `GERENCIA` · `PLANIFICADOR` · `ALMACEN` · `CONSULTA`.
Sobre ellos se pueden **crear roles nuevos** y editar su matriz **módulo × acción**
(ver, crear, editar, eliminar) desde **Usuarios → Roles y permisos**. Cada usuario
hereda su rol y puede tener **excepciones individuales** (permitir/denegar una
acción concreta).

`ADMIN` es de sistema (siempre todo, no editable). El control se aplica **en el
servidor** (`PermissionsGuard`) y los cambios aplican sin cerrar sesión; el menú
del web se filtra con los permisos que devuelve `/auth/me`.

## Documentación

- [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) — arquitectura y módulos
- [docs/ROADMAP.md](docs/ROADMAP.md) — plan por fases
- [docs/integration/PROFIT_SQL_MAPPING.md](docs/integration/PROFIT_SQL_MAPPING.md) — mapeo de vistas Profit (pendiente de confirmación)
- Otras guías en `docs/`

- password farca NEXO-FORCA