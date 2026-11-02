'use client';

// ============================================================
// Ayuda contextual de tablas.
//
// Tres capas, todas con el mismo contenido (`HelpTerm`):
//  1. `ColumnHelp`: icono tenue en el encabezado → popover (portal, sin
//     recortes por el scroll de la tabla).
//  2. En pantallas táctiles el popover se sustituye por una hoja inferior.
//  3. `ModuleHelp`: botón «¿Cómo se calcula?» → cajón lateral con el glosario
//     completo y las reglas del informe.
//
// Sin dependencias nuevas: solo `lucide-react` y React.
// ============================================================

import { CircleHelp, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { HelpTerm } from '../../content/help/types';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const PANEL_WIDTH = 320;
const OFFSET = 8;
const VIEWPORT = 10;

type Rect = { top: number; right: number; bottom: number; left: number; width: number; height: number };

function FormulaBlock({ term }: { term: HelpTerm }) {
  if (!term.formula) return null;
  return (
    <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-sm py-space-2xs">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-outline">Fórmula</p>
      <p className="mt-0.5 font-mono text-[12.5px] leading-snug text-on-surface">{term.formula}</p>
    </div>
  );
}

function HelpBody({ term }: { term: HelpTerm }) {
  return (
    <div className="flex flex-col gap-space-xs">
      <div className="flex items-start justify-between gap-space-sm">
        <p className="text-label-lg font-bold text-on-surface">{term.title}</p>
      </div>
      <p className="text-body-md leading-snug text-on-surface-variant">{term.what}</p>
      <FormulaBlock term={term} />
      {term.source && (
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-outline/90">{term.source}</p>
      )}
    </div>
  );
}

/** Botón + popover anclado (escritorio) / hoja inferior (táctil). */
export function ColumnHelp({ term, label }: { term: HelpTerm; label: string }) {
  const [open, setOpen] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => setMounted(true), []);

  const openPanel = () => {
    const button = buttonRef.current;
    if (button) {
      const r = button.getBoundingClientRect();
      setRect({ top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height });
    }
    setCoarse(window.matchMedia('(pointer: coarse)').matches);
    setOpen(true);
  };

  const dismiss = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Qué significa ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? dismiss() : openPanel())}
        className={cx(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-outline/70 transition-opacity',
          'opacity-0 hover:text-primary focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-container',
          'group-hover/th:opacity-100 [@media(pointer:coarse)]:opacity-100',
        )}
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </button>

      {mounted && open && rect
        ? createPortal(
            coarse ? (
              <SheetPanel id={panelId} term={term} onDismiss={dismiss} />
            ) : (
              <AnchoredPanel id={panelId} term={term} anchor={rect} onDismiss={dismiss} />
            ),
            document.body,
          )
        : null}
    </>
  );
}

function AnchoredPanel({
  id,
  term,
  anchor,
  onDismiss,
}: {
  id: string;
  term: HelpTerm;
  anchor: Rect;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const place = () => {
      const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT * 2);
      const height = panel.offsetHeight || 180;
      let left = anchor.left + anchor.width / 2 - width / 2;
      left = Math.min(Math.max(left, VIEWPORT), Math.max(VIEWPORT, window.innerWidth - width - VIEWPORT));
      let top = anchor.bottom + OFFSET;
      if (top + height > window.innerHeight - VIEWPORT) {
        const above = anchor.top - OFFSET - height;
        top = above >= VIEWPORT ? above : Math.max(VIEWPORT, window.innerHeight - height - VIEWPORT);
      }
      setPos({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    // `true`: también escucha el scroll del contenedor de la tabla.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    const onPointer = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [onDismiss]);

  return (
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={term.title}
      tabIndex={-1}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: pos?.width ?? Math.min(PANEL_WIDTH, VIEWPORT * 2 + 300),
        opacity: pos ? 1 : 0,
      }}
      className="z-[90] rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-space-md font-normal normal-case tracking-normal text-on-surface shadow-[0_18px_44px_-16px_rgb(8_29_44_/_0.4)] transition-opacity duration-150 motion-reduce:transition-none"
    >
      <HelpBody term={term} />
    </div>
  );
}

function SheetPanel({ id, term, onDismiss }: { id: string; term: HelpTerm; onDismiss: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-on-surface/30 backdrop-blur-[2px]" onPointerDown={onDismiss}>
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={term.title}
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
        className="w-full rounded-t-card border-t border-outline-variant/50 bg-surface-container-lowest px-space-lg pb-space-xl pt-space-md shadow-2xl animate-rise motion-reduce:animate-none"
      >
        <div className="mx-auto mb-space-sm h-1 w-10 rounded-pill bg-outline-variant/60" aria-hidden />
        <HelpBody term={term} />
        <button
          type="button"
          onClick={onDismiss}
          className="mt-space-md w-full rounded-xl bg-surface-container-low py-space-sm text-label-md font-semibold text-on-surface-variant"
        >
          Entendido
        </button>
      </div>
    </div>
  );
}

/**
 * Botón «¿Cómo se calcula?» + cajón lateral con el glosario del módulo.
 * Un único punto de entrada: no agrega nada visible hasta que se usa.
 */
export function ModuleHelp({
  title,
  narrative,
  rules = [],
  terms,
  triggerLabel = '¿Cómo se calcula?',
}: {
  title: string;
  narrative?: ReactNode;
  rules?: string[];
  terms: HelpTerm[];
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-space-2xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary"
      >
        <CircleHelp aria-hidden className="size-4" /> {triggerLabel}
      </button>

      {mounted && open
        ? createPortal(
            <div className="fixed inset-0 z-[95]">
              <button
                type="button"
                aria-label="Cerrar ayuda"
                onClick={close}
                className="absolute inset-0 cursor-default bg-on-surface/30 backdrop-blur-[2px]"
              />
              <aside
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onKeyDown={onKeyDown}
                className="absolute right-0 top-0 flex h-full w-full max-w-[27rem] flex-col border-l border-outline-variant/50 bg-surface-container-lowest shadow-2xl animate-rise motion-reduce:animate-none"
              >
                <header className="flex items-start justify-between gap-space-md border-b border-outline-variant/30 px-space-lg py-space-md">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-outline">Ayuda</p>
                    <h2 id={titleId} className="text-title-md font-bold text-on-surface">
                      {title}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Cerrar ayuda"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </header>

                <div className="flex-1 overflow-y-auto px-space-lg py-space-md">
                  {narrative && (
                    <div className="mb-space-lg rounded-xl border border-primary-container/15 bg-primary-fixed/40 px-space-md py-space-sm">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/70">En una frase</p>
                      <p className="mt-1 text-body-md leading-relaxed text-on-surface">{narrative}</p>
                    </div>
                  )}

                  {rules.length > 0 && (
                    <section className="mb-space-lg">
                      <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-outline">Reglas del informe</h3>
                      <ul className="mt-space-xs flex flex-col gap-1">
                        {rules.map((rule) => (
                          <li key={rule} className="flex gap-space-xs text-body-sm leading-snug text-on-surface-variant">
                            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-outline-variant" />
                            {rule}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-outline">Columnas</h3>
                    <dl className="mt-space-xs divide-y divide-outline-variant/25">
                      {terms.map((term) => (
                        <div key={term.id} className="flex flex-col gap-space-2xs py-space-sm">
                          <dt className="text-label-lg font-bold text-on-surface">{term.title}</dt>
                          <dd className="text-body-sm leading-snug text-on-surface-variant">{term.what}</dd>
                          <dd>
                            <FormulaBlock term={term} />
                            {term.source && (
                              <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-outline/90">
                                {term.source}
                              </p>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                </div>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
