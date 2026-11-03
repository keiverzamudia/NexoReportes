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

// Forecast mensual de desarrollo (equivalente a `dbo.forecast`).
// `forecast_mes` viene en la presentación del artículo (sacos para SAC, kg para
// granel), igual que en Profit; el servicio lo convierte a kg con `uni_relac`.
// Los valores se eligen para que la pestaña «Ventas vs Forecast» tenga metas
// realistas (~1,5 M kg/mes). `fecha` (mes de vigencia) se genera por cada mes
// pedido en `forecastRows`.
const FORECAST: Record<string, unknown>[] = [
  { co_art: 'ABABOV58', forecast_mes: 4_571, uni_venta: 'SAC', uni_relac: 35 }, // ≈159.985 kg
  { co_art: 'ABAGP13', forecast_mes: 9_000, uni_venta: 'SAC', uni_relac: 40 }, // 360.000 kg
  { co_art: 'ABAEQUI01', forecast_mes: 10_000, uni_venta: 'SAC', uni_relac: 10 }, // 100.000 kg
  { co_art: 'ABABOV67', forecast_mes: 9_714, uni_venta: 'SAC', uni_relac: 35 }, // ≈339.990 kg
  { co_art: 'ABAPOR47', forecast_mes: 3_875, uni_venta: 'SAC', uni_relac: 40 }, // 155.000 kg
  { co_art: 'ABABOV75', forecast_mes: 2_429, uni_venta: 'SAC', uni_relac: 35 }, // ≈85.015 kg
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

// ============================================================
// Clientes de desarrollo: catálogo completo y ventas por cliente.
//
// El catálogo añade clientes SIN pedido para probar la cartera por ventas.
// Las ventas son deterministas y respetan la unidad: los perfiles SAC se
// reportan en sacos y los KG en kg (nunca se mezclan en la misma columna).
// ============================================================
const EXTRA_CLIENTS = [
  {
    co_cli: '900000001',
    cli_des: 'AVICOLA LOS LLANOS, C.A',
    tipo_cliente: 'L2 DISTRIBUIDORES',
    vendedor: 'JULIARD ANGULO',
  },
  {
    co_cli: '900000002',
    cli_des: 'GRANJA SAN JOSE, C.A',
    tipo_cliente: 'L3 MINORISTA',
    vendedor: 'MEIDY CRISTINA ARIAS VIDAL',
  },
  {
    co_cli: '900000003',
    cli_des: 'INACTIVO DESDE 2025, C.A',
    tipo_cliente: 'L3 MINORISTA',
    vendedor: 'LIZ ANTONELLA PEREZ BAEZ',
  },
];

interface FixtureCustomerSalesProfile {
  code: string;
  uom: 'SAC' | 'KG';
  /** Sacos/mes si SAC; kg/mes si KG. */
  base: number;
  /** Kg por saco (1 para KG). */
  kgPerUom: number;
  seed: number;
  /** 0 = vende este mes; 13 = dejó de vender hace más de un año. */
  lastSaleMonthsAgo: number;
  firstSaleMonthsAgo: number;
}

const CUSTOMER_SALES_PROFILES: FixtureCustomerSalesProfile[] = [
  { code: '153064128', uom: 'SAC', base: 140, kgPerUom: 35, seed: 1, lastSaleMonthsAgo: 0, firstSaleMonthsAgo: 17 },
  { code: '505835220', uom: 'KG', base: 4200, kgPerUom: 1, seed: 2, lastSaleMonthsAgo: 0, firstSaleMonthsAgo: 17 },
  { code: '900000001', uom: 'SAC', base: 180, kgPerUom: 40, seed: 3, lastSaleMonthsAgo: 0, firstSaleMonthsAgo: 17 },
  { code: '900000002', uom: 'KG', base: 3800, kgPerUom: 1, seed: 4, lastSaleMonthsAgo: 0, firstSaleMonthsAgo: 17 },
  // Solo vendió entre 13 y 17 meses atrás: no debe salir en el universo de 12m.
  { code: '900000003', uom: 'SAC', base: 90, kgPerUom: 35, seed: 5, lastSaleMonthsAgo: 13, firstSaleMonthsAgo: 17 },
];

function customerCatalog(limit: number): Record<string, unknown>[] {
  const byCode = new Map<string, Record<string, unknown>>();
  for (const row of SOLICITUDES) {
    const code = String(row.co_cli);
    if (byCode.has(code)) continue;
    byCode.set(code, {
      co_cli: code,
      cli_des: row.cli_des,
      tipo_cliente: row.tipo_cliente,
      vendedor: row.vendedor_cliente ?? row.vendedor,
    });
  }
  for (const extra of EXTRA_CLIENTS) {
    byCode.set(extra.co_cli, { ...extra });
  }
  return [...byCode.values()].slice(0, limit);
}

function customerSales(params: Record<string, unknown>, limit: number): Record<string, unknown>[] {
  const from = paramDay(params.desde);
  const to = paramDay(params.hasta);
  if (!from || !to || from >= to) return [];

  const now = new Date();
  const rows: Record<string, unknown>[] = [];
  for (const profile of CUSTOMER_SALES_PROFILES) {
    let sacks = 0;
    let kg = 0;
    let totalKg = 0;
    let notas = 0;
    let ultima: string | null = null;

    for (let offset = profile.firstSaleMonthsAgo; offset >= profile.lastSaleMonthsAgo; offset -= 1) {
      const start = isoUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)));
      const next = isoUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1)));
      // Intersección del mes con la ventana [desde, hasta).
      if (next <= from || start >= to) continue;

      const factor = 0.85 + ((offset * 7 + profile.seed) % 9) / 40;
      const monthSacks = profile.uom === 'SAC' ? Math.round(profile.base * factor) : 0;
      const monthKg = profile.uom === 'KG' ? Math.round(profile.base * factor) : 0;
      sacks += monthSacks;
      kg += monthKg;
      totalKg += monthSacks * profile.kgPerUom + monthKg;
      notas += 1 + (offset % 3);

      const lastDay = isoUtc(new Date(Math.min(Date.parse(next) - 86_400_000, Date.parse(to) - 86_400_000)));
      if (!ultima || lastDay > ultima) ultima = lastDay;
    }

    if (sacks === 0 && kg === 0) continue;
    rows.push({ co_cli: profile.code, sacos: sacks, kg, kg_total: totalKg, notas, ultima });
  }
  return rows.slice(0, limit);
}

