import type { HelpTerm } from './types';

// ============================================================
// Ayuda de «Vendedor vs Forecast» (`/vendedor`).
//
// Las fórmulas salen del API (`sellers.service.ts` + `sellers-allocation.ts`);
// aquí no se calcula nada, solo se explica. El test `sellers.spec.ts` vigila
// que cada columna de la tabla tenga su término.
// ============================================================

export const SELLERS_HELP_TITLE = 'Cómo leer esta pantalla';

export const SELLERS_HELP_RULES = [
  'El criterio Cartera usa clientes.co_ven: cada cliente pertenece al vendedor que tiene asignado hoy en Profit. El criterio Facturado usa not_ent.co_ven: la venta se acredita a quien firmó la nota. La elección solo cambia la base de la cuota; la tabla y el expediente muestran siempre los dos libros.',
  'En Cartera la cartera se muestra completa, aunque el cliente no haya comprado. Los clientes inactivos se excluyen.',
  'Venta = nota de entrega no anulada, línea ABA y artículo activo; misma fuente que Ventas vs Forecast.',
  'Facturado = notas firmadas por el vendedor, sea o no su cliente. Cartera = venta de los clientes asignados en Profit, la firme él u otro. Por otros = parte de su cartera facturada por un vendedor distinto al asignado.',
  'La fuga separa a los vendedores reales de las cuentas internas 001/004: una venta de la cuenta interna no se cuenta como «otro vendedor».',
  'La meta de la empresa es la misma del informe Ventas vs Forecast: viva de Profit o snapshot guardado.',
  'La cuota de cada vendedor es su participación en los kg de los últimos meses cerrados del filtro Histórico.',
  'La meta del vendedor = meta de la empresa × su cuota. La suma de todas las metas cuadra al kilo con la meta de la empresa.',
  'La meta de cada cliente = meta de su vendedor × su participación en la venta histórica de ese vendedor.',
  'Dentro del expediente la cuota del vendedor es el 100 % y cada cliente es una porción: su cumplimiento se mide contra esa porción y el aporte a la brecha dice quién explica el faltante.',
  'Reparto del mes = venta del vendedor ÷ venta total de la red. Responde «qué representación tiene cada uno».',
  'El cumplimiento compara la venta contra la meta ASIGNADA, no contra el forecast global.',
  'Sin histórico la cuota se reparte en partes iguales y se avisa; sin meta los porcentajes quedan en «—».',
  'Corte a ayer y días hábiles de lunes a sábado, igual que el informe de ventas.',
  'Si Profit no responde, la pantalla avisa y no pinta ceros como si fueran ventas.',
  'Las cuentas internas 001 LA EMPRESA y 004 EQUIPO DE VENTAS participan como un vendedor más y se marcan en la tabla.',
  'En el expediente, Mi cartera muestra la cartera completa (con venta y sin venta); Facturado muestra solo los clientes con notas firmadas por el vendedor; Facturado por otros muestra los clientes de su cartera que compraron y les facturó otro vendedor.',
  'Clic en un cliente del expediente abre el detalle de sus notas del mes para la pestaña activa (Facturado / Mi cartera / Facturado por otros). Los kg y las notas cuadran con la fila; la ficha 360 completa queda a un botón.',
  'Clic en una fila de producto del expediente despliega los clientes que lo compraron en el mes; desde ahí se puede abrir el detalle de cada cliente.',
  'En el ranking, clic en una cifra abre el expediente en la pestaña del dato. Los KPI del encabezado filtran el ranking por facturado, cartera o meta.',
  'La pestaña Productos cruza cada artículo: cartera asignada, facturado por el vendedor y cartera facturada por otros.',
  'El histórico del expediente arranca en 3 meses y se puede cambiar allí; ese cambio recalcula la cuota y la meta de todo el informe.',
  'Plan de cierre de brecha: la brecha del mes es meta − (proyección + cartera comprometida). Se reparte entre los clientes según su capacidad real (mejor mes de los últimos 12) y nunca se le pide a un cliente más de lo que ya vendió en su mejor mes.',
  'Si el margen real de la cartera no alcanza, los kg que faltan se muestran como «sin capacidad»: no se reparten a la fuerza ni se inventan clientes.',
  'La meta viva de Profit manda en el mes en curso. Si cambia, el reparto y el plan se recalculan en la misma consulta y siguen cuadrando al kilo; el aviso compara la lectura viva con el snapshot guardado.',
  'Cobranza a tiempo = cobros recibidos en el mes cuya fecha de pago no supera el vencimiento de la factura. El porcentaje se pondera por monto en USD, no por cantidad de facturas.',
  'Reactivado = cliente de la cartera sin compras en los 3 meses previos que vuelve a comprar este mes. Nuevo = cliente sin compras en los 12 meses previos que compra este mes. Inerte = cliente de la cartera sin compra este mes.',
  'Las cuotas de reactivación y clientes nuevos son mensuales y locales. Las fija quien tenga el permiso «Cuotas de vendedores»; un mes cerrado queda solo lectura.',
];

