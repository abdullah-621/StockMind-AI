import { findCompatibleMaterials } from './compatibilityEngine';
import type {
  MaterialRecord,
  RecoveryOptionEvaluation,
  RecoveryPlanResult,
  WhatIfReuseInput,
  WhatIfReuseResult,
} from './types';

export interface OpenBomNeed {
  productionOrderCode: string;
  styleName: string;
  materialId: number;
  requiredQty: number;
  targetMaterial: MaterialRecord;
}

export interface WarehouseShortageNeed {
  warehouseCode: string;
  warehouseName: string;
  shortageQty: number;
  materialSku: string;
}

/**
 * Dead Stock Recovery Engine.
 * Evaluates 4 mutually-exclusive recovery strategies without double-counting:
 *   A. Reuse in Production (avoided procurement cost)
 *   B. Inter-Warehouse Transfer (avoided procurement cost minus freight)
 *   C. Resale / Liquidation (market recovery revenue minus brokerage/logistics)
 *   D. Recycling (fiber yield revenue minus shredding/processing cost)
 */
export function evaluateRecoveryOptions(
  material: MaterialRecord,
  excessOrRiskQty: number,
  openBoms: OpenBomNeed[],
  shortageWarehouses: WarehouseShortageNeed[]
): RecoveryPlanResult {
  const qty = Math.max(0, Number(excessOrRiskQty.toFixed(1)));
  const bookValue = Number((qty * material.purchasePrice).toFixed(2));
  const options: RecoveryOptionEvaluation[] = [];

  // A. Reuse in Production
  let bestBomMatch: { bom: OpenBomNeed; score: number } | null = null;
  for (const bom of openBoms) {
    if (bom.targetMaterial.id === material.id) {
      bestBomMatch = { bom, score: 100 };
      break;
    }
    const matches = findCompatibleMaterials(
      {
        targetMaterialId: bom.targetMaterial.id,
        categoryName: bom.targetMaterial.categoryName,
        composition: bom.targetMaterial.composition,
        color: bom.targetMaterial.color,
        colorFamily: bom.targetMaterial.colorFamily,
        gsm: bom.targetMaterial.gsm,
        widthInches: bom.targetMaterial.widthInches,
        construction: bom.targetMaterial.construction,
        minQualityGrade: 'B',
      },
      [material],
      1
    );
    if (matches.length > 0 && matches[0].similarityScore >= 70) {
      if (!bestBomMatch || matches[0].similarityScore > bestBomMatch.score) {
        bestBomMatch = { bom, score: matches[0].similarityScore };
      }
    }
  }

  if (bestBomMatch && material.qualityGrade !== 'C' && qty > 0) {
    const reusableQty = Math.min(qty, bestBomMatch.bom.requiredQty);
    const grossAvoided = Number(
      (reusableQty * bestBomMatch.bom.targetMaterial.purchasePrice).toFixed(2)
    );
    // Lab dip / finishing / marker re-layout handling cost (~8% if substitute, ~2% if exact)
    const processingRate = bestBomMatch.score === 100 ? 0.02 : 0.08;
    const estCost = Number((grossAvoided * processingRate).toFixed(2));
    const netVal = Number((grossAvoided - estCost).toFixed(2));
    options.push({
      strategy: 'Reuse in Production',
      feasible: true,
      feasibilityReason: `Compatible (${bestBomMatch.score}% match) with Production Order ${bestBomMatch.bom.productionOrderCode} (${bestBomMatch.bom.styleName}).`,
      recoverableQty: reusableQty,
      grossEstimatedValue: grossAvoided,
      estimatedCosts: estCost,
      netRecoveryValue: netVal,
      valueType: 'Avoided Procurement Cost',
      assumptions: [
        `Avoided purchase valued at $${bestBomMatch.bom.targetMaterial.purchasePrice.toFixed(2)}/${material.uom} for ${reusableQty} ${material.uom}`,
        `Estimated QC testing, re-spotting & handling allowance: ${(processingRate * 100).toFixed(0)}% ($${estCost.toFixed(2)})`,
        `Requires Production & QC technical sign-off before floor issue`,
      ],
      targetReference: bestBomMatch.bom.productionOrderCode,
    });
  } else {
    options.push({
      strategy: 'Reuse in Production',
      feasible: false,
      feasibilityReason:
        material.qualityGrade === 'C'
          ? 'Grade C lot does not meet open production BOM quality floor.'
          : 'No open production BOM matches material specs >= 70% similarity.',
      recoverableQty: 0,
      grossEstimatedValue: 0,
      estimatedCosts: 0,
      netRecoveryValue: 0,
      valueType: 'None',
      assumptions: ['Checked all active production order BOM specifications.'],
      targetReference: null,
    });
  }

  // B. Inter-Warehouse Transfer
  const matchingShortage = shortageWarehouses.find(
    (s) => s.warehouseCode !== material.warehouseCode && s.shortageQty > 0
  );
  if (matchingShortage && material.qualityGrade !== 'C' && qty > 0) {
    const transferQty = Math.min(qty, matchingShortage.shortageQty);
    const grossAvoided = Number((transferQty * material.purchasePrice).toFixed(2));
    const freightAndHandling = Number((transferQty * 0.18 + 35).toFixed(2));
    const netVal = Math.max(0, Number((grossAvoided - freightAndHandling).toFixed(2)));
    options.push({
      strategy: 'Inter-Warehouse Transfer',
      feasible: true,
      feasibilityReason: `${matchingShortage.warehouseCode} (${matchingShortage.warehouseName}) has a ${matchingShortage.shortageQty} ${material.uom} shortfall.`,
      recoverableQty: transferQty,
      grossEstimatedValue: grossAvoided,
      estimatedCosts: freightAndHandling,
      netRecoveryValue: netVal,
      valueType: 'Avoided Procurement Cost',
      assumptions: [
        `Avoided external procurement at book rate $${material.purchasePrice.toFixed(2)}/${material.uom}`,
        `Inter-unit freight & warehouse re-binning estimated at $0.18/${material.uom} + $35 dispatch fee`,
      ],
      targetReference: matchingShortage.warehouseCode,
    });
  } else {
    options.push({
      strategy: 'Inter-Warehouse Transfer',
      feasible: false,
      feasibilityReason: 'No sibling warehouse currently reports an active shortage for this SKU.',
      recoverableQty: 0,
      grossEstimatedValue: 0,
      estimatedCosts: 0,
      netRecoveryValue: 0,
      valueType: 'None',
      assumptions: ['Evaluated net stock balances across all active factory warehouses.'],
      targetReference: null,
    });
  }

  // C. Resale / Liquidation
  if (qty > 0) {
    const marketRealizationPct =
      material.qualityGrade === 'A' ? 0.58 : material.qualityGrade === 'B' ? 0.4 : 0.22;
    const grossResale = Number((bookValue * marketRealizationPct).toFixed(2));
    const brokerageAndFreight = Number((grossResale * 0.12 + 40).toFixed(2));
    const netVal = Math.max(0, Number((grossResale - brokerageAndFreight).toFixed(2)));
    options.push({
      strategy: 'Resale / Liquidation',
      feasible: netVal > 0,
      feasibilityReason: `Secondary textile stocklot liquidation eligible (Grade ${material.qualityGrade} market yield ~${Math.round(marketRealizationPct * 100)}%).`,
      recoverableQty: qty,
      grossEstimatedValue: grossResale,
      estimatedCosts: brokerageAndFreight,
      netRecoveryValue: netVal,
      valueType: 'Recovery Revenue',
      assumptions: [
        `Secondary buyer yield assumed at ${Math.round(marketRealizationPct * 100)}% of $${bookValue.toFixed(2)} book value`,
        `Brokerage & local haulage cost: 12% of gross + $40 flat loading fee`,
        `Estimate only — actual realization depends on buyer lot inspection`,
      ],
      targetReference: 'Stocklot Secondary Market',
    });
  }

  // D. Recycling
  if (qty > 0) {
    const recycleRatePerUnit = material.composition.toLowerCase().includes('cotton') ? 0.55 : 0.32;
    const grossRecycle = Number((qty * recycleRatePerUnit).toFixed(2));
    const sortingAndTransport = Number((qty * 0.14 + 25).toFixed(2));
    const netVal = Number((grossRecycle - sortingAndTransport).toFixed(2));
    options.push({
      strategy: 'Recycling',
      feasible: true,
      feasibilityReason: `Mechanical fiber shredding / textile recycling channel available.`,
      recoverableQty: qty,
      grossEstimatedValue: grossRecycle,
      estimatedCosts: sortingAndTransport,
      netRecoveryValue: netVal,
      valueType: 'Recovery Revenue',
      assumptions: [
        `Recycler fiber payout assumed at $${recycleRatePerUnit.toFixed(2)}/${material.uom}`,
        `Sorting, baling & transport cost: $0.14/${material.uom} + $25 manifest fee`,
      ],
      targetReference: 'Certified Fiber Recycler',
    });
  }

  const ranked = [...options].sort((a, b) => b.netRecoveryValue - a.netRecoveryValue);
  const top = ranked[0];

  return {
    materialId: material.id,
    sku: material.sku,
    materialName: material.name,
    excessOrRiskQty: qty,
    bookValue,
    bestStrategy: top.strategy,
    estimatedNetRecoveryValue: top.netRecoveryValue,
    options: ranked,
    explanation: `Recommended "${top.strategy}" (${top.valueType}) with estimated net recovery of $${top.netRecoveryValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} across ${top.recoverableQty.toLocaleString()} ${material.uom}. Note: Strategies are evaluated independently to prevent double-counting reuse savings and resale revenue.`,
  };
}

