'use client';

// ============================================================
// Selector de producto para reportes.
//
// Combobox accesible (trigger + búsqueda + listbox) que permite:
//  · volver al consolidado con la primera opción «Todos los productos»,
//  · buscar por código o descripción,
//  · navegar con ↑ ↓ / Enter / Esc.
//
// No conoce el dominio: recibe `options` ya filtradas por quien lo usa.
// ============================================================

import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export interface ProductPickerOption {
  /** Código del artículo (valor seleccionado). */
  value: string;
  description: string;
  /** Presentación de venta: SAC / KG. */
  uom: string;
}

type Entry = { kind: 'all' } | { kind: 'product'; option: ProductPickerOption };

export function ProductPicker({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  options: ProductPickerOption[];
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);

  const entries = useMemo<Entry[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? options.filter(
          (option) =>
            option.value.toLowerCase().includes(needle) || option.description.toLowerCase().includes(needle),
        )
      : options;
    return [{ kind: 'all' }, ...matches.map((option) => ({ kind: 'product' as const, option }))];
  }, [options, query]);

  // Al abrir: limpiar búsqueda, posicionar en la primera opción y enfocar.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function choose(entry: Entry | undefined) {
    if (!entry) return;
    onChange(entry.kind === 'all' ? null : entry.option.value);
    setOpen(false);
  }

  function move(delta: number) {
    setActive((prev) => (entries.length === 0 ? 0 : (prev + delta + entries.length) % entries.length));
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(entries[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  const activeId = entries.length > 0 ? `${listId}-${active}` : undefined;

  return (
    <div ref={rootRef} className="relative w-full">
      <div
        className={`flex h-10 w-full items-center rounded-xl border bg-surface-container-lowest transition-colors focus-within:ring-2 focus-within:ring-secondary-container/70 ${
          open ? 'border-transparent ring-2 ring-secondary-container/70' : 'border-outline-variant/50'
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label="Producto en la gráfica"
          className="flex h-full min-w-0 flex-1 items-center gap-space-xs rounded-l-xl pl-space-sm pr-space-2xs text-left focus:outline-none"
        >
          <Search aria-hidden className="size-4 shrink-0 text-outline" />
          {selected ? (
            <span className="flex min-w-0 flex-1 items-center gap-space-xs">
              <span className="shrink-0 font-bold tabular-nums text-primary">{selected.value}</span>
              <span className="truncate text-label-sm text-on-surface-variant">{selected.description}</span>
            </span>
          ) : (
            <span className="truncate text-body-md text-on-surface-variant">{allLabel}</span>
          )}
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-outline" />
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Quitar el producto y volver al consolidado global"
            title="Volver al global"
            className="mr-space-2xs grid size-7 shrink-0 place-items-center rounded-md text-outline transition-colors hover:bg-surface-container hover:text-primary"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-lift">
          <div className="flex items-center gap-space-xs border-b border-surface-container px-space-sm">
            <Search aria-hidden className="size-4 shrink-0 text-outline" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={true}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Buscar por código o descripción…"
              className="h-10 w-full bg-transparent text-body-md text-on-surface placeholder:text-outline focus:outline-none"
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Productos" className="max-h-72 overflow-auto p-1">
            {entries.map((entry, index) => {
              const isActive = index === active;
              const isSelected = entry.kind === 'all' ? !selected : selected?.value === entry.option.value;
              return (
                <li
                  key={entry.kind === 'all' ? '__all__' : entry.option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(entry)}
                  className={`flex cursor-pointer items-center gap-space-sm rounded-lg px-space-sm py-space-2xs ${
                    isActive ? 'bg-surface-container' : ''
                  }`}
                >
                  {entry.kind === 'all' ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-semibold text-on-surface">{allLabel}</span>
                        <span className="text-label-sm text-on-surface-variant">Consolidado de todos los artículos</span>
                      </span>
                      {isSelected && <Check aria-hidden className="size-4 shrink-0 text-secondary" />}
                    </>
                  ) : (
                    <>
                      <span className="flex min-w-0 flex-1 items-center gap-space-xs">
                        <span className="shrink-0 font-bold tabular-nums text-primary">{entry.option.value}</span>
                        <span className="truncate text-label-sm text-on-surface-variant" title={entry.option.description}>
                          {entry.option.description}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-md bg-surface-container px-1.5 py-0.5 text-label-sm font-semibold text-on-surface-variant">
                        {entry.option.uom}
                      </span>
                      {isSelected && <Check aria-hidden className="size-4 shrink-0 text-secondary" />}
                    </>
                  )}
                </li>
              );
            })}
            {entries.length === 1 && (
              <li className="px-space-sm py-space-sm text-center text-label-sm text-on-surface-variant">
                Sin coincidencias para «{query}»
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
