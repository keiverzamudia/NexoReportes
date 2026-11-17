import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CustomerInsightQuery,
  CustomerQuery,
  CustomerStatementQuery,
  CustomerStatementSummaryQuery,
  OrderGroupQuery,
  OrderLifecycleQuery,
  OrderQuery,
  OrderReconcileInput,
  OrderReopenInput,
  ProfitDeliveryDateSetInput,
  zCustomerInsightQuery,
  zCustomerQuery,
  zCustomerStatementQuery,
  zCustomerStatementSummaryQuery,
  zOrderGroupQuery,
  zOrderLifecycleQuery,
  zOrderQuery,
  zOrderReconcileInput,
  zOrderReopenInput,
  zProfitDeliveryDateSetInput,
} from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireAnyPermission, RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { CustomerStatementService } from './customer-statement.service';
import { CustomerInsightsService } from './customer-insights.service';
import { CustomerNotesService } from './customer-notes.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { ProfitDeliveryDatesService } from './profit-delivery-dates.service';
import { SalesService } from './sales.service';

// Pedidos y clientes (Fase 4): consulta de lo sincronizado desde Profit y
// fecha de entrega tentativa (capa local).
@ApiTags('sales')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly profitDeliveryDates: ProfitDeliveryDatesService,
    private readonly customerStatements: CustomerStatementService,
    private readonly customerInsights: CustomerInsightsService,
    private readonly customerNotes: CustomerNotesService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  @Get('customers')
  @RequireAnyPermission('clientes:read', 'pedidos:read')
  listCustomers(@Query(new ZodValidationPipe(zCustomerQuery)) query: CustomerQuery) {
    return this.sales.listCustomers(query);
  }

  // Resumen de cartera de varios clientes (tabla «Clientes en cartera» de Pedidos).
  @Get('customers/statements')
  @RequirePermission('clientes:read')
  customerStatementsSummary(
    @Query(new ZodValidationPipe(zCustomerStatementSummaryQuery)) query: CustomerStatementSummaryQuery,
  ) {
    return this.customerStatements.summaries(query.codes, { moneda: query.moneda });
  }

  // Estado de cuenta del cliente: cartera en vivo desde Profit (solo lectura).
  @Get('customers/:code/statement')
  @RequirePermission('clientes:read')
  customerStatement(
    @Param('code') code: string,
    @Query(new ZodValidationPipe(zCustomerStatementQuery)) query: CustomerStatementQuery,
  ) {
    return this.customerStatements.statement(code, query);
  }

  // Ficha 360: volumen, facturación, productos perdidos y diagnóstico.
  @Get('customers/:code/insights')
  @RequirePermission('clientes:read')
  customerInsightsReport(
    @Param('code') code: string,
    @Query(new ZodValidationPipe(zCustomerInsightQuery)) query: CustomerInsightQuery,
  ) {
    return this.customerInsights.get(code, query);
  }

  // Notas de entrega del cliente con el pedido que las originó (pestaña Pedidos).
  @Get('customers/:code/notes')
  @RequirePermission('clientes:read')
  customerNotesList(
    @Param('code') code: string,
    @Query(new ZodValidationPipe(zCustomerInsightQuery)) query: CustomerInsightQuery,
  ) {
    return this.customerNotes.get(code, query);
  }

  @Get('orders')
  @RequirePermission('pedidos:read')
  listOrders(@Query(new ZodValidationPipe(zOrderQuery)) query: OrderQuery) {
    return this.sales.listOrders(query);
  }

  @Get('orders/grouped')
  @RequirePermission('pedidos:read')
  listOrdersGrouped(@Query(new ZodValidationPipe(zOrderGroupQuery)) query: OrderGroupQuery) {
    return this.sales.listGrouped(query);
  }

  // ---------- Cierre por nota de entrega (solo ADMIN) ----------

  @Get('orders/lifecycle')
  @RequirePermission('pedidos:read')
  lifecycleStatus(
    @Query(new ZodValidationPipe(zOrderLifecycleQuery)) query: OrderLifecycleQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    this.requireAdmin(request);
    return this.lifecycle.status(query);
  }

  @Post('orders/lifecycle/reconcile')
  @RequirePermission('pedidos:update')
  reconcileOrders(
    @Body(new ZodValidationPipe(zOrderReconcileInput)) body: OrderReconcileInput,
    @Req() request: AuthenticatedRequest,
  ) {
    this.requireAdmin(request);
    return this.lifecycle.reconcile({
      ...body,
      trigger: 'MANUAL',
      actor: { id: request.user?.sub, code: request.user?.code },
    });
  }

  @Post('orders/:id/reopen')
  @RequirePermission('pedidos:update')
  reopenOrder(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zOrderReopenInput)) body: OrderReopenInput,
    @Req() request: AuthenticatedRequest,
  ) {
    this.requireAdmin(request);
    return this.lifecycle.reopen({ id: request.user?.sub, code: request.user?.code }, id, body);
  }

  @Get('orders/:id')
  @RequirePermission('pedidos:read')
  orderDetail(@Param('id') id: string) {
    return this.sales.orderDetail(id);
  }

  // La entrega es UNA sola: se edita en Profit (`/orders/delivery-date/profit`)
  // y la hoja de despacho abierta se mueve con ella. La capa tentativa local
  // ya no se escribe desde la API (solo se lee para datos históricos).

  // Cambia la fecha de ENTREGA real del pedido en Profit (fec_venc).
  // Permiso independiente: es la única operación que escribe en Profit.
  @Put('orders/delivery-date/profit')
  @RequirePermission('pedidos:change_date')
  setProfitDeliveryDates(
    @Body(new ZodValidationPipe(zProfitDeliveryDateSetInput))
    body: ProfitDeliveryDateSetInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profitDeliveryDates.setDates(body, {
      id: request.user?.sub,
      code: request.user?.code,
    });
  }

  private requireAdmin(request: AuthenticatedRequest): void {
    if (!request.access?.isAdmin) {
      throw new ForbiddenException('El panel de cierres es solo para administradores.');
    }
  }
}
