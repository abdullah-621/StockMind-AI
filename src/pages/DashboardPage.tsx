import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Download } from 'lucide-react';
import { apiFetch, exportRowsToExcel, formatCurrency, formatNumber } from '../lib/api';
import type { NavSection } from '../components/Layout';
import type { ReorderRecommendationResult, RiskAssessmentResult } from '../engine/types';

interface DashboardData {
  kpis: {
    totalInventoryValue: number;
    totalActiveMaterials: number;
    slowMovingValue: number;
    potentialDeadStockValue: number;
    stockoutRiskCount: number;
    excessInventoryQty: number;
    potentialRecoveryValue: number;
    realizedRecoveryValue: number;
    inventoryTurnover: number;
  };
  charts: {
    byCategory: Array<{ category: string; value: number; skuCount: number }>;
    byWarehouse: Array<{ warehouse: string; code: string; value: number; skuCount: number }>;
    riskDistribution: Array<{ category: string; count: number; value: number }>;
    monthlyTrend: Array<{
      period: string;
      consumedQty: number;
      receivedQty: number;
      inventoryValue: number;
    }>;
    recoveryByStrategy: Array<{ strategy: string; estimatedValue: number; count: number }>;
  };
  priorityActions: {
    topDeadStock: RiskAssessmentResult[];
    topStockouts: ReorderRecommendationResult[];
  };
}

interface WarehouseOption {
  id: number;
  code: string;
  name: string;
}

interface CategoryOption {
  id: number;
  name: string;
}

const RISK_COLORS: Record<string, string> = {
  'Healthy Stock': '#16A34A',
  'Slow-Moving Stock': '#D97706',
  'Excess Stock': '#EA580C',
  'Critical Overstock': '#B91C1C',
  'Potential Dead Stock': '#DC2626',
  'At-Risk Inventory': '#2563EB',
};

