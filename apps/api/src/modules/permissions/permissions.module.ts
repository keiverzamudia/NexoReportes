import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';

// Global: cualquier controlador puede usar `PermissionsGuard` sin importar
// este módulo (mismo patrón que PrismaModule/JwtModule globales).
@Global()
@Module({
  providers: [PermissionsService, PermissionsGuard],
  exports: [PermissionsService, PermissionsGuard],
})
export class PermissionsModule {}
