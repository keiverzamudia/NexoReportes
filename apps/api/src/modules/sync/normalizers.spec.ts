import { describe, expect, it } from 'vitest';
import {
  RawSolicitudLine,
  aggregateDemandByArticle,
  normalizeSolicitudRow,
  parseProfitDate,
  parseProfitDecimal,
} from './normalizers';

// Fila tal como sale de la vista real (char con padding, decimales).
const REAL_ROW = {
  nro_solicitud: 3536,
  emision: new Date('2025-09-03T00:00:00.000Z'),
  entrega: new Date('2025-09-10T00:00:00.000Z'),
  co_cli: '153064128 ',
  cli_des: 'JOSEF HENDRIX HERNANDEZ REYES' + ' '.repeat(60),
  co_art: 'ABABOV58' + ' '.repeat(22),
  art_des: 'MULTIPROPOSITO 14% LINEA NARANJA SACO 35 KG' + ' '.repeat(78),
  pendiente: 217,
  uni_venta: 'SAC   ',
  relacion_empaque: 35,
  kg: 7595,
  Stock_03: 273,
  Stock_68: 0,
};

describe('parseProfitDate', () => {
  it('interpreta fechas dd/MM/yyyy del reporte de Profit', () => {
    const date = parseProfitDate('13/10/2026');
    expect(date).not.toBeNull();
    expect(date?.getDate()).toBe(13);
    expect(date?.getMonth()).toBe(9); // octubre
    expect(date?.getFullYear()).toBe(2026);
  });

  it('acepta Date (smalldatetime) e ISO y devuelve null para basura', () => {
    expect(parseProfitDate(new Date('2025-09-03'))).not.toBeNull();
    expect(parseProfitDate('2026-10-13')).not.toBeNull();
    expect(parseProfitDate('no-fecha')).toBeNull();
    expect(parseProfitDate(null)).toBeNull();
    expect(parseProfitDate('')).toBeNull();
  });
});

describe('parseProfitDecimal', () => {
  it('interpreta formatos con separador de miles y negativos', () => {
    expect(parseProfitDecimal('1,391.00')).toBe(1391);
    expect(parseProfitDecimal('-247.00')).toBe(-247);
    expect(parseProfitDecimal('5.00')).toBe(5);
    expect(parseProfitDecimal(217)).toBe(217);
    expect(parseProfitDecimal('abc')).toBeNull();
  });
});

describe('normalizeSolicitudRow', () => {
  it('normaliza una fila real recortando el padding de char/varchar', () => {
    const result = normalizeSolicitudRow(REAL_ROW);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      nroSolicitud: 3536,
      emision: new Date('2025-09-03T00:00:00.000Z'),
      entrega: new Date('2025-09-10T00:00:00.000Z'),
      coCli: '153064128',
      cliDes: 'JOSEF HENDRIX HERNANDEZ REYES',
      coArt: 'ABABOV58',
      artDes: 'MULTIPROPOSITO 14% LINEA NARANJA SACO 35 KG',
      pendiente: 217,
      uniVenta: 'SAC',
      relacionEmpaque: 35,
      kg: 7595,
      stock03: 273,
      stock68: 0,
    });
  });

  it('conserva el pendiente negativo (sobre-compromiso real de Profit)', () => {
    const result = normalizeSolicitudRow({ ...REAL_ROW, pendiente: -247 });
    expect(result.ok).toBe(true);
    expect(result.value?.pendiente).toBe(-247);
  });

  it('conserva NULL en columnas anulables de stock (no inventa 0)', () => {
    const result = normalizeSolicitudRow({ ...REAL_ROW, Stock_03: null, Stock_68: null });
    expect(result.ok).toBe(true);
    expect(result.value?.stock03).toBeNull();
    expect(result.value?.stock68).toBeNull();
  });

  it('las columnas de conversión a KG se normalizan y admiten negativo (kg del sobre-compromiso)', () => {
    const normal = normalizeSolicitudRow(REAL_ROW);
    expect(normal.value?.relacionEmpaque).toBe(35);
    expect(normal.value?.kg).toBe(7595);

    const negativo = normalizeSolicitudRow({ ...REAL_ROW, pendiente: -247, kg: -8645 });
    expect(negativo.value?.kg).toBe(-8645);

    // Columna ausente (vista anterior sin esas columnas): null, sin inventar dato.
    const sinKg = normalizeSolicitudRow({ ...REAL_ROW, relacion_empaque: undefined, kg: undefined });
    expect(sinKg.ok).toBe(true);
    expect(sinKg.value?.relacionEmpaque).toBeNull();
    expect(sinKg.value?.kg).toBeNull();
  });

  it('rechaza filas sin solicitud, cliente o artículo (Caso: datos incompletos)', () => {
    const noSolicitud = normalizeSolicitudRow({ ...REAL_ROW, nro_solicitud: null });
    expect(noSolicitud.ok).toBe(false);
    expect(noSolicitud.issues.some((i) => i.field === 'nro_solicitud')).toBe(true);

    const noCliente = normalizeSolicitudRow({ ...REAL_ROW, co_cli: '   ' });
    expect(noCliente.ok).toBe(false);
    expect(noCliente.issues.some((i) => i.field === 'co_cli')).toBe(true);

    const noArticulo = normalizeSolicitudRow({ ...REAL_ROW, co_art: '' });
    expect(noArticulo.ok).toBe(false);
    expect(noArticulo.issues.some((i) => i.field === 'co_art')).toBe(true);
  });

  it('rechaza pendiente no numérico (Caso: cantidades inválidas)', () => {
    const result = normalizeSolicitudRow({ ...REAL_ROW, pendiente: 'n/a' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'pendiente')).toBe(true);
  });
});

describe('aggregateDemandByArticle', () => {
  it('suma el pendiente por artículo conservando el signo', () => {
    const lines: RawSolicitudLine[] = [
      { ...(normalizeSolicitudRow(REAL_ROW).value as RawSolicitudLine) },
      { ...(normalizeSolicitudRow({ ...REAL_ROW, pendiente: 10 }).value as RawSolicitudLine) },
      { ...(normalizeSolicitudRow({ ...REAL_ROW, co_art: 'ABAEQUI01', pendiente: -5 }).value as RawSolicitudLine) },
    ];
    const demand = aggregateDemandByArticle(lines);
    expect(demand.get('ABABOV58')).toBe(227); // 217 + 10
    expect(demand.get('ABAEQUI01')).toBe(-5);
  });
});