export function DashboardPage({ onNavigate }: { onNavigate: (s: NavSection) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ warehouses: WarehouseOption[] }>('/api/warehouses'),
      apiFetch<{ categories: CategoryOption[] }>('/api/categories'),
    ])
      .then(([wRes, cRes]) => {
        setWarehouses(wRes.warehouses);
        setCategories(cRes.categories);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (warehouseId) params.set('warehouseId', warehouseId);
    if (categoryId) params.set('categoryId', categoryId);

    apiFetch<DashboardData>(`/api/analytics/dashboard?${params.toString()}`)
      .then((res) => setData(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard.'))
      .finally(() => setLoading(false));
  }, [warehouseId, categoryId]);

  const handleExportSummary = () => {
    if (!data) return;
    exportRowsToExcel(
      [
        { Metric: 'Total Inventory Value (USD)', Value: data.kpis.totalInventoryValue },
        { Metric: 'Active SKUs', Value: data.kpis.totalActiveMaterials },
        { Metric: 'Slow-Moving Inventory Value (USD)', Value: data.kpis.slowMovingValue },
        { Metric: 'Potential Dead Stock Value (USD)', Value: data.kpis.potentialDeadStockValue },
        { Metric: 'Critical/High Stockout Risk SKUs', Value: data.kpis.stockoutRiskCount },
        { Metric: 'Estimated Pipeline Recovery Value (USD)', Value: data.kpis.potentialRecoveryValue },
        { Metric: 'Realized Recovery Value (USD)', Value: data.kpis.realizedRecoveryValue },
        { Metric: 'Average Inventory Turnover (x/yr)', Value: data.kpis.inventoryTurnover },
      ],
      'stockmind-executive-kpis.xlsx',
      'Executive KPIs'
    );
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
        {error || 'Unable to load executive analytics.'}
      </div>
    );
  }

  const kpis = data.kpis;

  const kpiCards = [
    {
      label: 'Total Inventory Value',
      value: formatCurrency(kpis.totalInventoryValue),
      sub: `${kpis.totalActiveMaterials} active SKUs · Synthetic baseline`,
      tone: 'neutral',
    },
    {
      label: 'Potential Dead Stock Value',
      value: formatCurrency(kpis.potentialDeadStockValue),
      sub: 'Multi-factor flagged · Zero active BOM offset',
      tone: kpis.potentialDeadStockValue > 0 ? 'crimson' : 'green',
    },
    {
      label: 'Slow-Moving Value',
      value: formatCurrency(kpis.slowMovingValue),
      sub: `Excess unreserved qty: ${formatNumber(kpis.excessInventoryQty)} units`,
      tone: kpis.slowMovingValue > 0 ? 'amber' : 'green',
    },
    {
      label: 'Stockout Risk Count',
      value: String(kpis.stockoutRiskCount),
      sub: 'SKUs below Reorder Point / lead-time cover',
      tone: kpis.stockoutRiskCount > 0 ? 'crimson' : 'green',
    },
    {
      label: 'Est. Pipeline Recovery',
      value: formatCurrency(kpis.potentialRecoveryValue),
      sub: 'Pending & approved recommendations (Est.)',
      tone: 'blue',
    },
    {
      label: 'Realized Recovery Value',
      value: formatCurrency(kpis.realizedRecoveryValue),
      sub: 'Verified executed recovery actions',
      tone: 'green',
    },
    {
      label: 'Avg Inventory Turnover',
      value: `${kpis.inventoryTurnover.toFixed(2)}x`,
      sub: 'Annualized consumption / current stock',
      tone: 'neutral',
    },
    {
      label: 'Active Material SKUs',
      value: String(kpis.totalActiveMaterials),
      sub: `${data.charts.byWarehouse.length} warehouses tracked`,
      tone: 'neutral',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Filter & Export Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="dash-wh" className="sr-only">
              Filter by Warehouse
            </label>
            <select
              id="dash-wh"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">All Warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dash-cat" className="sr-only">
              Filter by Category
            </label>
            <select
              id="dash-cat"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">All Material Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {(warehouseId || categoryId) && (
            <button
              type="button"
              onClick={() => {
                setWarehouseId('');
                setCategoryId('');
              }}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline px-2 py-1"
            >
              Reset Filters
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleExportSummary}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>Export KPIs (.xlsx)</span>
        </button>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((c) => (
          <div
            key={c.label}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-2"
          >
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {c.label}
            </div>
            <div
              className={`font-mono tabular-nums text-2xl font-semibold tracking-tight ${
                c.tone === 'crimson'
                  ? 'text-rose-600 dark:text-rose-400'
                  : c.tone === 'amber'
                  ? 'text-amber-600 dark:text-amber-400'
                  : c.tone === 'green'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : c.tone === 'blue'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {c.value}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="font-display text-base font-semibold">
              Monthly Material Consumption vs Replenishment
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              14-month aggregate snapshot trajectory across selected warehouses & categories
            </p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.charts.monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    color: '#f8fafc',
                    fontSize: '12px',
                    borderRadius: '8px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey="consumedQty"
                  name="Consumed Units"
                  stroke="#2563EB"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="receivedQty"
                  name="Received Units"
                  stroke="#16A34A"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="font-display text-base font-semibold">
              Inventory Risk Distribution (by Value)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Multi-factor classification factoring BOM commitments & seasonality
            </p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.charts.riskDistribution}
                  dataKey="value"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={84}
                  paddingAngle={2}
                  isAnimationActive={false}
                >
                  {data.charts.riskDistribution.map((entry) => (
                    <Cell
                      key={entry.category}
                      fill={RISK_COLORS[entry.category] ?? '#64748b'}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val) => formatCurrency(Number(val ?? 0))}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    color: '#f8fafc',
                    fontSize: '12px',
                    borderRadius: '8px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="font-display text-base font-semibold">
              Inventory Value by Category
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Book valuation across knitwear raw-material classes
            </p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.byCategory} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis type="category" dataKey="category" width={128} tick={{ fontSize: 11 }} stroke="#64748b" />
                <Tooltip
                  formatter={(val) => formatCurrency(Number(val ?? 0))}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    color: '#f8fafc',
                    fontSize: '12px',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="value" name="Book Value (USD)" fill="#0F172A" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="font-display text-base font-semibold">
              Warehouse Distribution & Value
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Capital concentration across manufacturing facilities
            </p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.byWarehouse}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis dataKey="code" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                <Tooltip
                  formatter={(val) => formatCurrency(Number(val ?? 0))}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    color: '#f8fafc',
                    fontSize: '12px',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="value" name="Warehouse Value (USD)" fill="#2563EB" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Actionable Decision Queues */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold">
                Priority Dead Stock & Overstock Recovery
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Highest blocked capital requiring substitution or liquidation review
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('recovery')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              <span>Recovery Engine</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.priorityActions.topDeadStock.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                No critical dead stock detected for the current filter.
              </div>
            ) : (
              data.priorityActions.topDeadStock.map((item) => (
                <div key={item.materialId} className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {item.materialName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono">{item.sku}</span> · {item.riskCategory} ·{' '}
                      {item.daysSinceLastMovement}d idle
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono tabular-nums text-sm font-semibold text-rose-600 dark:text-rose-400">
                      {formatCurrency(item.inventoryValue)}
                    </div>
                    <div className="font-mono tabular-nums text-[11px] text-slate-500">
                      Risk {item.riskScore}/100
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold">
                Priority Stockout & Reorder Alerts
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Materials approaching Reorder Point before supplier lead-time buffer
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('forecasting')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              <span>Reorder Planner</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.priorityActions.topStockouts.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                All tracked SKUs maintain adequate reorder coverage.
              </div>
            ) : (
              data.priorityActions.topStockouts.map((item) => (
                <div key={item.materialId} className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {item.materialName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono">{item.sku}</span> · {item.stockoutRiskLevel} Risk · Lead{' '}
                      {item.leadTimeDays}d
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono tabular-nums text-sm font-semibold text-amber-600 dark:text-amber-400">
                      {item.coverageDays}d cover
                    </div>
                    <div className="font-mono tabular-nums text-[11px] text-slate-500">
                      Rec. Order: {formatNumber(item.recommendedReorderQty)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
