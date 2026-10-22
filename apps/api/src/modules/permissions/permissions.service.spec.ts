import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PermissionsService } from './permissions.service';

// Fake mínimo de Prisma para la resolución de permisos.
function serviceFor(options: {
  user: {
    id: string;
    role: string;
    permissionOverrides: { module: string; action: string; allowed: boolean }[];
  } | null;
  role?: {
    code: string;
    name: string;
    baseRole: string;
    isSystem: boolean;
    permissions: { module: string; action: string }[];
  } | null;
}) {
  const prisma = {
    user: { findUnique: async () => options.user },
    role: { findUnique: async () => options.role ?? null },
  } as never;
  return new PermissionsService(prisma);
}

describe('PermissionsService', () => {
  it('aplica las excepciones del usuario sobre el rol (denegar gana)', async () => {
    const service = serviceFor({
      user: {
        id: 'u1',
        role: 'PLANIFICADOR',
        permissionOverrides: [{ module: 'pedidos', action: 'read', allowed: false }],
      },
      role: {
        code: 'PLANIFICADOR',
        name: 'Planificador',
        baseRole: 'PLANIFICADOR',
        isSystem: false,
        permissions: [
          { module: 'pedidos', action: 'read' },
          { module: 'pedidos', action: 'update' },
        ],
      },
    });

    const access = await service.resolve('u1');
    expect(access?.permissions).toContain('pedidos:update');
    expect(access?.permissions).not.toContain('pedidos:read');
    expect(access?.baseRole).toBe('PLANIFICADOR');
  });

  it('una excepción puede conceder una acción que el rol no tiene', async () => {
    const service = serviceFor({
      user: {
        id: 'u2',
        role: 'CONSULTA',
        permissionOverrides: [{ module: 'usuarios', action: 'read', allowed: true }],
      },
      role: {
        code: 'CONSULTA',
        name: 'Consulta',
        baseRole: 'CONSULTA',
        isSystem: false,
        permissions: [{ module: 'pedidos', action: 'read' }],
      },
    });

    const access = await service.resolve('u2');
    expect(access?.permissions).toEqual(expect.arrayContaining(['pedidos:read', 'usuarios:read']));
  });

  it('ADMIN siempre tiene todos los permisos, aunque el rol esté vacío', async () => {
    const service = serviceFor({
      user: { id: 'u3', role: 'ADMIN', permissionOverrides: [] },
      role: {
        code: 'ADMIN',
        name: 'Administrador',
        baseRole: 'ADMIN',
        isSystem: true,
        permissions: [],
      },
    });

    const access = await service.resolve('u3');
    expect(access?.isAdmin).toBe(true);
    expect(access?.permissions).toContain('usuarios:delete');
    expect(access?.permissions).toContain('despacho:update');
  });

  it('si el rol no existe usa la plantilla de sistema como respaldo', async () => {
    const service = serviceFor({ user: { id: 'u4', role: 'CONSULTA', permissionOverrides: [] }, role: null });
    const access = await service.resolve('u4');
    expect(access?.permissions).toContain('pedidos:read');
    expect(access?.permissions).not.toContain('usuarios:read');
  });

  it('rechaza permisos desconocidos y deduplica entradas válidas', () => {
    const service = serviceFor({ user: null });
    expect(() => service.normalizeEntries([{ module: 'inventado', action: 'read' }])).toThrow(BadRequestException);
    expect(
      service.normalizeEntries([
        { module: 'pedidos', action: 'read' },
        { module: 'pedidos', action: 'read' },
      ]),
    ).toHaveLength(1);
    expect(() => service.normalizeEntries([{ module: 'pedidos', action: 'update' }])).not.toThrow();
  });
});
