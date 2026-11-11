import { describe, expect, it } from 'vitest';
import type { DispatchMetricsQuery } from '@nexo/contracts';
import { buildDispatchMetrics, type MetricSheet } from './dispatch-metrics';

// ============================================================
// Reporte de tiempos: cálculos puros, sin Prisma.
// Las horas se expresan en UTC; Venezuela es UTC-4, así que un
// instante 14:00Z cae en el mismo día de negocio.
// ============================================================

function query(overrides: Partial<DispatchMetricsQuery> = {}): DispatchMetricsQuery {
  return {
    from: '2026-11-01',
    to: '2026-11-30',
    granularity: 'day',
    invoiceStatus: 'all',
    onlyClosed: false,
    ...overrides,
  };
}

function sheet(overrides: Partial<MetricSheet> = {}): MetricSheet {
  return {
    id: 'sheet-1',
    number: 'DSP-2026-0001',
    status: 'EN_PROCESO',
    sentAt: new Date('2026-11-01T13:00:00.000Z'),
    startedAt: new Date('2026-11-01T14:00:00.000Z'),
    completedAt: null,
    lines: [
      {
        orderNumber: 'P-1',
        productCode: 'ABA',
        description: 'Producto A',
        status: 'CARGADO',
        effectiveDate: '2026-11-01',
        plannedKg: 100,
        customerCode: 'C1',
        customerName: 'CLIENTE UNO',
        checkedAt: new Date('2026-11-01T15:00:00.000Z'),
        checkedByName: 'ALMACEN',
      },
      {
        orderNumber: 'P-2',
        productCode: 'ABA',
        description: 'Producto A',
        status: 'CARGADO',
        effectiveDate: '2026-11-02',
        plannedKg: 200,
        customerCode: 'C2',
        customerName: 'CLIENTE DOS',
        checkedAt: new Date('2026-11-02T16:00:00.000Z'),
        checkedByName: 'ALMACEN',
      },
    ],
    customerProgress: [
      {
        customerKey: 'C1',
        customerCode: 'C1',
        customerName: 'CLIENTE UNO',
        loadStartedAt: new Date('2026-11-01T14:00:00.000Z'),
        loadClosedAt: new Date('2026-11-01T15:00:00.000Z'),
        invoiceDeliveredAt: new Date('2026-11-01T17:00:00.000Z'),
        invoiceDeliveredByName: 'ADMIN',
        invoiceRef: 'FAC-1',
      },
      {
        customerKey: 'C2',
        customerCode: 'C2',
        customerName: 'CLIENTE DOS',
        loadStartedAt: new Date('2026-11-02T14:00:00.000Z'),
        loadClosedAt: new Date('2026-11-02T16:00:00.000Z'),
        invoiceDeliveredAt: null,
        invoiceDeliveredByName: null,
        invoiceRef: null,
      },
    ],
    ...overrides,
  };
}

