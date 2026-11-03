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

## Forecast mensual (02/11/2026) — `dbo.forecast`

El módulo **Forecast** ya no captura el mensual en Nexo: lo lee de Profit con una
consulta de solo lectura (`ForecastService`). `kg_mensual` viene en la
**presentación del artículo** (sacos o kg) y el servicio lo normaliza a kg.

| Tabla | Columnas | Uso |
|---|---|---|
| `dbo.forecast` | `fecha` (datetime), `co_art` (char), `kg_mensual` (int), `kg_semanal` (int) | Forecast por artículo y **mes de vigencia**: `fecha` es el primer día del mes. `kg_mensual` viene en la presentación del artículo: **SAC × `uni_relac`** = kg; **KG se usa tal cual**. `kg_semanal` se ignora (las semanas se reparten en Nexo como kg mensual / 4). |
| `dbo.art` | `co_art`, `uni_venta`, `uni_relac` | Presentación del artículo y kg por unidad. Solo se usa `LEFT JOIN` para convertir a kg; no se cruza por descripción. |

```sql
SELECT
  RTRIM(f.co_art) AS co_art,
  f.kg_mensual AS forecast_mes,
  f.fecha,
  RTRIM(a.uni_venta) AS uni_venta,
  a.uni_relac
FROM dbo.forecast AS f
LEFT JOIN dbo.art AS a ON a.co_art = f.co_art
WHERE f.fecha >= @desde
  AND f.fecha < @hasta
```

Notas:
- `fecha` es el **mes de vigencia** del forecast. Con el rango
  `[@desde, @hasta)` se puede leer un mes suelto o varios meses de histórico en
  una sola consulta.
- **Conversión a kg**: si `art.uni_venta = 'SAC'`, `kg = kg_mensual × art.uni_relac`;
  si es `KG` (granel), `kg = kg_mensual`. Sin `uni_relac` no se inventa el factor
  y se deja el valor tal cual.
- `co_art` elimina el cruce por descripción que exigía la tabla anterior; el
  `JOIN dbo.art` ahora solo aporta la presentación.
- Los artículos ABA sin fila en `forecast` para el mes pedido quedan en 0.
- Si producción edita el valor durante el mes, el informe del mes en curso lo
  refleja en vivo; el histórico conserva el snapshot congelado
  (`ForecastTarget`) cuando existe.
- En Nexo solo se persisten las cantidades por semana (`ForecastWeek`); nunca
  se escribe en Profit.

---

## Estado de cuenta de clientes (22/10/2026) — `dbo.docum_cc` + `dbo.clientes`

El módulo **Clientes** abre el estado de cuenta de un cliente con la misma
información de la pantalla «Consulta Clientes» de Profit: documentos, fecha,
fecha de vencimiento, días vencidos, saldo y monto neto. La consulta es **en
vivo y de solo lectura**; no se sincroniza ni se escribe nada en Profit.

| Tabla / vista | Columnas usadas | Uso |
|---|---|---|
| `dbo.docum_cc` | `co_cli`, `tipo_doc`, `nro_doc`, `fec_emis`, `fec_venc`, `monto_net`, `saldo`, `tasa`, `anulado` | Documentos de cuentas por cobrar; origen de la fecha de vencimiento y de los montos. |
| `dbo.clientes` | `co_cli`, `cli_des`, `mont_cre` | Nombre y límite de crédito del cliente. |
| `dbo.Documentos_Pendientes` | — | **Referencia** de la conversión a USD (vista sobre `docum_cc`). No se consulta directamente porque no expone `fec_venc`. |

Definición real de la vista de referencia:

```sql
CREATE VIEW dbo.Documentos_Pendientes AS
SELECT cc.co_cli, c.cli_des, cc.tipo_doc, cc.nro_doc, cc.fec_emis,
       ROUND(cc.monto_net / cc.tasa, 2) *
         (CASE WHEN tipo_doc IN ('FACT','N/DB','AJPM','GIRO') THEN 1 ELSE -1 END) AS Neto_us,
       ROUND(cc.saldo / cc.tasa, 2) *
         (CASE WHEN tipo_doc IN ('FACT','N/DB','AJPM','GIRO') THEN 1 ELSE -1 END) AS Saldo_US
FROM dbo.docum_cc AS cc
INNER JOIN dbo.clientes AS c ON c.co_cli = cc.co_cli
WHERE cc.anulado = 0 AND cc.saldo > 0
```

Consulta del API (parámetros `@co_cli`, `@incluir_saldados`, `@moneda`):

