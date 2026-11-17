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
    scenarioCreatedAt: new Date('2026-11-01T12:00:00.000Z'),
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
    // T2 = «Iniciar carga» → último artículo: C1 14:00→15:00 = 60; C2 día 2 14:00→16:00 = 120.
    expect(result.summary.load).toMatchObject({ groups: 2, avgMinutes: 90, medianMinutes: 90, p90Minutes: 120 });
    // T3 = «Iniciar carga» → factura: C1 14:00→17:00 = 180.
    expect(result.summary.invoice).toMatchObject({ groups: 1, avgMinutes: 180, pending: 1 });
    expect(result.summary.onTime).toMatchObject({ orders: 2, late: 0, pct: 100 });

    const one = result.customers.find((row) => row.customerCode === 'C1')!;
    expect(one.orders).toBe(1);
    expect(one.lines).toBe(1);
    expect(one.loadAvgMinutes).toBe(60);
    expect(one.invoiceAvgMinutes).toBe(180);
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
    // Sin «Iniciar carga» propio: arranca en el sello de la hoja 13:00 y
    // termina en el último artículo 15:30 = 150 min.
    expect(result.summary.load.avgMinutes).toBe(150);
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

  it('mide T1 desde la publicación y T4 desde la simulación', () => {
    const result = buildDispatchMetrics([sheet()], query());
    // T1: envío 13:00 → primer «Iniciar carga» 14:00 = 60 min.
    expect(result.summary.response.avgMinutes).toBe(60);
    // T4 no se inventa si falta una factura.
    expect(result.summary.totalCycle.groups).toBe(0);

    // Con todas las facturas entregadas: simulación 12:00 → última factura.
    const all = sheet();
    all.customerProgress[1]!.invoiceDeliveredAt = new Date('2026-11-02T18:00:00.000Z');
    const closed = buildDispatchMetrics([all], query());
    // 01/11 12:00 → 02/11 18:00 = 1800 min.
    expect(closed.summary.totalCycle).toMatchObject({ groups: 1, avgMinutes: 1800 });
    // T3 de C2: inicio 02/11 14:00 → factura 18:00 = 240.
    expect(closed.summary.invoice).toMatchObject({ groups: 2, pending: 0 });
  });
});
