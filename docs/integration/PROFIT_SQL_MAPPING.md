# Mapeo SQL de Profit — vistas y campos

> **Estado: PENDIENTE DE CONFIRMACIÓN.** Las vistas reales de Profit aún no se han entregado.
> Este documento es el contrato de la capa de integración; cada fila se confirma al conectar
> y se implementa en la fase que corresponda. El sistema NO asume columnas ni relaciones:
> la capa `ProfitAdapter` es configurable (`PROFIT_VIEW_*`) y mientras tanto corre con fixtures.

## Configuración actual

| Parámetro | Valor (ejemplo) | Variable |
|---|---|---|
| Servidor | `SRVBDPROFITBK` | `PROFIT_DB_SERVER` |
| Base | `AD_TRANS` | `PROFIT_DB_DATABASE` |
| Usuario (solo lectura) | `solicitudweb` | `PROFIT_DB_USER` |
| Dialecto | `fixtures` (dev) / `mssql` | `PROFIT_DB_DIALECT` |
| Vista productos | *(sin confirmar)* | `PROFIT_VIEW_PRODUCTOS` |
| Vista clientes | *(sin confirmar)* | `PROFIT_VIEW_CLIENTES` |
| Vista pedidos | *(sin confirmar)* | `PROFIT_VIEW_PEDIDOS` |
| Vista detalle de pedidos | *(sin confirmar)* | `PROFIT_VIEW_PEDIDOS_DETALLE` |
| Vista existencias por almacén | *(sin confirmar)* | `PROFIT_VIEW_EXISTENCIAS` |
| Vista almacenes | *(sin confirmar)* | `PROFIT_VIEW_ALMACENES` |

## Tabla de mapeo (completar al confirmar vistas)

| Vista de origen | Campo de origen | Campo normalizado | Tipo | Regla de transformación | Validación | Manejo de nulos | Estado |
|---|---|---|---|---|---|---|---|
| `PROFIT_VIEW_PRODUCTOS` | *(pendiente)* | `Product.externalCode` | string | trim + mayúsculas | requerido, único | descartar registro | PENDIENTE |
| `PROFIT_VIEW_PRODUCTOS` | *(pendiente)* | `Product.description` | string | trim | requerido | descartar registro | PENDIENTE |
| `PROFIT_VIEW_PRODUCTOS` | *(pendiente)* | `Product.uom` | string | catálogo interno de unidades | requerido | descartar registro | PENDIENTE |
| `PROFIT_VIEW_PRODUCTOS` | *(pendiente)* | `Product.family` | string | catálogo de familias | opcional | `SIN_FAMILIA` | PENDIENTE |
| `PROFIT_VIEW_CLIENTES` | *(pendiente)* | `Customer.externalCode` | string | trim | requerido, único | descartar registro | PENDIENTE |
| `PROFIT_VIEW_CLIENTES` | *(pendiente)* | `Customer.name` | string | trim | requerido | descartar registro | PENDIENTE |
| `PROFIT_VIEW_PEDIDOS` | *(pendiente)* | `SalesOrder.externalNumber` | string | trim | requerido, único | descartar registro | PENDIENTE |
| `PROFIT_VIEW_PEDIDOS` | *(pendiente)* | `SalesOrder.orderDate` | date | conversión a fecha | fecha válida | descartar registro | PENDIENTE |
| `PROFIT_VIEW_PEDIDOS` | *(pendiente)* | `SalesOrder.requestedDate` | date | conversión a fecha | fecha válida | marcar `EN_RIESGO` | PENDIENTE |
| `PROFIT_VIEW_PEDIDOS` | *(pendiente)* | `SalesOrder.status` | enum interno | mapeo de estados Profit → `ABIERTO/CERRADO/CANCELADO` | requerido | descartar registro | PENDIENTE |
| `PROFIT_VIEW_PEDIDOS_DETALLE` | *(pendiente)* | `SalesOrderLine.quantity` | decimal(18,3) | conversión decimal, sin float | > 0 | descartar registro | PENDIENTE |
| `PROFIT_VIEW_PEDIDOS_DETALLE` | *(pendiente)* | `SalesOrderLine.pendingQty` | decimal(18,3) | cantidad solicitada − despachada | ≥ 0 | usar `quantity` | PENDIENTE |
| `PROFIT_VIEW_EXISTENCIAS` | *(pendiente)* | `InventorySnapshotLine.qty` | decimal(18,3) | existencia por almacén | ≥ 0 | descartar registro | PENDIENTE |
| `PROFIT_VIEW_EXISTENCIAS` | *(pendiente)* | `reservedQty` | decimal(18,3) | reservas/compromisos si la vista los expone | ≥ 0 | `0` con advertencia | PENDIENTE |
| `PROFIT_VIEW_ALMACENES` | *(pendiente)* | `Warehouse.externalCode` | string | trim | requerido, único | descartar registro | PENDIENTE |

## Preguntas abiertas para confirmar con el negocio/Profit

1. ¿Existe una vista de **existencias por almacén** con reservas/compromisos, o solo existencia física?
2. ¿Las vistas exponen **cantidad pendiente** directamente o hay que calcularla (solicitada − despachada)?
3. ¿Hay campos de **fecha de modificación** confiables para sincronización incremental? Si no, se usará lectura completa por períodos.
4. ¿Los pedidos cancelados aparecen con un estado distinguible?
5. ¿Hay información de **lotes/vencimientos** aplicable (FEFO)?

## Reglas del adaptador (implementadas)

- Usuario de SQL Server con permisos **solo de lectura**.
- Únicamente se emiten sentencias `SELECT` con parámetros; el nombre de la vista se valida contra `^[A-Za-z_][A-Za-z0-9_]*(\.[...]){0,2}$`.
- Timeouts configurables (`PROFIT_DB_REQUEST_TIMEOUT_MS`) y reintentos limitados (`PROFIT_DB_MAX_RETRIES`).
- Sin conexión a SQL Server el sistema sigue operativo en modo `fixtures`, **identificado explícitamente** en la UI y en `/api/health` como datos de desarrollo.
