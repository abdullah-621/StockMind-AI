import test from 'node:test';
import assert from 'node:assert/strict';
import { assessInventoryRisk } from './riskEngine';
import { runDemandForecast } from './forecastEngine';
import { calculateReorderRecommendation } from './reorderEngine';
import { findCompatibleMaterials } from './compatibilityEngine';
import { evaluateRecoveryOptions, simulateProductionReuse } from './recoveryEngine';
import type { MaterialRecord, MonthlyDemandPoint } from './types';

function makeMaterial(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: 1,
    sku: 'FAB-SJ-180-NVY',
    name: '100% Cotton Single Jersey 180 GSM Navy',
    categoryId: 1,
    categoryName: 'Knitted Fabrics',
    materialType: 'Single Jersey',
    composition: '100% Combed Cotton',
    color: 'Navy Blue',
    colorFamily: 'Blue',
    gsm: 180,
    widthInches: 72,
    construction: 'Single Jersey',
    qualityGrade: 'A',
    uom: 'kg',
    availableQty: 1200,
    reservedQty: 200,
    warehouseId: 1,
    warehouseCode: 'WH-DHK-01',
    warehouseName: 'Dhaka Knit Main Hub',
    supplierId: 1,
    supplierName: 'Apex Textile Mills',
    purchasePrice: 5.8,
    purchaseDate: '2026-03-01',
    lastMovementDate: '2026-11-05',
    batchNumber: 'LOT-2603-A1',
    minStockLevel: 300,
    leadTimeDays: 14,
    shelfLifeDays: null,
    seasonalPeakMonths: [10, 11, 12],
    isSynthetic: true,
    ...overrides,
  };
}

test('riskEngine does NOT blindly label inactive material as dead stock when BOM commitments exist', () => {
  const mat = makeMaterial({
    availableQty: 800,
    reservedQty: 400,
    lastMovementDate: '2026-06-15', // ~155 days inactive
    seasonalPeakMonths: [11, 12],
  });
  const result = assessInventoryRisk({
    material: mat,
    monthlyConsumptions: [150, 140, 160, 120, 90, 80, 60, 40, 30, 0, 0, 0],
    upcomingBomQty: 650,
    referenceDateIso: '2026-11-17',
  });
  assert.notEqual(result.riskCategory, 'Potential Dead Stock');
  assert.ok(result.contributions.some((c) => c.factor === 'Upcoming BOM Commitments'));
});

test('riskEngine flags genuinely stagnant overstocked material with zero BOM as Potential Dead Stock', () => {
  const mat = makeMaterial({
    availableQty: 2400,
    reservedQty: 0,
    lastMovementDate: '2026-02-10', // >270 days inactive
    qualityGrade: 'B',
    seasonalPeakMonths: [3, 4],
  });
  const result = assessInventoryRisk({
    material: mat,
    monthlyConsumptions: [220, 210, 190, 180, 140, 90, 40, 20, 10, 0, 0, 0],
    upcomingBomQty: 0,
    referenceDateIso: '2026-11-17',
  });
  assert.equal(result.riskCategory, 'Potential Dead Stock');
  assert.ok(result.riskScore >= 76);
  assert.ok(result.contributions.length > 0);
});

test('forecastEngine preserves chronological order and widens uncertainty over horizon', () => {
  const mat = makeMaterial();
  const history: MonthlyDemandPoint[] = [
    { period: '2026-01', actualQty: 300 },
    { period: '2026-02', actualQty: 320 },
    { period: '2026-03', actualQty: 310 },
    { period: '2026-04', actualQty: 340 },
    { period: '2026-05', actualQty: 360 },
    { period: '2026-06', actualQty: 350 },
    { period: '2026-07', actualQty: 380 },
    { period: '2026-08', actualQty: 400 },
    { period: '2026-09', actualQty: 410 },
    { period: '2026-10', actualQty: 430 },
  ];
  const output = runDemandForecast(mat, history, 3, undefined, 250);
  assert.equal(output.evaluations.length, 3);
  assert.ok(output.evaluations.every((e) => e.validationPeriods === 3));
  const forecasts = output.series.filter((s) => s.isForecast);
  assert.equal(forecasts.length, 3);
  const band1 = (forecasts[0].upperBound ?? 0) - (forecasts[0].lowerBound ?? 0);
  const band3 = (forecasts[2].upperBound ?? 0) - (forecasts[2].lowerBound ?? 0);
  assert.ok(band3 >= band1);
});

