import { AvailabilityRow, InventoryByWarehouse } from '@nexo/contracts';

// ============================================================
// Motor de disponibilidad — núcleo puro (sin Prisma ni HTTP).
//
// Regla de la Fase 3 (base del motor completo de la Fase 5):
//   disponibilidad neta = existencia física combinada − demanda pendiente
//
// Insumos (todos desde la vista real de Profit vía sync):
//   - existencia: última fotografía (InventorySnapshot) por almacén
//   - demanda: suma de `pendingQty` de los renglones de pedidos ACTIVOS
//
// Propiedades verificadas por pruebas (Casos de aceptación):
//   - Caso 1:  demanda 10, existencia 6  → 6 disponibles / 4 a producir
//   - conserva signos: pendiente negativo (sobre-compromiso) reduce la demanda
//   - nunca se recorta a cero la disponibilidad neta en el detalle
// ============================================================

export interface AvailabilityInput {
  productCode: string;
  description: string;
  uom: string;
  kgPerUom: number | null;
  stockByWarehouse: InventoryByWarehouse[];
  demandQty: number;
  demandKg: number | null;
  // Ventas de los últimos 90 días en la unidad de venta del artículo.
  // Opcional: si no llega (Profit caído o consulta no disponible), no se
  // inventa el dato y `stockDays` queda null.
  salesQty90d?: number | null;
}

// Nota de redondeo: los decimales de Profit (decimal(18,5)) pueden traer
// fracciones; se redondea a 3 decimales para presentación/suma estable y se
// conserva el signo completo.
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function computeAvailability(input: AvailabilityInput): AvailabilityRow {
  const stockTotal = round3(input.stockByWarehouse.reduce((acc, w) => acc + w.qty, 0));
  const demandQty = round3(input.demandQty);

  // La red neta se expone completa: negativa = sobre-compromiso real.
  const netQty = round3(stockTotal - demandQty);

  // Con lo existente hoy se puede despachar hasta `min(existencia, demanda)`.
  // Sin demanda (o demanda negativa por sobre-compromiso) no hay nada que
  // despachar: availableQty = 0 y el stock queda libre (netQty positivo).
  const availableQty = demandQty <= 0 ? 0 : round3(Math.min(stockTotal, demandQty));

  // A producir sólo si la demanda supera la existencia.
  const toProduceQty = demandQty <= 0 ? 0 : round3(Math.max(0, demandQty - stockTotal));

  // Equivalente en KG del faltante (para el plan de producción en kilos).
  const toProduceKg = input.kgPerUom === null ? null : round3(toProduceQty * input.kgPerUom);

  // Días de cobertura: existencia total entre la venta promedio diaria de los
  // últimos 90 días. Sin ventas no hay referencia → null (la UI muestra «—»).
  // Un stock negativo (sobre-compromiso) equivale a 0 días de cobertura.
  const dailySalesQty =
    input.salesQty90d !== null && input.salesQty90d !== undefined && input.salesQty90d > 0
      ? round3(input.salesQty90d / 90)
      : null;
  const stockDays = dailySalesQty !== null ? round3(Math.max(0, stockTotal) / dailySalesQty) : null;

  let status: AvailabilityRow['status'];
  if (demandQty <= 0) {
    status = 'SIN_DEMANDA';
  } else if (stockTotal >= demandQty) {
    status = 'DISPONIBLE';
  } else if (stockTotal > 0) {
    status = 'PARCIAL';
  } else {
    status = 'FALTANTE';
  }

  return {
    productCode: input.productCode,
    description: input.description,
    uom: input.uom,
    kgPerUom: input.kgPerUom,
    stockTotal,
    stockByWarehouse: input.stockByWarehouse,
    demandQty,
    demandKg: input.demandKg === null ? null : round3(input.demandKg),
    netQty,
    availableQty,
    toProduceQty,
    toProduceKg,
    stockDays,
    status,
  };
}

export function computeAvailabilityRows(inputs: AvailabilityInput[]): AvailabilityRow[] {
  return inputs.map(computeAvailability);
}
