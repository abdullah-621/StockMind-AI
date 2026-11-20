import type {
  ForecastModelName,
  ForecastOutput,
  MaterialRecord,
  ModelEvaluationMetrics,
  MonthlyDemandPoint,
} from './types';

function addMonths(ym: string, offset: number): string {
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr) - 1;
  const date = new Date(Date.UTC(y, m + offset, 1));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function predictMovingAverage(history: number[], horizon: number, windowSize = 3): number[] {
  const buf = [...history];
  const preds: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const slice = buf.slice(-Math.min(windowSize, buf.length));
    const avg = slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
    const val = Math.max(0, Number(avg.toFixed(1)));
    preds.push(val);
    buf.push(val);
  }
  return preds;
}

function predictHoltExponentialSmoothing(
  history: number[],
  horizon: number,
  alpha = 0.38,
  beta = 0.14
): number[] {
  if (history.length === 0) return Array(horizon).fill(0);
  if (history.length === 1) return Array(horizon).fill(Math.max(0, history[0]));

  let level = history[0];
  let trend = history[1] - history[0];
  for (let i = 1; i < history.length; i++) {
    const prevLevel = level;
    level = alpha * history[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  const preds: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    // Dampened trend so multi-month forecasts don't explode unrealistically
    const dampedTrend = trend * Math.pow(0.85, h - 1);
    preds.push(Math.max(0, Number((level + h * dampedTrend).toFixed(1))));
  }
  return preds;
}

function predictSeasonalNaive(
  history: number[],
  horizon: number,
  seasonalPeakMonths: number[],
  lastPeriodYm: string
): number[] {
  const seasonLen = Math.min(12, history.length);
  const baseMean =
    history.length > 0 ? history.reduce((a, b) => a + b, 0) / history.length : 0;
  const preds: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const targetYm = addMonths(lastPeriodYm, h);
    const targetMonth = Number(targetYm.split('-')[1]);
    let val = baseMean;
    if (history.length >= 12) {
      val = history[history.length - 12 + ((h - 1) % seasonLen)];
    } else if (history.length > 0) {
      val = history[history.length - 1];
    }
    if (seasonalPeakMonths.includes(targetMonth)) {
      val = val * 1.15;
    }
    preds.push(Math.max(0, Number(val.toFixed(1))));
  }
  return preds;
}

function computeMetrics(
  modelName: ForecastModelName,
  actuals: number[],
  preds: number[]
): ModelEvaluationMetrics {
  const n = Math.min(actuals.length, preds.length);
  if (n === 0) {
    return { modelName, mae: 0, rmse: 0, wape: 0, validationPeriods: 0 };
  }
  let absErr = 0;
  let sqErr = 0;
  let absActual = 0;
  for (let i = 0; i < n; i++) {
    const err = actuals[i] - preds[i];
    absErr += Math.abs(err);
    sqErr += err * err;
    absActual += Math.abs(actuals[i]);
  }
  const mae = Number((absErr / n).toFixed(2));
  const rmse = Number(Math.sqrt(sqErr / n).toFixed(2));
  const wape = absActual > 0 ? Number(((absErr / absActual) * 100).toFixed(1)) : 0;
  return { modelName, mae, rmse, wape, validationPeriods: n };
}

/**
 * Chronological Demand Forecasting Engine.
 * Strictly preserves temporal order (no random shuffling / no future leakage).
 * Compares Moving Average, Holt Exponential Smoothing, and Seasonal Naive on held-out tail.
 */
