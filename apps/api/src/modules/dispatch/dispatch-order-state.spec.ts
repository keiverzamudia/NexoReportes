import { describe, expect, it } from 'vitest';
import {
  dispatchLineKey,
  loadDispatchStates,
  loadLineDispatchStates,
  plannableQtyFor,
} from './dispatch-order-state';

// ============================================================
// Estado de despacho POR RENGLÓN.
//
// Regla: un renglón queda bloqueado mientras su hoja siga abierta para ese
// cliente. Cuando la hoja se cierra, vuelve a la cartera solo el saldo no
// cargado (cantidad pedida − unidades cargadas), nunca más que el pendiente
// que reporta Profit.
// ============================================================

type Row = Record<string, any>;

function line(overrides: Row = {}): Row {
  return {
    orderNumber: '7021',
    productCode: 'ABAPOR77',
    customerCode: '500639392',
    customerName: 'AGROCENTRO 2020, C.A',
    status: 'CARGADO',
    plannedQty: 20,
    loadedQty: 15,
    checkedAt: null,
    sheet: {
      id: 'sheet-1',
      number: 'DSP-2026-0022',
      status: 'EN_PROCESO',
      customerProgress: [
        {
          customerKey: '500639392',
          loadStartedAt: new Date('2026-11-20T14:00:00.000Z'),
          loadClosedAt: new Date('2026-11-20T15:00:00.000Z'),
          invoiceDeliveredAt: new Date('2026-11-20T16:00:00.000Z'),
        },
      ],
    },
    ...overrides,
  };
}

function prismaWith(rows: Row[]) {
  return {
    dispatchSheetLine: {
      findMany: async () => rows,
    },
  } as never;
}

describe('dispatchLineKey', () => {
  it('usa pedido#artículo y tolera nulos', () => {
    expect(dispatchLineKey({ orderNumber: ' 7021 ', productCode: 'ABAPOR77' })).toBe('7021#ABAPOR77');
    expect(dispatchLineKey({ orderNumber: null, productCode: null })).toBe('#');
  });
});

describe('plannableQtyFor', () => {
  it('sin despacho previo deja todo el pendiente de Profit', () => {
    expect(plannableQtyFor(undefined, { pendingQty: 20, quantity: 20 })).toBe(20);
  });

  it('con la hoja abierta mantiene el pendiente (el renglón se filtra aparte)', () => {
    const state = {
      openSheetId: 'sheet-1',
      openSheetNumber: 'DSP-2026-0022',
      loadedQty: 15,
      started: true,
    };
    expect(plannableQtyFor(state, { pendingQty: 20, quantity: 20 })).toBe(20);
  });

  it('con la hoja cerrada devuelve solo el saldo no cargado', () => {
    const state = {
      openSheetId: null,
      openSheetNumber: null,
      loadedQty: 15,
      started: true,
    };
    expect(plannableQtyFor(state, { pendingQty: 20, quantity: 20 })).toBe(5);
  });

  it('no deja planificar más que el pendiente de Profit', () => {
    const state = {
      openSheetId: null,
      openSheetNumber: null,
      loadedQty: 5,
      started: false,
    };
    // Profit ya refleja la entrega: pendiente 3, aunque quantity−cargado = 15.
    expect(plannableQtyFor(state, { pendingQty: 3, quantity: 20 })).toBe(3);
  });

  it('un renglón ya cubierto no vuelve a la cartera', () => {
    const state = {
      openSheetId: null,
      openSheetNumber: null,
      loadedQty: 20,
      started: false,
    };
    expect(plannableQtyFor(state, { pendingQty: 20, quantity: 20 })).toBe(0);
  });

  it('conserva los pendientes negativos (sobre-compromiso de Profit)', () => {
    expect(plannableQtyFor(undefined, { pendingQty: -247, quantity: -247 })).toBe(-247);
  });
});

describe('loadDispatchStates', () => {
  it('marca el renglón como libre cuando el cliente ya cerró su hoja', async () => {
    const states = await loadDispatchStates(prismaWith([line()]), ['7021']);
    expect(states.lines.get('7021#ABAPOR77')).toMatchObject({
      openSheetNumber: null,
      loadedQty: 15,
      started: true,
    });
    expect(states.orders.get('7021')).toMatchObject({
      sheetNumber: 'DSP-2026-0022',
      inDispatch: true,
      started: true,
    });
  });

  it('bloquea el renglón mientras la hoja siga abierta para ese cliente', async () => {
    const states = await loadDispatchStates(
      prismaWith([
        line({
          sheet: {
            id: 'sheet-1',
            number: 'DSP-2026-0022',
            status: 'EN_PROCESO',
            customerProgress: [
              {
                customerKey: '500639392',
                loadStartedAt: new Date('2026-11-20T14:00:00.000Z'),
                loadClosedAt: null,
                invoiceDeliveredAt: null,
              },
            ],
          },
        }),
      ]),
      ['7021'],
    );
    expect(states.lines.get('7021#ABAPOR77')?.openSheetNumber).toBe('DSP-2026-0022');
  });

  it('ignora hojas anuladas y renglones anulados', async () => {
    const states = await loadDispatchStates(
      prismaWith([
        line({ status: 'ANULADO' }),
        line({
          sheet: {
            id: 'sheet-2',
            number: 'DSP-2026-0021',
            status: 'CANCELADO',
            customerProgress: [],
          },
        }),
      ]),
      ['7021'],
    );
    expect(states.lines.size).toBe(0);
    expect(states.orders.size).toBe(0);
  });

  it('suma lo cargado en todas las hojas del mismo renglón', async () => {
    const closed = (id: string, number: string, loadedQty: number) =>
      line({
        loadedQty,
        sheet: {
          id,
          number,
          status: 'DESPACHADO',
          customerProgress: [],
        },
      });
    const states = await loadDispatchStates(prismaWith([closed('s1', 'DSP-1', 10), closed('s2', 'DSP-2', 5)]), ['7021']);
    expect(states.lines.get('7021#ABAPOR77')?.loadedQty).toBe(15);
  });

  it('loadLineDispatchStates devuelve el mapa por renglón', async () => {
    const states = await loadLineDispatchStates(prismaWith([line()]), [
      { orderNumber: '7021', productCode: 'ABAPOR77' },
    ]);
    expect(states.has('7021#ABAPOR77')).toBe(true);
  });
});
