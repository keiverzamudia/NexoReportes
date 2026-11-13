'use client';

// ============================================================
// Expediente de un vendedor: cierre, histórico y dos vistas de su venta.
//
//  · Cartera: clientes asignados en Profit, aunque no hayan comprado.
//  · Nota: solo los clientes a los que les firmó una nota.
//  · Productos: el mismo cruce por artículo (cartera / firmado / otros).
//
// El histórico arranca en 3 meses y se cambia aquí; el cambio recalcula el
// informe completo porque la cuota depende de esa ventana.
// ============================================================

import type {
  ForecastSellerClientRow,
  ForecastSellerProductRow,
  ForecastSellerProductsResponse,
  ForecastSellerRow,
  ForecastSellersResponse,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Download,
  Package,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Badge,
  Card,
  Column,
  DataTable,
  EmptyState,
  Select,
  Skeleton,
  TextInput,
  cx,
  fmtDate,
} from '../ui';
import { EChart } from '../EChart';
import { ModuleHelp } from '../help/ColumnHelp';
import {
  SELLER_CLIENT_COLUMN_HELP,
  SELLERS_HELP_RULES,
  SELLERS_HELP_TITLE,
  SELLERS_HELP_TERMS,
} from '../../content/help/sellers';
import { useHelpRow } from '../../lib/use-help-row';
import { apiFetch } from '../../lib/api';
import { fmtKg, fmtPct, fmtTonnes, monthLabel, salesTone } from '../../lib/sales-report';
import {
  allocationLabel,
  buildSellerCarteraCsv,
  buildSellerNotaCsv,
  buildSellerProductsCsv,
  fmtAttainmentPct,
  tabRunRate,
  topQuotaSeller,
} from '../../lib/sellers-report';
import {
  AttainmentRing,
  MiniStat,
  PctPill,
  SellerAvatar,
  cumulativeOption,
  monthlyHistoryDualOption,
} from './seller-ui';

type Tab = 'cartera' | 'nota' | 'productos';

const HISTORY_OPTIONS = [3, 6, 12, 24].map((months) => ({
  value: String(months),
  label: `${months} meses`,
}));

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

function csvFileName(prefix: string, seller: ForecastSellerRow, report: ForecastSellersResponse) {
  const code = seller.sellerCode || 'sin-codigo';
  return `${prefix}-${code}-${report.year}-${String(report.month).padStart(2, '0')}.csv`;
}

