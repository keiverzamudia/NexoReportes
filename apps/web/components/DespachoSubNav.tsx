'use client';

// ============================================================
// Navegación interna de Despacho.
//
// La bandeja de trabajo queda limpia; Historial y Retiros son pantallas
// hermanas que solo aparecen si el token trae el permiso correspondiente
// (`despacho:view_history` / `despacho:view_removals`). El API valida lo
// mismo: ocultar el enlace es solo la capa visual.
// ============================================================

import { ClipboardList, History, PackageX } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { hasPermission } from '../lib/permissions';
import { cx } from './ui';

export function DespachoSubNav({ permissions }: { permissions?: string[] }) {
  const pathname = usePathname();
  const canOpenDespacho = hasPermission(permissions, 'despacho', 'read');
  const links = [
    { href: '/despacho', label: 'Bandeja', icon: ClipboardList, visible: canOpenDespacho },
    {
      href: '/despacho/historial',
      label: 'Historial',
      icon: History,
      visible: canOpenDespacho && hasPermission(permissions, 'despacho', 'view_history'),
    },
    {
      href: '/despacho/retiros',
      label: 'Retiros de simulación',
      icon: PackageX,
      visible: canOpenDespacho && hasPermission(permissions, 'despacho', 'view_removals'),
    },
  ].filter((link) => link.visible);

  // La bandeja no debe quedar activa cuando se está en una vista hija.
  const isActive = (href: string) =>
    href === '/despacho'
      ? pathname === '/despacho' || (pathname.startsWith('/despacho/') && !pathname.startsWith('/despacho/historial') && !pathname.startsWith('/despacho/retiros'))
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Vistas de despacho" className="flex flex-wrap items-center gap-space-2xs">
      {links.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'inline-flex h-9 items-center gap-space-2xs rounded-pill px-space-md text-label-md font-semibold transition-colors',
              active
                ? 'bg-primary-container text-on-primary shadow-soft'
                : 'border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
