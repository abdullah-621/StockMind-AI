import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Shield } from 'lucide-react';
import { apiFetch, exportRowsToCsv, exportRowsToExcel, formatCurrency } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { MaterialRecord, ReorderRecommendationResult, RiskAssessmentResult, UserRole } from '../engine/types';

export function ReportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);

  const exportFullInventoryReport = async (fmt: 'xlsx' | 'csv') => {
    setDownloading('inventory');
    try {
      const res = await apiFetch<{
        materials: Array<MaterialRecord & { risk: RiskAssessmentResult | null }>;
      }>('/api/materials');
      const rows = res.materials.map((m) => ({
        SKU: m.sku,
        Name: m.name,
        Category: m.categoryName,
        Warehouse: m.warehouseCode,
        AvailableQty: m.availableQty,
        ReservedQty: m.reservedQty,
        UOM: m.uom,
        UnitPriceUSD: m.purchasePrice,
        BookValueUSD: Number((m.availableQty * m.purchasePrice).toFixed(2)),
        RiskCategory: m.risk?.riskCategory ?? '',
        RiskScore: m.risk?.riskScore ?? 0,
        DaysIdle: m.risk?.daysSinceLastMovement ?? 0,
        UpcomingBOMQty: m.risk?.upcomingBomQty ?? 0,
        Explanation: m.risk?.explanation ?? '',
        Origin: m.isSynthetic ? 'Synthetic' : 'User',
      }));
      if (fmt === 'xlsx') exportRowsToExcel(rows, 'stockmind-risk-inventory-report.xlsx', 'Risk & Stock');
      else exportRowsToCsv(rows, 'stockmind-risk-inventory-report.csv');
    } finally {
      setDownloading(null);
    }
  };

  const exportReorderReport = async () => {
    setDownloading('reorder');
    try {
      const res = await apiFetch<{ reorders: ReorderRecommendationResult[] }>(
        '/api/inventory-risk/reorders'
      );
      const rows = res.reorders.map((r) => ({
        SKU: r.sku,
        Material: r.materialName,
        RiskLevel: r.stockoutRiskLevel,
        NetEffectiveStock: r.netEffectiveStock,
        ReorderPoint: r.reorderPoint,
        SafetyStock: r.safetyStock,
        CoverageDays: r.coverageDays,
        EstimatedStockoutDate: r.estimatedStockoutDate ?? 'N/A',
        RecommendedOrderQty: r.recommendedReorderQty,
        SuggestedReorderDate: r.suggestedReorderDate,
      }));
      exportRowsToExcel(rows, 'stockmind-reorder-schedule.xlsx', 'Reorder Plan');
    } finally {
      setDownloading(null);
    }
  };

  const exportRecoveryReport = async () => {
    setDownloading('recovery');
    try {
      const res = await apiFetch<{
        recommendations: Array<Record<string, unknown>>;
        actions: Array<Record<string, unknown>>;
      }>('/api/recovery/recommendations');
      exportRowsToExcel(res.recommendations, 'stockmind-recovery-pipeline.xlsx', 'Recovery Pipeline');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <FileSpreadsheet className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="font-display text-base font-semibold">Inventory &amp; Dead Stock Risk</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Complete SKU valuation, BOM offsets, multi-factor risk scores, and action flags.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={downloading === 'inventory'}
              onClick={() => exportFullInventoryReport('xlsx')}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              disabled={downloading === 'inventory'}
              onClick={() => exportFullInventoryReport('csv')}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <FileSpreadsheet className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 className="font-display text-base font-semibold">Stockout &amp; Reorder Schedule</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reorder points, 95% service-level safety stock, coverage days, and suggested PO dates.
            </p>
          </div>
          <button
            type="button"
            disabled={downloading === 'reorder'}
            onClick={exportReorderReport}
            className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Reorder Plan (.xlsx)</span>
          </button>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="font-display text-base font-semibold">Dead Stock Recovery Ledger</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Proposed recovery strategies, approval status, cost assumptions, and net estimates.
            </p>
          </div>
          <button
            type="button"
            disabled={downloading === 'recovery'}
            onClick={exportRecoveryReport}
            className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Recovery Ledger (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Transparency & Capability Scope Documentation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="font-display text-base font-semibold">
            Architecture, Data Provenance &amp; Implementation Scope
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Transparent engineering documentation distinguishing live implemented modules from
            future ML scaling integrations.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="font-semibold text-emerald-700 dark:text-emerald-400">
              Implemented &amp; Verified in Runtime
            </div>
            <ul className="space-y-1 text-slate-600 dark:text-slate-300 leading-relaxed">
              <li>· Relational PostgreSQL persistence (21 normalized tables, FK constraints, ACID transactions)</li>
              <li>· JWT Authentication &amp; 5-Role RBAC enforcement across backend endpoints</li>
              <li>· Multi-factor Dead Stock Risk Scoring with BOM/Seasonal guardrails &amp; Z-score anomaly check</li>
              <li>· Chronological Time-Series Forecasting (Moving Average, Holt Exponential Smoothing, Seasonal Naive) evaluated with held-out MAE, RMSE, and WAPE</li>
              <li>· Hybrid Hard-Constraint + Weighted KNN Material Compatibility Matching with QC Approval log</li>
              <li>· 4-Strategy Dead Stock Recovery Engine &amp; What-If Financial Simulator with zero double-counting</li>
              <li>· Server-side Gemini RAG Inventory Copilot grounded in PostgreSQL business queries</li>
            </ul>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="font-semibold text-amber-700 dark:text-amber-400">
              Documented Limitations &amp; Planned Extensions
            </div>
            <ul className="space-y-1 text-slate-600 dark:text-slate-300 leading-relaxed">
              <li>· <span className="font-medium">Dataset Origin:</span> Pre-loaded records are deterministic synthetic knitwear/textile data (flagged <code className="font-mono">is_synthetic=1</code>), not live ERP factory data.</li>
              <li>· <span className="font-medium">Runtime Stack Adaptation:</span> Executed in Node/Express + PostgreSQL + TypeScript engines for single-container deployment; Python FastAPI / MySQL / XGBoost / Qdrant / MLflow microservices can attach via REST when factory volume exceeds 100k+ snapshots.</li>
              <li>· <span className="font-medium">Labelled Dead-Stock History:</span> Until a factory accumulates 12+ months of labelled disposal outcomes, Risk Detection uses transparent rule-based + statistical anomaly baselines rather than black-box classifiers.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<
    Array<{ id: number; full_name: string; email: string; role: UserRole; department: string }>
  >([]);
  const [roles, setRoles] = useState<Array<{ id: number; name: UserRole; description: string }>>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = () => {
    apiFetch<{
      users: Array<{ id: number; full_name: string; email: string; role: UserRole; department: string }>;
      roles: Array<{ id: number; name: UserRole; description: string }>;
    }>('/api/users').then((res) => {
      setUsers(res.users);
      setRoles(res.roles);
    });
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const updateRole = async (userId: number, roleName: UserRole) => {
    setFeedback(null);
    setError(null);
    try {
      await apiFetch(`/api/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ roleName }),
      });
      setFeedback(`Updated user #${userId} role to ${roleName}.`);
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update role.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
        <div className="flex items-center gap-2 font-display text-base font-semibold">
          <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span>Active Session &amp; Permissions</span>
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-300">
          Signed in as <span className="font-semibold">{user?.fullName}</span> ({user?.email}) · Role:{' '}
          <span className="font-semibold text-blue-600 dark:text-blue-400">{user?.role}</span>
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
          {feedback}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold">Factory User Accounts &amp; RBAC</h2>
          <p className="text-xs text-slate-500">
            Only Admin accounts can reassign operational roles.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Assigned Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-3 px-4 font-medium">{u.full_name}</td>
                  <td className="py-3 px-4 font-mono text-xs">{u.email}</td>
                  <td className="py-3 px-4 text-xs text-slate-500">{u.department}</td>
                  <td className="py-3 px-4">
                    {user?.role === 'Admin' ? (
                      <select
                        aria-label={`Role for ${u.email}`}
                        value={u.role}
                        onChange={(e) => updateRole(u.id, e.target.value as UserRole)}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.name}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs font-medium">{u.role}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="font-display text-sm font-semibold">Role Permission Matrix</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {roles.map((r) => (
            <div
              key={r.id}
              className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
            >
              <div className="font-semibold">{r.name}</div>
              <div className="text-slate-500 dark:text-slate-400 mt-0.5">{r.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
