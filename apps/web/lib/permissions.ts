'use client';

import { APP_MODULES, permissionKey } from '@nexo/contracts';

// Helpers de la matriz de permisos en el cliente. La fuente de verdad sigue
// siendo el servidor: aquí solo se decide qué mostrar/habilitar.

// El módulo «Vendedoras» pasó a «Vendedor». Los JWT emitidos antes del cambio
// todavía traen `vendedoras:read` (duran 15 min): se acepta como alias
// temporal para no ocultar el menú a mitad de sesión.
const LEGACY_MODULE_ALIASES: Record<string, string> = {
  vendedor: 'vendedoras',
};

/** true si la sesión tiene la acción indicada sobre el módulo. */
export function hasPermission(
  permissions: string[] | undefined | null,
  module: string,
  action = 'read',
): boolean {
  if (permissions?.includes(permissionKey(module, action))) return true;
  const legacy = LEGACY_MODULE_ALIASES[module];
  return legacy ? Boolean(permissions?.includes(permissionKey(legacy, action))) : false;
}

/** true si el usuario puede abrir el módulo (acción read). */
export function canSeeModule(permissions: string[] | undefined | null, module: string): boolean {
  return hasPermission(permissions, module, 'read');
}

/** Primer módulo visible con pantalla: destino seguro tras un 403 de ruta. */
export function firstAllowedHref(permissions: string[] | undefined | null): string | null {
  const module = APP_MODULES.find((entry) => entry.href && canSeeModule(permissions, entry.key));
  return module?.href ?? null;
}

/** Acciones disponibles de un módulo según el catálogo compartido. */
export function moduleActions(module: string) {
  return APP_MODULES.find((entry) => entry.key === module)?.actions ?? [];
}
