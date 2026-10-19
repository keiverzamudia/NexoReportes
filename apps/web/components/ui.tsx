'use client';

// ============================================================
// Primitivas de UI del design system "Nexo Producción".
// Reutilizables por todos los módulos: cabecera de página, KPIs,
// tarjetas, badges de estado, inputs densos (36px) y la tabla única
// (`DataTable`): encabezado fijo, orden por columna, primera columna
// anclada y tarjetas en teléfono.
// ============================================================

import { ChevronDown, ChevronUp, Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function PageHeader({
  eyebrow,
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-space-lg xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <div className="mb-space-2xs flex items-center gap-space-xs font-bold uppercase tracking-wider text-primary text-label-md">
          <Icon aria-hidden className="size-[18px]" />
          <span>{eyebrow}</span>
        </div>
        <h1 className="text-display-lg leading-none italic tracking-tight text-primary">{title}</h1>
        {subtitle && <p className="mt-space-2xs max-w-3xl text-body-md text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-space-sm self-start xl:self-auto">{actions}</div>}
    </header>
  );
}

type Tone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-on-surface',
  primary: 'text-primary',
  success: 'text-secondary',
  danger: 'text-error',
  warning: 'text-warning',
  muted: 'text-on-surface-variant',
};

export function Kpi({
  label,
  value,
  suffix,
  hint,
  tone = 'primary',
  icon: Icon,
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  return (
    <div className="min-w-[140px] rounded-xl bg-surface-container-lowest px-space-md py-space-sm shadow-sm">
      <div className="flex items-center justify-between gap-space-sm">
        <span className="font-semibold uppercase text-label-sm text-outline">{label}</span>
        {Icon && <Icon aria-hidden className="size-[18px] text-primary" />}
      </div>
      <div className={`tabular-nums font-black text-headline-lg ${TONE_TEXT[tone]}`}>
        {value}
        {suffix && <span className="ml-space-xs font-normal text-label-sm text-outline">{suffix}</span>}
      </div>
      {hint && <div className="text-label-sm text-on-surface-variant">{hint}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl bg-surface-container-lowest shadow-sm ${className ?? ''}`}>{children}</section>;
}

const BADGE: Record<Tone, string> = {
  default: 'bg-surface-container-highest text-on-surface',
  primary: 'bg-primary-container text-on-primary',
  success: 'bg-success-container text-on-success-container',
  danger: 'bg-critical-container text-on-critical-container',
  warning: 'bg-warning-container text-on-warning-container',
  muted: 'bg-surface-container-low text-on-surface-variant',
};

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded px-space-sm py-space-2xs font-bold uppercase text-label-sm ${BADGE[tone]}`}>
      {children}
    </span>
  );
}

// Input de filtro denso (36px) según DESIGN.md.
export function TextInput({
  value,
  onChange,
  placeholder,
  icon: Icon,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: LucideIcon;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className ?? ''}`}>
      {Icon && <Icon aria-hidden className="absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-outline" />}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={`h-9 w-full rounded-lg bg-surface text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary-container ${
          Icon ? 'pl-9 pr-space-md' : 'px-space-sm'
        }`}
      />
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={`h-9 w-full cursor-pointer rounded-lg bg-surface px-space-sm text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container ${className ?? ''}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DateInput({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={`h-9 rounded-lg bg-surface px-space-sm text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container ${className ?? ''}`}
    />
  );
}

export function Th({ children, align = 'left', className, rowSpan, colSpan }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string; rowSpan?: number; colSpan?: number }) {
  return (
    <th scope="col" rowSpan={rowSpan} colSpan={colSpan} className={`px-space-sm py-2 font-semibold uppercase text-label-sm text-outline ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className ?? ''}`}>
      {children}
    </th>
  );
}

export function Td({ children, align = 'left', className, title, rowSpan, colSpan }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string; title?: string; rowSpan?: number; colSpan?: number }) {
  return (
    <td title={title} rowSpan={rowSpan} colSpan={colSpan} className={`px-space-sm py-space-xs ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className ?? ''}`}>
      {children}
    </td>
  );
}

