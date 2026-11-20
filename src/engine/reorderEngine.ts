import type { MaterialRecord, ReorderRecommendationResult } from './types';

export interface ReorderSimulationParams {
  demandMultiplier?: number; // e.g., 1.25 for +25% demand spike
  leadTimeDeltaDays?: number; // e.g., +10 days supplier delay
  serviceLevelZ?: number; // 1.65 = 95% service level, 2.33 = 99%
}

function addDaysIso(baseDateIso: string, days: number): string {
  const dt = new Date(baseDateIso);
  if (Number.isNaN(dt.getTime())) return baseDateIso;
  dt.setUTCDate(dt.getUTCDate() + Math.max(0, Math.round(days)));
  return dt.toISOString().slice(0, 10);
}

/**
 * Explainable Stockout Risk & Reorder Point Calculation.
 * Reorder Point = Average Daily Demand * Lead Time + Safety Stock
 * Never places purchase orders automatically; produces human-reviewable recommendation.
 */
export function calculateReorderRecommendation(
  material: MaterialRecord,
  monthlyConsumptions: number[],
  incomingPoQty: number,
  bomCommittedQty: number,
  referenceDateIso: string,
  sim: ReorderSimulationParams = {}
): ReorderRecommendationResult {
  const demandMultiplier = sim.demandMultiplier ?? 1.0;
  const leadTimeDays = Math.max(1, material.leadTimeDays + (sim.leadTimeDeltaDays ?? 0));
  const z = sim.serviceLevelZ ?? 1.65; // 95% service level

  const recent = monthlyConsumptions.slice(-6);
  const avgMonthly =
    recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const baseDailyDemand = avgMonthly / 30;
  const avgDailyDemand = Number((baseDailyDemand * demandMultiplier).toFixed(2));

  // Estimate daily demand std dev from monthly variance
  const monthlyMean = avgMonthly;
  const monthlyVar =
    recent.length > 1
      ? recent.reduce((acc, v) => acc + (v - monthlyMean) ** 2, 0) / recent.length
      : (monthlyMean * 0.2) ** 2;
  const dailyStd = (Math.sqrt(monthlyVar) / 30) * demandMultiplier;

  const safetyStock = Math.max(
    Math.round(material.minStockLevel * 0.5),
    Math.round(z * dailyStd * Math.sqrt(leadTimeDays))
  );

  const reorderPoint = Math.round(avgDailyDemand * leadTimeDays + safetyStock);

  const freeAvailable = Math.max(0, material.availableQty - material.reservedQty);
  // Net effective stock accounts for incoming POs minus active BOM commitments above reserved
  const unreservedBom = Math.max(0, bomCommittedQty - material.reservedQty);
  const netEffectiveStock = Math.max(0, freeAvailable + incomingPoQty - unreservedBom);

  const coverageDays =
    avgDailyDemand > 0
      ? Number((freeAvailable / avgDailyDemand).toFixed(1))
      : freeAvailable > 0
      ? 365
      : 0;

  const estimatedStockoutDate =
    avgDailyDemand > 0 && coverageDays < 180
      ? addDaysIso(referenceDateIso, Math.floor(coverageDays))
      : null;

  let stockoutRiskLevel: 'Critical' | 'High' | 'Moderate' | 'Low' = 'Low';
  if (avgDailyDemand > 0) {
    if (freeAvailable <= safetyStock || coverageDays <= Math.max(5, leadTimeDays * 0.5)) {
      stockoutRiskLevel = 'Critical';
    } else if (netEffectiveStock <= reorderPoint || coverageDays <= leadTimeDays) {
      stockoutRiskLevel = 'High';
    } else if (netEffectiveStock <= reorderPoint * 1.25) {
      stockoutRiskLevel = 'Moderate';
    }
  } else if (unreservedBom > freeAvailable) {
    stockoutRiskLevel = 'Critical';
  }

  // Target 45 days of post-lead-time operating stock when ordering
  const targetCycleDays = Math.max(30, leadTimeDays + 30);
  const targetStock = Math.round(avgDailyDemand * targetCycleDays + safetyStock);
  const recommendedReorderQty =
    netEffectiveStock < reorderPoint
      ? Math.max(material.minStockLevel, Math.round(targetStock - netEffectiveStock))
      : 0;

  const daysUntilRop =
    avgDailyDemand > 0 ? Math.floor((netEffectiveStock - reorderPoint) / avgDailyDemand) : 90;
  const suggestedReorderDate =
    daysUntilRop <= 0
      ? referenceDateIso
      : addDaysIso(referenceDateIso, Math.min(90, daysUntilRop));

  const supplierRiskNote =
    leadTimeDays >= 28
      ? `Long ${leadTimeDays}-day mill lead time increases transit delay exposure.`
      : leadTimeDays >= 18
      ? `Standard ${leadTimeDays}-day supplier cycle; monitor dye-lot confirmation.`
      : `Short ${leadTimeDays}-day local replenishment cycle.`;

  const explanation =
    recommendedReorderQty > 0
      ? `Net effective stock (${netEffectiveStock.toLocaleString()} ${material.uom}) is below Reorder Point (${reorderPoint.toLocaleString()} ${material.uom} = ${avgDailyDemand}/day × ${leadTimeDays}d + ${safetyStock} safety). Recommend ordering ${recommendedReorderQty.toLocaleString()} ${material.uom} (requires Procurement Officer approval).`
      : `Net effective stock (${netEffectiveStock.toLocaleString()} ${material.uom}) covers ${coverageDays} days, exceeding the ${reorderPoint.toLocaleString()} ${material.uom} reorder threshold.`;

  return {
    materialId: material.id,
    sku: material.sku,
    materialName: material.name,
    availableQty: material.availableQty,
    reservedQty: material.reservedQty,
    incomingPoQty,
    bomCommittedQty,
    netEffectiveStock,
    avgDailyDemand,
    leadTimeDays,
    safetyStock,
    reorderPoint,
    coverageDays,
    estimatedStockoutDate,
    stockoutRiskLevel,
    recommendedReorderQty,
    suggestedReorderDate,
    supplierRiskNote,
    explanation,
  };
}
