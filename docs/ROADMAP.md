# Roadmap por fases

| Fase | Nombre | Contenido | Estado |
|---|---|---|---|
| 0 | Descubrimiento | Inventario del repo, análisis de mockups Stitch, decisiones técnicas, riesgos | ✅ Completada |
| 1 | Fundamentos | Monorepo, configuración, BD (SQLite dev), JWT+RBAC, auditoría, logs, adaptador Profit (fixtures/mssql), health | ✅ Completada |
| 2 | Integración | Lectura de vistas, normalización, sincronización idempotente, errores y trazabilidad | ✅ Completada (vista real `COR_A3.dbo.Solicitudes_Pendientes_Clientes` conectada y sincronizada en vivo) |
| 3 | Productos e inventario | Catálogo normalizado, existencias por almacén, unidades, disponibilidad neta | ✅ Completada (motor con Caso 1, endpoints `/products` `/availability`, pantalla `/disponibilidad` con datos reales) |
| 4 | Pedidos y clientes | Importación de pedidos, líneas, estados, fechas, filtros, cumplimiento | ✅ Completada (endpoints `/orders` `/orders/:id` `/orders/grouped` `/customers`; pantallas `/pedidos` (agrupada por cliente/producto con acordeón), `/clientes`; filtros por texto/estado/cliente/tipo/vendedor/autorizado/fechas; **campos del reporte ampliado**: vendedor, tipo de cliente, autorizado, cantidad, almacén; **proyección visual** de stock) |
| 5 | Motor de disponibilidad | Reglas de asignación, faltantes, prioridades, pruebas de dominio (Casos 1–8) | ⏳ Pendiente — **desbloqueada**: el «tipo de cliente» (L1/COR/L2/L3…) ya es real |
| 6 | Simulador | Selección/deselección, inventario virtual, escenarios con versionado optimista, comparación | 🟡 En curso — **escenarios guardados listos** (`/scenarios`, `DispatchScenario`, `apps/web/lib/scenario.ts`: borrador por usuario, guardados con nombre, restauración recalculada con diff, «foto» congelada e **historial visible de restauraciones** con el diff completo) y **despacho de almacén con túnel de acuses** (`/despacho`, `DispatchSheet` + `DispatchSheetLine` + `DispatchSheetEvent` + `Notification`: publicar desde un escenario —bloqueado si no hay operadores `ALMACEN`—, recibir/en carga/despachado con sello temporal y notificación a ambos lados). **Sincronización por dominio** (`SYNC_SCHEDULE`) con poda de snapshots y frescura visible. Falta: inventario virtual persistente y prioridades L1/COR/L2/L3 (fase 5) |
| 7 | Producción | Déficits → cantidades teóricas, lote mínimo, merma, capacidad, fechas estimadas | ⏳ Pendiente — `toProduceKg` ya se calcula en Disponibilidad |
| 8 | Reportes y estadísticas | Dashboard (mockups Stitch), gráficas ECharts, reportes modulares, exportación | ⏳ Pendiente |
| 9 | Interfaz final | Shell completo (sidebar 11 módulos), responsive, accesibilidad, flujos operativos | ⏳ Pendiente |
| 10 | Validación integral | Seguridad, rendimiento, E2E (Playwright), recuperación, aceptación funcional | ⏳ Pendiente |
| 11 | Producción (deploy) | Documentación, despliegue, backups, monitoreo, rollback | ⏳ Pendiente |

## Criterios de GO por fase

- Tipos y lint correctos (`pnpm typecheck`), pruebas nuevas pasando (`pnpm test`), build OK (`pnpm build`).
- Cada cálculo nuevo tiene caso de aceptación con pruebas (Casos 1–12 del prompt maestro).
- La documentación correspondiente se actualiza en la misma fase.

## Decisiones de datos abiertas (detectadas en la Fase 2 con la vista real)

Resueltas en la **Fase 3**:

- `relacion_empaque` (kg/unidad) y `kg` (kg del renglón) **ya se persisten**:
  `Product.kgPerUom` y `SalesOrderLine.pendingKg`. Son la base para reportes en KG/TON.
  `kgPerUom` no se sobreescribe con `NULL` si una corrida posterior trae la columna vacía.
- `uni_venta` mezcla `SAC` y `KG` (2 productos en KG, ambos a `kgPerUom=1`):
  el motor respeta la unidad por producto y no asume SAC universal.

Resueltas el **15/10/2026** (reporte ampliado, solo lectura, sin modificar Profit):

- **Vendedor** = `cotiz_c.co_ven` → `vendedor.ven_des` (`SalesOrder.vendor`).
- **Tipo de cliente** = `clientes.tipo` + `tipo_cli.des_tipo` (`SalesOrder.customerType`, p. ej. «L1 EXCLUSIVOS»).
- **Autorizado** = `cotiz_c.status` («1» → SÍ) (`SalesOrder.authorized`).
- **Cantidad** solicitada = `reng_cac.total_art` (`SalesOrderLine.quantity`).
- **Almacén (Alm.)** del renglón = `reng_cac.co_alma` (`SalesOrderLine.warehouses`).

> Origen descubierto: la «solicitud de cliente» de Profit es una **cotización**
> (`cotiz_c` + `reng_cac`). La vista `Solicitudes_Pendientes_Clientes` es ese JOIN.
> La app lee una **consulta ampliada equivalente** (ver `PROFIT_SQL_MAPPING.md`);
> sigue siendo **solo lectura** y no se altera nada en Profit.

Ya no bloquea la Fase 5: el motor de prioridades L1/COR/L2/L3 **tiene insumo real**.
