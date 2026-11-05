import type {
  DispatchDurationStats,
  DispatchMetricsCustomer,
  DispatchMetricsOrder,
  DispatchMetricsQuery,
  DispatchMetricsResponse,
  DispatchMetricsSeriesPoint,
  DispatchMetricsSummary,
} from '@nexo/contracts';

// ============================================================
// Reporte de tiempos de despacho: funciones PURAS.
//
// La API solo trae las hojas visibles con sus renglones y relojes por
// cliente; aquí se calculan los promedios, medianas, P90, series por día/mes
// y el cumplimiento contra la fecha planificada. Se prueba sin Prisma.
//
// Regla de negocio:
//   · carga   = inicio de carga del cliente → último producto cerrado
//   · factura = inicio de carga del cliente → factura entregada
//   · a tiempo = la factura se entregó en la fecha planificada o antes
// ============================================================

export interface MetricLine {
  orderNumber: string;
  productCode: string;
  description: string | null;
  status: string;
  effectiveDate: string | null;
  plannedKg: unknown;
  customerCode: string | null;
  customerName: string | null;
  checkedAt: Date | null;
  checkedByName: string | null;
}

export interface MetricProgress {
  customerKey: string;
  customerCode: string | null;
  customerName: string | null;
  loadStartedAt: Date | null;
  loadClosedAt: Date | null;
  invoiceDeliveredAt: Date | null;
  invoiceDeliveredByName: string | null;
  invoiceRef: string | null;
}

export interface MetricSheet {
  id: string;
  number: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  lines: MetricLine[];
  customerProgress: MetricProgress[];
}

interface GroupMetric {
  sheet: MetricSheet;
  customerKey: string;
  customerCode: string | null;
  customerName: string;
  lines: MetricLine[];
  loadStart: Date | null;
  loadClose: Date | null;
  invoiceAt: Date | null;
  loadMinutes: number | null;
  invoiceMinutes: number | null;
  kg: number;
  loadInRange: boolean;
  invoiceInRange: boolean;
  pendingInRange: boolean;
}

const SIN_CLIENTE = 'SIN_CLIENTE';

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function customerKey(line: Pick<MetricLine, 'customerCode' | 'customerName'>): string {
  return line.customerCode?.trim() || line.customerName?.trim() || SIN_CLIENTE;
}

function minutesBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

/** Fecha de negocio (America/Caracas) como yyyy-MM-dd. */
export function businessDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function stats(values: number[]): DispatchDurationStats {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) {
    return { groups: 0, avgMinutes: null, medianMinutes: null, p90Minutes: null };
  }
  const avg = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const median =
    clean.length % 2 === 1
      ? clean[(clean.length - 1) / 2]!
      : ((clean[clean.length / 2 - 1] ?? 0) + (clean[clean.length / 2] ?? 0)) / 2;
  const p90 = clean[Math.min(clean.length - 1, Math.ceil(clean.length * 0.9) - 1)] ?? clean[clean.length - 1]!;
  return {
    groups: clean.length,
    avgMinutes: round(avg),
    medianMinutes: round(median),
    p90Minutes: round(p90),
  };
}

function percent(part: number, total: number): number | null {
  if (total <= 0) return null;
  return round((part / total) * 100, 1);
}

function bucketKey(dateKey: string, granularity: 'day' | 'month'): string {
  return granularity === 'month' ? dateKey.slice(0, 7) : dateKey;
}

function periodsBetween(from: string, to: string, granularity: 'day' | 'month'): Array<{ key: string; label: string }> {
  if (granularity === 'month') {
    const fromYear = Number(from.slice(0, 4));
    const fromMonth = Number(from.slice(5, 7));
    const toYear = Number(to.slice(0, 4));
    const toMonth = Number(to.slice(5, 7));
    const periods: Array<{ key: string; label: string }> = [];
    let year = fromYear;
    let month = fromMonth;
    while (year < toYear || (year === toYear && month <= toMonth)) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      periods.push({ key, label: `${String(month).padStart(2, '0')}/${year}` });
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return periods;
  }

  const periods: Array<{ key: string; label: string }> = [];
  const cursor = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);
  // Guarda de rango: el contrato no permite más de dos años.
  for (let guard = 0; cursor <= end && guard < 800; guard += 1) {
    const key = cursor.toISOString().slice(0, 10);
    periods.push({ key, label: `${key.slice(8, 10)}/${key.slice(5, 7)}` });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return periods;
}

