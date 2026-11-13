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
  'El criterio Cartera usa clientes.co_ven: cada cliente pertenece al vendedor que tiene asignado hoy en Profit. El criterio Nota de entrega usa not_ent.co_ven.',
  'En Cartera la cartera se muestra completa, aunque el cliente no haya comprado. Los clientes inactivos se excluyen.',
  'Venta = nota de entrega no anulada, línea ABA y artículo activo; misma fuente que Ventas vs Forecast.',
  'La meta de la empresa es la misma del informe Ventas vs Forecast: viva de Profit o snapshot guardado.',
  'La cuota de cada vendedor es su participación en los kg de los últimos meses cerrados del filtro Histórico.',
  'La meta del vendedor = meta de la empresa × su cuota. La suma de todas las metas cuadra al kilo con la meta de la empresa.',
  'La meta de cada cliente = meta de su vendedor × su participación en la venta histórica de ese vendedor.',
  'Reparto del mes = venta del vendedor ÷ venta total de la red. Responde «qué representación tiene cada uno».',
  'El cumplimiento compara la venta contra la meta ASIGNADA, no contra el forecast global.',
  'Sin histórico la cuota se reparte en partes iguales y se avisa; sin meta los porcentajes quedan en «—».',
  'Corte a ayer y días hábiles de lunes a sábado, igual que el informe de ventas.',
  'Si Profit no responde, la pantalla avisa y no pinta ceros como si fueran ventas.',
  'Las cuentas internas 001 LA EMPRESA y 004 EQUIPO DE VENTAS participan como un vendedor más y se marcan en la tabla.',
  'En el expediente, la pestaña Cartera muestra la cartera completa (con venta y sin venta); la pestaña Nota muestra solo los clientes con notas firmadas por el vendedor.',
  'La pestaña Productos cruza cada artículo: cartera asignada, firmado por el vendedor y cartera facturada por otros.',
  'El histórico del expediente arranca en 3 meses y se puede cambiar allí; ese cambio recalcula la cuota y la meta de todo el informe.',
];

export const SELLER_COLUMN_HELP = {
  vendedor: {
    id: 'vendedor',
    title: 'Vendedor',
    short: 'Cartera asignada o nota',
    what:
      'En el criterio Cartera, el vendedor que tiene asignado el cliente en Profit. En Nota de entrega, quien firmó la venta. Agrupa la cartera, la venta y la cuota.',
    formula: 'clientes.co_ven → vendedor.ven_des (o not_ent.co_ven)',
    source: 'clientes + not_ent + vendedor',
  },
  clientes: {
    id: 'clientes',
    title: 'Clientes',
    short: 'Cartera y clientes con venta',
    what:
      'Clientes de la lista según el criterio. En Cartera es la cartera completa asignada en Profit; en Nota, los que compraron a ese vendedor. La segunda cifra son los que tienen venta en el mes.',
    formula: 'COUNT(clientes.co_cli) o COUNT(DISTINCT not_ent.co_cli)',
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
  venta: {
    id: 'venta',
    title: 'Venta kg',
    short: 'Kg despachados en el mes',
    what: 'Kilogramos despachados por el vendedor en el mes, hasta el corte.',
    formula: 'Σ unidades × kg por unidad',
    source: 'not_ent + reng_nde (solo ABA)',
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
  ritmo: {
    id: 'ritmo',
    title: 'Ritmo nec.',
    short: 'Kg/día para llegar',
    what: 'Kilogramos por día que debe vender en los días hábiles restantes para alcanzar su meta.',
    formula: 'max(0, meta − venta) ÷ días hábiles restantes',
    source: 'Solo mes en curso',
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
      'Cliente de la cartera del vendedor (o que le compró, según el criterio), con su segmento, sus kg históricos y la fecha de su última nota. Si lo facturó otro vendedor, se indica debajo.',
    formula: 'clientes.co_cli → clientes.cli_des + tipo (o not_ent.co_cli)',
    source: 'clientes + not_ent',
  },
  metaCliente: {
    id: 'cli_meta',
    title: 'Meta kg',
    short: 'Meta asignada al cliente',
    what:
      'Kilogramos que debe comprar el cliente para que su vendedor cumpla su cuota. Debajo se muestra su peso en la venta histórica del vendedor. La parte que representa del forecast global se ve en el CSV.',
    formula: 'meta del vendedor × % del cliente en el vendedor',
    source: 'Reparto histórico',
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
    short: 'Cierre estimado contra su meta',
    what: 'Porcentaje de su meta asignada que alcanzaría al cierre con el ritmo actual. Sin meta queda en «—».',
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

export const SELLERS_HELP_TERMS: HelpTerm[] = [
  ...Object.values(SELLER_COLUMN_HELP),
  ...Object.values(SELLER_CLIENT_COLUMN_HELP),
];
