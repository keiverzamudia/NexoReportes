'use client';

// ============================================================
// Guardia de las tres vistas de Pedidos.
//
// Un rol puede tener solo Ventas o solo Historial. En ese caso el módulo
// aparece en la navegación, pero `/pedidos` (el simulador) redirige a la
// primera vista permitida antes de montar la página.
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Skeleton } from '../../components/ui';
import { currentUser } from '../../lib/api';
import { firstAllowedHref, firstPedidosHref, hasPermission } from '../../lib/permissions';

export default function PedidosLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });

  const atSimulator = pathname === '/pedidos';
  const canRead = hasPermission(data?.permissions, 'pedidos', 'read');
  const target = atSimulator && data && !canRead
    ? firstPedidosHref(data.permissions) ?? firstAllowedHref(data.permissions) ?? '/'
    : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  // Evita montar el simulador (y disparar sus consultas) cuando el usuario
  // no tiene permiso para verlo.
  if (atSimulator && (isLoading || target)) {
    return (
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-md p-space-lg md:p-space-xl">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-11 w-72" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  return <>{children}</>;
}
