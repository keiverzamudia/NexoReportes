'use client';

// ============================================================
// Cliente desplegado dentro de la bandeja.
//
// La bandeja ya trabaja por cliente: al abrir una fila se muestra aquí mismo
// el bloque de ese cliente (renglones, cantidades y botones) sin navegar a la
// página del despacho. Se apoya en el mismo `DispatchCustomerBlock` y en las
// mismas acciones (`useDispatchLoad`), así el comportamiento es idéntico.
// ============================================================

import type { DispatchInvoiceInput, DispatchSheetDetail } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildDispatchReport } from '../lib/dispatch-sheet';
import { useDispatchLoad } from '../lib/use-dispatch-load';
import { AuthRequiredError, apiFetch } from '../lib/api';
import { DispatchCustomerBlock } from './DispatchCustomerBlock';
import { DispatchInvoiceDialog } from './DispatchInvoiceDialog';
import { DispatchLineDialog } from './DispatchLineDialog';
import { Skeleton } from './ui';

export function DispatchClientExpansion({
  sheetId,
  customerKey,
  isAdmin,
}: {
  sheetId: string;
  customerKey: string;
  isAdmin: boolean;
}) {
  const { data: sheet, isLoading, error } = useQuery<DispatchSheetDetail>({
    queryKey: ['dispatch-sheet', sheetId],
    queryFn: () => apiFetch<DispatchSheetDetail>(`/dispatch-sheets/${sheetId}`),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-space-sm px-space-md py-space-md">
        <Skeleton className="h-9" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (!sheet) {
    return (
      <p role="alert" className="flex items-center gap-space-sm px-space-md py-space-md text-body-md text-error">
        <AlertTriangle aria-hidden className="size-4" />
        {error instanceof Error ? error.message : 'No se pudo abrir el cliente.'}
      </p>
    );
  }

  return <DispatchClientLoad sheet={sheet} customerKey={customerKey} isAdmin={isAdmin} />;
}

function DispatchClientLoad({
  sheet,
  customerKey,
  isAdmin,
}: {
  sheet: DispatchSheetDetail;
  customerKey: string;
  isAdmin: boolean;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const load = useDispatchLoad(sheet, setToast);
  const report = useMemo(() => buildDispatchReport(sheet.lines), [sheet.lines]);
  const group = report.groups.find((entry) => entry.key === customerKey);
  const progress = sheet.customerProgress.find((entry) => entry.customerKey === customerKey);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!group) {
    return (
      <p className="px-space-md py-space-md text-body-md text-on-surface-variant">
        Este cliente ya no tiene renglones en el despacho.
      </p>
    );
  }

  return (
    <>
      <DispatchCustomerBlock
        sheet={sheet}
        group={group}
        progress={progress}
        editable={load.editable}
        isAdmin={isAdmin}
        open
        savingLine={load.savingLine}
        groupBusy={load.groupBusy}
        drafts={load.drafts}
        invoiceBusy={load.invoiceBusy}
        onStart={() => void load.startGroup(group.key, group.name)}
        onSetDraft={load.setDraft}
        onCommitQuantity={load.commitQuantity}
        onSaveLine={(line, resolution) => void load.saveLine(line, resolution)}
        onOpenMissing={load.openMissing}
        onEditNote={load.editNote}
        onOpenInvoice={() => load.openInvoice(group.key, group.name)}
        onReopenInvoice={() => void load.reopenInvoice(group.key, group.name)}
      />

      {load.noteTarget && (
        <DispatchLineDialog
          key={`${load.noteTarget.line.id}-${load.noteTarget.status}-${load.noteTarget.loadedQty}`}
          line={load.noteTarget.line}
          status={load.noteTarget.status}
          loadedQty={load.noteTarget.loadedQty}
          initialNote={load.noteTarget.note}
          saving={load.savingLine === load.noteTarget.line.id}
          onClose={load.closeNote}
          onSave={load.saveNote}
        />
      )}

      <DispatchInvoiceDialog
        open={load.invoiceTarget !== null}
        mode="customer"
        customerName={load.invoiceTarget?.customerName}
        busy={load.invoiceBusy}
        onClose={load.closeInvoice}
        onConfirm={(input: DispatchInvoiceInput) => void load.confirmInvoice(input)}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-pill bg-primary px-space-lg py-space-sm text-body-md font-semibold text-on-primary shadow-lift"
        >
          {toast}
        </div>
      )}
    </>
  );
}
