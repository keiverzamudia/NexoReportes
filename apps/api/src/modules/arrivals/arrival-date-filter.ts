import { Prisma } from '@prisma/client';

// ============================================================
// Ventana de fechas de la bandeja de PCP.
//
// La pestaña «Hoy» no debe esconder lo atrasado: con `overdue` se suman los
// registros de días anteriores que siguen abiertos (nadie los atendió). Lo
// atrasado ya cerrado queda en el histórico, igual que siempre.
// ============================================================

const CLOSED_STATUSES = ['ATENDIDO', 'AUSENTE', 'CANCELADO'];

export function arrivalDateFilter(
  date: string | undefined,
  overdue: boolean | undefined,
): Prisma.CustomerArrivalWhereInput {
  if (!date) return {};
  if (!overdue) return { expectedDate: date };
  return {
    OR: [
      { expectedDate: date },
      { expectedDate: { lt: date }, status: { notIn: CLOSED_STATUSES } },
    ],
  };
}
