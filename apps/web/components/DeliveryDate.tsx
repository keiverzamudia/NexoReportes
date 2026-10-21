'use client';

// ============================================================
// Fecha de entrega con capa tentativa.
//
// Una sola fecha visible:
//  · verde cuando tiene fecha tentativa;
//  · normal cuando es la original de Profit.
// Al pasar el mouse (o enfocar) muestra la fecha original.
// Doble clic abre el editor (también un toque en móvil).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtDate } from './ui';

export function DeliveryDateButton({
  tentativeDate,
  originalDate,
  originalTo,
  onEdit,
  canEdit = true,
  label,
  hint,
  className = '',
}: {
  tentativeDate: string | null;
  originalDate: string | null;
  /** Última fecha original del grupo (para mostrar un rango en el tooltip). */
  originalTo?: string | null;
  onEdit: () => void;
  canEdit?: boolean;
  label: string;
  /** Texto extra del tooltip (p. ej. "3 de 4 con fecha tentativa"). */
  hint?: string;
  className?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pointerType = useRef<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const display = tentativeDate ?? originalDate;
  const hasTentative = Boolean(tentativeDate);
  const action = canEdit ? (hasTentative ? 'Doble clic para cambiar la fecha' : 'Doble clic para asignar fecha') : null;

  const showTip = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = rect.top < 96;
    setTip({ x: rect.left + rect.width / 2, y: below ? rect.bottom + 8 : rect.top - 8, below });
  };
  const hideTip = () => setTip(null);

  // El tooltip es fixed + portal: no lo recorta el overflow de la tabla.
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [tip]);

  const originalLabel =
    originalDate && originalTo && originalTo !== originalDate
      ? `${fmtDate(originalDate)} – ${fmtDate(originalTo)}`
      : fmtDate(originalDate);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label}. ${hasTentative ? 'Fecha tentativa' : 'Fecha original'} ${fmtDate(display)}. Original ${originalLabel}.${action ? ` ${action}.` : ''}`}
        aria-disabled={!canEdit}
        tabIndex={canEdit ? 0 : -1}
        onPointerDown={(event) => {
          pointerType.current = event.pointerType;
        }}
        onClick={(event) => {
          if (!canEdit) return;
          // Teclado (detail 0) y touch abren directo; mouse espera el doble clic.
          if (event.detail === 0 || pointerType.current !== 'mouse') onEdit();
        }}
        onDoubleClick={(event) => {
          if (!canEdit) return;
          event.preventDefault();
          onEdit();
        }}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        className={`select-none whitespace-nowrap rounded-md px-1 py-0.5 text-label-sm tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70 ${
          hasTentative ? 'font-semibold text-secondary' : 'text-outline'
        } ${canEdit ? 'cursor-pointer hover:bg-surface-container-low hover:text-primary' : 'cursor-default'} ${className}`}
      >
        {fmtDate(display)}
      </button>

      {tip &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left: tip.x,
              top: tip.y,
              transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`,
            }}
            className="pointer-events-none z-[80] w-max max-w-[17rem] rounded-xl bg-primary px-space-sm py-space-xs text-on-primary shadow-[0_18px_40px_-24px_rgba(8,29,44,.7)]"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-on-primary/55">Original</p>
            <p className="mt-0.5 text-label-md font-semibold tabular-nums">{originalLabel}</p>
            {hint && <p className="mt-0.5 text-label-sm text-on-primary/65">{hint}</p>}
            {action && <p className="mt-1 text-label-sm font-semibold text-secondary-container">{action}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
