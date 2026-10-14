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
  stock03: number | null;
  stock68: number | null;
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
      // Columnas anulables: null sólo si vienen null (no se inventa 0).
      stock03: parseProfitDecimal(row.Stock_03 ?? row.stock_03),
      stock68: parseProfitDecimal(row.Stock_68 ?? row.stock_68),
    },
  };
}

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
