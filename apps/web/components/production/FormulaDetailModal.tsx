'use client';

// ============================================================
// Ficha de una cédula de producción: selector de recetas, costo
// unitario, costo por kg/saco y costo de reposición con su desglose.
// Se abre con doble clic sobre el producto o con «Ver desglose».
// ============================================================

import type { ProductionCurrency, ProductionFormulaDetailResponse } from '@nexo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FlaskConical, Package, Save, Star, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { Badge, Segmented, Select, cx, fmtQty } from '../ui';

const KIND_LABEL: Record<string, string> = {
  MASTER: 'Maestra',
  BASE: 'Base',
  BATCH: 'Lote',
};

function money(value: number | null, currency: ProductionCurrency): string {
  if (value === null) return '—';
  const abs = Math.abs(value);
  // Micro-ingredientes: 2 decimales los convertirían en 0,00 y no se podría
  // verificar la suma de la receta.
  const decimals = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return (
    new Intl.NumberFormat('es-VE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value) +
    (currency === 'USD' ? ' USD' : ' Bs')
  );
}

export function FormulaDetailModal({
  open,
  detail,
  loading,
  error,
  currency,
  onCurrencyChange,
  selectedFormulaId,
  onSelectFormula,
  onClose,
  onMakePrincipal,
  principalPending,
}: {
  open: boolean;
  detail: ProductionFormulaDetailResponse | undefined;
  loading: boolean;
  error: string | null;
  currency: ProductionCurrency;
  onCurrencyChange: (currency: ProductionCurrency) => void;
  selectedFormulaId: number | null;
  onSelectFormula: (id: number) => void;
  onClose: () => void;
  onMakePrincipal: (formulaId: number) => void;
  principalPending: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Escape cierra, el fondo no scrollea y el foco entra al modal.
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(frame);
      previousFocus.current?.focus();
    };
  }, [open]);

  // MASTER y BASE pueden compartir id: se muestra una sola opción por cédula.
  const formulas = useMemo(() => {
    const seen = new Map<number, ProductionFormulaDetailResponse['formulas'][number]>();
    for (const formula of detail?.formulas ?? []) if (!seen.has(formula.id)) seen.set(formula.id, formula);
    return Array.from(seen.values());
  }, [detail]);

  if (!open) return null;

  const selected =
    formulas.find((formula) => formula.id === selectedFormulaId) ??
    formulas.find((formula) => formula.id === detail?.selectedFormulaId) ??
    formulas[0] ??
    null;
  const bulk = !detail?.uom || detail.uom.toUpperCase() !== 'SAC' || !detail.kgPerUom || detail.kgPerUom <= 1;
  const missing = selected
    ? Array.from(
        new Map(
          selected.components
            .filter((component) => component.replacementFallback)
            .map((component) => [component.code, component] as const),
        ).values(),
      )
    : [];
  const ingredientPerSack =
    selected && selected.costPerSack !== null && selected.packagingCostPerSack !== null
      ? selected.costPerSack - selected.packagingCostPerSack
      : selected?.costPerSack ?? null;
  const componentTotal = selected
    ? selected.components.reduce((acc, component) => acc + (component.totalCost ?? 0), 0)
    : 0;
  const componentReplacementTotal = selected
    ? selected.components.reduce((acc, component) => acc + (component.replacementTotalCost ?? 0), 0)
    : 0;

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
        aria-labelledby="formula-detail-title"
        className="animate-rise flex h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant/35 bg-surface-container-lowest shadow-hero sm:h-[92vh] sm:rounded-2xl"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <FlaskConical aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                Ficha de fórmula · {formulas.length} cédulas
              </p>
              <h2 id="formula-detail-title" className="truncate font-display text-title-lg text-primary">
                {detail ? `${detail.productCode} · ${detail.description}` : 'Abriendo ficha…'}
              </h2>
              <div className="mt-space-2xs flex flex-wrap items-center gap-space-2xs text-label-sm text-on-surface-variant">
                <span>
                  {detail?.uom ?? '—'}
                  {detail?.kgPerUom ? ` · ${fmtQty(detail.kgPerUom, 2)} kg/saco` : ' · sin presentación de saco'}
                </span>
                {bulk && <Badge tone="muted">Granel</Badge>}
                {detail?.packagingCode && (
                  <Badge tone="primary">
                    <Package aria-hidden className="mr-1 size-3" /> {detail.packagingCode}
                  </Badge>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-label-sm text-on-surface-variant">Costos</span>
                  <Segmented
                    value={currency}
                    onChange={onCurrencyChange}
                    options={[
                      { value: 'USD', label: 'USD' },
                      { value: 'BS', label: 'Bs' },
                    ]}
                    ariaLabel="Moneda de la ficha"
                  />
                </span>
              </div>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar ficha de fórmula"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-space-md overflow-y-auto overscroll-contain p-space-md pb-6 sm:p-space-lg">
          {loading && <p className="text-body-md text-on-surface-variant">Cargando desglose…</p>}
          {error && (
            <p role="alert" className="text-body-md text-error">
              {error}
            </p>
          )}

          {selected && detail && (
            <>
              <div className="grid shrink-0 gap-space-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <label className="flex min-w-0 flex-col gap-space-2xs">
                  <span className="text-label-sm font-semibold uppercase tracking-wider text-outline">
                    Cédula / receta ({formulas.length})
                  </span>
                  <Select
                    value={String(selected.id)}
                    onChange={(value) => onSelectFormula(Number(value))}
                    options={formulas.map((formula) => ({
                      value: String(formula.id),
                      label: `${formula.id} · ${KIND_LABEL[formula.kind] ?? formula.kind} · ${
                        formula.name || 'sin nombre'
                      }${formula.isStandard ? ' · Principal' : ''}`,
                    }))}
                    ariaLabel="Cédula de la ficha"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-space-sm">
                  {selected.isStandard ? (
                    <Badge tone="success">
                      <Star aria-hidden className="mr-1 size-3" /> Principal
                    </Badge>
                  ) : selected.kind === 'BATCH' ? (
                    <Badge tone="muted">Lote histórico · no se marca principal</Badge>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onMakePrincipal(selected.id)}
                      disabled={principalPending}
                      className="inline-flex h-9 items-center gap-space-2xs rounded-xl border border-primary-container/40 px-space-md text-label-sm font-semibold text-primary disabled:opacity-60"
                    >
                      <Star aria-hidden className="size-3.5" />
                      Marcar principal
                    </button>
                  )}
                  <span className="text-label-sm text-on-surface-variant">
                    Lote {selected.batchKg ? `${fmtQty(selected.batchKg, 0)} kg` : '—'} · Salida{' '}
                    {fmtQty(selected.outputQty, 2)} {selected.outputUom}
                  </span>
                </div>
              </div>

              <div className="grid shrink-0 grid-cols-2 gap-space-sm lg:grid-cols-5">
                <Metric
                  label="Costo de la salida"
                  value={money(selected.totalCost, currency)}
                  hint={`${fmtQty(selected.outputQty, 2)} ${selected.outputUom} · incluye empaque`}
                />
                <Metric label="Costo/kg" value={money(selected.costPerKg, currency)} hint="último costo de Profit" />
                <Metric
                  label="Costo/saco"
                  value={money(selected.costPerSack, currency)}
                  hint={bulk ? 'granel: no aplica' : `saco de ${fmtQty(detail.kgPerUom ?? 0, 0)} kg`}
                  tone={selected.costPerSack === null ? 'muted' : 'primary'}
                />
                <Metric
                  label="P/reposición · kg"
                  value={money(selected.replacementCostPerKg, currency)}
                  hint="fila Reposición de Profit"
                  tone="success"
                />
                <Metric
                  label="P/reposición · saco"
                  value={money(selected.replacementCostPerSack, currency)}
                  hint={bulk ? 'granel: no aplica' : 'reposición × presentación'}
                  tone={selected.replacementCostPerSack === null ? 'muted' : 'success'}
                />
              </div>

              {missing.length > 0 && (
                <div className="shrink-0 rounded-xl bg-warning-container/35 px-space-md py-space-sm text-label-md text-on-surface">
                  <p className="flex items-center gap-space-2xs font-semibold text-warning">
                    <AlertTriangle aria-hidden className="size-4 shrink-0" />
                    {missing.length} materia(s) prima(s) sin costo de reposición en Profit
                  </p>
                  <p className="mt-space-2xs text-on-surface-variant">
                    Se calculó con el último costo: {missing.slice(0, 8).map((component) => component.description || component.code).join(' · ')}
                    {missing.length > 8 ? ` · +${missing.length - 8} más` : ''}
                  </p>
                </div>
              )}

              <div className="shrink-0 overflow-hidden rounded-xl border border-outline-variant/30">
                <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low px-space-md py-space-sm">
                  <p className="font-semibold text-on-surface">Desglose de materias primas</p>
                  <div className="flex flex-wrap items-center gap-space-md text-label-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-primary" /> Costo actual
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-secondary" /> Reposición
                    </span>
                    <span className="text-on-surface-variant">{selected.components.length} líneas</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-body-md">
                    <thead className="sticky top-0 z-[1] bg-surface-container-lowest">
                      <tr className="border-b border-outline-variant/30 text-label-sm uppercase tracking-wider text-outline">
                        <th className="px-space-sm py-2">#</th>
                        <th className="px-space-sm py-2">Materia prima</th>
                        <th className="px-space-sm py-2">Tipo</th>
                        <th className="px-space-sm py-2 text-right">Cantidad</th>
                        <th className="px-space-sm py-2 text-right">Costo unit.</th>
                        <th className="px-space-sm py-2 text-right">Total</th>
                        <th className="px-space-sm py-2 text-right">% costo</th>
                        <th className="px-space-sm py-2 text-right">Rep. unit.</th>
                        <th className="px-space-sm py-2 text-right">Total rep.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/20">
                      {selected.components.map((component) => (
                        <tr key={`${component.line}-${component.code}`} className="hover:bg-surface-container-low/60">
                          <td className="px-space-sm py-space-xs text-on-surface-variant">{component.line}</td>
                          <td className="px-space-sm py-space-xs">
                            <p className="font-semibold text-primary">{component.code}</p>
                            <p className="max-w-[18rem] truncate text-label-sm text-on-surface-variant" title={component.description}>
                              {component.description}
                            </p>
                          </td>
                          <td className="px-space-sm py-space-xs">
                            <Badge tone={component.type === 'EMPAQ' ? 'primary' : 'muted'}>{component.type}</Badge>
                          </td>
                          <td className="px-space-sm py-space-xs text-right tabular-nums">
                            {fmtQty(component.qty, component.qty < 0.001 ? 6 : 4)} {component.uom}
                          </td>
                          <td className="px-space-sm py-space-xs text-right tabular-nums">{money(component.unitCost, currency)}</td>
                          <td className="px-space-sm py-space-xs text-right font-semibold tabular-nums">
                            {money(component.totalCost, currency)}
                          </td>
                          <td className="px-space-sm py-space-xs text-right tabular-nums text-on-surface-variant">
                            {component.costSharePct === null ? '—' : `${fmtQty(component.costSharePct, 1)}%`}
                          </td>
                          <td className="px-space-sm py-space-xs text-right tabular-nums">
                            <span className="inline-flex items-center justify-end gap-1">
                              {component.replacementUnitCost === null ? '—' : money(component.replacementUnitCost, currency)}
                              {component.replacementFallback && (
                                <span
                                  className="size-1.5 rounded-full bg-warning"
                                  title="Sin valor de reposición en Profit: se usó el último costo."
                                />
                              )}
                            </span>
                          </td>
                          <td className="px-space-sm py-space-xs text-right tabular-nums text-secondary">
                            {money(component.replacementTotalCost, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-surface-container-low">
                      <tr className="border-t-2 border-outline-variant/30 font-bold">
                        <td colSpan={5} className="px-space-sm py-space-sm uppercase text-label-sm text-outline">
                          Total componentes (el empaque se suma abajo)
                        </td>
                        <td className="px-space-sm py-space-sm text-right tabular-nums">
                          {money(componentTotal, currency)}
                        </td>
                        <td className="px-space-sm py-space-sm text-right text-label-sm text-outline">100%</td>
                        <td className="px-space-sm py-space-sm text-right text-label-sm text-outline">total</td>
                        <td className="px-space-sm py-space-sm text-right tabular-nums text-secondary">
                          {money(componentReplacementTotal, currency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="flex flex-col gap-space-2xs border-t border-outline-variant/30 px-space-md py-space-sm text-label-md">
                  <div className="flex flex-wrap items-center justify-between gap-space-sm">
                    <span className="text-on-surface-variant">
                      Componentes <strong className="text-on-surface">{money(selected.ingredientCostPerKg, currency)}/kg</strong>
                      {selected.packagingCostPerKg === null ? (
                        <> · sin empaque aparte</>
                      ) : (
                        <>
                          {' '}
                          + empaque{' '}
                          <strong className="text-on-surface">{money(selected.packagingCostPerKg, currency)}/kg</strong>
                        </>
                      )}{' '}
                      ={' '}
                      <strong className="text-primary">{money(selected.costPerKg, currency)}/kg</strong>
                    </span>
                    <span className="text-on-surface-variant">
                      P/reposición/kg{' '}
                      <strong className="text-secondary">{money(selected.replacementCostPerKg, currency)}</strong>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-space-sm">
                    <span className="text-on-surface-variant">
                      {bulk
                        ? 'Granel: se vende por kg, sin costo por saco.'
                        : selected.packagingCostPerSack === null
                          ? `Saco de ${fmtQty(detail.kgPerUom ?? 0, 0)} kg · costo ${money(
                              selected.costPerSack,
                              currency,
                            )}`
                          : `Saco de ${fmtQty(detail.kgPerUom ?? 0, 0)} kg · componentes ${money(
                              ingredientPerSack,
                              currency,
                            )} + empaque ${money(selected.packagingCostPerSack, currency)} = ${money(
                              selected.costPerSack,
                              currency,
                            )}`}
                    </span>
                    <span className="text-on-surface-variant">
                      Reposición/saco{' '}
                      <strong className="text-secondary">{money(selected.replacementCostPerSack, currency)}</strong>
                    </span>
                  </div>
                </div>
              </div>

              {detail.alerts.length > 0 && (
                <ul className="flex shrink-0 flex-col gap-space-2xs text-label-md text-on-surface-variant">
                  {detail.alerts.map((alert) => (
                    <li key={alert} className="flex items-start gap-space-2xs">
                      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
                      {alert}
                    </li>
                  ))}
                </ul>
              )}

              <PackagingEditor detail={detail} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'primary' | 'success' | 'muted';
}) {
  return (
    <div
      className={cx(
        'rounded-xl border border-outline-variant/30 p-space-sm',
        tone === 'success' && 'bg-secondary-container/10',
        tone === 'primary' && 'bg-primary-container/5',
        tone === 'muted' && 'bg-surface-container/50',
        tone === 'default' && 'bg-surface-container-lowest',
      )}
    >
      <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">{label}</p>
      <p className="mt-1 font-display text-title-md font-bold tabular-nums text-on-surface">{value}</p>
      {hint && <p className="text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

function PackagingEditor({ detail }: { detail: ProductionFormulaDetailResponse }) {
  const queryClient = useQueryClient();
  const [materialCode, setMaterialCode] = useState(detail.packagingCode ?? '');
  const [qtyPerUnit, setQtyPerUnit] = useState(String(detail.packagingQtyPerUnit ?? 1));

  useEffect(() => {
    setMaterialCode(detail.packagingCode ?? '');
    setQtyPerUnit(String(detail.packagingQtyPerUnit ?? 1));
  }, [detail.productCode, detail.packagingCode, detail.packagingQtyPerUnit]);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(`/production/packaging/${encodeURIComponent(detail.productCode)}`, {
        method: 'PUT',
        body: JSON.stringify({
          materialCode: materialCode.trim().toUpperCase(),
          qtyPerUnit: Number(qtyPerUnit.replace(',', '.')) || 1,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-formula'] });
      queryClient.invalidateQueries({ queryKey: ['production-formulas'] });
      queryClient.invalidateQueries({ queryKey: ['production-plan'] });
      queryClient.invalidateQueries({ queryKey: ['production-explosion'] });
    },
  });

  const options = detail.packagingOptions.length
    ? detail.packagingOptions
    : [
        { code: 'MATPRI06', description: 'Saco sin impresión' },
        { code: 'MATPRI72', description: 'Saco naranja' },
        { code: 'MATPRI73', description: 'Saco naranja 74x50' },
        { code: 'MATPRI76', description: 'Saco verde' },
        { code: 'MATPRI79', description: 'Saco azul' },
      ];

  return (
    <div className="flex shrink-0 flex-wrap items-end gap-space-sm rounded-xl bg-surface-container/60 p-space-sm">
      <div className="min-w-[16rem] flex-1">
        <label className="mb-space-2xs block text-label-sm font-semibold uppercase tracking-wider text-outline">
          Empaque del producto
        </label>
        <Select
          value={materialCode}
          onChange={setMaterialCode}
          options={options.map((option) => ({ value: option.code, label: `${option.code} · ${option.description}` }))}
          ariaLabel="Material de empaque"
        />
      </div>
      <div className="w-28">
        <label className="mb-space-2xs block text-label-sm font-semibold uppercase tracking-wider text-outline">
          Unid./saco
        </label>
        <input
          value={qtyPerUnit}
          onChange={(event) => setQtyPerUnit(event.target.value)}
          inputMode="decimal"
          className="h-10 w-full rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-right text-body-md tabular-nums text-on-surface focus:border-transparent focus:outline-none focus:ring-2 focus:ring-secondary-container/70"
          aria-label="Unidades de empaque por saco"
        />
      </div>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || materialCode.trim().length === 0}
        className="inline-flex h-10 items-center gap-space-2xs rounded-xl border border-primary-container/40 px-space-md text-label-md font-semibold text-primary disabled:opacity-60"
      >
        <Save aria-hidden className="size-4" />
        Guardar empaque
      </button>
      {mutation.isError && (
        <span className="text-label-sm text-error">
          {mutation.error instanceof Error ? mutation.error.message : 'No se pudo guardar'}
        </span>
      )}
    </div>
  );
}