describe('buildDispatchMetrics', () => {
  it('calcula carga, factura, pendientes y cumplimiento por cliente', () => {
    const result = buildDispatchMetrics([sheet()], query());

    expect(result.summary.dispatches).toBe(1);
    expect(result.summary.customers).toBe(2);
    expect(result.summary.orders).toBe(2);
    expect(result.summary.lines).toBe(2);
    expect(result.summary.kg).toBe(300);
    // Carga = envío (13:00) → último producto: C1 15:00 = 120; C2 día 2 16:00 = 1620.
    expect(result.summary.load).toMatchObject({ groups: 2, avgMinutes: 870, medianMinutes: 870, p90Minutes: 1620 });
    expect(result.summary.invoice).toMatchObject({ groups: 1, avgMinutes: 240, pending: 1 });
    expect(result.summary.onTime).toMatchObject({ orders: 2, late: 0, pct: 100 });

    const one = result.customers.find((row) => row.customerCode === 'C1')!;
    expect(one.orders).toBe(1);
    expect(one.lines).toBe(1);
    expect(one.loadAvgMinutes).toBe(120);
    expect(one.invoiceAvgMinutes).toBe(240);
    expect(one.onTimePct).toBe(100);
    const two = result.customers.find((row) => row.customerCode === 'C2')!;
    expect(two.pendingInvoices).toBe(1);
    expect(two.invoiceAvgMinutes).toBeNull();
  });

  it('distingue pedidos de renglones cuando un pedido trae varios productos', () => {
    const multi = sheet();
    multi.lines = [
      multi.lines[0]!,
      { ...multi.lines[0]!, productCode: 'ABB', plannedKg: 50 },
      multi.lines[1]!,
    ];
    const result = buildDispatchMetrics([multi], query());
    // P-1 aparece en dos renglones; P-2 en uno.
    expect(result.summary.orders).toBe(2);
    expect(result.summary.lines).toBe(3);
    expect(result.summary.onTime.orders).toBe(2);
    const one = result.customers.find((row) => row.customerCode === 'C1')!;
    expect(one.orders).toBe(1);
    expect(one.lines).toBe(2);
  });

  it('construye series diarias y mensuales con los periodos vacíos', () => {
    const daily = buildDispatchMetrics([sheet()], query());
    const dayOne = daily.series.find((point) => point.period === '2026-11-01')!;
    const dayTwo = daily.series.find((point) => point.period === '2026-11-02')!;
    expect(dayOne.loadAvgMinutes).toBe(120);
    expect(dayOne.invoiceAvgMinutes).toBe(240);
    expect(dayTwo.loadAvgMinutes).toBe(1620);
    expect(dayTwo.invoiceAvgMinutes).toBeNull();
    expect(daily.series).toHaveLength(30);

    const monthly = buildDispatchMetrics([sheet()], query({ granularity: 'month' }));
    expect(monthly.series).toHaveLength(1);
    expect(monthly.series[0]).toMatchObject({ period: '2026-11', loadGroups: 2, invoiceGroups: 1 });
  });

  it('filtra pendientes de factura y por cliente', () => {
    const pending = buildDispatchMetrics([sheet()], query({ invoiceStatus: 'pending' }));
    expect(pending.customers).toHaveLength(1);
    expect(pending.customers[0]!.customerCode).toBe('C2');
    expect(pending.summary.invoice.groups).toBe(0);
    expect(pending.summary.invoice.pending).toBe(1);

    const onlyOne = buildDispatchMetrics([sheet()], query({ customerCode: 'C1' }));
    expect(onlyOne.customers).toHaveLength(1);
    expect(onlyOne.summary.orders).toBe(1);
  });

  it('usa los sellos globales y las horas de renglón de una hoja histórica sin filas de relojes', () => {
    const base = sheet();
    const legacy = sheet({
      status: 'DESPACHADO',
      startedAt: new Date('2026-11-03T13:00:00.000Z'),
      completedAt: new Date('2026-11-03T15:30:00.000Z'),
      customerProgress: [],
      lines: [
        { ...base.lines[0]!, customerCode: 'C1', customerName: 'CLIENTE UNO', checkedAt: new Date('2026-11-03T14:30:00.000Z') },
        { ...base.lines[1]!, customerCode: 'C1', customerName: 'CLIENTE UNO', checkedAt: new Date('2026-11-03T15:30:00.000Z') },
      ],
    });
    const result = buildDispatchMetrics([legacy], query());
    expect(result.summary.load.groups).toBe(1);
    // Envío 01/11 13:00 → último producto 03/11 15:30 = 50 h 30 min.
    expect(result.summary.load.avgMinutes).toBe(3030);
    expect(result.summary.invoice.groups).toBe(0);
    expect(result.summary.invoice.pending).toBe(1);
  });

  it('marca tarde cuando la carga se cerró después de la fecha planificada', () => {
    const late = sheet();
    late.lines[0]!.effectiveDate = '2026-11-01';
    // El cumplimiento ahora se mide por el cierre de carga (cohorte), no por
    // la fecha en que se entregó la factura.
    late.customerProgress[0]!.loadClosedAt = new Date('2026-11-03T14:00:00.000Z');
    const result = buildDispatchMetrics([late], query());
    expect(result.summary.onTime.orders).toBe(2);
    expect(result.summary.onTime.late).toBe(1);
    expect(result.summary.onTime.pct).toBe(50);
  });

  it('excluye los renglones anulados de los tiempos y totales', () => {
    const withAnnulled = sheet();
    withAnnulled.lines[0] = { ...withAnnulled.lines[0]!, status: 'ANULADO' };
    const result = buildDispatchMetrics([withAnnulled], query());
    expect(result.summary.orders).toBe(1);
    expect(result.summary.kg).toBe(200);
    expect(result.summary.load.groups).toBe(1);
    expect(result.summary.customers).toBe(1);
    const orderRows = result.orders;
    expect(orderRows.some((row) => row.productCode === 'ABA' && row.customerCode === 'C1')).toBe(false);
  });

  it('calcula respuesta, ventana de carga y ciclo desde el envío', () => {
    const result = buildDispatchMetrics([sheet()], query());
    // Envío 13:00 → primer producto marcado 15:00 del mismo día = 120 min.
    expect(result.summary.response.avgMinutes).toBe(120);
    // Primer producto 15:00 (día 1) → último cierre 16:00 (día 2) = 1500 min.
    expect(result.summary.loadWindow.avgMinutes).toBe(1500);
    // Envío 13:00 (día 1) → último cierre 16:00 (día 2) = 1620 min.
    expect(result.summary.dispatchCycle.avgMinutes).toBe(1620);
    // C1 facturó a las 17:00 y cerró a las 15:00 = 120 min de espera.
    expect(result.summary.invoiceWait.avgMinutes).toBe(120);
    // El ciclo total no se inventa si falta una factura.
    expect(result.summary.totalCycle.groups).toBe(0);
  });
});
