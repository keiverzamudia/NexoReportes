import { describe, expect, it } from 'vitest';
import {
  mapOrderStatus,
  normalizeInventoryRow,
  normalizeOrderLineRow,
  normalizeOrderRow,
  normalizeProductRow,
  parseProfitDate,
  parseProfitDecimal,
} from './normalizers';

describe('parseProfitDate', () => {
  it('interpreta fechas dd/MM/yyyy del reporte de Profit', () => {
    const date = parseProfitDate('13/10/2026');
    expect(date).not.toBeNull();
    expect(date?.getDate()).toBe(13);
    expect(date?.getMonth()).toBe(9); // octubre
    expect(date?.getFullYear()).toBe(2026);
  });

  it('acepta ISO y devuelve null para basura', () => {
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
    expect(parseProfitDecimal('abc')).toBeNull();
  });
});

describe('normalizeProductRow', () => {
  it('normaliza una fila válida', () => {
    const result = normalizeProductRow({ codigo: 'ABAEQUI01', descripcion: 'ALFALFA EN PELLETS', unidad: 'SAC', familia: 'Forrajes' });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ codigo: 'ABAEQUI01', descripcion: 'ALFALFA EN PELLETS', unidad: 'SAC', familia: 'Forrajes' });
  });

  it('rechaza filas sin código (Caso: datos incompletos)', () => {
    const result = normalizeProductRow({ descripcion: 'X', unidad: 'SAC' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'codigo')).toBe(true);
  });
});

describe('normalizeOrderRow', () => {
  it('normaliza el encabezado y linkea por cliente_codigo', () => {
    const result = normalizeOrderRow({
      numero: '6743',
      cliente_codigo: '406821691025',
      cliente_nombre: 'INVERSIONES APALOOSA A&G, C.A',
      tipo_cliente: 'L1  EXCLUSIVOS',
      vendedor: 'MEIDY CRISTINA ARIAS VIDAL',
      fecha_emision: '13/10/2026',
      fecha_entrega: '16/10/2026',
      autorizado: 'NO',
    });
    expect(result.ok).toBe(true);
    expect(result.value?.numero).toBe('6743');
    expect(result.value?.clienteCodigo).toBe('406821691025');
    expect(result.value?.fechaEntrega?.getDate()).toBe(16);
    expect(result.value?.autorizado).toBe(false);
    expect(result.value?.status).toBe('ABIERTO');
  });

  it('rechaza pedidos sin número', () => {
    expect(normalizeOrderRow({ cliente_codigo: 'X' }).ok).toBe(false);
  });
});

describe('mapOrderStatus', () => {
  it('mapea estados conocidos y marca desconocidos', () => {
    expect(mapOrderStatus('ANULADO')).toBe('CANCELADO');
    expect(mapOrderStatus('CERRADO')).toBe('CERRADO');
    expect(mapOrderStatus('EMITIDO')).toBe('ABIERTO');
    expect(mapOrderStatus('XYZ')).toBe('DESCONOCIDO');
    expect(mapOrderStatus(undefined)).toBe('ABIERTO');
  });
});

describe('normalizeOrderLineRow', () => {
  it('conserva pendientes negativos (sobre-compromiso real de Profit)', () => {
    const result = normalizeOrderLineRow({ numero: '6743', linea: 4, codigo_producto: 'ABABOV67', cantidad: '50.00', pendiente: '-247.00', unidad: 'SAC' });
    expect(result.ok).toBe(true);
    expect(result.value?.pendiente).toBe(-247);
  });

  it('rechaza cantidades negativas de solicitud (Caso: cantidades inválidas)', () => {
    const result = normalizeOrderLineRow({ numero: '6743', codigo_producto: 'X', cantidad: '-5' });
    expect(result.ok).toBe(false);
  });
});

describe('normalizeInventoryRow', () => {
  it('trata reservas no confiables como cero', () => {
    const result = normalizeInventoryRow({ codigo_producto: 'ABAEQUI01', almacen: 'Stock 68', cantidad: '6.00', reservada: 'n/a' });
    expect(result.ok).toBe(true);
    expect(result.value?.reservada).toBe(0);
  });

  it('rechaza existencias sin cantidad', () => {
    expect(normalizeInventoryRow({ codigo_producto: 'X', almacen: 'Stock 68' }).ok).toBe(false);
  });
});
