# Sincronización con Profit

## Diseño

La sincronización es **idempotente**, **manual o programada** y **nunca escribe en Profit**.

```
POST /api/sync/run/:domain   (ADMIN, PLANIFICADOR)
GET  /api/sync/runs          (historial paginado)
GET  /api/sync/status        (última corrida exitosa + dominios pendientes)
GET  /api/sync/views         (descubrimiento de vistas, solo mssql)
POST /api/sync/test-connection
```

Dominios: `PRODUCTOS`, `CLIENTES`, `PEDIDOS`, `PEDIDOS_DETALLE`, `EXISTENCIAS`, `ALMACENES`.

Orden dependiente: `ALMACENES` y `PRODUCTOS` → `CLIENTES` → `PEDIDOS` → `PEDIDOS_DETALLE`; `EXISTENCIAS` requiere `PRODUCTOS` y `ALMACENES` para resolver ids (si faltan, se guarda el código externo y se completa en la siguiente corrida).

## Flujo por corrida

1. Se crea `SyncRun` (`EN_CURSO`) con la vista origen usada (`sourceRef`).
2. El adaptador lee la vista con `SELECT TOP (pageSize) *` — sin parámetros de negocio todavía.
3. Cada fila pasa por un **normalizador puro** (valida y transforma); las filas inválidas generan `SyncError` con la fila cruda (truncada) y la corrida continúa.
4. **Upsert por identificador externo** (`externalCode` / `externalNumber` / `orderId+lineNumber`): re-ejecutar la misma sincronización no duplica nada (Caso de aceptación 11, cubierto por pruebas).
5. **Bajas lógicas**: registros que existían y no aparecen en la corrida se marcan `isActive=false` + `removedAt` — nunca se borran. Solo aplica si la lectura devolvió filas (>0) para no dar de baja todo por una lectura vacía.
6. `EXISTENCIAS` crea **una** `InventorySnapshot` por corrida con sus `InventorySnapshotLine` (fotografía coherente; el historial de snapshots permite detectar antigüedad de datos).
7. La corrida finaliza como `EXITOSA` (0 errores), `PARCIAL` (algunos upserts con errores) u `ERROR`, y se registra un evento de auditoría con contadores.

## Estrategia de lectura

- **Sin detección de cambios incremental todavía**: Profit no expone (por ahora) un campo de modificación confiable, así que se usa **lectura completa por dominio** con límite configurable (`SYNC_PAGE_SIZE`).
- Si el volumen crece, la fase siguiente evaluará: filtro por fecha de pedido (`fecha_emision >= desde`), tablas de staging o comparación por hashes de fila.
- El worker (`apps/worker`) ejecutará la corrida periódica cuando `SYNC_INTERVAL_SECONDS > 0`; por defecto es manual vía API.

## Fallos y datos obsoletos (Caso de aceptación 8)

- Si una corrida falla, **los datos anteriores se conservan intactos** (no se borra nada por un fallo).
- `GET /api/sync/status` devuelve `lastSuccessfulRun`; la UI debe mostrar la antigüedad y marcar los datos como desactualizados si superan el umbral configurado.
- Nunca se muestran fixtures como datos reales: el campo `dialect` (`mssql`/`fixtures`) viaja en `/api/health` y `/api/sync/status`.

## Seguridad del adaptador

- Usuario SQL Server de **solo lectura** (recomendado: grant SELECT sobre las vistas requeridas y nada más).
- Solo se emiten `SELECT`; el identificador de vista se valida con allowlist de patrón y los valores viajan parametrizados.
- `PROFIT_DB_REQUEST_TIMEOUT_MS` (30s por defecto) y `PROFIT_DB_MAX_RETRIES` (2) limitan fallos largos.
- La conexión nunca se expone al navegador; el frontend solo habla con la API.

## Checklist al conectar Profit real

1. Confirmar los nombres de vista en `PROFIT_VIEW_*` (ver `PROFIT_SQL_MAPPING.md`).
2. Cambiar `PROFIT_DB_DIALECT=mssql` y completar credenciales (idealmente un usuario dedicado solo-SELECT).
3. `POST /api/sync/test-connection` y `GET /api/sync/views`.
4. Ejecutar los 6 dominios en orden y verificar contadores y `SyncError`.
5. Ajustar el mapeo de estados de pedido (`mapOrderStatus`) con los valores reales de Profit.