test('reorderEngine computes explainable ROP and reacts to lead time spikes', () => {
  const mat = makeMaterial({ availableQty: 450, reservedQty: 100, leadTimeDays: 14, minStockLevel: 200 });
  const consumptions = [300, 310, 290, 305, 300, 295]; // ~10/day
  const base = calculateReorderRecommendation(mat, consumptions, 0, 100, '2026-11-17');
  const delayed = calculateReorderRecommendation(mat, consumptions, 0, 100, '2026-11-17', {
    leadTimeDeltaDays: 14,
  });
  assert.equal(base.avgDailyDemand, 10);
  assert.equal(base.reorderPoint, Math.round(10 * 14 + base.safetyStock));
  assert.ok(delayed.reorderPoint > base.reorderPoint);
  assert.ok(delayed.recommendedReorderQty > base.recommendedReorderQty);
});

test('compatibilityEngine applies hard constraints and ranks close textile specs first', () => {
  const exactFamily = makeMaterial({
    id: 2,
    sku: 'FAB-SJ-185-ROY',
    name: '100% Cotton Single Jersey 185 GSM Royal Blue',
    color: 'Royal Blue',
    colorFamily: 'Blue',
    gsm: 185,
    widthInches: 70,
    availableQty: 900,
    reservedQty: 0,
  });
  const wrongCategory = makeMaterial({
    id: 3,
    sku: 'TRM-BTN-180',
    categoryName: 'Trims & Accessories',
    name: 'Resin Button',
    availableQty: 5000,
    reservedQty: 0,
  });
  const extremeGsm = makeMaterial({
    id: 4,
    sku: 'FAB-FLC-360-NVY',
    name: 'Heavy Fleece 360 GSM Navy',
    construction: '3-End Fleece',
    gsm: 360,
    availableQty: 900,
    reservedQty: 0,
  });

  const matches = findCompatibleMaterials(
    {
      categoryName: 'Knitted Fabrics',
      composition: '100% Combed Cotton',
      color: 'Navy Blue',
      colorFamily: 'Blue',
      gsm: 180,
      widthInches: 72,
      construction: 'Single Jersey',
      minQualityGrade: 'B',
    },
    [exactFamily, wrongCategory, extremeGsm]
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].sku, 'FAB-SJ-185-ROY');
  assert.ok(matches[0].similarityScore >= 85);
  assert.equal(matches[0].requiresQcApproval, true);
});

test('recoveryEngine evaluates all 4 strategies without double-counting and simulates What-If reuse', () => {
  const excessMat = makeMaterial({
    id: 10,
    sku: 'FAB-SJ-185-SLT',
    name: '100% Cotton Single Jersey 185 GSM Slate Blue',
    color: 'Slate Blue',
    colorFamily: 'Blue',
    gsm: 185,
    widthInches: 72,
    availableQty: 1000,
    reservedQty: 0,
    purchasePrice: 5.5,
  });
  const bomTarget = makeMaterial({
    id: 11,
    sku: 'FAB-SJ-180-NVY',
    purchasePrice: 6.0,
  });

  const plan = evaluateRecoveryOptions(
    excessMat,
    1000,
    [{ productionOrderCode: 'PO-PROD-401', styleName: 'Men Crew Tee', materialId: 11, requiredQty: 600, targetMaterial: bomTarget }],
    [{ warehouseCode: 'WH-NAR-03', warehouseName: 'Narayanganj Sewing Unit', shortageQty: 400, materialSku: excessMat.sku }]
  );

  assert.equal(plan.options.length, 4);
  assert.equal(plan.bestStrategy, 'Reuse in Production');
  const reuseOpt = plan.options.find((o) => o.strategy === 'Reuse in Production')!;
  assert.equal(reuseOpt.netRecoveryValue, Number((reuseOpt.grossEstimatedValue - reuseOpt.estimatedCosts).toFixed(2)));

  const sim = simulateProductionReuse({
    sourceMaterialId: 10,
    sourceMaterialName: excessMat.name,
    sourceUnitPrice: 5.5,
    availableExcessQty: 1000,
    requiredQty: 500,
    newPurchaseUnitPrice: 6.2,
    reprocessingCostPerUnit: 0.4,
    handlingAndTransferCost: 75,
  });
  // Avoided: 500 * 6.2 = 3100; Processing + handling: 500 * 0.4 + 75 = 275; Net: 2825
  assert.equal(sim.reusableQty, 500);
  assert.equal(sim.avoidedProcurementCost, 3100);
  assert.equal(sim.additionalProcessingAndHandlingCost, 275);
  assert.equal(sim.netEstimatedFinancialBenefit, 2825);
  assert.equal(sim.isEstimate, true);
});
