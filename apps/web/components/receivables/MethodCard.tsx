'use client';

import type { LucideIcon } from 'lucide-react';
import { Card } from '../ui';

/** Tarjeta de metodología usada al pie de las vistas de CxC. */
export function MethodCard({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <Card className="flex items-start gap-space-sm p-space-md">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-fixed text-primary">
        <Icon aria-hidden className="size-4" />
      </span>
      <div>
        <p className="font-semibold text-primary">{title}</p>
        <p className="text-label-sm normal-case text-on-surface-variant">{text}</p>
      </div>
    </Card>
  );
}
