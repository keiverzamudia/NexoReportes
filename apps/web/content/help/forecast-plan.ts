import type { HelpTerm } from './types';

// ============================================================
// Ayuda de «Control» (Reporte → Control) del módulo Forecast.
// Fórmulas en lenguaje llano; el detalle exacto vive en el componente.
// ============================================================

export const CONTROL_HELP_TITLE = 'Cómo leer el control';

export const CONTROL_HELP_RULES = [
  'Diferencias con signo: positivo = excedente, negativo = falta por cubrir.',
  'Forecast = meta de Profit (xart_fore); venta = notas de entrega del mes.',
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
  forecast: {
    id: 'forecast',
    title: 'Forecast',
    short: 'Meta del periodo',
    what: 'Meta mensual o de la semana, según el periodo elegido.',
    formula: 'mensual: xart_fore.kg_mes · semanal: kg_mes ÷ 4',
    source: 'dbo.xart_fore',
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
