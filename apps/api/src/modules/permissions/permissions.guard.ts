import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from './permissions.decorator';
import { PermissionsService } from './permissions.service';

// Guard de permisos: resuelve rol + excepciones del usuario en cada petición
// y adjunta el acceso a `request.access` para que los controladores no
// dupliquen consultas. El rol ADMIN (sistema) siempre pasa.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const any =
      this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ??
      [];
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // JwtAuthGuard corre antes y garantiza la sesión en los endpoints
    // protegidos. Si no hay usuario y hay requisitos, se rechaza igual.
    if (!request.user?.sub) {
      if (required.length > 0 || any.length > 0) {
        throw new ForbiddenException('Permisos insuficientes para esta operación');
      }
      return true;
    }

    const access = await this.permissions.resolve(request.user.sub);
    if (!access) {
      throw new ForbiddenException('Usuario no reconocido');
    }
    request.access = access;

    const granted = new Set(access.permissions);
    if (required.length > 0 && !required.every((key) => granted.has(key))) {
      throw new ForbiddenException('Permisos insuficientes para esta operación');
    }
    if (any.length > 0 && !any.some((key) => granted.has(key))) {
      throw new ForbiddenException('Permisos insuficientes para esta operación');
    }
    return true;
  }
}
