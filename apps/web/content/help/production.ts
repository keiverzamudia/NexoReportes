import type { HelpTerm } from './types';

// ============================================================
// Ayuda contextual de «Producción».
//
// Un solo sitio para las definiciones y fórmulas. El mismo término alimenta:
//  · el icono ⓘ del encabezado de la columna (`ColumnHelp`),
//  · la fila opcional de explicaciones de la tabla,
//  · el cajón «¿Cómo se calcula?» de la pestaña activa (`ModuleHelp`).
//
// No explica funciones que el API todavía no calcula. Si una métrica cambia
// en `production.service.ts`, se actualiza aquí y el test lo vigila.
// ============================================================

export type ProductionTab =
  | 'summary'
  | 'plan'
  | 'selection'
  | 'explosion'
  | 'formulas'
  | 'nutrition'
  | 'scenarios';

export type ProductionTabHelp = {
  title: string;
  narrative: string;
  rules: string[];
  triggerLabel: string;
  terms: HelpTerm[];
  termsLabel: string;
};

export const PROD_PLAN_HELP = {
  forecast: {
    id: 'plan.forecast',
    title: 'Forecast del periodo',
    short: 'Meta de venta del periodo',
    what: 'Meta de venta del mes o de la semana según Profit, normalizada a kilos.',
    formula: 'forecast mensual en kg ÷ días del mes × días del bloque',
    source: 'Profit · forecast',
  },
  sold: {
    id: 'plan.sold',
    title: 'Despachado',
    short: 'Kg ya entregados',
    what: 'Kilos que ya salieron en notas de entrega no anuladas dentro del periodo.',
    formula: 'Σ kg de notas de entrega no anuladas',
    source: 'Profit · notas de entrega',
  },
  orders: {
    id: 'plan.orders',
    title: 'Cartera pendiente',
    short: 'Pedidos pendientes',
    what: 'Kilos de pedidos activos que todavía no se despachan y tienen entrega efectiva en el periodo.',
    formula: 'Σ pendingKg de pedidos activos',
    source: 'Profit · pedidos',
  },
  remaining: {
    id: 'plan.remaining',
    title: 'Forecast por cumplir',
    short: 'Meta que falta vender',
    what: 'Parte de la meta que aún no se ha despachado. Nunca es negativa.',
    formula: 'máx(0, forecast − despachado)',
  },
  stock: {
    id: 'plan.stock',
    title: 'Stock PT',
    short: 'Producto terminado disponible',
    what: 'Existencia de producto terminado en los almacenes PTP, 03, 9999 y 6804.',
    formula: 'Σ existencias de PTP + 03 + 9999 + 6804',
    source: 'Profit · existencias',
  },
  safety: {
    id: 'plan.safety',
    title: 'Stock de seguridad',
    short: 'Colchón mínimo',
    what: 'Kilos extra que se reservan para no quedar sin producto; depende de la política del artículo.',
    formula: 'política por producto: % de la demanda, días de cobertura o kg fijos',
    source: 'Nexo · política de seguridad',
  },
  demand: {
    id: 'plan.demand',
    title: 'Demanda a cubrir',
    short: 'Lo que pide la política',
    what: 'Demanda que producción debe atender según la política elegida.',
    formula: 'MAX: máx(forecast por cumplir, cartera) · FORECAST: restante · ORDERS: cartera · SUM: ambos',
    source: 'Nexo · política de demanda',
  },
  required: {
    id: 'plan.required',
    title: 'Faltante de producción',
    short: 'Lo que falta producir',
    what: 'Kilos que faltan después de descontar el stock disponible y el stock de seguridad.',
    formula: 'máx(0, demanda + seguridad − stock)',
    source: 'Nexo · cálculo',
  },
  sacks: {
    id: 'plan.sacks',
    title: 'Sacos por producir',
    short: 'Equivalente en sacos',
    what: 'Faltante convertido a sacos según los kilos por unidad del producto. En granel puede no aplicar.',
    formula: 'faltante ÷ kg por saco',
    source: 'Profit · catálogo',
  },
  batches: {
    id: 'plan.batches',
    title: 'Lotes',
    short: 'Lotes completos a producir',
    what: 'Cantidad de lotes necesarios para cubrir el faltante, redondeando siempre hacia arriba.',
    formula: 'ceil(faltante ÷ tamaño de lote)',
    source: 'Nexo · cálculo',
  },
  formula: {
    id: 'plan.formula',
    title: 'Cédula',
    short: 'Receta principal',
    what: 'Cédula de Profit que se usa para producir el artículo. El tipo indica maestra, base o lote.',
    formula: 'preferencia del producto o cédula principal de Profit',
    source: 'Profit · cédulas',
  },
  cost: {
    id: 'plan.cost',
    title: 'Costo por kg',
    short: 'Costo de la receta',
    what: 'Costo de un kilo con la última valoración de costos de Profit.',
    formula: 'Σ cantidad del componente × costo unitario',
    source: 'Profit · costos',
  },
  totalCost: {
    id: 'plan.totalCost',
    title: 'Costo del plan',
    short: 'Costo de lo producido',
    what: 'Costo total de la producción real del producto en el periodo.',
    formula: 'costo por kg × producción real',
    source: 'Nexo · cálculo',
  },
  status: {
    id: 'plan.status',
    title: 'Estado',
    short: 'Semáforo del producto',
    what: 'Resume si el producto está cubierto, hay que producirlo o le falta cédula o costo para calcularlo.',
    formula: 'Cubierto · Producir · Sin cédula · Sin costo',
    source: 'Nexo · regla de estado',
  },
  production: {
    id: 'plan.production',
    title: 'Producción real',
    short: 'Kg al redondear lotes',
    what: 'Kilos que realmente se producirán al completar los lotes sugeridos.',
    formula: 'lotes × tamaño de lote',
    source: 'Nexo · cálculo',
  },
  overproduction: {
    id: 'plan.overproduction',
    title: 'Sobreproducción',
    short: 'Exceso por redondear',
    what: 'Kilos adicionales que genera el redondeo a lotes completos.',
    formula: 'producción real − faltante',
    source: 'Nexo · cálculo',
  },
} satisfies Record<string, HelpTerm>;

