'use client';

// ============================================================
// Primitivas de UI del design system "Nexo Producción" (Stitch).
// Reutilizables por todos los módulos: cabecera de página, KPIs,
// tarjetas, badges de estado e inputs densos (36px).
// ============================================================

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

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

export function Th({ children, align = 'left', className }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) {  return (
    <th scope="col" className={`px-space-sm py-2 font-semibold uppercase text-label-sm text-outline ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className ?? ''}`}>
      {children}
    </th>
  );
}

export function Td({ children, align = 'left', className, title }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string; title?: string }) {
  return (
    <td title={title} className={`px-space-sm py-space-xs ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className ?? ''}`}>
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
