# Roadmap por fases

| Fase | Nombre | Contenido | Estado |
|---|---|---|---|
| 0 | Descubrimiento | Inventario del repo, análisis de mockups Stitch, decisiones técnicas, riesgos | ✅ Completada |
| 1 | Fundamentos | Monorepo, configuración, BD (SQLite dev), JWT+RBAC, auditoría, logs, adaptador Profit (fixtures/mssql), health | ✅ Completada |
| 2 | Integración | Lectura de vistas, normalización, sincronización idempotente, errores y trazabilidad | ✅ Completada (vista real `COR_A3.dbo.Solicitudes_Pendientes_Clientes` conectada y sincronizada en vivo) |
| 3 | Productos e inventario | Catálogo normalizado, existencias por almacén, unidades, disponibilidad neta | ✅ Completada (motor con Caso 1, endpoints `/products` `/availability`, pantalla `/disponibilidad` con datos reales) |
| 4 | Pedidos y clientes | Importación de pedidos, líneas, estados, fechas, filtros, cumplimiento | ⏳ Pendiente |
| 5 | Motor de disponibilidad | Reglas de asignación, faltantes, prioridades, pruebas de dominio (Casos 1–8) | ⏳ Pendiente |
| 6 | Simulador | Selección/deselección, inventario virtual, escenarios con versionado optimista, comparación | ⏳ Pendiente |
| 7 | Producción | Déficits → cantidades teóricas, lote mínimo, merma, capacidad, fechas estimadas | ⏳ Pendiente |
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

Siguen abiertas (requieren otra vista o confirmación del negocio):

- La vista no trae **tipo de cliente**, **estado de pedido**, **cantidad total** del
  renglón ni **reservas**: `customerType`, `quantity`, `reservedQty` quedan sin llenar
  (documentado en `PROFIT_SQL_MAPPING.md`; no se rellenan con datos inventados).
- Sin tipo de cliente, el motor de prioridades L1/COR/L2/L3 aún no tiene insumo real.
