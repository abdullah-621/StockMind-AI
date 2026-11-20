import type {
  CompatibilityCandidate,
  MaterialRecord,
  MaterialSpecQuery,
} from './types';

function tokenizeComposition(comp: string): Set<string> {
  const cleaned = comp
    .toLowerCase()
    .replace(/\d+%/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(cleaned);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

const QUALITY_RANK: Record<'A' | 'B' | 'C', number> = { A: 3, B: 2, C: 1 };

/**
 * Material Compatibility Intelligence Engine.
 * Stage 1: Hard constraints eliminate unsuitable materials (category mismatch, zero free stock, quality floor).
 * Stage 2: Normalized weighted feature scoring & KNN Euclidean distance across textile specs.
 * Always flags candidates as requiring Production / Technical / QC approval.
 */
export function findCompatibleMaterials(
  query: MaterialSpecQuery,
  inventory: MaterialRecord[],
  topK = 8
): CompatibilityCandidate[] {
  const targetTokens = tokenizeComposition(query.composition);
  const minRank = QUALITY_RANK[query.minQualityGrade ?? 'B'];
  const candidates: CompatibilityCandidate[] = [];

  for (const mat of inventory) {
    if (query.targetMaterialId && mat.id === query.targetMaterialId) continue;

    // Hard constraint 1: Must belong to compatible category (e.g., Knitted Fabric <-> Knitted Fabric)
    if (
      query.categoryName &&
      mat.categoryName.toLowerCase() !== query.categoryName.toLowerCase()
    ) {
      continue;
    }

    // Hard constraint 2: Must have unreserved available stock
    const freeQty = Math.max(0, mat.availableQty - mat.reservedQty);
    if (freeQty <= 0) continue;

    // Hard constraint 3: Quality grade floor
    if (QUALITY_RANK[mat.qualityGrade] < minRank) continue;

    // Hard constraint 4: Extreme GSM or Width incompatibility (> 35% GSM drift or > 20" width deficit)
    if (query.gsm > 0 && mat.gsm > 0) {
      const gsmPctDiff = Math.abs(mat.gsm - query.gsm) / query.gsm;
      if (gsmPctDiff > 0.35) continue;
    }
    if (query.widthInches > 0 && mat.widthInches > 0) {
      if (mat.widthInches < query.widthInches - 14) continue;
    }

    const matTokens = tokenizeComposition(mat.composition);
    const compSim = jaccardSimilarity(targetTokens, matTokens);
    if (query.strictComposition && compSim < 0.85) continue;

    // Normalized feature similarities (0..1, where 1 = exact match)
    const gsmSim =
      query.gsm > 0 && mat.gsm > 0
        ? Math.max(0, 1 - Math.abs(mat.gsm - query.gsm) / (query.gsm * 0.35))
        : 1;

    const widthSim =
      query.widthInches > 0 && mat.widthInches > 0
        ? Math.max(0, 1 - Math.abs(mat.widthInches - query.widthInches) / 18)
        : 1;

    const constructionSim =
      mat.construction.toLowerCase() === query.construction.toLowerCase()
        ? 1
        : mat.construction.toLowerCase().includes(query.construction.toLowerCase()) ||
          query.construction.toLowerCase().includes(mat.construction.toLowerCase())
        ? 0.72
        : 0.2;

    const colorExact = mat.color.toLowerCase() === query.color.toLowerCase();
    const colorFamilyMatch =
      mat.colorFamily.toLowerCase() === query.colorFamily.toLowerCase();
    const colorSim = colorExact ? 1 : colorFamilyMatch ? 0.65 : 0.25;

    // Weighted similarity score
    const weights = {
      composition: 0.32,
      construction: 0.24,
      gsm: 0.2,
      width: 0.12,
      color: 0.12,
    };

    const weightedSim =
      compSim * weights.composition +
      constructionSim * weights.construction +
      gsmSim * weights.gsm +
      widthSim * weights.width +
      colorSim * weights.color;

    // Weighted KNN Euclidean distance in normalized [0..1] difference space
    const knnDistance = Number(
      Math.sqrt(
        weights.composition * (1 - compSim) ** 2 +
          weights.construction * (1 - constructionSim) ** 2 +
          weights.gsm * (1 - gsmSim) ** 2 +
          weights.width * (1 - widthSim) ** 2 +
          weights.color * (1 - colorSim) ** 2
      ).toFixed(3)
    );

    const similarityScore = Math.round(weightedSim * 100);
    if (similarityScore < 45) continue;

    const matchingAttributes: string[] = [];
    const attributeDifferences: string[] = [];

    if (compSim >= 0.85) matchingAttributes.push(`Composition: ${mat.composition}`);
    else attributeDifferences.push(`Composition: ${mat.composition} (vs ${query.composition})`);

    if (constructionSim >= 0.9) matchingAttributes.push(`Construction: ${mat.construction}`);
    else attributeDifferences.push(`Construction: ${mat.construction} (vs ${query.construction})`);

    const gsmDiff = mat.gsm - query.gsm;
    if (query.gsm > 0 && Math.abs(gsmDiff) <= 10) {
      matchingAttributes.push(`GSM: ${mat.gsm}`);
    } else if (query.gsm > 0) {
      attributeDifferences.push(`GSM: ${mat.gsm} (${gsmDiff >= 0 ? '+' : ''}${gsmDiff})`);
    }

    const widthDiff = mat.widthInches - query.widthInches;
    if (query.widthInches > 0 && Math.abs(widthDiff) <= 2) {
      matchingAttributes.push(`Width: ${mat.widthInches}"`);
    } else if (query.widthInches > 0) {
      attributeDifferences.push(
        `Width: ${mat.widthInches}" (${widthDiff >= 0 ? '+' : ''}${widthDiff}")`
      );
    }

    if (colorExact) matchingAttributes.push(`Color: ${mat.color}`);
    else if (colorFamilyMatch) attributeDifferences.push(`Shade: ${mat.color} (same ${mat.colorFamily} family)`);
    else attributeDifferences.push(`Color: ${mat.color} (vs ${query.color} — re-dye/trim check)`);

    const potentialUseCase = colorExact
      ? 'Direct production substitution pending GSM/shrinkage QC.'
      : colorFamilyMatch
      ? 'Use for tonal/contrast panels or over-dyeing after shade lab dip.'
      : 'Suitable for hidden linings, sampling, or re-dye batch conversion.';

    candidates.push({
      materialId: mat.id,
      sku: mat.sku,
      materialName: mat.name,
      warehouseCode: mat.warehouseCode,
      warehouseName: mat.warehouseName,
      availableQty: freeQty,
      uom: mat.uom,
      unitPrice: mat.purchasePrice,
      similarityScore,
      knnDistance,
      matchingAttributes,
      attributeDifferences,
      explanation: `${similarityScore}% weighted textile similarity (KNN distance ${knnDistance}). ${matchingAttributes.length} exact/close attributes; ${attributeDifferences.length} variances requiring review.`,
      potentialUseCase,
      requiresQcApproval: true,
      qcNote:
        'Similarity score does not guarantee technical compatibility. Production & QC must verify shrinkage, colorfastness, and marker efficiency before issuing.',
    });
  }

  return candidates
    .sort((a, b) => b.similarityScore - a.similarityScore || b.availableQty - a.availableQty)
    .slice(0, topK);
}
