'use client';

// ============================================================
// Detalle del despacho: donde el almacén completa la carga y el
// planificador sigue el avance.
//
//   · Cinta de acuses (el túnel hecho visible).
//   · Carga todo o nada: cada renglón se marca «Completado» (toma la
//     cantidad planificada) o se deshace. No hay parciales ni faltantes.
//   · Reporte de cierre con todos los renglones, disponible antes y
//     después de cerrar.
//   · Bitácora solo para ADMIN (drawer).
//
// Al abrir, el almacén deja el acuse «recibido» (una sola vez) y eso
// notifica al planificador. Nada de esto escribe en Profit.
// ============================================================

import type { DispatchLineMark, DispatchSheetDetail, DispatchSheetLine } from '@nexo/contracts';
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
  RotateCcw,
  Truck,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DispatchBitacoraDrawer } from '../../../components/DispatchBitacoraDrawer';
import { DispatchReportDialog } from '../../../components/DispatchReportDialog';
import { AcuseTimeline, SheetStatusBadge } from '../../../components/DispatchSheetParts';
import { AppNav, LoginScreen } from '../../../components/shell';
import { Badge, Card, EmptyState, PageHeader, Skeleton, cx } from '../../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../../lib/api';
import {
  buildDispatchReport,
  formatBusinessDate,
  formatDateTime,
  formatNumber,
  lineStatusMeta,
  sheetExport,
} from '../../../lib/dispatch-sheet';

