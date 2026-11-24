'use client';

import type { ReceivablesCurrency, ReceivablesResponse } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  Download,
  HandCoins,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppNav, LoginScreen } from '../shell';
import { ModuleHelp } from '../help/ColumnHelp';
import { Badge, Card, DateInput, PageHeader, Segmented, Select, TextInput, useGreeting } from '../ui';
import {
  RECEIVABLES_HELP_RULES,
  RECEIVABLES_HELP_TERMS,
  RECEIVABLES_HELP_TITLE,
} from '../../content/help/receivables';
import { AuthRequiredError, apiFetch } from '../../lib/api';
import {
  buildDocumentsCsv,
  buildSummaryCsv,
  csvFileName,
  downloadCsv,
  formatCompactMoney,
  formatPct,
} from '../../lib/receivables';
import { statementUpdatedAt } from '../../lib/statement';
import { CxcModeSwitch, type CxcMode } from './CxcModeSwitch';
import { MethodCard } from './MethodCard';
import { ReceivablesAnalysis, ReceivablesPulse } from './ReceivablesAnalytics';
import { ReceivablesDocumentsTable, ReceivablesSummaryTable } from './ReceivablesTables';

type View = 'clientes' | 'documentos';

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'clientes', label: 'Por cliente' },
  { value: 'documentos', label: 'Detalle de documentos' },
];

const CURRENCY_OPTIONS: { value: ReceivablesCurrency; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'BS', label: 'Bs' },
];

