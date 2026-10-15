import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerQuery, OrderQuery, zCustomerQuery, zOrderQuery } from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SalesService } from './sales.service';

// Pedidos y clientes (Fase 4): consulta de lo sincronizado desde Profit.
@ApiTags('sales')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

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

  @Get('orders/:id')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  orderDetail(@Param('id') id: string) {
    return this.sales.orderDetail(id);
  }
}
