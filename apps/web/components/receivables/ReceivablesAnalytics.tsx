'use client';

import type { ReceivablesCurrency, ReceivablesResponse } from '@nexo/contracts';
import {
  AlertTriangle,
  Banknote,
  CalendarCheck,
  HandCoins,
  Landmark,
  Scale,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useMemo } from 'react';
import { EChart } from '../EChart';
import { Badge, Card, HeroCard, Kpi } from '../ui';
import {
  BUCKET_COLORS,
  formatCompactMoney,
  formatCount,
  formatPct,
  formatReceivablesMoney,
  vendorRows,
} from '../../lib/receivables';

// ============================================================
// Cabecera analítica de CxC: cartera vencida, KPIs, antigüedad,
// concentración y ranking de vendedores. Todo deriva de la respuesta del API.
// ============================================================

export function ReceivablesPulse({
  report,
  currency,
}: {
  report: ReceivablesResponse;
  currency: ReceivablesCurrency;
}) {
  const totals = report.totals;
  const onTimeTone: 'success' | 'warning' | 'danger' | 'muted' =
    totals.pctCobranzaATiempo === null
      ? 'muted'
      : totals.pctCobranzaATiempo >= 80
        ? 'success'
        : totals.pctCobranzaATiempo >= 60
          ? 'warning'
          : 'danger';
  const agingOption = useMemo(() => {
    const axis = report.buckets.map((bucket) => bucket.short);
    return {
      animationDuration: 450,
      grid: { left: 4, right: 10, top: 30, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const list = params as Array<{ dataIndex: number }>;
          const bucket = report.buckets[list[0]?.dataIndex ?? 0];
          if (!bucket) return '';
          return `<strong>${bucket.label}</strong><br/>${formatReceivablesMoney(
            bucket.amount,
            currency,
          )}<br/>${bucket.documentos} documento(s) · ${formatPct(bucket.pct)}`;
        },
      },
      xAxis: {
        type: 'category',
        data: axis,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#c3c6d1' } },
        axisLabel: { color: '#737780', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(195,198,209,.35)' } },
        axisLabel: {
          color: '#737780',
          fontSize: 10,
          formatter: (value: number) => formatCompactMoney(value, currency),
        },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 44,
          data: report.buckets.map((bucket) => ({
            value: bucket.amount,
            itemStyle: { color: BUCKET_COLORS[bucket.key], borderRadius: [6, 6, 0, 0] },
          })),
          label: {
            show: true,
            position: 'top',
            color: '#43474f',
            fontSize: 10,
            formatter: (params: { value?: number }) =>
              (params.value ?? 0) > 0 ? formatCompactMoney(params.value ?? 0, currency) : '',
          },
        },
      ],
    };
  }, [report.buckets, currency]);

  return (
    <section className="grid gap-space-md xl:grid-cols-12">
      <div className="flex flex-col gap-space-md xl:col-span-4">
        <HeroCard
          label="Cartera vencida"
          value={formatCompactMoney(totals.vencido, currency)}
          hint={`${formatPct(totals.pctVencido)} de ${formatCompactMoney(
            totals.cartera,
            currency,
          )} · ${formatCompactMoney(totals.porVencer, currency)} por vencer`}
          progress={totals.pctVencido}
          icon={AlertTriangle}
        />
        <div className="stagger grid grid-cols-2 gap-space-sm">
          <Kpi
            label="Cartera neta"
            value={formatCompactMoney(totals.neto, currency)}
            hint={`${formatCompactMoney(totals.aFavor, currency)} a favor`}
            tone="primary"
            icon={Wallet}
          />
          <Kpi
            label="Clientes con deuda"
            value={String(totals.clientesConDeuda)}
            suffix={`/ ${totals.clientes}`}
            hint={`${totals.documentos} documentos`}
            tone="primary"
            icon={Users}
          />
          <Kpi
            label="Cobrado 90 días"
            value={formatCompactMoney(totals.cobrado90, currency)}
            hint={`${totals.clientesSinPago30} sin abonos en 30 d`}
            tone="success"
            icon={TrendingUp}
          />
          <Kpi
            label="Cobrado 12 meses"
            value={formatCompactMoney(totals.cobrado12m, currency)}
            hint={`${formatCount(totals.pagos12m)} pagos · ${formatCompactMoney(
              totals.cobrado12mATiempo,
              currency,
            )} a tiempo`}
            tone="primary"
            icon={Banknote}
          />
          <Kpi
            label="Cobranza a tiempo"
            value={formatPct(totals.pctCobranzaATiempo)}
            hint={`${formatCount(totals.pagos12mATiempo)} de ${formatCount(
              totals.pagos12m,
            )} pagos`}
            tone={onTimeTone}
            icon={CalendarCheck}
          />
          <Kpi
            label="A favor"
            value={formatCompactMoney(totals.aFavor, currency)}
            hint={`${totals.notasCredito} adelanto(s) y nota(s)`}
            tone={totals.aFavor > 0 ? 'success' : 'muted'}
            icon={HandCoins}
          />
        </div>
      </div>

      <Card className="flex flex-col xl:col-span-8">
        <div className="flex flex-wrap items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
          <div>
            <h2 className="text-title-md font-bold text-on-surface">Antigüedad de la cartera</h2>
            <p className="text-label-md text-on-surface-variant">
              Monto por tramo de vencimiento. La cartera bruta se reparte completa entre las barras.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-space-xs">
            <Badge tone="danger">{formatPct(totals.pctVencido)} vencido</Badge>
            <Badge tone="muted">{totals.documentosVencidos} docs vencidos</Badge>
          </div>
        </div>
        <div className="px-space-sm pb-space-sm">
          <EChart
            option={agingOption}
            height={300}
            ariaLabel="Distribución de la cartera por tramos de vencimiento"
          />
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-space-md gap-y-space-xs border-t border-outline-variant/25 px-space-md py-space-sm text-label-sm text-on-surface-variant">
          <span>
            Días máx. vencido: <strong className="tabular-nums text-on-surface">{totals.diasMaxVencido ?? '—'}</strong>
          </span>
          <span>
            Promedio de atraso:{' '}
            <strong className="tabular-nums text-on-surface">
              {totals.diasPromedioVencido === null ? '—' : `${totals.diasPromedioVencido} d`}
            </strong>
          </span>
          <span>
            Ticket promedio:{' '}
            <strong className="tabular-nums text-on-surface">
              {formatReceivablesMoney(totals.ticketPromedio, currency)}
            </strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-space-md gap-y-space-xs border-t border-outline-variant/25 bg-surface-container-low/40 px-space-md py-space-sm text-label-sm text-on-surface-variant">
          <span className="inline-flex items-center gap-1">
            <Banknote aria-hidden className="size-3.5 text-primary" />
            Cobrado 12 m:{' '}
            <strong className="tabular-nums text-on-surface">
              {formatCompactMoney(totals.cobrado12m, currency)}
            </strong>
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarCheck aria-hidden className="size-3.5 text-primary" />
            <strong className="tabular-nums text-on-surface">
              {formatPct(totals.pctCobranzaATiempo)}
            </strong>
            a tiempo
          </span>
          <span>
            {formatCount(totals.pagos12m)} pagos · {formatCount(totals.pagos12mATiempo)} a tiempo
          </span>
        </div>
      </Card>
    </section>
  );
}

