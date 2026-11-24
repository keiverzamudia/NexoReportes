import type { HelpModule, HelpTerm } from './types';

// Ayuda del modo «Ventas + cartera» de CxC. La idea central es no mezclar
// periodos: la venta es del año elegido y la cartera es el saldo abierto de hoy.

export const CXC_SALES_HELP_TITLE = 'Cómo leer Ventas + cartera';

export const CXC_SALES_HELP_RULES = [
  'La venta se mide por nota de entrega del año elegido. El facturado sale de CxC (facturas y notas de débito menos notas de crédito).',
  'La cartera es el saldo abierto de HOY; no es un histórico del año. Por eso el cruce compara la venta del año con la deuda actual.',
  'El cruce es por código de cliente. Si el cliente no tuvo venta en el año aparece como «Sin compra»; si no tiene deuda, como «Sin deuda».',
  'La antigüedad usa los mismos tramos y colores de la pestaña Cartera: por vencer, 1–30, 31–60, 61–90, 91–120, 121–150 y más de 150 días (que separa la cartera vencida hasta el 01/01/2025 del resto).',
  'La barra de cobranza reparte el 100 % de lo cobrado en los últimos 12 meses según el atraso al pagar: a tiempo, 1–30, 31–60, 61–90, 91–120, 121–150 y más de 150 días. Usa los mismos colores de la cartera.',
  'En USD cada documento se convierte con la tasa con la que nació; en Bs se muestra el saldo nativo. La venta y la cartera pueden diferir por documentos sin tasa o notas de crédito.',
  'Para mantener la vista rápida se muestran hasta 200 deudores y 200 clientes con venta de mayor monto. La pestaña Cartera tiene el listado completo.',
];

export const CXC_SALES_HELP_TERMS: HelpTerm[] = [
  {
    id: 'ventaCruce',
    title: 'Venta del año',
    short: 'Notas de entrega del año',
    what: 'Kilos vendidos según las notas de entrega de Profit dentro del año seleccionado.',
    source: 'notas de entrega de Profit',
  },
  {
    id: 'facturadoCruce',
    title: 'Facturado del año',
    short: 'Facturación CxC',
    what: 'Documentos de CxC emitidos en el año, menos notas de crédito. Es facturación emitida, no caja cobrada.',
    source: 'dbo.docum_cc',
  },
  {
    id: 'carteraCruce',
    title: 'Cartera actual',
    short: 'Deuda abierta de hoy',
    what: 'Saldo abierto de documentos débito al momento de la consulta. No corresponde al cierre del año seleccionado.',
    source: 'dbo.docum_cc',
  },
  {
    id: 'antiguedadCruce',
    title: 'Antigüedad',
    short: 'Mezcla de tramos de la deuda',
    what: 'Reparto de la cartera actual entre por vencer, 1–30, 31–60, 61–90, 91–120, 121–150 y más de 150 días (hasta 01/01/2025 y desde esa fecha).',
  },
  {
    id: 'cobranzaCruce',
    title: 'Cobranza de 12 meses',
    short: 'Cómo se pagó lo cobrado',
    what: 'Aplicaciones de recibos no anulados a facturas en los últimos 12 meses, repartidas por días de atraso respecto al vencimiento. El porcentaje se pondera por monto.',
    source: 'dbo.cobros + dbo.reng_cob',
  },
  {
    id: 'deudorActivo',
    title: 'Deudor con venta',
    short: 'Compró en el año y debe hoy',
    what: 'Cliente con venta mayor que cero en el año y cartera abierta al día. Es el núcleo del cruce comercial.',
  },
  {
    id: 'sinCompra',
    title: 'Sin compra',
    short: 'Debe pero no compró en el año',
    what: 'Cliente con cartera abierta que no registra ventas en el año seleccionado. Requiere seguimiento de cobranza.',
  },
  {
    id: 'sinDeuda',
    title: 'Sin deuda',
    short: 'Compró y no debe',
    what: 'Cliente con venta en el año y cartera cero al día. Aparece en el modo «Todos».',
  },
];

export const CXC_SALES_HELP: HelpModule = {
  title: CXC_SALES_HELP_TITLE,
  rules: CXC_SALES_HELP_RULES,
  terms: CXC_SALES_HELP_TERMS,
};
