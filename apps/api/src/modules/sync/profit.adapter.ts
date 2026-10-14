export const PROFIT_ADAPTER = 'PROFIT_ADAPTER';

export interface ProfitConnectionTest {
  connected: boolean;
  message?: string;
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

  // Ejecuta una consulta SELECT parametrizada de solo lectura con límite de filas.
  select(viewName: string, params: Record<string, unknown>, limit: number): Promise<Record<string, unknown>[]>;
}
