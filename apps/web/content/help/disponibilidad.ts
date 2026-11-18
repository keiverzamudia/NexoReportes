import type { HelpTerm } from './types';

// ============================================================
// Ayuda de «Disponibilidad por Producto».
// Explica en lenguaje llano qué hay en cada columna y cómo se calcula.
// ============================================================

export const DISPO_HELP_TITLE = 'Cómo se calcula Disponibilidad';

export const DISPO_HELP_RULES = [
  'Las cantidades van en la unidad de venta del artículo (SAC o KG); no se mezclan unidades.',
  'PTP, 03, 9999 y 68 son almacenes de Profit. PTP = PT Producción; 68 = PT Almacén 68 (código 6804).',
  'La existencia sale de la última fotografía de inventario sincronizada con Profit.',
  'La solicitud es el saldo pendiente de pedidos activos. Puede ser negativa si hay sobre-compromiso.',
  'Despachable nunca supera la solicitud. Neto puede ser negativo: significa que falta existencia.',
  'Stock/día usa las notas de entrega de los últimos 90 días. Si no hubo ventas, no se puede calcular.',
];

export const DISPO_COLUMN_HELP = {
  codigo: {
    id: 'codigo',
    title: 'Código',
    short: 'Artículo en Profit',
    what: 'Código del artículo tal como está registrado en Profit.',
    formula: 'art.co_art',
    source: 'Profit · catálogo de artículos',
  },
  descripcion: {
    id: 'descripcion',
    title: 'Descripción',
    short: 'Nombre del producto',
    what: 'Nombre del artículo. La unidad de venta se muestra en la columna Unid.',
    formula: 'art.art_des',
    source: 'Profit · catálogo de artículos',
  },
  unid: {
    id: 'unid',
    title: 'Unidad',
    short: 'SAC o KG',
    what: 'Unidad en la que se mide el artículo: SAC (sacos) o KG (granel). Todas las cantidades de la fila usan esta unidad.',
    formula: 'art.uni_venta',
    source: 'Profit · catálogo de artículos',
  },
  stockPtp: {
    id: 'stockPtp',
    title: 'PTP',
    short: 'Existencia en PT Producción',
    what: 'Existencia del artículo en el almacén PTP (PT Producción). Es producto terminado listo para despacho.',
    formula: 'Σ existencias · almacén PTP',
    source: 'Profit · almacén PTP',
  },
  stock03: {
    id: 'stock03',
    title: '03',
    short: 'Existencia en almacén 03',
    what: 'Existencia del artículo en el almacén 03.',
    formula: 'Σ existencias · almacén 03',
    source: 'Profit · almacén 03',
  },
  stock9999: {
    id: 'stock9999',
    title: '9999',
    short: 'Existencia en tránsito',
    what: 'Existencia del artículo en el almacén 9999 (traslado entre almacenes).',
    formula: 'Σ existencias · almacén 9999',
    source: 'Profit · almacén 9999',
  },
  stock68: {
    id: 'stock68',
    title: '68',
    short: 'Existencia en PT Almacén 68',
    what: 'Existencia del artículo en el almacén 68 (PT Almacén 68, código 6804 en Profit).',
    formula: 'Σ existencias · almacén 6804',
    source: 'Profit · almacén 6804',
  },
  existencia: {
    id: 'existencia',
    title: 'Existencia',
    short: 'Total en los 4 almacenes',
    what: 'Todo lo que hay físicamente del artículo en los cuatro almacenes, en su unidad de venta.',
    formula: 'PTP + 03 + 9999 + 68',
    source: 'Nexo · última fotografía de inventario',
  },
  stockDias: {
    id: 'stockDias',
    title: 'Stock/día',
    short: 'Días que alcanza la existencia',
    what:
      'Para cuántos días alcanza la existencia si se sigue vendiendo al mismo ritmo de los últimos 3 meses. Si no hubo ventas en ese periodo, no se puede calcular y se muestra «—».',
    formula: 'Existencia ÷ (ventas de 90 días ÷ 90)',
    source: 'Profit · notas de entrega de los últimos 90 días',
  },
  solicitado: {
    id: 'solicitado',
    title: 'Solicitud',
    short: 'Pendiente de pedidos activos',
    what: 'Cantidad que los clientes tienen pendiente por despachar en pedidos activos. Un valor negativo indica sobre-compromiso.',
    formula: 'Σ pendiente de pedidos activos',
    source: 'Profit · pedidos y sus renglones',
  },
  despachable: {
    id: 'despachable',
    title: 'Despachable',
    short: 'Lo que se puede entregar hoy',
    what: 'Parte de la solicitud que se puede cubrir con la existencia actual. Nunca es mayor que la solicitud.',
    formula: 'mín(Existencia, Solicitud)',
    source: 'Nexo · cálculo',
  },
  neto: {
    id: 'neto',
    title: 'Neto',
    short: 'Sobra (+) o falta (−)',
    what: 'Lo que queda después de cubrir la solicitud. Positivo = existencia libre; negativo = falta por cubrir.',
    formula: 'Existencia − Solicitud',
    source: 'Nexo · cálculo · el signo indica sobra o falta',
  },
  aProducir: {
    id: 'aProducir',
    title: 'Prod (sac)',
    short: 'Sacos a producir',
    what:
      'Sacos que hay que producir para cubrir lo que la existencia no alcanza. En artículos a granel (KG) no aplica y se muestra un 0 tachado.',
    formula: 'máx(0, Solicitud − Existencia) en sacos',
    source: 'Nexo · cálculo',
  },
  aProducirKg: {
    id: 'aProducirKg',
    title: 'Prod (kg)',
    short: 'Kilos a producir',
    what: 'Kilos que hay que producir para cubrir lo que la existencia no alcanza.',
    formula: 'Prod (sac) × kg por saco · en granel, el faltante en kg',
    source: 'Nexo · cálculo',
  },
  estado: {
    id: 'estado',
    title: 'Estado',
    short: 'Semáforo de la fila',
    what:
      'Resumen de la fila: Despachable si la existencia cubre toda la solicitud; Parcial si cubre una parte; Faltante si no hay existencia; Sin solicitud si no hay pedidos pendientes.',
    formula: 'Despachable · Parcial · Faltante · Sin solicitud',
    source: 'Nexo · regla de estado',
  },
} satisfies Record<string, HelpTerm>;

export const DISPO_HELP_TERMS: HelpTerm[] = Object.values(DISPO_COLUMN_HELP);
