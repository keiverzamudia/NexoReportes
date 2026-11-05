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
    ...overrides,
  };
}

function sheet(overrides: Partial<MetricSheet> = {}): MetricSheet {
  return {
    id: 'sheet-1',
    number: 'DSP-2026-0001',
    status: 'EN_PROCESO',
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
    expect(result.summary.kg).toBe(300);
    expect(result.summary.load).toMatchObject({ groups: 2, avgMinutes: 90, medianMinutes: 90, p90Minutes: 120 });
    expect(result.summary.invoice).toMatchObject({ groups: 1, avgMinutes: 180, pending: 1 });
    expect(result.summary.onTime).toMatchObject({ orders: 1, late: 0, pct: 100 });

    const one = result.customers.find((row) => row.customerCode === 'C1')!;
    expect(one.loadAvgMinutes).toBe(60);
    expect(one.invoiceAvgMinutes).toBe(180);
    expect(one.onTimePct).toBe(100);
    const two = result.customers.find((row) => row.customerCode === 'C2')!;
    expect(two.pendingInvoices).toBe(1);
    expect(two.invoiceAvgMinutes).toBeNull();
  });

  it('construye series diarias y mensuales con los periodos vacíos', () => {
    const daily = buildDispatchMetrics([sheet()], query());
    const dayOne = daily.series.find((point) => point.period === '2026-11-01')!;
    const dayTwo = daily.series.find((point) => point.period === '2026-11-02')!;
    expect(dayOne.loadAvgMinutes).toBe(60);
    expect(dayOne.invoiceAvgMinutes).toBe(180);
    expect(dayTwo.loadAvgMinutes).toBe(120);
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
    expect(result.summary.load.avgMinutes).toBe(150);
    expect(result.summary.invoice.groups).toBe(0);
    expect(result.summary.invoice.pending).toBe(1);
  });

  it('marca tarde cuando la factura se entregó después de la fecha planificada', () => {
    const late = sheet();
    late.lines[0]!.effectiveDate = '2026-11-01';
    late.customerProgress[0]!.invoiceDeliveredAt = new Date('2026-11-03T14:00:00.000Z');
    const result = buildDispatchMetrics([late], query());
    expect(result.summary.onTime.orders).toBe(1);
    expect(result.summary.onTime.late).toBe(1);
    expect(result.summary.onTime.pct).toBe(0);
  });
});
