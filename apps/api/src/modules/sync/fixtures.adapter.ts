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
  { almacen: 'Stock 68', nombre: 'Almacén Central 68' },
  { almacen: 'Stock 03', nombre: 'Depósito Tránsito 03' },
];

const PRODUCTOS: Record<string, unknown>[] = [
  { codigo: 'ABAEQUI01', descripcion: 'ALFALFA EN PELLETS L.V SAC (10 KG)', unidad: 'SAC', familia: 'Forrajes' },
  { codigo: 'ABABOV58', descripcion: 'MULTIPROPOSITO 14% LINEA NARANJA SACO 35 KG', unidad: 'SAC', familia: 'Bovinos' },
  { codigo: 'ABABOV75', descripcion: 'VACA LECHERA 21% ALTA ENERGIA SACO 35 KG', unidad: 'SAC', familia: 'Bovinos' },
  { codigo: 'ABAGP13', descripcion: 'GALLINA PONEDORA PLUS 18% - 40 KG', unidad: 'SAC', familia: 'Avicultura' },
  { codigo: 'ABAPOR47', descripcion: 'CERDO DESARROLLO MEDICADO PLUS 18,8% -40 KG', unidad: 'SAC', familia: 'Porcinos' },
  { codigo: 'ABABOV67', descripcion: 'MULTIESPECIE LINEA NARANJA SACO 35 KG', unidad: 'SAC', familia: 'Multiespecie' },
];

const CLIENTES: Record<string, unknown>[] = [
  { cliente_codigo: '183334693025', cliente_nombre: 'JESUS ENRIQUE ALVAREZ PEREZ', tipo_cliente: 'COR CORPORATIVO', vendedor: 'MEIDY CRISTINA ARIAS VIDAL' },
  { cliente_codigo: 'B40634662012', cliente_nombre: 'INVERSIONES NADER, C.A.', tipo_cliente: 'L1  EXCLUSIVOS', vendedor: 'LIZ ANTONELLA PEREZ BAEZ' },
  { cliente_codigo: '307314354025', cliente_nombre: 'DISTRIBUIDORA AGROBAY, C.A', tipo_cliente: 'L2  DISTRIBUIDORES', vendedor: 'MEIDY CRISTINA ARIAS VIDAL' },
  { cliente_codigo: '406821691025', cliente_nombre: 'INVERSIONES APALOOSA A&G, C.A', tipo_cliente: 'L1  EXCLUSIVOS', vendedor: 'MEIDY CRISTINA ARIAS VIDAL' },
  { cliente_codigo: '501635072027', cliente_nombre: 'AGROPECUARIA CAMPO DEL NORTE', tipo_cliente: 'L2  DISTRIBUIDORES', vendedor: 'EURIC MANABI VERGARA' },
  { cliente_codigo: '403347751025', cliente_nombre: 'AGROPECUARIA EL VARGUERO C.A', tipo_cliente: 'L3  MINORISTA', vendedor: 'MEIDY CRISTINA ARIAS VIDAL' },
];

const PEDIDOS: Record<string, unknown>[] = [
  { numero: '6743', cliente_codigo: '406821691025', cliente_nombre: 'INVERSIONES APALOOSA A&G, C.A', tipo_cliente: 'L1  EXCLUSIVOS', vendedor: 'MEIDY CRISTINA ARIAS VIDAL', fecha_emision: '13/10/2026', fecha_entrega: '16/10/2026', autorizado: 'NO' },
  { numero: '6752', cliente_codigo: '501635072027', cliente_nombre: 'AGROPECUARIA CAMPO DEL NORTE', tipo_cliente: 'L2  DISTRIBUIDORES', vendedor: 'EURIC MANABI VERGARA', fecha_emision: '13/10/2026', fecha_entrega: '16/10/2026', autorizado: 'NO' },
  // Pedido vencido (entrega 04/08/2026) para probar estados de riesgo.
  { numero: '6191', cliente_codigo: '183334693025', cliente_nombre: 'JESUS ENRIQUE ALVAREZ PEREZ', tipo_cliente: 'COR CORPORATIVO', vendedor: 'MEIDY CRISTINA ARIAS VIDAL', fecha_emision: '30/07/2026', fecha_entrega: '04/08/2026', autorizado: 'NO' },
  { numero: '6303', cliente_codigo: '307314354025', cliente_nombre: 'DISTRIBUIDORA AGROBAY, C.A', tipo_cliente: 'L2  DISTRIBUIDORES', vendedor: 'MEIDY CRISTINA ARIAS VIDAL', fecha_emision: '13/08/2026', fecha_entrega: '18/08/2026', autorizado: 'NO' },
];