```sql
SELECT TOP (1001)
  RTRIM(cc.co_cli) AS co_cli, RTRIM(c.cli_des) AS cli_des,
  c.mont_cre AS limite_credito,
  RTRIM(cc.tipo_doc) AS tipo_doc, cc.nro_doc, cc.fec_emis, cc.fec_venc,
  DATEDIFF(DAY, cc.fec_venc, GETDATE()) AS dias_venc,
  CASE WHEN @moneda = 'USD' THEN ROUND(cc.monto_net / NULLIF(cc.tasa, 0), 2)
       ELSE cc.monto_net END AS monto,
  CASE WHEN @moneda = 'USD' THEN ROUND(cc.saldo / NULLIF(cc.tasa, 0), 2)
       ELSE cc.saldo END AS saldo,
  CASE WHEN RTRIM(cc.tipo_doc) IN ('FACT','N/DB','AJPM','GIRO') THEN 1 ELSE -1 END AS signo,
  SYSUTCDATETIME() AS as_of
FROM dbo.docum_cc AS cc
INNER JOIN dbo.clientes AS c ON c.co_cli = cc.co_cli
WHERE RTRIM(cc.co_cli) = @co_cli
  AND cc.anulado = 0
  AND (@incluir_saldados = 1 OR cc.saldo > 0)
ORDER BY cc.fec_emis DESC, cc.tipo_doc, cc.nro_doc
```

Reglas y decisiones:

- **«Documentos pendientes»** (checkbox de Profit) se traduce en `saldo > 0`.
  Al desmarcarlo se incluyen los documentos saldados (`anulado = 0`).
- **«Otra moneda»**: USD reproduce la fórmula de la vista; Bs usa los montos
  originales de `docum_cc` (`monto_net` / `saldo`).
- Los documentos que no son `FACT`, `N/DB`, `AJPM` o `GIRO` (por ejemplo
  `ADEL` y `N/CR`) son **créditos**: restan del saldo total. En la tabla se
  muestran en positivo, como en Profit, con un badge de crédito.
- **No se usa `clientes.saldo`**: en la base real puede quedar en `0` aunque
  haya facturas pendientes (verificado con el cliente `501950695`, 58.673,74
  USD pendientes). El saldo del estado de cuenta se calcula sumando los
  documentos listados.
- Los días vencidos se calculan con `DATEDIFF(DAY, fec_venc, GETDATE())` para
  usar el mismo calendario que Profit. `as_of` usa `SYSUTCDATETIME()` para que
  el navegador muestre la hora local correcta.
- Se limita a **1000 documentos** (se consultan 1001 para detectar el
  recorte); el modal avisa cuando la lista viene truncada.
- **Límite de crédito**: se lee `dbo.clientes.mont_cre` en la misma consulta
  del estado de cuenta (`limite_credito`). El modal lo muestra junto al saldo y
  calcula el disponible como `mont_cre − saldo` (un saldo a favor lo aumenta).
  No se usa `clientes.saldo`.
- El código del cliente viaja como parámetro `@co_cli`; nunca se interpola
  SQL del usuario. El adaptador solo acepta un `SELECT` de lectura.

Endpoints (permiso `clientes:read`):

- `GET /api/customers/:code/statement?incluirSaldados=&moneda=USD|BS` — detalle.
- `GET /api/customers/statements?codes=A,B,C&moneda=USD` — resumen para la
  cartera de Pedidos (saldo, vencido, créditos y `mont_cre` por cliente). Usa
  un solo agregado con `IN (@co_cli_0, @co_cli_1, …)` y `LEFT JOIN` desde
  `dbo.clientes` para devolver también a los clientes sin documentos. Tope:
  200 clientes por consulta.

## Ventas del mes vs Forecast (`GET /api/forecast/sales`)

Verificado contra `COR_A3` (octubre 2026). La venta se mide por **nota de
entrega** (despacho), no por factura: el encabezado es **`dbo.not_ent`** y los
renglones **`dbo.reng_nde`**. En este Profit ambas tablas usan **`fact_num`**
como llave del documento (no existe `not_num`), por eso el JOIN es
`r.fact_num = f.fact_num`. Ambas consultas son `SELECT` de solo lectura,
parametrizadas con `@desde` y `@hasta` (rango semiabierto).

### Reglas de negocio

- **Venta** = nota de entrega emitida y **no anulada** (`not_ent.anulada = 0`),
  línea **ABA** (`art.co_lin = 'ABA'`) y artículo no anulado.
- **Sin devoluciones ABA**: en 2026 `reng_nde` no tiene renglones anulados ni
  cantidades negativas (0 de 6.036 líneas); venta neta = venta bruta.
