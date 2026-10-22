import { SetMetadata } from '@nestjs/common';

// Claves planas: «modulo:accion» (p. ej. «pedidos:read»).

export const PERMISSIONS_KEY = 'requiredPermissions';
export const ANY_PERMISSIONS_KEY = 'anyPermissions';

/** Exige TODOS los permisos indicados. */
export const RequirePermission = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Exige AL MENOS UNO (endpoints compartidos por varios módulos). */
export const RequireAnyPermission = (...permissions: string[]) => SetMetadata(ANY_PERMISSIONS_KEY, permissions);
