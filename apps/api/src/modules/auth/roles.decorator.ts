import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'requiredRoles';

// Declara los roles permitidos para un handler. El ADMIN siempre tiene acceso.
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
