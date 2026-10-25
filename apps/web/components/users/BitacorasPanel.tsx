'use client';

// ============================================================
// Usuarios → Bitácoras.
//
// Una sola bandeja para «quién cambió qué, cuándo y desde dónde»: acciones
// auditadas + notas operativas de despacho y llegadas, con filtros por fecha,
// módulo, severidad, actor y texto. Solo administradores (el API lo valida).
// ============================================================

import type { AuditEntry, AuditFeedResponse, AuditSeverity } from '@nexo/contracts';
import { AUDIT_MODULES } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  DoorOpen,
  FilterX,
  FlaskConical,
  LogIn,
  RefreshCw,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserCog,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AuthRequiredError, apiFetch } from '../../lib/api';
import {
  RANGE_OPTIONS,
  SEVERITY_META,
  RangePreset,
  clockOf,
  dateTimeOf,
  dayLabel,
  deviceLabel,
  groupByDay,
  initials,
  rangeBounds,
} from '../../lib/audit';
import { Badge, Card, EmptyState, Kpi, Segmented, Select, Skeleton, TextInput, cx } from '../ui';

const MODULE_ICON: Record<string, LucideIcon> = {
  auth: LogIn,
  users: UserCog,
  roles: ShieldCheck,
  dispatch: Truck,
  arrivals: DoorOpen,
  sync: RefreshCw,
  scenarios: FlaskConical,
  forecast: CalendarRange,
  orders: ShoppingCart,
  system: Settings2,
};

const AVATAR_TONE: Record<AuditSeverity, string> = {
  INFO: 'bg-primary-fixed text-primary',
  WARN: 'bg-warning-container text-on-warning-container',
  CRITICAL: 'bg-critical-container text-on-critical-container',
};

const SEVERITY_OPTIONS = [
  { value: '', label: 'Severidad: Todas' },
  { value: 'INFO', label: 'Normal' },
  { value: 'WARN', label: 'Atención' },
  { value: 'CRITICAL', label: 'Crítico' },
];

const PAGE_SIZE = 30;