// Control segmentado (switch de modos). Pensado para 2–3 opciones.
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex rounded-lg bg-surface-container p-space-2xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-md px-space-md text-label-md transition-colors ${
            value === o.value ? 'bg-primary-container text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-low'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Barra de cobertura: verde (completo) → ámbar (parcial) → rojo (nada).
export function CoverageBar({ ratio, className }: { ratio: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const tone = pct >= 0.999 ? 'var(--color-secondary)' : pct > 0 ? 'var(--color-warning)' : 'var(--color-critical)';
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest ${className ?? ''}`}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, backgroundColor: tone }} />
    </div>
  );
}

// Formateadores compartidos (es-VE).
export function fmtQty(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('es-VE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'short' }).format(new Date(iso));
}

// ---------- Tabla única ----------

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-md bg-surface-container', className)} />;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-space-sm px-space-lg py-space-xl text-center">
      <Icon aria-hidden className="size-7 text-outline" />
      <p className="font-semibold text-title-md text-on-surface">{title}</p>
      {description && <p className="max-w-md text-body-md text-on-surface-variant">{description}</p>}
      {action}
    </div>
  );
}

export type ColumnKind = 'id' | 'metric' | 'field' | 'status' | 'action' | 'detail';

export type Column<T> = {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  /** Cómo se muestra en la tarjeta del teléfono. Por defecto `field`. */
  kind?: ColumnKind;
  render: (row: T) => ReactNode;
  /** Valor para ordenar al pulsar el encabezado (si se omite, no se ordena). */
  sortValue?: (row: T) => string | number;
  /** Texto completo cuando la celda se recorta. */
  title?: (row: T) => string | undefined;
  className?: string;
};

const NUMERIC = 'tabular-nums';

const ALIGN: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

/**
 * Tabla de datos con dos caras, una sola implementación:
 *  · ≥md: tabla densa con encabezado y primera columna anclados al hacer scroll,
 *    y orden al pulsar cualquier columna que declare `sortValue`.
 *  · <md: una tarjeta por fila (id + estado arriba, métricas, campos y el
 *    detalle secundario plegado en «Ver más»).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  footer,
  mobileSummary,
  loading,
  loadingRows = 6,
  maxHeightClass = 'md:max-h-[min(72vh,900px)]',
  sortable = true,
  defaultSortKey,
  expandedKey,
  renderExpanded,
  sticky = true,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  footer?: ReactNode;
  /** Totales para la vista de teléfono (el `footer` de la tabla no aplica ahí). */
  mobileSummary?: ReactNode;
  loading?: boolean;
  loadingRows?: number;
  maxHeightClass?: string;
  sortable?: boolean;
  defaultSortKey?: string;
  /** Clave de la fila abierta (acordeón). Ver `renderExpanded`. */
  expandedKey?: string | null;
  /** Contenido que se despliega **dentro de la fila** (escritorio) o de la tarjeta (teléfono). */
  renderExpanded?: (row: T) => ReactNode;
  /** Encabezado anclado al hacer scroll. Desactivar en tablas anidadas. */
  sticky?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const sorted = useMemo(() => {
    const active = sort ?? (defaultSortKey ? { key: defaultSortKey, dir: 'asc' as const } : null);
    if (!active) return rows;
    const col = columns.find((c) => c.key === active.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
      return active.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, columns, sort, defaultSortKey]);

  function toggleSort(col: Column<T>) {
    if (!sortable || !col.sortValue) return;
    setSort((prev) =>
      prev?.key === col.key ? (prev.dir === 'asc' ? { key: col.key, dir: 'desc' } : null) : { key: col.key, dir: 'asc' },
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-space-sm p-space-lg">
        {Array.from({ length: loadingRows }).map((_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    );
  }

  if (sorted.length === 0 && empty) return <>{empty}</>;

  const idCols = columns.filter((c) => c.kind === 'id');
  const statusCols = columns.filter((c) => c.kind === 'status');
  const actionCols = columns.filter((c) => c.kind === 'action');
  const metricCols = columns.filter((c) => c.kind === 'metric');
  const fieldCols = columns.filter((c) => !c.kind || c.kind === 'field');
  const detailCols = columns.filter((c) => c.kind === 'detail');

  return (
    <>
      {/* ---------- Escritorio: tabla ---------- */}
      <div className={cx('hidden overflow-auto md:block', maxHeightClass)}>
        <table className="w-full border-collapse text-body-md">
          <caption className="sr-only">Tabla de datos</caption>
          <thead>
            <tr className="border-b border-surface-container">
              {columns.map((c, index) => {
                const active = sort?.key === c.key;
                const ariaSort = active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cx(
                      'whitespace-nowrap bg-surface-container px-space-sm py-space-sm font-semibold uppercase tracking-wider text-label-sm text-outline',
                      sticky && 'sticky top-0 z-10',
                      ALIGN[c.align ?? 'left'],
                      index === 0 && cx('left-0 border-r border-surface-container', sticky ? 'z-20' : 'z-[1]'),
                      c.className,
                    )}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c)}
                        className="inline-flex cursor-pointer select-none items-center gap-1 uppercase tracking-wider hover:text-primary"
                        title={`Ordenar por ${c.header}${active ? (sort?.dir === 'asc' ? ' (ascendente)' : ' (descendente)') : ''}`}
                      >
                        {c.header}
                        {active ? (
                          sort?.dir === 'asc' ? (
                            <ChevronUp aria-hidden className="size-3.5 shrink-0" />
                          ) : (
                            <ChevronDown aria-hidden className="size-3.5 shrink-0" />
                          )
                        ) : null}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container">
            {sorted.map((row) => {
              const key = rowKey(row);
              const isOpen = expandedKey != null && expandedKey === key;
              return (
                <Fragment key={key}>
                  <tr className={cx('group transition-colors', isOpen ? 'bg-surface-container-low' : 'hover:bg-surface-container-low')}>
                    {columns.map((c, index) => (
                      <td
                        key={c.key}
                        title={c.title?.(row)}
                        className={cx(
                          'px-space-sm py-space-xs align-middle',
                          ALIGN[c.align ?? 'left'],
                          c.align === 'right' && NUMERIC,
                          // Si la columna declara `title` es porque su texto puede ser
                          // largo: se trunca con elipsis y el completo sale en el title.
                          c.title && 'max-w-[20rem] truncate',
                          index === 0 &&
                            'sticky left-0 z-[1] border-r border-surface-container bg-surface-container-lowest font-semibold text-primary group-hover:bg-surface-container-low',
                          isOpen && index === 0 && 'bg-surface-container-low',
                          c.className,
                        )}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                  {isOpen && renderExpanded && (
                    <tr>
                      <td colSpan={columns.length} className="bg-surface-container-low px-space-md py-space-sm">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>

      {/* ---------- Teléfono: tarjetas ---------- */}
      <ul className="flex flex-col divide-y divide-surface-container md:hidden">
        {sorted.map((row) => {
          const key = rowKey(row);
          const isOpen = expandedKey != null && expandedKey === key;
          return (
            <li key={key} className={cx('flex flex-col gap-space-sm px-space-lg py-space-md', isOpen && 'bg-surface-container-low')}>
              <div className="flex items-start justify-between gap-space-sm">
                <div className="flex min-w-0 flex-col gap-space-2xs">
                  {idCols.map((c) => (
                    <div key={c.key} className="text-title-md font-bold text-primary">
                      {c.render(row)}
                    </div>
                  ))}
                </div>
                {statusCols.map((c) => (
                  <div key={c.key} className="shrink-0">
                    {c.render(row)}
                  </div>
                ))}
              </div>

              {fieldCols.length > 0 && (
                <dl className="flex flex-col gap-space-2xs">
                  {fieldCols.map((c) => (
                    <div key={c.key} className="flex items-baseline justify-between gap-space-md">
                      <dt className="min-w-0 text-label-sm font-semibold uppercase tracking-wide text-outline">{c.header}</dt>
                      <dd className={cx('min-w-0 text-right text-body-md text-on-surface', c.align !== 'left' && NUMERIC)}>
                        {c.render(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {metricCols.length > 0 && (
                <div className="grid grid-cols-2 gap-space-sm rounded-lg bg-surface-container-low px-space-md py-space-sm">
                  {metricCols.map((c) => (
                    <div key={c.key} className="flex flex-col">
                      <span className="text-label-sm font-semibold uppercase tracking-wide text-outline">{c.header}</span>
                      <span className={cx('font-bold text-body-lg', NUMERIC)}>{c.render(row)}</span>
                    </div>
                  ))}
                </div>
              )}

              {detailCols.length > 0 && (
                <details className="group/details">
                  <summary className="cursor-pointer list-none text-label-md font-semibold text-primary-container underline-offset-2 hover:underline">
                    Ver más
                  </summary>
                  <dl className="mt-space-sm flex flex-col gap-space-2xs">
                    {detailCols.map((c) => (
                      <div key={c.key} className="flex items-baseline justify-between gap-space-md">
                        <dt className="text-label-sm font-semibold uppercase tracking-wide text-outline">{c.header}</dt>
                        <dd className="text-right text-body-md text-on-surface">{c.render(row)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}

              {actionCols.length > 0 && (
                <div className="flex flex-wrap items-center gap-space-sm">
                  {actionCols.map((c) => (
                    <div key={c.key} className="flex flex-wrap items-center gap-space-sm">
                      {c.render(row)}
                    </div>
                  ))}
                </div>
              )}

              {isOpen && renderExpanded && (
                <div className="rounded-lg bg-surface-container px-space-md py-space-sm">{renderExpanded(row)}</div>
              )}
            </li>
          );
        })}
        {mobileSummary && <li className="border-t-2 border-surface-container bg-surface-container-low">{mobileSummary}</li>}
      </ul>
    </>
  );
}

// Pie de tabla para totales (mismo lenguaje visual en todas las vistas).
export function TotalsRow({ children, colSpan }: { children: ReactNode; colSpan?: number }) {
  return (
    <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
      {colSpan ? <td colSpan={colSpan} /> : null}
      {children}
    </tr>
  );
}