export function SellerDetailDrawer({
  seller,
  report,
  onClose,
  historyMonths,
  onHistoryMonthsChange,
  includeToday,
}: {
  seller: ForecastSellerRow;
  report: ForecastSellersResponse;
  onClose: () => void;
  historyMonths: number;
  onHistoryMonthsChange: (months: number) => void;
  includeToday: boolean;
}) {
  const detailRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [tab, setTab] = useState<Tab>('cartera');
  const [search, setSearch] = useState('');
  const [salesFilter, setSalesFilter] = useState<'all' | 'with' | 'without'>('all');
  const [onlyWithoutBase, setOnlyWithoutBase] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [helpRow, setHelpRow] = useHelpRow();

  const isOpen = report.status === 'OPEN';
  const leader = topQuotaSeller(report);
  const isLeader = leader?.sellerCode === seller.sellerCode && seller.sellerCode !== '';
  const tone = salesTone(seller.projectedAttainmentPct ?? seller.attainmentPct);
  const quotaPct = seller.quotaPct;

  const carteraMetrics = tabRunRate(seller.carteraCurrentKg, seller.carteraTargetKg, report);
  const noteMetrics = tabRunRate(seller.noteCurrentKg, seller.noteTargetKg, report);

  const noteClients = useMemo(
    () => seller.clients.filter((client) => client.noteCurrentKg > 0 || client.noteHistoricalKg > 0),
    [seller.clients],
  );

  const filteredCartera = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return seller.clients.filter((client) => {
      if (onlyWithoutBase && client.carteraTargetKg > 0) return false;
      if (salesFilter === 'with' && client.carteraCurrentKg <= 0) return false;
      if (salesFilter === 'without' && client.carteraCurrentKg > 0) return false;
      if (!needle) return true;
      return (
        client.clientName.toLowerCase().includes(needle) ||
        client.clientCode.toLowerCase().includes(needle)
      );
    });
  }, [seller.clients, search, salesFilter, onlyWithoutBase]);

  const filteredNota = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return noteClients.filter((client) => {
      if (onlyNew && client.noteHistoricalKg > 0) return false;
      if (!needle) return true;
      return (
        client.clientName.toLowerCase().includes(needle) ||
        client.clientCode.toLowerCase().includes(needle)
      );
    });
  }, [noteClients, search, onlyNew]);

  const productQuery = useQuery<ForecastSellerProductsResponse>({
    queryKey: [
      'seller-products',
      seller.sellerCode,
      report.year,
      report.month,
      report.basis,
      historyMonths,
      includeToday,
      report.attribution,
      report.generatedAt,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        year: String(report.year),
        month: String(report.month),
        months: String(historyMonths),
        basis: report.basis,
        includeToday: includeToday ? 'true' : 'false',
        attribution: report.attribution,
      });
      return apiFetch<ForecastSellerProductsResponse>(
        `/forecast/sellers/${encodeURIComponent(seller.sellerCode)}/products?${params.toString()}`,
      );
    },
    enabled: tab === 'productos' && Boolean(seller.sellerCode),
    staleTime: 60_000,
    retry: 1,
  });

  const filteredProducts = useMemo(() => {
    const needle = productSearch.trim().toLowerCase();
    const rows = productQuery.data?.products ?? [];
    if (!needle) return rows;
    return rows.filter(
      (product) =>
        product.description.toLowerCase().includes(needle) ||
        product.productCode.toLowerCase().includes(needle),
    );
  }, [productQuery.data, productSearch]);

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
  const historyChart = useMemo(() => monthlyHistoryDualOption(seller), [seller]);

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

  const carteraColumns: Column<ForecastSellerClientRow>[] = [
    {
      key: 'cliente',
      header: 'Cliente',
      kind: 'id',
      help: SELLER_CLIENT_COLUMN_HELP.cliente,
      sortValue: (row) => row.clientName,
      className: 'w-[16rem] max-w-[16rem]',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-on-surface" title={row.clientName}>
            {row.clientName}
          </p>
          <p className="flex flex-wrap items-center gap-1 text-label-sm text-outline">
            <span className="tabular-nums">{row.clientCode || '—'}</span>
            {row.customerType && <span className="truncate">· {row.customerType}</span>}
            {row.carteraHistoricalKg <= 0 && row.carteraCurrentKg > 0 && <Badge tone="primary">Nuevo</Badge>}
            {row.carteraTargetKg <= 0 && <span className="text-warning">sin base</span>}
          </p>
          <p className="text-label-sm text-outline">
            {fmtKg(row.carteraHistoricalKg)} kg históricos
            {row.lastInvoiceDate ? ` · últ. ${fmtDate(row.lastInvoiceDate)}` : ''}
          </p>
          {row.otherSellerKg > 0 && (
            <p className="text-label-sm text-warning">
              Otros: {row.otherSellerNames.length > 0 ? row.otherSellerNames.join(', ') : 'otro vendedor'} ·{' '}
              {fmtKg(row.otherSellerKg)} kg
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'meta',
      header: 'Meta kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.metaCliente,
      sortValue: (row) => row.carteraTargetKg,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums font-semibold text-primary">
            {row.carteraTargetKg > 0 ? fmtKg(row.carteraTargetKg) : '—'}
          </p>
          <p className="text-label-sm text-outline">
            {row.carteraShareOfSellerPct === null ? '—' : `${fmtPct(row.carteraShareOfSellerPct)} peso`}
          </p>
        </div>
      ),
    },
    {
      key: 'mes',
      header: 'Cartera mes',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.ventaCliente,
      sortValue: (row) => row.carteraCurrentKg,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums text-on-surface">{fmtKg(row.carteraCurrentKg)}</p>
          <p className="text-label-sm text-outline">
            él {fmtKg(row.noteCurrentKg)} · otros {fmtKg(row.otherSellerKg)}
          </p>
        </div>
      ),
    },
    {
      key: 'historico',
      header: 'Histórico',
      align: 'right',
      kind: 'detail',
      sortValue: (row) => row.carteraHistoricalKg,
      render: (row) => <span className="tabular-nums text-on-surface-variant">{fmtKg(row.carteraHistoricalKg)}</span>,
    },
    {
      key: 'cumplimiento',
      header: 'Cumplimiento',
      align: 'right',
      kind: 'status',
      help: SELLER_CLIENT_COLUMN_HELP.cumplimientoCliente,
      sortValue: (row) => {
        const metrics = tabRunRate(row.carteraCurrentKg, row.carteraTargetKg, report);
        return metrics.projectedAttainmentPct ?? metrics.attainmentPct ?? -1;
      },
      render: (row) => {
        const metrics = tabRunRate(row.carteraCurrentKg, row.carteraTargetKg, report);
        return <PctPill pct={metrics.projectedAttainmentPct ?? metrics.attainmentPct} emptyLabel="—" />;
      },
    },
    {
      key: 'proyeccion',
      header: 'Proyección kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.proyeccionCliente,
      sortValue: (row) => {
        const metrics = tabRunRate(row.carteraCurrentKg, row.carteraTargetKg, report);
        return metrics.projectedKg ?? -1;
      },
      render: (row) => {
        const metrics = tabRunRate(row.carteraCurrentKg, row.carteraTargetKg, report);
        return <span className="tabular-nums text-on-surface">{metrics.projectedKg === null ? '—' : fmtKg(metrics.projectedKg)}</span>;
      },
    },
    {
      key: 'brecha',
      header: 'Brecha kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.brechaCliente,
      sortValue: (row) => {
        const metrics = tabRunRate(row.carteraCurrentKg, row.carteraTargetKg, report);
        return metrics.gapKg ?? -Infinity;
      },
      render: (row) => {
        const gap = tabRunRate(row.carteraCurrentKg, row.carteraTargetKg, report).gapKg;
        if (gap === null) return <span className="text-outline">—</span>;
        return (
          <span className={cx('tabular-nums font-semibold', gap < 0 ? 'text-critical' : 'text-success')}>
            {gap > 0 ? '+' : ''}
            {fmtKg(gap)} kg
          </span>
        );
      },
    },
    {
      key: 'ultima',
      header: 'Última nota',
      kind: 'detail',
      sortValue: (row) => row.lastInvoiceDate ?? '',
      render: (row) => <span className="text-label-md text-on-surface-variant">{fmtDate(row.lastInvoiceDate)}</span>,
    },
  ];

  const notaColumns: Column<ForecastSellerClientRow>[] = [
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
            {row.noteHistoricalKg <= 0 && row.noteCurrentKg > 0 && <Badge tone="primary">Nuevo</Badge>}
          </p>
          <p className="text-label-sm text-outline">
            {fmtKg(row.noteHistoricalKg)} kg históricos de nota
            {row.lastInvoiceDate ? ` · últ. ${fmtDate(row.lastInvoiceDate)}` : ''}
          </p>
          {row.assignedSellerCode && row.assignedSellerCode !== seller.sellerCode && (
            <p className="text-label-sm text-warning">
              Cartera de {row.assignedSellerName || row.assignedSellerCode}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'meta',
      header: 'Meta nota',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.metaCliente,
      sortValue: (row) => row.noteTargetKg,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums font-semibold text-primary">
            {row.noteTargetKg > 0 ? fmtKg(row.noteTargetKg) : '—'}
          </p>
          <p className="text-label-sm text-outline">
            {row.noteShareOfSellerPct === null ? '—' : `${fmtPct(row.noteShareOfSellerPct)} peso`}
          </p>
        </div>
      ),
    },
    {
      key: 'venta',
      header: 'Venta firmada',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.ventaCliente,
      sortValue: (row) => row.noteCurrentKg,
      render: (row) => <span className="tabular-nums text-on-surface">{fmtKg(row.noteCurrentKg)}</span>,
    },
    {
      key: 'historico',
      header: 'Histórico nota',
      align: 'right',
      kind: 'detail',
      sortValue: (row) => row.noteHistoricalKg,
      render: (row) => <span className="tabular-nums text-on-surface-variant">{fmtKg(row.noteHistoricalKg)}</span>,
    },
    {
      key: 'cumplimiento',
      header: 'Cumplimiento',
      align: 'right',
      kind: 'status',
      help: SELLER_CLIENT_COLUMN_HELP.cumplimientoCliente,
      sortValue: (row) => {
        const metrics = tabRunRate(row.noteCurrentKg, row.noteTargetKg, report);
        return metrics.projectedAttainmentPct ?? metrics.attainmentPct ?? -1;
      },
      render: (row) => {
        const metrics = tabRunRate(row.noteCurrentKg, row.noteTargetKg, report);
        return <PctPill pct={metrics.projectedAttainmentPct ?? metrics.attainmentPct} emptyLabel="—" />;
      },
    },
    {
      key: 'proyeccion',
      header: 'Proyección kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.proyeccionCliente,
      sortValue: (row) => {
        const metrics = tabRunRate(row.noteCurrentKg, row.noteTargetKg, report);
        return metrics.projectedKg ?? -1;
      },
      render: (row) => {
        const metrics = tabRunRate(row.noteCurrentKg, row.noteTargetKg, report);
        return <span className="tabular-nums text-on-surface">{metrics.projectedKg === null ? '—' : fmtKg(metrics.projectedKg)}</span>;
      },
    },
    {
      key: 'brecha',
      header: 'Brecha kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_CLIENT_COLUMN_HELP.brechaCliente,
      sortValue: (row) => {
        const metrics = tabRunRate(row.noteCurrentKg, row.noteTargetKg, report);
        return metrics.gapKg ?? -Infinity;
      },
      render: (row) => {
        const gap = tabRunRate(row.noteCurrentKg, row.noteTargetKg, report).gapKg;
        if (gap === null) return <span className="text-outline">—</span>;
        return (
          <span className={cx('tabular-nums font-semibold', gap < 0 ? 'text-critical' : 'text-success')}>
            {gap > 0 ? '+' : ''}
            {fmtKg(gap)} kg
          </span>
        );
      },
    },
    {
      key: 'cartera',
      header: 'Cartera asignada',
      align: 'right',
      kind: 'detail',
      sortValue: (row) => row.carteraCurrentKg,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums text-on-surface">{fmtKg(row.carteraCurrentKg)}</p>
          <p className="text-label-sm text-outline">otros {fmtKg(row.otherSellerKg)}</p>
        </div>
      ),
    },
    {
      key: 'ultima',
      header: 'Última nota',
      kind: 'detail',
      sortValue: (row) => row.lastInvoiceDate ?? '',
      render: (row) => <span className="text-label-md text-on-surface-variant">{fmtDate(row.lastInvoiceDate)}</span>,
    },
  ];

  const productColumns: Column<ForecastSellerProductRow>[] = [
    {
      key: 'producto',
      header: 'Producto',
      kind: 'id',
      sortValue: (row) => row.description,
      className: 'w-[17rem] max-w-[17rem]',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-on-surface" title={row.description}>
            {row.description}
          </p>
          <p className="text-label-sm text-outline">
            <span className="tabular-nums">{row.productCode}</span> · {row.uom}
            {row.kgPerUom !== null ? ` · ${row.kgPerUom} kg/${row.uom}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'mes',
      header: 'Cartera mes',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.carteraCurrentKg,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums font-semibold text-on-surface">{fmtKg(row.carteraCurrentKg)}</p>
          <p className="text-label-sm text-outline">
            él {fmtKg(row.noteCurrentKg)} · otros {fmtKg(row.otherCurrentKg)}
          </p>
        </div>
      ),
    },
    {
      key: 'historico',
      header: `Histórico ${historyMonths}m`,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.carteraHistoricalKg,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums text-on-surface">{fmtKg(row.carteraHistoricalKg)}</p>
          <p className="text-label-sm text-outline">nota {fmtKg(row.noteHistoricalKg)}</p>
        </div>
      ),
    },
    {
      key: 'clientes',
      header: 'Clientes',
      align: 'right',
      kind: 'detail',
      sortValue: (row) => row.clientCount,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums text-on-surface">{fmtKg(row.clientCount, 0)}</p>
          <p className="text-label-sm text-outline">nota {fmtKg(row.noteClientCount, 0)}</p>
        </div>
      ),
    },
    {
      key: 'share',
      header: '% cartera',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.carteraShareOfSellerPct ?? -1,
      render: (row) => (
        <span className="tabular-nums text-primary">
          {row.carteraShareOfSellerPct === null ? '—' : fmtPct(row.carteraShareOfSellerPct)}
        </span>
      ),
    },
    {
      key: 'ultima',
      header: 'Última nota',
      kind: 'detail',
      sortValue: (row) => row.lastInvoiceDate ?? '',
      render: (row) => <span className="text-label-md text-on-surface-variant">{fmtDate(row.lastInvoiceDate)}</span>,
    },
  ];

  const tabTitle =
    tab === 'cartera' ? 'Cartera de' : tab === 'nota' ? 'Notas firmadas por' : 'Productos de';
  const tabCount =
    tab === 'cartera'
      ? `${fmtKg(filteredCartera.length, 0)} de ${fmtKg(seller.clientCount, 0)} clientes`
      : tab === 'nota'
        ? `${fmtKg(filteredNota.length, 0)} de ${fmtKg(noteClients.length, 0)} clientes`
        : `${fmtKg(filteredProducts.length, 0)} de ${fmtKg(productQuery.data?.products.length ?? 0, 0)} productos`;
  const tabSummary =
    tab === 'cartera'
      ? `Cuota cartera ${formatQuotaPct(seller.carteraQuotaPct)} · Meta ${fmtKg(seller.carteraTargetKg)} kg · Proyección ${
          carteraMetrics.projectedKg === null ? '—' : `${fmtKg(carteraMetrics.projectedKg)} kg`
        }`
      : tab === 'nota'
        ? `Cuota nota ${formatQuotaPct(seller.noteQuotaPct)} · Meta ${fmtKg(seller.noteTargetKg)} kg · Proyección ${
            noteMetrics.projectedKg === null ? '—' : `${fmtKg(noteMetrics.projectedKg)} kg`
          }`
        : `Cartera ${fmtKg(seller.carteraCurrentKg)} kg · firmado ${fmtKg(seller.noteCurrentKg)} kg`;

  const showNotaWarning = report.attribution === 'NOTE' && seller.noteHistoricalKg <= 0;

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
                Expediente de vendedor
              </p>
              <h2 id="seller-detail-title" className="truncate text-title-md font-bold text-on-surface">
                {seller.sellerName}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 text-label-md text-on-surface-variant">
                <span className="tabular-nums">{seller.sellerCode || 'sin código'}</span>
                <span aria-hidden>·</span>
                <span>{allocationLabel(report)}</span>
                {isLeader && <Badge tone="primary">Mayor cuota</Badge>}
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  Histórico
                  <Select
                    ariaLabel="Ventana histórica del vendedor"
                    value={String(historyMonths)}
                    onChange={(value) => onHistoryMonthsChange(Number(value))}
                    options={HISTORY_OPTIONS}
                    className="h-7 w-24"
                  />
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Cerrar expediente del vendedor"
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
                Lleva {fmtKg(seller.actualKg)} kg{' '}
                {seller.targetKg > 0 ? `(${fmtAttainmentPct(seller.attainmentPct)} de su cuota)` : '(sin cuota)'} y
                representa el {seller.currentSharePct === null ? '—' : fmtPct(seller.currentSharePct)} de la venta del
                mes.
              </p>
            </div>
            <div className="relative flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-space-sm">
              <AttainmentRing pct={seller.projectedAttainmentPct} tone={tone} />
            </div>
          </section>

          {showNotaWarning && (
            <p
              role="status"
              className="flex items-start gap-space-sm rounded-xl bg-warning-container/50 px-space-md py-space-sm text-body-md text-on-warning-container"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              Sin notas firmadas en los últimos {historyMonths} meses. La cuota por nota es 0 %. Su cartera sí tiene{' '}
              {fmtKg(seller.carteraHistoricalKg)} kg históricos; revisa la pestaña Cartera.
            </p>
          )}

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

          <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4">
            <MiniStat
              label="Clientes en cartera"
              value={fmtKg(seller.assignedClientCount, 0)}
              hint={`${fmtKg(seller.activeClientCount, 0)} con venta este mes`}
            />
            <MiniStat
              label="Venta de cartera"
              value={`${fmtKg(seller.carteraCurrentKg)} kg`}
              hint={`histórico ${fmtKg(seller.carteraHistoricalKg)} kg`}
            />
            <MiniStat
              label="Venta firmada"
              value={`${fmtKg(seller.noteCurrentKg)} kg`}
              hint="nota de entrega"
            />
            <MiniStat
              label="Facturado por otro"
              value={`${fmtKg(seller.otherSellerKg)} kg`}
              hint={seller.otherSellerKg > 0 ? 'su cartera, otra nota' : 'sin diferencias'}
              tone={seller.otherSellerKg > 0 ? 'warn' : 'none'}
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
                  description="Cuando Profit registre la primera nota de este vendedor verás aquí su acumulado."
                />
              )}
            </Card>

            <Card className="overflow-hidden p-space-sm">
              <header className="mb-space-xs flex items-center justify-between gap-space-sm px-space-xs">
                <div>
                  <h3 className="text-title-md font-bold text-on-surface">Últimos {historyMonths} meses</h3>
                  <p className="text-label-md text-on-surface-variant">Cartera asignada vs notas firmadas</p>
                </div>
                <Badge tone="muted">
                  {fmtKg(seller.carteraHistoricalKg / Math.max(1, historyMonths))} kg prom. cartera
                </Badge>
              </header>
              {seller.carteraHistory.length > 0 || seller.noteHistory.length > 0 ? (
                <EChart
                  option={historyChart}
                  height={230}
                  ariaLabel={`Histórico de ${seller.sellerName}: cartera y notas firmadas`}
                />
              ) : (
                <EmptyState icon={Users} title="Sin histórico" description="La ventana elegida no tiene meses cerrados." />
              )}
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-space-sm border-b border-surface-container px-space-md py-space-sm">
              <div>
                <div className="flex flex-wrap items-center gap-space-sm">
                  <h3 className="flex items-center gap-1.5 text-title-md font-bold text-on-surface">
                    {tab === 'productos' ? (
                      <Package aria-hidden className="size-4 text-primary" />
                    ) : (
                      <Users aria-hidden className="size-4 text-primary" />
                    )}
                    {tabTitle} {seller.sellerName.split(' ')[0]}
                  </h3>
                  <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface-container p-1">
                    <TabButton active={tab === 'cartera'} onClick={() => setTab('cartera')}>
                      Cartera · {fmtKg(seller.clientCount, 0)}
                    </TabButton>
                    <TabButton active={tab === 'nota'} onClick={() => setTab('nota')}>
                      Nota · {fmtKg(noteClients.length, 0)}
                    </TabButton>
                    <TabButton active={tab === 'productos'} onClick={() => setTab('productos')}>
                      Productos · {fmtKg(productQuery.data?.products.length ?? 0, 0)}
                    </TabButton>
                  </div>
                </div>
                <p className="mt-1 text-label-md text-on-surface-variant">
                  {tabCount} · {tabSummary}
                </p>
                {tab === 'cartera' && <p className="text-label-sm text-outline">La meta de cada cliente es su peso en el histórico de la cartera.</p>}
                {tab === 'nota' && (
                  <p className="text-label-sm text-outline">
                    La meta de cada cliente es su peso en el histórico de las notas firmadas por el vendedor.
                  </p>
                )}
                {tab === 'productos' && (
                  <p className="text-label-sm text-outline">
                    Cartera = venta de sus clientes asignados. Firmado = notas del vendedor. Otros = cartera facturada por otros.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-space-2xs">
                <TextInput
                  icon={Search}
                  value={tab === 'productos' ? productSearch : search}
                  onChange={tab === 'productos' ? setProductSearch : setSearch}
                  placeholder={tab === 'productos' ? 'Buscar producto…' : 'Buscar cliente…'}
                  ariaLabel={tab === 'productos' ? 'Buscar producto en el expediente' : 'Buscar cliente en el expediente'}
                  className="min-w-[10rem]"
                />
                {tab === 'cartera' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSalesFilter((value) => (value === 'with' ? 'all' : 'with'))}
                      aria-pressed={salesFilter === 'with'}
                      className={cx(
                        'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                        salesFilter === 'with'
                          ? 'bg-primary-container text-on-primary'
                          : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                      )}
                    >
                      Con venta
                    </button>
                    <button
                      type="button"
                      onClick={() => setSalesFilter((value) => (value === 'without' ? 'all' : 'without'))}
                      aria-pressed={salesFilter === 'without'}
                      className={cx(
                        'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                        salesFilter === 'without'
                          ? 'bg-surface-container-high text-on-surface'
                          : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                      )}
                    >
                      Sin venta
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
                  </>
                )}
                {tab === 'nota' && (
                  <button
                    type="button"
                    onClick={() => setOnlyNew((value) => !value)}
                    aria-pressed={onlyNew}
                    className={cx(
                      'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                      onlyNew
                        ? 'bg-primary-container text-on-primary'
                        : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                    )}
                  >
                    Nuevos
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (tab === 'cartera') {
                      downloadCsv(buildSellerCarteraCsv(seller, report), csvFileName('clientes-cartera', seller, report));
                    } else if (tab === 'nota') {
                      downloadCsv(buildSellerNotaCsv(seller, report), csvFileName('clientes-nota', seller, report));
                    } else if (productQuery.data) {
                      downloadCsv(
                        buildSellerProductsCsv(productQuery.data.products),
                        csvFileName('productos', seller, report),
                      );
                    }
                  }}
                  disabled={tab === 'productos' && !productQuery.data}
                  className="inline-flex h-9 items-center gap-space-2xs rounded-xl border border-outline-variant/50 px-space-sm text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary disabled:opacity-50"
                >
                  <Download aria-hidden className="size-4" /> CSV
                </button>
              </div>
            </div>

            {tab === 'cartera' && (
              <DataTable
                columns={carteraColumns}
                rows={filteredCartera}
                rowKey={(row) => row.clientCode || row.clientName}
                maxHeightClass="max-h-[46vh]"
                showHelpRow={helpRow}
                empty={
                  <EmptyState
                    icon={Users}
                    title="Sin clientes para el filtro"
                    description="Prueba con otro texto o cambia los filtros."
                  />
                }
              />
            )}

            {tab === 'nota' && (
              <DataTable
                columns={notaColumns}
                rows={filteredNota}
                rowKey={(row) => row.clientCode || row.clientName}
                maxHeightClass="max-h-[46vh]"
                showHelpRow={helpRow}
                empty={
                  <EmptyState
                    icon={Users}
                    title="Sin notas en la ventana"
                    description={
                      seller.noteHistoricalKg <= 0
                        ? 'El vendedor no firmó notas en el histórico. Cambia a la pestaña Cartera para ver sus clientes asignados.'
                        : 'Prueba con otro texto o desactiva el filtro de nuevos.'
                    }
                  />
                }
              />
            )}

            {tab === 'productos' && (
              <>
                {productQuery.isLoading && (
                  <div className="flex flex-col gap-space-sm p-space-md">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                )}
                {productQuery.error && (
                  <p role="alert" className="flex items-center gap-space-sm p-space-md text-body-md text-error">
                    <AlertTriangle aria-hidden className="size-4" />
                    {productQuery.error instanceof Error ? productQuery.error.message : 'No se pudieron cargar los productos'}
                  </p>
                )}
                {!productQuery.isLoading && !productQuery.error && (
                  <DataTable
                    columns={productColumns}
                    rows={filteredProducts}
                    rowKey={(row) => row.productCode || row.description}
                    maxHeightClass="max-h-[46vh]"
                    empty={
                      <EmptyState
                        icon={Package}
                        title="Sin productos para el filtro"
                        description="Prueba con otro texto o cambia la ventana histórica."
                      />
                    }
                  />
                )}
              </>
            )}

            <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-container px-space-md py-space-xs text-label-sm text-on-surface-variant">
              <span>
                {tab === 'cartera'
                  ? 'Σ metas de clientes = meta de cartera del vendedor. Los clientes «sin base» no tienen histórico en la ventana.'
                  : tab === 'nota'
                    ? 'Σ metas de clientes = meta por nota del vendedor. Si no hay histórico de notas, la meta es 0.'
                    : 'Cartera mes = venta de sus clientes; firmado = notas del vendedor; otros = cartera facturada por otros.'}
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
              narrative="La cuota de un vendedor se calcula con su participación histórica; la de cada cliente, con su peso dentro de esa vista."
              rules={SELLERS_HELP_RULES}
              terms={SELLERS_HELP_TERMS}
            />
          </div>
        </div>
      </aside>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'h-7 rounded-lg px-2.5 text-label-md font-semibold transition-colors',
        active ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:text-primary',
      )}
    >
      {children}
    </button>
  );
}

function formatQuotaPct(value: number | null): string {
  return value === null ? '—' : fmtPct(value);
}
