'use client';

// ============================================================
// Expediente de una vendedora: su cierre, su histórico y los clientes que le
// compraron con la meta que a cada uno le toca.
//
// Se abre desde el ranking o desde la franja de reparto. Mismo patrón de
// drawer que el detalle de producto del informe de ventas (Esc cierra, foco
// atrapado, fondo bloqueado).
// ============================================================

import type { ForecastSellerClientRow, ForecastSellerRow, ForecastSellersResponse } from '@nexo/contracts';
import { AlertTriangle, Download, Search, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Card,
  Column,
  DataTable,
  EmptyState,
  TextInput,
  cx,
  fmtDate,
} from '../ui';
import { EChart } from '../EChart';
import { ModuleHelp } from '../help/ColumnHelp';
import { SELLER_CLIENT_COLUMN_HELP, SELLERS_HELP_RULES, SELLERS_HELP_TITLE, SELLERS_HELP_TERMS } from '../../content/help/sellers';
import { useHelpRow } from '../../lib/use-help-row';
import {
  fmtKg,
  fmtPct,
  fmtTonnes,
  monthLabel,
  salesTone,
} from '../../lib/sales-report';
import {
  allocationLabel,
  buildSellerClientsCsv,
  filterSellerClients,
  fmtAttainmentPct,
  sellerClientsCsvFileName,
  topQuotaSeller,
} from '../../lib/sellers-report';
import {
  AttainmentRing,
  MiniStat,
  PctPill,
  SellerAvatar,
  cumulativeOption,
  monthlyHistoryOption,
} from './seller-ui';

