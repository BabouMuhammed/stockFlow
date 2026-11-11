import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '@stockflow/shared';
import { SummaryCard } from '../components/retail';
import { Notice } from '../components/ui';
import { API_BASE_URL } from '../api';
import { DataTable, ErrorMessage, Feedback, Field, useData } from './workflows';
import { useSession } from './session';
type Summary = {
  from: string;
  to: string;
  revenueMinor: string;
  refundMinor: string;
  netRevenueMinor: string;
  cogsMinor: string;
  grossProfitMinor: string;
  expensesMinor: string;
  estimatedOperatingResultMinor: string;
  transactions: string;
  products: string;
  lowStock: string;
  valueMinor: string;
  trends: { day: string; revenueMinor: string; costMinor: string }[];
  productsSold?: never;
  categories: { name: string; revenueMinor: string }[];
  cashiers: { cashierName: string | null; transactions: string; revenueMinor: string }[];
  expenseCategories: { category: string; _sum: { amountMinor: string } }[];
  recentSales: {
    id: string;
    receiptNumber: string;
    cashierName: string;
    totalMinor: string;
    createdAt: string;
  }[];
  bestProducts?: {
    productName: string;
    quantity: string;
    revenueMinor: string;
    costMinor: string;
  }[];
};
const day = (date: Date) => date.toISOString().slice(0, 10);
function presetDates(value: string): [string, string] {
  const now = new Date(),
    end = day(now);
  if (value === 'yesterday') {
    now.setUTCDate(now.getUTCDate() - 1);
    return [day(now), day(now)];
  }
  if (value === 'week') now.setUTCDate(now.getUTCDate() - 6);
  else if (value === '30') now.setUTCDate(now.getUTCDate() - 29);
  else if (value === 'month') now.setUTCDate(1);
  return [day(now), end];
}
function groupTrend(rows: Summary['trends'], interval: string) {
  const groups = new Map<string, { revenue: bigint; cost: bigint }>();
  for (const row of rows) {
    let key = row.day;
    if (interval === 'month') key = key.slice(0, 7);
    else if (interval === 'week') {
      const date = new Date(key + 'T00:00:00Z');
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = day(date);
    }
    const current = groups.get(key) ?? { revenue: 0n, cost: 0n };
    groups.set(key, {
      revenue: current.revenue + BigInt(row.revenueMinor),
      cost: current.cost + BigInt(row.costMinor ?? '0'),
    });
  }
  return [...groups.entries()].map(([label, value]) => ({
    label,
    revenueMinor: value.revenue.toString(),
    costMinor: value.cost.toString(),
  }));
}
function Bars({ rows, label }: { rows: { label: string; value: string }[]; label: string }) {
  const max = rows.reduce((m, r) => (BigInt(r.value) > m ? BigInt(r.value) : m), 1n);
  return (
    <div className="data-bars" aria-label={label}>
      {!rows.length ? (
        <p>No data in this period.</p>
      ) : (
        rows.map((r, i) => (
          <div className="data-bar" key={i}>
            <span>{r.label}</span>
            <div>
              <i style={{ width: String((BigInt(r.value) * 100n) / max) + '%' }} />
            </div>
            <strong>{formatMoney(r.value)}</strong>
          </div>
        ))
      )}
    </div>
  );
}
export default function Reports({ dashboard = false }: { dashboard?: boolean }) {
  const { session } = useSession();
  const [dates, setDates] = useState<[string, string]>(() => presetDates('today')),
    [preset, setPreset] = useState('today'),
    [exportKind, setExportKind] = useState('sales'),
    [exportError, setExportError] = useState<Error | null>(null),
    [exporting, setExporting] = useState(false);
  const params = new URLSearchParams({ from: dates[0], to: dates[1] });
  const query = useData<Summary>(
    'summary',
    '/reports/summary?' + params,
    session?.user.role !== 'CASHIER',
  );
  const [interval, setInterval] = useState('day');
  const own = useData<{
    data: { receiptNumber: string; totalMinor: string; createdAt: string }[];
    total: number;
  }>('own-sales', '/sales?limit=10&' + params, session?.user.role === 'CASHIER');
  const lowStock = useData<{
    data: { id: string; name: string; quantity: string; lowStockThreshold: string }[];
  }>(
    'dashboard-low-stock',
    '/inventory?low=true&limit=10',
    dashboard && session?.user.role !== 'CASHIER',
  );
  if (session?.user.role === 'CASHIER')
    return (
      <>
        <h2>Your cashier workspace</h2>
        <Link className="button primary" to="/pos">
          Open point of sale
        </Link>
        <Feedback query={own} />
        {own.data && (
          <DataTable
            columns={['Your receipts', 'Date', 'Total']}
            rows={own.data.data.map((s) => [
              s.receiptNumber,
              s.createdAt.slice(0, 10),
              formatMoney(s.totalMinor),
            ])}
          />
        )}
      </>
    );
  const data = query.data;
  const trends = groupTrend(data?.trends ?? [], interval);
  const download = async () => {
    setExportError(null);
    setExporting(true);
    try {
      const response = await fetch(
        API_BASE_URL + '/reports/export?' + params + '&kind=' + exportKind,
        {
          credentials: 'include',
        },
      );
      if (!response.ok) throw new Error('Export failed. Refresh your session and retry.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'stockflow-' + exportKind + '.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error instanceof Error ? error : new Error('Export failed'));
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <div className="catalogue-toolbar">
        <div>
          <h2>{dashboard ? 'Your store at a glance' : 'Business reports'}</h2>
          <p>
            GMD · Africa/Banjul · {dates[0]} to {dates[1]}
          </p>
        </div>
        <Link className="button primary" to="/pos">
          Open point of sale
        </Link>
      </div>
      <div className="report-filters">
        <Field label="Date range">
          <select
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              if (e.target.value !== 'custom') setDates(presetDates(e.target.value));
            }}
          >
            <option value="today">Today / daily report</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">Last 7 days / weekly report</option>
            <option value="30">Last 30 days</option>
            <option value="month">This month / monthly report</option>
            <option value="custom">Custom range</option>
          </select>
        </Field>
        <Field
          label="From"
          type="date"
          value={dates[0]}
          onChange={(v) => {
            setPreset('custom');
            setDates([v, dates[1]]);
          }}
        />
        <Field
          label="To"
          type="date"
          value={dates[1]}
          onChange={(v) => {
            setPreset('custom');
            setDates([dates[0], v]);
          }}
        />
      </div>
      <Feedback query={query} />
      {data && (
        <>
          <div className="stats-grid">
            {[
              ['Sales revenue', formatMoney(data.revenueMinor), 'Completed sales before returns'],
              ['Transactions', data.transactions, 'Completed sales in period'],
              ['Active products', data.products, 'Current catalogue'],
              ['Low-stock products', data.lowStock, 'Current main-store stock'],
              [
                'Inventory value',
                formatMoney(data.valueMinor),
                'Current stock at latest product cost',
              ],
              [
                'Operating expenses',
                formatMoney(data.expensesMinor),
                'Recorded in period; stock purchases excluded',
              ],
              [
                'Gross profit',
                formatMoney(data.grossProfitMinor),
                'Net revenue less recorded cost of goods sold',
              ],
              [
                'Estimated operating result',
                formatMoney(data.estimatedOperatingResultMinor),
                'Gross profit less recorded operating expenses',
              ],
            ].map(([label, value, note]) => (
              <SummaryCard key={label} label={label} value={value} note={note}>
                <span aria-hidden="true">D</span>
              </SummaryCard>
            ))}
          </div>
          <Notice>
            Refunds recorded in this period: {formatMoney(data.refundMinor)}. Net revenue:{' '}
            {formatMoney(data.netRevenueMinor)}. COGS: {formatMoney(data.cogsMinor)}. The operating
            result includes only costs recorded in StockFlow.
          </Notice>
          <div className="dashboard-grid">
            <section className="panel overview-panel">
              <h2>Sales trends</h2>
              <Field label="Chart interval">
                <select value={interval} onChange={(e) => setInterval(e.target.value)}>
                  <option value="day">Daily</option>
                  <option value="week">Weekly</option>
                  <option value="month">Monthly</option>
                </select>
              </Field>
              <Bars
                label="Sales revenue"
                rows={trends.map((t) => ({ label: t.label, value: t.revenueMinor }))}
              />
              <h3>Cost of goods sold before returns</h3>
              <Bars
                label="Daily cost of goods sold"
                rows={trends.map((t) => ({ label: t.label, value: t.costMinor }))}
              />
            </section>
            <section className="panel overview-panel">
              <h2>Sales by category</h2>
              <Bars
                label="Category revenue before returns"
                rows={data.categories.map((c) => ({ label: c.name, value: c.revenueMinor }))}
              />
              <h2>Expense breakdown</h2>
              <Bars
                label="Operating expense breakdown"
                rows={data.expenseCategories.map((c) => ({
                  label: c.category,
                  value: c._sum.amountMinor,
                }))}
              />
            </section>
          </div>
          {dashboard && lowStock.data && (
            <>
              <h2>Low-stock products</h2>
              <DataTable
                columns={['Product', 'Stock', 'Minimum']}
                rows={lowStock.data.data.map((p) => [p.name, p.quantity, p.lowStockThreshold])}
                empty="No low-stock products"
              />
              <Link className="text-link" to="/inventory">
                Review inventory
              </Link>
            </>
          )}
          <h2>Recent sales</h2>
          <DataTable
            columns={['Receipt', 'Cashier', 'Date', 'Total']}
            rows={data.recentSales.map((s) => [
              s.receiptNumber,
              s.cashierName,
              new Date(s.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Banjul' }),
              formatMoney(s.totalMinor),
            ])}
          />
          <h2>Best-selling products (before returns)</h2>
          <Bars
            label="Top product revenue"
            rows={(data.bestProducts ?? [])
              .slice(0, 10)
              .map((p) => ({ label: p.productName, value: p.revenueMinor }))}
          />
          <DataTable
            columns={['Product', 'Quantity sold', 'Revenue', 'COGS']}
            rows={(data.bestProducts ?? []).map((p) => [
              p.productName,
              p.quantity,
              formatMoney(p.revenueMinor),
              formatMoney(p.costMinor),
            ])}
          />
          {!dashboard && (
            <>
              <h2>Cashier performance (before returns)</h2>
              <DataTable
                columns={['Cashier', 'Transactions', 'Sales revenue']}
                rows={data.cashiers.map((c) => [
                  c.cashierName ?? 'Legacy record',
                  c.transactions,
                  formatMoney(c.revenueMinor),
                ])}
              />
              <div className="report-filters">
                <Field label="CSV report">
                  <select value={exportKind} onChange={(e) => setExportKind(e.target.value)}>
                    {[
                      ['sales', 'Sales and refunds'],
                      ['products', 'Product sales'],
                      ['inventory', 'Inventory valuation'],
                      ['low-stock', 'Low-stock products'],
                      ['expenses', 'Operating expenses'],
                      ['cashiers', 'Cashier performance'],
                      ['gross-profit', 'Gross profit and operating result'],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  className="button secondary"
                  onClick={() => {
                    void download();
                  }}
                  disabled={exporting}
                >
                  Download CSV
                </button>
                <button className="button secondary" onClick={() => window.print()}>
                  Print / Save report as PDF
                </button>
              </div>
              <ErrorMessage error={exportError} />
            </>
          )}
        </>
      )}
    </>
  );
}