export function BitacorasPanel() {
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [moduleKey, setModuleKey] = useState('');
  const [severity, setSeverity] = useState<'' | AuditSeverity>('');
  const [automation, setAutomation] = useState<'hide' | 'show'>('hide');
  const [actorId, setActorId] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Búsqueda con pausa: no dispara una petición por tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const bounds = rangeBounds(preset);
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), automation });
  if (bounds.from) params.set('from', bounds.from);
  if (bounds.to) params.set('to', bounds.to);
  if (moduleKey) params.set('module', moduleKey);
  if (severity) params.set('severity', severity);
  if (actorId) params.set('actorId', actorId);
  if (q) params.set('q', q);
  const queryString = params.toString();

  const { data, isLoading, isFetching, error, dataUpdatedAt } = useQuery<AuditFeedResponse>({
    queryKey: ['audit', queryString],
    queryFn: () => apiFetch<AuditFeedResponse>(`/audit?${queryString}`),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const items = data?.items ?? [];
  const groups = useMemo(() => groupByDay(items), [items]);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stats = data?.stats;
  const facets = data?.facets;
  const hasFilters = Boolean(moduleKey || severity || actorId || q || preset !== '7d' || automation !== 'hide');

  function resetFilters() {
    setPreset('7d');
    setModuleKey('');
    setSeverity('');
    setActorId('');
    setAutomation('hide');
    setSearch('');
    setQ('');
    setPage(1);
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch(`/api/audit/export?${queryString}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`No se pudo exportar (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bitacora-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'No se pudo exportar la bitácora');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-space-md">
      <div className="grid gap-space-sm sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Eventos hoy" value={String(stats?.today ?? 0)} suffix="registros" tone="primary" icon={ScrollText} />
        <Kpi
          label="Críticos (7 días)"
          value={String(stats?.critical7d ?? 0)}
          suffix="eventos"
          tone={stats && stats.critical7d > 0 ? 'danger' : 'muted'}
          icon={AlertTriangle}
        />
        <Kpi label="Usuarios hoy" value={String(stats?.actorsToday ?? 0)} suffix="activos" tone="success" icon={UserCog} />
        <Kpi
          label="Sync con error (7 días)"
          value={String(stats?.syncErrors7d ?? 0)}
          suffix="corridas"
          tone={stats && stats.syncErrors7d > 0 ? 'warning' : 'muted'}
          icon={RefreshCw}
        />
      </div>

      <Card className="p-space-md">
        <div className="flex flex-col gap-space-sm">
          <div className="flex flex-wrap items-center gap-space-sm">
            <Segmented
              ariaLabel="Rango de la bitácora"
              value={preset}
              onChange={(value) => {
                setPreset(value);
                setPage(1);
              }}
              options={RANGE_OPTIONS}
            />
            <Select
              className="w-48"
              value={severity}
              onChange={(value) => {
                setSeverity(value as '' | AuditSeverity);
                setPage(1);
              }}
              options={SEVERITY_OPTIONS}
              ariaLabel="Severidad"
            />
            <Select
              className="w-56"
              value={actorId}
              onChange={(value) => {
                setActorId(value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Actor: Todos' },
                ...(facets?.actors ?? []).map((actor) => ({
                  value: actor.id,
                  label: `${actor.name}${actor.code ? ` · ${actor.code}` : ''} (${actor.count})`,
                })),
              ]}
              ariaLabel="Actor"
            />
            <TextInput
              className="w-64"
              icon={Search}
              value={search}
              onChange={setSearch}
              placeholder="Buscar acción, entidad, motivo…"
              ariaLabel="Buscar en la bitácora"
            />
            <button
              type="button"
              onClick={() => {
                setAutomation((current) => (current === 'hide' ? 'show' : 'hide'));
                setPage(1);
              }}
              aria-pressed={automation === 'show'}
              title="Las corridas automáticas del scheduler se ocultan por defecto para no tapar los cambios de personas"
              className={cx(
                'flex h-10 items-center gap-space-xs rounded-pill border px-space-sm font-semibold text-label-md transition-colors',
                automation === 'show'
                  ? 'border-transparent bg-primary-container text-on-primary shadow-soft'
                  : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
              )}
            >
              <RefreshCw aria-hidden className="size-3.5" /> Sync automática
            </button>
            {hasFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="flex h-10 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                <FilterX aria-hidden className="size-3.5" /> Limpiar
              </button>
            )}
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={exporting || total === 0}
              className="ml-auto flex h-10 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-primary transition-colors hover:bg-surface-container-low disabled:opacity-40"
            >
              <Download aria-hidden className="size-4" /> {exporting ? 'Exportando…' : 'Exportar CSV'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-space-xs">
            <button
              type="button"
              onClick={() => {
                setModuleKey('');
                setPage(1);
              }}
              aria-pressed={moduleKey === ''}
              className={cx(
                'h-8 rounded-pill border px-space-sm text-label-md font-semibold transition-colors',
                moduleKey === ''
                  ? 'border-transparent bg-primary-container text-on-primary shadow-soft'
                  : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
              )}
            >
              Todos los módulos
            </button>
            {AUDIT_MODULES.map((module) => {
              const count = facets?.modules.find((entry) => entry.key === module.key)?.count ?? 0;
              const active = moduleKey === module.key;
              const Icon = MODULE_ICON[module.key] ?? Settings2;
              return (
                <button
                  key={module.key}
                  type="button"
                  onClick={() => {
                    setModuleKey(active ? '' : module.key);
                    setPage(1);
                  }}
                  aria-pressed={active}
                  className={cx(
                    'flex h-8 items-center gap-space-xs rounded-pill border px-space-sm text-label-md font-semibold transition-colors',
                    active
                      ? 'border-transparent bg-primary-container text-on-primary shadow-soft'
                      : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
                  )}
                >
                  <Icon aria-hidden className="size-3.5" />
                  {module.label}
                  {count > 0 && <span className={cx('tabular-nums', active ? 'text-on-primary/70' : 'text-outline')}>{count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm">
          <div>
            <p className="font-bold uppercase tracking-wider text-label-md text-primary">Registro de actividad</p>
            <p className="text-label-sm normal-case text-on-surface-variant">
              {total === 0 ? 'Sin eventos para este filtro' : `${total} evento${total === 1 ? '' : 's'} · página ${page} de ${pages}`}
            </p>
          </div>
          <div className="flex items-center gap-space-sm">
            {isFetching && <RefreshCw aria-hidden className="size-3.5 animate-spin text-outline" />}
            <span className="text-label-sm normal-case text-on-surface-variant">
              {dataUpdatedAt
                ? `actualizado ${new Date(dataUpdatedAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false })}`
                : 'cargando…'}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-space-sm p-space-md">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="p-space-md">
            <EmptyState
              icon={AlertTriangle}
              title="No se pudo cargar la bitácora"
              description={error instanceof Error ? error.message : 'Revisa la conexión con el API y vuelve a intentar.'}
            />
          </div>
        ) : items.length === 0 ? (
          <div className="p-space-md">
            <EmptyState
              icon={ScrollText}
              title="Todavía no hay eventos"
              description="Aquí queda cada cambio de usuarios, roles, despachos, llegadas y sincronizaciones, con su autor y su hora."
            />
          </div>
        ) : (
          <div className="flex flex-col">
            {groups.map((group) => (
              <section key={group.key}>
                <div className="flex items-center justify-between gap-space-sm border-y border-outline-variant/25 bg-surface-container-low/50 px-space-md py-1.5">
                  <span className="text-label-sm font-bold uppercase tracking-[0.14em] text-primary">{group.label}</span>
                  <span className="text-label-sm tabular-nums text-outline">
                    {group.items.length} evento{group.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ol className="divide-y divide-outline-variant/20">
                  {group.items.map((entry) => {
                    const Icon = MODULE_ICON[entry.module] ?? Settings2;
                    const severityMeta = SEVERITY_META[entry.severity];
                    const device = deviceLabel(entry.userAgent);
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(entry)}
                          className="group flex w-full items-start gap-space-sm px-space-md py-space-sm text-left transition-colors hover:bg-surface-container-low/60"
                        >
                          <span className="w-16 shrink-0 pt-1 text-label-sm tabular-nums text-outline">{clockOf(entry.at)}</span>
                          <span
                            className={cx(
                              'mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-label-sm font-bold',
                              AVATAR_TONE[entry.severity],
                            )}
                            title={entry.actorName ?? entry.actorCode ?? 'Sistema'}
                          >
                            {initials(entry.actorName ?? entry.actorCode)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-space-xs">
                              <span className="font-semibold text-on-surface">{entry.title}</span>
                              <Badge tone="muted">
                                <Icon aria-hidden className="mr-0.5 size-3" />
                                {entry.moduleLabel}
                              </Badge>
                              {entry.severity !== 'INFO' && <Badge tone={severityMeta.tone}>{severityMeta.label}</Badge>}
                            </div>
                            {entry.detail && (
                              <p className="mt-0.5 line-clamp-2 text-body-md text-on-surface-variant">{entry.detail}</p>
                            )}
                            <p className="mt-1 flex flex-wrap items-center gap-x-space-sm gap-y-0.5 text-label-sm normal-case text-outline">
                              <span className="font-semibold text-on-surface-variant">
                                {entry.actorName ?? entry.actorCode ?? 'Sistema'}
                              </span>
                              {entry.actorCode && entry.actorName && <span>{entry.actorCode}</span>}
                              {entry.ip && <span>· {entry.ip}</span>}
                              {device && <span>· {device}</span>}
                              {entry.source !== 'audit' && <span>· nota operativa</span>}
                            </p>
                          </div>
                          <ChevronRight aria-hidden className="mt-2 size-4 shrink-0 text-outline transition-transform group-hover:translate-x-0.5" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/40 px-space-md py-space-sm">
            <span className="text-label-sm normal-case text-on-surface-variant">
              Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
            </span>
            <div className="flex items-center gap-space-xs">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
              >
                <ChevronLeft aria-hidden className="size-3.5" /> Anterior
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pages, current + 1))}
                disabled={page >= pages}
                className="flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
              >
                Siguiente <ChevronRight aria-hidden className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </Card>

      {selected && <AuditDrawer entry={selected} onClose={() => setSelected(null)} />}

      {notice && (
        <div
          role="status"
          className="animate-rise fixed bottom-space-lg left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-space-sm rounded-pill bg-primary px-space-lg py-space-sm text-body-md font-semibold text-on-primary shadow-hero"
        >
          <AlertTriangle aria-hidden className="size-4" /> {notice}
        </div>
      )}
    </div>
  );
}

// ---------- Detalle ----------

function AuditDrawer({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const device = deviceLabel(entry.userAgent);
  const contextText = entry.context ? JSON.stringify(entry.context, null, 2) : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(contextText ?? entry.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="animate-fade fixed inset-0 z-50 flex justify-end bg-primary/35 backdrop-blur-sm"
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-detail-title"
        className="animate-rise flex h-full w-full max-w-md flex-col border-l border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <header className="flex shrink-0 items-start justify-between gap-space-md border-b border-outline-variant/30 px-space-md py-space-md">
          <div className="min-w-0">
            <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">Detalle del evento</p>
            <h2 id="audit-detail-title" className="text-headline-md text-primary">
              {entry.label}
            </h2>
            <p className="text-label-sm normal-case text-on-surface-variant">{dateTimeOf(entry.at)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-space-md">
          <div className="flex items-center gap-space-sm rounded-xl bg-surface-container-low/60 p-space-sm">
            <span className="grid size-10 place-items-center rounded-full bg-primary-fixed font-bold text-primary">
              {initials(entry.actorName ?? entry.actorCode)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-on-surface">{entry.actorName ?? 'Sistema'}</p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                {entry.actorCode ?? 'sin código'} · {entry.moduleLabel}
              </p>
            </div>
            <Badge tone={SEVERITY_META[entry.severity].tone}>{SEVERITY_META[entry.severity].label}</Badge>
          </div>

          {entry.detail && (
            <p className="mt-space-md whitespace-pre-line rounded-xl border border-outline-variant/35 bg-surface-container-low/40 p-space-sm text-body-md text-on-surface">
              {entry.detail}
            </p>
          )}

          <dl className="mt-space-md grid grid-cols-2 gap-space-sm text-body-md">
            <Field label="Acción" value={entry.action} mono />
            <Field label="Entidad" value={`${entry.entityType}${entry.entityId ? ` · ${entry.entityId.slice(0, 8)}…` : ''}`} />
            <Field label="IP" value={entry.ip ?? '—'} mono />
            <Field label="Dispositivo" value={device ?? '—'} />
            <Field label="Origen" value={entry.source === 'audit' ? 'Auditoría' : 'Nota operativa'} />
            <Field label="Hora exacta" value={dateTimeOf(entry.at)} />
          </dl>

          {entry.linkPath && (
            <a
              href={entry.linkPath}
              className="mt-space-md inline-flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-label-md text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
            >
              Abrir {entry.entityType === 'DispatchSheet' ? 'despacho' : entry.entityType === 'CustomerArrival' ? 'llegada' : 'registro'}
            </a>
          )}

          <div className="mt-space-lg">
            <div className="mb-space-xs flex items-center justify-between">
              <p className="font-semibold uppercase tracking-wider text-label-md text-outline">Contexto</p>
              <button
                type="button"
                onClick={() => void copy()}
                className="flex h-7 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                <Copy aria-hidden className="size-3" /> {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            {contextText ? (
              <pre className="max-h-80 overflow-auto rounded-xl bg-[#0b1f33] p-space-sm text-label-sm leading-relaxed text-[#c9e3ff]">
                {contextText}
              </pre>
            ) : (
              <p className="rounded-xl border border-dashed border-outline-variant/50 p-space-sm text-label-sm normal-case text-on-surface-variant">
                Este evento no guarda contexto adicional.
              </p>
            )}
          </div>

          <p className="mt-space-lg text-label-sm normal-case text-outline">
            ID del registro: <span className="font-mono">{entry.id}</span>
          </p>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-label-sm font-semibold uppercase tracking-wider text-outline">{label}</dt>
      <dd className={cx('truncate text-on-surface', mono && 'font-mono text-label-md')} title={value}>
        {value}
      </dd>
    </div>
  );
}
