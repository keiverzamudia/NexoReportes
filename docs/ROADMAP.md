# Roadmap por fases

| Fase | Nombre | Contenido | Estado |
|---|---|---|---|
| 0 | Descubrimiento | Inventario del repo, análisis de mockups Stitch, decisiones técnicas, riesgos | ✅ Completada |
| 1 | Fundamentos | Monorepo, configuración, BD (SQLite dev), JWT+RBAC, auditoría, logs, adaptador Profit (fixtures/mssql), health | ✅ Completada |
| 2 | Integración | Lectura de vistas, normalización, sincronización idempotente, errores y trazabilidad | ✅ Completada (vista real `COR_A3.dbo.Solicitudes_Pendientes_Clientes` conectada y sincronizada en vivo) |
| 3 | Productos e inventario | Catálogo normalizado, existencias por almacén, unidades, disponibilidad neta | ⏳ Pendiente |
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

- La vista trae **13 columnas**, incluidas `relacion_empaque` (kg/unidad) y `kg`
  (kg del renglón = `pendiente × relacion_empaque`): candidatas a persistirse en
  `Product`/`SalesOrderLine` para reportes en KG/TON (decisión de esquema en Fase 3).
- La vista no trae **tipo de cliente**, **estado de pedido**, **cantidad total** del
  renglón ni **reservas**: `customerType`, `quantity`, `reservedQty` quedan sin llenar
  (documentado en `PROFIT_SQL_MAPPING.md`; no se rellenan con datos inventados).
- `uni_venta` mezcla `SAC` y `KG` (2 productos en KG): el motor debe respetar la unidad
  por producto y no asumir SAC universal.
