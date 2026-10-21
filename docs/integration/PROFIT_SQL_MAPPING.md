# Mapeo SQL de Profit — vista y campos

> **Estado: CONFIRMADO.** La fuente de datos es la vista real
> **`COR_A3.dbo.Solicitudes_Pendientes_Clientes`** (SQL Server `SRVBDPROFITBK`,
> base **`COR_A3`** = Corp. Agropecuaria Venezolana), inspeccionada el 14/10/2026
> vía `INFORMATION_SCHEMA.COLUMNS` con el usuario de solo lectura `solicitudweb`.
> La vista está configurada con `PROFIT_VIEW_SOLICITUDES`.

## La vista: una fila = un RENGLÓN de solicitud

La vista es **plana**: cada fila trae el renglón de una solicitud pendiente con su
cliente, artículo, pendiente por despachar y las existencias del artículo en los dos
almacenes. El catálogo de productos, el de clientes, los encabezados de pedido y las
existencias se **derivan** de estas filas (no existen vistas separadas).

Estructura real (**13 columnas**, 61 filas — inspeccionada el 14/10/2026 vía
`GET /api/sync/describe` contra la vista viva):

| # | Columna | Tipo SQL Server | Nula | Uso en Nexo Producción |
|---|---|---|---|---|
| 1 | `nro_solicitud` | `int(10,0)` | NO | `SalesOrder.externalNumber` (clave del encabezado) |
| 2 | `emision` | `smalldatetime` | NO | `SalesOrder.orderDate` |
| 3 | `entrega` | `smalldatetime` | NO | `SalesOrder.requestedDate` (fecha comprometida) |
| 4 | `co_cli` | `char(10)` | NO | `Customer.externalCode` (trim del padding) |
| 5 | `cli_des` | `varchar(100)` | NO | `Customer.name` / `SalesOrder.customerName` |
| 6 | `co_art` | `char(30)` | NO | `Product.externalCode` (trim del padding) |
| 7 | `art_des` | `varchar(120)` | NO | `Product.description` / `SalesOrderLine.description` |
| 8 | `pendiente` | `decimal(18,5)` | NO | `SalesOrderLine.pendingQty` (conservar signo) |
| 9 | `uni_venta` | `char(6)` | NO | `Product.uom` / `SalesOrderLine.uom` — valores reales: **`SAC` y `KG`** |
| 10 | `relacion_empaque` | `decimal(??,?)` | NO | **kg por unidad de venta** (p. ej. 35 = saco de 35 kg) |
| 11 | `kg` | `decimal(??,?)` | NO | **kg totales del renglón** = `pendiente × relacion_empaque` (verificado: 217×35=7595) |
| 12 | `Stock_03` | `decimal(38,5)` | **SÍ** | `InventorySnapshotLine.qty` del almacén `Stock 03` |
| 13 | `Stock_9999` | `decimal(38,5)` | **SÍ** | `InventorySnapshotLine.qty` del almacén `Stock 9999` (columna calculada desde `st_almac.co_alma='9999'`, subalmacén TRANSLADO ENTRE ALMACENES) |
| 14 | `Stock_68` | `decimal(38,5)` | **SÍ** | `InventorySnapshotLine.qty` del almacén `Stock 68` |

> `relacion_empaque` y `kg` son la clave para reportar en **KG/TON** (el negocio reporta
> totales en KG y TON). Desde la **Fase 3** se persisten en `Product.kgPerUom` y
> `SalesOrderLine.pendingKg` (ver sección de reglas más abajo).

### Perfil de los datos reales (61 filas, 14/10/2026)

- 20 productos distintos, 27 clientes, 39 solicitudes.
- `pendiente`: mín 1, máx 30000, total 85559 (hoy sin negativos en las filas vivas; el
  signo se conserva igualmente porque el reporte histórico sí los tiene).
- `relacion_empaque`: 1..40; `kg`: 40..30000.
- `Stock_03`/`Stock_9999`/`Stock_68`: 0 nulos en esta extracción (el manejo `NULL = sin dato` se mantiene).
- Unidades: `SAC`, `KG`.

## Negocio real (derivado del reporte PDF y de la vista)