export default function DispatchSheetPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const queryClient = useQueryClient();
  const ackSent = useRef(false);

  const [savingLine, setSavingLine] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReadOnly, setReportReadOnly] = useState(false);
  const [completeNote, setCompleteNote] = useState('');
  const [bitacoraOpen, setBitacoraOpen] = useState(false);

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
  const canStart = sheet ? sheet.status === 'ENVIADO' || sheet.status === 'RECIBIDO' : false;
  const isAdmin = sessionUser?.role === 'ADMIN';
  const isPlanner =
    ['PLANIFICADOR', 'GERENCIA', 'ADMIN'].includes(sessionUser?.baseRole ?? '') && !sheet?.canOperate;

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
      .then(() => {
        // Se invalida en vez de escribir la respuesta: si el operador ya tomó
        // el despacho o marcó un renglón, una respuesta vieja no debe pisarlo.
        queryClient.invalidateQueries({ queryKey: ['dispatch-sheet', sheet.id] });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      })
      .catch(() => {
        ackSent.current = false;
      });
  }, [sheet, queryClient]);

  const report = useMemo(() => (sheet ? buildDispatchReport(sheet.lines) : null), [sheet]);
  const completedLines = sheet?.lines.filter((line) => line.status === 'CARGADO').length ?? 0;
  const blockingLines = sheet ? sheet.lines.length - completedLines : 0;
  const progress = sheet && sheet.lines.length > 0 ? completedLines / sheet.lines.length : 0;

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => queryClient.invalidateQueries()} />;
  }

  function applyDetail(updated: DispatchSheetDetail) {
    queryClient.setQueryData(['dispatch-sheet', updated.id], updated);
    queryClient.invalidateQueries({ queryKey: ['dispatch-sheets'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function runAction(
    action: string,
    request: () => Promise<DispatchSheetDetail>,
    successMessage?: string,
  ): Promise<boolean> {
    setBusy(action);
    try {
      applyDetail(await request());
      if (successMessage) setToast(successMessage);
      return true;
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo completar la acción');
      return false;
    } finally {
      setBusy(null);
    }
  }

  function ackInProgress() {
    if (!sheet) return;
    void runAction(
      'start',
      async () => {
        // Si el recibo automático aún no llegó, se envía primero (idempotente).
        if (sheet.status === 'ENVIADO') {
          await apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/ack`, {
            method: 'POST',
            body: JSON.stringify({ event: 'RECIBIDO' }),
          });
        }
        return apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/ack`, {
          method: 'POST',
          body: JSON.stringify({ event: 'EN_PROCESO' }),
        });
      },
      'Despacho tomado. Ya puedes completar la carga.',
    );
  }

  async function markLine(line: DispatchSheetLine, status: DispatchLineMark) {
    if (!sheet || !editable) return;
    setSavingLine(line.id);
    try {
      const updated = await apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/lines/${line.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      applyDetail(updated);
      setToast(status === 'CARGADO' ? 'Renglón completado.' : 'Renglón devuelto a pendiente.');
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo guardar el renglón');
    } finally {
      setSavingLine(null);
    }
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
    ).then((ok) => {
      if (ok) setMessage('');
    });
  }

  function openReport(readOnly: boolean) {
    setReportReadOnly(readOnly);
    setReportOpen(true);
  }

  function confirmClose() {
    if (!sheet) return;
    void runAction(
      'complete',
      () =>
        apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/complete`, {
          method: 'POST',
          body: JSON.stringify({ note: completeNote.trim() || undefined }),
        }),
      'Despacho cerrado. Planificación ya fue notificada.',
    ).then((ok) => {
      if (!ok) return;
      setReportReadOnly(true);
      setReportOpen(true);
    });
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
          <Skeleton className="h-96 rounded-card" />
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
                <Link
                  href="/despacho"
                  className="mt-space-sm inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                >
                  <ArrowLeft aria-hidden className="size-4" /> Volver al tablero
                </Link>
              }
            />
          </Card>
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg pb-space-2xl md:p-space-xl">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <Link
            href="/despacho"
            className="inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
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
            {isAdmin && (
              <button
                type="button"
                onClick={() => setBitacoraOpen(true)}
                className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                <MessageSquare aria-hidden className="size-4" /> Bitácora
                {sheet.events.length > 0 && (
                  <span className="grid min-w-5 place-items-center rounded-pill bg-primary-fixed px-1 text-label-sm font-bold text-primary">
                    {sheet.events.length}
                  </span>
                )}
              </button>
            )}
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
                  marcas anteriores
                </Badge>
              )}
            </div>
          </div>
          <AcuseTimeline sheet={sheet} />
        </Card>

        {/* Carga por renglón */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/70 px-space-md py-space-sm">
            <div>
              <p className="font-bold uppercase tracking-wider text-label-md text-primary">
                {editable ? 'Carga por renglón' : isPlanner ? 'Detalle del plan' : 'Detalle'}
              </p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                {editable
                  ? 'Marca cada renglón como completado. Si te equivocas, usa Deshacer.'
                  : sheet.claimedByName && !closed
                    ? `Lo tomó ${sheet.claimedByName}: puedes verlo, pero solo esa persona lo carga.`
                    : 'Solo lectura.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-space-sm tabular-nums">
              <span className="flex items-baseline gap-1">
                <span className="text-label-sm font-semibold uppercase tracking-wider text-outline">Plan</span>
                <span className="text-data-tabular-lg font-bold text-primary">{formatNumber(sheet.plannedSacks)}</span>
                <span className="text-label-sm font-semibold text-outline">sacos</span>
              </span>
              <span aria-hidden className="text-outline-variant">
                ·
              </span>
              <span className="flex items-baseline gap-1">
                <span className="text-data-tabular-lg font-bold text-secondary">{formatNumber(sheet.plannedKg)}</span>
                <span className="text-label-sm font-semibold text-outline">kg</span>
              </span>
            </div>
          </div>

          {/* Progreso */}
          <div className="flex flex-wrap items-center gap-space-md border-b border-outline-variant/25 px-space-md py-space-sm">
            <div className="min-w-[12rem] flex-1">
              <div className="mb-1 flex items-center justify-between text-label-sm text-on-surface-variant">
                <span>
                  {completedLines}/{sheet.lines.length} renglones completados
                </span>
                <span className="tabular-nums">{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-pill bg-surface-container-high">
                <div
                  className="h-full rounded-pill bg-secondary-container transition-[width] duration-500"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
            {blockingLines > 0 ? (
              <Badge tone="warning" dot>
                {blockingLines} por completar
              </Badge>
            ) : (
              <Badge tone="success" dot>
                todo completado
              </Badge>
            )}
          </div>

          <div className="divide-y divide-outline-variant/25">
            {report?.groups.map((group) => (
              <section key={group.key}>
                <div className="flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-low/60 px-space-md py-space-xs">
                  <span className="font-semibold text-on-surface">{group.name}</span>
                  <span className="flex flex-wrap items-center gap-space-sm text-label-sm tabular-nums text-on-surface-variant">
                    <span>{group.lines.length} renglón(es)</span>
                    <span>·</span>
                    <span>{formatNumber(group.plannedKg)} kg plan</span>
                    {group.pendingLines > 0 && (
                      <Badge tone="warning" dot>
                        {group.pendingLines} por completar
                      </Badge>
                    )}
                  </span>
                </div>

                <div className="hidden gap-space-sm border-b border-outline-variant/20 px-space-md py-1 font-semibold uppercase tracking-wider text-label-sm text-outline lg:grid lg:grid-cols-[minmax(0,1fr)_7rem_minmax(0,10rem)_8rem]">
                  <span>Pedido / artículo</span>
                  <span className="text-right">Entrega</span>
                  <span className="text-right">Cantidad</span>
                  <span className="text-right">Acción</span>
                </div>

                <ul>
                  {group.lines.map((line) => {
                    const completed = line.status === 'CARGADO';
                    const saving = savingLine === line.id;
                    return (
                      <li
                        key={line.id}
                        className={cx(
                          'border-b border-outline-variant/15 px-space-md py-space-sm transition-colors',
                          completed && 'bg-success-container/25',
                        )}
                      >
                        <div className="grid grid-cols-2 gap-x-space-sm gap-y-space-xs lg:grid-cols-[minmax(0,1fr)_7rem_minmax(0,10rem)_8rem] lg:items-center">
                          <div className="col-span-2 min-w-0 lg:col-span-1">
                            <p className="flex items-center gap-space-xs">
                              <span className="font-bold tabular-nums text-primary">{line.orderNumber}</span>
                              <span className="text-label-sm text-outline">turno {line.position}</span>
                            </p>
                            <p className="truncate text-body-md text-on-surface-variant" title={line.description ?? ''}>
                              <span className="font-semibold text-on-surface">{line.productCode}</span> ·{' '}
                              {line.description ?? '—'}
                            </p>
                          </div>

                          <Cell label="Entrega" align="right">
                            <span className="tabular-nums text-on-surface-variant">
                              {formatBusinessDate(line.effectiveDate)}
                            </span>
                          </Cell>

                          <Cell label="Cantidad" align="right">
                            <span className="flex flex-col items-end leading-tight tabular-nums">
                              <span className="font-semibold text-primary">
                                {formatNumber(line.plannedQty)} {line.uom ?? ''}
                              </span>
                              <span className="text-label-sm text-outline">{formatNumber(line.plannedKg)} kg</span>
                            </span>
                          </Cell>

                          <Cell label="Acción" align="right">
                            {editable ? (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void markLine(line, completed ? 'PENDIENTE' : 'CARGADO')}
                                className={cx(
                                  'inline-flex h-8 min-w-[7.5rem] items-center justify-center gap-space-xs rounded-pill px-space-sm font-semibold text-label-md transition-all disabled:opacity-40',
                                  completed
                                    ? 'border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low'
                                    : 'bg-secondary-container text-on-secondary hover:-translate-y-0.5',
                                )}
                              >
                                {saving ? (
                                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                                ) : completed ? (
                                  <RotateCcw aria-hidden className="size-3.5" />
                                ) : (
                                  <CheckCheck aria-hidden className="size-3.5" />
                                )}
                                {completed ? 'Deshacer' : 'Completado'}
                              </button>
                            ) : (
                              <span
                                className={cx(
                                  'text-label-sm font-semibold',
                                  completed ? 'text-secondary' : 'text-outline',
                                )}
                              >
                                {lineStatusMeta(line.status).label}
                              </span>
                            )}
                          </Cell>
                        </div>
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
                {canStart
                  ? 'Recibido. Toma el despacho para empezar a cargar.'
                  : blockingLines > 0
                    ? `Faltan ${blockingLines} renglón(es) por completar.`
                    : 'Todo completado: revisa el reporte y cierra el despacho.'}
              </p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                {canStart
                  ? 'Al tomarlo, planificación recibe el aviso.'
                  : 'Al cerrarlo se genera el reporte y planificación recibe los totales.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-space-sm">
              {canStart && (
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
              {!canStart && (
                <button
                  type="button"
                  disabled={blockingLines > 0 || busy !== null}
                  onClick={() => openReport(false)}
                  title={blockingLines > 0 ? 'Completa todos los renglones antes de cerrar' : undefined}
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
              {sheet.status === 'DESPACHADO' ? (
                <CheckCheck aria-hidden className="size-4 text-secondary" />
              ) : (
                <Ban aria-hidden className="size-4 text-error" />
              )}
              {sheet.status === 'DESPACHADO'
                ? `Cerrado ${formatDateTime(sheet.completedAt)} por ${sheet.completedByName ?? 'almacén'} · ${formatNumber(
                    sheet.loadedSacks,
                  )} sacos · ${formatNumber(sheet.loadedKg)} kg`
                : `Anulado ${formatDateTime(sheet.canceledAt)} por ${sheet.canceledByName ?? '—'}`}
            </span>
            <div className="flex flex-wrap items-center gap-space-xs">
              {sheet.status === 'DESPACHADO' && (
                <button
                  type="button"
                  onClick={() => openReport(true)}
                  className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
                >
                  <ClipboardCheck aria-hidden className="size-4" /> Ver reporte
                </button>
              )}
              <button
                type="button"
                onClick={() => void exportSheet()}
                className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                <Download aria-hidden className="size-4" /> Exportar
              </button>
            </div>
          </Card>
        )}

        <p className="flex flex-wrap items-center gap-space-xs text-label-sm normal-case text-on-surface-variant">
          <UserCheck aria-hidden className="size-3.5" />
          Cada acuse queda firmado con quién y a qué hora. Este despacho no genera movimientos en Profit.
        </p>
      </main>

      {report && (
        <DispatchReportDialog
          open={reportOpen}
          sheet={sheet}
          report={report}
          readOnly={reportReadOnly || closed}
          note={completeNote}
          onNoteChange={setCompleteNote}
          onClose={() => setReportOpen(false)}
          onConfirm={confirmClose}
          onExport={() => void exportSheet()}
          busy={busy === 'complete'}
        />
      )}

      {isAdmin && (
        <DispatchBitacoraDrawer
          open={bitacoraOpen}
          sheet={sheet}
          message={message}
          onMessageChange={setMessage}
          onSend={sendMessage}
          onClose={() => setBitacoraOpen(false)}
          busy={busy === 'message'}
        />
      )}

      {/* Anular */}
      {cancelOpen && (
        <div
          role="presentation"
          className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-space-md backdrop-blur-sm"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-title"
            className="animate-rise w-full max-w-md overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
          >
            <div aria-hidden className="h-1 w-full bg-critical/70" />
            <div className="p-space-lg">
              <h2 id="cancel-title" className="flex items-center gap-space-sm text-headline-md text-primary">
                <AlertTriangle aria-hidden className="size-5 text-error" /> Anular el despacho
              </h2>
              <p className="mt-space-xs text-body-md text-on-surface-variant">
                El despacho queda anulado y el motivo se registra en la bitácora (solo administradores). No se
                puede deshacer.
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
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant hover:bg-surface-container-low"
              >
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
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[85] -translate-x-1/2 rounded-pill bg-primary px-space-lg py-2 text-label-md font-semibold text-on-primary shadow-lift"
        >
          {toast}
        </div>
      )}
    </>
  );
}

/** Celda con etiqueta visible solo en móvil (la tabla de escritorio usa encabezados). */
function Cell({ label, align = 'left', children }: { label: string; align?: 'left' | 'right' | 'center'; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        'flex flex-col gap-0.5 lg:block',
        align === 'right' ? 'items-end lg:text-right' : align === 'center' ? 'items-end lg:text-center' : 'items-start',
      )}
    >
      <span className="font-semibold uppercase tracking-wider text-label-sm text-outline lg:hidden">{label}</span>
      {children}
    </div>
  );
}
