import { Injectable } from '@nestjs/common';
import { fixtureUpdateOrderDateLock, fixtureUpdateOrderDeliveryDate } from './fixtures.adapter';
import type { ProfitLockResult, ProfitWriteResult, ProfitWriter } from './profit-writer.adapter';

// Escritura en modo fixtures: siempre disponible y sin dry-run, para que el
// flujo de «cambiar entrega» se pueda probar en desarrollo.
@Injectable()
export class FixturesProfitWriter implements ProfitWriter {
  readonly enabled = true;
  readonly dryRun = false;

  async updateOrderDeliveryDate(orderNumber: string, date: string, _userCode: string): Promise<ProfitWriteResult> {
    return fixtureUpdateOrderDeliveryDate(orderNumber, date);
  }

  async updateOrderDateLock(orderNumber: string, locked: boolean, _userCode: string): Promise<ProfitLockResult> {
    return fixtureUpdateOrderDateLock(orderNumber, locked);
  }
}