export const PROD_MATERIAL_HELP = {
  type: {
    id: 'material.type',
    title: 'Tipo',
    short: 'Macro, micro o empaque',
    what: 'Clasificación del material dentro de la fórmula.',
    formula: 'MACROS · MICROS · EMPAQ',
    source: 'Profit · catálogo',
  },
  required: {
    id: 'material.required',
    title: 'Requerido',
    short: 'Material para el plan',
    what: 'Cantidad de material que consume la producción real del periodo.',
    formula: 'Σ componente de la cédula × kg producidos',
    source: 'Nexo · explosión',
  },
  stock: {
    id: 'material.stock',
    title: 'Stock MP',
    short: 'Materia prima disponible',
    what: 'Existencia actual del material en los almacenes de materia prima.',
    formula: 'Σ existencias del artículo',
    source: 'Profit · existencias',
  },
  incoming: {
    id: 'material.incoming',
    title: 'Por llegar',
    short: 'Compras en tránsito',
    what: 'Cantidad de compras pendientes con fecha de llegada dentro del periodo.',
    formula: 'Σ órdenes de compra pendientes',
    source: 'Profit · compras',
  },
  purchase: {
    id: 'material.purchase',
    title: 'Por comprar',
    short: 'Faltante de material',
    what: 'Lo que falta comprar después de descontar el stock y las compras pendientes.',
    formula: 'máx(0, requerido − stock − por llegar)',
    source: 'Nexo · cálculo',
  },
  unitCost: {
    id: 'material.unitCost',
    title: 'Costo unitario',
    short: 'Costo por unidad',
    what: 'Costo unitario vigente del material en Profit.',
    formula: 'último costo de compra',
    source: 'Profit · costos',
  },
  purchaseCost: {
    id: 'material.purchaseCost',
    title: 'Costo de compra',
    short: 'Dinero para cubrir',
    what: 'Dinero necesario para comprar el faltante del material.',
    formula: 'por comprar × costo unitario',
    source: 'Nexo · cálculo',
  },
  coverage: {
    id: 'material.coverage',
    title: 'Cobertura de material',
    short: 'Días de stock',
    what: 'Para cuántos días alcanza el stock del material al ritmo de consumo del plan.',
    formula: 'stock ÷ (requerido ÷ días del periodo)',
    source: 'Nexo · cálculo',
  },
  supplier: {
    id: 'material.supplier',
    title: 'Proveedor / llegada',
    short: 'Origen de la compra',
    what: 'Proveedor y fecha esperada de la compra pendiente que cubre el material.',
    formula: 'última orden de compra pendiente',
    source: 'Profit · compras',
  },
} satisfies Record<string, HelpTerm>;

