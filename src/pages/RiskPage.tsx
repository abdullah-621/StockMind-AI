import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight } from 'lucide-react';
import { apiFetch, formatCurrency, formatNumber } from '../lib/api';
import type { RiskAssessmentResult, RiskCategory } from '../engine/types';
import type { NavSection } from '../components/Layout';

const CATEGORIES: Array<'ALL' | RiskCategory> = [
  'ALL',
  'Potential Dead Stock',
  'Critical Overstock',
  'Excess Stock',
  'Slow-Moving Stock',
  'At-Risk Inventory',
  'Healthy Stock',
];

export function RiskPage({ onNavigate }: { onNavigate: (s: NavSection) => void }) {
  const [assessments, setAssessments] = useState<RiskAssessmentResult[]>([]);
  const [selectedCat, setSelectedCat] = useState<'ALL' | RiskCategory>('ALL');
  const [selectedItem, setSelectedItem] = useState<RiskAssessmentResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ assessments: RiskAssessmentResult[] }>('/api/inventory-risk')
      .then((res) => {
        const sorted = [...res.assessments].sort((a, b) => b.riskScore - a.riskScore);
        setAssessments(sorted);
        if (sorted.length > 0) setSelectedItem(sorted[0]);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered =
    selectedCat === 'ALL'
      ? assessments
      : assessments.filter((a) => a.riskCategory === selectedCat);

  const countByCat = (cat: RiskCategory) =>
    assessments.filter((a) => a.riskCategory === cat).length;

  return (
    <div className="space-y-6">
      {/* Methodology Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Multi-Factor Dead Stock & Anomaly Detection
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Materials are never classified as dead stock solely from inactivity days. Each SKU is
            scored using rule-based manufacturing guardrails (upcoming BOM commitments, reserved
            allocations, seasonal peak windows, shelf life) plus a consumption drop Z-score
            anomaly check.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('recovery')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-medium whitespace-nowrap shrink-0"
        >
          <span>Open Recovery Engine</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Interactive Category Segmented Filter */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
        {CATEGORIES.map((cat) => {
          const count = cat === 'ALL' ? assessments.length : countByCat(cat);
          const active = selectedCat === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCat(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {cat === 'ALL' ? 'All Materials' : cat} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Risk Table */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500">
                <tr>
                  <th className="py-3 px-4">Material</th>
                  <th className="py-3 px-4">Classification</th>
                  <th className="py-3 px-4 text-right">Score</th>
                  <th className="py-3 px-4 text-right">BOM Offset</th>
                  <th className="py-3 px-4 text-right">Value At Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-500">
                      Running risk models...
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => {
                    const isSelected = selectedItem?.materialId === item.materialId;
                    const catColor =
                      item.riskCategory === 'Potential Dead Stock' ||
                      item.riskCategory === 'Critical Overstock'
                        ? 'text-rose-600 dark:text-rose-400'
                        : item.riskCategory === 'Slow-Moving Stock' ||
                          item.riskCategory === 'Excess Stock'
                        ? 'text-amber-600 dark:text-amber-400'
                        : item.riskCategory === 'At-Risk Inventory'
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-emerald-600 dark:text-emerald-400';

                    return (
                      <tr
                        key={item.materialId}
                        onClick={() => setSelectedItem(item)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-slate-100 dark:bg-slate-800/80'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-3 px-4 max-w-[220px]">
                          <div className="font-medium truncate">{item.materialName}</div>
                          <div className="text-xs font-mono text-slate-500">
                            {item.sku} · {item.daysSinceLastMovement}d idle
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className={`text-xs font-semibold ${catColor}`}>
                            {item.riskCategory}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {item.monthsOfSupply} mo supply
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                          {item.riskScore}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">
                          {formatNumber(item.upcomingBomQty)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-medium">
                          {formatCurrency(item.inventoryValue)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Explainable Factor Attribution Panel */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
          {selectedItem ? (
            <>
              <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="font-mono text-xs text-slate-500">
                  {selectedItem.sku} · {selectedItem.baselineMethod}
                </div>
                <h3 className="font-display text-base font-semibold mt-0.5">
                  {selectedItem.materialName}
                </h3>
                <div className="flex flex-wrap items-center gap-4 mt-2 text-xs font-mono tabular-nums">
                  <span>Score: {selectedItem.riskScore}/100</span>
                  <span>Turnover: {selectedItem.turnoverRatio}x/yr</span>
                  <span>Z-Score: {selectedItem.anomalyZScore}</span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Explainable Factor Attribution (Risk Points)
                </h4>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={selectedItem.contributions}
                      layout="vertical"
                      margin={{ left: 10, right: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="#64748b" />
                      <YAxis
                        type="category"
                        dataKey="factor"
                        width={145}
                        tick={{ fontSize: 10 }}
                        stroke="#64748b"
                      />
                      <ReferenceLine x={0} stroke="#64748b" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          color: '#f8fafc',
                          fontSize: '12px',
                          borderRadius: '8px',
                        }}
                      />
                      <Bar dataKey="impactPoints" name="Score Impact" isAnimationActive={false}>
                        {selectedItem.contributions.map((entry, idx) => (
                          <Cell
                            key={idx}
                            fill={entry.direction === 'increases_risk' ? '#DC2626' : '#16A34A'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                    Factor Explanation
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    {selectedItem.explanation}
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                    Recommended Next Action
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    {selectedItem.recommendedAction}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">Select a material to inspect risk factors.</div>
          )}
        </div>
      </div>
    </div>
  );
}
