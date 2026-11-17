import { Injectable } from '@nestjs/common';
import {
  CustomerDeliveryChange,
  CustomerDeliveryChangeSummary,
  DeliveryChangeCause,
  DeliveryChangeReason,
  DeliveryChangeReputation,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';

// ============================================================
// Reputación de fechas del cliente.
//
// Cuenta los cambios REALES de entrega hechos en Profit
// (`DeliveryDateChange.action = 'PROFIT_UPDATE'`) de todo el histórico:
//
//   % cliente = cambios originados por el cliente / cambios clasificados
//
// BUENA   ≤ 25 %   (casi siempre nos movemos nosotros)
// REGULAR ≤ 50 %
// MALA    > 50 %   (el cliente reprograma más de la mitad)
//
// Los cambios previos a la causa/motivo quedan «sin clasificar» y no
// distorsionan el porcentaje: se informan aparte.
// ============================================================

const RECENT_LIMIT = 10;
const GOOD_MAX_PCT = 25;
const FAIR_MAX_PCT = 50;

function dayOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function reputationOf(classified: number, byCustomer: number): DeliveryChangeReputation {
  if (classified === 0) return 'UNKNOWN';
  const share = (byCustomer / classified) * 100;
  if (share <= GOOD_MAX_PCT) return 'GOOD';
  if (share <= FAIR_MAX_PCT) return 'FAIR';
  return 'POOR';
}

@Injectable()
export class DeliveryDateReputationService {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(customerCode: string): Promise<CustomerDeliveryChangeSummary> {
    const code = customerCode.trim().toUpperCase();
    const rows = await this.prisma.deliveryDateChange.findMany({
      where: { customerCode: code, action: 'PROFIT_UPDATE' },
      orderBy: { changedAt: 'desc' },
      select: {
        changedAt: true,
        orderNumber: true,
        previousDate: true,
        newDate: true,
        cause: true,
        reason: true,
        note: true,
      },
    });

    let byCompany = 0;
    let byCustomer = 0;
    let unclassified = 0;
    let financial = 0;
    let logistic = 0;
    const orders = new Set<string>();

    for (const row of rows) {
      orders.add(row.orderNumber);
      const cause = row.cause as DeliveryChangeCause | null;
      if (cause === 'COMPANY') byCompany += 1;
      else if (cause === 'CUSTOMER') {
        byCustomer += 1;
        const reason = row.reason as DeliveryChangeReason | null;
        if (reason === 'FINANCIAL') financial += 1;
        else if (reason === 'LOGISTIC') logistic += 1;
      } else unclassified += 1;
    }

    const classified = byCompany + byCustomer;
    const share = classified > 0 ? round1((byCustomer / classified) * 100) : null;

    const recent: CustomerDeliveryChange[] = rows.slice(0, RECENT_LIMIT).map((row) => ({
      changedAt: row.changedAt.toISOString(),
      orderNumber: row.orderNumber,
      previousDate: dayOnly(row.previousDate),
      newDate: dayOnly(row.newDate),
      cause: (row.cause as DeliveryChangeCause | null) ?? null,
      reason: (row.reason as DeliveryChangeReason | null) ?? null,
      note: row.note,
    }));

    return {
      total: rows.length,
      orders: orders.size,
      byCompany,
      byCustomer,
      unclassified,
      financial,
      logistic,
      customerSharePct: share,
      reputation: reputationOf(classified, byCustomer),
      lastChangeAt: rows[0]?.changedAt.toISOString() ?? null,
      recent,
    };
  }
}
