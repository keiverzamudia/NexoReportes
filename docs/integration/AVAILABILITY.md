# Motor de disponibilidad

> **Fase 3 (base) → Fase 5 (reglas completas).** Núcleo de cálculo puro,
> sin Prisma ni HTTP, en `apps/api/src/modules/availability/availability.engine.ts`.
> Cada regla nueva se agrega aquí con su caso de aceptación y su prueba.

## Regla base (implementada y probada en la Fase 3)

Para cada **producto**:

```
disponibilidad neta = existencia física combinada − solicitado pendiente
```

> En la interfaz, `demandQty` se muestra como **Solicitado** y `availableQty` como
> **Despachable**. Los nombres de los campos del API se mantienen por compatibilidad.

| Magnitud | Definición | Fuente |
|---|---|---|
| `stockTotal` | Suma de la existencia del artículo en todos los almacenes | Última `InventorySnapshot` (fotografía coherente por corrida de sync) |
| `demandQty` | Suma de `pendingQty` de los renglones de **pedidos activos** (solicitado pendiente) | `SalesOrderLine` (`order.isActive = true`) |
| `netQty` | `stockTotal − demandQty` | Calculado (se expone completo, puede ser negativo) |
| `availableQty` | `min(stockTotal, demandQty)` si `demandQty > 0`; si no, `0` (lo despachable hoy) | Calculado |
| `toProduceQty` | `max(0, demandQty − stockTotal)` si `demandQty > 0`; si no, `0` | Calculado |

### Estados

| Estado | Condición | Significado |
|---|---|---|
| `DISPONIBLE` | `demandQty > 0` y `stockTotal ≥ demandQty` | La existencia cubre todo el solicitado (Despachable) |
| `PARCIAL` | `demandQty > 0` y `0 < stockTotal < demandQty` | Se despacha parte; hay que producir el resto |
| `FALTANTE` | `demandQty > 0` y `stockTotal = 0` | No hay existencia; todo el solicitado hay que producirlo |
| `SIN_DEMANDA` | `demandQty ≤ 0` | Sin solicitado pendiente (o sobre-compromiso neto); el stock queda libre |

### Propiedades (verificadas por pruebas en `availability.engine.spec.ts`)

- **Caso de aceptación 1:** solicitado 10 y existencia 6 → `availableQty = 6`, `toProduceQty = 4`, `netQty = -4`, estado `PARCIAL`.
- **Conserva signos:** un `pendiente` negativo (sobre-compromiso real de Profit) reduce el
  solicitado agregado; no se recorta a cero.
- **Neta expuesta completa:** `netQty` puede quedar negativa y así se muestra en el detalle
  (nunca se oculta el déficit con datos ficticios).
- **Unidad por producto:** cada fila se calcula en la unidad de venta de ese producto
  (`SAC` o `KG`); nunca se suman unidades distintas entre sí.
- **Redondeo:** a 3 decimales, conservando el signo.

## Conversión a KG / TON (insumo persistido, pendiente de reglas)

La vista real trae `relacion_empaque` (kg por unidad de venta) y `kg` (kg del renglón =
`pendiente × relacion_empaque`, calculado en Profit). Ambos se persisten desde la Fase 3 en
`Product.kgPerUom` y `SalesOrderLine.pendingKg`, lo que permite expresar el solicitado y la producción
en KG/TON sin recalcular desde cero.

## Reglas que faltan (Fase 5 — Casos 2 a 8)

Priorización del solicitado cuando no alcanza la existencia (por tipo de cliente
L1 > COR > L2 > L3 y fecha de entrega), cálculo del faltante por cliente, y asignación
de existencias. **Bloqueado por:** la vista actual no trae el tipo de cliente; se necesita
una fuente adicional (columna o vista) para el motor de prioridades.

## Punto de entrada (API)

- `GET /api/availability` → filas por producto con las magnitudes y el estado anteriores.
- `GET /api/products` y `GET /api/products/:code` → catálogo y detalle (incluye `kgPerUom`).
- `GET /api/inventory/snapshots/latest` → metadatos de la fotografía usada (antigüedad del dato).
