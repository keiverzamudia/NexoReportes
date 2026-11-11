'use client';

// ============================================================
// Retiros de simulación — pantalla hermana de la bandeja y del historial.
//
// Muestra los pedidos que salieron del plan de una hoja de despacho antes de
// cargarse, agrupados por pedido: qué se retiró, por qué motivo, quién lo
// registró y en qué despachos. Es solo lectura y nunca escribe en Profit.
// La controla `despacho:view_removals`; por defecto solo la tiene ADMIN.
// ============================================================

import type { DispatchRemovalOrder, DispatchRemovalsResponse } from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, PackageX, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DespachoAccessDenied } from '../../../components/DespachoAccessDenied';
import { DespachoSubNav } from '../../../components/DespachoSubNav';
import { BriefStat } from '../../../components/DispatchBriefParts';
import { removalReasonLabel } from '../../../components/DispatchSheetParts';
import { AppNav, LoginScreen } from '../../../components/shell';
import { Badge, Card, EmptyState, PageHeader, Select, Skeleton, TextInput } from '../../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../../lib/api';
import { formatDateTime, formatNumber, relativeTime } from '../../../lib/dispatch-sheet';
import { hasPermission } from '../../../lib/permissions';

type Preset = '7d' | '30d' | '90d' | '12m' | 'custom';
type Tone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: '12m', label: 'Últimos 12 meses' },
  { value: 'custom', label: 'Personalizado' },
];

const REASON_OPTIONS = [
  { value: '', label: 'Motivo: Todos' },
  { value: 'PEDIDO_CERRADO_EN_PROFIT', label: 'Cerrado en Profit' },
  { value: 'PEDIDO_ANULADO_EN_PROFIT', label: 'Anulado en Profit' },
  { value: 'RETIRADO_DEL_PLAN', label: 'Retirado en Pedidos' },
];

const REASON_META: Record<string, { label: string; tone: Tone }> = {
  PEDIDO_CERRADO_EN_PROFIT: { label: 'Cerrado en Profit', tone: 'primary' },
  PEDIDO_ANULADO_EN_PROFIT: { label: 'Anulado en Profit', tone: 'danger' },
  RETIRADO_DEL_PLAN: { label: 'Retirado en Pedidos', tone: 'muted' },
};

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rangeForPreset(preset: Preset): { from: string; to: string } {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  switch (preset) {
    case '7d':
      start.setDate(start.getDate() - 6);
      break;
    case '90d':
      start.setDate(start.getDate() - 89);
      break;
    case '12m':
      start.setMonth(start.getMonth() - 11, 1);
      break;
    case '30d':
    default:
      start.setDate(start.getDate() - 29);
      break;
  }
  return { from: isoDate(start), to: isoDate(end) };
}

function reasonMeta(reason: string | null): { label: string; tone: Tone } {
  if (reason && REASON_META[reason]) return REASON_META[reason]!;
  return { label: removalReasonLabel(reason), tone: 'muted' };
}