- **Notas vs facturas**: las notas van ~1–2 % por encima de lo facturado,
  porque incluyen despachos aún no facturados. Es la cifra que se reporta.
- **`forecast.kg_mensual` se normaliza a KILOGRAMOS**: los artículos SAC se
  multiplican por `art.uni_relac` y el granel se deja tal cual. La UI muestra
  kg/t en los totales y añade **sacos** (`kg / art.uni_relac`) solo en artículos
  `SAC`.
- **Corte a ayer**: el día en curso está incompleto y se excluye del promedio
  (opción `includeToday=true` para contrastar). **Días hábiles = lun–sáb**; el
  domingo casi no se despacha. `basis=CALENDAR` usa días corridos.
- **Zona horaria** `America/Caracas` calculada con `Intl` en el servidor, no
  con la hora del proceso (un contenedor en UTC cambiaría de día a las 20:00).
- Sin forecast para el mes la venta se muestra igual, pero los porcentajes
  quedan en `null` («sin meta»), nunca `Infinity`. Si Profit falla, el API
  responde `salesAvailable: false` y la UI NO pinta ceros.

### Volumen por renglón (mes del informe)

```sql
SELECT
  YEAR(f.fec_emis) AS anio,
  MONTH(f.fec_emis) AS mes,
  RTRIM(r.co_art) AS co_art,
  RTRIM(a.art_des) AS art_des,
  RTRIM(a.uni_venta) AS uni_venta,
  a.uni_relac AS uni_relac,
  SUM(r.total_art) AS unid,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  MAX(f.fec_emis) AS ultima_factura
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY YEAR(f.fec_emis), MONTH(f.fec_emis), RTRIM(r.co_art), RTRIM(a.art_des), RTRIM(a.uni_venta), a.uni_relac
```

La misma consulta cubre el **histórico** (meses cerrados para el promedio) y el
mes del informe: `@desde` arranca N meses atrás y `@hasta` es el corte.

### Serie diaria del mes

```sql
SELECT
  CAST(f.fec_emis AS date) AS fecha,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  SUM(r.total_art) AS unid,
  COUNT(DISTINCT f.fact_num) AS facturas
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY CAST(f.fec_emis AS date)
```

### Fórmulas del run-rate

```text
díasHábilesCorte   = lun–sáb desde el día 1 hasta ayer
promedioDiarioKg   = ventaAcumKg / max(1, díasHábilesCorte)
proyeccionKg       = promedioDiarioKg × díasHábilesMes
cumplimientoPct    = ventaAcumKg / forecastKg × 100        (null si forecast = 0)
cumplimientoProy   = proyeccionKg / forecastKg × 100       (null si forecast = 0)
ritmoNecesarioKgD  = max(0, forecastKg − ventaAcumKg) / max(1, díasHábilesRestantes)
vsHistóricoPct     = proyeccionKg / promedioHistóricoKg × 100 − 100
```

Contrato: `ForecastSalesResponse` en `packages/contracts` (`zForecastSalesQuery`,
`zForecastSalesRow`, `zForecastSalesResponse`). Parámetros:
`year`, `month`, `months` (3–24, default 6), `basis` (`WORKING` | `CALENDAR`) e
`includeToday` (default `false`). Requiere permiso `forecast:read`.

> En modo `PROFIT_DB_DIALECT=fixtures` el adaptador genera 18 meses de ventas
> deterministas de lunes a sábado, para probar la pantalla sin Profit.

### Meta histórica: snapshot mensual (`ForecastTarget`)

`forecast` identifica el mes con `fecha`, pero producción puede editar la meta
después de cargarla. Para que el histórico no cambie, Nexo guarda el valor
oficial mientras el mes está vigente en la tabla local `ForecastTarget`
(`apps/api/prisma/schema.prisma`):

| Columna | Uso |
|---|---|
| `year`, `month` | Mes al que pertenece la meta. |
| `productCode` | Código del artículo (`forecast.co_art`). |
| `targetKg` | `forecast.kg_mensual` normalizado a **kilogramos** (SAC × `uni_relac`). Valor oficial que se conserva. |
| `firstCapturedAt` | Primera captura del mes; ancla la ventana de gracia. |
| `frozenAt` | Momento en que la meta quedó congelada. |
| `lastSeenKg`, `lastSeenAt` | Última lectura viva de Profit (para detectar diferencias). |
| `driftDetectedAt` | Cambio detectado después de congelar; **no** modifica `targetKg`. |
| `capturedAt` | Última escritura oficial del target (creación, corrección o aceptación). |