export function runDemandForecast(
  material: MaterialRecord,
  history: MonthlyDemandPoint[], // sorted ascending by period
  horizonMonths = 3,
  preferredModel?: ForecastModelName,
  upcomingBomQty = 0
): ForecastOutput {
  const sorted = [...history].sort((a, b) => a.period.localeCompare(b.period));
  const values = sorted.map((p) => Number(p.actualQty ?? 0));
  const periods = sorted.map((p) => p.period);
  const lastYm = periods[periods.length - 1] ?? '2026-10';

  // Chronological train / validation split (hold out last 3 periods if >= 8 periods exist)
  const valCount = values.length >= 8 ? 3 : values.length >= 5 ? 2 : 1;
  const splitIdx = Math.max(1, values.length - valCount);
  const trainValues = values.slice(0, splitIdx);
  const valActuals = values.slice(splitIdx);
  const trainLastYm = periods[splitIdx - 1] ?? lastYm;

  const valMa = predictMovingAverage(trainValues, valActuals.length);
  const valHolt = predictHoltExponentialSmoothing(trainValues, valActuals.length);
  const valNaive = predictSeasonalNaive(
    trainValues,
    valActuals.length,
    material.seasonalPeakMonths,
    trainLastYm
  );

  const evaluations: ModelEvaluationMetrics[] = [
    computeMetrics('Moving Average', valActuals, valMa),
    computeMetrics('Holt Exponential Smoothing', valActuals, valHolt),
    computeMetrics('Seasonal Naive', valActuals, valNaive),
  ];

  // Pick lowest WAPE (tie-break by RMSE) unless user explicitly chose a model
  const bestByWape = [...evaluations].sort((a, b) => a.wape - b.wape || a.rmse - b.rmse)[0];
  const selectedModel = preferredModel ?? bestByWape.modelName;

  // Compute future predictions from full chronological history
  let futurePreds: number[];
  if (selectedModel === 'Moving Average') {
    futurePreds = predictMovingAverage(values, horizonMonths);
  } else if (selectedModel === 'Seasonal Naive') {
    futurePreds = predictSeasonalNaive(values, horizonMonths, material.seasonalPeakMonths, lastYm);
  } else {
    futurePreds = predictHoltExponentialSmoothing(values, horizonMonths);
  }

  // Empirical residual standard error from selected model's held-out validation
  const selectedEval = evaluations.find((e) => e.modelName === selectedModel) ?? evaluations[0];
  const residualScale = Math.max(selectedEval.rmse, (values[values.length - 1] ?? 10) * 0.08);

  // Also backfill in-sample validation fitted line for visual actual-vs-predicted comparison
  const valPredMap = new Map<string, number>();
  const selectedValPreds =
    selectedModel === 'Moving Average'
      ? valMa
      : selectedModel === 'Seasonal Naive'
      ? valNaive
      : valHolt;
  for (let i = 0; i < valActuals.length; i++) {
    valPredMap.set(periods[splitIdx + i], selectedValPreds[i]);
  }

  const series: MonthlyDemandPoint[] = sorted.map((pt, idx) => ({
    period: pt.period,
    actualQty: pt.actualQty,
    isForecast: false,
    forecastQty: valPredMap.has(pt.period)
      ? valPredMap.get(pt.period)
      : idx === sorted.length - 1
      ? Number(pt.actualQty ?? 0)
      : undefined,
  }));

  for (let h = 1; h <= horizonMonths; h++) {
    const period = addMonths(lastYm, h);
    const pointVal = futurePreds[h - 1] ?? 0;
    const band = Number((1.65 * residualScale * Math.sqrt(h)).toFixed(1));
    series.push({
      period,
      actualQty: null,
      isForecast: true,
      forecastQty: pointVal,
      lowerBound: Math.max(0, Number((pointVal - band).toFixed(1))),
      upperBound: Number((pointVal + band).toFixed(1)),
    });
  }

  const recent3Avg =
    values.slice(-3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, values.length));
  const prior3Avg =
    values.slice(-6, -3).reduce((a, b) => a + b, 0) /
    Math.max(1, values.slice(-6, -3).length || 1);
  const trendPct =
    prior3Avg > 0 ? Number((((recent3Avg - prior3Avg) / prior3Avg) * 100).toFixed(1)) : 0;

  const influentialFactors = [
    {
      factor: 'Recent 3-Month Consumption Momentum',
      weightLabel: `${trendPct >= 0 ? '+' : ''}${trendPct}% vs prior quarter`,
      description: `Trailing 3-month average is ${recent3Avg.toFixed(1)} ${material.uom}/mo.`,
    },
    {
      factor: 'Active Production Order BOMs',
      weightLabel: `${upcomingBomQty.toLocaleString()} ${material.uom} scheduled`,
      description:
        upcomingBomQty > 0
          ? `Confirmed production commitments anchor near-term drawdowns.`
          : `No active production BOM drawdowns currently scheduled.`,
    },
    {
      factor: 'Seasonal Textile Window',
      weightLabel: material.seasonalPeakMonths.length
        ? `Peak months: ${material.seasonalPeakMonths.join(', ')}`
        : 'Flat year-round',
      description: `Category ${material.categoryName} seasonal demand profile.`,
    },
    {
      factor: 'Supplier Lead Time Exposure',
      weightLabel: `${material.leadTimeDays} days`,
      description: `Procurement replenishment buffer required for ${material.supplierName}.`,
    },
  ];

  return {
    materialId: material.id,
    sku: material.sku,
    materialName: material.name,
    selectedModel,
    evaluations,
    series,
    nextPeriodForecast: futurePreds[0] ?? 0,
    totalHorizonForecast: Number(futurePreds.reduce((a, b) => a + b, 0).toFixed(1)),
    influentialFactors,
    splitSummary: `Chronological split: ${trainValues.length} training months -> ${valActuals.length} held-out validation months (no random shuffling).`,
    modelVersion: 'forecast-ts-v1.1',
  };
}
