import { describe, expect, it } from 'vitest';
import { DeliveryDateReputationService } from './delivery-date-reputation.service';

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    changedAt: new Date('2026-11-10T14:30:00.000Z'),
    orderNumber: '6819',
    previousDate: new Date('2026-10-20T00:00:00.000Z'),
    newDate: new Date('2026-10-27T00:00:00.000Z'),
    cause: 'CUSTOMER',
    reason: 'FINANCIAL',
    note: null,
    ...overrides,
  };
}

function build(rows: any[]) {
  const received: any[] = [];
  const prisma = {
    deliveryDateChange: {
      findMany: async (args: any) => {
        received.push(args);
        return rows;
      },
    },
  };
  return { service: new DeliveryDateReputationService(prisma as never), received };
}

describe('DeliveryDateReputationService', () => {
  it('cuenta solo cambios reales del cliente y desglosa causa/motivo', async () => {
    const rows = [
      row({ orderNumber: '6819', cause: 'CUSTOMER', reason: 'FINANCIAL' }),
      row({ orderNumber: '6819', cause: 'CUSTOMER', reason: 'LOGISTIC' }),
      row({ orderNumber: '6820', cause: 'COMPANY', reason: null }),
      row({ orderNumber: '6821', cause: null, reason: null }),
    ];
    const { service, received } = build(rows);

    const result = await service.summarize(' 294201237 ');

    expect(received[0].where).toMatchObject({ customerCode: '294201237', action: 'PROFIT_UPDATE' });
    expect(result).toMatchObject({
      total: 4,
      orders: 3,
      byCustomer: 2,
      byCompany: 1,
      unclassified: 1,
      financial: 1,
      logistic: 1,
      customerSharePct: 66.7,
      reputation: 'POOR',
    });
    expect(result.recent[0]).toMatchObject({
      orderNumber: '6819',
      previousDate: '2026-10-20',
      newDate: '2026-10-27',
      cause: 'CUSTOMER',
      reason: 'FINANCIAL',
    });
    expect(result.lastChangeAt).toBe('2026-11-10T14:30:00.000Z');
  });

  it('marca BUENA cuando el cliente casi no reprograma', async () => {
    const rows = [
      row({ cause: 'CUSTOMER', reason: 'LOGISTIC' }),
      row({ cause: 'COMPANY', reason: null }),
      row({ cause: 'COMPANY', reason: null }),
      row({ cause: 'COMPANY', reason: null }),
    ];
    const { service } = build(rows);
    const result = await service.summarize('294201237');
    expect(result.customerSharePct).toBe(25);
    expect(result.reputation).toBe('GOOD');
  });

  it('marca REGULAR entre 25% y 50%', async () => {
    const rows = [
      row({ cause: 'CUSTOMER', reason: 'FINANCIAL' }),
      row({ cause: 'CUSTOMER', reason: 'FINANCIAL' }),
      row({ cause: 'COMPANY', reason: null }),
      row({ cause: 'COMPANY', reason: null }),
    ];
    const { service } = build(rows);
    const result = await service.summarize('294201237');
    expect(result.customerSharePct).toBe(50);
    expect(result.reputation).toBe('FAIR');
  });

  it('sin historial queda SIN DATOS (UNKNOWN)', async () => {
    const { service } = build([]);
    const result = await service.summarize('999');
    expect(result).toMatchObject({
      total: 0,
      customerSharePct: null,
      reputation: 'UNKNOWN',
      lastChangeAt: null,
      recent: [],
    });
  });

  it('historial solo sin clasificar no inventa porcentaje', async () => {
    const { service } = build([row({ cause: null, reason: null })]);
    const result = await service.summarize('294201237');
    expect(result).toMatchObject({ total: 1, unclassified: 1, customerSharePct: null, reputation: 'UNKNOWN' });
  });
});
