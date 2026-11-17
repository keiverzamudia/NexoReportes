import { describe, expect, it } from 'vitest';
import { CustomerNotesService } from './customer-notes.service';

interface FakeOptions {
  totalsFail?: boolean;
  linksFail?: boolean;
}

const TOTALS = [
  {
    nota: '14808',
    fecha: '2026-08-12T00:00:00.000Z',
    monto: 2839.12,
    sacos: 223,
    kg: 5645,
    lineas: 8,
  },
  {
    nota: '14368',
    fecha: '2026-06-10T00:00:00.000Z',
    monto: 2346.09,
    sacos: 120,
    kg: 3540,
    lineas: 6,
  },
  {
    nota: '14073',
    fecha: '2026-04-30T00:00:00.000Z',
    monto: 2013.42,
    sacos: 203,
    kg: 5524,
    lineas: 5,
  },
];

const LINKS = [
  // Misma solicitud por dos caminos: directo y a través del pedido de Profit.
  { nota: '14808', pedido: '6222', pedido_profit: null },
  { nota: '14808', pedido: '6222', pedido_profit: '8514' },
  // Una nota fusionada de dos pedidos.
  { nota: '14368', pedido: '5661', pedido_profit: '8012' },
  { nota: '14368', pedido: '5757', pedido_profit: '8012' },
  // Sin cadena hasta la solicitud: solo se conoce el pedido de Profit.
  { nota: '14073', pedido: null, pedido_profit: '7723' },
];

function createProfit(options: FakeOptions = {}) {
  let totalsCalls = 0;
  return {
    dialect: 'mssql',
    selectQuery: async (sql: string) => {
      if (sql.includes('customer_notes_totals')) {
        totalsCalls += 1;
        if (options.totalsFail) throw new Error('Profit no responde');
        return TOTALS;
      }
      if (sql.includes('customer_notes_orders')) {
        if (options.linksFail) throw new Error('Sin pedidos');
        return LINKS;
      }
      return [];
    },
    totalsCalls: () => totalsCalls,
  };
}

describe('CustomerNotesService', () => {
  it('agrupa las notas con sus pedidos y convierte toneladas', async () => {
    const service = new CustomerNotesService(createProfit() as never);
    const result = await service.get('030432700', { months: 12, currency: 'USD' });

    expect(result.available).toBe(true);
    expect(result.ordersAvailable).toBe(true);
    expect(result.source).toBe('profit');
    expect(result.notes.map((note) => note.number)).toEqual(['14808', '14368', '14073']);

    const first = result.notes[0]!;
    expect(first.amount).toBe(2839.12);
    expect(first.sacks).toBe(223);
    expect(first.tonnes).toBe(5.65);
    // El vínculo directo y el indirecto son el mismo pedido: no se duplica.
    expect(first.orders).toEqual([{ number: '6222', profitOrder: '8514' }]);

    expect(result.notes[1]!.orders).toEqual([
      { number: '5661', profitOrder: '8012' },
      { number: '5757', profitOrder: '8012' },
    ]);

    // Sin cadena hasta la solicitud se muestra el pedido de Profit.
    expect(result.notes[2]!.orders).toEqual([{ number: '7723', profitOrder: null }]);
  });

  it('si falla el vínculo conserva las notas sin pedidos', async () => {
    const service = new CustomerNotesService(createProfit({ linksFail: true }) as never);
    const result = await service.get('030432700', { months: 12, currency: 'USD' });

    expect(result.available).toBe(true);
    expect(result.ordersAvailable).toBe(false);
    expect(result.notes).toHaveLength(3);
    expect(result.notes.every((note) => note.orders.length === 0)).toBe(true);
  });

  it('si falla Profit no inventa notas y no cachea el fallo', async () => {
    const profit = createProfit({ totalsFail: true });
    const service = new CustomerNotesService(profit as never);

    const first = await service.get('030432700', { months: 12, currency: 'USD' });
    expect(first.available).toBe(false);
    expect(first.notes).toEqual([]);

    await service.get('030432700', { months: 12, currency: 'USD' });
    expect(profit.totalsCalls()).toBe(2);
  });

  it('cachea una lectura completa', async () => {
    const profit = createProfit();
    const service = new CustomerNotesService(profit as never);

    await service.get('030432700', { months: 12, currency: 'USD' });
    await service.get('030432700', { months: 12, currency: 'USD' });

    expect(profit.totalsCalls()).toBe(1);
  });
});