- **Empresa:** Corporación Agropecuaria Venezolana, C.A. — balanceados para animales (alfalfa, vaca lechera, gallina ponedora, cerdo, multiespecie...).
- **Unidad de medida:** `SAC` (sacos 10/35/40 kg); totales reportados en **KG** y **TON**.
- **Almacenes:** `Stock 03`, `Stock 9999`, `Stock 68` — en la vista/consulta son **columnas** (`Stock_03`, `Stock_9999`, `Stock_68`), no filas. `Stock_9999` corresponde al subalmacén `9999` de `st_almac` (TRANSLADO ENTRE ALMACENES) y suma a la existencia combinada.
- **Tipos de cliente (prioridad comercial):** `L1 EXCLUSIVOS` > `COR CORPORATIVO` > `L2 DISTRIBUIDORES` > `L3 MINORISTA` *(orden confirmado por el usuario; COR entre L1 y L2 es un supuesto configurable)*. Catálogo real: `COR, DET, L1, L2, L3, L4, L5, L6, MAY`. La **vista no trae el tipo de cliente**, pero la **consulta ampliada (solo lectura, 15/10/2026)** sí: `clientes.tipo` + `tipo_cli.des_tipo` → `Customer.customerType` / `SalesOrder.customerType` (p. ej. «L1 EXCLUSIVOS»).
- El reporte de pendientes incluye **valores negativos** (p. ej. `-247.00`) que indican sobre-compromiso: la disponibilidad neta puede ser negativa y debe reflejarse, no recortarse a cero en el detalle.

## Configuración actual

| Parámetro | Valor | Variable |
|---|---|---|
| Servidor | `SRVBDPROFITBK` | `PROFIT_DB_SERVER` |
| Base | **`COR_A3`** | `PROFIT_DB_DATABASE` |
| Usuario (solo lectura) | `solicitudweb` | `PROFIT_DB_USER` |
| Dialecto | `mssql` (dev real) / `fixtures` | `PROFIT_DB_DIALECT` |
| **Vista única de origen** | `dbo.Solicitudes_Pendientes_Clientes` | `PROFIT_VIEW_SOLICITUDES` |

## Derivación por dominio (todas las corridas leen la MISMA vista)

| Dominio de sync | Derivación desde las filas de la vista | Clave de upsert |
|---|---|---|
| `ALMACENES` | Una fila por columna de existencia (`Stock_03`→`Stock 03`, `Stock_9999`→`Stock 9999`, `Stock_68`→`Stock 68`) | `Warehouse.externalCode` |
| `PRODUCTOS` | Un producto por `co_art` distinto | `Product.externalCode` |
| `CLIENTES` | Un cliente por `co_cli` distinto | `Customer.externalCode` |
| `PEDIDOS` | Un encabezado por `nro_solicitud` distinto | `SalesOrder.externalNumber` |
| `PEDIDOS_DETALLE` | Una fila = un renglón; numerado de forma determinista (orden alfabético de `co_art` dentro de cada solicitud) | `SalesOrderLine(orderId, lineNumber)` |
| `EXISTENCIAS` | Una línea por (`co_art`, columna de stock no nula) dentro de una fotografía por corrida | `InventorySnapshotLine(snapshotId, …)` |

## Reglas de normalización (implementadas en `normalizers.ts`)

