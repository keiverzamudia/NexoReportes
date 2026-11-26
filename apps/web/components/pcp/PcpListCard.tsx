'use client';

// ============================================================
// Tarjeta de la bandeja PCP para el teléfono.
//
// La tabla genérica apila columnas; aquí se arma una ficha por cliente:
// nombre protagonista, fecha en lenguaje humano («jue 22 oct», «Hoy»,
// «Atrasado 3 días»), pedidos, kilos y fotos, y las acciones a un toque.
// ============================================================

import type { RomanaArrivalSummary } from '@nexo/contracts';
import {
  CalendarDays,
  Camera,
  ChevronRight,
  Clock,
  DoorOpen,
  ListOrdered,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { ArrivalStatusBadge } from '../ArrivalParts';
import { Badge, cx } from '../ui';
import {
  businessDateHint,
  businessDateLabel,
  clockLabel,
  minutesOnSite,
} from '../../lib/arrival';
import { formatNumber } from '../../lib/dispatch-sheet';
import { formatBytes, romanaProgress, romanaStatusMeta } from '../../lib/romana';

export function PcpListCard({
  arrival,
  onCheckIn,
  onRomana,
  onValidate,
}: {
  arrival: RomanaArrivalSummary;
  onCheckIn: () => void;
  onRomana: () => void;
  onValidate: () => void;
}) {
  const meta = romanaStatusMeta(arrival.romana.status);
  const progress = romanaProgress(arrival);
  const onSite = minutesOnSite(arrival.arrivedAt);
  const dateHint = businessDateHint(arrival.expectedDate);
  const overdue = Boolean(dateHint?.startsWith('Atrasado'));
  const noDocs = arrival.romana.requiredDocs === 0;
  const hasActions = arrival.canCheckIn || arrival.romana.canCheckIn || arrival.romana.canValidate;

  return (
    <article className="overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-soft">
      <div className="p-space-md">
        <Link href={`/pcp/${arrival.id}`} className="group flex items-start gap-space-sm">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-display text-headline-md leading-[1.15] text-primary group-hover:underline group-hover:decoration-primary/40 group-hover:underline-offset-4">
              {arrival.customerName}
            </h3>
            <p className="mt-1 truncate text-label-sm normal-case text-on-surface-variant">
              {arrival.customerCode} · {arrival.sheetNumber} · {arrival.number}
            </p>
          </div>
          <ChevronRight
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-outline transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
          />
        </Link>

        <div className="mt-space-sm flex flex-wrap items-center gap-space-xs">
          <Badge tone={noDocs ? 'muted' : meta.tone} dot>
            {noDocs ? 'Sin documentos' : meta.short}
          </Badge>
          <ArrivalStatusBadge status={arrival.status} />
          {arrival.openIncidentCount > 0 && (
            <Badge tone="warning" dot>
              {arrival.openIncidentCount} incidencia(s)
            </Badge>
          )}
        </div>

        {/* La fecha, legible y con su contexto (hoy / mañana / atrasada). */}
        <div className="mt-space-sm flex items-center gap-space-sm rounded-xl border border-outline-variant/30 bg-surface-container-low/60 px-space-sm py-space-xs">
          <span
            className={cx(
              'grid size-9 shrink-0 place-items-center rounded-full',
              overdue
                ? 'bg-critical-container text-on-critical-container'
                : 'bg-primary-fixed text-primary',
            )}
          >
            {arrival.arrivedAt ? (
              <Clock aria-hidden className="size-4" />
            ) : (
              <CalendarDays aria-hidden className="size-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">
              {arrival.arrivedAt ? 'Llegó' : 'Llegada'}
            </p>
            <p className="truncate font-bold tabular-nums text-body-lg text-primary">
              {arrival.arrivedAt ? clockLabel(arrival.arrivedAt) : businessDateLabel(arrival.expectedDate)}
            </p>
            {arrival.arrivedAt ? (
              <p className="truncate text-label-sm font-semibold text-on-surface-variant">
                {onSite !== null && onSite > 0 ? `${onSite} min en planta` : 'En planta'}
              </p>
            ) : dateHint ? (
              <p
                className={cx(
                  'truncate text-label-sm font-semibold',
                  overdue ? 'text-critical' : dateHint === 'Hoy' ? 'text-primary' : 'text-on-surface-variant',
                )}
              >
                {dateHint}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-space-sm grid grid-cols-2 gap-space-sm">
          <div className="rounded-xl bg-surface-container-low/60 px-space-sm py-space-xs">
            <p className="flex items-center gap-space-2xs text-label-sm font-semibold uppercase tracking-wider text-outline">
              <Scale aria-hidden className="size-3.5" /> Kg
            </p>
            <p className="font-display text-headline-md leading-none tabular-nums text-primary">
              {formatNumber(arrival.plannedKg)}
            </p>
          </div>
          <div className="rounded-xl bg-surface-container-low/60 px-space-sm py-space-xs">
            <p className="flex items-center gap-space-2xs text-label-sm font-semibold uppercase tracking-wider text-outline">
              <Camera aria-hidden className="size-3.5" /> Fotos
            </p>
            {noDocs ? (
              <p className="text-body-md font-semibold text-on-surface-variant">No exige</p>
            ) : (
              <p className="font-display text-headline-md leading-none tabular-nums text-primary">
                {progress.uploaded}
                <span className="text-on-surface-variant/60">/{progress.required}</span>
              </p>
            )}
          </div>
        </div>

        <div className="mt-space-sm flex items-start gap-space-xs">
          <ListOrdered aria-hidden className="mt-0.5 size-4 shrink-0 text-outline" />
          <div className="min-w-0">
            <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Pedidos</p>
            <p className="break-words text-body-md text-on-surface">
              {arrival.orderNumbers.length > 0 ? arrival.orderNumbers.join(' · ') : '—'}
            </p>
          </div>
        </div>

        {noDocs ? (
          <p className="mt-space-xs text-label-sm normal-case text-on-surface-variant">
            Llegada anterior a Romana: no exige cédula ni carnet.
          </p>
        ) : progress.pending > 0 ? (
          <p className="mt-space-xs text-label-sm normal-case text-on-surface-variant">
            Faltan {progress.pending} foto(s)
            {arrival.romana.totalBytes > 0 ? ` · ${formatBytes(arrival.romana.totalBytes)}` : ''}
          </p>
        ) : (
          <p className="mt-space-xs text-label-sm normal-case text-on-success-container">
            Fotos completas · {formatBytes(arrival.romana.totalBytes)}
          </p>
        )}
      </div>

      {hasActions && (
        <div className="flex flex-wrap items-center gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/40 px-space-md py-space-sm">
          {arrival.canCheckIn && (
            <button
              type="button"
              onClick={onCheckIn}
              className="inline-flex h-10 min-w-[10rem] flex-1 items-center justify-center gap-space-xs rounded-pill bg-secondary-container px-space-md font-semibold text-label-md text-on-secondary shadow-soft transition-transform active:scale-[0.99]"
            >
              <DoorOpen aria-hidden className="size-4" /> Marcar llegada
            </button>
          )}
          {arrival.romana.canCheckIn && (
            <button
              type="button"
              onClick={onRomana}
              className="inline-flex h-10 flex-1 items-center justify-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-primary transition-colors active:bg-surface-container-low"
            >
              <Scale aria-hidden className="size-4" /> Romana
            </button>
          )}
          {arrival.romana.canValidate && (
            <button
              type="button"
              onClick={onValidate}
              className="inline-flex h-10 min-w-[10rem] flex-1 items-center justify-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-label-md text-on-primary shadow-soft transition-transform active:scale-[0.99]"
            >
              <ShieldCheck aria-hidden className="size-4" /> Validar y borrar fotos
            </button>
          )}
        </div>
      )}
    </article>
  );
}
