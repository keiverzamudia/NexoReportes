import { Injectable } from '@nestjs/common';
import { ProfitAdapter, ProfitConnectionTest, ProfitUserRef } from './profit.adapter';

// ============================================================
// Adaptador de fixtures: datos de DESARROLLO/PRUEBA deterministas
// basados en la forma real del reporte "Solicitudes con sus
// renglones" de Profit Plus (Corp. Agropecuaria Venezolana).
// Nunca se usa en producción y queda identificado como fixtures
// en la UI y en /api/health, para no presentar datos ficticios
// como reales.
// ============================================================

const ALMACENES: Record<string, unknown>[] = [
  { almacen: 'Stock 03', nombre: 'Depósito Tránsito 03' },
  { almacen: 'Stock 9999', nombre: 'Traslado entre almacenes 9999' },
  { almacen: 'Stock 68', nombre: 'Almacén Central 68' },
];

// ============================================================
// Vista real: dbo.Solicitudes_Pendientes_Clientes (COR_A3)
// Una fila = un RENGLÓN de solicitud. Columnas reales:
//   nro_solicitud, emision, entrega, co_cli, cli_des,
//   co_art, art_des, pendiente, uni_venta, relacion_empaque, kg,
//   Stock_03, Stock_9999, Stock_68
// `pendiente` = cantidad pendiente por despachar (decimal).
// `relacion_empaque` = kg por unidad de venta (35 = saco de 35 kg).
// `kg` = kg del renglón = pendiente × relacion_empaque (calculado en Profit).
// `Stock_03`/`Stock_9999`/`Stock_68` = existencia del artículo en ese almacén.
// El catálogo de productos/clientes se DERIVA de estas filas.
// ============================================================
const SOLICITUDES: Record<string, unknown>[] = [
  { nro_solicitud: 3536, emision: '2025-09-03', entrega: '2025-09-10', co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', vendedor_cliente: 'MEIDY CRISTINA ARIAS VIDAL', vendedor: 'MEIDY CRISTINA ARIAS VIDAL', tipo_cliente: 'L1 EXCLUSIVOS', status_cotizacion: '1', co_art: 'ABABOV58', art_des: 'MULTIPROPOSITO 14% LINEA NARANJA SACO 35 KG', almacen: '6804', cantidad: 217, pendiente: 217, uni_venta: 'SAC', relacion_empaque: 35, kg: 7595, Stock_03: 273, Stock_9999: 21, Stock_68: 0 },
  { nro_solicitud: 3544, emision: '2025-09-04', entrega: '2025-09-09', co_cli: '505835220', cli_des: 'AGRO INVERSIONES MP, C.A', vendedor_cliente: 'LIZ ANTONELLA PEREZ BAEZ', vendedor: 'LIZ ANTONELLA PEREZ BAEZ', tipo_cliente: 'L2 DISTRIBUIDORES', status_cotizacion: '0', co_art: 'ABABOV58', art_des: 'MULTIPROPOSITO 14% LINEA NARANJA SACO 35 KG', almacen: '6804', cantidad: 12, pendiente: 10, uni_venta: 'SAC', relacion_empaque: 35, kg: 350, Stock_03: 273, Stock_9999: 21, Stock_68: 0 },
  { nro_solicitud: 3536, emision: '2025-09-03', entrega: '2025-09-10', co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', vendedor_cliente: 'MEIDY CRISTINA ARIAS VIDAL', vendedor: 'MEIDY CRISTINA ARIAS VIDAL', tipo_cliente: 'L1 EXCLUSIVOS', status_cotizacion: '1', co_art: 'ABAGP13', art_des: 'GALLINA PONEDORA PLUS 18% - 40 KG', almacen: '6804', cantidad: 6, pendiente: 6, uni_venta: 'SAC', relacion_empaque: 40, kg: 240, Stock_03: 1, Stock_9999: 0, Stock_68: 0 },
  { nro_solicitud: 3550, emision: '2025-09-05', entrega: '2025-09-12', co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', vendedor_cliente: 'MEIDY CRISTINA ARIAS VIDAL', vendedor: 'MEIDY CRISTINA ARIAS VIDAL', tipo_cliente: 'L1 EXCLUSIVOS', status_cotizacion: '0', co_art: 'ABAEQUI01', art_des: 'ALFALFA EN PELLETS L.V SAC (10 KG)', almacen: '03', cantidad: 40, pendiente: 40, uni_venta: 'SAC', relacion_empaque: 10, kg: 400, Stock_03: 5, Stock_9999: 6, Stock_68: 2 },
  // Renglón con pendiente negativo (sobre-compromiso), tal como ocurre en Profit.
  { nro_solicitud: 3561, emision: '2025-09-06', entrega: '2025-09-13', co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', vendedor_cliente: 'MEIDY CRISTINA ARIAS VIDAL', vendedor: 'MEIDY CRISTINA ARIAS VIDAL', tipo_cliente: 'L1 EXCLUSIVOS', status_cotizacion: '0', co_art: 'ABABOV67', art_des: 'MULTIESPECIE LINEA NARANJA SACO 35 KG', almacen: '6804', cantidad: -247, pendiente: -247, uni_venta: 'SAC', relacion_empaque: 35, kg: -8645, Stock_03: 45, Stock_9999: 12, Stock_68: 0 },
  { nro_solicitud: 3572, emision: '2025-09-08', entrega: '2025-09-15', co_cli: '505835220', cli_des: 'AGRO INVERSIONES MP, C.A', vendedor_cliente: 'LIZ ANTONELLA PEREZ BAEZ', vendedor: 'LIZ ANTONELLA PEREZ BAEZ', tipo_cliente: 'L2 DISTRIBUIDORES', status_cotizacion: '1', co_art: 'ABAPOR47', art_des: 'CERDO DESARROLLO MEDICADO PLUS 18,8% -40 KG', almacen: '6804', cantidad: 35, pendiente: 35, uni_venta: 'SAC', relacion_empaque: 40, kg: 1400, Stock_03: 90, Stock_9999: 0, Stock_68: 0 },
  { nro_solicitud: 3580, emision: '2025-09-09', entrega: '2025-09-16', co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', vendedor_cliente: 'MEIDY CRISTINA ARIAS VIDAL', vendedor: 'EURIC MANABI VERGARA MELENDEZ', tipo_cliente: 'L1 EXCLUSIVOS', status_cotizacion: '0', co_art: 'ABABOV75', art_des: 'VACA LECHERA 21% ALTA ENERGIA SACO 35 KG', almacen: '6804', cantidad: 55, pendiente: 50, uni_venta: 'SAC', relacion_empaque: 35, kg: 1750, Stock_03: 120, Stock_9999: 8, Stock_68: 15 },
];

// ============================================================
// Estado de cuenta de desarrollo (equivalente a `dbo.docum_cc`).
// Refleja la forma real: FACT suma y ADEL/N-CR restan; `saldo_us` es el
// saldo pendiente del documento y `monto_us` su monto original. Los días
// vencidos vienen resueltos porque en SQL Server los calcula DATEDIFF.
// ============================================================
const FIXTURE_STATEMENT_AS_OF = '2026-10-22T10:00:00.000Z';
const FIXTURE_BS_RATE = 880;

const DOCUMENTOS_PENDIENTES: Array<{
  co_cli: string;
  cli_des: string;
  tipo_doc: string;
  nro_doc: number;
  fec_emis: string;
  fec_venc: string;
  dias_venc: number;
  monto_us: number;
  saldo_us: number;
  signo: number;
}> = [
  { co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', tipo_doc: 'FACT', nro_doc: 50001001, fec_emis: '2026-09-28T00:00:00.000Z', fec_venc: '2026-10-05T00:00:00.000Z', dias_venc: 17, monto_us: 7750, saldo_us: 175.71, signo: 1 },
  { co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', tipo_doc: 'ADEL', nro_doc: 55532, fec_emis: '2026-10-08T00:00:00.000Z', fec_venc: '2026-10-08T00:00:00.000Z', dias_venc: 14, monto_us: 20841.79, saldo_us: 0, signo: -1 },
  { co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', tipo_doc: 'FACT', nro_doc: 50001002, fec_emis: '2026-10-13T00:00:00.000Z', fec_venc: '2026-10-20T00:00:00.000Z', dias_venc: 2, monto_us: 13500, saldo_us: 13500, signo: 1 },
  { co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', tipo_doc: 'FACT', nro_doc: 50001003, fec_emis: '2026-10-20T00:00:00.000Z', fec_venc: '2026-10-20T00:00:00.000Z', dias_venc: 2, monto_us: 7750, saldo_us: 7517.5, signo: 1 },
  { co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', tipo_doc: 'ADEL', nro_doc: 56220, fec_emis: '2026-10-20T00:00:00.000Z', fec_venc: '2026-10-20T00:00:00.000Z', dias_venc: 2, monto_us: 21017.5, saldo_us: 21017.5, signo: -1 },
  { co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', tipo_doc: 'ADEL', nro_doc: 56221, fec_emis: '2026-10-20T00:00:00.000Z', fec_venc: '2026-10-20T00:00:00.000Z', dias_venc: 2, monto_us: 175.71, saldo_us: 175.71, signo: -1 },
  { co_cli: '505835220', cli_des: 'AGRO INVERSIONES MP, C.A', tipo_doc: 'FACT', nro_doc: 50002001, fec_emis: '2026-10-10T00:00:00.000Z', fec_venc: '2026-10-18T00:00:00.000Z', dias_venc: 4, monto_us: 9600, saldo_us: 9600, signo: 1 },
  { co_cli: '505835220', cli_des: 'AGRO INVERSIONES MP, C.A', tipo_doc: 'ADEL', nro_doc: 57001, fec_emis: '2026-10-15T00:00:00.000Z', fec_venc: '2026-10-15T00:00:00.000Z', dias_venc: 7, monto_us: 3000, saldo_us: 3000, signo: -1 },
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function statementRows(params: Record<string, unknown> = {}, limit = 1000): Record<string, unknown>[] {
  const code = String(params.co_cli ?? '').trim().toUpperCase();
  const includeSettled = Number(params.incluir_saldados ?? 0) === 1;
  const currency = String(params.moneda ?? 'USD').toUpperCase() === 'BS' ? 'BS' : 'USD';
  return DOCUMENTOS_PENDIENTES.filter(
    (row) => row.co_cli.toUpperCase() === code && (includeSettled || row.saldo_us > 0),
  )
    .sort((a, b) => b.fec_emis.localeCompare(a.fec_emis) || b.tipo_doc.localeCompare(a.tipo_doc) || b.nro_doc - a.nro_doc)
    .slice(0, limit)
    .map((row) => {
      const factor = currency === 'BS' ? FIXTURE_BS_RATE : 1;
      return {
        co_cli: row.co_cli,
        cli_des: row.cli_des,
        tipo_doc: row.tipo_doc,
        nro_doc: row.nro_doc,
        fec_emis: row.fec_emis,
        fec_venc: row.fec_venc,
        dias_venc: row.dias_venc,
        monto: round2(row.monto_us * factor),
        saldo: round2(row.saldo_us * factor),
        signo: row.signo,
        as_of: FIXTURE_STATEMENT_AS_OF,
      };
    });
}

// Forecast mensual de desarrollo (equivalente a `dbo.xart_fore.kg_mes`).
// Solo incluye códigos presentes en el dataset anterior para que la pantalla
// muestre valores en modo fixtures.
const FORECAST: Record<string, unknown>[] = [
  { co_art: 'ABABOV58', forecast_mes: 1800 },
  { co_art: 'ABAGP13', forecast_mes: 7500 },
  { co_art: 'ABAEQUI01', forecast_mes: 900 },
  { co_art: 'ABABOV67', forecast_mes: 5714 },
  { co_art: 'ABAPOR47', forecast_mes: 2275 },
  { co_art: 'ABABOV75', forecast_mes: 171 },
];

function datasetFor(viewName: string): Record<string, unknown>[] {
  const lower = viewName.toLowerCase();
  if (lower.includes('solicitud') || lower.includes('pendiente')) return SOLICITUDES;
  return [];
}

// Usuarios de desarrollo: mismo papel que `MasterProfit.dbo.VUSUARIOS`.
// La contraseña de todos es `nexo` (modo fixtures, nunca producción).
const FIXTURE_PASSWORD = 'nexo';

const FIXTURE_USERS: ProfitUserRef[] = [
  { code: 'KZAMU', name: 'KEIBER ZAMUDIA' },
  { code: 'ARIV', name: 'ADDISON RIVERO' },
  { code: 'AALV', name: 'ADELIS ALVAREZ' },
  { code: 'ABON', name: 'ADELSON BONILLA' },
  { code: 'TANRIV', name: 'TANIA RIVERO' },
];

// Columnas reales de la vista (para /sync/describe cuando corre con fixtures).
const SOLICITUDES_COLUMNS = [
  { name: 'nro_solicitud', dataType: 'int', maxLength: null, precision: 10, scale: 0, nullable: false },
  { name: 'emision', dataType: 'smalldatetime', maxLength: null, precision: null, scale: null, nullable: false },
  { name: 'entrega', dataType: 'smalldatetime', maxLength: null, precision: null, scale: null, nullable: false },
  { name: 'co_cli', dataType: 'char', maxLength: 10, precision: null, scale: null, nullable: false },
  { name: 'cli_des', dataType: 'varchar', maxLength: 100, precision: null, scale: null, nullable: false },
  { name: 'co_art', dataType: 'char', maxLength: 30, precision: null, scale: null, nullable: false },
  { name: 'art_des', dataType: 'varchar', maxLength: 120, precision: null, scale: null, nullable: false },
  { name: 'pendiente', dataType: 'decimal', maxLength: null, precision: 18, scale: 5, nullable: false },
  { name: 'uni_venta', dataType: 'char', maxLength: 6, precision: null, scale: null, nullable: false },
  { name: 'relacion_empaque', dataType: 'decimal', maxLength: null, precision: 18, scale: 5, nullable: false },
  { name: 'kg', dataType: 'decimal', maxLength: null, precision: 18, scale: 5, nullable: false },
  { name: 'Stock_03', dataType: 'decimal', maxLength: null, precision: 38, scale: 5, nullable: true },
  { name: 'Stock_9999', dataType: 'decimal', maxLength: null, precision: 38, scale: 5, nullable: true },
  { name: 'Stock_68', dataType: 'decimal', maxLength: null, precision: 38, scale: 5, nullable: true },
  { name: 'vendedor', dataType: 'varchar', maxLength: 100, precision: null, scale: null, nullable: true },
  { name: 'tipo_cliente', dataType: 'varchar', maxLength: 60, precision: null, scale: null, nullable: true },
  { name: 'status_cotizacion', dataType: 'char', maxLength: 1, precision: null, scale: null, nullable: true },
  { name: 'cantidad', dataType: 'decimal', maxLength: null, precision: 18, scale: 5, nullable: true },
  { name: 'almacen', dataType: 'char', maxLength: 6, precision: null, scale: null, nullable: true },
];

@Injectable()
export class FixturesProfitAdapter implements ProfitAdapter {
  readonly dialect = 'fixtures' as const;

  async testConnection(): Promise<ProfitConnectionTest> {
    return { connected: true, message: 'Modo fixtures: sin conexión real a Profit' };
  }

  async listViews(): Promise<string[]> {
    return ['fixtures.Solicitudes_Pendientes_Clientes'];
  }

  async describeView(_viewName: string) {
    return SOLICITUDES_COLUMNS;
  }

  async select(viewName: string, _params: Record<string, unknown>, limit: number): Promise<Record<string, unknown>[]> {
    return datasetFor(viewName).slice(0, limit);
  }

  // En fixtures la consulta ampliada devuelve el mismo dataset determinista,
  // salvo las consultas con fuente propia: forecast (`xart_fore`) y estado de
  // cuenta (`docum_cc` / `Documentos_Pendientes`).
  async selectQuery(
    sqlText: string,
    limit: number,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>[]> {
    const lower = sqlText.toLowerCase();
    if (lower.includes('xart_fore')) return FORECAST.slice(0, limit);
    if (lower.includes('docum_cc') || lower.includes('documentos_pendientes')) {
      return statementRows(params, limit);
    }
    return SOLICITUDES.slice(0, limit);
  }

  // Usuarios de desarrollo (equivalentes a `VUSUARIOS`). La contraseña de
  // fixtures es siempre `nexo`: nunca se usa en producción y queda claro que
  // no hay contraseñas reales en este modo.
  async authenticateUser(profitCode: string, password: string): Promise<string | null> {
    const code = profitCode.trim().toUpperCase();
    if (password !== FIXTURE_PASSWORD) return null;
    return FIXTURE_USERS.some((user) => user.code === code) ? code : null;
  }

  async listUsers(): Promise<ProfitUserRef[]> {
    return FIXTURE_USERS;
  }
}
