export const PROFIT_ADAPTER = 'PROFIT_ADAPTER';

export interface ProfitConnectionTest {
  connected: boolean;
  message?: string;
}

// Columna de una vista, leída desde INFORMATION_SCHEMA (nunca asumida).
export interface ProfitColumn {
  name: string;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
}

// Contrato del adaptador de Profit (SQL Server, SOLO LECTURA).
// Todas las consultas deben ser SELECT parametrizadas; nunca INSERT/UPDATE/DELETE.
export interface ProfitAdapter {
  readonly dialect: 'mssql' | 'fixtures';

  // Verifica la conectividad y credenciales de solo lectura.
  testConnection(): Promise<ProfitConnectionTest>;

  // Lista las vistas disponibles en la base de datos configurada
  // (herramienta de descubrimiento mientras se confirman las vistas reales).
  listViews(): Promise<string[]>;

  // Devuelve las columnas reales de una vista (INFORMATION_SCHEMA).
  // Permite mapear sin asumir nombres ni tipos.
  describeView(viewName: string): Promise<ProfitColumn[]>;

  // Ejecuta una consulta SELECT parametrizada de solo lectura con límite de filas.
  select(viewName: string, params: Record<string, unknown>, limit: number): Promise<Record<string, unknown>[]>;

  // Ejecuta una consulta SQL de SOLO LECTURA definida por la app (no por el usuario).
  // Se usa para leer los campos que la vista actual no expone (vendedor, tipo de
  // cliente, autorizado, cantidad, almacén) sin modificar nada en Profit.
  selectQuery(sqlText: string, limit: number): Promise<Record<string, unknown>[]>;
}