- **Captura**: por un reloj del módulo
  (`FORECAST_TARGET_INTERVAL_MINUTES`, por defecto 60; `0` lo desactiva). Solo
  escribe en la BD local: **nunca** en Profit.
- **Regla de negocio**: la meta se coloca una sola vez al mes en Profit. La
  primera lectura crea el snapshot; durante `FORECAST_TARGET_GRACE_HOURS`
  (72 por defecto) se puede corregir ante una carga tardía; después queda
  congelado.
- **Cambio posterior en Profit**: si el valor vivo difiere del congelado, se
  guarda `lastSeenKg`/`driftDetectedAt` y la UI avisa. La meta histórica no se
  pisa sola; un usuario con `forecast:update` puede aceptar el cambio con
  `POST /api/forecast/targets/:code/accept?year=YYYY&month=MM` (queda en la
  bitácora).
- **Forzar captura**: `POST /api/forecast/sales/capture` (permiso
  `forecast:update`).
- **Lectura**: se pide `forecast` por el mes de `fecha`. El mes en curso (y un
  mes futuro) usa la lectura viva (`forecastSource=LIVE`). Un mes cerrado usa
  su snapshot congelado (`SNAPSHOT`); si no existe, también cae a `forecast`
  (`LIVE`). En el mes en curso, si Profit no responde, cae a la captura local
  (`CAPTURED`). Sin meta en ninguno de los dos, `forecastSource=NONE` y el
  cumplimiento queda en `null` («sin meta»), sin tratarlo como error de Profit.
- El histórico de la respuesta (`history[].forecastKg`) usa el snapshot si
  existe y, si no, la meta de `forecast` para ese mes, para poder comparar cada
  mes contra su propia meta.
- La UI dibuja una línea punteada con la meta de cada mes en el gráfico de foco
  del producto.
- El catálogo de la tabla es **todo** `Product` con `isProduction=true` e
  `isActive=true`, aunque no tenga meta ni venta; la UI ofrece el filtro «Solo
  con datos».

---

## Ventas por cliente en la cartera (02/11/2026) — `dbo.not_ent` + `dbo.reng_nde`

El módulo **Clientes** filtra la cartera por actividad de ventas. La fuente es
la misma que usa Forecast: notas de entrega (no facturas). La consulta es en
vivo y de solo lectura, con caché en memoria de 5 minutos por periodo.

| Tabla | Columnas usadas | Uso |
|---|---|---|
| `dbo.not_ent` | `fact_num`, `fec_emis`, `co_cli`, `anulada` | Encabezado de la nota de entrega. |
| `dbo.reng_nde` | `fact_num`, `co_art`, `total_art` | Renglones (unidades vendidas). |
| `dbo.art` | `co_art`, `uni_venta`, `uni_relac`, `anulado`, `co_lin` | Unidad de venta y kg por unidad. |
| `dbo.clientes` | `co_cli`, `cli_des`, `tipo`, `co_ven` | Catálogo completo (metadata de clientes sin pedido). |

Consulta (`CustomerSalesService`, marcador `nexo:customer_sales`):

```sql
SELECT RTRIM(f.co_cli) AS co_cli,
       SUM(CASE WHEN RTRIM(ISNULL(a.uni_venta, '')) = 'SAC' THEN r.total_art ELSE 0 END) AS sacos,
       SUM(CASE WHEN RTRIM(ISNULL(a.uni_venta, '')) <> 'SAC' THEN r.total_art * ISNULL(a.uni_relac, 1) ELSE 0 END) AS kg,
       SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg_total,
       COUNT(DISTINCT f.fact_num) AS notas,
       MAX(f.fec_emis) AS ultima
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY RTRIM(f.co_cli)
```

- **La unidad manda**: los renglones `SAC` se reportan en **sacos**; el resto
  (`KG` u otras) en **kg**. `kg_total` solo se usa para ordenar y agregar.
- **Periodos**: `mes` (día 1 → mañana), `3m`, `6m` y `12m` (mes actual + N−1
  anteriores). `todos` usa 12 meses como universo de actividad.
- **Universo visible**: clientes con pedido activo **o** venta en los últimos
  12 meses. El catálogo completo se sincroniza para conservar nombre, tipo y
  vendedor de los clientes sin pedido (marcador `nexo:customer_catalog`).
- **Contrato**: `GET /api/customers?salesPeriod=mes|3m|6m|12m|todos&onlyWithOrders=true`
  (`zCustomerQuery`, `zCustomerListResponse`). Permiso `clientes:read`.
