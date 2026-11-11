'use client';

import { ShieldX } from 'lucide-react';
import Link from 'next/link';
import { Card, EmptyState } from './ui';

// Estado compartido cuando la sesión no tiene el permiso de una vista hija de
// Despacho. El API responde 403 igual: esto solo evita la llamada y explica.
export function DespachoAccessDenied({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <EmptyState
        icon={ShieldX}
        title={title}
        description={description}
        action={
          <Link
            href="/despacho"
            className="mt-space-sm inline-flex h-9 items-center rounded-pill bg-primary-container px-space-md font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
          >
            Volver a la bandeja
          </Link>
        }
      />
    </Card>
  );
}
