import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { zPaginationQuery } from '@nexo/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';

const zCreateUser = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(200),
  fullName: z.string().min(2).max(120),
  role: z.enum(['ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA']),
});

const zUpdateUser = z.object({
  fullName: z.string().min(2).max(120).optional(),
  role: z.enum(['ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(10).max(200).optional(),
});

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('ADMIN')
  list(@Query(new ZodValidationPipe(zPaginationQuery)) query: { page: number; pageSize: number }) {
    return this.users.list(query);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body(new ZodValidationPipe(zCreateUser)) body: z.infer<typeof zCreateUser>) {
    return this.users.create(body);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(zUpdateUser)) body: z.infer<typeof zUpdateUser>) {
    return this.users.update(id, body);
  }
}
