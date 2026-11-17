'use client';

// ============================================================
// Fecha de entrega del pedido en Profit.
//
// Se muestra la fecha real (dbo.cotiz_c.fec_venc). Si la sesión tiene el
// permiso «Cambiar fecha de entrega», un doble clic (o un toque en móvil)
// abre el editor, que escribe en Profit. La emisión nunca se edita aquí.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtDate } from './ui';

export function DeliveryDateButton({
  date,
  onEdit,
  canEdit = true,
  label,
  hint,
  className = '',
}: {
  /** Entrega actual (Profit). */
  date: string | null;
  onEdit: () => void;
  canEdit?: boolean;
  label: string;
  /** Texto extra del tooltip (p. ej. «3 pedidos con fechas distintas»). */
  hint?: string;
  className?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pointerType = useRef<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const action = canEdit ? 'Doble clic para cambiar la entrega en Profit' : null;

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

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label}. Entrega Profit ${fmtDate(date)}.${action ? ` ${action}.` : ''}`}
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
        className={`select-none whitespace-nowrap rounded-md px-1 py-0.5 text-label-sm tabular-nums text-on-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70 ${
          canEdit ? 'cursor-pointer hover:bg-surface-container-low hover:text-primary' : 'cursor-default'
        } ${className}`}
      >
        {fmtDate(date)}
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-on-primary/55">Entrega en Profit</p>
            <p className="mt-0.5 text-label-md font-semibold tabular-nums">{fmtDate(date)}</p>
            {hint && <p className="mt-0.5 text-label-sm text-on-primary/65">{hint}</p>}
            {action && <p className="mt-1 text-label-sm font-semibold text-secondary-container">{action}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
