'use client';

// ============================================================
// Primitivas de UI del design system "Nexo Producción".
//
// Contrato compartido por todos los módulos: si algo se ve igual en
// dos vistas, vive aquí. Ninguna vista duplica tablas, tarjetas ni
// controles.
//
// Reglas clave (ver docs/design/DESIGN_SYSTEM.md):
//  · Una sola tabla: `DataTable` decide sola → tabla en ≥md, tarjetas en phone.
//  · Área táctil ≥44px en puntero grueso; inputs a 16px en phone (evita el
//    zoom automático de iOS al enfocar).
//  · Números siempre `tabular-nums`; `fmtInt` para cantidades sin decimales
//    y `—` sólo para "sin dato" (0 se muestra como 0).
//  · Contraste ≥4.5:1 en texto de cuerpo.
// ============================================================

import { ChevronDown, ChevronsUpDown, ChevronUp, Inbox, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo, useState, Fragment, type ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ---------- Jerarquía de página ----------

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-space-md xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <h1 className="flex items-center gap-space-sm text-headline-lg leading-tight tracking-tight text-primary">
          <Icon aria-hidden className="size-6 shrink-0 text-primary-container" />
          <span className="text-balance">{title}</span>
        </h1>
        {subtitle && <p className="mt-space-xs max-w-3xl text-body-md text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-space-sm">{actions}</div>}
    </header>
  );
}

// ---------- Superficies ----------

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-xl bg-surface-container-lowest shadow-card', className)}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-space-md border-b border-surface-container px-space-lg py-space-md">
      <div className="min-w-0">
        <h2 className="font-semibold uppercase tracking-wider text-label-md text-on-surface-variant">{title}</h2>
        {description && <p className="mt-space-2xs text-body-md text-on-surface-variant">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-space-md border-b border-surface-container px-space-lg py-space-md', className)}>
      {children}
    </div>
  );
}

// ---------- Indicadores ----------

type Tone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-on-surface',
  primary: 'text-primary',
  success: 'text-secondary',
  danger: 'text-critical',
  warning: 'text-warning',
  muted: 'text-on-surface-variant',
};

const DOT: Record<Tone, string> = {
  default: 'bg-outline',
  primary: 'bg-primary-container',
  success: 'bg-secondary-container',
  danger: 'bg-critical',
  warning: 'bg-warning',
  muted: 'bg-outline-variant',
};