function buildGroups(sheets: MetricSheet[], query: DispatchMetricsQuery): GroupMetric[] {
  const groups: GroupMetric[] = [];
  for (const sheet of sheets) {
    if (sheet.status === 'CANCELADO') continue;
    const byCustomer = new Map<string, MetricLine[]>();
    for (const line of sheet.lines) {
      const key = customerKey(line);
      const bucket = byCustomer.get(key) ?? [];
      bucket.push(line);
      byCustomer.set(key, bucket);
    }
    const progressByKey = new Map(sheet.customerProgress.map((row) => [row.customerKey, row]));
    for (const [key, lines] of byCustomer) {
      const progress = progressByKey.get(key);
      const pending = lines.filter((line) => line.status === 'PENDIENTE').length;
      const checked = lines
        .map((line) => line.checkedAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime());
      const firstChecked = checked[0] ?? null;
      const lastChecked = checked.length > 0 ? checked[checked.length - 1] : null;
      const loadStart = progress?.loadStartedAt ?? sheet.startedAt ?? firstChecked;
      const loadClose =
        progress?.loadClosedAt ?? (pending === 0 ? lastChecked ?? sheet.completedAt : null);
      const invoiceAt = progress?.invoiceDeliveredAt ?? null;
      const loadKey = loadClose ? businessDateKey(loadClose) : null;
      const invoiceKey = invoiceAt ? businessDateKey(invoiceAt) : null;
      const loadInRange = loadKey !== null && loadKey >= query.from && loadKey <= query.to;
      const invoiceInRange = invoiceKey !== null && invoiceKey >= query.from && invoiceKey <= query.to;
      const pendingInRange = loadInRange && invoiceAt === null;
      const customerCode = progress?.customerCode ?? lines[0]?.customerCode ?? null;
      const customerName = progress?.customerName ?? lines[0]?.customerName ?? 'Sin cliente';

      if (
        query.customerCode &&
        customerCode !== query.customerCode &&
        customerName !== query.customerCode
      ) {
        continue;
      }
      if (query.invoiceStatus === 'pending' && !pendingInRange) continue;
      if (query.invoiceStatus === 'delivered' && !invoiceInRange) continue;
      if (!loadInRange && !invoiceInRange) continue;

      groups.push({
        sheet,
        customerKey: key,
        customerCode,
        customerName,
        lines,
        loadStart,
        loadClose,
        invoiceAt,
        loadMinutes: minutesBetween(loadStart, loadClose),
        invoiceMinutes: minutesBetween(loadStart, invoiceAt),
        kg: round(
          lines.reduce((sum, line) => sum + toNumber(line.plannedKg), 0),
          2,
        ),
        loadInRange,
        invoiceInRange,
        pendingInRange,
      });
    }
  }
  return groups;
}

function onTimeForGroup(group: GroupMetric): { orders: number; late: number } {
  if (!group.invoiceAt) return { orders: 0, late: 0 };
  const invoiceDay = businessDateKey(group.invoiceAt);
  let orders = 0;
  let late = 0;
  for (const line of group.lines) {
    if (!line.effectiveDate) continue;
    orders += 1;
    if (invoiceDay > line.effectiveDate) late += 1;
  }
  return { orders, late };
}

