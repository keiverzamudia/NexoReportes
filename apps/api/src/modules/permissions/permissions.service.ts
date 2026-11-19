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
  /** Código de vendedor de Profit vinculado al usuario (null = sin vínculo). */
  sellerCode: string | null;
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

    // El módulo «Vendedoras» pasó a llamarse «Vendedor». La clave interna
    // cambia de `vendedoras` a `vendedor`: se migran los permisos de rol y las
    // excepciones de usuario antes de sembrar el módulo nuevo.
    await this.migrateModuleKey('vendedoras', 'vendedor');

    // Módulos agregados después de la instalación original: se siembran sus
    // permisos por defecto en los roles de sistema que aún no los tengan, sin
    // resucitar permisos que un administrador haya quitado a mano.
    await this.seedMissingModule(DEFAULT_ROLE_PERMISSIONS, 'llegadas');
    await this.seedMissingModule(DEFAULT_ROLE_PERMISSIONS, 'vendedor');
    // Producción nace con lectura para todos y costos para gerencia/planificador.
    await this.seedMissingModule(DEFAULT_ROLE_PERMISSIONS, 'produccion');
    // Cuentas por cobrar nace como module de solo lectura para GERENCIA.
    await this.seedMissingModule(DEFAULT_ROLE_PERMISSIONS, 'cxc');
    // Permiso especial de cuotas: ADMIN lo recibe por sistema al arrancar.
    // Los demás roles lo obtienen solo si un administrador se lo concede.
    await this.seedMissingModule(DEFAULT_ROLE_PERMISSIONS, 'vendedor_cuotas');

    // «Cambiar fecha de entrega» nace como permiso independiente de
    // «Editar» (ahora escribe en Profit). Los roles y excepciones que ya
    // tenían «Editar» conservan la capacidad sin intervención manual.
    await this.inheritPermission('pedidos', 'update', 'change_date');

    // Pedidos se partió en tres vistas (Simulador / Ventas / Historial).
    // Se siembran UNA sola vez en los roles de sistema que ya ven Pedidos;
    // a partir de ahí el administrador decide y una revocación no se resucita
    // en el siguiente arranque.
    await this.seedPedidosViews();

    // «Ver todos los vendedores» nace concedido a quien ya veía el reporte
    // completo: así la actualización no restringe a nadie de golpe. El
    // administrador puede quitarlo por rol o por excepción de usuario.
    await this.seedVendedorViewAll();
  }

  private async seedVendedorViewAll(): Promise<void> {
    const markerKey = 'rbac.seed.vendedor_view_all.v1';
    const marker = await this.prisma.systemSetting.findUnique({ where: { key: markerKey } });
    if (marker) return;

    const readers = await this.prisma.rolePermission.findMany({
      where: { module: 'vendedor', action: 'read' },
      select: { roleCode: true },
    });
    for (const { roleCode } of readers) {
      await this.prisma.rolePermission.upsert({
        where: {
          roleCode_module_action: { roleCode, module: 'vendedor', action: 'view_all' },
        },
        update: {},
        create: { roleCode, module: 'vendedor', action: 'view_all' },
      });
    }

    await this.prisma.systemSetting.upsert({
      where: { key: markerKey },
      update: {},
      create: {
        key: markerKey,
        value: new Date().toISOString(),
        description: 'Siembra inicial del permiso «Ver todos los vendedores».',
      },
    });
  }

  private async seedPedidosViews(): Promise<void> {
    const markerKey = 'rbac.seed.pedidos_views.v1';
    const marker = await this.prisma.systemSetting.findUnique({ where: { key: markerKey } });
    if (marker) return;

    const views = ['view_summary', 'view_history'] as const;
    for (const role of ROLES) {
      const read = await this.prisma.rolePermission.findUnique({
        where: { roleCode_module_action: { roleCode: role, module: 'pedidos', action: 'read' } },
      });
      if (!read) continue;

      const defaults = DEFAULT_ROLE_PERMISSIONS[role]
        .filter(([module, action]) => module === 'pedidos' && views.includes(action as (typeof views)[number]))
        .map(([, action]) => action);
      for (const action of defaults) {
        await this.prisma.rolePermission.upsert({
          where: { roleCode_module_action: { roleCode: role, module: 'pedidos', action } },
          update: {},
          create: { roleCode: role, module: 'pedidos', action },
        });
      }
    }

    await this.prisma.systemSetting.upsert({
      where: { key: markerKey },
      update: {},
      create: {
        key: markerKey,
        value: new Date().toISOString(),
        description: 'Siembra inicial de las vistas Ventas e Historial de Pedidos.',
      },
    });
  }

  /**
   * Renombra una clave de módulo en la matriz de roles y en las excepciones
   * de usuario. Es idempotente: si el permiso nuevo ya existe, conserva el
   * nuevo y elimina el viejo. Se ejecuta al arrancar para no romper sesiones
   * ni obligar a un script manual.
   */
  private async migrateModuleKey(from: string, to: string): Promise<void> {
    const roleRows = await this.prisma.rolePermission.findMany({ where: { module: from } });
    for (const row of roleRows) {
      const exists = await this.prisma.rolePermission.findUnique({
        where: { roleCode_module_action: { roleCode: row.roleCode, module: to, action: row.action } },
      });
      if (!exists) {
        await this.prisma.rolePermission.create({
          data: { roleCode: row.roleCode, module: to, action: row.action },
        });
      }
      await this.prisma.rolePermission.delete({
        where: { roleCode_module_action: { roleCode: row.roleCode, module: from, action: row.action } },
      });
    }

    const overrides = await this.prisma.userPermission.findMany({ where: { module: from } });
    for (const row of overrides) {
      const exists = await this.prisma.userPermission.findUnique({
        where: { userId_module_action: { userId: row.userId, module: to, action: row.action } },
      });
      if (!exists) {
        await this.prisma.userPermission.create({
          data: { userId: row.userId, module: to, action: row.action, allowed: row.allowed },
        });
      }
      await this.prisma.userPermission.delete({ where: { id: row.id } });
    }
  }

  private async seedMissingModule(
    defaults: Record<Role, Array<[string, PermissionAction]>>,
    module: string,
  ): Promise<void> {
    for (const role of ROLES) {
      const row = await this.prisma.role.findUnique({
        where: { code: role },
        select: { permissions: { where: { module }, select: { action: true } } },
      });
      if (!row || row.permissions.length > 0) continue;

      const expected = defaults[role]
        .filter(([key]) => key === module)
        .map(([, action]) => action);
      if (expected.length === 0) continue;

      await this.prisma.$transaction(
        expected.map((action) =>
          this.prisma.rolePermission.create({ data: { roleCode: role, module, action } }),
        ),
      );
    }
  }

  /**
   * Hereda una acción nueva desde otra existente (roles y excepciones de
   * usuario). Sirve para partir un permiso sin dejar a nadie sin acceso:
   * `pedidos:update` → `pedidos:change_date`. Idempotente.
   */
  private async inheritPermission(module: string, fromAction: string, toAction: string): Promise<void> {
    const roleRows = await this.prisma.rolePermission.findMany({
      where: { module, action: fromAction },
    });
    for (const row of roleRows) {
      const exists = await this.prisma.rolePermission.findUnique({
        where: { roleCode_module_action: { roleCode: row.roleCode, module, action: toAction } },
      });
      if (!exists) {
        await this.prisma.rolePermission.create({
          data: { roleCode: row.roleCode, module, action: toAction },
        });
      }
    }

    const overrides = await this.prisma.userPermission.findMany({
      where: { module, action: fromAction },
    });
    for (const row of overrides) {
      const exists = await this.prisma.userPermission.findUnique({
        where: { userId_module_action: { userId: row.userId, module, action: toAction } },
      });
      if (!exists) {
        await this.prisma.userPermission.create({
          data: { userId: row.userId, module, action: toAction, allowed: row.allowed },
        });
      }
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
      sellerCode: user.sellerCode ?? null,
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
