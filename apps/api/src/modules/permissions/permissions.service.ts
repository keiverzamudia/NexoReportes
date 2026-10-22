import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  APP_MODULES,
  DEFAULT_ROLE_PERMISSIONS,
  PermissionAction,
  PermissionEntry,
  ROLES,
  Role,
  permissionKey,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';

// ============================================================
// RBAC dinámico: resuelve los permisos efectivos de un usuario.
//
//   permisos = (lo que concede su rol) ± (excepciones del usuario)
//
// Las excepciones ganan: allowed=true concede aunque el rol no lo tenga;
// allowed=false deniega aunque el rol sí lo tenga. El rol ADMIN es de
// sistema y siempre tiene todos los permisos.
//
// Se consulta en cada petición (guard): un cambio de rol o de permisos
// aplica sin esperar al refresh del JWT.
// ============================================================

export interface EffectiveAccess {
  userId: string;
  /** Código del rol efectivo (puede ser dinámico). */
  role: string;
  roleName: string;
  /** Plantilla histórica: semántica fina de Despacho. */
  baseRole: Role;
  isAdmin: boolean;
  /** Claves planas «modulo:accion». */
  permissions: string[];
}

export function isKnownPermission(module: string, action: string): boolean {
  const definition = APP_MODULES.find((entry) => entry.key === module);
  return Boolean(definition?.actions.some((entry) => entry.action === action));
}

@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Crea los 5 roles históricos si faltan (instalación nueva o base previa
    // sin tabla de roles). Nunca sobrescribe lo que un administrador editó.
    try {
      await this.ensureDefaults();
    } catch (error) {
      // No se cae la API: `resolve` tiene un fallback a los permisos por
      // defecto para los roles de sistema.
      this.logger.warn(
        `No se pudieron inicializar los roles por defecto: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async ensureDefaults(): Promise<void> {
    const defaults: Record<Role, Role> = {
      ADMIN: 'ADMIN',
      GERENCIA: 'GERENCIA',
      PLANIFICADOR: 'PLANIFICADOR',
      ALMACEN: 'ALMACEN',
      CONSULTA: 'CONSULTA',
    };
    const names: Record<Role, string> = {
      ADMIN: 'Administrador',
      GERENCIA: 'Gerencia',
      PLANIFICADOR: 'Planificador',
      ALMACEN: 'Almacén',
      CONSULTA: 'Consulta',
    };

    for (const role of ROLES) {
      const exists = await this.prisma.role.findUnique({ where: { code: role } });
      if (exists) continue;
      await this.prisma.role.create({
        data: {
          code: role,
          name: names[role],
          baseRole: defaults[role],
          isSystem: role === 'ADMIN',
          description: role === 'ADMIN' ? 'Rol de sistema: siempre tiene todos los permisos.' : null,
          permissions: {
            create: DEFAULT_ROLE_PERMISSIONS[role].map(([module, action]) => ({ module, action })),
          },
        },
      });
    }
  }

  /** Permisos que concede un rol (sin excepciones del usuario). */
  async rolePermissions(roleCode: string): Promise<string[]> {
    const role = await this.prisma.role.findUnique({
      where: { code: roleCode },
      include: { permissions: true },
    });
    if (role) {
      return uniqueKeys(role.permissions.map((entry) => permissionKey(entry.module, entry.action)));
    }
    // Fallback para una base recién creada o un rol de sistema aún no sembrado.
    if ((ROLES as readonly string[]).includes(roleCode)) {
      return uniqueKeys(
        DEFAULT_ROLE_PERMISSIONS[roleCode as Role].map(([module, action]) => permissionKey(module, action)),
      );
    }
    return [];
  }

  /** Resuelve el acceso efectivo. null si el usuario no existe. */
  async resolve(userId: string): Promise<EffectiveAccess | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { permissionOverrides: true },
    });
    if (!user) return null;

    const role = await this.prisma.role.findUnique({ where: { code: user.role } });
    const isAdmin = user.role === 'ADMIN';
    const template = (ROLES as readonly string[]).includes(user.role) ? user.role : 'CONSULTA';
    const baseRole = (role?.baseRole ?? template) as Role;
    const roleName = role?.name ?? (isAdmin ? 'Administrador' : user.role);
    const granted = new Set(await this.rolePermissions(user.role));

    for (const override of user.permissionOverrides) {
      const key = permissionKey(override.module, override.action);
      if (override.allowed) granted.add(key);
      else granted.delete(key);
    }

    const permissions = isAdmin
      ? APP_MODULES.flatMap((module) => module.actions.map(({ action }) => permissionKey(module.key, action)))
      : [...granted];

    return {
      userId: user.id,
      role: user.role,
      roleName,
      baseRole,
      isAdmin,
      permissions: permissions.sort(),
    };
  }

  async roleExists(roleCode: string): Promise<boolean> {
    if ((ROLES as readonly string[]).includes(roleCode)) return true;
    const role = await this.prisma.role.findUnique({ where: { code: roleCode }, select: { code: true } });
    return Boolean(role);
  }

  /**
   * Valida y normaliza entradas de matriz: módulo y acción deben existir en
   * el catálogo y no se permiten duplicados.
   */
  normalizeEntries(entries: PermissionEntry[]): PermissionEntry[] {
    const seen = new Set<string>();
    const normalized: PermissionEntry[] = [];
    for (const entry of entries) {
      const module = entry.module.trim();
      if (!isKnownPermission(module, entry.action)) {
        throw new BadRequestException(`Permiso desconocido: ${module}:${entry.action}`);
      }
      const key = permissionKey(module, entry.action);
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ module, action: entry.action as PermissionAction });
    }
    return normalized;
  }
}

function uniqueKeys(keys: string[]): string[] {
  return [...new Set(keys)].sort();
}
