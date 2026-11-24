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
  'En el detalle del producto: barras = venta de cada mes (la azul clara es el mes en curso) y el guion verde sobre cada barra es la meta de ese mes; el tramo teñido de verde es lo que la superó.',
  'La línea roja del detalle es la variación % de cada mes contra el anterior (se lee en el eje derecho). El mes en curso entra con su venta parcial: el punto va subiendo a medida que se vende.',
  'Ventas por día: una columna por día del mes; los días futuros quedan vacíos y el día en curso va marcado. El clic fija el día y abre su desglose.',
  'El desglose del día trae dos vistas: productos (kg, sacos y % del día) y clientes (kg, sacos y % del día). Al expandir una fila se ven los clientes del producto o los productos del cliente, con su presentación en sacos cuando el artículo es SAC.',
  'Los porcentajes del desglose se calculan sobre el total vendido del día; las notas sin cliente se agrupan como «Sin cliente» para que sumen 100 %.',
  'La línea punteada de la tira diaria es la meta por día (forecast ÷ días del mes).',
  '«Sumar pedidos» (acumulado del mes) añade la cartera pendiente: la línea ámbar muestra hasta dónde llegarías si facturas todos los pedidos del mes. Es un techo comprometido, no una proyección; la punteada de ritmo no incluye la cartera y no se suman.',
  'Con «Sumar pedidos» activo, los KPIs superiores leen venta + cartera: el cierre comprometido, la brecha contra el forecast y el ritmo que faltaría vender después de los pedidos.',
  'La tarjeta «Brecha» alterna dos lecturas: Mes = venta acumulada contra el forecast (con signo); Día = lo que faltaría para el forecast si el mes terminara hoy, con el % de la meta ya vendido.',
  'El color de «Avance» y del semáforo mide el ritmo: compara el cierre proyectado con la meta, no lo vendido a la fecha. Un 25 % de avance a mitad de mes puede ir perfectamente en ritmo.',
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
    what:
      'Porcentaje de la meta que ya se vendió: el número es lo acumulado, no proyecta. El color sí: lee el cierre proyectado al ritmo actual, así que verde significa «va en ritmo para cumplir», no «ya cumplió».',
    formula:
      'avance = venta kg ÷ forecast kg × 100 · color = (venta ÷ días transcurridos × días del mes) ÷ forecast × 100',
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

// ============================================================
// Clientes vs meta histórica.
//
// Cada cliente se mide contra SU promedio de los 3 meses cerrados anteriores
// (solo meses con compra). La barra azul es la venta del mes y la verde, la
// proyección de cierre. No es el forecast oficial de Profit.
// ============================================================

export const SALES_CUSTOMER_HELP_TITLE = 'Cómo leer los clientes contra su meta histórica';

export const SALES_CUSTOMER_HELP_RULES = [
  'La meta de cada cliente es el promedio de los kg de los meses CON COMPRA de los últimos 3 meses cerrados.',
  'No es el forecast oficial de Profit: es un benchmark individual de cartera y no se suma a la meta de la empresa.',
  'La barra azul es la venta del mes hasta el corte; la verde, la proyección de cierre al ritmo actual.',
  'El marcador verde es el 100 % de la meta histórica: si la barra lo cruza, el cliente va por encima de su promedio.',
  'La proyección solo aplica al mes en curso; en un mes cerrado manda la venta real y en uno futuro solo se muestra la meta.',
  'La lista se ordena por mayor promedio: primero los clientes que más volumen venían comprando.',
  'Un cliente que no compró este mes aparece con su meta y 0 venta: es la lista de prioridades a recuperar.',
  'Venta = nota de entrega no anulada, línea ABA y artículo activo. Corte a ayer; días hábiles de lunes a sábado.',
  'Si Profit no responde, el informe avisa y no inventa ceros ni promedios.',
];

