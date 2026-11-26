'use client';

// ============================================================
// Botón «PDF» de un cliente del despacho.
//
// Genera la hoja de carga imprimible (jsPDF) y la abre en otra pestaña.
// Se reutiliza en la bandeja expandida, en la página del despacho y en móvil.
// ============================================================

import type { DispatchCustomerProgress, DispatchSheetDetail } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { FileDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { currentUser } from '../lib/api';
import type { CustomerGroup } from '../lib/dispatch-sheet';
import { openCustomerPdf } from '../lib/dispatch-customer-pdf';
import { cx } from './ui';

export function CustomerPdfButton({
  sheet,
  group,
  progress,
  onNotify,
  variant = 'compact',
  className,
}: {
  sheet: DispatchSheetDetail;
  group: CustomerGroup;
  progress?: DispatchCustomerProgress;
  onNotify?: (message: string) => void;
  variant?: 'compact' | 'mobile';
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  // Se reutiliza la sesión ya cargada: el PDF firma quién lo imprime.
  const { data: sessionUser } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await openCustomerPdf(sheet, group, progress, {
        printedBy: sessionUser?.displayName ?? sessionUser?.profitCode ?? null,
      });
      if (result === 'downloaded') {
        onNotify?.('El navegador bloqueó la ventana: el PDF se descargó y puedes abrirlo desde tu lector.');
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'No se pudo generar el PDF de la hoja de carga.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void handleClick()}
      title={`Generar la hoja de carga de ${group.name} en PDF`}
      aria-label={`Generar la hoja de carga de ${group.name} en PDF`}
      className={cx(
        variant === 'mobile'
          ? 'inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-pill border border-outline-variant/50 px-space-md font-bold text-label-md text-on-surface-variant disabled:opacity-40'
          : 'inline-flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40',
        className,
      )}
    >
      {busy ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : (
        <FileDown aria-hidden className="size-3.5" />
      )}
      {busy ? 'Generando…' : 'PDF'}
    </button>
  );
}
