'use client';

// ============================================================
// Detalle del despacho: donde el almacén trabaja y el planificador sigue.
//
//   · Cinta de acuses (el túnel hecho visible).
//   · Carga renglón por renglón, agrupada por cliente, con guardado inmediato
//     (la respuesta del API trae el detalle completo y se escribe en caché).
//   · Bitácora de dos vías: eventos de sistema + mensajes libres.
//
// Al abrir, el almacén deja el acuse «recibido» (una sola vez) y eso notifica
// al planificador. Nada de esto escribe en Profit.
// ============================================================

import type { DispatchLineStatus, DispatchSheetDetail, DispatchSheetLine } from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCheck,
  ClipboardCheck,
  Download,
  Loader2,
  MessageSquare,
  Send,
  StickyNote,
  Truck,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AcuseTimeline, EventTimeline, LineStatusBadge, SheetStatusBadge } from '../../../components/DispatchSheetParts';
import { AppNav, LoginScreen } from '../../../components/shell';
import { Badge, Card, EmptyState, PageHeader, Skeleton, cx } from '../../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../../lib/api';
import {
  computeTotals,
  formatBusinessDate,
  formatDateTime,
  formatNumber,
  formatTime,
  groupByCustomer,
  lineStatusFrom,
  relativeTime,
  sheetExport,
} from '../../../lib/dispatch-sheet';

const QUICK_ACTIONS: { label: string; status: DispatchLineStatus; ratio: number; tone: string }[] = [
  { label: 'Completo', status: 'CARGADO', ratio: 1, tone: 'bg-secondary-container text-on-secondary' },
  { label: 'Faltante', status: 'FALTANTE', ratio: 0, tone: 'border border-critical/40 text-error' },
];

