'use client';

import { RECEIVABLES_BUCKETS } from '@nexo/contracts';
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
import { AgingLegend, AgingMixRow } from './AgingBars';
import {
  BUCKET_COLORS,
  BUCKET_LABEL_COLORS,
  bucketAmount,
  formatCompactMoney,
  formatCount,
  formatPct,
  formatPctCompact,
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
        appendToBody: true,
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
  const vendors = useMemo(
    () => vendorRows(report.clientes).filter((vendor) => vendor.cartera > 0).slice(0, 6),
    [report.clientes],
  );
  const maxVendor = vendors[0]?.cartera ?? 0;
  const maxClient = topClients[0]?.cartera ?? 0;

  const topOption = useMemo(() => {
    const labels = topClients.map((row) =>
      row.nombre.length > 30 ? `${row.nombre.slice(0, 29)}…` : row.nombre,
    );
    const bucketSeries: Record<string, unknown>[] = RECEIVABLES_BUCKETS.map((bucket) => ({
      name: bucket.short,
      type: 'bar',
      stack: 'aging',
      barWidth: 18,
      data: topClients.map((row) => ({
        value: bucketAmount(row, bucket.key),
        itemStyle: { color: BUCKET_COLORS[bucket.key] },
      })),
      itemStyle: { borderColor: '#ffffff', borderWidth: 0.5 },
      label: {
        show: true,
        position: 'inside',
        color: BUCKET_LABEL_COLORS[bucket.key],
        fontSize: 9,
        fontWeight: 700,
        formatter: (params: { dataIndex?: number }) => {
          const row = topClients[params.dataIndex ?? 0];
          if (!row || row.cartera <= 0 || maxClient <= 0) return '';
          const amount = bucketAmount(row, bucket.key);
          const trackShare = (amount / maxClient) * 100;
          const pct = (amount / row.cartera) * 100;
          return trackShare >= 8 && pct >= 4 ? formatPctCompact(pct) : '';
        },
      },
    }));

    return {
      animationDuration: 450,
      grid: { left: 4, right: 56, top: 6, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        appendToBody: true,
        formatter: (params: unknown) => {
          const list = params as Array<{ dataIndex: number; seriesName?: string }>;
          const row = topClients[list[0]?.dataIndex ?? 0];
          if (!row) return '';
          const lines = RECEIVABLES_BUCKETS.map((bucket) => {
            const amount = bucketAmount(row, bucket.key);
            if (amount <= 0) return '';
            const pct = row.cartera > 0 ? (amount / row.cartera) * 100 : 0;
            return `<div style="display:flex;justify-content:space-between;gap:16px;white-space:nowrap"><span style="color:#c3c6d1">${
              bucket.short
            }</span><span><b>${formatReceivablesMoney(
              amount,
              currency,
            )}</b> · ${formatPct(pct)}</span></div>`;
          })
            .filter(Boolean)
            .join('');
          return `<div style="font-weight:700;margin-bottom:4px">${row.nombre}</div><div style="margin-bottom:6px">${formatReceivablesMoney(
            row.cartera,
            currency,
          )} · <span style="color:#fca5a5">${formatPct(row.pctVencido)} vencido</span> · ${
            row.vendedor
          }</div>${lines}`;
        },
      },
      legend: { show: false },
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
        ...bucketSeries,
        // Barra transparente superpuesta: coloca el monto total al final de la
        // pila sin sumar otro segmento ni alterar el tooltip.
        {
          name: 'Total',
          type: 'bar',
          barWidth: 18,
          barGap: '-100%',
          silent: true,
          z: 10,
          tooltip: { show: false },
          data: topClients.map((row) => row.cartera),
          itemStyle: { color: 'transparent' },
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
  }, [topClients, maxClient, currency]);

  return (
    <div className="flex flex-col gap-space-md">
      <Card className="flex flex-wrap items-center justify-between gap-space-sm px-space-md py-space-sm">
        <AgingLegend buckets={report.buckets} />
        <p className="text-label-sm normal-case text-on-surface-variant">
          Color = antigüedad · largo = deuda total
        </p>
      </Card>

      <section className="grid gap-space-md xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <div className="flex items-start justify-between gap-space-sm px-space-md pt-space-md">
            <div>
              <h2 className="text-title-md font-bold text-on-surface">Concentración por cliente</h2>
              <p className="text-label-md text-on-surface-variant">
                Los mayores saldos, con su mezcla de antigüedad. Pasa el cursor para ver el
                desglose y haz clic para abrir el cliente.
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
                height={300}
                ariaLabel="Clientes con mayor cartera, repartida por tramos de antigüedad"
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
                Cómo se reparte la deuda de cada vendedor por antigüedad. Haz clic para filtrar.
              </p>
            </div>
            <Landmark aria-hidden className="size-4 text-primary" />
          </div>
          <ul className="mt-space-sm flex flex-col divide-y divide-outline-variant/20 px-space-md pb-space-md">
            {vendors.map((vendor) => (
              <li key={`${vendor.codigo}-${vendor.vendedor}`}>
                <AgingMixRow
                  title={vendor.vendedor}
                  subtitle={`${vendor.clientes} clientes · ${formatPct(vendor.pctVencido)} vencido`}
                  amount={vendor.cartera}
                  segments={vendor.aging}
                  max={maxVendor}
                  currency={currency}
                  onClick={() => onVendor(vendor.codigo)}
                  ariaLabel={`Filtrar por ${vendor.vendedor}`}
                />
              </li>
            ))}
            {vendors.length === 0 && (
              <li className="py-space-md text-body-md text-on-surface-variant">
                Sin vendedores con cartera.
              </li>
            )}
          </ul>
        </Card>

        <RiskCards report={report} currency={currency} />
      </section>
    </div>
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
