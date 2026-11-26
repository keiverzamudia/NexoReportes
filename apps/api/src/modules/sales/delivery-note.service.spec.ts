import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryNoteService } from './delivery-note.service';

type Row = Record<string, any>;

function createPrisma(order: Row | null) {
  return {
    salesOrder: {
      findUnique: async () => order,
    },
  } as never;
}

function createProfit(options: {
  headers?: Row[];
  lines?: Row[];
  numbers?: Row[];
  failHeaders?: boolean;
} = {}) {
  return {
    dialect: 'mssql' as const,
    selectQuery: vi.fn(async (sqlText: string) => {
      if (sqlText.includes('delivery_note_numbers')) return options.numbers ?? [];
      if (sqlText.includes('delivery_note_header')) {
        if (options.failHeaders) throw new Error('Profit caído');
        return options.headers ?? [];
      }
      if (sqlText.includes('delivery_note_lines')) return options.lines ?? [];
      return [];
    }),
  };
}

const order = {
  id: 'order-1',
  externalNumber: '7079',
  notaEntregaRefs: JSON.stringify(['15499']),
};

const header = {
  number: '15499',
  date: new Date('2026-11-25T00:00:00.000Z'),
  due_date: new Date('2026-11-25T00:00:00.000Z'),
  status: '2',
  annulled: false,
  customer_code: '408251710',
  customer_name: 'AGRICOLA Y PECUARIA LA CAÑADA, C.A',
  customer_rif: 'J-40825171-0',
  customer_address: 'CARRETERA VIEJA A CARORA KM 13',
  customer_phone: '0416-6561823',
  vendor: 'GREGRIL CORDERO',
  currency: 'US$',
  exchange_rate: 922.5637,
  subtotal: 1454882.96,
  discount: 0,
  tax: 0,
  total: 1454882.96,
  comments: '',
  payment_terms: 0,
};

const line = {
  note: '15499',
  line: 1,
  product_code: 'ABAGP13',
  description: 'GALLINA PONEDORA PLUS 18% - 40 KG',
  warehouse: '6804',
  unit: 'SAC',
  quantity: 50,
  price: 29097.6591,
  discount_pct: '0.00+0.00+0.00 ',
  net: 1454882.96,
  kg: 2000,
  origin: '7079',
  origin_type: 'T',
};

describe('DeliveryNoteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('arma el documento con la nota guardada en el pedido y convierte a US$', async () => {
    const service = new DeliveryNoteService(
      createPrisma(order),
      createProfit({ headers: [header], lines: [line] }) as never,
    );

    const result = await service.getByOrder('order-1');
    expect(result.available).toBe(true);
    expect(result.notes).toHaveLength(1);
    const note = result.notes[0]!;
    expect(note).toMatchObject({
      number: '15499',
      date: '2026-11-25',
      customerCode: '408251710',
      customerName: 'AGRICOLA Y PECUARIA LA CAÑADA, C.A',
      vendor: 'GREGRIL CORDERO',
      currency: 'USD',
      amountsConverted: true,
      paymentTerms: 'Contado',
      totalLocal: 1454882.96,
      orders: ['7079'],
      source: 'profit',
    });
    expect(note.total).toBe(1577);
    expect(note.subtotal).toBe(1577);
    expect(note.lines[0]).toMatchObject({
      productCode: 'ABAGP13',
      quantity: 50,
      price: 31.54,
      net: 1577,
      kg: 2000,
      origin: '7079',
      originType: 'T',
    });
  });

  it('busca la nota por origen cuando el cierre no guardó refs', async () => {
    const service = new DeliveryNoteService(
      createPrisma({ ...order, notaEntregaRefs: null }),
      createProfit({ numbers: [{ note: '15499' }], headers: [header], lines: [line] }) as never,
    );

    const result = await service.getByOrder('order-1');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.number).toBe('15499');
  });

  it('devuelve vacío disponible cuando el pedido no tiene nota vinculada', async () => {
    const service = new DeliveryNoteService(
      createPrisma({ ...order, notaEntregaRefs: null }),
      createProfit({ numbers: [] }) as never,
    );

    const result = await service.getByOrder('order-1');
    expect(result).toMatchObject({ available: true, notes: [], orderNumber: '7079' });
  });

  it('marca no disponible si Profit falla al leer la nota', async () => {
    const service = new DeliveryNoteService(
      createPrisma(order),
      createProfit({ failHeaders: true }) as never,
    );

    const result = await service.getByOrder('order-1');
    expect(result).toMatchObject({ available: false, notes: [] });
  });

  it('no consulta Profit si el número de pedido no es numérico y no hay refs', async () => {
    const profit = createProfit({ numbers: [] });
    const service = new DeliveryNoteService(
      createPrisma({ ...order, externalNumber: 'ABC', notaEntregaRefs: null }),
      profit as never,
    );

    const result = await service.getByOrder('order-1');
    expect(result.notes).toEqual([]);
    expect(profit.selectQuery).not.toHaveBeenCalled();
  });
});