export function ReceivablesAnalysis({
  report,
  currency,
  onVendor,
  onClient,
}: {
  report: ReceivablesResponse;
  currency: ReceivablesCurrency;
  onVendor: (code: string) => void;
  onClient: (code: string) => void;
}) {
  const topClients = useMemo(
    () => report.clientes.filter((row) => row.cartera > 0).slice(0, 8),
    [report.clientes],
  );
  const vendors = useMemo(() => vendorRows(report.clientes).slice(0, 6), [report.clientes]);
  const maxVendor = vendors[0]?.cartera ?? 0;

  const topOption = useMemo(() => {
    const labels = topClients.map((row) =>
      row.nombre.length > 30 ? `${row.nombre.slice(0, 29)}…` : row.nombre,
    );
    return {
      animationDuration: 400,
      grid: { left: 4, right: 56, top: 6, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const list = params as Array<{ dataIndex: number; value: number }>;
          const row = topClients[list[0]?.dataIndex ?? 0];
          if (!row) return '';
          return `<strong>${row.nombre}</strong><br/>${formatReceivablesMoney(
            row.cartera,
            currency,
          )}<br/>${formatPct(row.pctVencido)} vencido · ${row.vendedor}`;
        },
      },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(195,198,209,.3)' } },
        axisLabel: {
          color: '#737780',
          fontSize: 10,
          formatter: (value: number) => formatCompactMoney(value, currency),
        },
      },
      yAxis: {
        type: 'category',
        data: labels,
        inverse: true,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: '#43474f', fontSize: 10, width: 190, overflow: 'truncate' },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 18,
          data: topClients.map((row, index) => ({
            value: row.cartera,
            itemStyle: {
              color: index === 0 ? '#dc2626' : '#003366',
              borderRadius: [0, 4, 4, 0],
            },
          })),
          label: {
            show: true,
            position: 'right',
            color: '#43474f',
            fontSize: 10,
            formatter: (params: { value?: number }) =>
              formatCompactMoney(params.value ?? 0, currency),
          },
        },
      ],
    };
  }, [topClients, currency]);

  return (
    <section className="grid gap-space-md xl:grid-cols-12">
      <Card className="xl:col-span-5">
        <div className="flex items-start justify-between gap-space-sm px-space-md pt-space-md">
          <div>
            <h2 className="text-title-md font-bold text-on-surface">Concentración por cliente</h2>
            <p className="text-label-md text-on-surface-variant">
              Los mayores saldos. Haz clic en una barra para abrir el detalle de ese cliente.
            </p>
          </div>
          <Badge tone={report.risk.top5Pct >= 80 ? 'danger' : 'warning'}>
            Top 5: {formatPct(report.risk.top5Pct)}
          </Badge>
        </div>
        {topClients.length > 0 ? (
          <div className="px-space-sm pb-space-sm">
            <EChart
              option={topOption}
              height={280}
              ariaLabel="Clientes con mayor cartera"
              pointerCategories={topClients.map((_, index) => index)}
              onCategoryClick={(index) => {
                const row = topClients[index];
                if (row) onClient(row.codigo);
              }}
            />
          </div>
        ) : (
          <p className="px-space-md py-space-lg text-body-md text-on-surface-variant">
            Sin clientes con deuda para los filtros actuales.
          </p>
        )}
      </Card>

      <Card className="xl:col-span-4">
        <div className="flex items-start justify-between gap-space-sm px-space-md pt-space-md">
          <div>
            <h2 className="text-title-md font-bold text-on-surface">Cartera por vendedor</h2>
            <p className="text-label-md text-on-surface-variant">
              Responsable de la cartera del cliente. Haz clic para filtrar.
            </p>
          </div>
          <Landmark aria-hidden className="size-4 text-primary" />
        </div>
        <ul className="mt-space-sm flex flex-col divide-y divide-outline-variant/20 px-space-md pb-space-md">
          {vendors.map((vendor) => {
            const width = maxVendor > 0 ? Math.max(3, Math.round((vendor.cartera / maxVendor) * 100)) : 0;
            return (
              <li key={`${vendor.codigo}-${vendor.vendedor}`}>
                <button
                  type="button"
                  onClick={() => onVendor(vendor.codigo)}
                  className="flex w-full flex-col gap-1 py-space-sm text-left transition-colors hover:text-primary"
                  title={`Filtrar por ${vendor.vendedor}`}
                >
                  <span className="flex items-baseline justify-between gap-space-sm">
                    <span className="truncate text-label-md font-semibold text-on-surface">
                      {vendor.vendedor}
                    </span>
                    <span className="shrink-0 tabular-nums text-label-md font-bold text-primary">
                      {formatCompactMoney(vendor.cartera, currency)}
                    </span>
                  </span>
                  <span className="flex items-center gap-space-sm">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-container-high">
                      <span
                        className="block h-full rounded-pill bg-primary-container"
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="shrink-0 text-label-sm tabular-nums text-on-surface-variant">
                      {vendor.clientes} cli. · {formatPct(vendor.pctVencido)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {vendors.length === 0 && (
            <li className="py-space-md text-body-md text-on-surface-variant">Sin vendedores con cartera.</li>
          )}
        </ul>
      </Card>

      <RiskCards report={report} currency={currency} />
    </section>
  );
}

function RiskCards({ report, currency }: { report: ReceivablesResponse; currency: ReceivablesCurrency }) {
  const risk = report.risk;
  return (
    <div className="flex flex-col gap-space-sm xl:col-span-3">
      <RiskCard
        tone="danger"
        icon={AlertTriangle}
        label="Más de 90 días"
        value={`${risk.clientesMas90} clientes`}
        detail={`${formatReceivablesMoney(risk.montoMas90, currency)} · ${risk.clientesMas150} con +150 d`}
      />
      <RiskCard
        tone="warning"
        icon={Users}
        label="Sin abonos en 30 días"
        value={`${risk.clientesSinPago30} clientes`}
        detail={formatReceivablesMoney(risk.montoSinPago30, currency)}
      />
      <RiskCard
        tone={risk.top5Pct >= 80 ? 'danger' : 'primary'}
        icon={Landmark}
        label="Concentración"
        value={risk.topCliente ? formatPct(risk.topCliente.pct) : '—'}
        detail={
          risk.topCliente
            ? `${risk.topCliente.nombre} · ${formatCompactMoney(risk.topCliente.monto, currency)}`
            : 'Sin cartera concentrada'
        }
      />
      {currency === 'USD' && risk.clientesSobreLimite > 0 && (
        <RiskCard
          tone="warning"
          icon={Scale}
          label="Sobre el límite"
          value={`${risk.clientesSobreLimite} clientes`}
          detail={formatReceivablesMoney(risk.montoSobreLimite, currency)}
        />
      )}
    </div>
  );
}

function RiskCard({
  tone,
  icon: Icon,
  label,
  value,
  detail,
}: {
  tone: 'danger' | 'warning' | 'primary' | 'success';
  icon: typeof AlertTriangle;
  label: string;
  value: string;
  detail: string;
}) {
  const colors: Record<typeof tone, string> = {
    danger: 'bg-critical-container text-on-critical-container',
    warning: 'bg-warning-container text-on-warning-container',
    primary: 'bg-primary-fixed text-primary',
    success: 'bg-success-container text-on-success-container',
  };
  return (
    <Card className="flex items-start gap-space-sm p-space-md">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${colors[tone]}`}>
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">{label}</p>
        <p className="truncate text-title-md font-bold tabular-nums text-on-surface">{value}</p>
        <p className="truncate text-label-sm text-on-surface-variant" title={detail}>
          {detail}
        </p>
      </div>
    </Card>
  );
}
