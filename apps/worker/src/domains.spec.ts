import { describe, expect, it } from 'vitest';
import { SYNC_DOMAINS, SYNC_ORDER, coerceDomain } from './domains';

describe('dominios de sync', () => {
  it('el orden de ejecución incluye todos los dominios exactamente una vez', () => {
    expect([...SYNC_ORDER].sort()).toEqual([...SYNC_DOMAINS].sort());
    expect(new Set(SYNC_ORDER).size).toBe(SYNC_DOMAINS.length);
  });

  it('PEDIDOS_DETALLE va después de PEDIDOS (dependencia real)', () => {
    expect(SYNC_ORDER.indexOf('PEDIDOS')).toBeLessThan(SYNC_ORDER.indexOf('PEDIDOS_DETALLE'));
  });

  it('EXISTENCIAS va después de PRODUCTOS y ALMACENES (resolución de ids)', () => {
    const productos = SYNC_ORDER.indexOf('PRODUCTOS');
    const almacenes = SYNC_ORDER.indexOf('ALMACENES');
    const existencias = SYNC_ORDER.indexOf('EXISTENCIAS');
    expect(productos).toBeLessThan(existencias);
    expect(almacenes).toBeLessThan(existencias);
  });

  it('coerceDomain valida entradas arbitrarias', () => {
    expect(coerceDomain('PRODUCTOS')).toBe('PRODUCTOS');
    expect(coerceDomain('INVENTARIO')).toBeUndefined();
    expect(coerceDomain(undefined)).toBeUndefined();
    expect(coerceDomain(null)).toBeUndefined();
  });
});
