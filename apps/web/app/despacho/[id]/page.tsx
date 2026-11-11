'use client';

// ============================================================
// Detalle del despacho: donde el almacén completa la carga y el
// planificador sigue el avance.
//
//   · Guía de carga del camión y comentarios del planificador.
//   · Tiempos por cliente: «Iniciar carga» arranca los relojes sin marcar
//     productos; «Cerrar carga» detiene el reloj de cada producto y
//     «Factura entregada» cierra el de facturación. La carga es exclusiva del
//     operador que tomó la hoja; la factura la puede entregar cualquier
//     operador de almacén. El cliente se puede facturar individualmente o con
//     «Facturar todo».
//   · Carga por renglón: el input «Cargado» se edita en la fila. Si baja del
//     plan se marca parcial y pide el motivo; si queda en 0, no cargado.
//     Las diferencias dejan su motivo en el reporte.
//   · Los clientes van plegados: el encabezado muestra el resumen y el
//     estado de sus relojes (sin iniciar / en carga / cerrada / facturada).
//   · Reporte de cierre con todos los renglones y los tiempos, disponible
//     antes y después de cerrar.
//   · Bitácora solo para ADMIN (drawer con filtros y detalle por producto).
//
// Al iniciar la carga o cerrar el primer producto el operador toma la hoja.
// No hay acuse previo.
// Nada de esto escribe en Profit.
// ============================================================

import type {
  DispatchCustomerProgress,
  DispatchInvoiceInput,
  DispatchLineMark,
  DispatchSheetDetail,
  DispatchSheetLine,
} from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  Loader2,
  MessageSquare,
  PackageX,
  Pencil,
  Play,
  Receipt,
  RotateCcw,
  Truck,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { DispatchBitacoraDrawer } from '../../../components/DispatchBitacoraDrawer';
import { DispatchCustomerTimeline } from '../../../components/DispatchCustomerTimeline';
import { DispatchInvoiceDialog } from '../../../components/DispatchInvoiceDialog';
import { DispatchLineDialog } from '../../../components/DispatchLineDialog';
import { DispatchMobileView } from '../../../components/DispatchMobileView';
import { DispatchReportDialog } from '../../../components/DispatchReportDialog';
import { LineStatusBadge, SheetStatusBadge } from '../../../components/DispatchSheetParts';
import { TruckLoadPlan } from '../../../components/TruckLoadPlan';
import type { LoadPlanLine } from '../../../components/TruckLoadPlan';
import { AppNav, LoginScreen } from '../../../components/shell';
import { Badge, Card, EmptyState, PageHeader, Skeleton, cx } from '../../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../../lib/api';
import {
  activeLines as activeSheetLines,
  buildDispatchReport,
  customerKeyOf,
  customerTimeline,
  formatBusinessDate,
  formatDateTime,
  formatDelta,
  formatNumber,
  formatTime,
  lineEffectiveQty,
  minutesBetween,
  resolveTypedQuantity,
  sheetExport,
  type CustomerGroup,
} from '../../../lib/dispatch-sheet';
import { useIsMobile } from '../../../lib/use-is-mobile';

// Guardado de un renglón: el input de cantidad decide la marca y este modal
// solo agrega el motivo cuando hay diferencia.
interface LineResolution {
  status: DispatchLineMark;
  loadedQty?: number;
  note?: string;
}

interface NoteTarget {
  line: DispatchSheetLine;
  status: 'PARCIAL' | 'FALTANTE';
  loadedQty: number;
  note: string;
}

/** Sello de cierre de un producto: hora real y tiempo desde el envío. */
function LineCloseStamp({ at, sentAt }: { at: string | null; sentAt: string | null }) {
  if (!at) return null;
  return (
    <span
      className="flex flex-col items-end leading-tight tabular-nums text-label-sm text-outline"
      title={`Cerrado ${formatDateTime(at)} · ${formatDelta(minutesBetween(sentAt, at))} desde el envío`}
    >
      <span>{formatTime(at)}</span>
      <span>{formatDelta(minutesBetween(sentAt, at))}</span>
    </span>
  );
}