export const PROD_FORMULA_HELP = {
  formula: {
    id: 'formula.main',
    title: 'Cédula principal',
    short: 'Receta que usa el plan',
    what: 'Cédula elegida como principal para el producto. Se puede cambiar con el botón «Principal».',
    formula: 'preferencia local o cédula estándar',
    source: 'Profit + preferencia local',
  },
  batch: {
    id: 'formula.batch',
    title: 'Lote kg',
    short: 'Kg por lote',
    what: 'Kilos que rinde un lote completo de la cédula.',
    formula: 'salida de la cédula en kg',
    source: 'Profit · cédulas',
  },
  costKg: {
    id: 'formula.costKg',
    title: 'Costo/kg',
    short: 'Costo de un kilo',
    what: 'Costo teórico de un kilo con los costos actuales de Profit.',
    formula: 'Σ cantidad × costo unitario',
    source: 'Profit · costos',
  },
  costSack: {
    id: 'formula.costSack',
    title: 'Costo/saco',
    short: 'Costo por saco',
    what: 'Costo de un saco completo, incluyendo el empaque cuando está configurado.',
    formula: 'costo/kg × kg por saco + empaque',
    source: 'Nexo · cálculo',
  },
  count: {
    id: 'formula.count',
    title: 'Cédulas',
    short: 'Recetas disponibles',
    what: 'Cuántas cédulas o lotes tiene el producto en Profit.',
    formula: 'conteo de cédulas',
    source: 'Profit · cédulas',
  },
  packaging: {
    id: 'formula.packaging',
    title: 'Empaque',
    short: 'Saco asignado',
    what: 'Material de empaque configurado para el producto.',
    formula: 'regla de empaque local',
    source: 'Configuración · empaque',
  },
  alerts: {
    id: 'formula.alerts',
    title: 'Alertas',
    short: 'Avisos de la cédula',
    what: 'Avisos de fórmula incompleta, costo faltante o empaque sin configurar.',
    formula: '0 = OK · N = cantidad de avisos',
    source: 'Nexo · validaciones',
  },
} satisfies Record<string, HelpTerm>;

export const PROD_SELECTION_HELP = {
  pending: {
    id: 'selection.pending',
    title: 'Cartera kg',
    short: 'Kg pendientes',
    what: 'Kilos pendientes de los pedidos agrupados en el periodo.',
    formula: 'Σ pendingKg del grupo',
    source: 'Profit · pedidos',
  },
  stock: {
    id: 'selection.stock',
    title: 'Stock kg',
    short: 'Producto terminado',
    what: 'Stock del producto para medir el riesgo. Solo aplica cuando se agrupa por producto.',
    formula: 'stock PT del artículo',
    source: 'Profit · existencias',
  },
  coverage: {
    id: 'selection.coverage',
    title: 'Cobertura',
    short: 'Días de stock',
    what: 'Para cuántos días alcanza el stock del producto al ritmo de la cartera.',
    formula: 'stock ÷ (cartera ÷ días del periodo)',
    source: 'Nexo · cálculo',
  },
  dispatch: {
    id: 'selection.dispatch',
    title: 'En despacho',
    short: 'Pedidos en nota',
    what: 'Pedidos del grupo que ya tienen una nota de despacho asociada.',
    formula: 'conteo de pedidos con nota',
    source: 'Profit · despacho',
  },
  risk: {
    id: 'selection.risk',
    title: 'Riesgo de pedido',
    short: 'Urgencia del pedido',
    what: 'Clasificación de la cartera según los días de cobertura del stock.',
    formula: 'ALTO < 1 día · MEDIO 1–3 días · BAJO 3+ días · CUBIERTO stock ≥ pedido',
    source: 'Nexo · regla de riesgo',
  },
} satisfies Record<string, HelpTerm>;