export const CUSTOMER_SALES_COLUMN_HELP = {
  codigo: {
    id: 'customer_codigo',
    title: 'Código',
    short: 'Cliente en Profit',
    what: 'Código del cliente tal como está registrado en Profit.',
    formula: 'clientes.co_cli',
    source: 'dbo.clientes',
  },
  cliente: {
    id: 'customer_cliente',
    title: 'Cliente',
    short: 'Nombre comercial',
    what: 'Nombre comercial del cliente; si la BD local no lo tiene, se usa el de Profit.',
    formula: 'clientes.cli_des',
    source: 'dbo.clientes · Customer',
  },
  tipo: {
    id: 'customer_tipo',
    title: 'Tipo / Vendedor',
    short: 'Segmento y vendedor',
    what: 'Segmento comercial y vendedor asignado al cliente en la cartera local.',
    formula: 'Customer.customerType · Customer.vendor',
    source: 'Customer',
  },
  meta: {
    id: 'customer_meta',
    title: 'Meta prom.',
    short: 'Promedio histórico del cliente',
    what:
      'Promedio de los kg de los meses con compra de los últimos 3 meses cerrados. Si compró los 3 meses divide entre 3; si compró uno, esa compra es su meta. No incluye el mes en curso.',
    formula: 'Σ kg de los meses con compra ÷ cantidad de meses con compra (1–3)',
    source: 'not_ent · reng_nde · solo ABA',
  },
  venta: {
    id: 'customer_venta',
    title: 'Venta kg',
    short: 'Kg despachados al cliente',
    what: 'Kilogramos despachados al cliente en el mes hasta el corte.',
    formula: 'Σ (unidades × kg por unidad)',
    source: 'not_ent · reng_nde · solo ABA',
  },
  proyeccion: {
    id: 'customer_proyeccion',
    title: 'Proyección kg',
    short: 'Cierre estimado del mes',
    what:
      'Kg que cerraría el cliente al ritmo actual. En un mes cerrado coincide con la venta real; en un mes futuro queda vacía.',
    formula: '(venta ÷ días hábiles transcurridos) × días hábiles del mes',
    source: 'Cálculo del API',
  },
  vsMeta: {
    id: 'customer_vs_meta',
    title: '% vs meta',
    short: 'Cumplimiento proyectado',
    what:
      'Proyección de cierre contra la meta histórica del cliente. Sin meta (cliente nuevo) se muestra «Sin meta» en lugar de un porcentaje.',
    formula: 'proyección ÷ meta histórica × 100',
    source: 'Cálculo del API',
  },
  ritmo: {
    id: 'customer_ritmo',
    title: 'Ritmo nec.',
    short: 'Kg por día hábil',
    what: 'Kilogramos por día hábil que necesita vender el cliente para cerrar el mes en su meta. Solo en el mes en curso.',
    formula: 'max(0, meta − venta) ÷ días hábiles restantes',
    source: 'Cálculo del API',
  },
  participacion: {
    id: 'customer_participacion',
    title: 'Participación %',
    short: 'Peso en la venta total',
    what:
      'Porcentaje que representa el cliente sobre toda la venta ABA del mes a la fecha. La suma de los clientes con venta es 100 %.',
    formula: 'kg del cliente ÷ kg totales ABA × 100',
    source: 'Cálculo del API',
  },
  productos: {
    id: 'customer_productos',
    title: 'Productos',
    short: 'Artículos con venta',
    what: 'Cantidad de productos que el cliente compró en el mes. Al expandir la fila se ve el detalle junto a su historial.',
    formula: 'Conteo de productos con venta del cliente',
    source: 'Cálculo del API',
  },
  ultimaFactura: {
    id: 'customer_ultima',
    title: 'Última entrega',
    short: 'Fecha de la última nota',
    what: 'Fecha de la última entrega del cliente en el mes; si no compró este mes, la última de los 3 meses históricos.',
    formula: 'MAX(not_ent.fec_emis)',
    source: 'not_ent',
  },
} satisfies Record<string, HelpTerm>;

export const CUSTOMER_SALES_HELP_TERMS: HelpTerm[] = Object.values(CUSTOMER_SALES_COLUMN_HELP);
