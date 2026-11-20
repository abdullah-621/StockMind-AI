import type { PoolClient } from 'pg';
import { query, pool } from './db/pool.js';
import { assessInventoryRisk } from '../src/engine/riskEngine.js';
import { runDemandForecast } from '../src/engine/forecastEngine.js';
import { calculateReorderRecommendation, type ReorderSimulationParams } from '../src/engine/reorderEngine.js';
import { findCompatibleMaterials } from '../src/engine/compatibilityEngine.js';
import { evaluateRecoveryOptions, type OpenBomNeed, type WarehouseShortageNeed } from '../src/engine/recoveryEngine.js';
import type {
  ForecastModelName,
  MaterialRecord,
  MaterialSpecQuery,
  MonthlyDemandPoint,
  RiskAssessmentResult,
} from '../src/engine/types.js';

// Override with REFERENCE_DATE_ISO when a competition demo needs a fixed, reproducible date.
export const REFERENCE_DATE_ISO = process.env.REFERENCE_DATE_ISO || new Date().toISOString().slice(0, 10);

interface RawMaterialRow {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  category_name: string;
  material_type: string;
  composition: string;
  color: string;
  color_family: string;
  gsm: number;
  width_inches: number;
  construction: string;
  quality_grade: 'A' | 'B' | 'C';
  uom: 'kg' | 'meters' | 'cones' | 'pcs';
  available_qty: number;
  reserved_qty: number;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  supplier_id: number;
  supplier_name: string;
  purchase_price: number;
  purchase_date: string;
  last_movement_date: string;
  batch_number: string;
  min_stock_level: number;
  lead_time_days: number;
  shelf_life_days: number | null;
  seasonal_peak_months: string;
  is_synthetic: boolean;
}

function mapMaterialRow(r: RawMaterialRow): MaterialRecord {
  let peaks: number[] = [];
  try {
    peaks = JSON.parse(r.seasonal_peak_months || '[]');
  } catch {
    peaks = [];
  }
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    categoryId: r.category_id,
    categoryName: r.category_name,
    materialType: r.material_type,
    composition: r.composition,
    color: r.color,
    colorFamily: r.color_family,
    gsm: Number(r.gsm),
    widthInches: Number(r.width_inches),
    construction: r.construction,
    qualityGrade: r.quality_grade,
    uom: r.uom,
    availableQty: Number(r.available_qty),
    reservedQty: Number(r.reserved_qty),
    warehouseId: r.warehouse_id,
    warehouseCode: r.warehouse_code,
    warehouseName: r.warehouse_name,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    purchasePrice: Number(r.purchase_price),
    purchaseDate: r.purchase_date,
    lastMovementDate: r.last_movement_date,
    batchNumber: r.batch_number,
    minStockLevel: Number(r.min_stock_level),
    leadTimeDays: Number(r.lead_time_days),
    shelfLifeDays: r.shelf_life_days,
    seasonalPeakMonths: peaks,
    isSynthetic: Boolean(r.is_synthetic),
  };
}

