import React, { useEffect, useState } from 'react';
import { Check, CheckCircle2, Plus, Recycle, X } from 'lucide-react';
import { apiFetch, formatCurrency, formatNumber } from '../lib/api';
import type { MaterialRecord, RecoveryOptionEvaluation, RecoveryPlanResult } from '../engine/types';
import { useAuth } from '../context/AuthContext';

interface RecommendationRow {
  id: number;
  material_id: number;
  sku: string;
  material_name: string;
  uom: string;
  warehouse_code: string;
  strategy: string;
  recoverable_qty: number;
  gross_estimated_value: number;
  estimated_costs: number;
  net_estimated_value: number;
  value_type: string;
  assumptions: string[];
  target_reference: string | null;
  approval_status: string;
  approved_by_name: string | null;
  notes: string;
}

interface ActionRow {
  id: number;
  recommendation_id: number;
  sku: string;
  material_name: string;
  strategy: string;
  action_type: string;
  actual_recovered_qty: number;
  realized_net_value: number;
  executed_by_name: string | null;
  outcome_notes: string;
  executed_at: string;
}

export function RecoveryPage() {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [selectedMatId, setSelectedMatId] = useState<number>(10);
  const [evaluation, setEvaluation] = useState<RecoveryPlanResult | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Execute modal state
  const [execTarget, setExecTarget] = useState<RecommendationRow | null>(null);
  const [execQty, setExecQty] = useState('');
  const [execVal, setExecVal] = useState('');
  const [execNotes, setExecNotes] = useState('');

  const canApprove = ['Admin', 'Inventory Manager'].includes(user?.role || '');
  const canPropose = ['Admin', 'Inventory Manager', 'Production Planner'].includes(user?.role || '');

  const loadPipeline = async () => {
    const [mRes, rRes] = await Promise.all([
      apiFetch<{ materials: MaterialRecord[] }>('/api/materials'),
      apiFetch<{ recommendations: RecommendationRow[]; actions: ActionRow[] }>(
        '/api/recovery/recommendations'
      ),
    ]);
    setMaterials(mRes.materials);
    setRecommendations(rRes.recommendations);
    setActions(rRes.actions);
    if (mRes.materials.length > 0 && !mRes.materials.some((m) => m.id === selectedMatId)) {
      setSelectedMatId(mRes.materials[0].id);
    }
  };

  const evaluateMaterial = async (id: number) => {
    try {
      const res = await apiFetch<{ evaluation: RecoveryPlanResult }>(`/api/recovery/evaluate/${id}`);
      setEvaluation(res.evaluation);
    } catch {
      setEvaluation(null);
    }
  };

  useEffect(() => {
    loadPipeline();
  }, []);

  useEffect(() => {
    if (selectedMatId) evaluateMaterial(selectedMatId);
  }, [selectedMatId]);

  const handlePropose = async (opt: RecoveryOptionEvaluation) => {
    if (!evaluation) return;
    setFeedback(null);
    setError(null);
    try {
      await apiFetch('/api/recovery/recommendations', {
        method: 'POST',
        body: JSON.stringify({
          materialId: evaluation.materialId,
          strategy: opt.strategy,
          recoverableQty: opt.recoverableQty,
          grossEstimatedValue: opt.grossEstimatedValue,
          estimatedCosts: opt.estimatedCosts,
          netEstimatedValue: opt.netRecoveryValue,
          valueType: opt.valueType,
          assumptions: opt.assumptions,
          targetReference: opt.targetReference,
          notes: opt.feasibilityReason,
        }),
      });
      setFeedback(`Added "${opt.strategy}" recommendation for ${evaluation.sku} to approval queue.`);
      await loadPipeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Proposal failed.');
    }
  };

  const handleDecision = async (id: number, decision: 'Approved' | 'Rejected') => {
    setFeedback(null);
    setError(null);
    try {
      await apiFetch(`/api/recovery/recommendations/${id}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
      });
      setFeedback(`Updated recommendation #${id} to ${decision}.`);
      await loadPipeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed.');
    }
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!execTarget) return;
    setFeedback(null);
    setError(null);
    try {
      await apiFetch(`/api/recovery/recommendations/${execTarget.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({
          actualRecoveredQty: Number(execQty),
          realizedNetValue: Number(execVal),
          outcomeNotes: execNotes,
        }),
      });
      setFeedback(`Recorded realized recovery outcome for ${execTarget.sku}.`);
      setExecTarget(null);
      await loadPipeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution logging failed.');
    }
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Strategy Evaluator */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-base font-semibold">
              4-Strategy Dead Stock Recovery Evaluator
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Net Recovery Value = Expected Revenue or Avoided Procurement Cost − Relevant Costs.
              Mutually exclusive evaluation prevents double-counting.
            </p>
          </div>
          <select
            aria-label="Select material to evaluate recovery"
            value={selectedMatId}
            onChange={(e) => setSelectedMatId(Number(e.target.value))}
            className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 max-w-sm"
          >
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.sku} — {m.name} ({formatNumber(Math.max(0, m.availableQty - m.reservedQty))} {m.uom} free)
              </option>
            ))}
          </select>
        </div>

        {evaluation && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="font-semibold">{evaluation.materialName}</span> · Free Excess:{' '}
                <span className="font-mono">{formatNumber(evaluation.excessOrRiskQty)}</span> · Book
                Value: <span className="font-mono">{formatCurrency(evaluation.bookValue)}</span>
              </div>
              <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                Top Strategy: {evaluation.bestStrategy} ({formatCurrency(evaluation.estimatedNetRecoveryValue)} Est. Net)
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {evaluation.options.map((opt) => (
                <div
                  key={opt.strategy}
                  className={`p-4 rounded-xl border space-y-3 ${
                    opt.feasible
                      ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40'
                      : 'border-slate-200/60 dark:border-slate-800/60 opacity-65'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{opt.strategy}</div>
                      <div className="text-[11px] text-slate-500">
                        {opt.valueType} {opt.targetReference ? `· Ref: ${opt.targetReference}` : ''}
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(opt.netRecoveryValue)}
                      </div>
                      <div className="text-[11px] text-slate-500">Est. Net</div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300">{opt.feasibilityReason}</p>

                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums pt-1 border-t border-slate-200 dark:border-slate-800">
                    <div>
                      <div className="text-slate-500">Qty</div>
                      <div>{formatNumber(opt.recoverableQty)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Gross</div>
                      <div>{formatCurrency(opt.grossEstimatedValue)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Est. Cost</div>
                      <div>{formatCurrency(opt.estimatedCosts)}</div>
                    </div>
                  </div>

                  <ul className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                    {opt.assumptions.map((a) => (
                      <li key={a}>· {a}</li>
                    ))}
                  </ul>

                  {opt.feasible && canPropose && (
                    <button
                      type="button"
                      onClick={() => handlePropose(opt)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Queue for Approval</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recovery Approval Pipeline */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold">
            Recovery Recommendation Approval Queue
          </h2>
          <p className="text-xs text-slate-500">
            Estimated recovery values require Inventory Manager or Admin approval before execution.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">Material</th>
                <th className="py-3 px-4">Strategy · Ref</th>
                <th className="py-3 px-4 text-right">Qty</th>
                <th className="py-3 px-4 text-right">Est. Net Value</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Governance Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {recommendations.map((rec) => (
                <tr key={rec.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <div className="font-medium">{rec.material_name}</div>
                    <div className="font-mono text-xs text-slate-500">
                      {rec.sku} · {rec.warehouse_code}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs">
                    <div className="font-semibold">{rec.strategy}</div>
                    <div className="text-slate-500">
                      {rec.value_type} {rec.target_reference ? `· ${rec.target_reference}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {formatNumber(rec.recoverable_qty)} {rec.uom}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                    {formatCurrency(rec.net_estimated_value)}
                  </td>
                  <td className="py-3 px-4 text-xs font-semibold">
                    <span
                      className={
                        rec.approval_status === 'Executed' || rec.approval_status === 'Approved'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : rec.approval_status === 'Rejected'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }
                    >
                      {rec.approval_status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                    {rec.approval_status === 'Pending Review' && canApprove && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDecision(rec.id, 'Approved')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                        >
                          <Check className="w-3 h-3" />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(rec.id, 'Rejected')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <X className="w-3 h-3" />
                          <span>Reject</span>
                        </button>
                      </>
                    )}
                    {rec.approval_status === 'Approved' && canApprove && (
                      <button
                        type="button"
                        onClick={() => {
                          setExecTarget(rec);
                          setExecQty(String(rec.recoverable_qty));
                          setExecVal(String(rec.net_estimated_value));
                          setExecNotes('');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
                      >
                        <Recycle className="w-3 h-3" />
                        <span>Record Realized Outcome</span>
                      </button>
                    )}
                    {rec.approval_status === 'Executed' && (
                      <span className="text-xs text-slate-400">Realized</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Realized Outcomes Ledger */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="font-display text-sm font-semibold">
          Realized Recovery Outcomes (Audited Cash / Avoided Cost)
        </h3>
        <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
          {actions.map((act) => (
            <div key={act.id} className="py-2.5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="font-mono font-semibold">{act.sku}</span> · {act.action_type} (
                {formatNumber(act.actual_recovered_qty)} units)
                <div className="text-slate-500">{act.outcome_notes}</div>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                  +{formatCurrency(act.realized_net_value)} realized
                </div>
                <div className="text-[11px] text-slate-400">{act.executed_at}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Record Realized Outcome Modal */}
      {execTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h2 className="font-display text-base font-semibold">
                Record Realized Recovery ({execTarget.sku})
              </h2>
              <button
                type="button"
                onClick={() => setExecTarget(null)}
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleExecute} className="space-y-3.5 text-sm">
              <div>
                <label className="block text-xs font-medium mb-1">
                  Actual Recovered Quantity ({execTarget.uom})
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  value={execQty}
                  onChange={(e) => setExecQty(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Realized Net Value ($)</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  value={execVal}
                  onChange={(e) => setExecVal(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Execution Notes</label>
                <input
                  required
                  value={execNotes}
                  onChange={(e) => setExecNotes(e.target.value)}
                  placeholder="e.g. Issued to cutting floor batch #44 or buyer invoice settled"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setExecTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
                >
                  Confirm Realized Value
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