export function Kpi({
  label,
  value,
  suffix,
  hint,
  tone = 'primary',
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cx('min-w-0 rounded-xl bg-surface-container-lowest px-space-md py-space-sm shadow-card', className)}>
      <div className="flex items-center justify-between gap-space-sm">
        <span className="truncate font-semibold uppercase tracking-wider text-label-sm text-outline">{label}</span>
        {Icon && <Icon aria-hidden className="size-4 shrink-0 text-primary-container" />}
      </div>
      <div className={cx('tabular-nums font-black text-headline-md xl:text-headline-lg', TONE_TEXT[tone])}>
        {value}
        {suffix && <span className="ml-space-xs text-label-sm font-medium text-outline">{suffix}</span>}
      </div>
      {hint && <div className="text-label-sm text-on-surface-variant">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'default', dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  const BADGE: Record<Tone, string> = {
    default: 'bg-surface-container-high text-on-surface',
    primary: 'bg-primary-container text-on-primary',
    success: 'bg-success-container text-on-success-container',
    danger: 'bg-critical-container text-on-critical-container',
    warning: 'bg-warning-container text-on-warning-container',
    muted: 'bg-surface-container-low text-on-surface-variant',
  };
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-space-xs whitespace-nowrap rounded px-space-sm py-space-2xs font-bold uppercase tracking-wide text-label-sm',
        BADGE[tone],
      )}
    >
      {dot && <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', DOT[tone])} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

// Barra de cobertura: verde (completo) → ámbar (parcial) → rojo (nada).
export function CoverageBar({ ratio, className }: { ratio: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const tone = pct >= 0.999 ? 'var(--color-secondary-container)' : pct > 0 ? 'var(--color-warning)' : 'var(--color-critical)';
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest', className)}>
      <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${pct * 100}%`, backgroundColor: tone }} />
    </div>
  );
}

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
    <div className="flex flex-col items-center gap-space-sm px-space-lg py-space-2xl text-center">
      <Icon aria-hidden className="size-7 text-outline-variant" />
      <p className="font-semibold text-title-md text-on-surface">{title}</p>
      {description && <p className="max-w-md text-body-md text-on-surface-variant">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-space-sm rounded-lg bg-critical-container px-space-md py-space-sm text-body-md text-on-critical-container">
      <span className="mt-space-2xs size-1.5 shrink-0 rounded-full bg-critical" aria-hidden />
      {children}
    </p>
  );
}

// ---------- Controles ----------

// Campo base: 44px en pantalla táctil/phone y 36px en escritorio.
// `text-base` (16px) en phone evita el zoom automático de iOS al enfocar.
const FIELD =
  'h-11 w-full rounded-lg bg-surface-container-low px-space-sm text-base text-on-surface transition-shadow placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary-container md:h-9 md:text-body-md';

export function TextInput({
  value,
  onChange,
  placeholder,
  icon: Icon,
  ariaLabel,
  className,
  type = 'text',
  inputMode,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: LucideIcon;
  ariaLabel?: string;
  className?: string;
  type?: 'text' | 'search' | 'month';
  inputMode?: 'text' | 'decimal' | 'numeric' | 'search';
  onEnter?: () => void;
}) {
  return (
    <div className={cx('relative', className)}>
      {Icon && <Icon aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-outline" />}
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter();
        }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={cx(FIELD, Icon ? 'pl-10' : 'px-space-sm')}
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
      className={cx(FIELD, 'cursor-pointer pr-space-xs', className)}
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
      className={cx(FIELD, 'cursor-pointer', className)}
    />
  );
}

type ButtonVariant = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary-container text-on-primary hover:bg-primary',
  accent: 'bg-secondary-container text-on-secondary-container hover:brightness-95',
  outline: 'border border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low',
  ghost: 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
  danger: 'bg-critical-container text-on-critical-container hover:brightness-95',
};

export function Button({
  children,
  onClick,
  variant = 'primary',
  icon: Icon,
  iconRight: IconRight,
  disabled,
  className,
  title,
  ariaLabel,
  fullWidth,
  type = 'button',
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  disabled?: boolean;
  className?: string;
  title?: string;
  ariaLabel?: string;
  fullWidth?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={fullWidth ? { width: '100%' } : undefined}
      className={cx(
        'inline-flex h-11 shrink-0 items-center justify-center gap-space-xs rounded-lg px-space-md font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:h-9',
        BUTTON_VARIANT[variant],
        fullWidth && 'w-full',
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
      {children && <span className="truncate">{children}</span>}
      {IconRight && <IconRight aria-hidden className="size-4 shrink-0" />}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx('inline-flex shrink-0 rounded-lg bg-surface-container p-space-2xs', className)}>
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex h-10 items-center gap-space-xs rounded-md px-space-md text-label-md transition-colors md:h-7',
              selected ? 'bg-surface-container-lowest font-bold text-primary shadow-card' : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {o.icon && <o.icon aria-hidden className="size-4" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Barra de filtros: en escritorio todo en línea; en phone el buscador queda
// visible y los filtros se despliegan tras un botón (área táctil cómoda).
export function FilterBar({
  search,
  filters,
  activeCount = 0,
}: {
  search?: ReactNode;
  filters?: ReactNode;
  activeCount?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-surface-container px-space-lg py-space-md">
      <div className="flex items-center gap-space-md">
        {search && <div className="min-w-0 flex-1 md:max-w-sm">{search}</div>}
        {filters && (
          <>
            <div className="hidden flex-1 flex-wrap items-center gap-space-md md:flex">{filters}</div>
            <Button
              className="md:hidden"
              variant="outline"
              icon={SlidersHorizontal}
              onClick={() => setOpen((v) => !v)}
              ariaLabel="Mostrar filtros"
              title="Filtros"
            >
              {activeCount > 0 ? `Filtros (${activeCount})` : 'Filtros'}
            </Button>
          </>
        )}
      </div>
      {filters && open && <div className="mt-space-md flex flex-col gap-space-sm md:hidden">{filters}</div>}
    </div>
  );
}

// ---------- Presentación del artículo (Profit: `uni_venta`) ----------
// SAC = saco · KG = granel. Es el mismo criterio en todas las vistas: una
// sola definición para que el filtro se vea y se comporte igual en todas.
export type UnitFilter = 'ALL' | 'SAC' | 'KG';

export const UNIT_OPTIONS: { value: UnitFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'SAC', label: 'Saco' },
  { value: 'KG', label: 'Granel (kg)' },
];

export function matchesUnit(uom: string, filter: UnitFilter): boolean {
  return filter === 'ALL' || uom === filter;
}

export function UnitFilterControl({
  value,
  onChange,
  label = 'Presentación',
}: {
  value: UnitFilter;
  onChange: (value: UnitFilter) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-space-sm">
      <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">{label}</span>
      <Segmented ariaLabel={label} value={value} onChange={onChange} options={UNIT_OPTIONS} />
    </div>
  );
}

// ---------- Tabla / tarjetas ----------

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
 *  · ≥md: tabla densa con encabezado y primera columna anclados al hacer scroll.
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
    setSort((prev) => (prev?.key === col.key ? (prev.dir === 'asc' ? { key: col.key, dir: 'desc' } : null) : { key: col.key, dir: 'asc' }));
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
                      'whitespace-nowrap bg-surface-container-low px-space-sm py-space-sm font-semibold uppercase tracking-wider text-label-sm text-outline',
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
                        className="inline-flex items-center gap-space-2xs hover:text-primary"
                        title={`Ordenar por ${c.header}`}
                      >
                        {c.header}
                        {active ? (
                          sort?.dir === 'asc' ? (
                            <ChevronUp aria-hidden className="size-3.5" />
                          ) : (
                            <ChevronDown aria-hidden className="size-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown aria-hidden className="size-3.5 opacity-40" />
                        )}
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
                  <tr
                    className={cx(
                      'group transition-colors',
                      isOpen ? 'bg-surface-container-low' : 'hover:bg-surface-container-low',
                    )}
                  >
                    {columns.map((c, index) => (
                      <td
                        key={c.key}
                        title={c.title?.(row)}
                        className={cx(
                          'px-space-sm py-[7px] align-middle',
                          ALIGN[c.align ?? 'left'],
                          c.align === 'right' && NUMERIC,
                          // Si la columna declara `title` es porque su texto puede ser
                          // largo: se trunca con elipsis y el completo sale en el title.
                          c.title && 'max-w-[18rem] truncate',
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
                      <td colSpan={columns.length} className="bg-surface-container-low px-space-md py-space-md">
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
          <li
            key={key}
            className={cx('flex flex-col gap-space-sm px-space-lg py-space-md', isOpen && 'bg-surface-container-low')}
          >
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
                    <dd className={cx('min-w-0 text-right text-body-md text-on-surface', c.align !== 'left' && NUMERIC)}>{c.render(row)}</dd>
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
              <div className="rounded-lg bg-surface-container px-space-md py-space-md">{renderExpanded(row)}</div>
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

export function Th({
  children,
  align = 'left',
  className,
  rowSpan,
  colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  rowSpan?: number;
  colSpan?: number;
}) {
  return (
    <th
      scope="col"
      rowSpan={rowSpan}
      colSpan={colSpan}
      className={cx('px-space-sm py-space-sm font-semibold uppercase tracking-wider text-label-sm text-outline', ALIGN[align], className)}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  title,
  rowSpan,
  colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  title?: string;
  rowSpan?: number;
  colSpan?: number;
}) {
  return (
    <td
      title={title}
      rowSpan={rowSpan}
      colSpan={colSpan}
      className={cx('px-space-sm py-[7px] align-middle', ALIGN[align], align !== 'left' && NUMERIC, className)}
    >
      {children}
    </td>
  );
}

// ---------- Formateadores (es-VE) ----------

export function fmtQty(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('es-VE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/** Cantidades sin decimales (unidades, sacos, kg enteros). 0 se muestra como «0». */
export function fmtInt(value: number | null | undefined): string {
  return fmtQty(value, 0);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'short' }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
}