export const SELLER_COLUMN_HELP = {
  vendedor: {
    id: 'vendedor',
    title: 'Vendedor',
    short: 'Cartera asignada o facturado',
    what:
      'El vendedor agrupa los dos libros: su cartera asignada en Profit y las notas que firmó. La columna Clientes indica cuántos tiene en cartera y cuántos le compraron.',
    formula: 'clientes.co_ven → vendedor.ven_des; not_ent.co_ven → vendedor de la nota',
    source: 'clientes + not_ent + vendedor',
  },
  clientes: {
    id: 'clientes',
    title: 'Clientes',
    short: 'Cartera y clientes con venta',
    what:
      'Clientes asignados al vendedor en Profit (cartera) y, en la segunda cifra, los que tienen venta este mes. No cambia con la base de la cuota.',
    formula: 'COUNT(clientes.co_cli) y COUNT(DISTINCT not_ent.co_cli) del mes',
    source: 'clientes / not_ent',
  },
  cuota: {
    id: 'cuota',
    title: 'Cuota %',
    short: '% de la meta que le toca',
    what: 'Parte de la meta de la empresa que debe cumplir este vendedor, según su participación histórica.',
    formula: 'kg históricos del vendedor ÷ kg históricos de la red × 100',
    source: 'Ventana Histórico (3/6/12/24 meses)',
  },
  meta: {
    id: 'meta',
    title: 'Meta kg',
    short: 'Meta asignada al vendedor',
    what: 'Kilogramos que debe vender para cumplir su cuota. La suma de las metas de todos los vendedores es la meta de la empresa.',
    formula: 'meta de la empresa × cuota %',
    source: 'Forecast + reparto histórico',
  },
  facturado: {
    id: 'facturado',
    title: 'Facturado kg',
    short: 'Notas firmadas por él',
    what:
      'Kilogramos de las notas de entrega firmadas por el vendedor, sea o no su cliente. Es el libro «lo que vendí yo».',
    formula: 'Σ kg de not_ent donde not_ent.co_ven = vendedor',
    source: 'not_ent + reng_nde (solo ABA)',
  },
  cartera: {
    id: 'cartera',
    title: 'Cartera kg',
    short: 'Venta de sus clientes',
    what:
      'Kilogramos que compraron los clientes asignados al vendedor en Profit, sin importar quién firmó la nota. Es el libro «lo que compró mi cartera».',
    formula: 'Σ kg por clientes.co_ven (todos los vendedores de la nota)',
    source: 'clientes + not_ent',
  },
  otros: {
    id: 'otros',
    title: 'Por otros kg',
    short: 'Su cartera facturada por otros',
    what:
      'Parte de la cartera del vendedor que facturó otro vendedor. Es una oportunidad de recuperación: el cliente compra, pero la nota no es suya. Las cuentas internas 001/004 se muestran aparte.',
    formula: 'Σ kg de su cartera donde not_ent.co_ven ≠ clientes.co_ven',
    source: 'clientes + not_ent',
  },
  cumplimiento: {
    id: 'cumplimiento',
    title: 'Cumplimiento',
    short: 'Cierre estimado contra su meta',
    what:
      'Porcentaje que alcanzaría al cierre si mantiene el ritmo actual. La barra separa la venta real (azul) de la proyección (verde claro); la rayita verde es el 100 % de su cuota.',
    formula: 'proyección kg ÷ meta kg × 100',
    source: 'Se calcula con la meta del vendedor',
  },
  proyeccion: {
    id: 'proyeccion',
    title: 'Proyección kg',
    short: 'Cierre estimado del mes',
    what: 'Venta que alcanzaría al cierre si mantiene el ritmo actual. En un mes cerrado es la venta real.',
    formula: 'promedio por día × días del mes',
    source: 'Mismo motor que Ventas vs Forecast',
  },
  brecha: {
    id: 'brecha',
    title: 'Brecha kg',
    short: 'Cuánto le falta o sobra',
    what: 'Diferencia entre la proyección y su meta. Negativa = le falta; positiva = la supera.',
    formula: 'proyección kg − meta kg',
    source: 'Cálculo del API',
  },
  reparto: {
    id: 'reparto',
    title: 'Reparto del mes',
    short: 'Peso en la venta de la red',
    what: 'Porcentaje de la venta del mes que aporta este vendedor. Es la «representación» actual de cada uno.',
    formula: 'venta del vendedor ÷ venta de la red × 100',
    source: 'Mes del informe',
  },
  ultimaNota: {
    id: 'ultimaNota',
    title: 'Última nota',
    short: 'Última entrega registrada',
    what: 'Fecha de la última nota de entrega del vendedor dentro de la ventana consultada.',
    formula: 'MAX(not_ent.fec_emis)',
    source: 'not_ent',
  },
} satisfies Record<string, HelpTerm>;

