import type { HelpTerm } from './types';

// ============================================================
// Ayuda de «Ventas vs Forecast» (`/forecast` → pestaña Ventas).
//
// Las fórmulas salen del motor del API (`sales-run-rate.ts`); aquí no se
// calcula nada, solo se explica. Si cambia una fórmula, se cambia aquí y en el
// motor: el test `forecast.spec.ts` vigila que no falte ninguna columna.
// ============================================================

export const SALES_HELP_TITLE = 'Cómo leer esta pantalla';

export const SALES_HELP_RULES = [
  'Corte a ayer: el día en curso está incompleto y no entra al promedio.',
  'Días hábiles de lunes a sábado; el domingo casi no se despacha.',
  'Venta = nota de entrega no anulada, línea ABA y artículo activo.',
  'Sin devoluciones ABA: la venta neta es igual a la bruta.',
  'Si Profit no responde, el informe no muestra ceros: avisa y espera.',
];

export const SALES_COLUMN_HELP = {
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
    short: 'Nombre del artículo',
    what: 'Descripción comercial del artículo en el catálogo de Profit.',
    formula: 'art.art_des',
    source: 'dbo.art',
  },
  semaforo: {
    id: 'semaforo',
    title: 'Semáforo',
    short: 'Ritmo contra la meta',
    what: 'Resume si el artículo va a cumplir la meta del mes al ritmo actual.',
    formula: 'Verde ≥ 100 % · ámbar 85–99 % · rojo < 85 %',
    source: 'Se calcula con «% vs forecast».',
  },
  uom: {
    id: 'uom',
    title: 'UOM',
    short: 'Saco (SAC) o granel (KG)',
    what: 'Unidad de venta del artículo; define si la columna Sacos aplica.',
    formula: 'art.uni_venta',
    source: 'dbo.art',
  },
  forecast: {
    id: 'forecast',
    title: 'Forecast kg',
    short: 'Meta mensual del artículo',
    what: 'Meta mensual cargada por producción en Profit, ya expresada en kilogramos.',
    formula: 'xart_fore.kg_mes',
    source: 'dbo.xart_fore · sin conversión',
  },
  ventaKg: {
    id: 'ventaKg',
    title: 'Venta kg',
    short: 'Kg despachados en el mes',
    what: 'Kilogramos despachados en el mes hasta el corte (ayer por defecto).',
    formula: 'Σ (unidades × kg por unidad)',
    source: 'not_ent · reng_nde · solo ABA',
  },
  sacos: {
    id: 'sacos',
    title: 'Sacos',
    short: 'Venta convertida a sacos',
    what: 'Equivalente en sacos de la venta en kg. Solo se muestra en artículos SAC.',
    formula: 'venta kg ÷ kg por saco',
    source: 'art.uni_relac · granel = —',
  },
  avance: {
    id: 'avance',
    title: 'Avance',
    short: 'Venta real ÷ meta',
    what: 'Porcentaje de la meta que ya se vendió; mide lo acumulado, no proyecta.',
    formula: 'venta kg ÷ forecast kg × 100',
    source: 'Cálculo del API',
  },
  promedio: {
    id: 'promedio',
    title: 'Promedio/día',
    short: 'Ritmo real del mes',
    what: 'Venta promedio por día transcurrido, según la base de días elegida.',
    formula: 'venta kg ÷ días del 1 al corte',
    source: 'Hábiles = lun–sáb',
  },
  proyeccion: {
    id: 'proyeccion',
    title: 'Proyección kg',
    short: 'Cierre estimado del mes',
    what: 'Venta que se alcanzaría al cierre si se mantiene el ritmo actual.',
    formula: 'promedio/día × días del mes',
    source: 'Mes cerrado = venta real',
  },
  proyectadoPct: {
    id: 'proyectadoPct',
    title: '% vs forecast',
    short: 'Proyección ÷ meta',
    what: 'Cumplimiento proyectado: el número que decide si el mes cierra bien.',
    formula: 'proyección ÷ forecast × 100',
    source: 'Alimenta el semáforo',
  },
  ritmo: {
    id: 'ritmo',
    title: 'Ritmo nec.',
    short: 'Kg/día que faltan',
    what: 'Kilogramos por día que hay que vender para llegar a la meta.',
    formula: 'max(0, forecast − venta) ÷ días restantes',
    source: 'Solo mes en curso',
  },
  historico: {
    id: 'historico',
    title: 'Histórico kg',
    short: 'Promedio de meses previos',
    what: 'Venta promedio de los N meses anteriores elegidos en el filtro Histórico.',
    formula: 'Σ venta de N meses ÷ N',
    source: 'Un mes sin venta cuenta como 0',
  },
  vsHistorico: {
    id: 'vsHistorico',
    title: '% vs histórico',
    short: 'Proyección vs promedio',
    what: 'Cuánto crece o cae la proyección frente al promedio histórico.',
    formula: '(proyección ÷ histórico − 1) × 100',
    source: 'Cálculo del API',
  },
  ultimaFactura: {
    id: 'ultimaFactura',
    title: 'Última entrega',
    short: 'Fecha de la última nota',
    what: 'Fecha de la última nota de entrega del artículo dentro del mes.',
    formula: 'MAX(not_ent.fec_emis)',
    source: 'not_ent',
  },
} satisfies Record<string, HelpTerm>;

export type SalesHelpKey = keyof typeof SALES_COLUMN_HELP;

export const SALES_HELP_TERMS: HelpTerm[] = Object.values(SALES_COLUMN_HELP);
