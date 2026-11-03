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
  'En las barras: real = venta acumulada; proyección = cierre estimado; la rayita = meta.',
  'Ventas por día: una columna por día del mes; los días futuros quedan vacíos y el día en curso va marcado. El clic fija el día arriba y abajo.',
  'La línea punteada de la tira diaria es la meta por día (forecast ÷ días del mes).',
  'La meta se captura una vez al mes y se conserva para el histórico.',
  'El mes en curso muestra la meta viva de Profit; si allá la cambian, se avisa.',
  'Sin días hábiles contados, la proyección es 0 y el % es 0: el mes aún no empieza a contar.',
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
    what:
      'Meta mensual cargada por producción en Profit, ya expresada en kilogramos. `forecast.fecha` indica el mes de vigencia. `kg_mensual` viene en la presentación del artículo (sacos para SAC, kg para granel) y se multiplica por los kg por saco cuando corresponde. En el mes en curso se lee viva; en los meses cerrados se usa la copia capturada y, si no existe, la meta de Profit para ese mes. Si Profit la cambia después de capturarla, se muestra un aviso.',
    formula: 'kg_mensual × uni_relac (SAC) · fecha = mes · cerrado: captura local',
    source: 'dbo.forecast · dbo.art · ForecastTarget',
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
    what:
      'Venta que se alcanzaría al cierre si se mantiene el ritmo actual. Si aún no hay días hábiles contados, queda en 0: no significa que el mes esté perdido.',
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
