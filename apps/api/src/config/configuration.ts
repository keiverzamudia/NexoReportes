import { z } from 'zod';

// Configuración validada al arrancar: falla temprano si falta algo crítico.
const envSchema = z.object({

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET debe tener al menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  PROFIT_DB_SERVER: z.string().optional(),
  PROFIT_DB_DATABASE: z.string().optional(),
  PROFIT_DB_USER: z.string().optional(),
  PROFIT_DB_PASSWORD: z.string().optional(),
  PROFIT_DB_DIALECT: z.enum(['mssql', 'fixtures']).default('fixtures'),
  PROFIT_DB_REQUEST_TIMEOUT_MS: z.coerce.number().int().default(30000),
  PROFIT_DB_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  // Única vista de origen: una fila = un renglón de solicitud
  // (pedido + cliente + artículo + pendiente + existencias por almacén).
  PROFIT_VIEW_SOLICITUDES: z.string().optional(),

  SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(0),
  SYNC_PAGE_SIZE: z.coerce.number().int().min(100).max(50000).default(5000),

  CORS_ORIGINS: z.string().default('http://localhost:4100'),
});

// La validación se ejecuta DENTRO de la factory: ConfigModule.forRoot({ load: [configuration] })
// populatea process.env desde .env ANTES de invocarla. Validar a nivel de módulo fallaría
// porque el .env aún no se ha cargado.
export default function configuration() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n  ');
    throw new Error(`Variables de entorno inválidas:\n  ${issues}`);
  }

  const env = parsed.data;

  return {
    env: env.NODE_ENV,
    port: env.API_PORT,
    logLevel: env.LOG_LEVEL,
    database: { url: env.DATABASE_URL },
    auth: {
      jwtSecret: env.JWT_SECRET,
      jwtRefreshSecret: env.JWT_REFRESH_SECRET,
      jwtExpiresIn: env.JWT_EXPIRES_IN,
      jwtRefreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
    profit: {
      dialect: env.PROFIT_DB_DIALECT,
      server: env.PROFIT_DB_SERVER,
      database: env.PROFIT_DB_DATABASE,
      user: env.PROFIT_DB_USER,
      password: env.PROFIT_DB_PASSWORD,
      requestTimeoutMs: env.PROFIT_DB_REQUEST_TIMEOUT_MS,
      maxRetries: env.PROFIT_DB_MAX_RETRIES,
      views: {
        solicitudes: env.PROFIT_VIEW_SOLICITUDES,
      },
    },
    sync: {
      intervalSeconds: env.SYNC_INTERVAL_SECONDS,
      pageSize: env.SYNC_PAGE_SIZE,
    },
    cors: { origins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) },
  };
}
