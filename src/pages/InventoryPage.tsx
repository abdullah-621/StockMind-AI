import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowLeftRight,
  Download,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch, exportRowsToCsv, exportRowsToExcel, formatCurrency, formatNumber } from '../lib/api';
import type { MaterialRecord, RiskAssessmentResult } from '../engine/types';
import { useAuth } from '../context/AuthContext';

interface EnrichedMaterial extends MaterialRecord {
  risk: RiskAssessmentResult | null;
}

interface LookupOption {
  id: number;
  name: string;
  code?: string;
}

export function InventoryPage() {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<EnrichedMaterial[]>([]);
  const [warehouses, setWarehouses] = useState<LookupOption[]>([]);
  const [categories, setCategories] = useState<LookupOption[]>([]);
  const [suppliers, setSuppliers] = useState<LookupOption[]>([]);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [moveModalMat, setMoveModalMat] = useState<EnrichedMaterial | null>(null);
  const [selectedMat, setSelectedMat] = useState<EnrichedMaterial | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Add Material Form State
  const [newForm, setNewForm] = useState({
    sku: '',
    name: '',
    categoryId: '1',
    materialType: 'Single Jersey',
    composition: '100% Combed Cotton',
    color: 'Navy Blue',
    colorFamily: 'Blue',
    gsm: '180',
    widthInches: '72',
    construction: 'Single Jersey',
    qualityGrade: 'A',
    uom: 'kg',
    availableQty: '500',
    reservedQty: '0',
    warehouseId: '1',
    supplierId: '1',
    purchasePrice: '5.80',
    minStockLevel: '200',
    leadTimeDays: '14',
    batchNumber: '',
  });

  // Movement Form State
  const [moveForm, setMoveForm] = useState({
    movementType: 'IN',
    quantity: '',
    referenceCode: '',
    targetWarehouseId: '',
    notes: '',
  });

  const canMutate = ['Admin', 'Inventory Manager', 'Warehouse Manager'].includes(user?.role || '');

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (categoryId) params.set('categoryId', categoryId);
      if (search.trim()) params.set('search', search.trim());

      const [mRes, wRes, cRes, sRes] = await Promise.all([
        apiFetch<{ materials: EnrichedMaterial[] }>(`/api/materials?${params.toString()}`),
        apiFetch<{ warehouses: LookupOption[] }>('/api/warehouses'),
        apiFetch<{ categories: LookupOption[] }>('/api/categories'),
        apiFetch<{ suppliers: LookupOption[] }>('/api/suppliers'),
      ]);
      setMaterials(mRes.materials);
      setWarehouses(wRes.warehouses);
      setCategories(cRes.categories);
      setSuppliers(sRes.suppliers);
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Failed to load inventory.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [warehouseId, categoryId]);

  const filteredMaterials = materials.filter((m) => {
    if (riskFilter && m.risk?.riskCategory !== riskFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.sku.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.color.toLowerCase().includes(q) ||
      m.composition.toLowerCase().includes(q)
    );
  });

  const handleCreateMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/api/materials', {
        method: 'POST',
        body: JSON.stringify({
          ...newForm,
          categoryId: Number(newForm.categoryId),
          warehouseId: Number(newForm.warehouseId),
          supplierId: Number(newForm.supplierId),
          gsm: Number(newForm.gsm),
          widthInches: Number(newForm.widthInches),
          availableQty: Number(newForm.availableQty),
          reservedQty: Number(newForm.reservedQty),
          purchasePrice: Number(newForm.purchasePrice),
          minStockLevel: Number(newForm.minStockLevel),
          leadTimeDays: Number(newForm.leadTimeDays),
        }),
      });
      setAddModalOpen(false);
      setNewForm((f) => ({ ...f, sku: '', name: '', batchNumber: '' }));
      setFeedback({ type: 'ok', msg: `Added material ${newForm.sku} to inventory.` });
      await loadData();
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Create failed.' });
    }
  };

  const handleRecordMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveModalMat) return;
    setFeedback(null);
    try {
      await apiFetch('/api/stock-movements', {
        method: 'POST',
        body: JSON.stringify({
          materialId: moveModalMat.id,
          movementType: moveForm.movementType,
          quantity: Number(moveForm.quantity),
          referenceCode: moveForm.referenceCode,
          targetWarehouseId:
            moveForm.movementType === 'TRANSFER_OUT' && moveForm.targetWarehouseId
              ? Number(moveForm.targetWarehouseId)
              : undefined,
          notes: moveForm.notes,
        }),
      });
      setFeedback({
        type: 'ok',
        msg: `Recorded ${moveForm.movementType} of ${moveForm.quantity} ${moveModalMat.uom} for ${moveModalMat.sku}.`,
      });
      setMoveModalMat(null);
      setMoveForm({ movementType: 'IN', quantity: '', referenceCode: '', targetWarehouseId: '', notes: '' });
      await loadData();
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Stock movement failed.' });
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const res = await apiFetch<{ inserted: number; skipped: string[] }>('/api/materials/import', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
      setFeedback({
        type: 'ok',
        msg: `Imported ${res.inserted} materials (${res.skipped.length} skipped).`,
      });
      await loadData();
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Import failed.' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const exportInventory = (format: 'xlsx' | 'csv') => {
    const rows = filteredMaterials.map((m) => ({
      SKU: m.sku,
      'Material Name': m.name,
      Category: m.categoryName,
      Composition: m.composition,
      Color: m.color,
      GSM: m.gsm,
      'Width (in)': m.widthInches,
      Construction: m.construction,
      Grade: m.qualityGrade,
      UOM: m.uom,
      'Available Qty': m.availableQty,
      'Reserved Qty': m.reservedQty,
      Warehouse: m.warehouseCode,
      Supplier: m.supplierName,
      'Unit Price (USD)': m.purchasePrice,
      'Book Value (USD)': Number((m.availableQty * m.purchasePrice).toFixed(2)),
      'Risk Category': m.risk?.riskCategory ?? '',
      'Risk Score': m.risk?.riskScore ?? 0,
      'Data Origin': m.isSynthetic ? 'Synthetic' : 'User Entered',
    }));
    if (format === 'xlsx') exportRowsToExcel(rows, 'stockmind-inventory.xlsx', 'Inventory');
    else exportRowsToCsv(rows, 'stockmind-inventory.csv');
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          <span>{feedback.msg}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss message">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SKU, fabric, color..."
              aria-label="Search inventory"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <select
            aria-label="Filter by warehouse"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="">All Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by risk category"
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="">All Risk States</option>
            <option value="Healthy Stock">Healthy Stock</option>
            <option value="Slow-Moving Stock">Slow-Moving Stock</option>
            <option value="Excess Stock">Excess Stock</option>
            <option value="Critical Overstock">Critical Overstock</option>
            <option value="Potential Dead Stock">Potential Dead Stock</option>
            <option value="At-Risk Inventory">At-Risk Inventory</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileImport}
            className="hidden"
          />
          {canMutate && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import CSV/XLSX</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => exportInventory('csv')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={() => exportInventory('xlsx')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>
          {canMutate && (
            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-medium whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Material</span>
            </button>
          )}
        </div>
      </div>

      {/* Inventory Data Grid */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Material & Specs</th>
                <th className="py-3 px-4">Warehouse · Lot</th>
                <th className="py-3 px-4 text-right">Available</th>
                <th className="py-3 px-4 text-right">Reserved</th>
                <th className="py-3 px-4 text-right">Book Value</th>
                <th className="py-3 px-4">Risk Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    Loading inventory records...
                  </td>
                </tr>
              ) : filteredMaterials.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    No materials match the active filters.
                  </td>
                </tr>
              ) : (
                filteredMaterials.map((m) => {
                  const riskCat = m.risk?.riskCategory ?? 'Healthy Stock';
                  const riskColor =
                    riskCat === 'Potential Dead Stock' || riskCat === 'Critical Overstock'
                      ? 'text-rose-600 dark:text-rose-400'
                      : riskCat === 'Slow-Moving Stock' || riskCat === 'Excess Stock'
                      ? 'text-amber-600 dark:text-amber-400'
                      : riskCat === 'At-Risk Inventory'
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-emerald-600 dark:text-emerald-400';

                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 max-w-xs">
                        <button
                          type="button"
                          onClick={() => setSelectedMat(m)}
                          className="text-left font-medium text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 block truncate"
                        >
                          {m.name}
                        </button>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          <span className="font-mono">{m.sku}</span> · {m.composition}
                          {m.gsm > 0 ? ` · ${m.gsm} GSM` : ''} · Grade {m.qualityGrade}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                          {m.warehouseCode}
                        </div>
                        <div className="text-xs font-mono text-slate-500">{m.batchNumber}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {formatNumber(m.availableQty)} {m.uom}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">
                        {formatNumber(m.reservedQty)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-medium">
                        {formatCurrency(m.availableQty * m.purchasePrice)}
                      </td>
                      <td className="py-3 px-4">
                        <div className={`text-xs font-semibold ${riskColor}`}>{riskCat}</div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500">
                          {m.risk?.daysSinceLastMovement ?? 0}d idle · {m.risk?.monthsOfSupply ?? 0}m cover
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {canMutate ? (
                          <button
                            type="button"
                            onClick={() => {
                              setMoveModalMat(m);
                              setMoveForm({
                                movementType: 'IN',
                                quantity: '',
                                referenceCode: '',
                                targetWarehouseId: '',
                                notes: '',
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                            <span>Move</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedMat(m)}
                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Inspect
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Material Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h2 className="font-display text-lg font-semibold">Add Textile Material SKU</h2>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateMaterial} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
              <div>
                <label className="block text-xs font-medium mb-1">Material SKU</label>
                <input
                  required
                  value={newForm.sku}
                  onChange={(e) => setNewForm({ ...newForm, sku: e.target.value })}
                  placeholder="e.g. FAB-SJ-195-CRM"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Material Name</label>
                <input
                  required
                  value={newForm.name}
                  onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                  placeholder="e.g. Cotton Single Jersey 195 GSM Crimson"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Category</label>
                <select
                  value={newForm.categoryId}
                  onChange={(e) => setNewForm({ ...newForm, categoryId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Warehouse</label>
                <select
                  value={newForm.warehouseId}
                  onChange={(e) => setNewForm({ ...newForm, warehouseId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Supplier</label>
                <select
                  value={newForm.supplierId}
                  onChange={(e) => setNewForm({ ...newForm, supplierId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Composition</label>
                <input
                  value={newForm.composition}
                  onChange={(e) => setNewForm({ ...newForm, composition: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Color</label>
                <input
                  value={newForm.color}
                  onChange={(e) => setNewForm({ ...newForm, color: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Construction</label>
                <input
                  value={newForm.construction}
                  onChange={(e) => setNewForm({ ...newForm, construction: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">GSM</label>
                  <input
                    type="number"
                    value={newForm.gsm}
                    onChange={(e) => setNewForm({ ...newForm, gsm: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Width (in)</label>
                  <input
                    type="number"
                    value={newForm.widthInches}
                    onChange={(e) => setNewForm({ ...newForm, widthInches: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Available Qty</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={newForm.availableQty}
                    onChange={(e) => setNewForm({ ...newForm, availableQty: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">UOM</label>
                  <select
                    value={newForm.uom}
                    onChange={(e) => setNewForm({ ...newForm, uom: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="kg">kg</option>
                    <option value="meters">meters</option>
                    <option value="cones">cones</option>
                    <option value="pcs">pcs</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Unit Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={newForm.purchasePrice}
                    onChange={(e) => setNewForm({ ...newForm, purchasePrice: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Lead Time (d)</label>
                  <input
                    type="number"
                    min="1"
                    value={newForm.leadTimeDays}
                    onChange={(e) => setNewForm({ ...newForm, leadTimeDays: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
                >
                  Save Material
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Movement Modal */}
      {moveModalMat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h2 className="font-display text-base font-semibold">Record Stock Movement</h2>
                <p className="text-xs text-slate-500">
                  {moveModalMat.sku} · Available: {formatNumber(moveModalMat.availableQty)} {moveModalMat.uom}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMoveModalMat(null)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRecordMovement} className="space-y-3.5 text-sm">
              <div>
                <label htmlFor="mov-type" className="block text-xs font-medium mb-1">
                  Movement Type
                </label>
                <select
                  id="mov-type"
                  value={moveForm.movementType}
                  onChange={(e) => setMoveForm({ ...moveForm, movementType: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="IN">Stock In (Supplier Receipt / Return)</option>
                  <option value="OUT">Stock Out (Cutting Floor Issue)</option>
                  <option value="ADJUST">Cycle Count Adjustment (Set New Qty)</option>
                  <option value="TRANSFER_OUT">Inter-Warehouse Transfer</option>
                </select>
              </div>

              {moveForm.movementType === 'TRANSFER_OUT' && (
                <div>
                  <label htmlFor="mov-target-wh" className="block text-xs font-medium mb-1">
                    Destination Warehouse
                  </label>
                  <select
                    id="mov-target-wh"
                    required
                    value={moveForm.targetWarehouseId}
                    onChange={(e) => setMoveForm({ ...moveForm, targetWarehouseId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="">Select destination...</option>
                    {warehouses
                      .filter((w) => w.id !== moveModalMat.warehouseId)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="mov-qty" className="block text-xs font-medium mb-1">
                  Quantity ({moveModalMat.uom})
                </label>
                <input
                  id="mov-qty"
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={moveForm.quantity}
                  onChange={(e) => setMoveForm({ ...moveForm, quantity: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div>
                <label htmlFor="mov-ref" className="block text-xs font-medium mb-1">
                  Reference Document (GRN / Cutting Slip / Transfer)
                </label>
                <input
                  id="mov-ref"
                  value={moveForm.referenceCode}
                  onChange={(e) => setMoveForm({ ...moveForm, referenceCode: e.target.value })}
                  placeholder="e.g. CUT-2026-991"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div>
                <label htmlFor="mov-notes" className="block text-xs font-medium mb-1">
                  Notes
                </label>
                <input
                  id="mov-notes"
                  value={moveForm.notes}
                  onChange={(e) => setMoveForm({ ...moveForm, notes: e.target.value })}
                  placeholder="Optional operational note"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setMoveModalMat(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
                >
                  Commit Movement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Material Detail Drawer */}
      {selectedMat && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
          <div className="bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 w-full max-w-lg h-full overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <div className="font-mono text-xs text-slate-500">{selectedMat.sku}</div>
                <h2 className="font-display text-lg font-semibold mt-0.5">{selectedMat.name}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMat(null)}
                aria-label="Close detail"
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">Available / Reserved</div>
                <div className="font-mono tabular-nums text-base font-semibold mt-1">
                  {formatNumber(selectedMat.availableQty)} / {formatNumber(selectedMat.reservedQty)} {selectedMat.uom}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">Book Valuation</div>
                <div className="font-mono tabular-nums text-base font-semibold mt-1">
                  {formatCurrency(selectedMat.availableQty * selectedMat.purchasePrice)}
                </div>
              </div>
            </div>

            <dl className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {[
                ['Composition', selectedMat.composition],
                ['Construction', selectedMat.construction],
                ['Color / Family', `${selectedMat.color} (${selectedMat.colorFamily})`],
                ['GSM / Width', selectedMat.gsm > 0 ? `${selectedMat.gsm} GSM · ${selectedMat.widthInches}"` : 'N/A'],
                ['Quality Grade', `Grade ${selectedMat.qualityGrade}`],
                ['Warehouse', `${selectedMat.warehouseCode} — ${selectedMat.warehouseName}`],
                ['Supplier & Lead Time', `${selectedMat.supplierName} (${selectedMat.leadTimeDays} days)`],
                ['Batch / Lot', selectedMat.batchNumber],
                ['Purchase Date', selectedMat.purchaseDate],
                ['Last Movement', selectedMat.lastMovementDate],
                ['Data Provenance', selectedMat.isSynthetic ? 'Synthetic Prototype Record' : 'Factory User Record'],
              ].map(([k, v]) => (
                <div key={k} className="py-2.5 flex justify-between gap-4">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-medium text-right">{v}</dd>
                </div>
              ))}
            </dl>

            {selectedMat.risk && (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>{selectedMat.risk.riskCategory}</span>
                  <span className="font-mono tabular-nums">Score {selectedMat.risk.riskScore}/100</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {selectedMat.risk.explanation}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
