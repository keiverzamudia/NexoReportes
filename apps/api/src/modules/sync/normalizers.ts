// ============================================================
// Normalizadores puros: fila cruda de Profit → forma canónica.
// Sin acceso a BD ni a HTTP: unit-testeables aisladamente.
// Reglas documentadas en docs/integration/PROFIT_SQL_MAPPING.md
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

// Acepta 'dd/MM/yyyy', 'yyyy-MM-dd' y Date; devuelve null si no es interpretable.
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

function requireString(row: Record<string, unknown>, keys: string[], field: string, issues: NormalizationIssue[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  issues.push({ field, message: `Campo requerido ausente (probadas: ${keys.join(', ')})` });
  return '';
}

// ---------- PRODUCTOS ----------
export interface RawProduct {
  codigo: string;
  descripcion: string;
  unidad: string;
  familia: string | null;
}

export function normalizeProductRow(row: Record<string, unknown>): Normalized<RawProduct> {
  const issues: NormalizationIssue[] = [];
  const codigo = requireString(row, ['codigo', 'codigo_producto', 'cod', 'producto'], 'codigo', issues);
  const descripcion = requireString(row, ['descripcion', 'description', 'nombre'], 'descripcion', issues);
  const unidad = requireString(row, ['unidad', 'um', 'uom', 'unid'], 'unidad', issues) || 'SAC';
  const familiaRaw = row['familia'] ?? row['categoria'] ?? null;
  const familia = typeof familiaRaw === 'string' && familiaRaw.trim() ? familiaRaw.trim() : null;
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: { codigo, descripcion, unidad, familia }, issues };
}

// ---------- CLIENTES ----------
export interface RawCustomer {
  codigo: string;
  nombre: string;
  tipoCliente: string | null;
  vendedor: string | null;
}

export function normalizeCustomerRow(row: Record<string, unknown>): Normalized<RawCustomer> {
  const issues: NormalizationIssue[] = [];
  const codigo = requireString(row, ['cliente_codigo', 'codigo', 'codigo_cliente'], 'cliente_codigo', issues);
  const nombre = requireString(row, ['cliente_nombre', 'nombre', 'cliente'], 'cliente_nombre', issues);
  const tipoRaw = row['tipo_cliente'] ?? row['tipoCliente'] ?? null;
  const vendedorRaw = row['vendedor'] ?? null;
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      codigo,
      nombre,
      tipoCliente: typeof tipoRaw === 'string' && tipoRaw.trim() ? tipoRaw.trim() : null,
      vendedor: typeof vendedorRaw === 'string' && vendedorRaw.trim() ? vendedorRaw.trim() : null,
    },
    issues,
  };
}

// ---------- ALMACENES ----------
export interface RawWarehouse {
  codigo: string;
  nombre: string;
}

export function normalizeWarehouseRow(row: Record<string, unknown>): Normalized<RawWarehouse> {
  const issues: NormalizationIssue[] = [];
  const codigo = requireString(row, ['almacen', 'codigo', 'codigo_almacen', 'alm'], 'almacen', issues);
  const nombreRaw = row['nombre'] ?? row['descripcion'] ?? null;
  const nombre = typeof nombreRaw === 'string' && nombreRaw.trim() ? nombreRaw.trim() : codigo;
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: { codigo, nombre }, issues };
}

// ---------- PEDIDOS (encabezado) ----------
export interface RawOrder {
  numero: string;
  clienteCodigo: string | null;
  clienteNombre: string | null;
  tipoCliente: string | null;
  vendedor: string | null;
  fechaEmision: Date | null;
  fechaEntrega: Date | null;
  status: 'ABIERTO' | 'CERRADO' | 'CANCELADO' | 'DESCONOCIDO';
  statusRaw: string | null;
  autorizado: boolean | null;
}

// Supuesto documentado: Profit no expone aún un enum de estado conocido.
// Cualquier valor sin mapear se conserva en statusRaw y se clasifica como DESCONOCIDO
// salvo que contenga palabras clave de cierre/cancelación.
export function mapOrderStatus(raw: unknown): RawOrder['status'] {
  if (typeof raw !== 'string' || !raw.trim()) {
    return 'ABIERTO';
  }
  const upper = raw.toUpperCase();
  if (upper.includes('ANUL') || upper.includes('CANCEL')) {
    return 'CANCELADO';
  }
  if (upper.includes('CERRAD') || upper.includes('FACTURAD') || upper.includes('DESPACHAD')) {
    return 'CERRADO';
  }
  if (upper.includes('ABIERT') || upper.includes('EMITID') || upper.includes('APROB') || upper.includes('PEND')) {
    return 'ABIERTO';
  }
  return 'DESCONOCIDO';
}