export async function getAllMaterials(filters?: { warehouseId?: number; categoryId?: number; search?: string }): Promise<MaterialRecord[]> {
  let sql = `
    SELECT m.*, c.name as category_name, w.code as warehouse_code, w.name as warehouse_name, s.name as supplier_name
    FROM materials m
    JOIN material_categories c ON c.id = m.category_id
    JOIN warehouses w ON w.id = m.warehouse_id
    JOIN suppliers s ON s.id = m.supplier_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.warehouseId) {
    sql += ` AND m.warehouse_id = $${paramIdx++}`;
    params.push(filters.warehouseId);
  }
  if (filters?.categoryId) {
    sql += ` AND m.category_id = $${paramIdx++}`;
    params.push(filters.categoryId);
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    sql += ` AND (m.sku ILIKE $${paramIdx} OR m.name ILIKE $${paramIdx+1} OR m.color ILIKE $${paramIdx+2} OR m.composition ILIKE $${paramIdx+3} OR m.construction ILIKE $${paramIdx+4})`;
    params.push(q, q, q, q, q);
    paramIdx += 5;
  }
  sql += ' ORDER BY m.id ASC';

  const result = await query<RawMaterialRow>(sql, params);
  return result.rows.map(mapMaterialRow);
}

export async function getMaterialById(id: number): Promise<MaterialRecord | null> {
  const result = await query<RawMaterialRow>(
    `SELECT m.*, c.name as category_name, w.code as warehouse_code, w.name as warehouse_name, s.name as supplier_name
     FROM materials m
     JOIN material_categories c ON c.id = m.category_id
     JOIN warehouses w ON w.id = m.warehouse_id
     JOIN suppliers s ON s.id = m.supplier_id
     WHERE m.id = $1`,
    [id]
  );
  return result.rows[0] ? mapMaterialRow(result.rows[0]) : null;
}

/**
 * Read and lock a material row inside the caller's transaction.
 * The row lock serializes stock-changing operations for the same SKU.
 */
export async function getMaterialByIdForUpdate(
  id: number,
  client: PoolClient
): Promise<MaterialRecord | null> {
  const result = await client.query<RawMaterialRow>(
    `SELECT m.*, c.name as category_name, w.code as warehouse_code, w.name as warehouse_name, s.name as supplier_name
     FROM materials m
     JOIN material_categories c ON c.id = m.category_id
     JOIN warehouses w ON w.id = m.warehouse_id
     JOIN suppliers s ON s.id = m.supplier_id
     WHERE m.id = $1
     FOR UPDATE OF m`,
    [id]
  );
  return result.rows[0] ? mapMaterialRow(result.rows[0]) : null;
}

export async function getMaterialSnapshots(materialId: number): Promise<MonthlyDemandPoint[]> {
  const result = await query<{ period_ym: string; consumed_qty: number }>(
    'SELECT period_ym, consumed_qty FROM inventory_snapshots WHERE material_id = $1 ORDER BY period_ym ASC',
    [materialId]
  );
  return result.rows.map((r) => ({ period: r.period_ym, actualQty: Number(r.consumed_qty) }));
}

/** Load snapshot history for many materials in one database round-trip. */
export async function getMaterialSnapshotsMap(materialIds: number[]): Promise<Map<number, MonthlyDemandPoint[]>> {
  const snapshots = new Map<number, MonthlyDemandPoint[]>();
  if (materialIds.length === 0) return snapshots;

  const result = await query<{ material_id: number; period_ym: string; consumed_qty: number }>(
    `SELECT material_id, period_ym, consumed_qty
     FROM inventory_snapshots
     WHERE material_id = ANY($1::int[])
     ORDER BY material_id ASC, period_ym ASC`,
    [materialIds]
  );

  for (const row of result.rows) {
    const history = snapshots.get(row.material_id) ?? [];
    history.push({ period: row.period_ym, actualQty: Number(row.consumed_qty) });
    snapshots.set(row.material_id, history);
  }
  return snapshots;
}

export async function getBomCommitmentsMap(): Promise<Map<number, number>> {
  const result = await query<{ material_id: number; net_bom_qty: number }>(
    `SELECT b.material_id, SUM(GREATEST(0, b.required_qty - b.allocated_qty)) as net_bom_qty
     FROM bom_items b
     JOIN production_orders p ON p.id = b.production_order_id
     WHERE p.status IN ('Planned', 'In Progress')
     GROUP BY b.material_id`
  );
  return new Map(result.rows.map((r) => [r.material_id, Number(r.net_bom_qty)]));
}

export async function getIncomingPoMap(): Promise<Map<number, number>> {
  const result = await query<{ material_id: number; incoming_qty: number }>(
    `SELECT poi.material_id, SUM(GREATEST(0, poi.ordered_qty - poi.received_qty)) as incoming_qty
     FROM purchase_order_items poi
     JOIN purchase_orders po ON po.id = poi.purchase_order_id
     WHERE po.status IN ('Approved', 'Ordered')
     GROUP BY poi.material_id`
  );
  return new Map(result.rows.map((r) => [r.material_id, Number(r.incoming_qty)]));
}

export async function computeAllRiskAssessments(filters?: { warehouseId?: number; categoryId?: number }): Promise<RiskAssessmentResult[]> {
  const materials = await getAllMaterials(filters);
  if (materials.length === 0) return [];

  const materialIds = materials.map((material) => material.id);
  const [snapshotMap, bomMap] = await Promise.all([
    getMaterialSnapshotsMap(materialIds),
    getBomCommitmentsMap(),
  ]);

  return materials.map((mat) => assessInventoryRisk({
    material: mat,
    monthlyConsumptions: (snapshotMap.get(mat.id) ?? []).map((s) => Number(s.actualQty ?? 0)),
    upcomingBomQty: bomMap.get(mat.id) ?? 0,
    referenceDateIso: REFERENCE_DATE_ISO,
  }));
}

export async function computeMaterialForecast(
  materialId: number,
  horizonMonths = 3,
  preferredModel?: ForecastModelName
) {
  const mat = await getMaterialById(materialId);
  if (!mat) return null;
  const history = await getMaterialSnapshots(materialId);
  const bomMap = await getBomCommitmentsMap();
  return runDemandForecast(mat, history, horizonMonths, preferredModel, bomMap.get(materialId) ?? 0);
}

export async function computeReorderRecommendations(
  filters?: { warehouseId?: number; categoryId?: number },
  sim?: ReorderSimulationParams
) {
  const materials = await getAllMaterials(filters);
  if (materials.length === 0) return [];

  const materialIds = materials.map((material) => material.id);
  const [snapshotMap, bomMap, poMap] = await Promise.all([
    getMaterialSnapshotsMap(materialIds),
    getBomCommitmentsMap(),
    getIncomingPoMap(),
  ]);

  return materials.map((mat) => calculateReorderRecommendation(
    mat,
    (snapshotMap.get(mat.id) ?? []).map((s) => Number(s.actualQty ?? 0)),
    poMap.get(mat.id) ?? 0,
    bomMap.get(mat.id) ?? 0,
    REFERENCE_DATE_ISO,
    sim
  ));
}

/** Shared dashboard calculation: fetch common inputs once, then run both engines in memory. */
export async function computeInventoryAnalytics(filters?: { warehouseId?: number; categoryId?: number }) {
  const materials = await getAllMaterials(filters);
  if (materials.length === 0) return { materials, risks: [], reorders: [] };

  const materialIds = materials.map((material) => material.id);
  const [snapshotMap, bomMap, poMap] = await Promise.all([
    getMaterialSnapshotsMap(materialIds),
    getBomCommitmentsMap(),
    getIncomingPoMap(),
  ]);

  const risks = materials.map((mat) => assessInventoryRisk({
    material: mat,
    monthlyConsumptions: (snapshotMap.get(mat.id) ?? []).map((s) => Number(s.actualQty ?? 0)),
    upcomingBomQty: bomMap.get(mat.id) ?? 0,
    referenceDateIso: REFERENCE_DATE_ISO,
  }));

  const reorders = materials.map((mat) => calculateReorderRecommendation(
    mat,
    (snapshotMap.get(mat.id) ?? []).map((s) => Number(s.actualQty ?? 0)),
    poMap.get(mat.id) ?? 0,
    bomMap.get(mat.id) ?? 0,
    REFERENCE_DATE_ISO
  ));

  return { materials, risks, reorders };
}

export async function computeCompatibilityMatches(query2: MaterialSpecQuery) {
  const all = await getAllMaterials();
  return findCompatibleMaterials(query2, all, 10);
}

export async function computeRecoveryEvaluationForMaterial(materialId: number) {
  const mat = await getMaterialById(materialId);
  if (!mat) return null;
  const allMaterials = await getAllMaterials();
  const matMap = new Map(allMaterials.map((m) => [m.id, m]));

  const bomRows = await query<{ order_code: string; style_name: string; material_id: number; rem_qty: number }>(
    `SELECT p.order_code, p.style_name, b.material_id, GREATEST(0, b.required_qty - b.allocated_qty) as rem_qty
     FROM bom_items b
     JOIN production_orders p ON p.id = b.production_order_id
     WHERE p.status IN ('Planned', 'In Progress') AND (b.required_qty - b.allocated_qty) > 0`
  );

  const openBoms: OpenBomNeed[] = bomRows.rows
    .map((r) => {
      const target = matMap.get(r.material_id);
      if (!target) return null;
      return {
        productionOrderCode: r.order_code,
        styleName: r.style_name,
        materialId: r.material_id,
        requiredQty: Number(r.rem_qty),
        targetMaterial: target,
      };
    })
    .filter((x): x is OpenBomNeed => x !== null);

  const shortages: WarehouseShortageNeed[] = allMaterials
    .filter(
      (m) =>
        m.warehouseId !== mat.warehouseId &&
        m.materialType === mat.materialType &&
        m.colorFamily === mat.colorFamily &&
        m.availableQty < m.minStockLevel
    )
    .map((m) => ({
      warehouseCode: m.warehouseCode,
      warehouseName: m.warehouseName,
      shortageQty: Math.max(0, m.minStockLevel - m.availableQty),
      materialSku: m.sku,
    }));

  const freeExcessQty = Math.max(0, mat.availableQty - mat.reservedQty);
  return evaluateRecoveryOptions(mat, freeExcessQty, openBoms, shortages);
}

export async function logAudit(
  userId: number | null,
  userEmail: string,
  action: string,
  entityType: string,
  entityId: string | number,
  details: string
): Promise<void> {
  await query(
    'INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, userEmail, action, entityType, String(entityId), details]
  );
}
