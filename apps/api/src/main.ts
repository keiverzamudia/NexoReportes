import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { CorrelationInterceptor } from './common/correlation.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.use(helmet());
  app.use(cookieParser());

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
    .setTitle('Nexo Producción API')
    .setDescription('API del sistema de planificación de producción, inventarios y pedidos (datos origen: Profit Plus)')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`Nexo Producción API escuchando en http://localhost:${port}/api (Swagger: /api/docs)`);
}

void bootstrap();
