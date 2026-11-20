import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, GitCompare } from 'lucide-react';
import { apiFetch, formatCurrency, formatNumber } from '../lib/api';
import type { CompatibilityCandidate } from '../engine/types';
import { useAuth } from '../context/AuthContext';

interface ProductionOrder {
  id: number;
  order_code: string;
  style_name: string;
  buyer_name: string;
  status: string;
  due_date: string;
  bomItems: Array<{
    id: number;
    material_id: number;
    sku: string;
    material_name: string;
    category_name: string;
    composition: string;
    color: string;
    color_family: string;
    gsm: number;
    width_inches: number;
    construction: string;
    required_qty: number;
    allocated_qty: number;
    uom: string;
  }>;
}

interface ApprovalRow {
  id: number;
  source_sku: string;
  source_name: string;
  candidate_sku: string;
  candidate_name: string;
  similarity_score: number;
  qc_status: string;
  reviewer_name: string | null;
  notes: string;
  created_at: string;
}

export function MatchingPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [candidates, setCandidates] = useState<CompatibilityCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [query, setQuery] = useState({
    targetMaterialId: undefined as number | undefined,
    categoryName: 'Knitted Fabrics',
    composition: '100% Combed Cotton',
    color: 'Navy Blue',
    colorFamily: 'Blue',
    gsm: 180,
    widthInches: 72,
    construction: 'Single Jersey',
    minQualityGrade: 'B' as 'A' | 'B' | 'C',
    strictComposition: false,
  });

  const canSubmitQc = ['Admin', 'Production Planner', 'Inventory Manager'].includes(user?.role || '');

  const loadMeta = async () => {
    const [pRes, aRes] = await Promise.all([
      apiFetch<{ productionOrders: ProductionOrder[] }>('/api/production-orders'),
      apiFetch<{ approvals: ApprovalRow[] }>('/api/material-matching/approvals'),
    ]);
    setOrders(pRes.productionOrders);
    setApprovals(aRes.approvals);
  };

  const runSearch = async (spec = query) => {
    setSearching(true);
    try {
      const res = await apiFetch<{ candidates: CompatibilityCandidate[] }>(
        '/api/material-matching/search',
        { method: 'POST', body: JSON.stringify(spec) }
      );
      setCandidates(res.candidates);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    loadMeta();
    runSearch(query);
  }, []);

  const loadBomSpec = (bom: ProductionOrder['bomItems'][0]) => {
    const next = {
      targetMaterialId: bom.material_id,
      categoryName: bom.category_name,
      composition: bom.composition,
      color: bom.color,
      colorFamily: bom.color_family,
      gsm: bom.gsm,
      widthInches: bom.width_inches,
      construction: bom.construction,
      minQualityGrade: 'B' as const,
      strictComposition: false,
    };
    setQuery(next);
    runSearch(next);
  };

  const submitQcRequest = async (cand: CompatibilityCandidate) => {
    if (!query.targetMaterialId) {
      setFeedback('Load a specific Production Order BOM item first to link a QC substitution request.');
      return;
    }
    await apiFetch('/api/material-matching/approvals', {
      method: 'POST',
      body: JSON.stringify({
        sourceMaterialId: query.targetMaterialId,
        candidateMaterialId: cand.materialId,
        similarityScore: cand.similarityScore,
        qcStatus: 'Pending QC',
        notes: `${cand.similarityScore}% match — ${cand.potentialUseCase}`,
      }),
    });
    setFeedback(`Submitted ${cand.sku} for Technical / QC compatibility sign-off.`);
    await loadMeta();
  };

  return (
    <div className="space-y-6">
      {/* QC Disclaimer */}
      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div>
          <span className="font-semibold">Technical Governance Notice:</span> A high weighted
          similarity score does not guarantee production compatibility. Hard constraints eliminate
          category and extreme GSM/width mismatches, but Production &amp; QC must validate shrinkage,
          colorfastness, and marker efficiency before issuing substitute lots.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: BOM Quick Load & Custom Query Builder */}
        <div className="lg:col-span-4 space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="font-display text-base font-semibold">Load From Active Production BOM</h2>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {orders.map((ord) =>
                ord.bomItems.slice(0, 2).map((bom) => (
                  <button
                    key={bom.id}
                    type="button"
                    onClick={() => loadBomSpec(bom)}
                    className="w-full text-left p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="flex justify-between text-xs font-semibold">
                      <span>{ord.order_code}</span>
                      <span className="font-mono text-blue-600 dark:text-blue-400">
                        Need {formatNumber(Math.max(0, bom.required_qty - bom.allocated_qty))} {bom.uom}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 truncate mt-0.5">
                      {bom.material_name}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(query);
            }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-sm"
          >
            <h2 className="font-display text-base font-semibold">Target Material Specifications</h2>
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select
                value={query.categoryName}
                onChange={(e) => setQuery({ ...query, categoryName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="Knitted Fabrics">Knitted Fabrics</option>
                <option value="Woven Fabrics">Woven Fabrics</option>
                <option value="Spinning Yarns">Spinning Yarns</option>
                <option value="Trims & Accessories">Trims &amp; Accessories</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Composition</label>
              <input
                value={query.composition}
                onChange={(e) => setQuery({ ...query, composition: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Construction</label>
              <input
                value={query.construction}
                onChange={(e) => setQuery({ ...query, construction: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium mb-1">Color</label>
                <input
                  value={query.color}
                  onChange={(e) => setQuery({ ...query, color: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Color Family</label>
                <input
                  value={query.colorFamily}
                  onChange={(e) => setQuery({ ...query, colorFamily: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium mb-1">Target GSM</label>
                <input
                  type="number"
                  value={query.gsm}
                  onChange={(e) => setQuery({ ...query, gsm: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Width (in)</label>
                <input
                  type="number"
                  value={query.widthInches}
                  onChange={(e) => setQuery({ ...query, widthInches: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs pt-1">
              <input
                type="checkbox"
                checked={query.strictComposition}
                onChange={(e) => setQuery({ ...query, strictComposition: e.target.checked })}
              />
              <span>Enforce strict fiber composition match</span>
            </label>
            <button
              type="submit"
              disabled={searching}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-medium"
            >
              <GitCompare className="w-4 h-4" />
              <span>{searching ? 'Matching Inventory...' : 'Find Compatible Materials'}</span>
            </button>
          </form>
        </div>

        {/* Right: Ranked Candidates + QC Queue */}
        <div className="lg:col-span-8 space-y-6">
          {feedback && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
              {feedback}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold">
                  Ranked Compatible Inventory Candidates ({candidates.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Ordered by weighted textile feature similarity &amp; KNN Euclidean proximity
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {candidates.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No available materials passed hard compatibility constraints for these specs.
                </div>
              ) : (
                candidates.map((c) => (
                  <div key={c.materialId} className="p-5 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {c.materialName}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          {c.sku} · {c.warehouseCode} · Free: {formatNumber(c.availableQty)} {c.uom} ·{' '}
                          {formatCurrency(c.unitPrice)}/{c.uom}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono tabular-nums text-lg font-bold text-blue-600 dark:text-blue-400">
                          {c.similarityScore}% match
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          KNN dist {c.knnDistance}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                        <div className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                          Matching Attributes
                        </div>
                        <ul className="space-y-0.5 text-slate-600 dark:text-slate-300">
                          {c.matchingAttributes.map((a) => (
                            <li key={a}>· {a}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                        <div className="font-semibold text-amber-700 dark:text-amber-400 mb-1">
                          Attribute Differences
                        </div>
                        <ul className="space-y-0.5 text-slate-600 dark:text-slate-300">
                          {c.attributeDifferences.length > 0 ? (
                            c.attributeDifferences.map((d) => <li key={d}>· {d}</li>)
                          ) : (
                            <li>· Exact spec match</li>
                          )}
                        </ul>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
                      <span className="text-slate-600 dark:text-slate-300">{c.potentialUseCase}</span>
                      {canSubmitQc && (
                        <button
                          type="button"
                          onClick={() => submitQcRequest(c)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium whitespace-nowrap"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Request QC Sign-Off</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {approvals.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="font-display text-sm font-semibold">QC Compatibility Approval Log</h3>
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {approvals.map((a) => (
                  <div key={a.id} className="py-2.5 flex items-center justify-between gap-4">
                    <div>
                      <span className="font-mono font-medium">{a.source_sku}</span> →{' '}
                      <span className="font-mono font-medium">{a.candidate_sku}</span> ({a.similarity_score}%)
                      <div className="text-slate-500">{a.notes}</div>
                    </div>
                    <span className="font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                      {a.qc_status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