export default function DispatchRemovalsPage() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState(() => rangeForPreset('30d'));
  const [preset, setPreset] = useState<Preset>('30d');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');

  const { data: sessionUser, isLoading: sessionLoading } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const permissions = sessionUser?.permissions;
  const canOpenDespacho = hasPermission(permissions, 'despacho', 'read');
  const canSeeRemovals = canOpenDespacho && hasPermission(permissions, 'despacho', 'view_removals');

  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (reason) params.set('reason', reason);
  if (q.trim()) params.set('q', q.trim());

  const { data, isLoading, error, dataUpdatedAt, isFetching } = useQuery<DispatchRemovalsResponse>({
    queryKey: ['dispatch-removals', range.from, range.to, reason, q],
    queryFn: () => apiFetch<DispatchRemovalsResponse>(`/dispatch-sheets/removals?${params.toString()}`),
    enabled: canSeeRemovals,
    refetchInterval: 60_000,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const totals = data?.totals;

  if (sessionLoading) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
          <Skeleton className="h-10 w-64 rounded-pill" />
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-96 rounded-card" />
        </main>
      </>
    );
  }

  if (!sessionUser || error instanceof AuthRequiredError) {
    return (
      <LoginScreen
        onSuccess={(user) => {
          queryClient.setQueryData(['me'], user);
          void queryClient.invalidateQueries({ queryKey: ['me'] });
        }}
      />
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Almacén · Despacho"
          icon={PackageX}
          title="Retiros de simulación"
          subtitle="Pedidos que salieron del plan antes de cargarse. Se agrupan por pedido para ver el motivo, el autor y los despachos donde se retiraron."
        />

        <DespachoSubNav permissions={permissions} />

        {!canSeeRemovals ? (
          <DespachoAccessDenied
            title="Retiros restringidos"
            description="No tienes el permiso «Ver retiros de simulación» del módulo Despacho. Pídeselo a un administrador desde Usuarios → Roles."
          />
        ) : (
          <>
            <Card className="overflow-hidden">
              <dl className="grid grid-cols-2 gap-px bg-outline-variant/25 lg:grid-cols-4">
                <BriefStat
                  className="bg-surface-container-lowest"
                  label="Pedidos"
                  value={formatNumber(totals?.orders ?? 0)}
                  hint="con retiros en el período"
                />
                <BriefStat
                  className="bg-surface-container-lowest"
                  label="Renglones"
                  value={formatNumber(totals?.lines ?? 0)}
                  hint="retirados del plan"
                />
                <BriefStat
                  className="bg-surface-container-lowest"
                  label="Volumen"
                  value={`${formatNumber(totals?.plannedKg ?? 0)} kg`}
                  hint="planificados"
                />
                <div className="flex flex-col justify-center gap-1 bg-surface-container-lowest px-space-sm py-space-sm sm:px-space-md">
                  <span className="text-label-sm font-semibold uppercase tracking-[0.12em] text-outline">Motivos</span>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(totals?.byReason ?? {})
                      .filter(([, count]) => count > 0)
                      .map(([key, count]) => {
                        const meta = reasonMeta(key);
                        return (
                          <Badge key={key} tone={meta.tone}>
                            {meta.label}: {formatNumber(count)}
                          </Badge>
                        );
                      })}
                    {Object.values(totals?.byReason ?? {}).every((count) => count === 0) && (
                      <span className="text-label-sm text-on-surface-variant">—</span>
                    )}
                  </div>
                </div>
              </dl>
            </Card>

            <Card className="flex flex-col">
              <div className="flex flex-wrap items-end justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
                <div className="flex flex-wrap items-center gap-space-sm">
                  <Select
                    className="w-44"
                    value={preset}
                    onChange={(value) => {
                      const next = value as Preset;
                      setPreset(next);
                      if (next !== 'custom') setRange(rangeForPreset(next));
                    }}
                    options={PRESETS}
                    ariaLabel="Período de retiros"
                  />
                  <label className="flex items-center gap-1 text-label-sm text-on-surface-variant">
                    Desde
                    <input
                      type="date"
                      value={range.from}
                      max={range.to}
                      onChange={(event) => {
                        setPreset('custom');
                        setRange((current) => ({ ...current, from: event.target.value }));
                      }}
                      className="h-9 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-label-sm text-on-surface-variant">
                    Hasta
                    <input
                      type="date"
                      value={range.to}
                      min={range.from}
                      onChange={(event) => {
                        setPreset('custom');
                        setRange((current) => ({ ...current, to: event.target.value }));
                      }}
                      className="h-9 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md"
                    />
                  </label>
                  <Select className="w-52" value={reason} onChange={setReason} options={REASON_OPTIONS} ariaLabel="Motivo del retiro" />
                  <TextInput className="w-56" icon={Search} value={q} onChange={setQ} placeholder="Pedido, producto o cliente…" ariaLabel="Buscar retiro" />
                </div>
                <div className="flex items-center gap-space-sm">
                  {isFetching && <RefreshCw aria-hidden className="size-3.5 animate-spin text-outline" />}
                  <span className="text-label-sm normal-case text-on-surface-variant">
                    {dataUpdatedAt ? `actualizado ${relativeTime(new Date(dataUpdatedAt).toISOString())}` : 'sincronizando…'}
                  </span>
                  <Badge tone={reason || q ? 'primary' : 'muted'} dot>
                    {orders.length} pedido{orders.length === 1 ? '' : 's'}
                  </Badge>
                </div>
              </div>

              {isLoading ? (
                <div className="flex flex-col gap-space-sm p-space-md">
                  <Skeleton className="h-20 rounded-xl" />
                  <Skeleton className="h-20 rounded-xl" />
                  <Skeleton className="h-20 rounded-xl" />
                </div>
              ) : orders.length === 0 ? (
                <EmptyState
                  icon={PackageX}
                  title="Sin retiros en el período"
                  description={
                    reason || q
                      ? 'Prueba con otro motivo, otra fecha o limpia la búsqueda.'
                      : 'Cuando un pedido salga del plan por un cierre de Profit o un ajuste en Pedidos, aparecerá aquí.'
                  }
                />
              ) : (
                <div className="divide-y divide-outline-variant/25">
                  {orders.map((order) => (
                    <RemovalOrderRow key={`${order.orderNumber}-${order.removedAt ?? ''}`} order={order} />
                  ))}
                </div>
              )}
            </Card>

            {error && (
              <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
                <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'No se pudieron consultar los retiros'}
              </p>
            )}

            <Card className="p-space-md">
              <p className="font-semibold text-on-surface">Qué significa cada motivo</p>
              <ul className="mt-space-xs grid gap-1 text-label-md normal-case text-on-surface-variant">
                <li>
                  <span className="font-semibold text-primary">Cerrado en Profit:</span> el pedido pasó a nota de entrega/facturado en
                  Profit. El renglón sale del plan y no cuenta en totales ni tiempos.
                </li>
                <li>
                  <span className="font-semibold text-error">Anulado en Profit:</span> el pedido fue anulado en Profit.
                </li>
                <li>
                  <span className="font-semibold text-on-surface">Retirado en Pedidos:</span> un usuario lo quitó manualmente del plan.
                </li>
              </ul>
              <p className="mt-space-xs text-label-sm normal-case text-outline">
                Esta pantalla es solo lectura: no modifica el despacho ni escribe en Profit.
              </p>
            </Card>
          </>
        )}
      </main>
    </>
  );
}

