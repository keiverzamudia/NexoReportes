import type { HelpModule, HelpTerm } from './types';

// Ayuda contextual de Cuentas por cobrar. Un único término alimenta el
// popover del encabezado, la fila de explicaciones y el glosario del módulo.

export const RECEIVABLES_HELP_TITLE = 'Cómo leer la cartera';

export const RECEIVABLES_HELP_RULES = [
  'La cartera son los documentos débito abiertos (FACT, N/DB, AJPM y GIRO). Los adelantos y notas de crédito (ADEL, N/CR) no son deuda: se muestran aparte como «a favor» y se restan para obtener la cartera neta.',
  'Un documento se considera vencido al día siguiente de su fecha de vencimiento. El tramo «Por vencer» incluye los que vencen hoy o todavía no vencen.',
  'Los tramos son 1–30, 31–60, 61–90, 91–120, 121–150 y más de 150 días. Cada documento cae en un solo tramo.',
  'En USD cada documento se convierte con la tasa con la que nació; no se usa una tasa de hoy. En Bs se muestra el saldo nativo.',
  'El vendedor del resumen es el de la cartera del cliente (clientes.co_ven). El del detalle es el vendedor que firmó la factura (docum_cc.co_ven).',
  'La cobranza de 90 días cuenta abonos aplicados a facturas; no incluye adelantos. El último pago también sale de los recibos de Profit.',
  'La cobranza se toma de los recibos en US$ o USD de Profit; los recibos en Bs no se convierten. Cada abono usa la tasa con la que fue registrado.',
  'El cobrado de 12 meses y el % de cobranza a tiempo usan una ventana móvil de 12 meses sobre la fecha de cobro. El % se pondera por monto: cobrado a tiempo ÷ cobrado de 12 meses.',
  'Los filtros de búsqueda, vendedor, tipo de cliente, zona, tipo de documento y fechas acotan los documentos visibles; el resumen y las cifras de cobranza se recalculan con ese mismo subconjunto.',
];

