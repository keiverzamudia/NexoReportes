'use client';

// ============================================================
// Acciones de carga de un cliente del despacho.
//
// Misma lógica que usa la página del despacho, extraída para que la bandeja
// pueda operar el cliente sin salir de su pantalla: guardar la cantidad
// (completa, parcial o no cargada), iniciar la carga y registrar la factura.
// Cada acción actualiza el detalle en caché y refresca bandeja, métricas y
// notificaciones, igual que la pantalla completa.
// ============================================================

import type {
  DispatchInvoiceInput,
  DispatchSheetDetail,
  DispatchSheetLine,
} from '@nexo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { apiFetch } from './api';
import { lineEffectiveQty, resolveTypedQuantity, type DispatchLineResolution } from './dispatch-sheet';

interface NoteTarget {
  line: DispatchSheetLine;
  status: 'PARCIAL' | 'FALTANTE';
  loadedQty: number;
  note: string;
}

interface InvoiceTarget {
  customerKey: string;
  customerName: string;
}

export function useDispatchLoad(sheet: DispatchSheetDetail, notify: (message: string) => void) {
  const queryClient = useQueryClient();
  const [savingLine, setSavingLine] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [invoiceTarget, setInvoiceTarget] = useState<InvoiceTarget | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  const editable = Boolean(sheet.canOperate) && sheet.status !== 'DESPACHADO' && sheet.status !== 'CANCELADO';

  const applyDetail = useCallback(
    (updated: DispatchSheetDetail) => {
      queryClient.setQueryData(['dispatch-sheet', updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['dispatch-sheets'] });
      void queryClient.invalidateQueries({ queryKey: ['dispatch-metrics'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    [queryClient],
  );

  function setDraft(lineId: string, value: string | null) {
    setDrafts((current) => {
      const next = { ...current };
      if (value === null) delete next[lineId];
      else next[lineId] = value;
      return next;
    });
  }

  /** Motivo ya escrito en una diferencia previa (se reutiliza al corregirla). */
  function existingReason(line: DispatchSheetLine): string {
    return line.status === 'PARCIAL' || line.status === 'FALTANTE' || line.status === 'NOVEDAD'
      ? line.note ?? ''
      : '';
  }

  function openNote(line: DispatchSheetLine, status: 'PARCIAL' | 'FALTANTE', loadedQty: number, note: string) {
    setNoteTarget({ line, status, loadedQty, note });
  }

  async function saveLine(line: DispatchSheetLine, resolution: DispatchLineResolution) {
    if (!editable || groupBusy || savingLine !== null) return;
    setSavingLine(line.id);
    try {
      const updated = await apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/lines/${line.id}`, {
        method: 'PATCH',
        body: JSON.stringify(resolution),
      });
      applyDetail(updated);
      setDraft(line.id, null);
      setNoteTarget(null);
      notify(
        resolution.status === 'CARGADO'
          ? 'Renglón cargado.'
          : resolution.status === 'PARCIAL'
            ? `Carga parcial guardada: ${resolution.loadedQty} de ${line.plannedQty} ${line.uom ?? ''}.`
            : resolution.status === 'FALTANTE'
              ? 'Renglón marcado como no cargado.'
              : 'Renglón devuelto a pendiente.',
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo guardar el renglón');
    } finally {
      setSavingLine(null);
    }
  }

  /** Abre el motivo de «no cargado» y refleja 0 en el input de la fila. */
  function openMissing(line: DispatchSheetLine) {
    if (!editable || groupBusy) return;
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
    if (!editable || groupBusy || savingLine !== null) return;
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

  function saveNote(note: string) {
    const target = noteTarget;
    if (!target) return;
    void saveLine(target.line, {
      status: target.status,
      ...(target.status === 'PARCIAL' ? { loadedQty: target.loadedQty } : {}),
      note,
    });
  }

  /** «Iniciar carga»: arranca los relojes del cliente sin marcar productos. */
  async function startGroup(customerKey: string, customerName: string) {
    if (!editable || groupBusy) return;
    setGroupBusy(customerKey);
    try {
      const updated = await apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/customers/start`, {
        method: 'POST',
        body: JSON.stringify({ customerKey }),
      });
      applyDetail(updated);
      notify(`Carga iniciada para ${customerName}. Ahora cierra cada producto cuando esté cargado.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo iniciar la carga del cliente');
      void queryClient.invalidateQueries({ queryKey: ['dispatch-sheet', sheet.id] });
    } finally {
      setGroupBusy(null);
    }
  }

  function openInvoice(customerKey: string, customerName: string) {
    setInvoiceTarget({ customerKey, customerName });
  }

  async function confirmInvoice(input: DispatchInvoiceInput) {
    const target = invoiceTarget;
    if (!target) return;
    setInvoiceBusy(true);
    try {
      const updated = await apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/customers/invoice`, {
        method: 'POST',
        body: JSON.stringify({ ...input, customerKey: target.customerKey }),
      });
      applyDetail(updated);
      setInvoiceTarget(null);
      notify('Factura registrada como entregada.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo registrar la factura');
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function reopenInvoice(customerKey: string, customerName: string) {
    const reason = window.prompt(`Motivo para reabrir la factura de ${customerName}:`);
    if (!reason || reason.trim().length < 3) return;
    setInvoiceBusy(true);
    try {
      const updated = await apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheet.id}/customers/reopen-invoice`, {
        method: 'POST',
        body: JSON.stringify({ customerKey, reason: reason.trim() }),
      });
      applyDetail(updated);
      notify('Factura reabierta. Ya puedes corregir la carga.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo reabrir la factura');
    } finally {
      setInvoiceBusy(false);
    }
  }

  return {
    editable,
    savingLine,
    groupBusy,
    drafts,
    noteTarget,
    invoiceTarget,
    invoiceBusy,
    setDraft,
    saveLine,
    commitQuantity,
    openMissing,
    editNote,
    closeNote,
    saveNote,
    startGroup,
    openInvoice,
    confirmInvoice,
    reopenInvoice,
    closeInvoice: () => setInvoiceTarget(null),
  };
}
