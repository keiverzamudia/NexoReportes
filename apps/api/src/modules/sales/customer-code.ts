import { BadRequestException } from '@nestjs/common';

// Código de cliente de Profit: CHAR con relleno, se normaliza a MAYÚSCULAS.
// La misma regla la usan el estado de cuenta y la ficha 360.
export function normalizeCustomerCode(value: string): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,10}$/.test(code)) {
    throw new BadRequestException('Código de cliente inválido');
  }
  return code;
}
