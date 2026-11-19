'use client';

import type { Customer, ForecastSellerClientDetailResponse } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Package,
  Receipt,
  RefreshCw,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { AuthRequiredError, apiFetch } from '../../lib/api';
import { fmtKg, monthLabel } from '../../lib/sales-report';
import {
  contextSummary,
  contextViewLabel,
  notesInView,
  productInView,
  sellerPathCode,
  type SellerClientContext,
} from '../../lib/seller-context';
import { Badge, EmptyState, Skeleton, cx, fmtDate, fmtQty } from '../ui';

// ============================================================
// Ficha contextual del cliente dentro del expediente de vendedor.
//
// En vez de abrir la ficha 360 genérica, muestra exactamente las notas del
// cliente en el mes y la pestaña que se está viendo. La ficha completa sigue
// a un botón. Los kg y las notas salen del API con los mismos filtros del
// informe, así que cuadran con la fila clicada.
// ============================================================

export function SellerClientContextPanel({
  context,
  customer,
  onShowFull,
}: {
  context: SellerClientContext;
  customer: Customer;
  onShowFull: () => void;
}) {
  const { data, error, isPending, isFetching, refetch } =
    useQuery<ForecastSellerClientDetailResponse>({
      queryKey: [
        'seller-client-detail',
        context.sellerCode,
        context.clientCode,
        context.year,
        context.month,
        context.basis,
        context.includeToday,
        context.attribution,
        context.productCode ?? null,
      ],
      queryFn: () => {
        const params = new URLSearchParams({
          year: String(context.year),
          month: String(context.month),
          basis: context.basis,
          includeToday: context.includeToday ? 'true' : 'false',
          attribution: context.attribution,
        });
        if (context.productCode) params.set('productCode', context.productCode);
        return apiFetch<ForecastSellerClientDetailResponse>(
          `/forecast/sellers/${encodeURIComponent(sellerPathCode(context.sellerCode))}/clients/${encodeURIComponent(
            context.clientCode,
          )}/detail?${params.toString()}`,
        );
      },
      staleTime: 60_000,
      retry: 1,
    });

  const message =
    error instanceof AuthRequiredError
      ? 'Tu sesión expiró. Cierra la ficha y vuelve a iniciar sesión.'
      : error instanceof Error
        ? error.message
        : 'No se pudo consultar el detalle del cliente.';

  const summary = data ? contextSummary(data, context.view) : null;
  const notes = data ? notesInView(data.notes, context) : [];
  const products = data
    ? data.products
        .map((product) => ({ ...product, view: productInView(product, context.view) }))
        .filter((product) => product.view.kg > 0 || product.view.notes > 0)
        .sort((a, b) => b.view.kg - a.view.kg)
    : [];

  const viewLabel = contextViewLabel(context.view);
  const month = monthLabel(context.year, context.month);
  const sellerName = data?.sellerName || context.sellerName;
  const clientName = data?.clientName || customer.name;

  return (
    <div className="flex flex-col gap-space-md">
      <section className="rounded-card border border-outline-variant/35 bg-surface-container-lowest p-space-md shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-space-sm">
          <div className="min-w-0">
            <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
              Contexto del expediente
            </p>
            <p className="text-title-md font-bold text-on-surface">
              {sellerName} · {month}
            </p>
            <div className="mt-space-2xs flex flex-wrap items-center gap-1.5">
              <Badge tone="primary">{viewLabel}</Badge>
              <Badge tone="muted">
                {context.attribution === 'PORTFOLIO' ? 'Cuota sobre cartera' : 'Cuota sobre facturado'}
              </Badge>
              {context.includeToday && <Badge tone="muted">Incluye hoy</Badge>}
              {context.productLabel && <Badge tone="warning">Producto: {context.productLabel}</Badge>}
              {data && (
                <Badge tone={data.source === 'fixtures' ? 'warning' : 'success'} dot>
                  {data.source === 'fixtures' ? 'Datos de desarrollo' : 'Profit en vivo'}
                </Badge>
              )}
            </div>
            <p className="mt-space-2xs max-w-2xl text-label-md text-on-surface-variant">
              Notas de {clientName} en {month}. Esta vista muestra lo que compone la fila del
              expediente; no es la ficha 360 completa.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-space-2xs">
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label="Actualizar detalle"
              title="Actualizar detalle"
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-outline-variant/50 px-space-sm text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary disabled:opacity-50"
            >
              <RefreshCw aria-hidden className={cx('size-4', isFetching && 'animate-spin')} />
              Actualizar
            </button>
            <button
              type="button"
              onClick={onShowFull}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary-container px-space-sm text-label-md font-semibold text-on-primary transition-transform hover:-translate-y-0.5"
            >
              <BarChart3 aria-hidden className="size-4" />
              Ver ficha 360 completa
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex flex-col items-center gap-space-sm rounded-xl border border-critical/40 bg-critical-container/30 p-space-lg text-center">
          <AlertTriangle aria-hidden className="size-6 text-error" />
          <p className="font-semibold text-title-md text-on-surface">No se pudo consultar el detalle</p>
          <p className="max-w-md text-body-md text-on-surface-variant">{message}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-space-xs inline-flex h-9 items-center gap-1 rounded-pill bg-primary-container px-space-lg text-label-md font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
          >
            <RefreshCw aria-hidden className="size-4" /> Reintentar
          </button>
        </div>
      )}

      {isPending && !data ? (
        <>
          <div className="grid gap-space-sm sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </>
      ) : data && summary ? (
        !data.available ? (
          <p
            role="alert"
            className="flex items-start gap-space-sm rounded-xl border border-warning/40 bg-warning-container/40 px-space-md py-space-sm text-label-md text-on-warning-container"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            Profit no devolvió las notas de este mes. No se muestran ceros como si fueran ventas.
          </p>
        ) : (
        <>
          <div className="grid gap-space-sm sm:grid-cols-2 xl:grid-cols-4">
            {context.view === 'facturado' ? (
              <>
                <ContextMetric
                  label="Firmado por él"
                  value={`${fmtKg(summary.viewKg)} kg`}
                  hint={`${fmtQty(summary.viewNotes, 0)} ${summary.viewNotes === 1 ? 'nota' : 'notas'} del mes`}
                  icon={Receipt}
                  tone="primary"
                />
                <ContextMetric
                  label="Notas"
                  value={fmtQty(summary.viewNotes, 0)}
                  hint="Solo las firmadas por este vendedor"
                  icon={Receipt}
                  tone="primary"
                />
                <ContextMetric
                  label="Otros vendedores"
                  value={
                    summary.allKg > summary.ownKg
                      ? `${fmtKg(summary.allKg - summary.ownKg)} kg`
                      : '—'
                  }
                  hint="Notas de otros vendedores al mismo cliente"
                  icon={Users}
                  tone="muted"
                />
                <ContextMetric
                  label="Última nota"
                  value={fmtDate(summary.lastInvoiceDate)}
                  hint="Dentro del mes consultado"
                  icon={CalendarClock}
                  tone="primary"
                />
              </>
            ) : context.view === 'otros' ? (
              <>
                <ContextMetric
                  label="Facturado por otros"
                  value={`${fmtKg(summary.viewKg)} kg`}
                  hint={`${fmtQty(summary.viewNotes, 0)} ${summary.viewNotes === 1 ? 'nota' : 'notas'} del mes`}
                  icon={Package}
                  tone="warning"
                />
                <ContextMetric
                  label="Vendedores reales"
                  value={`${fmtKg(summary.otherExternalKg)} kg`}
                  hint="La fuga accionable de su cartera"
                  icon={Users}
                  tone="warning"
                />
                <ContextMetric
                  label="Cuenta interna"
                  value={`${fmtKg(summary.otherInternalKg)} kg`}
                  hint="001 / 004: no es un vendedor real"
                  icon={Package}
                  tone="muted"
                />
                <ContextMetric
                  label="Última nota"
                  value={fmtDate(summary.lastInvoiceDate)}
                  hint="Dentro del mes consultado"
                  icon={CalendarClock}
                  tone="primary"
                />
              </>
            ) : (
              <>
                <ContextMetric
                  label="Venta de su cartera"
                  value={`${fmtKg(summary.viewKg)} kg`}
                  hint={`${fmtQty(summary.viewNotes, 0)} ${summary.viewNotes === 1 ? 'nota' : 'notas'} del cliente`}
                  icon={Users}
                  tone="primary"
                />
                <ContextMetric
                  label="Firmado por él"
                  value={`${fmtKg(summary.ownKg)} kg`}
                  hint={`${fmtQty(summary.ownNotes, 0)} ${summary.ownNotes === 1 ? 'nota' : 'notas'}`}
                  icon={Receipt}
                  tone="success"
                />
                <ContextMetric
                  label="Otros vendedores"
                  value={`${fmtKg(summary.otherKg)} kg`}
                  hint={`${fmtQty(summary.otherNotes, 0)} ${summary.otherNotes === 1 ? 'nota' : 'notas'} de su cartera`}
                  icon={Package}
                  tone="warning"
                />
                <ContextMetric
                  label="Última nota"
                  value={fmtDate(summary.lastInvoiceDate)}
                  hint="Dentro del mes consultado"
                  icon={CalendarClock}
                  tone="primary"
                />
              </>
            )}
          </div>

          <div className="grid gap-space-md lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <section className="overflow-hidden rounded-xl border border-outline-variant/35 bg-surface-container-lowest">
              <header className="flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-container px-space-md py-space-sm">
                <h3 className="flex items-center gap-1.5 text-title-md font-bold text-on-surface">
                  <Receipt aria-hidden className="size-4 text-primary" />
                  Notas de la vista
                </h3>
                <Badge tone="muted">
                  {fmtQty(notes.length, 0)} {notes.length === 1 ? 'nota' : 'notas'}
                </Badge>
              </header>
              {notes.length === 0 ? (
                <div className="p-space-md">
                  <EmptyState
                    icon={Receipt}
                    title="Sin notas para este filtro"
                    description="El cliente no tiene notas del mes que correspondan a esta pestaña."
                  />
                </div>
              ) : (
                <div className="max-h-[46vh] overflow-x-auto overflow-y-auto">
                  <table className="w-full min-w-[34rem] border-collapse text-label-md">
                    <caption className="sr-only">
                      Notas de {clientName} en {month}
                    </caption>
                    <thead className="sticky top-0 z-[1] bg-surface-container-lowest">
                      <tr className="text-label-sm uppercase tracking-[0.1em] text-outline">
                        <th scope="col" className="px-space-md py-2 text-left font-semibold">Fecha</th>
                        <th scope="col" className="px-2 py-2 text-left font-semibold">Nota</th>
                        <th scope="col" className="px-2 py-2 text-left font-semibold">Vendedor</th>
                        <th scope="col" className="px-space-md py-2 text-right font-semibold">Kg</th>
                        <th scope="col" className="px-space-md py-2 text-right font-semibold">Líneas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/20">
                      {notes.map((note) => (
                        <tr key={`${note.number}-${note.noteSellerCode}`} className="align-top">
                          <td className="whitespace-nowrap px-space-md py-2 text-on-surface-variant">
                            {fmtDate(note.date)}
                          </td>
                          <td className="px-2 py-2 tabular-nums text-on-surface">{note.number}</td>
                          <td className="px-2 py-2">
                            {note.noteSellerCode === context.sellerCode ? (
                              <Badge tone="success">Tú</Badge>
                            ) : (
                              <span className="inline-flex flex-wrap items-center gap-1.5">
                                <span className="text-on-surface">{note.noteSellerName}</span>
                                {note.noteSellerInternal && <Badge tone="muted">Interna</Badge>}
                              </span>
                            )}
                          </td>
                          <td className="px-space-md py-2 text-right tabular-nums font-semibold text-on-surface">
                            {fmtKg(note.kg)}
                          </td>
                          <td className="px-space-md py-2 text-right tabular-nums text-on-surface-variant">
                            {fmtQty(note.lines, 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-surface-container bg-surface-container-low/50 font-semibold text-on-surface">
                        <td colSpan={3} className="px-space-md py-2">
                          Total de la vista
                        </td>
                        <td className="px-space-md py-2 text-right tabular-nums">{fmtKg(summary.viewKg)}</td>
                        <td className="px-space-md py-2 text-right tabular-nums text-label-sm text-on-surface-variant">
                          {fmtQty(summary.viewNotes, 0)} notas
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-xl border border-outline-variant/35 bg-surface-container-lowest">
              <header className="flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-container px-space-md py-space-sm">
                <h3 className="flex items-center gap-1.5 text-title-md font-bold text-on-surface">
                  <Package aria-hidden className="size-4 text-primary" />
                  Productos de la vista
                </h3>
                <Badge tone="muted">
                  {fmtQty(products.length, 0)} {products.length === 1 ? 'producto' : 'productos'}
                </Badge>
              </header>
              {!data.productsAvailable ? (
                <p className="px-space-md py-space-sm text-label-md text-on-surface-variant">
                  No se pudieron leer los productos; las notas siguen disponibles.
                </p>
              ) : products.length === 0 ? (
                <div className="p-space-md">
                  <EmptyState
                    icon={Package}
                    title="Sin productos para este filtro"
                    description="El cliente no tiene artículos en las notas de esta pestaña."
                  />
                </div>
              ) : (
                <ul className="max-h-[46vh] divide-y divide-outline-variant/20 overflow-y-auto">
                  {products.map((product) => (
                    <li
                      key={product.productCode}
                      className="flex items-center justify-between gap-space-sm px-space-md py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-on-surface" title={product.description}>
                          {product.description}
                        </p>
                        <p className="text-label-sm text-outline">
                          <span className="tabular-nums">{product.productCode}</span>
                          {product.uom ? ` · ${product.uom}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular-nums font-semibold text-on-surface">
                          {fmtKg(product.view.kg)} kg
                        </p>
                        <p className="text-label-sm text-outline">
                          {fmtQty(product.view.notes, 0)} {product.view.notes === 1 ? 'nota' : 'notas'}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <p className="text-label-sm text-on-surface-variant">
            Solo lectura desde Profit. Los kg y las notas cuadran con la fila del expediente del
            vendedor.
          </p>
        </>
        )
      ) : null}
    </div>
  );
}

function ContextMetric({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'primary',
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone?: 'primary' | 'success' | 'warning' | 'muted';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-secondary'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'muted'
          ? 'text-on-surface-variant'
          : 'text-primary';
  return (
    <div className="rounded-xl border border-outline-variant/35 bg-surface-container-lowest p-space-sm shadow-soft">
      <div className="flex items-start justify-between gap-space-xs">
        <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">{label}</p>
        <Icon aria-hidden className="size-4 shrink-0 text-outline" />
      </div>
      <p className={cx('mt-1 font-display text-title-md font-black tabular-nums', toneClass)}>
        {value}
      </p>
      <p className="text-label-sm text-on-surface-variant">{hint}</p>
    </div>
  );
}