function RemovalOrderRow({ order }: { order: DispatchRemovalOrder }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-space-sm px-space-md py-space-sm marker:content-none">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-space-xs gap-y-1">
            <span className="font-bold tabular-nums text-primary">{order.orderNumber || 'Sin pedido'}</span>
            <span className="text-on-surface-variant">·</span>
            <span className="truncate font-semibold text-on-surface">{order.customerName ?? 'Cliente sin nombre'}</span>
          </p>
          <p className="text-label-sm tabular-nums text-on-surface-variant">
            {order.linesCount} renglón(es) · {formatNumber(order.plannedKg)} kg · {order.sheets.length} despacho(s)
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {order.reasons.map((value) => {
              const meta = reasonMeta(value);
              return (
                <Badge key={value} tone={meta.tone}>
                  {meta.label}
                </Badge>
              );
            })}
            {order.sheets.map((sheet) => (
              <span key={sheet.id} className="rounded-pill bg-surface-container-high px-2 py-0.5 text-label-sm tabular-nums text-on-surface-variant">
                {sheet.number}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-space-sm text-right">
          <div>
            <p className="text-label-md font-semibold tabular-nums text-on-surface">{formatDateTime(order.removedAt)}</p>
            <p className="text-label-sm text-outline">{order.removedByNames.join(' · ') || 'Sistema'}</p>
          </div>
          <ChevronDown aria-hidden className="size-4 text-outline transition-transform group-open:rotate-180" />
        </div>
      </summary>

      <div className="border-t border-outline-variant/25 bg-surface-container-low/40 px-space-md py-space-sm">
        <ul className="divide-y divide-outline-variant/20">
          {order.lines.map((line) => {
            const meta = reasonMeta(line.removalReason);
            return (
              <li key={line.id} className="flex flex-wrap items-center justify-between gap-space-xs py-1.5 text-label-md">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-space-xs gap-y-1">
                    <span className="font-semibold text-on-surface-variant">{line.productCode}</span>
                    <span className="text-on-surface">· {line.description ?? '—'}</span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </p>
                  <p className="text-label-sm text-outline">
                    <Link href={`/despacho/${line.sheetId}`} className="font-semibold text-primary hover:underline">
                      {line.sheetNumber}
                    </Link>
                    {' · '}
                    {formatDateTime(line.removedAt)} · {line.removedByName ?? 'Sistema'}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-on-surface-variant">
                  {formatNumber(line.plannedQty)} {line.uom ?? '—'} · {formatNumber(line.plannedKg)} kg
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
