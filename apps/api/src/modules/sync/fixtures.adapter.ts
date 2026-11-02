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

// Límite de crédito de desarrollo (`dbo.clientes.mont_cre`).
const LIMITES_CREDITO: Record<string, number> = {
  '153064128': 25000,
  '505835220': 12000,
};

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
        limite_credito: LIMITES_CREDITO[row.co_cli] ?? null,
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

// Equivalente al agregado por cliente de la cartera de Pedidos. Devuelve una
// fila por código solicitado, aunque no tenga documentos (LEFT JOIN).
function statementSummaries(params: Record<string, unknown> = {}, limit = 1000): Record<string, unknown>[] {
  const codes = Object.keys(params)
    .filter((key) => key.startsWith('co_cli_'))
    .map((key) => String(params[key] ?? '').trim().toUpperCase())
    .filter(Boolean);
  const currency = String(params.moneda ?? 'USD').toUpperCase() === 'BS' ? 'BS' : 'USD';
  const factor = currency === 'BS' ? FIXTURE_BS_RATE : 1;

  return [...new Set(codes)].slice(0, limit).map((code) => {
    const docs = DOCUMENTOS_PENDIENTES.filter((row) => row.co_cli.toUpperCase() === code && row.saldo_us > 0);
    const saldo = docs.reduce((acc, row) => acc + row.saldo_us * factor * row.signo, 0);
    const vencidos = docs.filter((row) => row.signo > 0 && row.dias_venc > 0);
    const credito = docs.filter((row) => row.signo < 0).reduce((acc, row) => acc + row.saldo_us * factor, 0);
    return {
      co_cli: code,
      cli_des: docs[0]?.cli_des ?? code,
      limite_credito: LIMITES_CREDITO[code] ?? null,
      saldo: round2(saldo),
      saldo_vencido: round2(vencidos.reduce((acc, row) => acc + row.saldo_us * factor, 0)),
      credito: round2(credito),
      documentos: docs.length,
      vencidos: vencidos.length,
      as_of: FIXTURE_STATEMENT_AS_OF,
    };
  });
}

// Forecast mensual de desarrollo (equivalente a `dbo.xart_fore.kg_mes`).
// `kg_mes` es KILOGRAMOS, no unidades de venta: los valores se eligen para
// que la pestaña «Ventas vs Forecast» tenga metas realistas (~1,5 M kg/mes).
const FORECAST: Record<string, unknown>[] = [
  { co_art: 'ABABOV58', forecast_mes: 160_000 },
  { co_art: 'ABAGP13', forecast_mes: 360_000 },
  { co_art: 'ABAEQUI01', forecast_mes: 100_000 },
  { co_art: 'ABABOV67', forecast_mes: 340_000 },
  { co_art: 'ABAPOR47', forecast_mes: 155_000 },
  { co_art: 'ABABOV75', forecast_mes: 85_000 },
];

// ============================================================
// Ventas de desarrollo (equivalente a `dbo.not_ent` + `dbo.reng_nde`).
//
// Se generan de forma DETERMINISTA a partir de la fecha de arranque: los
// últimos 18 meses, de lunes a sábado, con una onda fija por día y artículo.
// Así la pestaña «Ventas vs Forecast» se puede probar sin Profit y sin que
// las cifras cambien entre renders.
// ============================================================
interface FixtureSaleProduct {
  co_art: string;
  art_des: string;
  uni_venta: string;
  uni_relac: number;
  /** Sacos/día de referencia (en día hábil normal). */
  baseSacks: number;
}

const SALES_PRODUCTS: FixtureSaleProduct[] = [
  { co_art: 'ABABOV58', art_des: 'MULTIPROPOSITO 14% LINEA NARANJA SACO 35 KG', uni_venta: 'SAC', uni_relac: 35, baseSacks: 250 },
  { co_art: 'ABAGP13', art_des: 'GALLINA PONEDORA PLUS 18% - 40 KG', uni_venta: 'SAC', uni_relac: 40, baseSacks: 300 },
  { co_art: 'ABAEQUI01', art_des: 'ALFALFA EN PELLETS L.V SAC (10 KG)', uni_venta: 'SAC', uni_relac: 10, baseSacks: 500 },
  { co_art: 'ABABOV67', art_des: 'MULTIESPECIE LINEA NARANJA SACO 35 KG', uni_venta: 'SAC', uni_relac: 35, baseSacks: 500 },
  { co_art: 'ABAPOR47', art_des: 'CERDO DESARROLLO MEDICADO PLUS 18,8% -40 KG', uni_venta: 'SAC', uni_relac: 40, baseSacks: 200 },
  { co_art: 'ABABOV75', art_des: 'VACA LECHERA 21% ALTA ENERGIA SACO 35 KG', uni_venta: 'SAC', uni_relac: 35, baseSacks: 150 },
];

function isoUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function buildDailySales(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const start = Date.UTC(now.getFullYear(), now.getMonth() - 17, 1);

  for (let time = start; time < todayUtc; time += 86_400_000) {
    const date = new Date(time);
    const weekday = date.getUTCDay();
    if (weekday === 0) continue; // domingo: casi no se despacha
    if (weekday === 6 && date.getUTCDate() % 3 === 0) continue; // sábado flojo ocasional
    const day = date.getUTCDate();
    const monthFactor = 0.82 + ((date.getUTCMonth() * 7) % 9) / 40;

    SALES_PRODUCTS.forEach((product, index) => {
      const wave = ((day * 37 + index * 11) % 23) - 11; // −11 % … +11 %
      const sacks = Math.max(0, Math.round(product.baseSacks * monthFactor * (1 + wave / 100)));
      if (sacks === 0) return;
      rows.push({
        fecha: isoUtc(date),
        co_art: product.co_art,
        art_des: product.art_des,
        uni_venta: product.uni_venta,
        uni_relac: product.uni_relac,
        unid: sacks,
        kg: sacks * product.uni_relac,
      });
    });
  }

  return rows;
}

