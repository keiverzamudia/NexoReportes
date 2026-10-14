import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import { ProfitAdapter, ProfitColumn, ProfitConnectionTest } from './profit.adapter';

// Identificadores de vista permitidos: solo letras, dígitos, _ y un máximo de
// dos puntos (esquema.objeto). Bloquea cualquier intento de inyección SQL.
const SAFE_VIEW_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

// Adaptador SQL Server de SOLO LECTURA para Profit.
// Reutiliza la misma forma de variables de entorno que los proyectos Data-Maestra/Taller.
@Injectable()
export class MssqlProfitAdapter implements ProfitAdapter {
  readonly dialect = 'mssql' as const;
  private readonly logger = new Logger(MssqlProfitAdapter.name);
  private pool: sql.ConnectionPool | null = null;

  constructor(private readonly config: ConfigService) {}

  private poolConfig(): sql.config {
    const server = this.config.get<string>('profit.server');
    const database = this.config.get<string>('profit.database');
    const user = this.config.get<string>('profit.user');
    const password = this.config.get<string>('profit.password');
    if (!server || !database || !user) {
      throw new Error('Conexión Profit no configurada (PROFIT_DB_SERVER / PROFIT_DB_DATABASE / PROFIT_DB_USER)');
    }
    return {
      server,
      database,
      user,
      password,
      options: { encrypt: true, trustServerCertificate: true },
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      requestTimeout: this.config.get<number>('profit.requestTimeoutMs') ?? 30000,
      connectionTimeout: 15000,
    };
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) {
      return this.pool;
    }
    this.pool = new sql.ConnectionPool(this.poolConfig());
    await this.pool.connect();
    return this.pool;
  }

  async testConnection(): Promise<ProfitConnectionTest> {
    const retries = this.config.get<number>('profit.maxRetries') ?? 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const pool = await this.getPool();
        await pool.request().query('SELECT 1 AS ok');
        return { connected: true };
      } catch (error) {
        lastError = error;
        this.logger.warn(`testConnection: intento ${attempt + 1} fallido (${(error as Error).message})`);
      }
    }
    return { connected: false, message: lastError instanceof Error ? lastError.message : 'Error desconocido' };
  }

  async listViews(): Promise<string[]> {
    const pool = await this.getPool();
    const result = await pool.request().query(
      `SELECT TABLE_SCHEMA, TABLE_NAME
       FROM INFORMATION_SCHEMA.VIEWS
       WHERE TABLE_TYPE = 'VIEW'
       ORDER BY TABLE_SCHEMA, TABLE_NAME`,
    );
    return result.recordset.map((row) => `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`);
  }

  async describeView(viewName: string): Promise<ProfitColumn[]> {
    if (!SAFE_VIEW_NAME.test(viewName)) {
      throw new Error(`Nombre de vista inválido: ${viewName}`);
    }
    const parts = viewName.split('.');
    const tableSchema = parts.length === 2 ? parts[0] : 'dbo';
    const tableName = parts[parts.length - 1];
    const pool = await this.getPool();
    const result = await pool
      .request()
      .input('schema', tableSchema)
      .input('table', tableName)
      .query(
        `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
         ORDER BY ORDINAL_POSITION`,
      );
    return result.recordset.map((c) => ({
      name: c.COLUMN_NAME,
      dataType: c.DATA_TYPE,
      maxLength: c.CHARACTER_MAXIMUM_LENGTH ?? null,
      precision: c.NUMERIC_PRECISION ?? null,
      scale: c.NUMERIC_SCALE ?? null,
      nullable: c.IS_NULLABLE === 'YES',
    }));
  }

  async select(viewName: string, params: Record<string, unknown>, limit: number): Promise<Record<string, unknown>[]> {
    if (!SAFE_VIEW_NAME.test(viewName)) {
      throw new Error(`Nombre de vista inválido: ${viewName}`);
    }
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100000));
    const pool = await this.getPool();
    const request = pool.request();
    const inputs = Object.entries(params);
    for (const [key, value] of inputs) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Nombre de parámetro inválido: ${key}`);
      }
      request.input(key, value as never);
    }
    const where = inputs.length
      ? `WHERE ${inputs.map(([key]) => `${key} = @${key}`).join(' AND ')}`
      : '';
    // Identificador ya validado con SAFE_VIEW_NAME; los valores viajan siempre como parámetros.
    const result = await request.query(`SELECT TOP (${safeLimit}) * FROM ${viewName} ${where}`);
    return result.recordset as Record<string, unknown>[];
  }
}
