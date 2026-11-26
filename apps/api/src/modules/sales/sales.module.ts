import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { SyncModule } from '../sync/sync.module';
import { CustomerStatementService } from './customer-statement.service';
import { CustomerInsightsService } from './customer-insights.service';
import { CustomerNotesService } from './customer-notes.service';
import { CustomerSalesService } from './customer-sales.service';
import { DeliveryDateReputationService } from './delivery-date-reputation.service';
import { DeliveryDatesService } from './delivery-dates.service';
import { DeliveryNoteService } from './delivery-note.service';
import { OrderLifecycleScheduler } from './order-lifecycle.scheduler';
import { OrderLifecycleService } from './order-lifecycle.service';
import { ProfitDeliveryDatesService } from './profit-delivery-dates.service';
import { SalesAnalyticsService } from './sales-analytics.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

// Fase 4: consulta de pedidos/clientes sincronizados desde Profit, capa local
// de fecha tentativa y cambio puntual de la entrega real en Profit.
// El estado de cuenta usa el adaptador de Profit (solo lectura) vía SyncModule.
// El ciclo de vida cierra pedidos por nota de entrega y limpia el plan global.
@Module({
  imports: [AuditModule, SyncModule, ScenariosModule],
  controllers: [SalesController],
  providers: [
    SalesService,
    DeliveryDatesService,
    DeliveryDateReputationService,
    ProfitDeliveryDatesService,
    CustomerStatementService,
    CustomerSalesService,
    CustomerInsightsService,
    CustomerNotesService,
    DeliveryNoteService,
    SalesAnalyticsService,
    OrderLifecycleService,
    OrderLifecycleScheduler,
  ],
  exports: [SalesService, DeliveryDatesService, ProfitDeliveryDatesService, CustomerStatementService, CustomerSalesService, CustomerInsightsService, CustomerNotesService, OrderLifecycleService],
})
export class SalesModule {}
