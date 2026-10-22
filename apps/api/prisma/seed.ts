// ============================================================
// Seed de Nexo Producción.
//
// Ya NO crea usuarios internos: los usuarios vienen de Profit
// (`MasterProfit.dbo.VUSUARIOS`) y su contraseña se valida contra
// `MasterProfit.dbo.autenticar`.
//
// Aquí solo se garantizan los 5 roles históricos y su matriz de permisos
// inicial. Es idempotente: si un rol ya existe NO se sobrescribe (las
// ediciones hechas desde Usuarios se conservan). La API también ejecuta esta
// misma inicialización al arrancar (PermissionsService.ensureDefaults).
// ============================================================

import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, ROLES, Role } from '@nexo/contracts';

const prisma = new PrismaClient();

const NAMES: Record<Role, string> = {
  ADMIN: 'Administrador',
  GERENCIA: 'Gerencia',
  PLANIFICADOR: 'Planificador',
  ALMACEN: 'Almacén',
  CONSULTA: 'Consulta',
};

async function main() {
  for (const role of ROLES) {
    const exists = await prisma.role.findUnique({ where: { code: role } });
    if (exists) {
      console.log(`Rol ${role}: ya existe (se conserva).`);
      continue;
    }
    await prisma.role.create({
      data: {
        code: role,
        name: NAMES[role],
        baseRole: role,
        isSystem: role === 'ADMIN',
        description: role === 'ADMIN' ? 'Rol de sistema: siempre tiene todos los permisos.' : null,
        permissions: {
          create: DEFAULT_ROLE_PERMISSIONS[role].map(([module, action]) => ({ module, action })),
        },
      },
    });
    console.log(`Rol ${role}: creado con ${DEFAULT_ROLE_PERMISSIONS[role].length} permisos.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
