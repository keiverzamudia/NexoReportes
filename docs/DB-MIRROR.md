# Espejo de la base de datos local (main → pruebas)

El worktree **`main`** es la fuente de verdad. El worktree **`pruebas`** puede
reemplazar su SQLite por una foto del main en cualquier momento, sin reiniciar
la API. El flujo es **unidireccional**: main manda y nunca se escribe al revés.

```
Reportes/            (rama main)     apps/api/prisma/nexo.db  ← ORIGEN
Reportes-pruebas/    (rama pruebas)  apps/api/prisma/nexo.db  ← DESTINO
```

## Cómo se activa

En el `.env` **del worktree pruebas** (`apps/api/.env`, no versionado):

```env
DB_MIRROR_ENABLED=1
```

Con eso:

- La API registra `GET /api/dev/db-mirror` y `POST /api/dev/db-mirror/restore`.
- Aparece la tarjeta **Base de datos local** en **Usuarios → Bitácoras**
  (pestaña visible solo para `ADMIN`).

Si el flag no está en `1`, el módulo **ni se registra** (las rutas devuelven 404)
y el botón no se muestra. Con `NODE_ENV=production` tampoco se registra.

## Uso

### Botón

**Usuarios → Bitácoras → Base de datos local → Restaurar desde main.**

El diálogo muestra la ruta y la fecha de la foto de main. Al confirmar:

1. Toma una foto consistente de la BD de main (aunque su API esté escribiendo).
2. Verifica que los esquemas coincidan (tabla y columnas, sin importar el orden).
3. Reemplaza las filas de la BD local en **una sola transacción**.
4. Registra el evento `DB_MIRROR_RESTORE` en la bitácora.
5. Recarga la página (la sesión también viene de main).

### Comando

```bash
pnpm db:mirror          # main → worktree actual
pnpm db:mirror:status   # compara esquema y filas, sin tocar nada
```

`db:mirror:status` muestra la ruta y fecha de cada BD y qué tablas tienen filas
distintas, útil antes de decidir si vale la pena restaurar.

## Garantías y límites

- **Atómico:** si algo falla a mitad del volcado, la BD local queda como estaba.
- **Sin reinicio:** Prisma ve los datos nuevos al instante.
- **Unidireccional:** el script se niega a correr desde el worktree `main`
  (válvula consciente: `DB_MIRROR_FORCE=1`).
- **Solo SQLite:** si `DATABASE_URL` apunta a PostgreSQL, aborta.
- **Verificación de esquema:** si main trae una tabla/columna que la BD local no
  tiene, aborta y pide `pnpm db:push` en lugar de dejar datos a medias.
- **Sin respaldo automático:** la restauración es destructiva por diseño. El
  volcado es transaccional, así que el riesgo es de datos de prueba, no de BD
  corrupta.
- **Concurrencia:** si hay una restauración en curso responde `409`; el volcado
  espera hasta 10 s a que se libere la BD.

## Efectos secundarios esperados

- Se pierden los datos de prueba locales (despachos, auditoría, usuarios…).
- Usuarios y sesiones pasan a ser los de main: si tu usuario de pruebas no
  existe allí, la app pedirá login tras la recarga.
- La API de main (su puerto, su proceso) no se toca en ningún momento.

## Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| El botón no aparece | `DB_MIRROR_ENABLED` no está en `1` en `apps/api/.env` o la API no se reinició. |
| `No encontré el worktree de la rama main` | El worktree main no existe o git no responde. Define `DB_MIRROR_SOURCE` con la ruta del `.db`. |
| `El esquema de main y el local no coinciden` | Corre `pnpm db:push` en el worktree atrasado y reintenta. |
| `409 Ya hay una restauración en curso` | Espera a que termine la anterior. |
| La ruta de origen es incorrecta | `DB_MIRROR_SOURCE=C:/ruta/Reportes/apps/api/prisma/nexo.db`. |

## Archivos

| Archivo | Rol |
|---|---|
| `apps/api/src/modules/db-mirror/db-mirror.core.ts` | Snapshot, verificación y volcado |
| `apps/api/src/modules/db-mirror/db-mirror.service.ts` | Lock, candados y bitácora |
| `apps/api/src/modules/db-mirror/db-mirror.controller.ts` | Endpoints dev-only |
| `apps/api/scripts/db-mirror.ts` | CLI (`pull` / `status`) |
| `apps/web/components/users/DbMirrorCard.tsx` | Tarjeta y confirmación en Bitácoras |
