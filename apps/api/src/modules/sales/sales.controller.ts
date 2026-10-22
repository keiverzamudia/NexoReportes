import { Body, Controller, Delete, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CustomerQuery,
  CustomerStatementQuery,
  OrderGroupQuery,
  OrderQuery,
  zCustomerQuery,
  zCustomerStatementQuery,
  zDeliveryDateRestoreInput,
  zDeliveryDateSetInput,
  zOrderGroupQuery,
  zOrderQuery,
} from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireAnyPermission, RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { CustomerStatementService } from './customer-statement.service';
import { DeliveryDatesService } from './delivery-dates.service';
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
    private readonly deliveryDates: DeliveryDatesService,
    private readonly customerStatements: CustomerStatementService,
  ) {}

  @Get('customers')
  @RequireAnyPermission('clientes:read', 'pedidos:read')
  listCustomers(@Query(new ZodValidationPipe(zCustomerQuery)) query: CustomerQuery) {
    return this.sales.listCustomers(query);
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

  @Get('orders/:id')
  @RequirePermission('pedidos:read')
  orderDetail(@Param('id') id: string) {
    return this.sales.orderDetail(id);
  }

  // Asigna/actualiza la fecha tentativa de uno o varios renglones.
  @Put('orders/delivery-date')
  @RequirePermission('pedidos:update')
  setDeliveryDates(
    @Body(new ZodValidationPipe(zDeliveryDateSetInput)) body: { items: { orderNumber: string; productCode: string }[]; date: string; note?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.deliveryDates.setDates(body.items, body.date, body.note, {
      id: request.user?.sub,
      code: request.user?.code,
    });
  }

  // Restaura la fecha original de Profit en los renglones seleccionados.
  @Delete('orders/delivery-date')
  @RequirePermission('pedidos:update')
  restoreDeliveryDates(
    @Body(new ZodValidationPipe(zDeliveryDateRestoreInput)) body: { items: { orderNumber: string; productCode: string }[]; note?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.deliveryDates.restoreDates(body.items, body.note, {
      id: request.user?.sub,
      code: request.user?.code,
    });
  }
}