// ============================================================
// Ficha 360 de clientes (desarrollo).
//
// A partir del perfil de ventas de `CUSTOMER_SALES_PROFILES` se reparte la
// cantidad mensual entre 3–4 artículos, de modo que siempre haya un producto
// principal, uno que dejó de comprarse y (en clientes activos) uno nuevo.
// Los importes usan un precio/kg determinista para que la facturación sea
// coherente con el volumen y el gráfico tenga las dos series.
// ============================================================
const INSIGHT_SIMILAR_PRODUCTS = [
  { co_art: 'ABASIM01', art_des: 'CRECIMIENTO PESO 20% - 40 KG', uni_venta: 'SAC', uni_relac: 40 },
  { co_art: 'ABASIM02', art_des: 'LECHONES INICIADOR 22% - 25 KG', uni_venta: 'SAC', uni_relac: 25 },
  { co_art: 'ABASIM03', art_des: 'ENGORDE FINAL 18% - 40 KG', uni_venta: 'SAC', uni_relac: 40 },
  { co_art: 'ABASIM04', art_des: 'BOVINO DESARROLLO 16% - 35 KG', uni_venta: 'SAC', uni_relac: 35 },
  { co_art: 'ABASIM05', art_des: 'EQUINO MANTENIMIENTO 12% - 35 KG', uni_venta: 'SAC', uni_relac: 35 },
  { co_art: 'ABASIM06', art_des: 'CONEJO PRODUCCION 17% - 20 KG', uni_venta: 'SAC', uni_relac: 20 },
];

interface FixtureInsightAssignment {
  code: string;
  description: string;
  uom: 'SAC' | 'KG';
  kgPerUom: number;
  share: number;
  startMonthsAgo: number;
  endMonthsAgo: number;
  pricePerKg: number;
  /** Multiplicador para la ventana actual (0.5 = producto en caída). */
  currentFactor: number;
}

function insightAssignments(profile: FixtureCustomerSalesProfile): FixtureInsightAssignment[] {
  const productCount = SALES_PRODUCTS.length;
  const picks = [0, 2, 4].map((offset) => SALES_PRODUCTS[(profile.seed + offset) % productCount]!);
  const active = profile.lastSaleMonthsAgo === 0;
  const shares = active ? [0.55, 0.25, 0.15] : [0.6, 0.3, 0.1];

  const assignments: FixtureInsightAssignment[] = picks.map((product, index) => ({
    code: product.co_art,
    description: profile.uom === 'KG' ? `${product.art_des} - GRANEL` : product.art_des,
    uom: profile.uom,
    kgPerUom: profile.uom === 'SAC' ? profile.kgPerUom : 1,
    share: shares[index]!,
    startMonthsAgo: profile.firstSaleMonthsAgo,
    // El tercer artículo deja de comprarse hace 13 meses: queda como PERDIDO
    // en la ventana de 12 meses, pero se ve en los 12 anteriores.
    endMonthsAgo: index === 2 ? Math.max(13, profile.lastSaleMonthsAgo) : profile.lastSaleMonthsAgo,
    pricePerKg: 0.42 + index * 0.035,
    // El segundo artículo baja a la mitad en los últimos 12 meses (CAYENDO).
    currentFactor: index === 1 ? 0.35 : 1,
  }));

  if (active) {
    const newcomer = SALES_PRODUCTS[(profile.seed + 5) % productCount]!;
    assignments.push({
      code: newcomer.co_art,
      description: profile.uom === 'KG' ? `${newcomer.art_des} - GRANEL` : newcomer.art_des,
      uom: profile.uom,
      kgPerUom: profile.uom === 'SAC' ? profile.kgPerUom : 1,
      share: 0.05,
      startMonthsAgo: 4,
      endMonthsAgo: 0,
      pricePerKg: 0.5,
      currentFactor: 1,
    });
  }

  return assignments;
}

