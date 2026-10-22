import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { SyncModule } from '../sync/sync.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' },
      }),
    }),
    // Auditoría de intentos de login.
    AuditModule,
    // Adaptador de Profit: valida la contraseña contra MasterProfit.dbo.autenticar.
    SyncModule,
    // Padrón de usuarios (autocompletado del login).
    UsersModule,
  ],
  controllers: [AuthController],
  // PermissionsGuard/PermissionsService viven en el módulo global de permisos.
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
