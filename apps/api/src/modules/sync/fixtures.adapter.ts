import { Injectable } from '@nestjs/common';
import { ProfitAdapter, ProfitConnectionTest } from './profit.adapter';

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
  { almacen: 'Stock 68', nombre: 'Almacén Central 68' },
];

// ============================================================
// Vista real: dbo.Solicitudes_Pendientes_Clientes (COR_A3)
// Una fila = un RENGLÓN de solicitud. Columnas reales:
//   nro_solicitud, emision, entrega, co_cli, cli_des,
//   co_art, art_des, pendiente, uni_venta, Stock_03, Stock_68
// `pendiente` = cantidad pendiente por despachar (decimal).
// `Stock_03`/`Stock_68` = existencia del artículo en ese almacén.
// El catálogo de productos/clientes se DERIVA de estas filas.
// ============================================================
const SOLICITUDES: Record<string, unknown>[] = [
  { nro_solicitud: 3536, emision: '2025-09-03', entrega: '2025-09-10', co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', co_art: 'ABABOV58', art_des: 'MULTIPROPOSITO 14% LINEA NARANJA SACO 35 KG', pendiente: 217, uni_venta: 'SAC', Stock_03: 273, Stock_68: 0 },
  { nro_solicitud: 3544, emision: '2025-09-04', entrega: '2025-09-09', co_cli: '505835220', cli_des: 'AGRO INVERSIONES MP, C.A', co_art: 'ABABOV58', art_des: 'MULTIPROPOSITO 14% LINEA NARANJA SACO 35 KG', pendiente: 10, uni_venta: 'SAC', Stock_03: 273, Stock_68: 0 },
  { nro_solicitud: 3536, emision: '2025-09-03', entrega: '2025-09-10', co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', co_art: 'ABAGP13', art_des: 'GALLINA PONEDORA PLUS 18% - 40 KG', pendiente: 6, uni_venta: 'SAC', Stock_03: 1, Stock_68: 0 },
  { nro_solicitud: 3550, emision: '2025-09-05', entrega: '2025-09-12', co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', co_art: 'ABAEQUI01', art_des: 'ALFALFA EN PELLETS L.V SAC (10 KG)', pendiente: 40, uni_venta: 'SAC', Stock_03: 5, Stock_68: 2 },
  // Renglón con pendiente negativo (sobre-compromiso), tal como ocurre en Profit.
  { nro_solicitud: 3561, emision: '2025-09-06', entrega: '2025-09-13', co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', co_art: 'ABABOV67', art_des: 'MULTIESPECIE LINEA NARANJA SACO 35 KG', pendiente: -247, uni_venta: 'SAC', Stock_03: 45, Stock_68: 0 },
  { nro_solicitud: 3572, emision: '2025-09-08', entrega: '2025-09-15', co_cli: '505835220', cli_des: 'AGRO INVERSIONES MP, C.A', co_art: 'ABAPOR47', art_des: 'CERDO DESARROLLO MEDICADO PLUS 18,8% -40 KG', pendiente: 35, uni_venta: 'SAC', Stock_03: 90, Stock_68: 0 },
  { nro_solicitud: 3580, emision: '2025-09-09', entrega: '2025-09-16', co_cli: '153064128', cli_des: 'JOSEF HENDRIX HERNANDEZ REYES', co_art: 'ABABOV75', art_des: 'VACA LECHERA 21% ALTA ENERGIA SACO 35 KG', pendiente: 50, uni_venta: 'SAC', Stock_03: 120, Stock_68: 15 },
];

function datasetFor(viewName: string): Record<string, unknown>[] {
  const lower = viewName.toLowerCase();
  if (lower.includes('solicitud') || lower.includes('pendiente')) return SOLICITUDES;
  return [];
}

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
  { name: 'Stock_03', dataType: 'decimal', maxLength: null, precision: 38, scale: 5, nullable: true },
  { name: 'Stock_68', dataType: 'decimal', maxLength: null, precision: 38, scale: 5, nullable: true },
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
}