export const SELLER_CLIENT_COLUMN_HELP = {
  cliente: {
    id: 'cli_cliente',
    title: 'Cliente',
    short: 'A quién le vendió',
    what:
      'Cliente de la cartera del vendedor o al que le firmó una nota, con su segmento, sus kg históricos y la fecha de su última nota. Si lo facturó otro vendedor, se indica debajo.',
    formula: 'clientes.co_cli → clientes.cli_des + tipo (o not_ent.co_cli)',
    source: 'clientes + not_ent',
  },
  metaCliente: {
    id: 'cli_meta',
    title: 'Meta kg',
    short: 'Meta asignada al cliente',
    what:
      'Kilogramos que debe comprar el cliente para que su vendedor cumpla su cuota. Debajo se muestra qué parte de la cuota del vendedor es (su porción del 100 %) y del forecast global.',
    formula: 'meta del vendedor × % del cliente en el vendedor',
    source: 'Reparto histórico',
  },
  shareCliente: {
    id: 'cli_share',
    title: '% de su cuota',
    short: 'Porción del 100 % del vendedor',
    what:
      'Parte de la cuota del vendedor que carga este cliente. Sus metas repartidas suman el 100 %; su cumplimiento se mide contra esa porción, no contra el forecast global.',
    formula: 'meta del cliente ÷ meta del vendedor × 100',
    source: 'Reparto histórico del vendedor',
  },
  aporteCliente: {
    id: 'cli_aporte',
    title: 'Aporte a brecha',
    short: 'Cuánto explica del faltante',
    what:
      'Kilogramos que este cliente aporta a la brecha del vendedor y qué porcentaje del faltante explica. En rojo, va por debajo de su parte; en verde, la compensa.',
    formula: 'brecha del cliente ÷ brecha del vendedor × 100',
    source: 'Cálculo del API',
  },
  ventaCliente: {
    id: 'cli_venta',
    title: 'Venta kg',
    short: 'Kg comprados en el mes',
    what: 'Kilogramos despachados al cliente en el mes, hasta el corte.',
    formula: 'Σ unidades × kg por unidad',
    source: 'not_ent + reng_nde',
  },
  cumplimientoCliente: {
    id: 'cli_cumplimiento',
    title: 'Cumplimiento',
    short: 'Cierre estimado contra su parte',
    what:
      'Porcentaje de su meta asignada que alcanzaría al cierre con el ritmo actual (arriba a la derecha de la fila). La línea de la cuota muestra además el avance real, y la barra mide contra su parte con el 100 % marcado. Sin meta queda en «—».',
    formula: 'proyección kg ÷ meta kg × 100',
    source: 'Cálculo del API',
  },
  proyeccionCliente: {
    id: 'cli_proyeccion',
    title: 'Proyección kg',
    short: 'Cierre estimado',
    what: 'Compra que alcanzaría al cierre si mantiene el ritmo actual.',
    formula: 'promedio por día × días del mes',
    source: 'Mismo motor que Ventas vs Forecast',
  },
  brechaCliente: {
    id: 'cli_brecha',
    title: 'Brecha kg',
    short: 'Cuánto le falta',
    what: 'Diferencia entre la proyección del cliente y su meta asignada.',
    formula: 'proyección kg − meta kg',
    source: 'Cálculo del API',
  },
} satisfies Record<string, HelpTerm>;

export type SellerHelpKey = keyof typeof SELLER_COLUMN_HELP;
export type SellerClientHelpKey = keyof typeof SELLER_CLIENT_COLUMN_HELP;

const SELLER_FICHA_HELP: HelpTerm[] = [
  {
    id: 'ficha_cobranza',
    title: 'Cobranza a tiempo',
    short: '% cobrado dentro del vencimiento',
    what:
      'Parte del monto cobrado en el mes que llegó en la fecha de vencimiento o antes. También muestra lo que llegó fuera de fecha, el promedio de días desde la emisión y el atraso promedio.',
    formula: 'monto cobrado a tiempo ÷ monto cobrado total × 100',
    source: 'cobros + reng_cob (Profit)',
  },
  {
    id: 'ficha_activacion',
    title: 'Activación de clientes',
    short: 'Clientes de la cartera con compra',
    what:
      'Clientes de la cartera asignada que compraron algo en el mes, contra el total de la cartera. Los que no compraron quedan como inertes.',
    formula: 'clientes activos ÷ clientes en cartera × 100',
    source: 'clientes.co_ven + not_ent',
  },
  {
    id: 'ficha_reactivacion',
    title: 'Cuota de reactivación',
    short: 'Clientes dormidos que vuelven',
    what:
      'Clientes de su cartera que no compraban desde hacía al menos 3 meses y volvieron a comprar este mes. La cuota la fija un usuario con el permiso especial.',
    formula: 'reactivados ÷ cuota de reactivación × 100',
    source: 'SellerQuota + not_ent',
  },
  {
    id: 'ficha_nuevos',
    title: 'Cuota de clientes nuevos',
    short: 'Clientes sin compra en 12 meses',
    what:
      'Clientes sin compras en los 12 meses previos que compran este mes. La cuota es mensual y se administra desde el expediente del vendedor.',
    formula: 'nuevos ÷ cuota de nuevos × 100',
    source: 'SellerQuota + not_ent',
  },
];

export const SELLERS_HELP_TERMS: HelpTerm[] = [
  ...Object.values(SELLER_COLUMN_HELP),
  ...Object.values(SELLER_CLIENT_COLUMN_HELP),
  ...SELLER_FICHA_HELP,
];