export const PROD_NUTRITION_HELP = {
  coverage: {
    id: 'nutrition.coverage',
    title: 'Cobertura de datos',
    short: '% de la fórmula con análisis',
    what: 'Porcentaje de la fórmula que tiene valores de nutrientes cargados.',
    formula: 'componentes con datos ÷ componentes totales',
    source: 'Nexo · matriz de nutrientes',
  },
  status: {
    id: 'nutrition.status',
    title: 'Estado del nutriente',
    short: 'OK, bajo, alto o sin dato',
    what: 'Compara el valor calculado contra el mínimo, máximo y objetivo del producto.',
    formula: 'OK dentro del rango · LOW bajo el mínimo · HIGH sobre el máximo · NO_DATA sin análisis',
    source: 'Nexo · especificaciones',
  },
  nutrient: {
    id: 'nutrition.nutrient',
    title: 'Nutriente',
    short: 'Aporte calculado',
    what: 'Valor del nutriente calculado por la composición de la cédula.',
    formula: 'Σ (aporte del ingrediente × kg del ingrediente) ÷ kg de la fórmula',
    source: 'Nexo · cálculo',
  },
} satisfies Record<string, HelpTerm>;

export const PROD_SUMMARY_HELP = {
  forecast: {
    ...PROD_PLAN_HELP.forecast,
    id: 'summary.forecast',
  },
  sold: {
    ...PROD_PLAN_HELP.sold,
    id: 'summary.sold',
  },
  orders: {
    ...PROD_PLAN_HELP.orders,
    id: 'summary.orders',
  },
  demand: {
    ...PROD_PLAN_HELP.demand,
    id: 'summary.demand',
  },
  production: {
    ...PROD_PLAN_HELP.production,
    id: 'summary.production',
  },
  overproduction: {
    ...PROD_PLAN_HELP.overproduction,
    id: 'summary.overproduction',
  },
  cost: {
    id: 'summary.cost',
    title: 'Costo del plan',
    short: 'Costo de la producción',
    what: 'Costo total de la producción real del periodo con la moneda elegida.',
    formula: 'costo por kg × producción real',
    source: 'Nexo · cálculo',
  },
  materials: {
    id: 'summary.materials',
    title: 'Materiales por comprar',
    short: 'Materiales con faltante',
    what: 'Cantidad de materiales que no se cubren con stock ni con compras en tránsito.',
    formula: 'conteo de materiales con por comprar > 0',
    source: 'Nexo · explosión',
  },
  riskLines: {
    id: 'summary.riskLines',
    title: 'Pedidos en riesgo',
    short: 'Líneas urgentes',
    what: 'Líneas de pedido con riesgo alto o medio frente al stock disponible.',
    formula: 'conteo de líneas con riesgo ALTO o MEDIO',
    source: 'Nexo · regla de riesgo',
  },
} satisfies Record<string, HelpTerm>;

export const PROD_SCENARIO_HELP = {
  scenario: {
    id: 'scenario.snapshot',
    title: 'Escenario guardado',
    short: 'Foto del plan',
    what: 'Guarda el plan, la explosión y la selección del periodo para compararlos después.',
    formula: 'plan + explosión + selección + ajustes',
    source: 'Nexo · escenarios',
  },
} satisfies Record<string, HelpTerm>;

