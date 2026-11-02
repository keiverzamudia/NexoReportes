import { describe, expect, it } from 'vitest';
import type { LoadPlan } from '@nexo/contracts';
import {
  MAX_TRUCK_SPACES,
  assignOrder,
  clearSlot,
  createPlan,
  fitPlanToOrders,
  ordersByNumber,
  ordersFromLines,
  placedTotals,
  planHasOrders,
  prunePlan,
  resizePlan,
  slotLabel,
  unplacedOrders,
  type LoadPlanLine,
  type TruckOrder,
} from './truck-load-plan';

function line(overrides: Partial<LoadPlanLine> = {}): LoadPlanLine {
  return {
    orderNumber: '9098',
    customerCode: 'C-1',
    customerName: 'GERMAN G MOTA',
    productCode: 'ABAPOR77',
    kg: 1200,
    sacks: 30,
    uom: 'SAC',
    effectiveDate: '2026-10-29',
    comment: null,
    ...overrides,
  };
}

function order(overrides: Partial<TruckOrder> = {}): TruckOrder {
  return {
    orderNumber: '9098',
    customerCode: 'C-1',
    customerName: 'GERMAN G MOTA',
    kg: 1200,
    sacks: 30,
    comments: [],
    dates: [],
    ...overrides,
  };
}

describe('guía de carga del camión', () => {
  it('agrupa los renglones por pedido y suma kg, sacos y comentarios', () => {
    const orders = ordersFromLines([
      line({ orderNumber: '9112', kg: 800, sacks: 20, comment: 'Retira Elías' }),
      line({ orderNumber: '9098', kg: 1200, sacks: 30, comment: 'Retira Elías' }),
      line({ orderNumber: '9098', productCode: 'OTRO', kg: 300, sacks: 5, comment: 'Retira Elías' }),
    ]);

    expect(orders.map((item) => item.orderNumber)).toEqual(['9098', '9112']);
    expect(orders[0]!.kg).toBe(1500);
    expect(orders[0]!.sacks).toBe(35);
    expect(orders[0]!.comments).toEqual(['Retira Elías']);
  });

  it('crea un camión con espacios vacíos y respeta el máximo', () => {
    const plan = createPlan(3);
    expect(plan.segments).toHaveLength(3);
    expect(plan.segments[0]!.label).toBe('Espacio 1');
    expect(plan.segments[0]!.orderNumbers).toEqual([]);

    expect(createPlan(0).segments).toHaveLength(1);
    expect(createPlan(99).segments).toHaveLength(MAX_TRUCK_SPACES);
  });

  it('ubica un pedido por espacio y lo mueve si ya estaba en otro', () => {
    const pedido = order();
    let plan = createPlan(3);

    plan = assignOrder(plan, pedido, 1);
    expect(plan.segments[1]!.orderNumbers).toEqual(['9098']);
    expect(plan.segments[1]!.label).toBe('GERMAN G MOTA');
    expect(plan.segments[1]!.kg).toBe(1200);

    plan = assignOrder(plan, pedido, 2);
    expect(plan.segments[1]!.orderNumbers).toEqual([]);
    expect(plan.segments[2]!.orderNumbers).toEqual(['9098']);
    expect(unplacedOrders([pedido], plan)).toHaveLength(0);
  });

  it('devuelve a la bandeja el pedido que ocupaba el espacio destino', () => {
    const primero = order({ orderNumber: '9098' });
    const segundo = order({ orderNumber: '9112', customerName: 'ACHAGUAS' });
    let plan = createPlan(2);

    plan = assignOrder(plan, primero, 0);
    plan = assignOrder(plan, segundo, 0);

    expect(plan.segments[0]!.orderNumbers).toEqual(['9112']);
    expect(unplacedOrders([primero, segundo], plan)).toEqual([primero]);
    expect(clearSlot(plan, 0).segments[0]!.orderNumbers).toEqual([]);
  });

  it('al reducir espacios devuelve los pedidos sobrantes a la bandeja', () => {
    const pedido = order();
    let plan = createPlan(4);
    plan = assignOrder(plan, pedido, 3);

    plan = resizePlan(plan, 2);
    expect(plan.segments).toHaveLength(2);
    expect(unplacedOrders([pedido], plan)).toEqual([pedido]);

    plan = resizePlan(plan, 6);
    expect(plan.segments).toHaveLength(6);
    expect(plan.segments[5]!.label).toBe('Espacio 6');
  });

  it('poda los pedidos que ya no están en el plan sin tocar el resto', () => {
    const pedido = order();
    let plan = createPlan(2);
    plan = assignOrder(plan, pedido, 0);

    expect(prunePlan(plan, new Set(['9098']))).toBe(plan);

    const podado = prunePlan(plan, new Set(['otro']));
    expect(podado.segments[0]!.orderNumbers).toEqual([]);
    expect(podado.segments[0]!.label).toBe('Espacio 1');
    expect(planHasOrders(podado)).toBe(false);
  });

  it('calcula los totales sólo con los pedidos ubicados', () => {
    const primero = order({ orderNumber: '9098', kg: 1200, sacks: 30 });
    const segundo = order({ orderNumber: '9112', kg: 800, sacks: 20 });
    let plan = createPlan(3);
    plan = assignOrder(plan, primero, 0);

    expect(placedTotals([primero, segundo], plan)).toEqual({ kg: 1200, sacks: 30 });

    // Plan histórico con varios pedidos en un mismo bloque: cuenta todos.
    const legacy: LoadPlan = {
      ...createPlan(1),
      segments: [{ ...createPlan(1).segments[0]!, orderNumbers: ['9098', '9112'] }],
    };
    expect(placedTotals([primero, segundo], legacy)).toEqual({ kg: 2000, sacks: 50 });

    expect(planHasOrders(plan)).toBe(true);
    expect(planHasOrders(createPlan(2))).toBe(false);
  });

  it('separa los bloques históricos en un pedido por espacio', () => {
    const primero = order({ orderNumber: '9098' });
    const segundo = order({ orderNumber: '9112', customerName: 'ACHAGUAS' });
    const legacy: LoadPlan = {
      ...createPlan(1),
      segments: [
        {
          id: 'legacy-1',
          label: 'CLIENTE',
          customerCode: 'C-1',
          orderNumbers: ['9098', '9112'],
          kg: 2000,
          sacks: 50,
        },
      ],
    };

    const fitted = fitPlanToOrders(legacy, [primero, segundo]);
    expect(fitted.segments).toHaveLength(2);
    expect(fitted.segments.map((segment) => segment.orderNumbers)).toEqual([['9098'], ['9112']]);
  });

  it('prepara el plan para editar: máximo 6 espacios y etiqueta el cliente', () => {
    const pedido = order();
    const plan = fitPlanToOrders(
      { ...createPlan(6), segments: [...createPlan(6).segments, createPlan(1).segments[0]!] },
      [pedido],
    );

    expect(plan.segments).toHaveLength(MAX_TRUCK_SPACES);
    expect(slotLabel(plan.segments[0]!, 0, ordersByNumber([pedido]))).toBe('Espacio 1');
    expect(fitPlanToOrders(null, []).segments).toHaveLength(1);
  });
});
