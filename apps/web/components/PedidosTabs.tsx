'use client';

// ============================================================
// Pestañas internas de Pedidos, justo debajo del encabezado.
//
// Cada vista tiene su propio permiso:
//   · Pedidos   → pedidos:read        (simulador de despacho)
//   · Ventas    → pedidos:view_summary (analítica comercial)
//   · Historial → pedidos:view_history (pedidos procesados)
//
// Ocultar una pestaña es solo la capa visual: el API valida el mismo permiso.
// ============================================================

import Link from 'next/link';
import { BarChart3, History, ShieldAlert, ShoppingCart } from 'lucide-react';
import { cx } from './ui';
import { hasPermission } from '../lib/permissions';

export type PedidosTab = 'pedidos' | 'ventas' | 'historial';

const TABS: Array<{
  id: PedidosTab;
  label: string;
  href: string;
  action: string;
  icon: typeof ShoppingCart;
  hint: string;
}> = [
  {
    id: 'pedidos',
    label: 'Pedidos',
    href: '/pedidos',
    action: 'read',
    icon: ShoppingCart,
    hint: 'Simulador de despacho con la cartera viva',
  },
  {
    id: 'ventas',
    label: 'Ventas',
    href: '/pedidos/ventas',
    action: 'view_summary',
    icon: BarChart3,
    hint: 'Ventas, facturación y comparación año contra año',
  },
  {
    id: 'historial',
    label: 'Historial',
    href: '/pedidos/historial',
    action: 'view_history',
    icon: History,
    hint: 'Pedidos procesados, cancelados y su facturación',
  },
];

export function PedidosTabs({
  active,
  permissions,
}: {
  active: PedidosTab;
  permissions?: string[] | null;
}) {
  // Mientras llega la sesión se muestran todas; al cargar se filtra por
  // permiso. Nunca se muestra una pestaña a la que el API vaya a responder 403.
  const visible = TABS.filter(
    (tab) => !permissions || hasPermission(permissions, 'pedidos', tab.action),
  );

  return (
    <nav aria-label="Secciones de Pedidos" className="border-b border-outline-variant/40">
      <ul className="flex flex-wrap items-end gap-space-xs">
        {visible.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                title={tab.hint}
                className={cx(
                  'group -mb-px inline-flex h-11 items-center gap-space-xs rounded-t-lg border-b-2 px-space-md font-semibold text-label-md transition-colors',
                  isActive
                    ? 'border-primary bg-surface-container-lowest text-primary'
                    : 'border-transparent text-on-surface-variant hover:bg-surface-container-low hover:text-primary',
                )}
              >
                <Icon aria-hidden className={cx('size-4', isActive ? 'text-primary' : 'text-outline')} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Pantalla para quien entra por URL directa a una vista sin permiso. */
export function PedidosDenied({
  title,
  allowedHref,
}: {
  title: string;
  allowedHref: string;
}) {
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-space-sm rounded-card border border-outline-variant/40 bg-surface-container-lowest px-space-lg py-space-2xl text-center shadow-soft">
      <ShieldAlert aria-hidden className="size-8 text-warning" />
      <h2 className="text-title-md font-semibold text-primary">{title}</h2>
      <p className="text-body-md text-on-surface-variant">
        Tu rol no tiene esta vista de Pedidos. Un administrador puede concederla desde Usuarios → Roles.
      </p>
      <Link
        href={allowedHref}
        className="mt-space-sm inline-flex h-9 items-center rounded-pill bg-primary-container px-space-md font-semibold text-label-md text-on-primary transition-opacity hover:opacity-90"
      >
        Volver a Pedidos
      </Link>
    </section>
  );
}