export const RECEIVABLES_COLUMN_HELP: Record<string, HelpTerm> = {
  cliente: {
    id: 'cliente',
    title: 'Cliente',
    short: 'Código y razón social',
    what: 'Cliente de Profit al que pertenecen los documentos abiertos.',
    source: 'dbo.clientes + dbo.docum_cc',
  },
  vendedor: {
    id: 'vendedor',
    title: 'Vendedor de cartera',
    short: 'Responsable del cliente',
    what: 'Vendedor asignado hoy al cliente en Profit. El detalle muestra el vendedor de cada factura.',
    source: 'dbo.clientes.co_ven',
  },
  tipo: {
    id: 'tipo',
    title: 'Tipo de cliente',
    short: 'Segmento comercial',
    what: 'Clasificación comercial del cliente en Profit.',
    source: 'dbo.clientes.tipo + dbo.tipo_cli',
  },
  zona: {
    id: 'zona',
    title: 'Zona',
    short: 'Estado o región',
    what: 'Zona geográfica configurada en Profit para el cliente.',
    source: 'dbo.clientes.co_zon + dbo.zona',
  },
  cartera: {
    id: 'cartera',
    title: 'Cartera bruta',
    short: 'Deuda abierta',
    what: 'Suma de los saldos de documentos débito abiertos. No descuenta adelantos ni notas de crédito.',
    formula: 'Σ saldo de FACT, N/DB, AJPM y GIRO con saldo > 0',
    source: 'dbo.docum_cc',
  },
  aFavor: {
    id: 'aFavor',
    title: 'A favor',
    short: 'Adelantos y notas de crédito',
    what: 'Saldo de adelantos y notas de crédito. Se resta de la cartera bruta; no es mora.',
    formula: 'Σ saldo de ADEL y N/CR con saldo > 0',
    source: 'dbo.docum_cc',
  },
  neto: {
    id: 'neto',
    title: 'Cartera neta',
    short: 'Bruta menos a favor',
    what: 'Lo que realmente queda pendiente después de aplicar el saldo a favor.',
    formula: 'cartera bruta − a favor',
  },
  porVencer: {
    id: 'porVencer',
    title: 'Por vencer',
    short: 'Vence hoy o aún no vence',
    what: 'Documentos débito cuya fecha de vencimiento es hoy o posterior.',
  },
  d1_30: {
    id: 'd1_30',
    title: '1 a 30 días',
    short: 'Mora de 1 a 30 días',
    what: 'Documentos débito vencidos entre 1 y 30 días.',
  },
  d31_60: {
    id: 'd31_60',
    title: '31 a 60 días',
    short: 'Mora de 31 a 60 días',
    what: 'Documentos débito vencidos entre 31 y 60 días.',
  },
  d61_90: {
    id: 'd61_90',
    title: '61 a 90 días',
    short: 'Mora de 61 a 90 días',
    what: 'Documentos débito vencidos entre 61 y 90 días.',
  },
  d91_120: {
    id: 'd91_120',
    title: '91 a 120 días',
    short: 'Mora de 91 a 120 días',
    what: 'Documentos débito vencidos entre 91 y 120 días.',
  },
  d121_150: {
    id: 'd121_150',
    title: '121 a 150 días',
    short: 'Mora de 121 a 150 días',
    what: 'Documentos débito vencidos entre 121 y 150 días.',
  },
  d150Mas: {
    id: 'd150Mas',
    title: 'Más de 150 días',
    short: 'Mora extrema',
    what: 'Documentos débito vencidos hace más de 150 días. Es la cartera de mayor riesgo.',
  },
  vencido: {
    id: 'vencido',
    title: 'Vencido',
    short: 'Suma de los tramos',
    what: 'Suma de todos los tramos de mora (1–30 hasta más de 150).',
    formula: 'Σ tramos con días vencidos > 0',
  },
  pctVencido: {
    id: 'pctVencido',
    title: '% vencido',
    short: 'Participación de la mora',
    what: 'Porcentaje de la cartera bruta que está vencida.',
    formula: 'vencido ÷ cartera bruta × 100',
  },
  documentos: {
    id: 'documentos',
    title: 'Documentos',
    short: 'Facturas y notas abiertas',
    what: 'Cantidad de documentos débito con saldo. Los créditos se cuentan aparte.',
  },
  ultimoPago: {
    id: 'ultimoPago',
    title: 'Último pago',
    short: 'Último abono aplicado',
    what: 'Fecha del último recibo aplicado a una factura del cliente y días transcurridos.',
    source: 'dbo.cobros + dbo.reng_cob',
  },
  cobrado90: {
    id: 'cobrado90',
    title: 'Cobrado 90 días',
    short: 'Abonos recientes',
    what: 'Monto abonado a facturas en los últimos 90 días. No incluye adelantos.',
    source: 'dbo.cobros + dbo.reng_cob',
  },
  cobrado12m: {
    id: 'cobrado12m',
    title: 'Cobrado 12 meses',
    short: 'Abonos de los últimos 12 meses',
    what: 'Monto abonado a facturas en los últimos 12 meses, convertido con la tasa de cada recibo. No incluye adelantos ni notas de crédito.',
    source: 'dbo.cobros + dbo.reng_cob',
  },
  pctCobranzaATiempo: {
    id: 'pctCobranzaATiempo',
    title: '% de cobranza a tiempo',
    short: 'Cobrado antes del vencimiento',
    what: 'Porcentaje del monto cobrado en 12 meses que se aplicó en la fecha de vencimiento o antes. Se pondera por monto: un abono grande pesa más que uno pequeño.',
    formula: 'cobrado a tiempo ÷ cobrado 12 meses × 100',
    source: 'dbo.cobros + dbo.reng_cob',
  },
  limite: {
    id: 'limite',
    title: 'Límite de crédito',
    short: 'Cupo del cliente',
    what: 'Límite configurado en Profit. Solo se compara en USD; si está vacío, el cliente no tiene cupo definido.',
    source: 'dbo.clientes.mont_cre',
  },
  dias: {
    id: 'dias',
    title: 'Días vencidos',
    short: 'Mora del documento',
    what: 'Días transcurridos desde el vencimiento. Negativo = aún no vence; 0 = vence hoy.',
  },
  tramo: {
    id: 'tramo',
    title: 'Tramo',
    short: 'Rango de antigüedad',
    what: 'Tramo de vencimiento al que pertenece el documento.',
  },
  montoOriginal: {
    id: 'montoOriginal',
    title: 'Monto original',
    short: 'Monto de la factura',
    what: 'Monto neto original del documento. El saldo puede ser menor si tiene abonos parciales.',
  },
  tipoDoc: {
    id: 'tipoDoc',
    title: 'Tipo de documento',
    short: 'FACT, GIRO, ADEL…',
    what: 'Tipo de documento de Profit. FACT, N/DB, AJPM y GIRO son débito; ADEL y N/CR son crédito.',
  },
  nroDoc: {
    id: 'nroDoc',
    title: 'Número de documento',
    short: 'Número en Profit',
    what: 'Número interno del documento en Profit.',
  },
  emision: {
    id: 'emision',
    title: 'Emisión',
    short: 'Fecha del documento',
    what: 'Fecha en que Profit emitió el documento.',
  },
  vencimiento: {
    id: 'vencimiento',
    title: 'Vencimiento',
    short: 'Fecha de pago',
    what: 'Fecha de vencimiento registrada en el documento.',
  },
};

export const RECEIVABLES_HELP_TERMS: HelpTerm[] = Object.values(RECEIVABLES_COLUMN_HELP);

export const RECEIVABLES_HELP: HelpModule = {
  title: RECEIVABLES_HELP_TITLE,
  rules: RECEIVABLES_HELP_RULES,
  terms: RECEIVABLES_HELP_TERMS,
};
