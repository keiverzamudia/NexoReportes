// ============================================================
// Normalizadores puros: fila cruda de Profit → forma canónica.
// Sin acceso a BD ni a HTTP: unit-testeables aisladamente.
//
// Fuente única de verdad: la vista real
//   COR_A3.dbo.Solicitudes_Pendientes_Clientes
// donde una fila = un RENGLÓN de solicitud. Reglas documentadas en
// docs/integration/PROFIT_SQL_MAPPING.md
// ============================================================

export interface NormalizationIssue {
  field: string;
  message: string;
}

export interface Normalized<T> {
  ok: boolean;
  value?: T;
  issues: NormalizationIssue[];
}

// Acepta Date (smalldatetime de mssql), 'yyyy-MM-dd' o 'dd/MM/yyyy';
// devuelve null si no es interpretable.
export function parseProfitDate(input: unknown): Date | null {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input !== 'string' && typeof input !== 'number') {
    return null;
  }
  const raw = String(input).trim();
  if (!raw) {
    return null;
  }
  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

// Cantidad con formato '1,391.00' o '5.00'; acepta negativos (sobre-compromiso).
export function parseProfitDecimal(input: unknown): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input === 'string') {
    const cleaned = input.trim().replace(/,/g, '');
    if (!cleaned) {
      return null;
    }
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

// ---------- SOLICITUDES (vista real aplanada) ----------
// Una fila = un RENGLÓN de solicitud con su pendiente y las existencias
// del artículo en los dos almacenes (Stock_03 / Stock_68).
export interface RawSolicitudLine {
  nroSolicitud: number;
  emision: Date | null;
  entrega: Date | null;
  coCli: string;
  cliDes: string;
  coArt: string;
  artDes: string;
  pendiente: number;
  uniVenta: string;
  // kg por unidad de venta (columna `relacion_empaque`; null si la vista no la trae).
  relacionEmpaque: number | null;
  // kg del renglón (columna `kg`, calculada en Profit como pendiente × relacion_empaque).
  kg: number | null;
  stock03: number | null;
  stock68: number | null;
  // Campos del reporte "Solicitudes con sus renglones PROD y LOGÍSTICA"
  // que la vista actual NO exponía: se leen de una consulta ampliada de la
  // app (solo lectura). Todos anulables: si no llegan, quedan `null`.
  vendedor: string | null;
  // Vendedor asignado al cliente en Profit (clientes.co_ven → vendedor.ven_des).
  vendedorCliente: string | null;
  tipoCliente: string | null;
  // '0' | '1' | '2' de cotiz_c.status ('1' = autorizada).
  statusCotizacion: string | null;
  // Cantidad solicitada original (columna `cantidad` = reng_cac.total_art).
  cantidad: number | null;
  // Almacén que surte el renglón (columna `almacen` = reng_cac.co_alma).
  almacen: string | null;
  // Línea y categoría del artículo (art.co_lin / art.co_cat) y si está anulado.
  linea: string | null;
  categoria: string | null;
  artAnulado: boolean;
}

function trimOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function normalizeSolicitudRow(row: Record<string, unknown>): Normalized<RawSolicitudLine> {
  const issues: NormalizationIssue[] = [];

  const nroSolicitud = parseProfitDecimal(row.nro_solicitud);
  if (nroSolicitud === null) {
    issues.push({ field: 'nro_solicitud', message: 'Número de solicitud ausente o inválido' });
  }

  const pendiente = parseProfitDecimal(row.pendiente);
  if (pendiente === null) {
    issues.push({ field: 'pendiente', message: 'Pendiente ausente o inválido' });
  }

  // Los campos char/varchar de Profit vienen con padding: recortar siempre.
  const coCli = String(row.co_cli ?? '').trim();
  if (!coCli) {
    issues.push({ field: 'co_cli', message: 'Código de cliente ausente' });
  }

  const coArt = String(row.co_art ?? '').trim();
  if (!coArt) {
    issues.push({ field: 'co_art', message: 'Código de artículo ausente' });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    issues: [],
    value: {
      nroSolicitud: Math.trunc(nroSolicitud as number),
      emision: parseProfitDate(row.emision),
      entrega: parseProfitDate(row.entrega),
      coCli,
      cliDes: String(row.cli_des ?? '').trim(),
      coArt,
      artDes: String(row.art_des ?? '').trim(),
      pendiente: pendiente as number,
      uniVenta: String(row.uni_venta ?? '').trim(),
      // Columnas de conversión a KG (agregadas a la vista el 14/10/2026):
      // anulables/informativas → null si no vienen (no se inventa el dato).
      relacionEmpaque: parseProfitDecimal(row.relacion_empaque),
      kg: parseProfitDecimal(row.kg),
      // Columnas anulables: null sólo si vienen null (no se inventa 0).
      stock03: parseProfitDecimal(row.Stock_03 ?? row.stock_03),
      stock68: parseProfitDecimal(row.Stock_68 ?? row.stock_68),
      // Campos del reporte ampliado (opcionales; null si la fuente no los trae).
      vendedor: trimOrNull(row.vendedor),
      vendedorCliente: trimOrNull(row.vendedor_cliente),
      tipoCliente: trimOrNull(row.tipo_cliente),
      statusCotizacion: trimOrNull(row.status_cotizacion),
      cantidad: parseProfitDecimal(row.cantidad),
      almacen: trimOrNull(row.almacen),
      linea: trimOrNull(row.linea),
      categoria: trimOrNull(row.categoria),
      // bit de SQL Server: true/false, 1/0 o 'true'/'false'.
      artAnulado: row.art_anulado === true || row.art_anulado === 1 || row.art_anulado === '1' || row.art_anulado === 'true',
    },
  };
}

// La línea de producción de la empresa es ABA (alimentos balanceados).
export const PRODUCTION_LINE = 'ABA';

// Demanda pendiente total por artículo: suma de `pendiente` sobre todas las
// solicitudes. Es el insumo del motor de disponibilidad (Fase 5): compara la
// demanda total contra la existencia combinada de los almacenes.
export function aggregateDemandByArticle(lines: RawSolicitudLine[]): Map<string, number> {
  const demand = new Map<string, number>();
  for (const line of lines) {
    const prev = demand.get(line.coArt) ?? 0;
    // Se conserva el signo: un pendiente negativo es sobre-compromiso de Profit
    // y reduce la demanda neta agregada del artículo.
    demand.set(line.coArt, prev + line.pendiente);
  }
  return demand;
}
