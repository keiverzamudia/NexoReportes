import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// Seed idempotente: crear roles de usuario iniciales sin duplicar.
// Ejecutar: pnpm db:seed
async function main() {
  const prisma = new PrismaClient();
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'CambiarAdmin123!';

  const adminEmail = 'admin@nexo.local';
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existing) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(password, rounds),
        fullName: 'Administrador',
        role: 'ADMIN',
      },
    });
    console.log(`Usuario administrador creado: ${adminEmail}`);
  } else {
    console.log(`Usuario administrador ya existía: ${adminEmail}`);
  }

  const defaults: Array<{ key: string; value: string; description: string }> = [
    { key: 'sync.interval_seconds', value: '0', description: 'Intervalo del worker de sincronización (0 = manual)' },
    { key: 'sync.page_size', value: '5000', description: 'Tamaño de lote de lectura desde Profit' },
  ];
  for (const setting of defaults) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }
  console.log('Configuración por defecto asegurada.');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
