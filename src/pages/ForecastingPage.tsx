import React, { useEffect, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckCircle2, ShoppingCart } from 'lucide-react';
import { apiFetch, formatCurrency, formatNumber } from '../lib/api';
import type {
  ForecastModelName,
  ForecastOutput,
  MaterialRecord,
  ReorderRecommendationResult,
} from '../engine/types';
import { useAuth } from '../context/AuthContext';

export function ForecastingPage() {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [selectedMatId, setSelectedMatId] = useState<number>(1);
  const [horizon, setHorizon] = useState<number>(3);
  const [preferredModel, setPreferredModel] = useState<'' | ForecastModelName>('');
  const [forecast, setForecast] = useState<ForecastOutput | null>(null);

  // Stockout & Reorder Simulation Controls
  const [demandMult, setDemandMult] = useState<number>(1.0);
  const [leadDelta, setLeadDelta] = useState<number>(0);
  const [reorders, setReorders] = useState<ReorderRecommendationResult[]>([]);
  const [poFeedback, setPoFeedback] = useState<string | null>(null);
  const [poError, setPoError] = useState<string | null>(null);

  const canCreatePo = ['Admin', 'Procurement Officer', 'Inventory Manager'].includes(
    user?.role || ''
  );

  useEffect(() => {
    apiFetch<{ materials: MaterialRecord[] }>('/api/materials').then((res) => {
      setMaterials(res.materials);
      if (res.materials.length > 0) setSelectedMatId(res.materials[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedMatId) return;
    const params = new URLSearchParams({ horizon: String(horizon) });
    if (preferredModel) params.set('model', preferredModel);
    apiFetch<{ forecast: ForecastOutput }>(
      `/api/forecasting/${selectedMatId}?${params.toString()}`
    ).then((res) => setForecast(res.forecast));
  }, [selectedMatId, horizon, preferredModel]);

  useEffect(() => {
    const params = new URLSearchParams({
      demandMultiplier: String(demandMult),
      leadTimeDeltaDays: String(leadDelta),
    });
    apiFetch<{ reorders: ReorderRecommendationResult[] }>(
      `/api/inventory-risk/reorders?${params.toString()}`
    ).then((res) => {
      const sorted = [...res.reorders].sort((a, b) => a.coverageDays - b.coverageDays);
      setReorders(sorted);
    });
  }, [demandMult, leadDelta]);

  const handleCreateDraftPo = async (rec: ReorderRecommendationResult) => {
    setPoFeedback(null);
    setPoError(null);
    try {
      const res = await apiFetch<{ poNumber: string; status: string }>('/api/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          materialId: rec.materialId,
          quantity: rec.recommendedReorderQty,
          notes: `Draft PO from Reorder Engine (Demand ${Math.round(demandMult * 100)}%, Lead delta ${leadDelta >= 0 ? '+' : ''}${leadDelta}d)`,
        }),
      });
      setPoFeedback(
        `Created ${res.poNumber} (${res.status}) for ${formatNumber(rec.recommendedReorderQty)} units of ${rec.sku}.`
      );
    } catch (err) {
      setPoError(err instanceof Error ? err.message : 'Unable to create draft PO.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Demand Forecasting Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-base font-semibold">
              Material-Level Demand Forecasting (Chronological Validation)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {forecast?.splitSummary ?? 'Strict temporal train-validation split with zero future data leakage.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Select material for forecasting"
              value={selectedMatId}
              onChange={(e) => setSelectedMatId(Number(e.target.value))}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 max-w-xs"
            >
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.sku} — {m.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Forecast horizon"
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value={3}>3-Month Horizon</option>
              <option value={6}>6-Month Horizon</option>
              <option value={9}>9-Month Horizon</option>
            </select>
            <select
              aria-label="Forecasting model"
              value={preferredModel}
              onChange={(e) => setPreferredModel(e.target.value as '' | ForecastModelName)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="">Auto-Select Best WAPE</option>
              <option value="Holt Exponential Smoothing">Holt Exponential Smoothing</option>
              <option value="Moving Average">Moving Average (3-mo)</option>
              <option value="Seasonal Naive">Seasonal Naive</option>
            </select>
          </div>
        </div>

        {forecast && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 space-y-4">
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={forecast.series}>
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
                    <Area
                      type="monotone"
                      dataKey="upperBound"
                      name="Upper 95% Band"
                      stroke="none"
                      fill="#2563EB"
                      fillOpacity={0.14}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="actualQty"
                      name="Historical Consumption"
                      stroke="#0F172A"
                      strokeWidth={2}
                      dot={{ r: 2.5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="forecastQty"
                      name={`Predicted (${forecast.selectedModel})`}
                      stroke="#2563EB"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 3 }}
                      connectNulls={true}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Held-Out Chronological Evaluation Table */}
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2.5 px-3">Model Evaluated (Held-Out Tail)</th>
                      <th className="py-2.5 px-3 text-right">MAE</th>
                      <th className="py-2.5 px-3 text-right">RMSE</th>
                      <th className="py-2.5 px-3 text-right">WAPE %</th>
                      <th className="py-2.5 px-3 text-right">Selection</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {forecast.evaluations.map((ev) => {
                      const active = ev.modelName === forecast.selectedModel;
                      return (
                        <tr key={ev.modelName} className={active ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}>
                          <td className="py-2.5 px-3 font-medium">{ev.modelName}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">{ev.mae}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">{ev.rmse}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">{ev.wape}%</td>
                          <td className="py-2.5 px-3 text-right font-medium text-blue-600 dark:text-blue-400">
                            {active ? 'Active' : 'Benchmarked'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Next Month Forecast</div>
                  <div className="font-mono tabular-nums text-xl font-semibold mt-1">
                    {formatNumber(forecast.nextPeriodForecast, 1)}
                  </div>
                </div>
                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">{horizon}-Mo Total</div>
                  <div className="font-mono tabular-nums text-xl font-semibold mt-1">
                    {formatNumber(forecast.totalHorizonForecast, 1)}
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Influential Demand Drivers
                </h3>
                {forecast.influentialFactors.map((f) => (
                  <div
                    key={f.factor}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">{f.factor}</span>
                      <span className="font-mono text-blue-600 dark:text-blue-400">
                        {f.weightLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{f.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stockout Risk & Intelligent Reorder Simulator */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-base font-semibold">
              Stockout Risk & Explainable Reorder Point Planner
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reorder Point = Average Daily Demand × Lead Time + Safety Stock (95% Z=1.65). Draft
              POs require explicit human authorization.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs">
            <label className="flex items-center gap-2">
              <span className="font-medium whitespace-nowrap">
                Demand Spike: <span className="font-mono">{Math.round(demandMult * 100)}%</span>
              </span>
              <input
                type="range"
                min="0.7"
                max="1.8"
                step="0.1"
                value={demandMult}
                onChange={(e) => setDemandMult(Number(e.target.value))}
                className="w-28"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="font-medium whitespace-nowrap">
                Lead Time Shift: <span className="font-mono">{leadDelta >= 0 ? '+' : ''}{leadDelta}d</span>
              </span>
              <input
                type="range"
                min="-7"
                max="21"
                step="1"
                value={leadDelta}
                onChange={(e) => setLeadDelta(Number(e.target.value))}
                className="w-28"
              />
            </label>
          </div>
        </div>

        {poFeedback && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{poFeedback}</span>
          </div>
        )}
        {poError && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
            {poError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">Material</th>
                <th className="py-3 px-4">Risk Level</th>
                <th className="py-3 px-4 text-right">Net Stock</th>
                <th className="py-3 px-4 text-right">Reorder Pt</th>
                <th className="py-3 px-4 text-right">Coverage</th>
                <th className="py-3 px-4 text-right">Rec. Order</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {reorders.slice(0, 12).map((r) => {
                const riskTone =
                  r.stockoutRiskLevel === 'Critical'
                    ? 'text-rose-600 dark:text-rose-400'
                    : r.stockoutRiskLevel === 'High'
                    ? 'text-amber-600 dark:text-amber-400'
                    : r.stockoutRiskLevel === 'Moderate'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-emerald-600 dark:text-emerald-400';

                return (
                  <tr key={r.materialId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 max-w-xs">
                      <div className="font-medium truncate">{r.materialName}</div>
                      <div className="text-xs font-mono text-slate-500">
                        {r.sku} · Incoming PO: {formatNumber(r.incomingPoQty)} · BOM: {formatNumber(r.bomCommittedQty)}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className={`text-xs font-semibold ${riskTone}`}>{r.stockoutRiskLevel}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {r.estimatedStockoutDate ? `Out ~${r.estimatedStockoutDate}` : 'Covered >180d'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {formatNumber(r.netEffectiveStock)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {formatNumber(r.reorderPoint)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {r.coverageDays}d
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                      {r.recommendedReorderQty > 0 ? formatNumber(r.recommendedReorderQty) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {r.recommendedReorderQty > 0 && canCreatePo ? (
                        <button
                          type="button"
                          onClick={() => handleCreateDraftPo(r)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-medium"
                        >
                          <ShoppingCart className="w-3.5 h-3.5" />
                          <span>Draft PO</span>
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {r.recommendedReorderQty > 0 ? 'Requires Procurement Role' : 'Adequate'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
