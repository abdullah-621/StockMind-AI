export type UserRole =
  | 'Admin'
  | 'Inventory Manager'
  | 'Procurement Officer'
  | 'Warehouse Manager'
  | 'Production Planner';

export type RiskCategory =
  | 'Healthy Stock'
  | 'Slow-Moving Stock'
  | 'Excess Stock'
  | 'Potential Dead Stock'
  | 'Critical Overstock'
  | 'At-Risk Inventory';

export type RecoveryStrategyType =
  | 'Reuse in Production'
  | 'Inter-Warehouse Transfer'
  | 'Resale / Liquidation'
  | 'Recycling';

export type ApprovalStatus =
  | 'Pending Review'
  | 'Approved'
  | 'Rejected'
  | 'Modified'
  | 'Executed';

export interface MaterialRecord {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  categoryName: string;
  materialType: string;
  composition: string;
  color: string;
  colorFamily: string;
  gsm: number;
  widthInches: number;
  construction: string;
  qualityGrade: 'A' | 'B' | 'C';
  uom: 'kg' | 'meters' | 'cones' | 'pcs';
  availableQty: number;
  reservedQty: number;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  supplierId: number;
  supplierName: string;
  purchasePrice: number;
  purchaseDate: string;
  lastMovementDate: string;
  batchNumber: string;
  minStockLevel: number;
  leadTimeDays: number;
  shelfLifeDays: number | null;
  seasonalPeakMonths: number[];
  isSynthetic: boolean;
}

export interface RiskFactorContribution {
  factor: string;
  impactPoints: number;
  detail: string;
  direction: 'increases_risk' | 'reduces_risk';
}

export interface RiskAssessmentResult {
  materialId: number;
  sku: string;
  materialName: string;
  riskCategory: RiskCategory;
  riskScore: number;
  baselineMethod: 'Rule-Based + Statistical Anomaly';
  daysSinceLastMovement: number;
  avgMonthlyDemand: number;
  turnoverRatio: number;
  monthsOfSupply: number;
  upcomingBomQty: number;
  anomalyZScore: number;
  isConsumptionAnomaly: boolean;
  contributions: RiskFactorContribution[];
  explanation: string;
  recommendedAction: string;
  inventoryValue: number;
  modelVersion: string;
}

export interface MonthlyDemandPoint {
  period: string; // YYYY-MM
  actualQty: number | null;
  isForecast?: boolean;
  forecastQty?: number;
  lowerBound?: number;
  upperBound?: number;
}

export type ForecastModelName = 'Moving Average' | 'Holt Exponential Smoothing' | 'Seasonal Naive';

export interface ModelEvaluationMetrics {
  modelName: ForecastModelName;
  mae: number;
  rmse: number;
  wape: number; // %
  validationPeriods: number;
}

export interface ForecastOutput {
  materialId: number;
  sku: string;
  materialName: string;
  selectedModel: ForecastModelName;
  evaluations: ModelEvaluationMetrics[];
  series: MonthlyDemandPoint[];
  nextPeriodForecast: number;
  totalHorizonForecast: number;
  influentialFactors: Array<{ factor: string; weightLabel: string; description: string }>;
  splitSummary: string;
  modelVersion: string;
}

export interface ReorderRecommendationResult {
  materialId: number;
  sku: string;
  materialName: string;
  availableQty: number;
  reservedQty: number;
  incomingPoQty: number;
  bomCommittedQty: number;
  netEffectiveStock: number;
  avgDailyDemand: number;
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
  coverageDays: number;
  estimatedStockoutDate: string | null;
  stockoutRiskLevel: 'Critical' | 'High' | 'Moderate' | 'Low';
  recommendedReorderQty: number;
  suggestedReorderDate: string;
  supplierRiskNote: string;
  explanation: string;
}

export interface MaterialSpecQuery {
  targetMaterialId?: number;
  categoryName: string;
  composition: string;
  color: string;
  colorFamily: string;
  gsm: number;
  widthInches: number;
  construction: string;
  minQualityGrade?: 'A' | 'B' | 'C';
  strictComposition?: boolean;
  requiredQty?: number;
}

export interface CompatibilityCandidate {
  materialId: number;
  sku: string;
  materialName: string;
  warehouseCode: string;
  warehouseName: string;
  availableQty: number;
  uom: string;
  unitPrice: number;
  similarityScore: number; // 0-100
  knnDistance: number;
  matchingAttributes: string[];
  attributeDifferences: string[];
  explanation: string;
  potentialUseCase: string;
  requiresQcApproval: true;
  qcNote: string;
}

export interface RecoveryOptionEvaluation {
  strategy: RecoveryStrategyType;
  feasible: boolean;
  feasibilityReason: string;
  recoverableQty: number;
  grossEstimatedValue: number;
  estimatedCosts: number;
  netRecoveryValue: number;
  valueType: 'Avoided Procurement Cost' | 'Recovery Revenue' | 'None';
  assumptions: string[];
  targetReference: string | null;
}

export interface RecoveryPlanResult {
  materialId: number;
  sku: string;
  materialName: string;
  excessOrRiskQty: number;
  bookValue: number;
  bestStrategy: RecoveryStrategyType;
  estimatedNetRecoveryValue: number;
  options: RecoveryOptionEvaluation[];
  explanation: string;
}

export interface WhatIfReuseInput {
  sourceMaterialId: number;
  sourceMaterialName: string;
  sourceUnitPrice: number;
  availableExcessQty: number;
  requiredQty: number;
  newPurchaseUnitPrice: number;
  reprocessingCostPerUnit: number;
  handlingAndTransferCost: number;
}

export interface WhatIfReuseResult {
  reusableQty: number;
  remainingNewPurchaseQty: number;
  avoidedProcurementCost: number;
  additionalProcessingAndHandlingCost: number;
  newPurchaseRemainingCost: number;
  netEstimatedFinancialBenefit: number;
  workingCapitalFreed: number;
  assumptions: string[];
  isEstimate: true;
}