export const PROD_TAB_HELP: Record<ProductionTab, ProductionTabHelp> = {
  summary: {
    title: 'Cómo leer el resumen',
    narrative: 'Qué producir, qué comprar y qué pedidos están en riesgo en el periodo.',
    rules: [
      'Los KPIs usan el mes, la semana, la política y la moneda activos.',
      'El estado del plan cuenta los productos del plan actual, incluso si hay una simulación.',
      'Los top se ordenan por costo de compra y por kilos pendientes.',
    ],
    triggerLabel: '¿Qué muestra?',
    termsLabel: 'Conceptos',
    terms: Object.values(PROD_SUMMARY_HELP),
  },
  plan: {
    title: 'Cómo se calcula el plan',
    narrative: 'Cada producto calcula su faltante, lo redondea a lotes y estima el costo con la cédula principal.',
    rules: [
      'El faltante descuenta stock PT y stock de seguridad antes de redondear.',
      'El redondeo a lotes puede generar sobreproducción; se muestra en la fila.',
      'La simulación con ajustes es local: no escribe en Profit.',
    ],
    triggerLabel: '¿Cómo se calcula?',
    termsLabel: 'Conceptos y columnas',
    terms: Object.values(PROD_PLAN_HELP),
  },
  selection: {
    title: 'Cómo se lee la selección',
    narrative: 'La cartera se agrupa por producto o cliente para elegir qué pedidos atender y simular.',
    rules: [
      'Solo entran pedidos activos con entrega efectiva en el periodo.',
      'El riesgo se mide por días de cobertura del stock.',
      'La simulación recalcula plan y explosión solo con lo seleccionado.',
    ],
    triggerLabel: '¿Cómo se lee?',
    termsLabel: 'Conceptos y columnas',
    terms: [PROD_SELECTION_HELP.pending, PROD_SELECTION_HELP.stock, PROD_SELECTION_HELP.coverage, PROD_SELECTION_HELP.dispatch, PROD_SELECTION_HELP.risk],
  },
  explosion: {
    title: 'Cómo se calcula la explosión',
    narrative: 'Los materiales se explotan desde la producción real y se comparan con stock y compras pendientes.',
    rules: [
      'Se explota la producción real, no el faltante.',
      'El stock y las compras en tránsito se descuentan antes de comprar.',
      'La cobertura usa el consumo diario implícito del plan.',
    ],
    triggerLabel: '¿Cómo se calcula?',
    termsLabel: 'Conceptos y columnas',
    terms: Object.values(PROD_MATERIAL_HELP),
  },
  formulas: {
    title: 'Cómo se calculan las fórmulas',
    narrative: 'La ficha de fórmulas muestra la cédula principal, sus componentes, costo y empaque.',
    rules: [
      'La cédula principal se puede cambiar por producto.',
      'El costo se calcula con la última valoración de Profit.',
      'El empaque configurado suma al costo por saco.',
    ],
    triggerLabel: '¿Cómo se calcula?',
    termsLabel: 'Conceptos y columnas',
    terms: Object.values(PROD_FORMULA_HELP),
  },
  nutrition: {
    title: 'Cómo se lee la nutrición',
    narrative: 'La matriz de nutrientes calcula el aporte de la fórmula y lo compara con la especificación.',
    rules: [
      'La cobertura indica qué parte de la fórmula tiene análisis cargados.',
      'Los nutrientes se calculan por composición, no se digitan.',
      'Las especificaciones definen si el valor está OK, bajo o alto.',
    ],
    triggerLabel: '¿Cómo se lee?',
    termsLabel: 'Conceptos',
    terms: Object.values(PROD_NUTRITION_HELP),
  },
  scenarios: {
    title: 'Qué guarda un escenario',
    narrative: 'Un escenario conserva una foto del plan para comparar contra otro periodo o política.',
    rules: [
      'El escenario guarda una foto del plan, la explosión y la selección.',
      'No vuelve a consultar Profit hasta que lo abras.',
      'Sirve para comparar periodo, política y moneda.',
    ],
    triggerLabel: '¿Qué guarda?',
    termsLabel: 'Conceptos',
    terms: [PROD_SCENARIO_HELP.scenario],
  },
};
