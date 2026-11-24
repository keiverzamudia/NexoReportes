import { describe, expect, it } from 'vitest';
import { firstAllowedHref, hasPermission } from './permissions';

// ============================================================
// Módulo de inicio según permisos. Lo usan la puerta de sesión (`/`),
// el login y el logo de la barra superior para no aterrizar en una
// pantalla que el usuario no puede ver.
// ============================================================

describe('primer módulo permitido', () => {
  it('sin permisos no hay destino', () => {
    expect(firstAllowedHref([])).toBeNull();
    expect(firstAllowedHref(undefined)).toBeNull();
    expect(firstAllowedHref(null)).toBeNull();
  });

  it('respeta el orden del menú', () => {
    expect(firstAllowedHref(['disponibilidad:read'])).toBe('/disponibilidad');
    expect(firstAllowedHref(['pedidos:read', 'despacho:read'])).toBe('/pedidos');
    expect(firstAllowedHref(['despacho:read'])).toBe('/despacho');
    expect(firstAllowedHref(['reportes:read', 'llegadas:read'])).toBe('/pcp');
  });

  it('ignora permisos de módulos sin pantalla', () => {
    expect(firstAllowedHref(['auditoria:read', 'sincronizacion:update'])).toBeNull();
  });

  it('acepta el permiso legado vendedoras:read durante la transición', () => {
    expect(hasPermission(['vendedoras:read'], 'vendedor')).toBe(true);
    expect(hasPermission(['vendedor:read'], 'vendedor')).toBe(true);
    expect(hasPermission(['otro:read'], 'vendedor')).toBe(false);
  });

  it('acepta los permisos legados de Llegadas y Romana en PCP', () => {
    expect(hasPermission(['llegadas:read'], 'pcp')).toBe(true);
    expect(hasPermission(['romana:read'], 'pcp', 'read')).toBe(true);
    expect(hasPermission(['romana:create'], 'pcp', 'upload')).toBe(true);
    expect(hasPermission(['romana:validate'], 'pcp', 'validate')).toBe(true);
    expect(hasPermission(['llegadas:create'], 'pcp', 'create')).toBe(true);
    expect(hasPermission(['romana:create'], 'pcp', 'create')).toBe(false);
  });

  it('con todo el catálogo entra por Disponibilidad', () => {
    expect(
      firstAllowedHref([
        'disponibilidad:read',
        'forecast:read',
        'pedidos:read',
        'despacho:read',
        'pcp:read',
        'clientes:read',
        'usuarios:read',
      ]),
    ).toBe('/disponibilidad');
  });
});