// Líneas copiadas de la estructura del reporte real, incluido el
// pendiente negativo (sobre-compromiso) del pedido 6743.
const PEDIDOS_DETALLE: Record<string, unknown>[] = [
  { numero: '6743', linea: 1, codigo_producto: 'ABABOV75', descripcion: 'VACA LECHERA 21% ALTA ENERGIA SACO 35 KG', unidad: 'SAC', cantidad: 30, pendiente: 29, almacenes: 'Stock 68 / Stock 03' },
  { numero: '6743', linea: 2, codigo_producto: 'ABAGP13', descripcion: 'GALLINA PONEDORA PLUS 18% - 40 KG', unidad: 'SAC', cantidad: 30, pendiente: 40, almacenes: 'Stock 68 / Stock 03' },
  { numero: '6743', linea: 3, codigo_producto: 'ABAPOR47', descripcion: 'CERDO DESARROLLO MEDICADO PLUS 18,8% -40 KG', unidad: 'SAC', cantidad: 100, pendiente: 35, almacenes: 'Stock 68 / Stock 03' },
  { numero: '6743', linea: 4, codigo_producto: 'ABABOV67', descripcion: 'MULTIESPECIE LINEA NARANJA SACO 35 KG', unidad: 'SAC', cantidad: 50, pendiente: -247, almacenes: 'Stock 68 / Stock 03' },
  { numero: '6752', linea: 1, codigo_producto: 'ABAPOR47', descripcion: 'CERDO DESARROLLO MEDICADO PLUS 18,8% -40 KG', unidad: 'SAC', cantidad: 100, pendiente: -10, almacenes: 'Stock 68 / Stock 03' },
  { numero: '6752', linea: 2, codigo_producto: 'ABABOV75', descripcion: 'VACA LECHERA 21% ALTA ENERGIA SACO 35 KG', unidad: 'SAC', cantidad: 25, pendiente: 0, almacenes: 'Stock 68 / Stock 03' },
  { numero: '6191', linea: 1, codigo_producto: 'ABAEQUI01', descripcion: 'ALFALFA EN PELLETS L.V SAC (10 KG)', unidad: 'SAC', cantidad: 5, pendiente: 5, almacenes: 'Stock 68 / Stock 03' },
  { numero: '6303', linea: 1, codigo_producto: 'ABAEQUI01', descripcion: 'ALFALFA EN PELLETS L.V SAC (10 KG)', unidad: 'SAC', cantidad: 40, pendiente: 40, almacenes: 'Stock 68 / Stock 03' },
];

const EXISTENCIAS: Record<string, unknown>[] = [
  { codigo_producto: 'ABAEQUI01', almacen: 'Stock 68', cantidad: 6, reservada: 6 },
  { codigo_producto: 'ABAEQUI01', almacen: 'Stock 03', cantidad: 2, reservada: 2 },
  { codigo_producto: 'ABABOV75', almacen: 'Stock 68', cantidad: 120, reservada: 55 },
  { codigo_producto: 'ABABOV75', almacen: 'Stock 03', cantidad: 15, reservada: 0 },
  { codigo_producto: 'ABAGP13', almacen: 'Stock 68', cantidad: 80, reservada: 70 },
  { codigo_producto: 'ABAPOR47', almacen: 'Stock 68', cantidad: 90, reservada: 135 },
  { codigo_producto: 'ABABOV67', almacen: 'Stock 68', cantidad: 45, reservada: 296 },
  { codigo_producto: 'ABABOV58', almacen: 'Stock 03', cantidad: 200, reservada: 0 },
];

function datasetFor(viewName: string): Record<string, unknown>[] {
  const lower = viewName.toLowerCase();
  if (lower.includes('producto')) return PRODUCTOS;
  if (lower.includes('cliente')) return CLIENTES;
  if (lower.includes('detalle') || lower.includes('renglon') || lower.includes('linea')) return PEDIDOS_DETALLE;
  if (lower.includes('pedido') || lower.includes('solicitud')) return PEDIDOS;
  if (lower.includes('existenc') || lower.includes('inventar')) return EXISTENCIAS;
  if (lower.includes('almacen')) return ALMACENES;
  return [];
}

@Injectable()
export class FixturesProfitAdapter implements ProfitAdapter {
  readonly dialect = 'fixtures' as const;

  async testConnection(): Promise<ProfitConnectionTest> {
    return { connected: true, message: 'Modo fixtures: sin conexión real a Profit' };
  }

  async listViews(): Promise<string[]> {
    return [
      'fixtures.vw_productos',
      'fixtures.vw_clientes',
      'fixtures.vw_pedidos',
      'fixtures.vw_pedidos_detalle',
      'fixtures.vw_existencias',
      'fixtures.vw_almacenes',
    ];
  }

  async select(viewName: string, _params: Record<string, unknown>, limit: number): Promise<Record<string, unknown>[]> {
    return datasetFor(viewName).slice(0, limit);
  }
}