function monthStart(offset: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
}

function customerInsightRows(
  params: Record<string, unknown>,
  limit: number,
): Record<string, unknown>[] {
  const code = String(params.co_cli ?? '').trim().toUpperCase();
  const profile = CUSTOMER_SALES_PROFILES.find((item) => item.code.toUpperCase() === code);
  if (!profile) return [];
  const from = paramDay(params.desde);
  const to = paramDay(params.hasta);
  if (!from || !to || from >= to) return [];

  const now = new Date();
  const assignments = insightAssignments(profile);
  const rows: Record<string, unknown>[] = [];

  for (let offset = profile.firstSaleMonthsAgo; offset >= 0; offset -= 1) {
    const start = monthStart(offset, now);
    const next = monthStart(offset - 1, now);
    const startKey = isoUtc(start);
    const nextKey = isoUtc(next);
    if (nextKey <= from || startKey >= to) continue;

    const factor = 0.85 + ((offset * 7 + profile.seed) % 9) / 40;
    const monthQty = Math.max(0, Math.round(profile.base * factor));
    if (monthQty === 0) continue;

    const active = assignments.filter(
      (assignment) => offset <= assignment.startMonthsAgo && offset >= assignment.endMonthsAgo,
    );
    const weights = active.map((assignment) => {
      const currentWindow = offset <= 11;
      return assignment.share * (currentWindow ? assignment.currentFactor : 1);
    });
    const totalWeight = weights.reduce((acc, value) => acc + value, 0);
    if (totalWeight <= 0) continue;

    const noteCount = 1 + (offset % 3);
    const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    const todayDay = start.getUTCFullYear() === now.getUTCFullYear() && start.getUTCMonth() === now.getUTCMonth()
      ? now.getUTCDate()
      : daysInMonth;

    for (let noteIndex = 0; noteIndex < noteCount; noteIndex += 1) {
      const day = Math.min(
        todayDay,
        3 + ((profile.seed + offset * 5 + noteIndex * 7) % Math.max(1, Math.min(24, todayDay - 2))),
      );
      const fecha = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (fecha < from || fecha >= to) continue;
      const nota = 900000 + profile.seed * 1000 + offset * 10 + noteIndex;

      active.forEach((assignment, index) => {
        const weight = weights[index]!;
        const qty = (monthQty * weight) / totalWeight / noteCount;
        const units = profile.uom === 'SAC' ? Math.round(qty * 100) / 100 : Math.round(qty * 100) / 100;
        rows.push({
          anio: start.getUTCFullYear(),
          mes: start.getUTCMonth() + 1,
          nota,
          co_art: assignment.code,
          art_des: assignment.description,
          uni_venta: assignment.uom,
          uni_relac: assignment.kgPerUom,
          unid: units,
          kg: round2(units * assignment.kgPerUom),
          fecha,
          precio_kg: assignment.pricePerKg,
        });
      });
    }
  }

  return rows.slice(0, limit);
}

function customerInsightBilling(
  params: Record<string, unknown>,
  limit: number,
): Record<string, unknown>[] {
  const rows = customerInsightRows(params, 20000);
  const buckets = new Map<
    string,
    { anio: number; mes: number; facturado: number; documentos: Set<string> }
  >();

  for (const row of rows) {
    const key = `${row.anio}-${String(row.mes).padStart(2, '0')}`;
    const bucket = buckets.get(key) ?? {
      anio: Number(row.anio),
      mes: Number(row.mes),
      facturado: 0,
      documentos: new Set<string>(),
    };
    bucket.facturado += Number(row.kg) * Number(row.precio_kg ?? 0.45);
    bucket.documentos.add(String(row.nota));
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => a.anio - b.anio || a.mes - b.mes)
    .slice(0, limit)
    .map((bucket) => ({
      anio: bucket.anio,
      mes: bucket.mes,
      facturado: round2(bucket.facturado),
      creditos: 0,
      documentos: bucket.documentos.size,
      sin_tasa: 0,
    }));
}

