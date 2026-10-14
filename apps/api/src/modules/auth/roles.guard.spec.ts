import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';

function mockContext(userRole?: string) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user: userRole ? { sub: 'u1', email: 'a@b.c', role: userRole } : undefined }) }),
  } as never;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();

  it('permite acceso cuando no se declaran roles', () => {
    const guard = new RolesGuard(reflector);
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(mockContext('CONSULTA'))).toBe(true);
  });

  it('ADMIN siempre tiene acceso', () => {
    const guard = new RolesGuard(reflector);
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['GERENCIA']);
    expect(guard.canActivate(mockContext('ADMIN'))).toBe(true);
  });

  it('bloquea roles no autorizados', () => {
    const guard = new RolesGuard(reflector);
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['GERENCIA']);
    expect(() => guard.canActivate(mockContext('CONSULTA'))).toThrow(ForbiddenException);
  });

  it('bloquea usuarios sin sesión', () => {
    const guard = new RolesGuard(reflector);
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(mockContext(undefined))).toThrow(ForbiddenException);
  });
});
