import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { CorrelationInterceptor } from './common/correlation.interceptor';
import { normalizeIp, runWithRequestMeta } from './common/request-context';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  app.use(helmet());
  app.use(cookieParser());
  // IP y dispositivo de cada petición: la bitácora los guarda con el actor.
  app.use((req: any, _res: any, next: () => void) => {
    const forwarded = req.headers?.['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip = normalizeIp(String(raw ?? '').split(',')[0]) ?? normalizeIp(req.ip) ?? normalizeIp(req.socket?.remoteAddress);
    const userAgent = typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    runWithRequestMeta({ ip, userAgent }, next);
  });
  // Los escenarios del simulador llevan la foto de todos los renglones
  // marcados en el body (puede superar los 100 KB por defecto de Express).
  app.useBodyParser('json', { limit: '2mb' });

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:4100')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  app.setGlobalPrefix('api');
  // La validación de entradas se hace con pipes Zod (@nexo/contracts) por endpoint.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new CorrelationInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CORPOAGRO API')
    .setDescription('API del sistema de planificación de producción, inventarios y pedidos (datos origen: Profit Plus)')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`CORPOAGRO API escuchando en http://localhost:${port}/api (Swagger: /api/docs)`);
}

void bootstrap();
