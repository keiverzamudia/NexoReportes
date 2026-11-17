// ============================================================
// Contrato de ESCRITURA puntual en Profit.
//
// Es la única excepción controlada a la regla de solo lectura del proyecto:
// únicamente `dbo.cotiz_c.fec_venc` (fecha de entrega del pedido). No existe
// SQL arbitrario ni acceso desde el usuario HTTP: el servicio llama a un
// método acotado y el adaptador usa una sentencia fija y parametrizada.
// ============================================================

export const PROFIT_WRITER = 'PROFIT_WRITER';

export interface ProfitWriteResult {
  /** Filas afectadas (0 = el pedido no existe/no está abierto en Profit). */
  affected: number;
  /** Entrega anterior según Profit (null si no había). */
  previousDate: string | null;
  /** Entrega nueva según Profit (null si no se escribió). */
  nextDate: string | null;
}

export interface ProfitLockResult {
  /** Filas afectadas (0 = el pedido no existe/no está abierto en Profit). */
  affected: number;
}

export interface ProfitWriter {
  /** Credenciales de escritura configuradas y habilitadas. */
  readonly enabled: boolean;
  /** true = valida pero no escribe (primera puesta en marcha). */
  readonly dryRun: boolean;

  /**
   * Mueve la entrega del pedido completo. `date` es `yyyy-MM-dd`.
   * La fecha vive en el encabezado: afecta a todos los renglones.
   * `userCode` es el código de Profit del usuario con sesión; se sella en
   * `co_us_mo`/`fe_us_mo` para que el ERP y sus reportes sepan quién lo hizo.
   */
  updateOrderDeliveryDate(orderNumber: string, date: string, userCode: string): Promise<ProfitWriteResult>;

  /**
   * Bloquea/libera el cambio de fecha del pedido en Profit
   * (`cotiz_c.aux01 = 1 | 0`). Se usa al iniciar la carga en despacho.
   */
  updateOrderDateLock(orderNumber: string, locked: boolean, userCode: string): Promise<ProfitLockResult>;
}
