import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { APP_MODULES, RoleInput, RoleUpdateInput, zRoleInput, zRoleUpdateInput } from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RolesService } from './roles.service';

// Administración de roles y de la matriz de permisos (submódulo de Usuarios).
@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('usuarios:read')
  @ApiOperation({ summary: 'Roles con su matriz de permisos y nº de usuarios' })
  list() {
    return this.roles.list();
  }

  @Get('catalog')
  @RequirePermission('usuarios:read')
  @ApiOperation({ summary: 'Módulos y acciones disponibles para la matriz' })
  catalog() {
    return APP_MODULES;
  }

  @Post()
  @RequirePermission('usuarios:create')
  @ApiOperation({ summary: 'Crea un rol dinámico con su matriz de permisos' })
  create(
    @Body(new ZodValidationPipe(zRoleInput)) body: RoleInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.roles.create(body, { id: request.user?.sub });
  }

  @Patch(':code')
  @RequirePermission('usuarios:update')
  @ApiOperation({ summary: 'Edita nombre, plantilla o matriz de un rol' })
  update(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(zRoleUpdateInput)) body: RoleUpdateInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.roles.update(code, body, { id: request.user?.sub });
  }

  @Delete(':code')
  @RequirePermission('usuarios:delete')
  @ApiOperation({ summary: 'Elimina un rol sin usuarios asignados' })
  remove(@Param('code') code: string, @Req() request: AuthenticatedRequest) {
    return this.roles.remove(code, { id: request.user?.sub });
  }
}
