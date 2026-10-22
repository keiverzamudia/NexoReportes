import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from './permissions.decorator';
import { PermissionsGuard } from './permissions.guard';
import type { EffectiveAccess } from './permissions.service';

function context(userId?: string) {
  const request: { user?: { sub: string; code: string; role: string }; access?: EffectiveAccess } = userId
    ? { user: { sub: userId, code: 'T', role: 'CONSULTA' } }
    : {};
  return {
    request,
    ctx: {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
  };
}

function access(permissions: string[], isAdmin = false): EffectiveAccess {
  return {
    userId: 'u1',
    role: isAdmin ? 'ADMIN' : 'CONSULTA',
    roleName: isAdmin ? 'Administrador' : 'Consulta',
    baseRole: isAdmin ? 'ADMIN' : 'CONSULTA',
    isAdmin,
    permissions,
  };
}

function guardWith(required: string[] | undefined, any: string[] | undefined, resolved: EffectiveAccess) {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === PERMISSIONS_KEY ? required : key === ANY_PERMISSIONS_KEY ? any : undefined,
  } as never;
  const permissions = { resolve: async () => resolved } as never;
  return new PermissionsGuard(reflector, permissions);
}

describe('PermissionsGuard', () => {
  it('permite cuando no hay requisitos y adjunta el acceso', async () => {
    const { ctx, request } = context('u1');
    const guard = guardWith(undefined, undefined, access([]));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.access?.userId).toBe('u1');
  });

  it('permite si el usuario tiene todos los permisos exigidos', async () => {
    const { ctx } = context('u1');
    const guard = guardWith(['pedidos:read'], undefined, access(['pedidos:read', 'pedidos:update']));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('bloquea si falta el permiso', async () => {
    const { ctx } = context('u1');
    const guard = guardWith(['usuarios:delete'], undefined, access(['usuarios:read']));
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('con RequireAny basta uno de los permisos (endpoints compartidos)', async () => {
    const { ctx } = context('u1');
    const guard = guardWith(undefined, ['clientes:read', 'pedidos:read'], access(['pedidos:read']));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rechaza una sesión sin usuario cuando hay requisitos', async () => {
    const { ctx } = context();
    const guard = guardWith(['pedidos:read'], undefined, access(['pedidos:read']));
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
