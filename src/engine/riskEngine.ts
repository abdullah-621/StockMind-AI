import type {
  MaterialRecord,
  RiskAssessmentResult,
  RiskCategory,
  RiskFactorContribution,
} from './types';

export interface RiskInputContext {
  material: MaterialRecord;
  monthlyConsumptions: number[]; // chronological oldest -> newest (e.g. last 12 months)
  upcomingBomQty: number;
  referenceDateIso: string; // YYYY-MM-DD
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Multi-factor Dead Stock & Slow-Moving Inventory Risk Assessment.
 * Combines transparent rule-based heuristics with statistical consumption anomaly Z-score.
 * Explicitly avoids classifying dead stock purely by days-since-last-movement.
 */
export function assessInventoryRisk(ctx: RiskInputContext): RiskAssessmentResult {
  const { material, monthlyConsumptions, upcomingBomQty, referenceDateIso } = ctx;
  const daysSinceLastMovement = daysBetween(material.lastMovementDate, referenceDateIso);
  const freeQty = Math.max(0, material.availableQty - material.reservedQty);
  const inventoryValue = Number((material.availableQty * material.purchasePrice).toFixed(2));

  const recent3 = monthlyConsumptions.slice(-3);
  const priorMonths = monthlyConsumptions.slice(0, Math.max(1, monthlyConsumptions.length - 3));
  const avgMonthlyDemand = Number(mean(monthlyConsumptions).toFixed(2));
  const recentAvgDemand = mean(recent3);
  const priorAvgDemand = mean(priorMonths);
  const priorStd = stdDev(priorMonths);

  // Statistical anomaly Z-score: negative Z indicates unusual drop in recent consumption
  const anomalyZScore =
    priorStd > 0.01
      ? Number(((recentAvgDemand - priorAvgDemand) / priorStd).toFixed(2))
      : recentAvgDemand < priorAvgDemand * 0.5 && priorAvgDemand > 0
      ? -2.1
      : 0;
  const isConsumptionAnomaly = anomalyZScore <= -1.5;

  const annualizedDemand = avgMonthlyDemand * 12;
  const turnoverRatio =
    material.availableQty > 0
      ? Number((annualizedDemand / material.availableQty).toFixed(2))
      : 0;

  const effectiveMonthlyDemand = Math.max(recentAvgDemand, avgMonthlyDemand);
  const monthsOfSupply =
    effectiveMonthlyDemand > 0
      ? Number((freeQty / effectiveMonthlyDemand).toFixed(1))
      : freeQty > 0
      ? 36
      : 0;

  const refMonth = new Date(referenceDateIso).getUTCMonth() + 1;
  const isPeakSeasonApproaching =
    material.seasonalPeakMonths.includes(refMonth) ||
    material.seasonalPeakMonths.includes((refMonth % 12) + 1) ||
    material.seasonalPeakMonths.includes(((refMonth + 1) % 12) + 1);

  const contributions: RiskFactorContribution[] = [];
  let score = 20; // Baseline neutral score

  // 1. Movement stagnation vs category norms
  if (daysSinceLastMovement >= 150) {
    const pts = 28;
    score += pts;
    contributions.push({
      factor: 'Extended Inactivity',
      impactPoints: pts,
      detail: `${daysSinceLastMovement} days since last stock movement`,
      direction: 'increases_risk',
    });
  } else if (daysSinceLastMovement >= 90) {
    const pts = 18;
    score += pts;
    contributions.push({
      factor: 'Aging Movement Window',
      impactPoints: pts,
      detail: `${daysSinceLastMovement} days without outward movement`,
      direction: 'increases_risk',
    });
  } else if (daysSinceLastMovement >= 45) {
    const pts = 8;
    score += pts;
    contributions.push({
      factor: 'Moderate Movement Lag',
      impactPoints: pts,
      detail: `${daysSinceLastMovement} days since last movement`,
      direction: 'increases_risk',
    });
  } else {
    const pts = -10;
    score += pts;
    contributions.push({
      factor: 'Active Warehouse Velocity',
      impactPoints: pts,
      detail: `Recent movement ${daysSinceLastMovement} days ago`,
      direction: 'reduces_risk',
    });
  }

  // 2. Months of supply & inventory turnover
  if (monthsOfSupply >= 12) {
    const pts = 24;
    score += pts;
    contributions.push({
      factor: 'Severe Excess Coverage',
      impactPoints: pts,
      detail: `${monthsOfSupply} months of unreserved supply (turnover ${turnoverRatio}x/yr)`,
      direction: 'increases_risk',
    });
  } else if (monthsOfSupply >= 6) {
    const pts = 14;
    score += pts;
    contributions.push({
      factor: 'Elevated Stock Coverage',
      impactPoints: pts,
      detail: `${monthsOfSupply} months of supply vs 1–3 mo target`,
      direction: 'increases_risk',
    });
  } else if (turnoverRatio >= 4) {
    const pts = -8;
    score += pts;
    contributions.push({
      factor: 'Healthy Inventory Turnover',
      impactPoints: pts,
      detail: `Annualized turnover of ${turnoverRatio}x`,
      direction: 'reduces_risk',
    });
  }

  // 3. Consumption Anomaly Detection
  if (isConsumptionAnomaly) {
    const pts = 14;
    score += pts;
    contributions.push({
      factor: 'Demand Drop Anomaly',
      impactPoints: pts,
      detail: `Recent consumption Z-score ${anomalyZScore} vs historical baseline`,
      direction: 'increases_risk',
    });
  }

  // 4. Upcoming Production Order / BOM Commitments (Crucial safeguard against false dead-stock flags!)
  if (upcomingBomQty > 0) {
    const coverageRatio = Math.min(1, upcomingBomQty / Math.max(1, material.availableQty));
    const pts = -Math.round(12 + coverageRatio * 14);
    score += pts;
    contributions.push({
      factor: 'Upcoming BOM Commitments',
      impactPoints: pts,
      detail: `${upcomingBomQty.toLocaleString()} ${material.uom} committed to active production orders`,
      direction: 'reduces_risk',
    });
  }

  // 5. Reserved Stock Protection
  if (material.reservedQty > 0) {
    const reservedShare = material.reservedQty / Math.max(1, material.availableQty);
    if (reservedShare >= 0.35) {
      const pts = -10;
      score += pts;
      contributions.push({
        factor: 'Reserved Production Allocation',
        impactPoints: pts,
        detail: `${Math.round(reservedShare * 100)}% of stock is reserved for orders`,
        direction: 'reduces_risk',
      });
    }
  }

  // 6. Seasonal Demand Guardrail
  if (isPeakSeasonApproaching) {
    const pts = -12;
    score += pts;
    contributions.push({
      factor: 'Approaching Peak Season',
      impactPoints: pts,
      detail: `Material enters peak seasonal window within 60 days`,
      direction: 'reduces_risk',
    });
  }

  // 7. Quality Grade / Shelf-life constraint
  if (material.qualityGrade === 'C') {
    const pts = 12;
    score += pts;
    contributions.push({
      factor: 'Sub-Standard Quality Grade',
      impactPoints: pts,
      detail: `Grade C lot faces restricted customer order eligibility`,
      direction: 'increases_risk',
    });
  } else if (material.qualityGrade === 'B') {
    const pts = 5;
    score += pts;
    contributions.push({
      factor: 'Secondary Quality Grade',
      impactPoints: pts,
      detail: `Grade B stock may require shade or defect allowance`,
      direction: 'increases_risk',
    });
  }

  if (material.shelfLifeDays !== null) {
    const ageDays = daysBetween(material.purchaseDate, referenceDateIso);
    if (ageDays >= material.shelfLifeDays * 0.75) {
      const pts = 14;
      score += pts;
      contributions.push({
        factor: 'Shelf-Life Proximity',
        impactPoints: pts,
        detail: `Lot age ${ageDays}d approaching ${material.shelfLifeDays}d shelf-life limit`,
        direction: 'increases_risk',
      });
    }
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  // Classification logic combining score, BOM commitments, and supply coverage
  let riskCategory: RiskCategory = 'Healthy Stock';
  if (material.availableQty <= material.minStockLevel && upcomingBomQty > freeQty) {
    riskCategory = 'At-Risk Inventory';
  } else if (clampedScore >= 76 && upcomingBomQty === 0 && !isPeakSeasonApproaching) {
    riskCategory = 'Potential Dead Stock';
  } else if (clampedScore >= 68 && monthsOfSupply >= 10) {
    riskCategory = 'Critical Overstock';
  } else if (clampedScore >= 52 && monthsOfSupply >= 5) {
    riskCategory = 'Excess Stock';
  } else if (clampedScore >= 34) {
    riskCategory = 'Slow-Moving Stock';
  } else {
    riskCategory = 'Healthy Stock';
  }

  // Sort contributions by absolute impact for clean SHAP-style explainability
  const sortedContributions = [...contributions].sort(
    (a, b) => Math.abs(b.impactPoints) - Math.abs(a.impactPoints)
  );

  const topPositive = sortedContributions
    .filter((c) => c.direction === 'increases_risk')
    .slice(0, 2)
    .map((c) => c.detail);
  const topMitigating = sortedContributions
    .filter((c) => c.direction === 'reduces_risk')
    .slice(0, 1)
    .map((c) => c.detail);

  let explanation = '';
  if (riskCategory === 'Potential Dead Stock' || riskCategory === 'Critical Overstock') {
    explanation = `Flagged as ${riskCategory} (score ${clampedScore}/100): ${topPositive.join('; ') || 'prolonged low velocity'}. No mitigating upcoming BOM demand or peak season offset detected.`;
  } else if (riskCategory === 'Slow-Moving Stock' || riskCategory === 'Excess Stock') {
    explanation = `Classified as ${riskCategory} (score ${clampedScore}/100): ${topPositive.join('; ') || 'elevated supply coverage'}${topMitigating.length ? `, partially offset by ${topMitigating[0]}` : ''}.`;
  } else if (riskCategory === 'At-Risk Inventory') {
    explanation = `Stockout / BOM shortage exposure: available free quantity (${freeQty} ${material.uom}) is below upcoming commitments (${upcomingBomQty} ${material.uom}) and safety threshold.`;
  } else {
    explanation = `Healthy turnover (${turnoverRatio}x/yr) with ${topMitigating[0] || 'balanced stock-to-demand alignment'}.`;
  }

  let recommendedAction = 'Maintain standard replenishment cadence.';
  if (riskCategory === 'Potential Dead Stock') {
    recommendedAction = 'Evaluate Material Compatibility reuse in open BOMs, or initiate Dead Stock Recovery workflow (Transfer / Liquidation).';
  } else if (riskCategory === 'Critical Overstock') {
    recommendedAction = 'Freeze new POs immediately; run Inter-Warehouse Transfer or Production Substitution evaluation.';
  } else if (riskCategory === 'Excess Stock') {
    recommendedAction = 'Pause reorder schedule and prioritize allocation to compatible upcoming styles.';
  } else if (riskCategory === 'Slow-Moving Stock') {
    recommendedAction = 'Monitor consumption over next 30 days; verify seasonal demand calendar before discounting.';
  } else if (riskCategory === 'At-Risk Inventory') {
    recommendedAction = 'Review Reorder Recommendation and check compatible substitute stock in secondary warehouses.';
  }

  return {
    materialId: material.id,
    sku: material.sku,
    materialName: material.name,
    riskCategory,
    riskScore: clampedScore,
    baselineMethod: 'Rule-Based + Statistical Anomaly',
    daysSinceLastMovement,
    avgMonthlyDemand,
    turnoverRatio,
    monthsOfSupply,
    upcomingBomQty,
    anomalyZScore,
    isConsumptionAnomaly,
    contributions: sortedContributions,
    explanation,
    recommendedAction,
    inventoryValue,
    modelVersion: 'risk-baseline-v1.2',
  };
}
