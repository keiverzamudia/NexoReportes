'use client';

import { APP_MODULES, permissionKey } from '@nexo/contracts';

// ============================================================
// Helpers de la matriz de permisos en el cliente. La fuente de verdad sigue
// siendo el servidor: aquí solo se decide qué mostrar/habilitar.
// ============================================================

// El módulo «Vendedoras» pasó a «Vendedor». Los JWT emitidos antes del cambio
// todavía traen `vendedoras:read` (duran 15 min): se acepta como alias
// temporal para no ocultar el menú a mitad de sesión.
const LEGACY_MODULE_ALIASES: Record<string, string> = {
  vendedor: 'vendedoras',
};

// PCP nació de fusionar «Llegadas» y «Romana». Mientras las sesiones viejas se
// refrescan, se aceptan sus claves. `upload` viene de `romana:create` (subir
// fotos y marcar en báscula).
const PCP_LEGACY_ACTIONS: Record<string, string[]> = {
  read: ['llegadas:read', 'romana:read'],
  create: ['llegadas:create'],
  upload: ['romana:create'],
  update: ['llegadas:update', 'romana:update'],
  validate: ['romana:validate'],
  delete: ['llegadas:delete', 'romana:delete'],
};

/** true si la sesión tiene la acción indicada sobre el módulo. */
export function hasPermission(
  permissions: string[] | undefined | null,
  module: string,
  action = 'read',
): boolean {
  if (permissions?.includes(permissionKey(module, action))) return true;
  if (module === 'pcp' && permissions) {
    return (PCP_LEGACY_ACTIONS[action] ?? []).some((key) => permissions.includes(key));
  }
  const legacy = LEGACY_MODULE_ALIASES[module];
  return legacy ? Boolean(permissions?.includes(permissionKey(legacy, action))) : false;
}

/** true si el usuario puede abrir el módulo (acción read). */
export function canSeeModule(permissions: string[] | undefined | null, module: string): boolean {
  return hasPermission(permissions, module, 'read');
}

/**
 * Pedidos tiene tres vistas con permiso propio. El módulo aparece si el
 * usuario puede ver al menos una; el destino depende de cuál tenga.
 */
export function canSeePedidos(permissions: string[] | undefined | null): boolean {
  return (
    canSeeModule(permissions, 'pedidos') ||
    hasPermission(permissions, 'pedidos', 'view_summary') ||
    hasPermission(permissions, 'pedidos', 'view_history')
  );
}

export function firstPedidosHref(permissions: string[] | undefined | null): string | null {
  if (hasPermission(permissions, 'pedidos', 'read')) return '/pedidos';
  if (hasPermission(permissions, 'pedidos', 'view_summary')) return '/pedidos/ventas';
  if (hasPermission(permissions, 'pedidos', 'view_history')) return '/pedidos/historial';
  return null;
}

/** Primer módulo visible con pantalla: destino seguro tras un 403 de ruta. */
export function firstAllowedHref(permissions: string[] | undefined | null): string | null {
  for (const entry of APP_MODULES) {
    if (!entry.href) continue;
    if (entry.key === 'pedidos' && canSeePedidos(permissions)) return firstPedidosHref(permissions);
    if (entry.key !== 'pedidos' && canSeeModule(permissions, entry.key)) return entry.href;
  }
  return null;
}

/** Acciones disponibles de un módulo según el catálogo compartido. */
export function moduleActions(module: string) {
  return APP_MODULES.find((entry) => entry.key === module)?.actions ?? [];
}
