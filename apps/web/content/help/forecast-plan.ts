import type { HelpTerm } from './types';

// ============================================================
// Ayuda de «Básico» (Reporte → Básico) del módulo Forecast.
// Fórmulas en lenguaje llano; el detalle exacto vive en el componente.
// ============================================================

export const CONTROL_HELP_TITLE = 'Cómo leer el reporte básico';

export const CONTROL_HELP_RULES = [
  'Stock 03, 9999 y 68 = existencia del artículo en cada almacén, en su unidad de venta.',
  'Existencia = Stock 03 + Stock 9999 + Stock 68 (sin convertir a kg).',
  'Diferencias con signo: positivo = excedente, negativo = falta por cubrir.',
  'Forecast = meta de Profit (forecast); venta = notas de entrega del mes.',
  'El forecast se lleva a kg: sacos × kg por saco; el granel se mantiene en kg.',
  'Solicitado = saldo pendiente de pedidos activos en la fecha de entrega.',
  'En «Semanal» se usa el bloque 1-7, 8-14, 15-21 y 22-fin del mes.',
  'El mes en curso se compara contra la venta a la fecha de corte.',
];

export const CONTROL_COLUMN_HELP = {
  codigo: {
    id: 'codigo',
    title: 'Código',
    short: 'Artículo en Profit',
    what: 'Código del artículo tal como está registrado en Profit.',
    formula: 'art.co_art',
    source: 'dbo.art',
  },
  descripcion: {
    id: 'descripcion',
    title: 'Descripción',
    short: 'Nombre y unidad',
    what: 'Descripción del artículo y su unidad de venta (SAC o KG).',
    formula: 'art.art_des · art.uni_venta',
    source: 'dbo.art',
  },
  stock03: {
    id: 'stock03',
    title: 'Stock 03',
    short: 'Existencia en almacén 03',
    what: 'Existencia del artículo en el almacén Stock 03, en su unidad de venta (SAC o KG).',
    formula: 'Σ st_almac.stock_act · co_alma = 03',
    source: 'Sync de Profit · almacenes',
  },
  stock9999: {
    id: 'stock9999',
    title: 'Stock 9999',
    short: 'Existencia en almacén 9999',
    what: 'Existencia del artículo en el almacén Stock 9999, en su unidad de venta (SAC o KG).',
    formula: 'Σ st_almac.stock_act · co_alma = 9999',
    source: 'Sync de Profit · almacenes',
  },
  stock68: {
    id: 'stock68',
    title: 'Stock 68',
    short: 'Existencia en almacén 68',
    what: 'Existencia del artículo en el almacén Stock 68, en su unidad de venta (SAC o KG).',
    formula: 'Σ st_almac.stock_act · co_alma = 6804',
    source: 'Sync de Profit · almacenes',
  },
  existencia: {
    id: 'existencia',
    title: 'Existencia',
    short: 'Stock total',
    what: 'Suma de las existencias de los tres almacenes. No se convierte a kg: va en la unidad del artículo.',
    formula: 'Stock 03 + Stock 9999 + Stock 68',
    source: 'Nexo · inventario sincronizado',
  },
  forecast: {
    id: 'forecast',
    title: 'Forecast',
    short: 'Meta del periodo',
    what:
      'Meta mensual o de la semana, en kilogramos. Si Profit la trae en sacos, se multiplica por los kg por saco del artículo; el granel se mantiene en kg.',
    formula: 'mensual: kg_mensual × uni_relac (SAC) · semanal: kg ÷ 4',
    source: 'dbo.forecast (fecha = mes de vigencia) · dbo.art',
  },
  solicitado: {
    id: 'solicitado',
    title: 'Solicitado',
    short: 'Pedidos pendientes',
    what: 'Saldo pendiente de los pedidos activos con entrega en el periodo.',
    formula: 'Σ pendingKg de pedidos activos',
    source: 'Nexo · pedidos sincronizados',
  },
  ventas: {
    id: 'ventas',
    title: 'Vtas',
    short: 'Kg despachados',
    what: 'Kilogramos despachados en el periodo según notas de entrega no anuladas.',
    formula: 'Σ (unidades × kg por unidad)',
    source: 'not_ent · reng_nde · solo ABA',
  },
  difVenta: {
    id: 'difVenta',
    title: 'Dif. venta − forecast',
    short: 'Cobertura de la meta',
    what: 'Diferencia entre lo vendido y la meta. Positivo = excedente; negativo = falta.',
    formula: 'venta − forecast',
    source: 'Signo: + excedente · − falta',
  },
  difCobertura: {
    id: 'difCobertura',
    title: 'Dif. venta + solicitado − forecast',
    short: 'Meta cubierta con pedidos',
    what: 'Cuánto de la meta queda cubierto al sumar la venta y lo solicitado.',
    formula: 'venta + solicitado − forecast',
    source: 'Equivale a −(forecast − venta − solicitado)',
  },
} satisfies Record<string, HelpTerm>;

export const CONTROL_HELP_TERMS: HelpTerm[] = Object.values(CONTROL_COLUMN_HELP);
