import React, { useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import { apiFetch, formatCurrency, formatNumber } from '../lib/api';
import type { MaterialRecord, WhatIfReuseResult } from '../engine/types';

interface FinancialSummaryResponse {
  summary: {
    totalInventoryValue: number;
    blockedWorkingCapital: number;
    potentialDeadStockValue: number;
    excessOverstockValue: number;
    annualHoldingRatePct: number;
    estimatedAnnualHoldingCost: number;
    blockedAnnualHoldingCost: number;
    estimatedPipelineRecoveryValue: number;
    realizedRecoveryValue: number;
  };
  breakdown: Array<{
    materialId: number;
    sku: string;
    name: string;
    warehouseCode: string;
    riskCategory: string;
    bookValue: number;
    annualHoldingCost: number;
    monthsOfSupply: number;
  }>;
}

export function FinancialPage() {
  const [holdingRate, setHoldingRate] = useState(0.18);
  const [data, setData] = useState<FinancialSummaryResponse | null>(null);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);

  // What-If Simulator State
  const [sourceId, setSourceId] = useState<number>(10);
  const [requiredQty, setRequiredQty] = useState<string>('500');
  const [newPrice, setNewPrice] = useState<string>('6.20');
  const [reprocessCost, setReprocessCost] = useState<string>('0.35');
  const [handlingCost, setHandlingCost] = useState<string>('60');
  const [simResult, setSimResult] = useState<WhatIfReuseResult | null>(null);

  useEffect(() => {
    apiFetch<FinancialSummaryResponse>(`/api/financial/summary?holdingRate=${holdingRate}`).then(
      (res) => setData(res)
    );
  }, [holdingRate]);

  useEffect(() => {
    apiFetch<{ materials: MaterialRecord[] }>('/api/materials').then((res) => {
      setMaterials(res.materials);
      const excessMat = res.materials.find((m) => m.sku === 'FAB-SJ-185-SLT') ?? res.materials[0];
      if (excessMat) {
        setSourceId(excessMat.id);
        setNewPrice((excessMat.purchasePrice * 1.08).toFixed(2));
      }
    });
  }, []);

  const runSimulation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const res = await apiFetch<{ simulation: WhatIfReuseResult }>('/api/financial/simulate-reuse', {
      method: 'POST',
      body: JSON.stringify({
        sourceMaterialId: sourceId,
        requiredQty: Number(requiredQty),
        newPurchaseUnitPrice: Number(newPrice),
        reprocessingCostPerUnit: Number(reprocessCost),
        handlingAndTransferCost: Number(handlingCost),
      }),
    });
    setSimResult(res.simulation);
  };

  useEffect(() => {
    if (materials.length > 0 && sourceId) {
      runSimulation();
    }
  }, [materials.length, sourceId]);

  const s = data?.summary;

  return (
    <div className="space-y-6">
      {/* Financial KPIs */}
      {s && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Blocked Working Capital</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-rose-600 dark:text-rose-400 mt-1">
              {formatCurrency(s.blockedWorkingCapital)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Slow, excess &amp; dead stock tied up
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">
              Annual Holding Cost ({s.annualHoldingRatePct}%)
            </div>
            <div className="font-mono tabular-nums text-2xl font-semibold mt-1">
              {formatCurrency(s.estimatedAnnualHoldingCost)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {formatCurrency(s.blockedAnnualHoldingCost)}/yr on idle stock
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Est. Recovery Pipeline</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-blue-600 dark:text-blue-400 mt-1">
              {formatCurrency(s.estimatedPipelineRecoveryValue)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Illustrative estimate pending execution
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Realized Recovery Value</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
              {formatCurrency(s.realizedRecoveryValue)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Confirmed executed savings &amp; proceeds
            </div>
          </div>
        </div>
      )}

      {/* What-If Simulator */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-base font-semibold">
              What-If Production Reuse Simulator
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Model financial impact: &ldquo;What happens if we reuse excess fabric instead of
              purchasing new material?&rdquo;
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="font-medium">Holding Cost Assumption:</span>
            <select
              value={holdingRate}
              onChange={(e) => setHoldingRate(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
            >
              <option value={0.14}>14% / yr</option>
              <option value={0.18}>18% / yr</option>
              <option value={0.22}>22% / yr</option>
              <option value={0.25}>25% / yr</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={runSimulation} className="lg:col-span-5 space-y-3 text-sm">
            <div>
              <label className="block text-xs font-medium mb-1">Excess Source Material</label>
              <select
                value={sourceId}
                onChange={(e) => setSourceId(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.sku} — Free: {formatNumber(Math.max(0, m.availableQty - m.reservedQty))} {m.uom}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Required Order Qty</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={requiredQty}
                  onChange={(e) => setRequiredQty(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">New Purchase Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Re-dye / QC Cost ($/unit)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={reprocessCost}
                  onChange={(e) => setReprocessCost(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Handling &amp; Transfer ($)</label>
                <input
                  type="number"
                  step="1"
                  required
                  value={handlingCost}
                  onChange={(e) => setHandlingCost(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-medium"
            >
              <Calculator className="w-4 h-4" />
              <span>Run Financial Simulation</span>
            </button>
          </form>

          <div className="lg:col-span-7">
            {simResult && (
              <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                    Estimated Simulation Output (Not Realized Cash)
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    Reusable: {formatNumber(simResult.reusableQty)} units · Shortfall Buy:{' '}
                    {formatNumber(simResult.remainingNewPurchaseQty)} units
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs text-slate-500">Avoided Procurement</div>
                    <div className="font-mono tabular-nums text-lg font-semibold mt-0.5">
                      {formatCurrency(simResult.avoidedProcurementCost)}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs text-slate-500">Processing &amp; Handling</div>
                    <div className="font-mono tabular-nums text-lg font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                      −{formatCurrency(simResult.additionalProcessingAndHandlingCost)}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs text-slate-500">Net Estimated Benefit</div>
                    <div className="font-mono tabular-nums text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {formatCurrency(simResult.netEstimatedFinancialBenefit)}
                    </div>
                  </div>
                </div>

                <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  {simResult.assumptions.map((a) => (
                    <li key={a}>· {a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Capital Tie-up Breakdown */}
      {data && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-display text-base font-semibold">
              Capital &amp; Holding Cost Exposure by SKU
            </h2>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                <tr>
                  <th className="py-3 px-4">SKU · Material</th>
                  <th className="py-3 px-4">Warehouse</th>
                  <th className="py-3 px-4">Risk Class</th>
                  <th className="py-3 px-4 text-right">Supply Cover</th>
                  <th className="py-3 px-4 text-right">Book Value</th>
                  <th className="py-3 px-4 text-right">Annual Holding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.breakdown.slice(0, 15).map((row) => (
                  <tr key={row.materialId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4">
                      <div className="font-medium">{row.name}</div>
                      <div className="font-mono text-xs text-slate-500">{row.sku}</div>
                    </td>
                    <td className="py-2.5 px-4 text-xs font-mono">{row.warehouseCode}</td>
                    <td className="py-2.5 px-4 text-xs">{row.riskCategory}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs">
                      {row.monthsOfSupply} mo
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium">
                      {formatCurrency(row.bookValue)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                      {formatCurrency(row.annualHoldingCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