export function buildDispatchMetrics(
  sheets: MetricSheet[],
  query: DispatchMetricsQuery,
  now: Date = new Date(),
): DispatchMetricsResponse {
  const groups = buildGroups(sheets, query);

  const loadGroups = groups.filter((group) => group.loadInRange && group.loadMinutes !== null);
  const invoiceGroups = groups.filter((group) => group.invoiceInRange && group.invoiceMinutes !== null);
  const pendingGroups = groups.filter((group) => group.pendingInRange);

  let onTimeOrders = 0;
  let lateOrders = 0;
  for (const group of invoiceGroups) {
    const result = onTimeForGroup(group);
    onTimeOrders += result.orders;
    lateOrders += result.late;
  }

  const dispatches = new Set(groups.map((group) => group.sheet.id));
  const customers = new Set(groups.map((group) => group.customerKey));
  const summary: DispatchMetricsSummary = {
    dispatches: dispatches.size,
    customers: customers.size,
    orders: groups.reduce((sum, group) => sum + group.lines.length, 0),
    kg: round(
      groups.reduce((sum, group) => sum + group.kg, 0),
      2,
    ),
    load: stats(loadGroups.map((group) => group.loadMinutes!)),
    invoice: {
      ...stats(invoiceGroups.map((group) => group.invoiceMinutes!)),
      pending: pendingGroups.length,
    },
    onTime: {
      orders: onTimeOrders,
      late: lateOrders,
      pct: percent(onTimeOrders - lateOrders, onTimeOrders),
    },
  };

  const periods = periodsBetween(query.from, query.to, query.granularity);
  const loadByPeriod = new Map<string, number[]>();
  const invoiceByPeriod = new Map<string, number[]>();
  const onTimeByPeriod = new Map<string, { orders: number; late: number }>();
  for (const group of loadGroups) {
    const key = bucketKey(businessDateKey(group.loadClose!), query.granularity);
    const bucket = loadByPeriod.get(key) ?? [];
    bucket.push(group.loadMinutes!);
    loadByPeriod.set(key, bucket);
  }
  for (const group of invoiceGroups) {
    const key = bucketKey(businessDateKey(group.invoiceAt!), query.granularity);
    const bucket = invoiceByPeriod.get(key) ?? [];
    bucket.push(group.invoiceMinutes!);
    invoiceByPeriod.set(key, bucket);
    const onTime = onTimeByPeriod.get(key) ?? { orders: 0, late: 0 };
    const result = onTimeForGroup(group);
    onTime.orders += result.orders;
    onTime.late += result.late;
    onTimeByPeriod.set(key, onTime);
  }
  const series: DispatchMetricsSeriesPoint[] = periods.map((period) => {
    const loadValues = loadByPeriod.get(period.key) ?? [];
    const invoiceValues = invoiceByPeriod.get(period.key) ?? [];
    const onTime = onTimeByPeriod.get(period.key) ?? { orders: 0, late: 0 };
    return {
      period: period.key,
      label: period.label,
      loadGroups: loadValues.length,
      loadAvgMinutes: loadValues.length
        ? round(loadValues.reduce((sum, value) => sum + value, 0) / loadValues.length)
        : null,
      invoiceGroups: invoiceValues.length,
      invoiceAvgMinutes: invoiceValues.length
        ? round(invoiceValues.reduce((sum, value) => sum + value, 0) / invoiceValues.length)
        : null,
      onTimePct: percent(onTime.orders - onTime.late, onTime.orders),
    };
  });

  const byCustomer = new Map<string, GroupMetric[]>();
  for (const group of groups) {
    const bucket = byCustomer.get(group.customerKey) ?? [];
    bucket.push(group);
    byCustomer.set(group.customerKey, bucket);
  }
  const customerRows: DispatchMetricsCustomer[] = [...byCustomer.entries()]
    .map(([, customerGroups]) => {
      const first = customerGroups[0]!;
      const loadValues = customerGroups
        .filter((group) => group.loadInRange && group.loadMinutes !== null)
        .map((group) => group.loadMinutes!);
      const invoiceValues = customerGroups
        .filter((group) => group.invoiceInRange && group.invoiceMinutes !== null)
        .map((group) => group.invoiceMinutes!);
      const loadStats = stats(loadValues);
      const invoiceStats = stats(invoiceValues);
      let orders = 0;
      let late = 0;
      let lastInvoice: Date | null = null;
      for (const group of customerGroups) {
        if (!group.invoiceInRange) continue;
        const onTime = onTimeForGroup(group);
        orders += onTime.orders;
        late += onTime.late;
        if (group.invoiceAt && (!lastInvoice || group.invoiceAt > lastInvoice)) lastInvoice = group.invoiceAt;
      }
      return {
        customerCode: first.customerCode,
        customerName: first.customerName,
        dispatches: new Set(customerGroups.map((group) => group.sheet.id)).size,
        orders: customerGroups.reduce((sum, group) => sum + group.lines.length, 0),
        kg: round(
          customerGroups.reduce((sum, group) => sum + group.kg, 0),
          2,
        ),
        loadAvgMinutes: loadStats.avgMinutes,
        loadMedianMinutes: loadStats.medianMinutes,
        loadP90Minutes: loadStats.p90Minutes,
        invoiceAvgMinutes: invoiceStats.avgMinutes,
        invoiceMedianMinutes: invoiceStats.medianMinutes,
        invoiceP90Minutes: invoiceStats.p90Minutes,
        pendingInvoices: customerGroups.filter((group) => group.pendingInRange).length,
        onTimePct: percent(orders - late, orders),
        lastInvoiceAt: lastInvoice ? lastInvoice.toISOString() : null,
      };
    })
    .sort((a, b) => a.customerName.localeCompare(b.customerName, 'es'));

  const orderRows: DispatchMetricsOrder[] = [];
  for (const group of groups) {
    for (const line of group.lines) {
      const closedAt = line.checkedAt;
      orderRows.push({
        orderNumber: line.orderNumber,
        dispatchId: group.sheet.id,
        dispatchNumber: group.sheet.number,
        customerCode: group.customerCode,
        customerName: group.customerName,
        productCode: line.productCode,
        description: line.description,
        effectiveDate: line.effectiveDate,
        loadStartedAt: group.loadStart ? group.loadStart.toISOString() : null,
        loadClosedAt: closedAt ? closedAt.toISOString() : null,
        loadMinutes: minutesBetween(group.loadStart, closedAt),
        invoiceDeliveredAt: group.invoiceAt ? group.invoiceAt.toISOString() : null,
        invoiceMinutes: group.invoiceMinutes,
        onTime:
          group.invoiceAt && line.effectiveDate
            ? businessDateKey(group.invoiceAt) <= line.effectiveDate
            : null,
        status: line.status as DispatchMetricsOrder['status'],
        kg: round(toNumber(line.plannedKg), 2),
      });
    }
  }
  orderRows.sort((a, b) => (b.loadClosedAt ?? b.invoiceDeliveredAt ?? '').localeCompare(a.loadClosedAt ?? a.invoiceDeliveredAt ?? ''));

  return {
    range: { from: query.from, to: query.to, granularity: query.granularity },
    summary,
    series,
    customers: customerRows,
    orders: orderRows.slice(0, 3000),
    generatedAt: now.toISOString(),
  };
}