| Campo origen | Campo normalizado | Regla | Validación | Manejo de fallo | Estado |
|---|---|---|---|---|---|
| `nro_solicitud` | `SalesOrder.externalNumber` | `parseProfitDecimal` + `Math.trunc` | requerido, entero | **descartar fila** (error de sync) | IMPLEMENTADO |
| `emision` | `SalesOrder.orderDate` | `Date` de mssql directo | fecha válida | `null` (no se inventa) | IMPLEMENTADO |
| `entrega` | `SalesOrder.requestedDate` | `Date` de mssql directo | fecha válida | `null` (no se inventa) | IMPLEMENTADO |
| `co_cli` | `Customer.externalCode` | `trim` (padding de `char`) | requerido | **descartar fila** | IMPLEMENTADO |
| `cli_des` | `Customer.name` | `trim` | informativo | cadena vacía | IMPLEMENTADO |
| `co_art` | `Product.externalCode` | `trim` (padding de `char(30)`) | requerido | **descartar fila** | IMPLEMENTADO |
| `art_des` | `Product.description` | `trim` | informativo | cadena vacía | IMPLEMENTADO |
| `pendiente` | `SalesOrderLine.pendingQty` | `parseProfitDecimal` (acepta `'1,391.00'`) | requerido; **se conserva el signo** (negativo = sobre-compromiso) | **descartar fila** | IMPLEMENTADO |
| `uni_venta` | `Product.uom` | `trim` | informativo | cadena vacía | IMPLEMENTADO |
| `relacion_empaque` | `Product.kgPerUom` | `parseProfitDecimal` | anulable | no se persiste; **no se sobreescribe con `NULL`** si una corrida posterior lo trae vacío | IMPLEMENTADO (Fase 3) |
| `kg` | `SalesOrderLine.pendingKg` | `parseProfitDecimal` (valor crudo de Profit = `pendiente × relacion_empaque`) | anulable | `null` (no se recalcula) | IMPLEMENTADO (Fase 3) |
| `Stock_03` | `InventorySnapshotLine.qty` (`Stock 03`) | `parseProfitDecimal` | anulable | `null` → **no se crea línea** (no se inventa `0`) | IMPLEMENTADO |
| `Stock_9999` | `InventorySnapshotLine.qty` (`Stock 9999`) | `parseProfitDecimal` | anulable | `null` → no se crea línea | IMPLEMENTADO (21/10/2026) |
| `Stock_68` | `InventorySnapshotLine.qty` (`Stock 68`) | `parseProfitDecimal` | anulable | `null` → no se crea línea | IMPLEMENTADO |
| *(no expuesto)* | `Product.family` | — | — | `null` (la vista/consulta no lo trae) | NO DISPONIBLE |
| `clientes.tipo` + `tipo_cli.des_tipo` | `Customer.customerType` / `SalesOrder.customerType` | `RTRIM(tipo) + ' ' + RTRIM(des_tipo)` | anulable | conserva el valor previo si no llega | IMPLEMENTADO (15/10/2026) |
| `cotiz_c.co_ven` → `vendedor.ven_des` | `SalesOrder.vendor` | `trim` | anulable | `null` (no se inventa) | IMPLEMENTADO (15/10/2026) |
| `clientes.co_ven` → `vendedor.ven_des` | `Customer.vendor` | `trim` | anulable | conserva el valor previo si no llega | IMPLEMENTADO (19/10/2026) |
| `cotiz_c.status` | `SalesOrder.authorized` / `statusRaw` | `'1'` → `true`, `'0'`/`'2'` → `false`, ausente → `null` | anulable | `null` | IMPLEMENTADO (15/10/2026) |
| `reng_cac.total_art` | `SalesOrderLine.quantity` | `parseProfitDecimal` | anulable | `0` | IMPLEMENTADO (15/10/2026) |
| `reng_cac.co_alma` | `SalesOrderLine.warehouses` | `trim` | anulable | `null` | IMPLEMENTADO (15/10/2026) |
| *(no expuesto)* | `SalesOrder.status` | la fuente sólo contiene solicitudes **pendientes** → `ABIERTO` | supuesto documentado | `statusRaw = cotiz_c.status` | SUPUESTO |
| *(no expuesto)* | `InventorySnapshotLine.reservedQty` | la fuente no expone reservas | supuesto documentado | `0` | SUPUESTO |

## Preguntas abiertas para confirmar con el negocio/Profit

1. ¿La vista puede traer **tipo de cliente** y **vendedor** (columnas adicionales), o hay otra vista para el motor de prioridades?
2. ¿Hay columna de **estado/autorización** del pedido? Hoy se asume `ABIERTO` porque la vista sólo lista pendientes.
3. ¿Existe columna de **cantidad total original** del renglón (para distinguir `quantity` de `pendingQty`)?
4. ¿Las columnas `Stock_03`/`Stock_9999`/`Stock_68` son existencia física o ya incluyen reservas?
5. ¿Hay campos de **fecha de modificación** confiables para sincronización incremental? Si no, se usará lectura completa (61 filas hoy: no es un problema de volumen).

## Reglas del adaptador (implementadas)

- Usuario de SQL Server con permisos **solo de lectura**; únicamente `SELECT` parametrizados.
- El nombre de la vista se valida contra `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$` (bloquea inyección de identificadores).
- `describeView()` lee las columnas reales desde `INFORMATION_SCHEMA.COLUMNS` (nunca se asumen nombres/tipos).
- Timeouts configurables (`PROFIT_DB_REQUEST_TIMEOUT_MS`) y reintentos limitados (`PROFIT_DB_MAX_RETRIES`).
- Sin conexión a SQL Server el sistema sigue operativo en modo `fixtures`, **identificado explícitamente** en la UI y en `/api/health` como datos de desarrollo.

---

## Fuente ampliada (15/10/2026) — solo lectura, sin tocar Profit

Para traer los campos del reporte **«Solicitudes con sus renglones PROD y LOGÍSTICA (ALMACÉN)»**
que la vista no exponía, la app ejecuta una **consulta SELECT equivalente**
(constante `SOLICITUDES_SQL` en `sync.service.ts`, validada como solo lectura por el
adaptador). **No se crea ni se altera nada en Profit.**

