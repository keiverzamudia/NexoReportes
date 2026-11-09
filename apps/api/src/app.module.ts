import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './common/prisma.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { RolesModule } from './modules/roles/roles.module';
import { UsersModule } from './modules/users/users.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { SalesModule } from './modules/sales/sales.module';
import { SyncModule } from './modules/sync/sync.module';
import { ForecastModule } from './modules/forecast/forecast.module';
import { ScenariosModule } from './modules/scenarios/scenarios.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { ArrivalsModule } from './modules/arrivals/arrivals.module';
import { DbMirrorModule } from './modules/db-mirror/db-mirror.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    // RBAC dinámico (global): guard + resolución de permisos.
    PermissionsModule,
    HealthModule,
    AuthModule,
    RolesModule,
    UsersModule,
    AuditModule,
    SyncModule,
    CatalogModule,
    SalesModule,
    ForecastModule,
    ScenariosModule,
    DispatchModule,
    ArrivalsModule,
    // Espejo de la BD local (main → pruebas). La condición se evalúa DESPUÉS
    // de ConfigModule.forRoot, que es quien carga el .env en process.env.
    ...(process.env.NODE_ENV !== 'production' && process.env.DB_MIRROR_ENABLED === '1'
      ? [DbMirrorModule]
      : []),
  ],
})
export class AppModule {}
