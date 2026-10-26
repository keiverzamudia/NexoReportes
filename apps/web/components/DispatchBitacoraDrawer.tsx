'use client';

// ============================================================
// Bitácora del despacho: solo ADMIN.
//
// El API no entrega los eventos a los demás roles; este drawer es la única
// superficie donde se leen. El mensaje también es exclusivo del administrador.
// ============================================================

import type { DispatchSheetDetail } from '@nexo/contracts';
import { Loader2, MessageSquare, Send, X } from 'lucide-react';
import { EventTimeline } from './DispatchSheetParts';
import { Badge } from './ui';

interface DispatchBitacoraDrawerProps {
  open: boolean;
  sheet: DispatchSheetDetail;
  message: string;
  onMessageChange: (value: string) => void;
  onSend: (event: React.FormEvent) => void;
  onClose: () => void;
  busy: boolean;
}

export function DispatchBitacoraDrawer({
  open,
  sheet,
  message,
  onMessageChange,
  onSend,
  onClose,
  busy,
}: DispatchBitacoraDrawerProps) {
  if (!open) return null;

  return (
    <div role="presentation" className="animate-fade fixed inset-0 z-50 flex justify-end bg-primary/30 backdrop-blur-sm">
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-bitacora-title"
        className="animate-rise flex h-full w-full max-w-lg flex-col border-l border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <header className="flex items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm">
          <div className="flex items-center gap-space-sm">
            <span className="grid size-9 place-items-center rounded-lg bg-primary-fixed text-primary">
              <MessageSquare aria-hidden className="size-4" />
            </span>
            <div>
              <h2 id="dispatch-bitacora-title" className="font-semibold text-primary">
                Bitácora
              </h2>
              <p className="text-label-sm normal-case text-on-surface-variant">
                Solo administradores · {sheet.number}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-space-xs">
            <Badge tone="muted">{sheet.events.length}</Badge>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar bitácora"
              className="grid size-9 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-space-md">
          <EventTimeline events={sheet.events} />
        </div>

        <form onSubmit={onSend} className="flex items-end gap-space-xs border-t border-outline-variant/30 bg-surface-container-low/50 p-space-sm">
          <label className="flex-1">
            <span className="sr-only">Mensaje para la contraparte</span>
            <textarea
              value={message}
              onChange={(event) => onMessageChange(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Escribe una nota en la bitácora…"
              className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-1 text-body-md outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
            />
          </label>
          <button
            type="submit"
            disabled={!message.trim() || busy}
            className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-on-primary transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
          >
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
            Enviar
          </button>
        </form>
      </aside>
    </div>
  );
}