- **Degradación**: si Profit no responde, `salesAvailable=false`; la lista
  conserva la cartera de pedidos y las ventas van en `null` (nunca ceros
  inventados).
- **Fixtures**: `nexo:customer_catalog` (clientes sin pedido) y
  `nexo:customer_sales` (ventas deterministas SAC/KG por cliente).

---

## Ficha 360 de clientes (03/11/2026) — `GET /api/customers/:code/insights`

El módulo **Clientes** abre un informe por cliente con volumen, facturación,
productos perdidos, surtido del segmento y diagnóstico comercial. Permiso
`clientes:read`; ventana `months=12|24|36` (default 24) y moneda `USD|BS`.

### Fuentes

| Tabla | Columnas usadas | Uso |
|---|---|---|
| `dbo.not_ent` | `fact_num`, `fec_emis`, `co_cli`, `anulada` | Encabezado de la nota de entrega. |
| `dbo.reng_nde` | `fact_num`, `co_art`, `total_art` | Renglones (sacos/unidades y kg). |
| `dbo.art` | `co_art`, `art_des`, `uni_venta`, `uni_relac`, `anulado`, `co_lin` | Descripción, unidad y kg por unidad. |
| `dbo.docum_cc` | `co_cli`, `tipo_doc`, `nro_doc`, `fec_emis`, `monto_net`, `tasa`, `anulado` | Facturación neta. |
| `dbo.clientes` | `co_cli`, `tipo` | Segmento para el surtido comparable. |
| `dbo.tipo_cli` | `tip_cli`, `des_tipo` | Descripción del segmento (`L1 EXCLUSIVOS`, …). |

### Consultas (marcadores)

- `nexo:customer_insights_products`: volumen por cliente, mes, nota y artículo.
  Misma regla que Ventas: nota no anulada, artículo vigente y línea `ABA`.
- `nexo:customer_insights_billing`: facturación mensual
  `FACT + N/DB − N/CR`; en USD divide `monto_net` por `tasa` con `NULLIF`.
  Los documentos sin tasa se cuentan en `sin_tasa` y marcan `billingPartial`.
- `nexo:customer_insights_similar`: productos que compran clientes del mismo
  segmento (`RTRIM(clientes.tipo) + ' ' + RTRIM(tipo_cli.des_tipo)`) en los
  últimos 12 meses. El servicio excluye los que el cliente ya compró en el
  histórico consultado.

### Reglas de negocio

- **Sacos** = renglones `SAC`; **toneladas** = kg totales / 1000.
- **Facturado** = documentos de venta netos (`FACT` + `N/DB` − `N/CR`), no
  incluye adelantos ni ajustes de cartera.
- **Ventana actual** = 12 meses móviles; **anteriores** = los 12 previos
  (solo con `months >= 24`).
- **Producto perdido** = 0 t en la ventana actual y > 0 t en la anterior;
  se listan solo los que superan 1 t para no generar ruido.
- **Estado del producto**: `NUEVO` (sin base anterior), `CRECIENDO` (+30 % o
  más), `ESTABLE`, `CAYENDO` (−30 % o más) y `PERDIDO`.
- **Segmento de compra**: `ACTIVO`, `EN_RIESGO` (días sin comprar >
  `max(60, 2 × cadencia)`), `INACTIVO` (sin compras en 12 meses) o `SIN_DATOS`.
- **Concentración**: el producto principal ≥ 60 % del volumen actual.
- **Cobranza**: saldo vencido > 0 o límite de crédito usado ≥ 80 %.
- **Facturado por producto**: es una estimación por reparto proporcional a las
  toneladas (`productBillingEstimated=true`); `docum_cc` no da importe por
  artículo.
- **Degradación**: si falla el volumen, `available=false`; si falla la
  facturación, `billingAvailable=false` y los montos van en `null`. Pedidos y
  cartera se mantienen desde la capa local/existente. No se inventan ceros.
- **Caché**: 5 minutos por cliente + meses + moneda. Un fallo no se cachea.

### Contrato

`zCustomerInsightQuery` y `zCustomerInsightResponse` en `@nexo/contracts`.
Respuesta: totales actuales y anteriores, tendencia, serie mensual, tabla anual,
productos, perdidos, surtido comparable, cadencia, cartera, pedidos y alertas.

### Fixtures

`nexo:customer_insights_products`, `nexo:customer_insights_billing` y
`nexo:customer_insights_similar` generan datos deterministas a partir de
`CUSTOMER_SALES_PROFILES` (producto principal, producto perdido, producto en
caída y producto nuevo).
