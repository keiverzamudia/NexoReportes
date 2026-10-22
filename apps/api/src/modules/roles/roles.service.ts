import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ROLES, RoleInput, RoleSummary, RoleUpdateInput, permissionKey } from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../permissions/permissions.service';

// CRUD de roles. ADMIN es de sistema: no se edita ni se borra, y siempre
// tiene todos los permisos. Un rol en uso no se puede eliminar.
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  async list(): Promise<RoleSummary[]> {
    const [roles, counts] = await Promise.all([
      this.prisma.role.findMany({
        include: { permissions: true },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    ]);
    const byRole = new Map(counts.map((entry) => [entry.role, entry._count._all]));
    return roles.map((role) => ({
      code: role.code,
      name: role.name,
      description: role.description,
      baseRole: role.baseRole as RoleSummary['baseRole'],
      isSystem: role.isSystem,
      userCount: byRole.get(role.code) ?? 0,
      permissions: role.permissions.map((entry) => permissionKey(entry.module, entry.action)).sort(),
    }));
  }

  async create(input: RoleInput, actor?: { id?: string }) {
    const code = input.code.trim().toUpperCase();
    const exists = await this.prisma.role.findUnique({ where: { code }, select: { code: true } });
    if (exists) {
      throw new ConflictException(`Ya existe un rol con el código ${code}`);
    }
    const permissions = this.permissions.normalizeEntries(input.permissions);

    const role = await this.prisma.role.create({
      data: {
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        baseRole: input.baseRole,
        isSystem: false,
        permissions: {
          create: permissions.map(({ module, action }) => ({ module, action })),
        },
      },
      include: { permissions: true },
    });

    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'ROLE_CREATED',
      entityType: 'Role',
      entityId: role.code,
      context: {
        name: role.name,
        baseRole: role.baseRole,
        permissions: permissions.map(({ module, action }) => permissionKey(module, action)),
      },
    });
    return this.summary(role);
  }

  async update(code: string, input: RoleUpdateInput, actor?: { id?: string }) {
    const current = await this.prisma.role.findUnique({
      where: { code: code.toUpperCase() },
      include: { permissions: true },
    });
    if (!current) throw new NotFoundException('Rol no encontrado');
    if (current.isSystem) {
      throw new ForbiddenException('El rol ADMIN es de sistema: no se puede editar');
    }

    const permissions =
      input.permissions !== undefined ? this.permissions.normalizeEntries(input.permissions) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleCode: current.code } });
        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map(({ module, action }) => ({ roleCode: current.code, module, action })),
          });
        }
      }
      return tx.role.update({
        where: { code: current.code },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          ...(input.baseRole !== undefined ? { baseRole: input.baseRole } : {}),
        },
        include: { permissions: true },
      });
    });

    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'ROLE_UPDATED',
      entityType: 'Role',
      entityId: updated.code,
      context: {
        name: updated.name,
        baseRole: updated.baseRole,
        before: current.permissions.map((entry) => permissionKey(entry.module, entry.action)),
        permissions: updated.permissions.map((entry) => permissionKey(entry.module, entry.action)),
      },
    });
    return this.summary(updated);
  }

  async remove(code: string, actor?: { id?: string }) {
    const role = await this.prisma.role.findUnique({ where: { code: code.toUpperCase() } });
    if (!role) throw new NotFoundException('Rol no encontrado');
    if (role.isSystem) {
      throw new ForbiddenException('El rol ADMIN es de sistema: no se puede eliminar');
    }
    // Los 5 roles base se pueden editar, pero no borrar: DEFAULT_USER_ROLE y
    // la sincronización de Profit los usan como destino seguro.
    if ((ROLES as readonly string[]).includes(role.code)) {
      throw new ForbiddenException(
        `El rol ${role.code} es una plantilla base del sistema: se puede editar, pero no eliminar.`,
      );
    }
    const users = await this.prisma.user.count({ where: { role: role.code } });
    if (users > 0) {
      throw new ConflictException(
        `No se puede eliminar el rol ${role.code}: tiene ${users} usuario(s) asignado(s). Cámbialos de rol primero.`,
      );
    }
    await this.prisma.role.delete({ where: { code: role.code } });
    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'ROLE_DELETED',
      entityType: 'Role',
      entityId: role.code,
      context: { name: role.name },
    });
    return { deleted: true };
  }

  /** Verifica que un código de rol exista antes de asignarlo a un usuario. */
  async assertAssignable(code: string): Promise<void> {
    if (!(await this.permissions.roleExists(code))) {
      throw new BadRequestException(`El rol ${code} no existe`);
    }
  }

  private summary(role: {
    code: string;
    name: string;
    description: string | null;
    baseRole: string;
    isSystem: boolean;
    permissions: { module: string; action: string }[];
  }): RoleSummary {
    return {
      code: role.code,
      name: role.name,
      description: role.description,
      baseRole: role.baseRole as RoleSummary['baseRole'],
      isSystem: role.isSystem,
      userCount: 0,
      permissions: role.permissions.map((entry) => permissionKey(entry.module, entry.action)).sort(),
    };
  }
}
