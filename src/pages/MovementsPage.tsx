import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiFetch, exportRowsToCsv, formatNumber } from '../lib/api';

interface StockMovementRow {
  id: number;
  sku: string;
  material_name: string;
  uom: string;
  warehouse_code: string;
  movement_type: string;
  quantity: number;
  reference_code: string;
  batch_number: string;
  notes: string;
  performed_by_name: string | null;
  movement_date: string;
  is_synthetic: number;
}

interface AuditLogRow {
  id: number;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}

export function MovementsPage() {
  const [tab, setTab] = useState<'movements' | 'audit'>('movements');
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<{ movements: StockMovementRow[] }>(`/api/stock-movements?movementType=${typeFilter}`),
      apiFetch<{ logs: AuditLogRow[] }>('/api/audit-logs'),
    ])
      .then(([mRes, aRes]) => {
        setMovements(mRes.movements);
        setLogs(aRes.logs);
      })
      .finally(() => setLoading(false));
  }, [typeFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('movements')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'movements'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Stock Movement Ledger
          </button>
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'audit'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            System Audit Trail
          </button>
        </div>

        <div className="flex items-center gap-3">
          {tab === 'movements' && (
            <select
              aria-label="Filter movement type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="ALL">All Movement Types</option>
              <option value="IN">Stock In (IN)</option>
              <option value="OUT">Stock Out (OUT)</option>
              <option value="ADJUST">Adjustments (ADJUST)</option>
              <option value="TRANSFER_OUT">Transfer Out</option>
              <option value="TRANSFER_IN">Transfer In</option>
            </select>
          )}
          <button
            type="button"
            onClick={() =>
              exportRowsToCsv(
                (tab === 'movements' ? movements : logs) as unknown as Record<string, unknown>[],
                tab === 'movements' ? 'stockmind-movements.csv' : 'stockmind-audit-logs.csv'
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          {tab === 'movements' ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Material</th>
                  <th className="py-3 px-4">Warehouse · Lot</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4 text-right">Quantity</th>
                  <th className="py-3 px-4">Reference & Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Loading ledger...
                    </td>
                  </tr>
                ) : (
                  movements.map((mv) => (
                    <tr key={mv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-xs whitespace-nowrap">
                        {mv.movement_date}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {mv.material_name}
                        </div>
                        <div className="font-mono text-xs text-slate-500">{mv.sku}</div>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <div>{mv.warehouse_code}</div>
                        <div className="font-mono text-slate-500">{mv.batch_number}</div>
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold">
                        <span
                          className={
                            mv.movement_type === 'IN' || mv.movement_type === 'TRANSFER_IN'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : mv.movement_type === 'OUT' || mv.movement_type === 'TRANSFER_OUT'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-blue-600 dark:text-blue-400'
                          }
                        >
                          {mv.movement_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {formatNumber(mv.quantity)} {mv.uom}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">
                        <div className="font-mono text-slate-900 dark:text-slate-100">
                          {mv.reference_code}
                        </div>
                        <div className="truncate max-w-xs">{mv.notes}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono whitespace-nowrap">{l.created_at}</td>
                    <td className="py-3 px-4">{l.user_email}</td>
                    <td className="py-3 px-4 font-mono font-semibold">{l.action}</td>
                    <td className="py-3 px-4 font-mono">
                      {l.entity_type} #{l.entity_id}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{l.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