Se leyó la definición real de la vista (`OBJECT_DEFINITION`) y resultó ser una
**cotización de cliente**: `cotiz_c` (encabezado) + `reng_cac` (renglones) +
`art` + `clientes` + `st_almac`, con `WHERE anulada = 0 AND status <> '2' AND pendiente > 0`.

```sql
SELECT
    f.fact_num AS nro_solicitud, f.fec_emis AS emision, f.fec_venc AS entrega,
    f.co_cli, cl.cli_des,
    v.ven_des AS vendedor,
    cv.ven_des AS vendedor_cliente,
    RTRIM(cl.tipo) + ' ' + RTRIM(tc.des_tipo) AS tipo_cliente,
    f.status AS status_cotizacion,
    r.co_art, a.art_des, r.co_alma AS almacen, r.total_art AS cantidad,
    r.pendiente, r.uni_venta, a.uni_relac AS relacion_empaque,
    r.pendiente * a.uni_relac AS kg,
    (SELECT ISNULL(SUM(sa.stock_act),0) FROM dbo.st_almac sa WHERE sa.co_art=r.co_art AND sa.co_alma='03')   AS Stock_03,
    (SELECT ISNULL(SUM(sa.stock_act),0) FROM dbo.st_almac sa WHERE sa.co_art=r.co_art AND sa.co_alma='9999') AS Stock_9999,
    (SELECT ISNULL(SUM(sa.stock_act),0) FROM dbo.st_almac sa WHERE sa.co_art=r.co_art AND sa.co_alma='6804') AS Stock_68
FROM      dbo.cotiz_c  f
JOIN      dbo.reng_cac r  ON r.fact_num = f.fact_num
JOIN      dbo.art      a  ON a.co_art   = r.co_art
JOIN      dbo.clientes cl ON cl.co_cli  = f.co_cli
LEFT JOIN dbo.vendedor v  ON v.co_ven   = f.co_ven
LEFT JOIN dbo.vendedor cv ON cv.co_ven  = cl.co_ven
LEFT JOIN dbo.tipo_cli tc ON tc.tip_cli = cl.tipo
WHERE f.anulada = 0 AND f.status <> '2' AND r.pendiente > 0;
```

**Garantías:**
- Solo `SELECT`; el adaptador rechaza cualquier consulta con `;` o palabras de escritura.
- Si una columna no llegara, el normalizador la deja en `null` (se muestra «—»); nunca rompe ni inventa.
- `object_definition` y el sondeo se hicieron con el usuario de solo lectura.

---

## Forecast mensual (23/10/2026) — `dbo.xart_fore`

El módulo **Forecast** ya no captura el mensual en Nexo: lo lee de Profit con una
consulta de solo lectura (`ForecastService`), sin conversión de unidades.

| Tabla | Columnas | Uso |
|---|---|---|
| `dbo.xart_fore` | `nom` (varchar 150), `kg_mes` (int), `kg_sem` (int) | Forecast por artículo: `kg_mes` se usa **tal cual** como cantidad mensual. `kg_sem` se ignora (las semanas se reparten en Nexo como `kg_mes / 4`). |
| `dbo.art` | `co_art`, `art_des`, `anulado` | Cruce por descripción: `RTRIM(art_des) = RTRIM(xart_fore.nom)`. |

```sql
SELECT RTRIM(a.co_art) AS co_art, f.kg_mes AS forecast_mes
FROM dbo.xart_fore AS f
INNER JOIN dbo.art AS a
        ON RTRIM(LTRIM(a.art_des)) = RTRIM(LTRIM(f.nom))
       AND a.anulado = 0
```

Notas:
- `xart_fore` no tiene `co_art` ni columna de mes: es una foto del **mes en
  curso**. Para cualquier otro mes el forecast se muestra en 0.
- Los 40 artículos de la tabla pertenecen a la línea `ABA`; los ABA sin fila en
  `xart_fore` quedan en 0.
- Si producción agrega artículos, la descripción debe coincidir con
  `art.art_des` (o, idealmente, agregar `co_art` a `xart_fore`).
- La suma de `kg_mes` (1.888.000 en octubre 2026) coincide con
  `dbo.xmeta_toneladas` de ese mes (1.888 t).
- En Nexo solo se persisten las cantidades por semana (`ForecastWeek`); nunca
  se escribe en Profit.