const SALES_DAILY = buildDailySales();

function paramDay(value: unknown): string {
  if (value instanceof Date) return isoUtc(value);
  return String(value ?? '').slice(0, 10);
}

function salesMonthly(params: Record<string, unknown>, limit: number): Record<string, unknown>[] {
  const from = paramDay(params.desde);
  const to = paramDay(params.hasta);
  const buckets = new Map<
    string,
    { anio: number; mes: number; co_art: string; art_des: string; uni_venta: string; uni_relac: number; unid: number; kg: number; ultima_factura: string }
  >();

  for (const row of SALES_DAILY) {
    const day = String(row.fecha);
    if (from && day < from) continue;
    if (to && day >= to) continue;
    const [year, month] = day.split('-');
    const code = String(row.co_art);
    const key = `${year}-${month}-${code}`;
    const bucket = buckets.get(key) ?? {
      anio: Number(year),
      mes: Number(month),
      co_art: code,
      art_des: String(row.art_des),
      uni_venta: String(row.uni_venta),
      uni_relac: Number(row.uni_relac),
      unid: 0,
      kg: 0,
      ultima_factura: day,
    };
    bucket.unid += Number(row.unid);
    bucket.kg += Number(row.kg);
    if (day > bucket.ultima_factura) bucket.ultima_factura = day;
    buckets.set(key, bucket);
  }

  return [...buckets.values()].slice(0, limit);
}

function salesDaily(params: Record<string, unknown>, limit: number): Record<string, unknown>[] {
  const from = paramDay(params.desde);
  const to = paramDay(params.hasta);
  const buckets = new Map<string, { fecha: string; kg: number; unid: number; facturas: number }>();

  for (const row of SALES_DAILY) {
    const day = String(row.fecha);
    if (from && day < from) continue;
    if (to && day >= to) continue;
    const bucket = buckets.get(day) ?? { fecha: day, kg: 0, unid: 0, facturas: 0 };
    bucket.kg += Number(row.kg);
    bucket.unid += Number(row.unid);
    buckets.set(day, bucket);
  }

  // Nº de facturas determinista (varias líneas por factura en la vida real).
  for (const bucket of buckets.values()) {
    bucket.facturas = 2 + (Number(bucket.fecha.slice(8, 10)) % 3);
  }

  return [...buckets.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, limit);
}

function datasetFor(viewName: string): Record<string, unknown>[] {
  const lower = viewName.toLowerCase();
  if (lower.includes('solicitud') || lower.includes('pendiente')) return SOLICITUDES;
  return [];
}

// Filas equivalentes a `cotiz_c` para la reconciliación de pedidos.
// En fixtures no hay notas de entrega: todos los pedidos siguen abiertos
// (`status='0'`). Los tests del servicio usan un adaptador falso para simular
// el cierre; esto solo mantiene la app de desarrollo operativa.
function lifecycleHeaders(params: Record<string, unknown>, limit: number): Record<string, unknown>[] {
  const numbers = Object.keys(params)
    .filter((key) => /^o\d+$/.test(key))
    .map((key) => String(params[key]))
    .slice(0, limit);
  return numbers.map((nro) => {
    const row = SOLICITUDES.find((item) => String(item.nro_solicitud) === nro);
    return {
      fact_num: Number(nro),
      status: row?.status_cotizacion ?? '0',
      anulada: false,
      fec_emis: row?.emision ?? null,
    };
  });
}

function lifecyclePending(params: Record<string, unknown>, limit: number): Record<string, unknown>[] {
  const wanted = new Set(
    Object.keys(params)
      .filter((key) => /^o\d+$/.test(key))
      .map((key) => String(params[key])),
  );
  const byOrder = new Map<string, { pendiente: number; lineas: number }>();
  for (const row of SOLICITUDES) {
    const nro = String(row.nro_solicitud);
    if (!wanted.has(nro)) continue;
    const bucket = byOrder.get(nro) ?? { pendiente: 0, lineas: 0 };
    bucket.pendiente += Number(row.pendiente ?? 0);
    bucket.lineas += 1;
    byOrder.set(nro, bucket);
  }
  return [...byOrder.entries()].slice(0, limit).map(([nro, bucket]) => ({
    fact_num: Number(nro),
    pendiente: bucket.pendiente,
    lineas: bucket.lineas,
  }));
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
    // Reconciliación de pedidos: se detecta por el marcador del SELECT.
    if (lower.includes('order_lifecycle_header')) return lifecycleHeaders(params, limit);
    if (lower.includes('order_lifecycle_pending')) return lifecyclePending(params, limit);
    if (lower.includes('reng_nde')) {
      // Serie diaria (la consulta agrupa por `CAST(f.fec_emis AS date)`) vs
      // agregado mensual por artículo.
      return lower.includes('as fecha') ? salesDaily(params, limit) : salesMonthly(params, limit);
    }
    if (lower.includes('cartera_resumen')) return statementSummaries(params, limit);
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
