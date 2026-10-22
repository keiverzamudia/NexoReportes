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

// Usuario de Profit para el login (`MasterProfit.dbo.VUSUARIOS`).
// `codigo` es CHAR con relleno: el adaptador siempre lo entrega recortado.
export interface ProfitUserRef {
  code: string;
  name: string;
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
  // `params` se bindean como parámetros (@nombre); el input del usuario nunca
  // se interpola en el texto SQL.
  selectQuery(sqlText: string, limit: number, params?: Record<string, unknown>): Promise<Record<string, unknown>[]>;

  // Autenticación: valida la contraseña de un usuario contra Profit
  // (`<authDatabase>.dbo.autenticar`, una función de tabla que devuelve `ID`).
  // Devuelve el id que responde Profit —debe coincidir con el código— o `null`
  // si las credenciales no son válidas. La contraseña se descarta al volver.
  authenticateUser(profitCode: string, password: string): Promise<string | null>;

  // Usuarios de Profit (`<authDatabase>.dbo.VUSUARIOS`), ya recortados y sin
  // duplicados, ordenados por nombre.
  listUsers(): Promise<ProfitUserRef[]>;
}
