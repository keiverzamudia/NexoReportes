import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import type { ProfitLockResult, ProfitWriteResult, ProfitWriter } from './profit-writer.adapter';

// ============================================================
// Adaptador de ESCRITURA (SQL Server) para dos campos del encabezado:
//   dbo.cotiz_c.fec_venc  (fecha de entrega del pedido)
//   dbo.cotiz_c.aux01     (bloqueo de la fecha al iniciar la carga)
//
// · Conexión y credenciales SEPARADAS de las de lectura diaria.
// · Sentencias fijas, con parámetros: no hay SQL construido por el usuario.
// · Un pedido = una fila de encabezado; se exige exactamente 1 fila.
// ============================================================

const SAFE_ORDER_NUMBER = /^\d{1,12}$/;
const SAFE_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Códigos de Profit (`co_us_mo` es char(6)): letras/números, hasta 6.
const SAFE_USER_CODE = /^[A-Z0-9_]{1,6}$/;

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    // `fec_venc` es smalldatetime: llega como medianoche UTC del día.
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

@Injectable()
export class MssqlProfitWriter implements ProfitWriter {
  readonly enabled: boolean;
  readonly dryRun: boolean;
  private readonly logger = new Logger(MssqlProfitWriter.name);
  private pool: sql.ConnectionPool | null = null;
  private connecting: Promise<sql.ConnectionPool> | null = null;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('profit.write.user');
    const password = this.config.get<string>('profit.write.password');
    this.enabled = Boolean(this.config.get<boolean>('profit.write.enabled')) && Boolean(user) && Boolean(password);
    this.dryRun = this.config.get<boolean>('profit.write.dryRun') ?? false;
    if (!this.enabled) {
      this.logger.warn(
        'Escritura en Profit deshabilitada (PROFIT_WRITE_ENABLED=false o credenciales SQL incompletas).',
      );
    } else if (this.dryRun) {
      this.logger.warn('Escritura en Profit en modo SIMULACIÓN (PROFIT_WRITE_DRY_RUN=true): no se escribe nada.');
    } else {
      this.logger.log(`Escritura en Profit ACTIVA con el usuario SQL "${user}" (dbo.cotiz_c).`);
    }
  }

  private runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(task, task);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private poolConfig(): sql.config {
    const server = this.config.get<string>('profit.server');
    const database = this.config.get<string>('profit.database');
    const user = this.config.get<string>('profit.write.user');
    const password = this.config.get<string>('profit.write.password');
    if (!server || !database || !user) {
      throw new Error('Escritura Profit no configurada (PROFIT_DB_SERVER / PROFIT_DB_DATABASE / PROFIT_WRITE_USER)');
    }
    return {
      server,
      database,
      user,
      password,
      options: { encrypt: true, trustServerCertificate: true },
      pool: { max: 2, min: 0, idleTimeoutMillis: 30000 },
      requestTimeout: this.config.get<number>('profit.requestTimeoutMs') ?? 30000,
      connectionTimeout: 15000,
    };
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;
    if (this.connecting) return this.connecting;
    const pool = new sql.ConnectionPool(this.poolConfig());
    this.pool = pool;
    this.connecting = pool
      .connect()
      .then(() => {
        this.connecting = null;
        return pool;
      })
      .catch((error: unknown) => {
        this.connecting = null;
        this.pool = null;
        throw error;
      });
    return this.connecting;
  }

  async updateOrderDeliveryDate(
    orderNumber: string,
    date: string,
    userCode: string,
  ): Promise<ProfitWriteResult> {
    if (!SAFE_ORDER_NUMBER.test(orderNumber)) {
      throw new Error(`Número de pedido inválido: ${orderNumber}`);
    }
    if (!SAFE_DATE.test(date)) {
      throw new Error(`Fecha inválida: ${date}`);
    }
    const user = userCode.trim().toUpperCase();
    if (!SAFE_USER_CODE.test(user)) {
      throw new Error(`Código de usuario de Profit inválido: ${userCode}`);
    }
    if (this.dryRun) {
      // El servicio no llama al escritor en dry-run; se deja explícito igual.
      return { affected: 0, previousDate: null, nextDate: null };
    }

    const pool = await this.getPool();
    const result = await this.runSerialized(() =>
      pool
        .request()
        .input('numero', sql.Int, Number(orderNumber))
        // Se envía como texto yyyy-MM-dd y se convierte en SQL: evita corrimientos
        // de día por zona horaria al serializar un Date.
        .input('fecha', sql.VarChar(10), date)
        // Auditoría propia de Profit: quién modificó y cuándo.
        .input('usuario', sql.Char(6), user)
        .query(
          `UPDATE dbo.cotiz_c
              SET fec_venc = CONVERT(date, @fecha, 23),
                  co_us_mo = @usuario,
                  fe_us_mo = GETDATE()
            OUTPUT deleted.fec_venc AS anterior, inserted.fec_venc AS nueva
            WHERE fact_num = @numero AND anulada = 0`,
        ),
    );

    const row = (result.recordset?.[0] ?? null) as { anterior?: unknown; nueva?: unknown } | null;
    if (!row) {
      return { affected: 0, previousDate: null, nextDate: null };
    }
    return {
      affected: result.rowsAffected?.[0] ?? 1,
      previousDate: dateOnly(row.anterior),
      nextDate: dateOnly(row.nueva) ?? date,
    };
  }

  async updateOrderDateLock(
    orderNumber: string,
    locked: boolean,
    userCode: string,
  ): Promise<ProfitLockResult> {
    if (!SAFE_ORDER_NUMBER.test(orderNumber)) {
      throw new Error(`Número de pedido inválido: ${orderNumber}`);
    }
    const user = userCode.trim().toUpperCase();
    if (!SAFE_USER_CODE.test(user)) {
      throw new Error(`Código de usuario de Profit inválido: ${userCode}`);
    }
    if (this.dryRun) {
      return { affected: 0 };
    }

    const pool = await this.getPool();
    const result = await this.runSerialized(() =>
      pool
        .request()
        .input('numero', sql.Int, Number(orderNumber))
        // aux01 es decimal(18,5) NOT NULL: se envía 1/0, nunca NULL.
        .input('bloqueo', sql.Decimal(18, 5), locked ? 1 : 0)
        .input('usuario', sql.Char(6), user)
        .query(
          `UPDATE dbo.cotiz_c
              SET aux01 = @bloqueo,
                  co_us_mo = @usuario,
                  fe_us_mo = GETDATE()
            WHERE fact_num = @numero AND anulada = 0`,
        ),
    );

    return { affected: result.rowsAffected?.[0] ?? 0 };
  }
}