function useDebounced(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function CarteraView({
  mode,
  onModeChange,
}: {
  mode: CxcMode;
  onModeChange: (mode: CxcMode) => void;
}) {
  const greeting = useGreeting();
  const [view, setView] = useState<View>('clientes');
  const [currency, setCurrency] = useState<ReceivablesCurrency>('USD');
  const [q, setQ] = useState('');
  const [vendor, setVendor] = useState('');
  const [clientType, setClientType] = useState('');
  const [zone, setZone] = useState('');
  const [docType, setDocType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [includeCredit, setIncludeCredit] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [helpRow, setHelpRow] = useState(false);
  const [tick, setTick] = useState(0);
  const manualRefresh = useRef(false);
  const debouncedQ = useDebounced(q);

  const params = useMemo(() => {
    const search = new URLSearchParams();
    search.set('moneda', currency);
    if (debouncedQ.trim()) search.set('q', debouncedQ.trim());
    if (vendor) search.set('vendedor', vendor);
    if (clientType) search.set('tipoCliente', clientType);
    if (zone) search.set('zona', zone);
    if (docType) search.set('tipoDoc', docType);
    if (from) search.set('desde', from);
    if (to) search.set('hasta', to);
    if (onlyOverdue) search.set('soloVencido', 'true');
    if (includeCredit) search.set('incluirAFavor', 'true');
    return search.toString();
  }, [currency, debouncedQ, vendor, clientType, zone, docType, from, to, onlyOverdue, includeCredit]);

  const report = useQuery<ReceivablesResponse>({
    queryKey: ['receivables', params, tick],
    queryFn: () =>
      apiFetch<ReceivablesResponse>(
        `/receivables?${params}${manualRefresh.current ? '&refresh=true' : ''}`,
      ),
    // Mantiene la tabla anterior mientras llega el nuevo filtro: evita el
    // parpadeo de una pantalla vacía en cada tecla.
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (count, error) => !(error instanceof AuthRequiredError) && count < 2,
  });

  const data = report.data;
  const totals = data?.totals;
  const hasFilters = Boolean(
    q.trim() || vendor || clientType || zone || docType || from || to || onlyOverdue || includeCredit,
  );

  const vendorOptions = useMemo(
    () => [{ value: '', label: 'Vendedor: todos' }, ...(data?.opciones.vendedores ?? [])],
    [data?.opciones.vendedores],
  );
  const typeOptions = useMemo(
    () => [{ value: '', label: 'Tipo: todos' }, ...(data?.opciones.tipos ?? [])],
    [data?.opciones.tipos],
  );
  const zoneOptions = useMemo(
    () => [{ value: '', label: 'Zona: todas' }, ...(data?.opciones.zonas ?? [])],
    [data?.opciones.zonas],
  );
  const docTypeOptions = useMemo(
    () => [{ value: '', label: 'Tipo de doc: todos' }, ...(data?.opciones.tiposDoc ?? [])],
    [data?.opciones.tiposDoc],
  );

  if (report.error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((value) => value + 1)} />;
  }

  function clearFilters() {
    setQ('');
    setVendor('');
    setClientType('');
    setZone('');
    setDocType('');
    setFrom('');
    setTo('');
    setOnlyOverdue(false);
    setIncludeCredit(false);
  }

  function refresh() {
    manualRefresh.current = true;
    void report.refetch().finally(() => {
      manualRefresh.current = false;
    });
  }

  function exportCsv() {
    if (!data) return;
    if (view === 'clientes') {
      downloadCsv(csvFileName('clientes', currency), buildSummaryCsv(data));
    } else {
      downloadCsv(csvFileName('documentos', currency), buildDocumentsCsv(data));
    }
  }

  const errorMessage =
    report.error instanceof Error
      ? report.error.message
      : 'No se pudo consultar la cartera en Profit.';

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Comercial · Cuentas por cobrar"
          icon={HandCoins}
          title="Cuentas por Cobrar"
          subtitle="Cartera viva de Profit por cliente, con la matriz completa de vencimiento (1–30, 31–60, 61–90, 91–120, 121–150 y +150 partido en hasta 01/01/2025 y desde esa fecha), saldo a favor, concentración y cobranza de los últimos 12 meses. Cambia a Ventas + cartera para cruzar la venta del año con la deuda."
          greeting={greeting}
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              {data && (
                <Badge tone={data.source === 'fixtures' ? 'warning' : 'success'} dot>
                  {data.source === 'fixtures' ? 'Datos de prueba' : 'Profit en vivo'}
                </Badge>
              )}
              <button
                type="button"
                onClick={refresh}
                disabled={report.isFetching}
                className="inline-flex h-10 items-center gap-space-xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-body-md font-semibold text-primary shadow-soft transition-colors hover:bg-surface-container-low disabled:opacity-60"
              >
                <RefreshCw aria-hidden className={`size-4 ${report.isFetching ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
              <button
                type="button"
                onClick={exportCsv}
                disabled={!data || data.clientes.length === 0}
                className="inline-flex h-10 items-center gap-space-xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-body-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary disabled:opacity-50"
              >
                <Download aria-hidden className="size-4" />
                CSV
              </button>
              <ModuleHelp
                title={RECEIVABLES_HELP_TITLE}
                narrative="La cartera se arma documento por documento desde Profit. Los débitos son deuda; los adelantos y notas de crédito se muestran aparte como saldo a favor. La cartera neta es la diferencia."
                rules={RECEIVABLES_HELP_RULES}
                terms={RECEIVABLES_HELP_TERMS}
              />
            </div>
          }
        />

        <CxcModeSwitch mode={mode} onChange={onModeChange} />

        {errorMessage && !data ? (
          <Card className="flex flex-col items-start gap-space-sm p-space-lg">
            <span className="flex items-center gap-space-xs font-semibold text-error">
              <AlertTriangle aria-hidden className="size-4" /> {errorMessage}
            </span>
            <p className="text-body-md text-on-surface-variant">
              La cartera se lee en vivo de Profit. Revisa la conexión y vuelve a intentar.
            </p>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              <RefreshCw aria-hidden className="size-4" /> Reintentar
            </button>
          </Card>
        ) : !data ? (
          <Card className="flex items-center justify-center gap-space-sm p-space-2xl text-on-surface-variant">
            <Loader2 aria-hidden className="size-5 animate-spin text-primary" />
            <span className="text-body-md">Leyendo la cartera de Profit…</span>
          </Card>
        ) : (
          <>
            <ReceivablesPulse report={data} currency={currency} />

            <Card className="overflow-hidden">
              <div className="flex flex-col gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
                <div className="flex flex-wrap items-center justify-between gap-space-sm">
                  <div className="flex flex-wrap items-center gap-space-sm">
                    <Segmented
                      ariaLabel="Vista de cuentas por cobrar"
                      value={view}
                      onChange={(value) => {
                        setView(value);
                        setExpanded(null);
                      }}
                      options={VIEW_OPTIONS}
                    />
                    <TextInput
                      className="w-60"
                      icon={Search}
                      value={q}
                      onChange={setQ}
                      placeholder="Buscar cliente, código o vendedor…"
                      ariaLabel="Buscar en la cartera"
                    />
                    <Select
                      className="w-56"
                      value={vendor}
                      onChange={setVendor}
                      options={vendorOptions}
                      ariaLabel="Filtrar por vendedor de cartera"
                    />
                    <Segmented
                      ariaLabel="Moneda de la cartera"
                      value={currency}
                      onChange={setCurrency}
                      options={CURRENCY_OPTIONS}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-space-sm">
                    {report.isFetching && <Loader2 aria-hidden className="size-3.5 animate-spin text-outline" />}
                    <label className="flex h-10 cursor-pointer items-center gap-space-xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-label-md font-semibold text-on-surface-variant">
                      <input
                        type="checkbox"
                        checked={onlyOverdue}
                        onChange={(event) => setOnlyOverdue(event.target.checked)}
                        className="size-4 accent-primary"
                      />
                      Solo vencido
                    </label>
                    <button
                      type="button"
                      onClick={() => setAdvanced((value) => !value)}
                      aria-pressed={advanced}
                      className={`inline-flex h-10 items-center gap-space-xs rounded-xl border px-space-sm text-label-md font-semibold transition-colors ${
                        advanced
                          ? 'border-primary-container/40 bg-primary-fixed text-primary'
                          : 'border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant hover:text-primary'
                      }`}
                    >
                      <SlidersHorizontal aria-hidden className="size-4" />
                      Más filtros
                    </button>
                    {hasFilters && (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="inline-flex h-10 items-center gap-space-2xs rounded-xl px-space-sm text-label-md font-semibold text-primary-container transition-colors hover:bg-surface-container-low"
                      >
                        <X aria-hidden className="size-3.5" /> Limpiar
                      </button>
                    )}
                  </div>
                </div>

                {advanced && (
                  <div className="grid gap-space-sm border-t border-outline-variant/20 pt-space-sm sm:grid-cols-2 xl:grid-cols-5">
                    <Select
                      value={clientType}
                      onChange={setClientType}
                      options={typeOptions}
                      ariaLabel="Filtrar por tipo de cliente"
                    />
                    <Select
                      value={zone}
                      onChange={setZone}
                      options={zoneOptions}
                      ariaLabel="Filtrar por zona"
                    />
                    <Select
                      value={docType}
                      onChange={(value) => {
                        setDocType(value);
                        if (value) {
                          setView('documentos');
                          setExpanded(null);
                        }
                      }}
                      options={docTypeOptions}
                      ariaLabel="Filtrar por tipo de documento"
                    />
                    <label className="flex flex-col gap-space-2xs">
                      <span className="text-label-sm font-semibold uppercase tracking-wide text-outline">Emisión desde</span>
                      <DateInput className="w-full" value={from} onChange={setFrom} ariaLabel="Fecha de emisión desde" />
                    </label>
                    <label className="flex flex-col gap-space-2xs">
                      <span className="text-label-sm font-semibold uppercase tracking-wide text-outline">Emisión hasta</span>
                      <DateInput className="w-full" value={to} onChange={setTo} ariaLabel="Fecha de emisión hasta" />
                    </label>
                    <label className="flex items-center gap-space-xs text-label-md font-semibold text-on-surface-variant sm:col-span-2 xl:col-span-5">
                      <input
                        type="checkbox"
                        checked={includeCredit}
                        onChange={(event) => setIncludeCredit(event.target.checked)}
                        className="size-4 accent-primary"
                      />
                      Incluir adelantos y notas de crédito en la lista de documentos (siempre se muestran en el resumen como «a favor»)
                    </label>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
                  <span>
                    {totals?.clientes ?? 0} cliente(s) con saldo · {totals?.clientesConDeuda ?? 0} con deuda ·{' '}
                    {totals?.documentos ?? 0} documento(s) débito
                  </span>
                  <span aria-hidden>·</span>
                  <span>{formatCompactMoney(totals?.cartera ?? 0, currency)} bruto</span>
                  <span aria-hidden>·</span>
                  <span className="font-semibold text-error">{formatCompactMoney(totals?.vencido ?? 0, currency)} vencido</span>
                  <span aria-hidden>·</span>
                  <span>{formatCompactMoney(totals?.cobrado12m ?? 0, currency)} cobrado 12 m</span>
                  <span aria-hidden>·</span>
                  <span>{formatPct(totals?.pctCobranzaATiempo ?? null)} a tiempo</span>
                  <span aria-hidden>·</span>
                  <span>Corte {statementUpdatedAt(data.asOf)}</span>
                  {hasFilters && <Badge tone="primary">Filtros activos</Badge>}
                  {report.error && <Badge tone="danger">No se pudo actualizar</Badge>}
                  {currency === 'USD' && data.risk.clientesSobreLimite > 0 && (
                    <Badge tone="warning">{data.risk.clientesSobreLimite} sobre límite</Badge>
                  )}
                  {data.quality.truncado && <Badge tone="warning">Cifras recortadas</Badge>}
                  {(data.quality.sinTasa > 0 || data.quality.sinVencimiento > 0) && (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <AlertTriangle aria-hidden className="size-3.5" />
                      {data.quality.sinTasa > 0 && `${data.quality.sinTasa} sin tasa`}
                      {data.quality.sinTasa > 0 && data.quality.sinVencimiento > 0 && ' · '}
                      {data.quality.sinVencimiento > 0 && `${data.quality.sinVencimiento} sin vencimiento`}
                    </span>
                  )}
                </div>
              </div>

              {view === 'clientes' ? (
                <ReceivablesSummaryTable
                  report={data}
                  currency={currency}
                  expandedKey={expanded}
                  onToggle={(code) => setExpanded((current) => (current === code ? null : code))}
                  showHelpRow={helpRow}
                />
              ) : (
                <ReceivablesDocumentsTable report={data} currency={currency} showHelpRow={helpRow} />
              )}

              <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/25 px-space-md py-space-sm text-label-sm text-on-surface-variant">
                <span>
                  Haz clic en un cliente o pulsa «Documentos» para ver sus filas. Desliza la tabla para ver todos
                  los tramos y la cobranza. Los importes en USD usan la tasa de cada documento.
                </span>
                <button
                  type="button"
                  onClick={() => setHelpRow((value) => !value)}
                  aria-pressed={helpRow}
                  className={`rounded-lg px-space-xs py-1 font-semibold transition-colors ${
                    helpRow ? 'bg-primary-container/10 text-primary' : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  {helpRow ? 'Ocultar explicaciones' : 'Explicar columnas'}
                </button>
              </div>
            </Card>

            <ReceivablesAnalysis
              report={data}
              currency={currency}
              onVendor={(code) => {
                setVendor(code);
                setView('clientes');
              }}
              onClient={(code) => {
                setView('clientes');
                setExpanded(code);
              }}
            />

            <div className="grid gap-space-md sm:grid-cols-2 xl:grid-cols-4">
              <MethodCard
                icon={Wallet}
                title="Qué suma la cartera"
                text="Solo documentos débito (FACT, N/DB, AJPM y GIRO). Los adelantos y notas de crédito se restan como saldo a favor; no inflan la mora."
              />
              <MethodCard
                icon={CalendarClock}
                title="El vencimiento se mide contra hoy"
                text="Cada documento cae en un solo tramo. «Por vencer» incluye los que vencen hoy; a partir del día siguiente empieza la mora de 1–30."
              />
              <MethodCard
                icon={HandCoins}
                title="La tasa es la del documento"
                text="En USD se usa la tasa con la que nació cada factura, igual que el estado de cuenta de Clientes. En Bs se muestra el saldo nativo."
              />
              <MethodCard
                icon={CalendarCheck}
                title="Cobranza de 12 meses"
                text="El cobrado y el % a tiempo usan los abonos aplicados a facturas en los últimos 12 meses. Se ponderan por monto: un abono grande pesa más que uno pequeño."
              />
            </div>
          </>
        )}
      </main>
    </>
  );
}
