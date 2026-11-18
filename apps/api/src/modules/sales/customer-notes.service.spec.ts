import { describe, expect, it } from 'vitest';
import { CustomerNotesService } from './customer-notes.service';

interface FakeOptions {
  totalsFail?: boolean;
  linksFail?: boolean;
  itemsFail?: boolean;
  invoicesFail?: boolean;
}

const TOTALS = [
  {
    nota: '14808',
    fecha: '2026-08-12T00:00:00.000Z',
    vendedor: 'JULIARD ANGULO',
    monto: 2839.12,
    sacos: 223,
    kg: 5645,
    lineas: 8,
  },
  {
    nota: '14368',
    fecha: '2026-06-10T00:00:00.000Z',
    vendedor: 'MEIDY CRISTINA ARIAS VIDAL',
    monto: 2346.09,
    sacos: 120,
    kg: 3540,
    lineas: 6,
  },
  {
    nota: '14073',
    fecha: '2026-04-30T00:00:00.000Z',
    vendedor: '',
    monto: 2013.42,
    sacos: 203,
    kg: 5524,
    lineas: 5,
  },
];

const ITEMS = [
  { nota: '14808', co_art: 'ABABOV58', art_des: 'MULTIPROPOSITO 14%', uni_venta: 'SAC', unid: 120, kg: 4800 },
  { nota: '14808', co_art: 'ABAEQUI01', art_des: 'ALFALFA EN PELLETS', uni_venta: 'SAC', unid: 3, kg: 845 },
  { nota: '14368', co_art: 'ABABOV58', art_des: 'MULTIPROPOSITO 14%', uni_venta: 'SAC', unid: 120, kg: 3540 },
];

// Factura(s) de cada nota: `14073` queda sin factura para probar el «N/T».
const INVOICES = [
  { nota: '14808', factura: '50001772' },
  { nota: '14368', factura: '50001600' },
  { nota: '14368', factura: '50001601' },
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
      if (sql.includes('customer_notes_items')) {
        if (options.itemsFail) throw new Error('Sin artículos');
        return ITEMS;
      }
      if (sql.includes('customer_notes_invoices')) {
        if (options.invoicesFail) throw new Error('Sin facturas');
        return INVOICES;
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
    expect(first.vendor).toBe('JULIARD ANGULO');
    // El vínculo directo y el indirecto son el mismo pedido: no se duplica.
    expect(first.orders).toEqual([{ number: '6222', profitOrder: '8514' }]);
    // Detalle agregado por artículo, el de más peso primero.
    expect(first.items.map((item) => item.code)).toEqual(['ABABOV58', 'ABAEQUI01']);
    expect(first.items[0]!.tonnes).toBe(4.8);
    // La factura que respalda la nota (vacío = «N/T» en la ficha).
    expect(first.invoices).toEqual(['50001772']);

    expect(result.notes[1]!.orders).toEqual([
      { number: '5661', profitOrder: '8012' },
      { number: '5757', profitOrder: '8012' },
    ]);

    // Sin cadena hasta la solicitud se muestra el pedido de Profit.
    expect(result.notes[2]!.orders).toEqual([{ number: '7723', profitOrder: null }]);
    // Nota sin factura: la ficha pinta «N/T».
    expect(result.notes[2]!.invoices).toEqual([]);
    expect(result.notes[1]!.invoices).toEqual(['50001600', '50001601']);
    // Sin vendedor en Profit queda null (nunca se inventa).
    expect(result.notes[2]!.vendor).toBeNull();
    expect(result.notes[2]!.items).toEqual([]);
  });

  it('si falla el vínculo conserva las notas sin pedidos', async () => {
    const service = new CustomerNotesService(createProfit({ linksFail: true }) as never);
    const result = await service.get('030432700', { months: 12, currency: 'USD' });

    expect(result.available).toBe(true);
    expect(result.ordersAvailable).toBe(false);
    expect(result.notes).toHaveLength(3);
    expect(result.notes.every((note) => note.orders.length === 0)).toBe(true);
    // El detalle de artículos se lee por separado: no se pierde.
    expect(result.itemsAvailable).toBe(true);
    expect(result.notes[0]!.items).toHaveLength(2);
  });

  it('si falla la factura conserva las notas sin factura y no cachea', async () => {
    const profit = createProfit({ invoicesFail: true });
    const service = new CustomerNotesService(profit as never);

    const result = await service.get('030432700', { months: 12, currency: 'USD' });
    expect(result.available).toBe(true);
    expect(result.invoicesAvailable).toBe(false);
    expect(result.notes.every((note) => note.invoices.length === 0)).toBe(true);

    await service.get('030432700', { months: 12, currency: 'USD' });
    expect(profit.totalsCalls()).toBe(2);
  });

  it('si falla el detalle conserva las notas sin artículos y no cachea', async () => {
    const profit = createProfit({ itemsFail: true });
    const service = new CustomerNotesService(profit as never);

    const result = await service.get('030432700', { months: 12, currency: 'USD' });
    expect(result.available).toBe(true);
    expect(result.itemsAvailable).toBe(false);
    expect(result.notes).toHaveLength(3);
    expect(result.notes.every((note) => note.items.length === 0)).toBe(true);

    await service.get('030432700', { months: 12, currency: 'USD' });
    expect(profit.totalsCalls()).toBe(2);
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
