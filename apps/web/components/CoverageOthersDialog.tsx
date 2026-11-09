'use client';

// ============================================================
// Detalle de «Otros» en «Cobertura en vivo».
//
// El gráfico agrupa en una sola fila los productos fuera del top 12 por
// volumen. Sin este modal el usuario no sabía qué artículos estaban dentro,
// así que aquí se listan con su código, descripción y el mismo desglose de
// kg que dibujan las barras. Es solo lectura: no altera la simulación.
// ============================================================

import { Boxes, ListTree, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { CoverageRow } from '../lib/coverage';
import { CoverageBar, DataTable, cx, fmtQty, type Column } from './ui';

function sumBy(rows: CoverageRow[], pick: (row: CoverageRow) => number): number {
  return rows.reduce((acc, row) => acc + pick(row), 0);
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'primary' | 'secondary' | 'warning' | 'error';
}) {
  const TONE: Record<typeof tone, string> = {
    primary: 'text-primary',
    secondary: 'text-secondary',
    warning: 'text-warning',
    error: 'text-error',
  };
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/60 p-space-sm">
      <span className="block font-semibold uppercase tracking-wider text-label-sm text-outline">{label}</span>
      <p className={cx('mt-0.5 text-title-md font-black tabular-nums', TONE[tone])}>{value}</p>
    </div>
  );
}

export function CoverageOthersDialog({
  open,
  rows,
  onClose,
}: {
  open: boolean;
  rows: CoverageRow[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || rows.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, rows.length, onClose]);

  const columns: Column<CoverageRow>[] = [
    {
      key: 'producto',
      header: 'Producto',
      kind: 'id',
      sortValue: (row) => row.code,
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-bold tabular-nums text-primary">{row.code}</span>
          <span className="max-w-[24rem] truncate text-label-sm font-normal text-on-surface-variant" title={row.description}>
            {row.description}
          </span>
        </span>
      ),
    },
    {
      key: 'comprometido',
      header: 'Comprometido',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.committedKg,
      render: (row) => <span className="tabular-nums text-on-surface-variant">{fmtQty(row.committedKg, 0)}</span>,
    },
    {
      key: 'despachable',
      header: 'Despachable',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.availableKg,
      render: (row) => <span className="tabular-nums text-on-surface-variant">{fmtQty(row.availableKg, 0)}</span>,
    },
    {
      key: 'faltante',
      header: 'Faltante',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.missingKg,
      render: (row) => <span className="tabular-nums text-on-surface-variant">{fmtQty(row.missingKg, 0)}</span>,
    },
    {
      key: 'total',
      header: 'Demanda (kg)',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.totalKg,
      render: (row) => <span className="font-bold tabular-nums text-primary">{fmtQty(row.totalKg, 0)}</span>,
    },
    {
      key: 'cobertura',
      header: '% potencial',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.coveragePct,
      render: (row) => (
        <span className="inline-flex min-w-24 flex-col items-end gap-1">
          <span className="font-bold tabular-nums text-primary">{row.coveragePct}%</span>
          <CoverageBar ratio={row.coveragePct / 100} className="w-24" />
        </span>
      ),
    },
  ];

  if (!open || rows.length === 0) return null;

  const committedKg = sumBy(rows, (row) => row.committedKg);
  const availableKg = sumBy(rows, (row) => row.availableKg);
  const missingKg = sumBy(rows, (row) => row.missingKg);
  const totalKg = committedKg + availableKg + missingKg;
  const coveragePct = totalKg > 0 ? Math.round(((committedKg + availableKg) / totalKg) * 100) : 100;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="animate-fade fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-primary/35 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coverage-others-title"
        className="animate-rise flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant/35 bg-surface-container-lowest shadow-hero sm:max-h-[92vh] sm:rounded-2xl"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <ListTree aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                Cobertura en vivo · Detalle agrupado
              </p>
              <h2 id="coverage-others-title" className="text-title-md text-primary">
                Otros ({rows.length}) · {fmtQty(totalKg, 0)} kg
              </h2>
              <p className="text-label-md text-on-surface-variant">
                {rows.length} productos fuera del top 12 por volumen. El gráfico los muestra sumados en una sola barra.
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle de «Otros»"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-space-md overflow-y-auto p-space-md sm:p-space-lg">
          <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
            <Metric label="Comprometido" value={`${fmtQty(committedKg, 0)} kg`} tone="primary" />
            <Metric label="Despachable" value={`${fmtQty(availableKg, 0)} kg`} tone="secondary" />
            <Metric label="Faltante" value={`${fmtQty(missingKg, 0)} kg`} tone="warning" />
            <Metric label="Cobertura" value={`${coveragePct}%`} tone={coveragePct >= 100 ? 'secondary' : coveragePct > 0 ? 'warning' : 'error'} />
          </div>

          <DataTable<CoverageRow>
            columns={columns}
            rows={rows}
            rowKey={(row) => row.code}
            maxHeightClass="md:max-h-[46vh]"
            footer={
              <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
                <td className="px-space-sm py-space-xs uppercase text-label-sm text-outline">Total ({rows.length} productos)</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-on-surface-variant">{fmtQty(committedKg, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-on-surface-variant">{fmtQty(availableKg, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-on-surface-variant">{fmtQty(missingKg, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-primary">{fmtQty(totalKg, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-primary">{coveragePct}%</td>
              </tr>
            }
            mobileSummary={
              <div className="flex items-center justify-between gap-space-sm px-space-sm py-space-xs font-bold">
                <span className="uppercase text-label-sm text-outline">Total ({rows.length})</span>
                <span className="tabular-nums text-primary">
                  {fmtQty(committedKg, 0)} + {fmtQty(availableKg, 0)} + {fmtQty(missingKg, 0)} = {fmtQty(totalKg, 0)} kg
                </span>
              </div>
            }
          />

          <p className="flex items-start gap-space-xs rounded-xl bg-surface-container-low/70 px-space-sm py-2 text-label-md text-on-surface-variant">
            <Boxes aria-hidden className="mt-0.5 size-4 shrink-0 text-outline" />
            Se agrupan aquí los productos fuera del top 12 por volumen. Los kg se recalculan en vivo al marcar renglones en
            el simulador; «comprometido» es lo ya marcado y «despachable» lo que aún cubre la existencia libre.
          </p>
        </div>
      </div>
    </div>
  );
}
