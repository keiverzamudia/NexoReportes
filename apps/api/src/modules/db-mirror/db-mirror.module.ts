import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DbMirrorController } from './db-mirror.controller';
import { DbMirrorService } from './db-mirror.service';

// Espejo de la BD local (main → pruebas). Solo se importa desde AppModule
// cuando DB_MIRROR_ENABLED=1 en un entorno que no sea producción.
@Module({
  imports: [AuditModule],
  controllers: [DbMirrorController],
  providers: [DbMirrorService],
})
export class DbMirrorModule {}