export function normalizeOrderRow(row: Record<string, unknown>): Normalized<RawOrder> {
  const issues: NormalizationIssue[] = [];
  const numero = requireString(row, ['numero', 'numero_pedido', 'pedido', 'numero_documento'], 'numero', issues);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const clienteCodigoRaw = row['cliente_codigo'] ?? row['codigo_cliente'] ?? null;
  const clienteNombreRaw = row['cliente_nombre'] ?? row['cliente'] ?? null;
  const tipoRaw = row['tipo_cliente'] ?? null;
  const vendedorRaw = row['vendedor'] ?? null;
  const statusRaw = row['estado'] ?? row['status'] ?? null;
  const autorizadoRaw = row['autorizado'] ?? null;

  return {
    ok: true,
    value: {
      numero,
      clienteCodigo: clienteCodigoRaw ? String(clienteCodigoRaw).trim() : null,
      clienteNombre: typeof clienteNombreRaw === 'string' && clienteNombreRaw.trim() ? clienteNombreRaw.trim() : null,
      tipoCliente: typeof tipoRaw === 'string' && tipoRaw.trim() ? tipoRaw.trim() : null,
      vendedor: typeof vendedorRaw === 'string' && vendedorRaw.trim() ? vendedorRaw.trim() : null,
      fechaEmision: parseProfitDate(row['fecha_emision'] ?? row['emision'] ?? null),
      fechaEntrega: parseProfitDate(row['fecha_entrega'] ?? row['entrega'] ?? null),
      status: mapOrderStatus(statusRaw),
      statusRaw: typeof statusRaw === 'string' ? statusRaw : null,
      autorizado:
        typeof autorizadoRaw === 'string' ? autorizadoRaw.trim().toUpperCase() === 'SÍ' || autorizadoRaw.trim().toUpperCase() === 'SI' || autorizadoRaw.trim().toUpperCase() === 'S' : typeof autorizadoRaw === 'boolean' ? autorizadoRaw : null,
    },
    issues: [],
  };
}

// ---------- LÍNEAS DE PEDIDO ----------
export interface RawOrderLine {
  numero: string;
  lineNumber: number;
  codigoProducto: string;
  descripcion: string | null;
  unidad: string | null;
  cantidad: number;
  pendiente: number;
  almacenes: string | null;
}

export function normalizeOrderLineRow(row: Record<string, unknown>): Normalized<RawOrderLine> {
  const issues: NormalizationIssue[] = [];
  const numero = requireString(row, ['numero', 'numero_pedido', 'pedido'], 'numero', issues);
  const codigoProducto = requireString(row, ['codigo_producto', 'producto', 'codigo', 'cod'], 'codigo_producto', issues);
  const cantidad = parseProfitDecimal(row['cantidad'] ?? row['quantity'] ?? null);
  if (cantidad === null || cantidad < 0) {
    issues.push({ field: 'cantidad', message: 'Cantidad inválida o negativa' });
  }
  if (issues.length > 0 || cantidad === null) {
    return { ok: false, issues };
  }
  const pendienteRaw = parseProfitDecimal(row['pendiente'] ?? row['cantidad_pendiente'] ?? null);
  const lineRaw = row['linea'] ?? row['lineNumber'] ?? row['renglon'] ?? null;
  const almacenesRaw = row['almacenes'] ?? row['almacen'] ?? null;
  const descripcionRaw = row['descripcion'] ?? null;
  const unidadRaw = row['unidad'] ?? row['um'] ?? row['unid'] ?? null;

  return {
    ok: true,
    value: {
      numero,
      lineNumber: typeof lineRaw === 'number' && Number.isFinite(lineRaw) ? lineRaw : 1,
      codigoProducto,
      descripcion: typeof descripcionRaw === 'string' && descripcionRaw.trim() ? descripcionRaw.trim() : null,
      unidad: typeof unidadRaw === 'string' && unidadRaw.trim() ? unidadRaw.trim() : null,
      cantidad,
      // El pendiente puede ser negativo (sobre-compromiso en Profit): conservar signo.
      pendiente: pendienteRaw ?? cantidad,
      almacenes: typeof almacenesRaw === 'string' && almacenesRaw.trim() ? almacenesRaw.trim() : null,
    },
    issues: [],
  };
}

// ---------- EXISTENCIAS ----------
export interface RawInventory {
  codigoProducto: string;
  almacen: string;
  cantidad: number;
  reservada: number;
}

export function normalizeInventoryRow(row: Record<string, unknown>): Normalized<RawInventory> {
  const issues: NormalizationIssue[] = [];
  const codigoProducto = requireString(row, ['codigo_producto', 'producto', 'codigo', 'cod'], 'codigo_producto', issues);
  const almacen = requireString(row, ['almacen', 'alm', 'almacen_codigo'], 'almacen', issues);
  const cantidad = parseProfitDecimal(row['cantidad'] ?? row['existencia'] ?? row['qty'] ?? null);
  if (cantidad === null) {
    issues.push({ field: 'cantidad', message: 'Existencia ausente o inválida' });
  }
  const reservadaRaw = parseProfitDecimal(row['reservada'] ?? row['reservado'] ?? row['reservada_qty'] ?? null);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      codigoProducto,
      almacen,
      cantidad: cantidad as number,
      // Las reservas no confiables se tratan como 0 (documentado en INVENTORY_RULES).
      reservada: reservadaRaw !== null && reservadaRaw >= 0 ? reservadaRaw : 0,
    },
    issues: [],
  };
}
