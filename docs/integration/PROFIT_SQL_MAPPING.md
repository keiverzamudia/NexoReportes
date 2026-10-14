# Mapeo SQL de Profit — vistas y campos

> **Estado: columnas derivadas del reporte real "Solicitudes con sus renglones prod y logística
> (almacén)" de Profit Plus (CORPORACION AGROPECUARIA VENEZOLANA, C.A.).** El nombre exacto de la
> vista/tabla subyacente sigue pendiente de confirmación; por eso los nombres de vista son
> configurables (`PROFIT_VIEW_*`) y la capa `ProfitAdapter` es intercambiable.

## Negocio real (derivado del reporte PDF)

- **Empresa:** Corporación Agropecuaria Venezolana, C.A. — balanceados para animales (alfalfa, vaca lechera, gallina ponedora, cerdo, multiespecie...).
- **Unidad de medida:** `SAC` (sacos 10/35/40 kg); totales reportados en **KG** y **TON**.
- **Almacenes:** `Stock 68`, `Stock 03` (la línea del renglón lista ambos).
- **Tipos de cliente (prioridad comercial):** `L1 EXCLUSIVOS` > `COR CORPORATIVO` > `L2 DISTRIBUIDORES` > `L3 MINORISTA` *(orden confirmado por el usuario; COR entre L1 y L2 es un supuesto configurable)*.
- **Vendedor** por pedido; **Autorizado** (NO/SÍ) por pedido.
- El reporte de pendientes incluye **valores negativos** (p. ej. `-247.00`) que indican sobre-compromiso: la disponibilidad neta puede ser negativa y debe reflejarse, no recortarse a cero en el detalle.

## Columnas observadas en el reporte → contrato canónico

| Columna en el reporte | Contrato canónico (raw) | Notas |
|---|---|---|
| Número (6191, 6743...) | `numero` | clave del pedido |
| Emision (30/07/2026) | `fecha_emision` | dd/MM/yyyy |
| Código cliente (183334693025) | `cliente_codigo` | |
| Cliente (nombre) | `cliente_nombre` | |
| Vendedor | `vendedor` | |
| Entrega (04/08/2026) | `fecha_entrega` | fecha comprometida |
| Tipo de Cliente | `tipo_cliente` | L1/L2/L3/COR |
| Autorizado | `autorizado` | NO/SÍ |
| Alm. (Stock 68, Stock 03) | `almacenes` | almacenes que surten el renglón |
| Código producto (ABAEQUI01) | `codigo_producto` | |
| Cantidad (5.00) | `cantidad` | SAC |
| Unid. (SAC) | `unidad` | |
| Descripción | `descripcion` | |
| Columnas numéricas del renglón | `disponible` / `pendiente` | Confirmar semántica exacta con el negocio; los negativos indican sobre-compromiso |

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