function customerInsightSimilar(
  params: Record<string, unknown>,
  limit: number,
): Record<string, unknown>[] {
  const type = String(params.tipo ?? '').trim().toUpperCase();
  const seed = [...type].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const totalType = 42 + (seed % 27);
  return INSIGHT_SIMILAR_PRODUCTS.slice(0, limit).map((product, index) => {
    const clients = Math.max(1, totalType - index * 5);
    const kg = clients * (1800 + index * 350);
    return {
      co_art: product.co_art,
      art_des: product.art_des,
      uni_venta: product.uni_venta,
      uni_relac: product.uni_relac,
      clientes: clients,
      unid: Math.round((kg / product.uni_relac) * 100) / 100,
      kg,
      total_tipo: totalType,
    };
  });
}

// Filas de `forecast` para todos los meses del rango [desde, hasta): una fila
// por artículo y mes, con `fecha` en el primer día del mes de vigencia.
function forecastRows(params: Record<string, unknown>, limit: number): Record<string, unknown>[] {
  const from = paramDay(params.desde);
  const to = paramDay(params.hasta);
  if (!from || !to || from >= to) return [];
  const [fromYear, fromMonth] = from.split('-').map(Number) as [number, number];
  if (!Number.isFinite(fromYear) || !Number.isFinite(fromMonth)) return [];
  const rows: Record<string, unknown>[] = [];
  let year = fromYear;
  let month = fromMonth;
  // Tope defensivo: 20 años de meses, de sobra para el histórico del informe.
  for (let guard = 0; guard < 240; guard += 1) {
    const fecha = `${year}-${String(month).padStart(2, '0')}-01`;
    if (fecha >= to) break;
    if (fecha >= from) {
      for (const item of FORECAST) {
        rows.push({
          co_art: item.co_art,
          forecast_mes: item.forecast_mes,
          uni_venta: item.uni_venta,
          uni_relac: item.uni_relac,
          fecha,
        });
      }
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return rows.slice(0, limit);
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

// Desglose por artículo y día (panel «Ventas del día»): misma data fixture que
// `salesDaily`, pero agrupada por `fecha + co_art`.
function salesDailyProducts(params: Record<string, unknown>, limit: number): Record<string, unknown>[] {
  const from = paramDay(params.desde);
  const to = paramDay(params.hasta);
  const buckets = new Map<string, { fecha: string; co_art: string; kg: number; unid: number }>();

  for (const row of SALES_DAILY) {
    const day = String(row.fecha);
    if (from && day < from) continue;
    if (to && day >= to) continue;
    const code = String(row.co_art);
    const key = `${day}|${code}`;
    const bucket = buckets.get(key) ?? { fecha: day, co_art: code, kg: 0, unid: 0 };
    bucket.kg += Number(row.kg);
    bucket.unid += Number(row.unid);
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || b.kg - a.kg)
    .slice(0, limit);
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
  // salvo las consultas con fuente propia: forecast (`forecast`) y estado de
  // cuenta (`docum_cc` / `Documentos_Pendientes`).
  async selectQuery(
    sqlText: string,
    limit: number,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>[]> {
    const lower = sqlText.toLowerCase();
    if (lower.includes('dbo.forecast')) return forecastRows(params, limit);
    // Ficha 360 de clientes (volumen, facturación y surtido del segmento).
    // Va antes de `reng_nde` porque la consulta de volumen usa esa tabla.
    if (lower.includes('nexo:customer_insights_products')) return customerInsightRows(params, limit);
    if (lower.includes('nexo:customer_insights_billing')) return customerInsightBilling(params, limit);
    if (lower.includes('nexo:customer_insights_similar')) return customerInsightSimilar(params, limit);
    // Catálogo completo de clientes y ventas por cliente (módulo Clientes).
    // Van antes de `reng_nde` porque la consulta de ventas usa esa tabla.
    if (lower.includes('nexo:customer_catalog')) return customerCatalog(limit);
    if (lower.includes('nexo:customer_sales')) return customerSales(params, limit);
    // Reconciliación de pedidos: se detecta por el marcador del SELECT.
    if (lower.includes('order_lifecycle_header')) return lifecycleHeaders(params, limit);
    if (lower.includes('order_lifecycle_pending')) return lifecyclePending(params, limit);
    if (lower.includes('reng_nde')) {
      // Desglose por artículo del día (panel «Ventas del día»).
      if (lower.includes('nexo:daily_products')) return salesDailyProducts(params, limit);
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