export default function DispatchSheetPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const queryClient = useQueryClient();

  const [savingLine, setSavingLine] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [invoiceTarget, setInvoiceTarget] = useState<
    { mode: 'customer'; customerKey: string; customerName: string } | { mode: 'all' } | null
  >(null);
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
  const isAdmin = sessionUser?.role === 'ADMIN';
  const isMobile = useIsMobile();
  const isPlanner =
    ['PLANIFICADOR', 'GERENCIA', 'ADMIN'].includes(sessionUser?.baseRole ?? '') && !sheet?.canOperate;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Cada despacho arranca plegado: primero se ve el resumen por cliente.
  useEffect(() => {
    setOpenGroup(null);
    setGroupBusy(null);
    setDrafts({});
    setNoteTarget(null);
    setInvoiceTarget(null);
  }, [id]);

  const report = useMemo(() => (sheet ? buildDispatchReport(sheet.lines) : null), [sheet]);
  const activeLines = useMemo(() => (sheet ? activeSheetLines(sheet.lines) : []), [sheet]);
  const progressByKey = useMemo(() => {
    const map = new Map<string, DispatchCustomerProgress>();
    for (const row of sheet?.customerProgress ?? []) map.set(row.customerKey, row);
    return map;
  }, [sheet]);
  // Renglones del despacho en el formato de la guía de carga.
  const loadPlanLines: LoadPlanLine[] = useMemo(
    () =>
      activeLines.map((line) => ({
        orderNumber: line.orderNumber,
        customerCode: line.customerCode,
        customerName: line.customerName,
        productCode: line.productCode,
        description: line.description,
        kg: line.plannedKg,
        sacks: line.uom === 'SAC' ? line.plannedQty : 0,
        uom: line.uom,
        effectiveDate: line.effectiveDate,
        comment: line.note,
      })),
    [activeLines],
  );
  // «Resuelto» = cargado, parcial o no cargado. Solo pendiente bloquea el cierre.
  const resolvedLines = activeLines.filter((line) => line.status !== 'PENDIENTE').length;
  const partialLines = activeLines.filter((line) => line.status === 'PARCIAL').length;
  const missingLines =
    activeLines.filter((line) => line.status === 'FALTANTE' || line.status === 'NOVEDAD').length;
  const blockingLines = activeLines.length - resolvedLines;
  const progress = activeLines.length > 0 ? resolvedLines / activeLines.length : 0;
  const pendingInvoices = sheet?.pendingInvoiceCustomers ?? 0;
  const canInvoiceAll = Boolean(sheet?.canInvoice) && blockingLines === 0 && pendingInvoices > 0;
  // El cliente ya no tiene pendientes cuando todos sus productos están resueltos.
  const groupClosed = (group: CustomerGroup) => group.pendingLines === 0 && group.lines.length > 0;

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => queryClient.invalidateQueries()} />;
  }

  function applyDetail(updated: DispatchSheetDetail) {
    queryClient.setQueryData(['dispatch-sheet', updated.id], updated);
    queryClient.invalidateQueries({ queryKey: ['dispatch-sheets'] });
    queryClient.invalidateQueries({ queryKey: ['dispatch-metrics'] });
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

  function setDraft(lineId: string, value: string | null) {
    setDrafts((current) => {
      const next = { ...current };
      if (value === null) delete next[lineId];
      else next[lineId] = value;
      return next;
    });
  }

  async function saveLine(line: DispatchSheetLine, resolution: LineResolution) {
    if (!sheet || !editable || groupBusy || savingLine !== null) return;
    setSavingLine(line.id);
    try {
      const updated = await apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/lines/${line.id}`, {
        method: 'PATCH',
        body: JSON.stringify(resolution),
      });
      applyDetail(updated);
      setDraft(line.id, null);
      setNoteTarget(null);
      setToast(
        resolution.status === 'CARGADO'
          ? 'Renglón cargado.'
          : resolution.status === 'PARCIAL'
            ? `Carga parcial guardada: ${resolution.loadedQty} de ${line.plannedQty} ${line.uom ?? ''}.`
            : resolution.status === 'FALTANTE'
              ? 'Renglón marcado como no cargado.'
              : 'Renglón devuelto a pendiente.',
      );
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo guardar el renglón');
    } finally {
      setSavingLine(null);
    }
  }

  function openNote(line: DispatchSheetLine, status: 'PARCIAL' | 'FALTANTE', loadedQty: number, note: string) {
    setNoteTarget({ line, status, loadedQty, note });
  }

  /** Motivo ya escrito en una diferencia previa (se reutiliza al corregirla). */
  function existingReason(line: DispatchSheetLine): string {
    return line.status === 'PARCIAL' || line.status === 'FALTANTE' || line.status === 'NOVEDAD'
      ? line.note ?? ''
      : '';
  }

  /** Abre el motivo de «no cargado» y refleja 0 en el input de la fila. */
  function openMissing(line: DispatchSheetLine) {
    if (!sheet || !editable || groupBusy) return;
    setDraft(line.id, '0');
    openNote(line, 'FALTANTE', 0, existingReason(line));
  }

  function editNote(line: DispatchSheetLine) {
    if (!editable) return;
    if (line.status === 'PARCIAL') {
      openNote(line, 'PARCIAL', line.loadedQty ?? 0, line.note ?? '');
    } else if (line.status === 'FALTANTE' || line.status === 'NOVEDAD') {
      openNote(line, 'FALTANTE', 0, line.note ?? '');
    }
  }

  /** El input se confirma al salir o con Enter: completa, parcial o no cargado. */
  function commitQuantity(line: DispatchSheetLine) {
    if (!sheet || !editable || groupBusy || savingLine !== null) return;
    const raw = drafts[line.id];
    if (raw === undefined) return;
    const resolution = resolveTypedQuantity(line.plannedQty, raw);
    if (resolution.kind === 'UNCHANGED') {
      setDraft(line.id, null);
      return;
    }
    const typed =
      resolution.kind === 'FULL'
        ? line.plannedQty
        : resolution.kind === 'MISSING'
          ? 0
          : resolution.loadedQty;
    // Si dejó el mismo valor que ya estaba guardado, no hay nada que hacer.
    if (line.status !== 'PENDIENTE' && typed === lineEffectiveQty(line)) {
      setDraft(line.id, null);
      return;
    }
    if (resolution.kind === 'FULL') {
      setDraft(line.id, null);
      void saveLine(line, { status: 'CARGADO' });
      return;
    }
    if (resolution.kind === 'MISSING') {
      openNote(line, 'FALTANTE', 0, existingReason(line));
      return;
    }
    openNote(line, 'PARCIAL', resolution.loadedQty, existingReason(line));
  }

  function closeNote() {
    const target = noteTarget;
    setNoteTarget(null);
    if (target) setDraft(target.line.id, null);
  }

  /** «Iniciar carga»: arranca los relojes del cliente sin marcar productos. */
  async function iniciarGrupo(group: CustomerGroup) {
    if (!sheet || !editable || groupBusy) return;
    setGroupBusy(group.key);
    try {
      const updated = await apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/customers/start`, {
        method: 'POST',
        body: JSON.stringify({ customerKey: group.key }),
      });
      applyDetail(updated);
      setToast(`Carga iniciada para ${group.name}. Ahora cierra cada producto cuando esté cargado.`);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo iniciar la carga del cliente');
      void queryClient.invalidateQueries({ queryKey: ['dispatch-sheet', sheet.id] });
    } finally {
      setGroupBusy(null);
    }
  }

  function openInvoice(customerKey: string, customerName: string) {
    setInvoiceTarget({ mode: 'customer', customerKey, customerName });
  }

  function openInvoiceAll() {
    setInvoiceTarget({ mode: 'all' });
  }

  async function confirmInvoice(input: DispatchInvoiceInput) {
    if (!sheet || !invoiceTarget) return;
    const target = invoiceTarget;
    setInvoiceTarget(null);
    await runAction(
      'invoice',
      () =>
        apiFetch<DispatchSheetDetail>(
          target.mode === 'all'
            ? `/dispatch-sheets/${sheet.id}/invoice`
            : `/dispatch-sheets/${sheet.id}/customers/invoice`,
          {
            method: 'POST',
            body: JSON.stringify(target.mode === 'all' ? input : { ...input, customerKey: target.customerKey }),
          },
        ),
      target.mode === 'all' ? 'Facturación entregada a todos los clientes.' : 'Factura registrada como entregada.',
    );
  }

  async function reopenInvoice(customerKey: string, customerName: string) {
    if (!sheet) return;
    const reason = window.prompt(`Motivo para reabrir la factura de ${customerName}:`);
    if (!reason || reason.trim().length < 3) return;
    await runAction(
      'reopen-invoice',
      () =>
        apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/customers/reopen-invoice`, {
          method: 'POST',
          body: JSON.stringify({ customerKey, reason: reason.trim() }),
        }),
      'Factura reabierta. Ya puedes corregir la carga.',
    );
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
      {isMobile ? (
        <DispatchMobileView
          sheet={sheet}
          report={report!}
          progressByKey={progressByKey}
          editable={editable}
          closed={closed}
          isAdmin={isAdmin}
          busy={busy}
          savingLine={savingLine}
          groupBusy={groupBusy}
          drafts={drafts}
          openGroup={openGroup}
          canInvoiceAll={canInvoiceAll}
          pendingInvoices={pendingInvoices}
          onOpenGroup={setOpenGroup}
          onStartGroup={(group) => void iniciarGrupo(group)}
          onSetDraft={setDraft}
          onCommitQuantity={commitQuantity}
          onSaveLine={(line, resolution) => void saveLine(line, resolution)}
          onOpenMissing={openMissing}
          onEditNote={editNote}
          onOpenInvoice={openInvoice}
          onReopenInvoice={(key, name) => void reopenInvoice(key, name)}
          onOpenInvoiceAll={openInvoiceAll}
          onOpenReport={openReport}
          onOpenBitacora={() => setBitacoraOpen(true)}
          onOpenCancel={() => setCancelOpen(true)}
          onExport={() => void exportSheet()}
        />
      ) : (
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

        {sheet.status === 'CANCELADO' && (
          <Card className="border-critical/30 bg-critical-container/20 p-space-md">
            <p className="flex items-start gap-space-sm text-body-md text-on-surface">
              <Ban aria-hidden className="mt-0.5 size-4 shrink-0 text-error" />
              <span>
                <span className="font-semibold text-error">Despacho anulado.</span>{' '}
                {sheet.cancelReason ?? 'Sin motivo registrado.'}
                {sheet.canceledByName ? ` · ${sheet.canceledByName}` : ''}
                {sheet.canceledAt ? ` · ${formatDateTime(sheet.canceledAt)}` : ''}
              </span>
            </p>
          </Card>
        )}

        {/* Datos del envío */}
        <Card className="flex flex-wrap items-center justify-between gap-space-sm p-space-md">
          <div>
            <p className="font-semibold text-primary">
              {sheet.number} · enviado por {sheet.createdByName ?? sheet.createdByCode ?? '—'}
            </p>
            <p className="text-label-sm normal-case text-on-surface-variant">
              {formatDateTime(sheet.sentAt)} · destino {sheet.assignedToName ?? 'todo el almacén'}
              {sheet.claimedByName ? ` · tomado por ${sheet.claimedByName}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-space-xs">
            {sheet.status === 'CON_NOVEDAD' && (
              <Badge tone="danger" dot>
                marcas anteriores
              </Badge>
            )}
            {!closed && !sheet.claimedByName && (
              <Badge tone="muted" dot>
                sin tomar
              </Badge>
            )}
          </div>
        </Card>

        {/* Guía de carga del camión */}
        <TruckLoadPlan lines={loadPlanLines} loadPlan={sheet.loadPlan} />

        {/* Carga por renglón */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/70 px-space-md py-space-sm">
            <div>
              <p className="font-bold uppercase tracking-wider text-label-md text-primary">
                {editable ? 'Carga por cliente' : isPlanner ? 'Detalle del plan' : 'Detalle'}
              </p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                {editable
                  ? '«Iniciar carga» toma la hoja y avisa que empezaste. El tiempo se mide desde el envío de la simulación hasta tu último producto cerrado, y el total cierra con la factura. Digita la cantidad real y usa «Cerrar carga» en cada producto.'
                  : sheet.claimedByName && !closed
                    ? `Lo tomó ${sheet.claimedByName}: solo esa persona lo carga.${sheet.canInvoice ? ' Tú sí puedes entregar la factura.' : ''}`
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
                  {resolvedLines}/{activeLines.length} renglones resueltos
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
            <div className="flex flex-wrap items-center gap-space-xs">
              {partialLines > 0 && (
                <Badge tone="warning" dot>
                  {partialLines} parcial(es)
                </Badge>
              )}
              {missingLines > 0 && (
                <Badge tone="danger" dot>
                  {missingLines} no cargado(s)
                </Badge>
              )}
              {blockingLines > 0 ? (
                <Badge tone="warning" dot>
                  {blockingLines} por resolver
                </Badge>
              ) : activeLines.length === 0 ? (
                <Badge tone="muted" dot>
                  sin renglones activos
                </Badge>
              ) : (
                <Badge tone="success" dot>
                  todo resuelto
                </Badge>
              )}
            </div>
          </div>

          <div className="divide-y divide-outline-variant/25">
            {report?.groups.map((group) => {
              const customerProgress = progressByKey.get(group.key);
              const started = Boolean(customerProgress?.loadStartedAt);
              const loadClosed = Boolean(customerProgress?.loadClosedAt);
              const invoiced = Boolean(customerProgress?.invoiceDeliveredAt);
              const closedGroup = groupClosed(group);
              const timeline = customerTimeline(sheet.sentAt, customerProgress, group.lines);
              return (
                <section key={group.key}>
                  <div className="flex flex-wrap items-center justify-between gap-x-space-sm gap-y-2 bg-surface-container-low/60 px-space-md py-space-sm">
                    <button
                      type="button"
                      onClick={() => setOpenGroup(openGroup === group.key ? null : group.key)}
                      aria-expanded={openGroup === group.key}
                      className="flex min-w-0 flex-1 items-start gap-space-sm text-left"
                    >
                      {openGroup === group.key ? (
                        <ChevronDown aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                      ) : (
                        <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-outline" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-on-surface">{group.name}</span>
                        <span className="block text-label-sm tabular-nums text-on-surface-variant">
                          {new Set(group.lines.map((line) => line.orderNumber).filter(Boolean)).size} pedido(s) ·{' '}
                          {group.lines.length} renglón(es) · {formatNumber(group.plannedKg)} kg plan ·{' '}
                          {group.completedLines} cargado(s)
                          {group.partialLines > 0 ? ` · ${group.partialLines} parcial(es)` : ''}
                          {group.missingLines > 0 ? ` · ${group.missingLines} no cargado(s)` : ''}
                          {group.pendingLines > 0 ? ` · ${group.pendingLines} pendiente(s)` : ''}
                        </span>
                        <DispatchCustomerTimeline timeline={timeline} />
                      </span>
                    </button>

                    <div className="flex shrink-0 flex-wrap items-center gap-space-xs">
                      {!started ? (
                        <Badge tone="muted" dot>
                          sin iniciar
                        </Badge>
                      ) : invoiced ? (
                        <Badge tone="success" dot>
                          facturada
                        </Badge>
                      ) : loadClosed ? (
                        <Badge tone="success" dot>
                          carga cerrada
                        </Badge>
                      ) : group.pendingLines > 0 ? (
                        <Badge tone="primary" dot>
                          en carga
                        </Badge>
                      ) : (
                        <Badge tone="success" dot>
                          carga cerrada
                        </Badge>
                      )}
                      {editable && !started && (
                        <button
                          type="button"
                          disabled={groupBusy !== null || savingLine !== null}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void iniciarGrupo(group)}
                          title={`Iniciar la carga de ${group.name} y arrancar sus relojes`}
                          className="inline-flex h-8 items-center gap-space-xs rounded-pill bg-secondary-container px-space-sm font-semibold text-label-md text-on-secondary transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
                        >
                          {groupBusy === group.key ? (
                            <Loader2 aria-hidden className="size-3.5 animate-spin" />
                          ) : (
                            <Play aria-hidden className="size-3.5" />
                          )}
                          {groupBusy === group.key ? 'Iniciando…' : 'Iniciar carga'}
                        </button>
                      )}
                      {sheet.canInvoice && started && closedGroup && !invoiced && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => openInvoice(group.key, group.name)}
                          title={`Marcar la factura de ${group.name} como entregada`}
                          className="inline-flex h-8 items-center gap-space-xs rounded-pill bg-primary-container px-space-sm font-semibold text-label-md text-on-primary transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
                        >
                          <Receipt aria-hidden className="size-3.5" />
                          Factura entregada
                        </button>
                      )}
                      {invoiced && isAdmin && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void reopenInvoice(group.key, group.name)}
                          title="Reabrir la factura (solo administración)"
                          className="inline-flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
                        >
                          <RotateCcw aria-hidden className="size-3.5" />
                          Reabrir factura
                        </button>
                      )}
                    </div>
                  </div>

                  <div hidden={openGroup !== group.key}>
                  <div className="hidden gap-space-sm border-b border-outline-variant/20 px-space-md py-1 font-semibold uppercase tracking-wider text-label-sm text-outline lg:grid lg:grid-cols-[minmax(0,1fr)_6.5rem_8rem_8rem_12.5rem]">
                    <span>Pedido / artículo</span>
                    <span className="text-right">Entrega</span>
                    <span className="text-right">Cargado</span>
                    <span className="text-right">Cantidad</span>
                    <span className="text-right">Acción</span>
                  </div>

                  <ul>
                    {group.lines.map((line) => {
                      const completed = line.status === 'CARGADO';
                      const difference =
                        line.status === 'PARCIAL' || line.status === 'FALTANTE' || line.status === 'NOVEDAD';
                      const saving = savingLine === line.id;
                      const draftValue = drafts[line.id] ?? String(lineEffectiveQty(line));
                      const parsedDraft = Number(draftValue.replace(',', '.'));
                      const typedQty = Number.isFinite(parsedDraft)
                        ? Math.min(Math.max(parsedDraft, 0), line.plannedQty)
                        : 0;
                      const typedKg =
                        line.plannedQty > 0 ? (typedQty * line.plannedKg) / line.plannedQty : typedQty;
                      return (
                        <li
                          key={line.id}
                          className={cx(
                            'border-b border-outline-variant/15 px-space-md py-space-sm transition-colors',
                            completed && 'bg-success-container/25',
                            difference && 'bg-warning-container/15',
                          )}
                        >
                          <div className="grid grid-cols-2 gap-x-space-sm gap-y-space-xs lg:grid-cols-[minmax(0,1fr)_6.5rem_8rem_8rem_12.5rem] lg:items-center">
                            <div className="col-span-2 min-w-0 lg:col-span-1">
                              <p className="flex items-center gap-space-xs">
                                <span className="font-bold tabular-nums text-primary">{line.orderNumber}</span>
                                <span className="text-label-sm text-outline">turno {line.position}</span>
                              </p>
                              <p className="truncate text-body-md text-on-surface-variant" title={line.description ?? ''}>
                                <span className="font-semibold text-on-surface">{line.productCode}</span> ·{' '}
                                {line.description ?? '—'}
                              </p>
                              {line.note && (
                                <p
                                  className={cx(
                                    'mt-space-2xs flex items-start gap-space-xs rounded-lg px-space-xs py-1 text-label-md text-on-surface',
                                    difference ? 'bg-warning-container/30' : 'bg-secondary-container/15',
                                  )}
                                >
                                  {difference ? (
                                    <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-error" />
                                  ) : (
                                    <MessageSquare aria-hidden className="mt-0.5 size-3.5 shrink-0 text-secondary" />
                                  )}
                                  <span className="min-w-0 flex-1 whitespace-pre-wrap">
                                    {difference ? <span className="font-semibold">Motivo: </span> : null}
                                    {line.note}
                                  </span>
                                  {difference && editable && (
                                    <button
                                      type="button"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => {
                                        setDraft(line.id, null);
                                        editNote(line);
                                      }}
                                      title="Editar solo el motivo"
                                      aria-label={`Editar el motivo de ${line.productCode} en el pedido ${line.orderNumber}`}
                                      className="grid size-6 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
                                    >
                                      <Pencil aria-hidden className="size-3" />
                                    </button>
                                  )}
                                </p>
                              )}
                            </div>

                            <Cell label="Entrega" align="right">
                              <span className="tabular-nums text-on-surface-variant">
                                {formatBusinessDate(line.effectiveDate)}
                              </span>
                            </Cell>

                            <Cell label="Cargado" align="right">
                              {editable && !invoiced ? (
                                <div className="flex w-full flex-col items-end gap-0.5">
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      min={0}
                                      max={line.plannedQty}
                                      step={line.uom === 'SAC' ? 1 : 0.01}
                                      value={draftValue}
                                      disabled={saving || groupBusy !== null}
                                      onFocus={(event) => event.target.select()}
                                      onChange={(event) => setDraft(line.id, event.target.value)}
                                      onBlur={() => commitQuantity(line)}
                                      onWheel={(event) => event.currentTarget.blur()}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') event.currentTarget.blur();
                                        if (event.key === 'Escape') {
                                          setDraft(line.id, null);
                                          event.currentTarget.blur();
                                        }
                                      }}
                                      aria-label={`Cantidad cargada de ${line.productCode} en el pedido ${line.orderNumber}`}
                                      title="Cantidad real cargada. Si baja del plan se marca parcial; si es 0, no cargado."
                                      className="h-9 w-[5.5rem] rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-right font-semibold tabular-nums text-primary outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70 disabled:opacity-50"
                                    />
                                    <span className="w-8 shrink-0 text-left text-label-sm font-semibold text-outline">
                                      {line.uom ?? ''}
                                    </span>
                                  </div>
                                  <span
                                    className={cx(
                                      'text-label-sm tabular-nums',
                                      typedQty < line.plannedQty ? 'font-semibold text-error' : 'text-outline',
                                    )}
                                  >
                                    {formatNumber(typedKg)} kg
                                  </span>
                                </div>
                              ) : (
                                <span className="flex flex-col items-end leading-tight tabular-nums">
                                  <span
                                    className={cx(
                                      'font-semibold',
                                      line.status === 'PENDIENTE'
                                        ? 'text-outline'
                                        : difference
                                          ? 'text-error'
                                          : 'text-secondary',
                                    )}
                                  >
                                    {line.status === 'PENDIENTE'
                                      ? '—'
                                      : `${formatNumber(lineEffectiveQty(line))} ${line.uom ?? ''}`}
                                  </span>
                                  {line.status !== 'PENDIENTE' && (
                                    <span className="text-label-sm text-outline">{formatNumber(line.loadedKg ?? 0)} kg</span>
                                  )}
                                </span>
                              )}
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
                              {editable && !invoiced ? (
                                <div className="flex flex-wrap items-center justify-end gap-space-xs">
                                  {line.status === 'PENDIENTE' ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={saving || groupBusy !== null}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => {
                                          setDraft(line.id, null);
                                          void saveLine(line, { status: 'CARGADO' });
                                        }}
                                        title="Cerrar la carga de este producto: detiene su reloj de carga"
                                        className="inline-flex h-8 items-center justify-center gap-space-xs rounded-pill bg-secondary-container px-space-sm font-semibold text-label-md text-on-secondary transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
                                      >
                                        {saving ? (
                                          <Loader2 aria-hidden className="size-3.5 animate-spin" />
                                        ) : (
                                          <CheckCheck aria-hidden className="size-3.5" />
                                        )}
                                        Cerrar carga
                                      </button>
                                      <button
                                        type="button"
                                        disabled={saving || groupBusy !== null}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => {
                                          setDraft(line.id, null);
                                          openMissing(line);
                                        }}
                                        title="Marcar el renglón como no cargado y pedir el motivo"
                                        className="inline-flex h-8 items-center justify-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
                                      >
                                        <PackageX aria-hidden className="size-3.5" />
                                        No cargado
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <LineStatusBadge status={line.status} />
                                      <LineCloseStamp at={line.loadClosedAt} sentAt={sheet.sentAt} />
                                      {saving ? (
                                        <Loader2 aria-hidden className="size-3.5 animate-spin text-secondary" />
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={groupBusy !== null}
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => {
                                            setDraft(line.id, null);
                                            void saveLine(line, { status: 'PENDIENTE' });
                                          }}
                                          title="Deshacer la marca y volver a pendiente"
                                          aria-label={`Deshacer la marca de ${line.productCode} en el pedido ${line.orderNumber}`}
                                          className="grid size-8 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
                                        >
                                          <RotateCcw aria-hidden className="size-3.5" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              ) : (
                                <span className="flex flex-wrap items-center justify-end gap-space-xs">
                                  <LineStatusBadge status={line.status} />
                                  <LineCloseStamp at={line.loadClosedAt} sentAt={sheet.sentAt} />
                                </span>
                              )}
                            </Cell>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                </section>
              );
            })}
          </div>
        </Card>

        {/* Acciones del operador */}
        {sheet.canOperate && !closed && (
          <Card className="sticky bottom-2 z-20 flex flex-wrap items-center justify-between gap-space-sm border-secondary-container/50 bg-surface-container-lowest/95 p-space-sm shadow-lift backdrop-blur">
            <div className="min-w-0">
              <p className="font-semibold text-primary">
                {blockingLines > 0
                  ? `Faltan ${blockingLines} renglón(es) por resolver.`
                  : 'Todo resuelto: revisa el reporte y cierra el despacho.'}
              </p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                {sheet.status === 'ENVIADO' && resolvedLines === 0
                  ? 'Inicia la carga de un cliente para tomar el despacho. No hay paso de recibo.'
                  : pendingInvoices > 0
                    ? `Carga cerrada. Quedan ${pendingInvoices} cliente(s) por marcar factura entregada.`
                    : 'Cada producto debe quedar cargado, parcial o no cargado (con motivo) antes de cerrar.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-space-sm">
              {canInvoiceAll && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={openInvoiceAll}
                  className="flex h-10 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
                >
                  <Receipt aria-hidden className="size-4" /> Facturar todo ({pendingInvoices})
                </button>
              )}
              <button
                type="button"
                disabled={blockingLines > 0 || busy !== null}
                onClick={() => openReport(false)}
                title={blockingLines > 0 ? 'Resuelve todos los renglones antes de cerrar' : undefined}
                className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-bold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
              >
                <CheckCheck aria-hidden className="size-4" /> Cerrar despacho
              </button>
            </div>
          </Card>
        )}

        {closed && (
          <Card className="flex flex-wrap items-center justify-between gap-space-sm p-space-sm">
            <span className="flex flex-col gap-0.5 text-body-md text-on-surface-variant">
              <span className="flex items-center gap-space-sm">
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
              {sheet.status === 'DESPACHADO' && pendingInvoices > 0 && (
                <span className="text-label-sm font-semibold text-warning">
                  {pendingInvoices} cliente(s) con factura pendiente.
                </span>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-space-xs">
              {canInvoiceAll && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={openInvoiceAll}
                  className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-body-md text-on-primary transition-colors hover:bg-primary disabled:opacity-40"
                >
                  <Receipt aria-hidden className="size-4" /> Facturar pendientes ({pendingInvoices})
                </button>
              )}
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
          Quien inicia la carga o cierra el primer producto queda como responsable. Este despacho no genera movimientos en Profit.
        </p>
      </main>
      )}

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

      <DispatchInvoiceDialog
        open={invoiceTarget !== null}
        mode={invoiceTarget?.mode ?? 'customer'}
        customerName={invoiceTarget?.mode === 'customer' ? invoiceTarget.customerName : undefined}
        pendingCount={pendingInvoices}
        busy={busy === 'invoice'}
        onClose={() => setInvoiceTarget(null)}
        onConfirm={(input) => void confirmInvoice(input)}
      />

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

      {/* Motivo de la diferencia (parcial o no cargado) */}
      {noteTarget && (
        <DispatchLineDialog
          key={`${noteTarget.line.id}-${noteTarget.status}-${noteTarget.loadedQty}`}
          line={noteTarget.line}
          status={noteTarget.status}
          loadedQty={noteTarget.loadedQty}
          initialNote={noteTarget.note}
          saving={savingLine === noteTarget.line.id}
          onClose={closeNote}
          onSave={(note) => {
            const target = noteTarget;
            void saveLine(target.line, {
              status: target.status,
              ...(target.status === 'PARCIAL' ? { loadedQty: target.loadedQty } : {}),
              note,
            });
          }}
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
