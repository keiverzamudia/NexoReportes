import { Body, Controller, Delete, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CustomerQuery,
  OrderGroupQuery,
  OrderQuery,
  zCustomerQuery,
  zDeliveryDateRestoreInput,
  zDeliveryDateSetInput,
  zOrderGroupQuery,
  zOrderQuery,
} from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DeliveryDatesService } from './delivery-dates.service';
import { SalesService } from './sales.service';

// Pedidos y clientes (Fase 4): consulta de lo sincronizado desde Profit y
// fecha de entrega tentativa (capa local).
@ApiTags('sales')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly deliveryDates: DeliveryDatesService,
  ) {}

  @Get('customers')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  listCustomers(@Query(new ZodValidationPipe(zCustomerQuery)) query: CustomerQuery) {
    return this.sales.listCustomers(query);
  }

  @Get('orders')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  listOrders(@Query(new ZodValidationPipe(zOrderQuery)) query: OrderQuery) {
    return this.sales.listOrders(query);
  }

  @Get('orders/grouped')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  listOrdersGrouped(@Query(new ZodValidationPipe(zOrderGroupQuery)) query: OrderGroupQuery) {
    return this.sales.listGrouped(query);
  }

  @Get('orders/:id')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  orderDetail(@Param('id') id: string) {
    return this.sales.orderDetail(id);
  }

  // Asigna/actualiza la fecha tentativa de uno o varios renglones.
  @Put('orders/delivery-date')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR')
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
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR')
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