/**
 * Interactive Financial What-If Simulator for Production Material Reuse.
 * Example: "What happens if we reuse 500 kg of suitable excess fabric instead of purchasing new material?"
 */
export function simulateProductionReuse(input: WhatIfReuseInput): WhatIfReuseResult {
  const reusableQty = Math.max(0, Math.min(input.availableExcessQty, input.requiredQty));
  const remainingNewPurchaseQty = Math.max(0, input.requiredQty - reusableQty);

  const avoidedProcurementCost = Number(
    (reusableQty * input.newPurchaseUnitPrice).toFixed(2)
  );
  const additionalProcessingAndHandlingCost = Number(
    (reusableQty * input.reprocessingCostPerUnit + input.handlingAndTransferCost).toFixed(2)
  );
  const newPurchaseRemainingCost = Number(
    (remainingNewPurchaseQty * input.newPurchaseUnitPrice).toFixed(2)
  );
  const netEstimatedFinancialBenefit = Number(
    (avoidedProcurementCost - additionalProcessingAndHandlingCost).toFixed(2)
  );
  const workingCapitalFreed = Number((reusableQty * input.sourceUnitPrice).toFixed(2));

  return {
    reusableQty,
    remainingNewPurchaseQty,
    avoidedProcurementCost,
    additionalProcessingAndHandlingCost,
    newPurchaseRemainingCost,
    netEstimatedFinancialBenefit,
    workingCapitalFreed,
    assumptions: [
      `Reusing ${reusableQty.toLocaleString()} units from ${input.sourceMaterialName} avoids purchasing at $${input.newPurchaseUnitPrice.toFixed(2)}/unit`,
      `Processing/finishing allowance: $${input.reprocessingCostPerUnit.toFixed(2)}/unit + $${input.handlingAndTransferCost.toFixed(2)} fixed handling/transfer`,
      `Frees $${workingCapitalFreed.toLocaleString()} in blocked inventory book value (valued at $${input.sourceUnitPrice.toFixed(2)}/unit)`,
      `Illustrative estimate requiring Production & QC confirmation; not yet realized cash flow`,
    ],
    isEstimate: true,
  };
}