function downloadCsv(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function SellerDetailDrawer({
  seller,
  report,
  onClose,
}: {
  seller: ForecastSellerRow;
  report: ForecastSellersResponse;
  onClose: () => void;
}) {
  const detailRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const [onlyWithSales, setOnlyWithSales] = useState(false);
  const [onlyWithoutBase, setOnlyWithoutBase] = useState(false);
  const [helpRow, setHelpRow] = useHelpRow();

  const isOpen = report.status === 'OPEN';
  const clients = useMemo(
    () =>
      filterSellerClients(seller.clients, {
        search,
        onlyWithSales,
        onlyWithoutBase,
      }),
    [seller.clients, search, onlyWithSales, onlyWithoutBase],
  );

  const tone = salesTone(seller.projectedAttainmentPct ?? seller.attainmentPct);
  const quotaPct = seller.quotaPct;
  const leader = topQuotaSeller(report);
  const isLeader = leader?.sellerCode === seller.sellerCode && seller.sellerCode !== '';
  const chart = useMemo(
    () =>
      cumulativeOption({
        daily: seller.daily,
        forecastKg: seller.targetKg,
        asOf: report.asOf,
        today: report.days.today,
      }),
    [seller, report.asOf, report.days.today],
  );
  const historyChart = useMemo(() => monthlyHistoryOption(seller), [seller]);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => detailRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(frame);
      previousFocus.current?.focus();
    };
  }, [onClose]);

  const columns: Column<ForecastSellerClientRow>[] = [
    {
      key: 'cliente',
      header: 'Cliente',
      kind: 'id',
      help: SELLER_CLIENT_COLUMN_HELP.cliente,
      sortValue: (row) => row.clientName,
      className: 'w-[15rem] max-w-[15rem]',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-on-surface" title={row.clientName}>
            {row.clientName}
          </p>
          <p className="flex flex-wrap items-center gap-1 text-label-sm text-outline">
            <span className="tabular-nums">{row.clientCode || '—'}</span>
            {row.customerType && <span className="truncate">· {row.customerType}</span>}
            {row.isNew && <Badge tone="primary">Nuevo</Badge>}
            {row.targetKg <= 0 && <span className="text-warning">sin base</span>}
          </p>
          <p className="text-label-sm text-outline">
            {fmtKg(row.historicalKg)} kg históricos
            {row.lastInvoiceDate ? ` · últ. ${fmtDate(row.lastInvoiceDate)}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'meta',
      header: 'Meta kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.metaCliente,
      sortValue: (row) => row.targetKg,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums font-semibold text-primary">{row.targetKg > 0 ? fmtKg(row.targetKg) : '—'}</p>
          <p
            className="text-label-sm text-outline"
            title={row.shareOfSellerPct === null ? undefined : `${fmtPct(row.shareOfSellerPct)} de la venta histórica de la vendedora`}
          >
            {row.shareOfSellerPct === null ? '—' : `${fmtPct(row.shareOfSellerPct)} peso`}
          </p>
        </div>
      ),
    },
    {
      key: 'venta',
      header: 'Venta kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.ventaCliente,
      sortValue: (row) => row.actualKg,
      render: (row) => <span className="tabular-nums text-on-surface">{fmtKg(row.actualKg)}</span>,
    },
    {
      key: 'cumplimiento',
      header: 'Cumplimiento',
      align: 'right',
      kind: 'status',
      help: SELLER_CLIENT_COLUMN_HELP.cumplimientoCliente,
      sortValue: (row) => row.projectedAttainmentPct ?? row.attainmentPct ?? -1,
      render: (row) => <PctPill pct={row.projectedAttainmentPct ?? row.attainmentPct} emptyLabel="—" />,
    },
    {
      key: 'proyeccion',
      header: 'Proyección kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.proyeccionCliente,
      sortValue: (row) => row.projectedKg ?? -1,
      render: (row) => (
        <span className="tabular-nums text-on-surface">
          {row.projectedKg === null ? '—' : fmtKg(row.projectedKg)}
        </span>
      ),
    },
    {
      key: 'brecha',
      header: 'Brecha kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.brechaCliente,
      sortValue: (row) => row.gapKg ?? -1,
      render: (row) => {
        const gap = row.gapKg;
        if (gap === null) return <span className="text-outline">—</span>;
        return (
          <span className={cx('tabular-nums font-semibold', gap < 0 ? 'text-critical' : 'text-success')}>
            {gap > 0 ? '+' : ''}
            {fmtKg(gap)} kg
          </span>
        );
      },
    },
  ];

  return (
    <>
      <div
        aria-hidden
        className="animate-fade fixed inset-0 z-40 bg-[#081d2c]/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside
        ref={detailRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="seller-detail-title"
        tabIndex={-1}
        className="animate-slide-in fixed inset-y-0 right-0 z-50 flex w-full max-w-4xl flex-col overflow-y-auto overscroll-contain bg-surface-container-lowest shadow-2xl outline-none"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-space-md border-b border-surface-container bg-surface-container-lowest/95 px-space-md py-space-sm backdrop-blur">
          <div className="flex min-w-0 items-center gap-space-sm">
            <SellerAvatar name={seller.sellerName} rank={isLeader ? 1 : 2} />
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                Expediente de vendedora
              </p>
              <h2 id="seller-detail-title" className="truncate text-title-md font-bold text-on-surface">
                {seller.sellerName}
              </h2>
              <p className="flex flex-wrap items-center gap-1.5 text-label-md text-on-surface-variant">
                <span className="tabular-nums">{seller.sellerCode || 'sin código'}</span>
                <span aria-hidden>·</span>
                <span>{allocationLabel(report)}</span>
                {isLeader && <Badge tone="primary">Mayor cuota</Badge>}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Cerrar expediente de la vendedora"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex flex-col gap-space-md p-space-md">
          {/* Cabecera de cumplimiento */}
          <section className="relative isolate flex flex-col gap-space-md overflow-hidden rounded-card bg-hero p-space-md text-white shadow-hero sm:flex-row sm:items-center sm:justify-between">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.055]"
              style={{
                backgroundImage:
                  'linear-gradient(rgb(255 255 255 / 0.9) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.9) 1px, transparent 1px)',
                backgroundSize: '34px 34px',
              }}
            />
            <div className="relative min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.16em] text-white/55">
                Cuota sobre la meta de la empresa
              </p>
              <div className="flex flex-wrap items-end gap-space-sm">
                <span className="font-display tabular-nums text-[2.6rem] font-black leading-none text-secondary-container">
                  {quotaPct === null ? '—' : fmtPct(quotaPct)}
                </span>
                <span className="pb-1 text-body-md text-white/60">
                  meta {fmtKg(seller.targetKg)} kg ({fmtTonnes(seller.targetKg)} t)
                </span>
              </div>
              <p className="mt-space-2xs max-w-lg text-body-md text-white/65">
                Lleva {fmtKg(seller.actualKg)} kg ({fmtAttainmentPct(seller.attainmentPct)} de su cuota) y representa el{' '}
                {seller.currentSharePct === null ? '—' : fmtPct(seller.currentSharePct)} de la venta del mes.
              </p>
            </div>
            <div className="relative flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-space-sm">
              <AttainmentRing pct={seller.projectedAttainmentPct} tone={tone} />
            </div>
          </section>

          <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4">
            <MiniStat
              label="Meta asignada"
              value={`${fmtKg(seller.targetKg)} kg`}
              hint={quotaPct === null ? 'sin cuota' : `${fmtPct(quotaPct)} del forecast`}
            />
            <MiniStat
              label="Venta del mes"
              value={`${fmtKg(seller.actualKg)} kg`}
              hint={`${fmtKg(seller.invoiceCount, 0)} notas · ${fmtKg(seller.activeClientCount, 0)} clientes`}
            />
            <MiniStat
              label={isOpen ? 'Proyección' : 'Cierre real'}
              value={seller.projectedKg === null ? '—' : `${fmtKg(seller.projectedKg)} kg`}
              hint={seller.projectedAttainmentPct === null ? 'sin meta' : `${fmtAttainmentPct(seller.projectedAttainmentPct)} de su cuota`}
              tone={tone}
            />
            <MiniStat
              label="Brecha"
              value={seller.gapKg === null ? '—' : `${seller.gapKg > 0 ? '+' : ''}${fmtKg(seller.gapKg)} kg`}
              hint={seller.gapKg === null ? 'depende de la meta' : seller.gapKg < 0 ? 'por debajo de su cuota' : 'por encima de su cuota'}
              tone={tone}
            />
          </div>

          <div className="grid gap-space-md lg:grid-cols-2">
            <Card className="overflow-hidden p-space-sm">
              <header className="mb-space-xs flex items-center justify-between gap-space-sm px-space-xs">
                <div>
                  <h3 className="text-title-md font-bold text-on-surface">Acumulado del mes</h3>
                  <p className="text-label-md text-on-surface-variant">Real vs proyección vs ritmo de su cuota</p>
                </div>
                <span className="text-label-sm text-on-surface-variant">{monthLabel(report.year, report.month)}</span>
              </header>
              {seller.daily.length > 0 && seller.actualKg > 0 ? (
                <EChart
                  option={chart}
                  height={230}
                  ariaLabel={`Acumulado de ${seller.sellerName}: venta real, proyección y ritmo de su cuota`}
                />
              ) : (
                <EmptyState
                  icon={Users}
                  title="Sin entregas en el mes"
                  description="Cuando Profit registre la primera nota de esta vendedora verás aquí su acumulado."
                />
              )}
            </Card>

            <Card className="overflow-hidden p-space-sm">
              <header className="mb-space-xs flex items-center justify-between gap-space-sm px-space-xs">
                <div>
                  <h3 className="text-title-md font-bold text-on-surface">Últimos {seller.history.length} meses</h3>
                  <p className="text-label-md text-on-surface-variant">Venta cerrada contra la cuota mensual actual</p>
                </div>
                <Badge tone="muted">{fmtKg(seller.historicalAvgKg ?? 0)} kg prom.</Badge>
              </header>
              {seller.history.length > 0 ? (
                <EChart
                  option={historyChart}
                  height={230}
                  ariaLabel={`Histórico de ventas de ${seller.sellerName} contra su cuota`}
                />
              ) : (
                <EmptyState icon={Users} title="Sin histórico" description="La ventana elegida no tiene meses cerrados." />
              )}
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-space-sm border-b border-surface-container px-space-md py-space-sm">
              <div>
                <h3 className="flex items-center gap-1.5 text-title-md font-bold text-on-surface">
                  <Users aria-hidden className="size-4 text-primary" /> Clientes de {seller.sellerName.split(' ')[0]}
                </h3>
                <p className="text-label-md text-on-surface-variant">
                  {fmtKg(clients.length, 0)} de {fmtKg(seller.clients.length, 0)} clientes · la meta de cada uno es su peso
                  histórico en la venta de la vendedora
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-space-2xs">
                <TextInput
                  icon={Search}
                  value={search}
                  onChange={setSearch}
                  placeholder="Buscar cliente…"
                  ariaLabel="Buscar cliente en el expediente"
                  className="min-w-[10rem]"
                />
                <button
                  type="button"
                  onClick={() => setOnlyWithSales((value) => !value)}
                  aria-pressed={onlyWithSales}
                  className={cx(
                    'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                    onlyWithSales
                      ? 'bg-primary-container text-on-primary'
                      : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                  )}
                >
                  Con venta
                </button>
                <button
                  type="button"
                  onClick={() => setOnlyWithoutBase((value) => !value)}
                  aria-pressed={onlyWithoutBase}
                  className={cx(
                    'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                    onlyWithoutBase
                      ? 'bg-warning-container text-on-warning-container'
                      : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                  )}
                >
                  Sin base
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(buildSellerClientsCsv(seller), sellerClientsCsvFileName(seller, report))
                  }
                  className="inline-flex h-9 items-center gap-space-2xs rounded-xl border border-outline-variant/50 px-space-sm text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary"
                >
                  <Download aria-hidden className="size-4" /> CSV
                </button>
              </div>
            </div>

            <DataTable
              columns={columns}
              rows={clients}
              rowKey={(row) => row.clientCode || row.clientName}
              maxHeightClass="max-h-[46vh]"
              showHelpRow={helpRow}
              empty={
                <EmptyState
                  icon={Users}
                  title="Sin clientes para el filtro"
                  description="Prueba con otro texto o desactiva los filtros."
                />
              }
            />
            <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-container px-space-md py-space-xs text-label-sm text-on-surface-variant">
              <span>
                Σ metas de clientes = meta de la vendedora. Los clientes «sin base» no tienen histórico en la ventana y
                aparecen con meta 0.
              </span>
              <button
                type="button"
                onClick={() => setHelpRow(!helpRow)}
                aria-pressed={helpRow}
                className="font-semibold text-primary hover:underline"
              >
                {helpRow ? 'Ocultar explicaciones' : 'Explicar columnas'}
              </button>
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-space-sm px-space-xs pb-space-sm text-label-sm text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle aria-hidden className="size-3.5 text-warning" />
              La cuota es una asignación calculada; la meta oficial de la empresa sigue siendo la del informe de ventas.
            </span>
            <ModuleHelp
              title={SELLERS_HELP_TITLE}
              narrative="La cuota de una vendedora se calcula con su participación histórica; la de cada cliente, con su peso dentro de esa vendedora."
              rules={SELLERS_HELP_RULES}
              terms={SELLERS_HELP_TERMS}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