export default function DispatchSheetPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const queryClient = useQueryClient();
  const ackSent = useRef(false);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [savingLine, setSavingLine] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeNote, setCompleteNote] = useState('');

  const { data: sessionUser } = useQuery({ queryKey: ['me'], queryFn: currentUser, staleTime: 60_000, retry: false });

  const { data: sheet, isLoading, error } = useQuery<DispatchSheetDetail>({
    queryKey: ['dispatch-sheet', id],
    queryFn: () => apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${id}`),
    enabled: Boolean(id),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const closed = sheet ? sheet.status === 'DESPACHADO' || sheet.status === 'CANCELADO' : false;
  const editable = Boolean(sheet?.canOperate) && !closed;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Acuse automático al abrir: el planificador se entera de que el almacén lo vio.
  useEffect(() => {
    if (!sheet || ackSent.current) return;
    if (!sheet.canOperate || sheet.status !== 'ENVIADO') return;
    ackSent.current = true;
    apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/ack`, {
      method: 'POST',
      body: JSON.stringify({ event: 'RECIBIDO' }),
    })
      .then((updated) => {
        queryClient.setQueryData(['dispatch-sheet', sheet.id], updated);
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      })
      .catch(() => {
        ackSent.current = false;
      });
  }, [sheet, queryClient]);

  const totals = useMemo(() => (sheet ? computeTotals(sheet.lines) : null), [sheet]);
  const groups = useMemo(() => (sheet ? groupByCustomer(sheet.lines) : []), [sheet]);
  const pendingLines = sheet?.lines.filter((line) => line.status === 'PENDIENTE').length ?? 0;

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => queryClient.invalidateQueries()} />;
  }

  function applyDetail(updated: DispatchSheetDetail) {
    queryClient.setQueryData(['dispatch-sheet', updated.id], updated);
    queryClient.invalidateQueries({ queryKey: ['dispatch-sheets'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function runAction(action: string, request: () => Promise<DispatchSheetDetail>, successMessage?: string) {
    setBusy(action);
    try {
      applyDetail(await request());
      if (successMessage) setToast(successMessage);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo completar la acción');
    } finally {
      setBusy(null);
    }
  }

  function ackInProgress() {
    if (!sheet) return;
    void runAction('start', () =>
      apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/ack`, {
        method: 'POST',
        body: JSON.stringify({ event: 'EN_PROCESO' }),
      }),
      'Despacho tomado. Ya puedes cargar.',
    );
  }

  async function saveLine(line: DispatchSheetLine, loadedQty: number, status?: DispatchLineStatus) {
    if (!sheet || !editable) return;
    const nextStatus = status ?? lineStatusFrom(loadedQty, line.plannedQty);
    setSavingLine(line.id);
    setDraft((current) => ({ ...current, [line.id]: String(loadedQty) }));
    try {
      const updated = await apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/lines/${line.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          loadedQty,
          status: nextStatus,
          note: notes[line.id]?.trim() || undefined,
        }),
      });
      applyDetail(updated);
      setNoteOpen(null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo guardar el renglón');
    } finally {
      setSavingLine(null);
    }
  }

  function saveNote(line: DispatchSheetLine, value: string) {
    const parsed = Number(value);
    const qty = line.loadedQty ?? (Number.isFinite(parsed) ? parsed : 0);
    void saveLine(line, Math.max(0, qty), line.status === 'PENDIENTE' ? undefined : line.status);
  }

  function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!sheet || !message.trim()) return;
    const body = message.trim();
    void runAction(
      'message',
      () =>
        apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        }),
      'Mensaje enviado.',
    ).then(() => setMessage(''));
  }

  async function exportSheet() {
    if (!sheet) return;
    const XLSX = await import('xlsx');
    const exported = sheetExport(sheet);
    const worksheet = XLSX.utils.aoa_to_sheet(exported.aoa);
    worksheet['!cols'] = exported.widths.map((wch) => ({ wch }));
    worksheet['!merges'] = exported.merges;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, exported.sheetName);
    XLSX.writeFile(workbook, `hoja-despacho-${sheet.number}.xlsx`, { compression: true });
  }

  if (isLoading) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
          <Skeleton className="h-28 rounded-card" />
          <div className="grid gap-space-md 2xl:grid-cols-12">
            <Skeleton className="h-96 rounded-card 2xl:col-span-8" />
            <Skeleton className="h-96 rounded-card 2xl:col-span-4" />
          </div>
        </main>
      </>
    );
  }

  if (!sheet) {
    return (
      <>
        <AppNav />
        <main className="mx-auto w-full max-w-[1680px] p-space-lg md:p-space-xl">
          <Card>
            <EmptyState
              icon={ClipboardCheck}
              title="Despacho no encontrado"
              description={error instanceof Error ? error.message : 'Puede que se haya anulado o que no tengas acceso.'}
              action={
                <Link href="/despacho" className="mt-space-sm inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low">
                  <ArrowLeft aria-hidden className="size-4" /> Volver al tablero
                </Link>
              }
            />
          </Card>
        </main>
      </>
    );
  }

  const isPlanner =
    ['PLANIFICADOR', 'GERENCIA', 'ADMIN'].includes(sessionUser?.baseRole ?? '') && !sheet.canOperate;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg pb-space-2xl md:p-space-xl">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <Link href="/despacho" className="inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low">
            <ArrowLeft aria-hidden className="size-4" /> Tablero de despacho
          </Link>
          <div className="flex flex-wrap items-center gap-space-xs">
            <button
              type="button"
              onClick={() => void exportSheet()}
              className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              <Download aria-hidden className="size-4" /> Hoja de despacho
            </button>
            {sheet.canCancel && (
              <button
                type="button"
                onClick={() => setCancelOpen(true)}
                className="flex h-9 items-center gap-space-xs rounded-pill border border-critical/40 px-space-md font-semibold text-body-md text-error transition-colors hover:bg-critical-container/40"
              >
                <Ban aria-hidden className="size-4" /> Anular
              </button>
            )}
          </div>
        </div>

        <PageHeader
          eyebrow={`Almacén · Despacho ${sheet.number}`}
          icon={Truck}
          title={sheet.title}
          subtitle={sheet.instructions ?? 'Sin instrucciones especiales.'}
          actions={<SheetStatusBadge status={sheet.status} />}
        />

        {/* Cinta de acuses: el túnel */}
        <Card className="p-space-md">
          <div className="mb-space-sm flex flex-wrap items-center justify-between gap-space-sm">
            <div>
              <p className="font-semibold text-primary">Acuse de recibo</p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                Publicado {formatDateTime(sheet.sentAt)} por {sheet.createdByName ?? '—'} · destino{' '}
                {sheet.assignedToName ?? 'todo el almacén'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-space-xs">
              {sheet.claimedByName && (
                <Badge tone="muted" dot>
                  tomado por {sheet.claimedByName}
                </Badge>
              )}
              {sheet.status === 'CON_NOVEDAD' && (
                <Badge tone="danger" dot>
                  diferencias reportadas
                </Badge>
              )}
            </div>
          </div>
          <AcuseTimeline sheet={sheet} />
        </Card>

        <div className="grid gap-space-md 2xl:grid-cols-12">
          {/* Cuerpo: carga por renglón */}
          <div className="flex flex-col gap-space-md 2xl:col-span-8">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/70 px-space-md py-space-sm">
                <div className="flex flex-wrap items-center gap-space-md">
                  <div>
                    <p className="font-bold uppercase tracking-wider text-label-md text-primary">
                      {editable ? 'Carga por renglón' : isPlanner ? 'Detalle del plan' : 'Detalle'}
                    </p>
                    <p className="text-label-sm normal-case text-on-surface-variant">
                      {editable
                        ? 'Digita lo que cargaste o usa Completo / Faltante. Cada marca se guarda al instante.'
                        : sheet.claimedByName && sheet.status !== 'DESPACHADO' && sheet.status !== 'CANCELADO'
                          ? `Lo tomó ${sheet.claimedByName}: puedes verlo, pero solo esa persona lo carga.`
                          : 'Solo lectura: el almacén confirma la carga real.'}
                    </p>
                  </div>
                </div>
                {totals && (
                  <div className="flex flex-wrap items-center gap-space-sm tabular-nums">
                    <span className="flex items-baseline gap-1">
                      <span className="text-data-tabular-lg font-bold text-primary">{formatNumber(totals.plannedSacks)}</span>
                      <span className="text-label-sm font-semibold text-outline">sacos</span>
                    </span>
                    <span aria-hidden className="text-outline-variant">
                      ·
                    </span>
                    <span className="flex items-baseline gap-1">
                      <span className="text-data-tabular-lg font-bold text-secondary">{formatNumber(totals.plannedKg)}</span>
                      <span className="text-label-sm font-semibold text-outline">kg</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Progreso */}
              {totals && (
                <div className="flex flex-wrap items-center gap-space-md border-b border-outline-variant/25 px-space-md py-space-sm">
                  <div className="min-w-[12rem] flex-1">
                    <div className="mb-1 flex items-center justify-between text-label-sm text-on-surface-variant">
                      <span>
                        {totals.done}/{totals.lines} renglones confirmados
                      </span>
                      <span className="tabular-nums">{Math.round(totals.progress * 100)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-pill bg-surface-container-high">
                      <div className="h-full rounded-pill bg-secondary-container transition-[width] duration-500" style={{ width: `${Math.round(totals.progress * 100)}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-space-md text-label-md">
                    <span className="text-on-surface-variant">
                      Cargado <strong className="tabular-nums text-primary">{formatNumber(totals.loadedSacks)}</strong> sacos
                    </span>
                    <span className="text-on-surface-variant">
                      <strong className="tabular-nums text-secondary">{formatNumber(totals.loadedKg)}</strong> kg reales
                    </span>
                    <span className={cx('font-semibold tabular-nums', totals.differenceKg < 0 ? 'text-error' : 'text-secondary')}>
                      {totals.differenceKg === 0 ? 'sin diferencia' : `${formatNumber(totals.differenceKg)} kg de diferencia`}
                    </span>
                  </div>
                </div>
              )}

              <div className="divide-y divide-outline-variant/25">
                {groups.map((group) => (
                  <section key={group.key}>
                    <div className="flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-low/60 px-space-md py-space-xs">
                      <span className="font-semibold text-on-surface">{group.name}</span>
                      <span className="flex items-center gap-space-sm text-label-sm tabular-nums text-on-surface-variant">
                        <span>{group.lines.length} renglón(es)</span>
                        <span>·</span>
                        <span>{formatNumber(group.plannedKg)} kg plan</span>
                        {group.pendingLines > 0 && (
                          <Badge tone="warning" dot>
                            {group.pendingLines} por confirmar
                          </Badge>
                        )}
                      </span>
                    </div>

                    <div className="hidden gap-space-sm border-b border-outline-variant/20 px-space-md py-1 font-semibold uppercase tracking-wider text-label-sm text-outline lg:grid lg:grid-cols-[minmax(0,1.6fr)_5rem_5.5rem_5.5rem_minmax(0,9rem)_6.5rem_auto]">
                      <span>Pedido / artículo</span>
                      <span>Alm.</span>
                      <span className="text-right">Entrega</span>
                      <span className="text-right">Plan</span>
                      <span className="text-center">Cargado</span>
                      <span className="text-center">Estado</span>
                      <span className="text-right">Acciones</span>
                    </div>

                    <ul>
                      {group.lines.map((line) => {
                        const value = draft[line.id] ?? (line.loadedQty === null ? '' : String(line.loadedQty));
                        const saving = savingLine === line.id;
                        const openNote = noteOpen === line.id;
                        return (
                          <li key={line.id} className={cx('border-b border-outline-variant/15 px-space-md py-space-sm transition-colors', line.status !== 'PENDIENTE' && 'bg-surface-container-low/30')}>
                            <div className="grid grid-cols-2 gap-x-space-sm gap-y-space-xs lg:grid-cols-[minmax(0,1.6fr)_5rem_5.5rem_5.5rem_minmax(0,9rem)_6.5rem_auto] lg:items-center">
                              <div className="col-span-2 min-w-0 lg:col-span-1">
                                <p className="flex items-center gap-space-xs">
                                  <span className="font-bold tabular-nums text-primary">{line.orderNumber}</span>
                                  <span className="text-label-sm text-outline">turno {line.position}</span>
                                </p>
                                <p className="truncate text-body-md text-on-surface-variant" title={line.description ?? ''}>
                                  <span className="font-semibold text-on-surface">{line.productCode}</span> · {line.description ?? '—'}
                                </p>
                              </div>

                              <Cell label="Almacén">
                                <span className="text-body-md text-on-surface-variant">{line.warehouseCode ?? '—'}</span>
                              </Cell>
                              <Cell label="Entrega" align="right">
                                <span className="tabular-nums text-on-surface-variant">{formatBusinessDate(line.effectiveDate)}</span>
                              </Cell>
                              <Cell label="Planificado" align="right">
                                <span className="flex flex-col items-end leading-tight tabular-nums">
                                  <span className="font-semibold text-primary">
                                    {formatNumber(line.plannedQty)} {line.uom ?? ''}
                                  </span>
                                  <span className="text-label-sm text-outline">{formatNumber(line.plannedKg)} kg</span>
                                </span>
                              </Cell>

                              <Cell label="Cargado" align="center">
                                {editable ? (
                                  <span className="flex items-center justify-center gap-space-xs">
                                    <input
                                      value={value}
                                      onChange={(event) => setDraft((current) => ({ ...current, [line.id]: event.target.value }))}
                                      onBlur={() => {
                                        const parsed = Number(value);
                                        if (value.trim() === '' || !Number.isFinite(parsed)) return;
                                        if (parsed === line.loadedQty && line.status !== 'PENDIENTE') return;
                                        void saveLine(line, Math.max(0, parsed));
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                                      }}
                                      inputMode="decimal"
                                      aria-label={`Cantidad cargada de ${line.productCode} en el pedido ${line.orderNumber}`}
                                      className="h-9 w-20 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-xs text-right font-semibold tabular-nums text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
                                    />
                                    {saving && <Loader2 aria-hidden className="size-3.5 animate-spin text-outline" />}
                                  </span>
                                ) : (
                                  <span className="tabular-nums font-semibold text-secondary">
                                    {line.loadedQty === null ? '—' : formatNumber(line.loadedQty)}
                                  </span>
                                )}
                              </Cell>

                              <Cell label="Estado" align="center">
                                <LineStatusBadge status={line.status} />
                              </Cell>

                              <Cell label="Acciones" align="right">
                                {editable ? (
                                  <span className="flex flex-wrap items-center justify-end gap-space-xs">
                                    {QUICK_ACTIONS.map((action) => (
                                      <button
                                        key={action.label}
                                        type="button"
                                        disabled={saving}
                                        onClick={() => void saveLine(line, Math.round(line.plannedQty * action.ratio), action.status)}
                                        className={cx(
                                          'h-8 rounded-pill px-space-sm font-semibold text-label-md transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40',
                                          action.tone,
                                        )}
                                      >
                                        {action.label}
                                      </button>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() => setNoteOpen(openNote ? null : line.id)}
                                      aria-expanded={openNote}
                                      title="Añadir una nota a este renglón"
                                      className={cx(
                                        'grid size-8 place-items-center rounded-full border transition-colors',
                                        line.note ? 'border-warning/50 bg-warning/10 text-warning' : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
                                      )}
                                    >
                                      <StickyNote aria-hidden className="size-3.5" />
                                    </button>
                                  </span>
                                ) : (
                                  <span className="text-label-sm text-outline">{line.checkedByName ?? ''}</span>
                                )}
                              </Cell>
                            </div>

                            {line.note && !openNote && (
                              <p className="mt-space-xs flex items-start gap-space-xs rounded-lg bg-warning/10 px-space-sm py-1 text-label-md text-on-warning-container">
                                <StickyNote aria-hidden className="mt-0.5 size-3.5 shrink-0" /> {line.note}
                              </p>
                            )}

                            {openNote && editable && (
                              <div className="mt-space-xs flex flex-wrap items-center gap-space-xs">
                                <textarea
                                  value={notes[line.id] ?? line.note ?? ''}
                                  onChange={(event) => setNotes((current) => ({ ...current, [line.id]: event.target.value }))}
                                  rows={2}
                                  maxLength={240}
                                  placeholder="¿Por qué no se cargó completo?"
                                  className="min-w-[12rem] flex-1 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-1 text-body-md outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
                                />
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => saveNote(line, value)}
                                  className="h-8 rounded-pill bg-primary-container px-space-sm font-semibold text-label-md text-on-primary disabled:opacity-40"
                                >
                                  Guardar nota
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            </Card>

            {/* Acciones del operador */}
            {sheet.canOperate && !closed && (
              <Card className="sticky bottom-2 z-20 flex flex-wrap items-center justify-between gap-space-sm border-secondary-container/50 bg-surface-container-lowest/95 p-space-sm shadow-lift backdrop-blur">
                <div className="min-w-0">
                  <p className="font-semibold text-primary">
                    {sheet.status === 'ENVIADO'
                      ? 'Recibido. Toma el despacho para empezar a cargar.'
                      : pendingLines > 0
                        ? `Faltan ${pendingLines} renglón(es) por confirmar.`
                        : 'Todo confirmado: puedes cerrar el despacho.'}
                  </p>
                  <p className="text-label-sm normal-case text-on-surface-variant">
                    {sheet.status === 'ENVIADO'
                      ? 'Al tomarlo, planificación recibe el aviso.'
                      : 'Al cerrarlo, planificación recibe los totales reales.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-space-sm">
                  {sheet.status === 'ENVIADO' && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={ackInProgress}
                      className="flex h-10 items-center gap-space-xs rounded-pill bg-secondary-container px-space-lg font-bold text-on-secondary shadow-soft transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
                    >
                      {busy === 'start' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Truck aria-hidden className="size-4" />}
                      Tomar y cargar
                    </button>
                  )}
                  {sheet.status !== 'ENVIADO' && (
                    <button
                      type="button"
                      disabled={pendingLines > 0 || busy !== null}
                      onClick={() => setCompleteOpen(true)}
                      title={pendingLines > 0 ? 'Confirma todos los renglones antes de cerrar' : undefined}
                      className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-bold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
                    >
                      <CheckCheck aria-hidden className="size-4" /> Cerrar despacho
                    </button>
                  )}
                </div>
              </Card>
            )}

            {closed && (
              <Card className="flex flex-wrap items-center justify-between gap-space-sm p-space-sm">
                <span className="flex items-center gap-space-sm text-body-md text-on-surface-variant">
                  {sheet.status === 'DESPACHADO' ? <CheckCheck aria-hidden className="size-4 text-secondary" /> : <Ban aria-hidden className="size-4 text-error" />}
                  {sheet.status === 'DESPACHADO'
                    ? `Cerrado ${formatDateTime(sheet.completedAt)} por ${sheet.completedByName ?? 'almacén'} · ${formatNumber(totals?.loadedSacks ?? 0)} sacos · ${formatNumber(totals?.loadedKg ?? 0)} kg`
                    : `Anulado ${formatDateTime(sheet.canceledAt)} por ${sheet.canceledByName ?? '—'}`}
                </span>
                <button
                  type="button"
                  onClick={() => void exportSheet()}
                  className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
                >
                  <Download aria-hidden className="size-4" /> Exportar
                </button>
              </Card>
            )}
          </div>

          {/* Bitácora: el túnel de dos vías */}
          <Card className="flex flex-col 2xl:col-span-4">
            <div className="flex items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm">
              <div className="flex items-center gap-space-sm">
                <span className="grid size-8 place-items-center rounded-lg bg-primary-fixed text-primary">
                  <MessageSquare aria-hidden className="size-4" />
                </span>
                <div>
                  <p className="font-semibold text-primary">Bitácora</p>
                  <p className="text-label-sm normal-case text-on-surface-variant">Acuses y conversación con planificación</p>
                </div>
              </div>
              <Badge tone="muted">{sheet.events.length}</Badge>
            </div>

            <div className="flex-1 overflow-y-auto p-space-md 2xl:max-h-[52vh]">
              <EventTimeline events={sheet.events} />
            </div>

            <form onSubmit={sendMessage} className="flex items-end gap-space-xs border-t border-outline-variant/30 bg-surface-container-low/50 p-space-sm">
              <label className="flex-1">
                <span className="sr-only">Mensaje para la contraparte</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder={isPlanner ? 'Escribe al almacén…' : 'Escribe a planificación…'}
                  className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-1 text-body-md outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
                />
              </label>
              <button
                type="submit"
                disabled={!message.trim() || busy === 'message'}
                className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-on-primary transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
              >
                {busy === 'message' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
                Enviar
              </button>
            </form>
          </Card>
        </div>

        <p className="flex flex-wrap items-center gap-space-xs text-label-sm normal-case text-on-surface-variant">
          <UserCheck aria-hidden className="size-3.5" />
          Cada acuse queda firmado con quién y a qué hora. Este despacho no genera movimientos en Profit.
        </p>
      </main>

      {/* Confirmar cierre */}
      {completeOpen && (
        <div role="presentation" className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-space-md backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="complete-title" className="animate-rise w-full max-w-md overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero">
            <div aria-hidden className="h-1 w-full bg-secondary-container" />
            <div className="p-space-lg">
              <h2 id="complete-title" className="text-headline-md text-primary">
                Cerrar el despacho
              </h2>
              <p className="mt-space-xs text-body-md text-on-surface-variant">
                Se registrarán los totales reales y planificación recibirá el aviso de cierre.
              </p>
              <dl className="mt-space-md grid grid-cols-2 gap-space-sm rounded-xl bg-surface-container-low/70 p-space-sm text-body-md">
                <dt className="text-on-surface-variant">Sacos cargados</dt>
                <dd className="text-right font-bold tabular-nums text-primary">{formatNumber(totals?.loadedSacks ?? 0)}</dd>
                <dt className="text-on-surface-variant">Kg reales</dt>
                <dd className="text-right font-bold tabular-nums text-secondary">{formatNumber(totals?.loadedKg ?? 0)}</dd>
                <dt className="text-on-surface-variant">Diferencia</dt>
                <dd className={cx('text-right font-bold tabular-nums', (totals?.differenceKg ?? 0) < 0 ? 'text-error' : 'text-secondary')}>
                  {formatNumber(totals?.differenceKg ?? 0)} kg
                </dd>
              </dl>
              <label className="mt-space-md flex flex-col gap-1">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Nota de cierre (opcional)</span>
                <textarea
                  value={completeNote}
                  onChange={(event) => setCompleteNote(event.target.value)}
                  rows={2}
                  maxLength={500}
                  className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-1 text-body-md outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/60 px-space-lg py-space-sm">
              <button type="button" onClick={() => setCompleteOpen(false)} className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant hover:bg-surface-container-low">
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy === 'complete'}
                onClick={() => {
                  setCompleteOpen(false);
                  void runAction(
                    'complete',
                    () =>
                      apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/complete`, {
                        method: 'POST',
                        body: JSON.stringify({ note: completeNote.trim() || undefined }),
                      }),
                    'Despacho cerrado. Planificación ya fue notificada.',
                  );
                }}
                className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:opacity-40"
              >
                {busy === 'complete' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <CheckCheck aria-hidden className="size-4" />}
                Confirmar cierre
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Anular */}
      {cancelOpen && (
        <div role="presentation" className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-space-md backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="cancel-title" className="animate-rise w-full max-w-md overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero">
            <div aria-hidden className="h-1 w-full bg-critical/70" />
            <div className="p-space-lg">
              <h2 id="cancel-title" className="flex items-center gap-space-sm text-headline-md text-primary">
                <AlertTriangle aria-hidden className="size-5 text-error" /> Anular el despacho
              </h2>
              <p className="mt-space-xs text-body-md text-on-surface-variant">
                El almacén verá que se anuló y el motivo en la bitácora. No se puede deshacer.
              </p>
              <label className="mt-space-md flex flex-col gap-1">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Motivo</span>
                <textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  rows={2}
                  maxLength={240}
                  placeholder="El cliente reprogramó la entrega…"
                  className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-1 text-body-md outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/60 px-space-lg py-space-sm">
              <button type="button" onClick={() => setCancelOpen(false)} className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant hover:bg-surface-container-low">
                Volver
              </button>
              <button
                type="button"
                disabled={cancelReason.trim().length < 3 || busy === 'cancel'}
                onClick={() => {
                  setCancelOpen(false);
                  void runAction(
                    'cancel',
                    () =>
                      apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/cancel`, {
                        method: 'POST',
                        body: JSON.stringify({ reason: cancelReason.trim() }),
                      }),
                    'Despacho anulado.',
                  );
                }}
                className="flex h-9 items-center gap-space-xs rounded-pill bg-error px-space-lg font-semibold text-on-primary transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
              >
                <Ban aria-hidden className="size-4" /> Anular despacho
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-4 left-1/2 z-[85] -translate-x-1/2 rounded-pill bg-primary px-space-lg py-2 text-label-md font-semibold text-on-primary shadow-lift">
          {toast}
        </div>
      )}
    </>
  );
}

/** Celda con etiqueta visible solo en móvil (la tabla de escritorio usa encabezados). */
function Cell({ label, align = 'left', children }: { label: string; align?: 'left' | 'right' | 'center'; children: React.ReactNode }) {
  return (
    <div className={cx('flex flex-col gap-0.5 lg:block', align === 'right' ? 'items-end lg:text-right' : align === 'center' ? 'items-end lg:text-center' : 'items-start')}>
      <span className="font-semibold uppercase tracking-wider text-label-sm text-outline lg:hidden">{label}</span>
      {children}
    </div>
  );
}
