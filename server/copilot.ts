import { GoogleGenAI } from '@google/genai';
import { query } from './db/pool.js';
import {
  computeAllRiskAssessments,
  computeReorderRecommendations,
  getAllMaterials,
} from './services.js';
import type { AuthUser } from './auth.js';

const STOCKMIND_KNOWLEDGE_DOCS = [
  {
    docId: 'DOC-RISK-01',
    title: 'Dead Stock Classification Methodology',
    content:
      'StockMind AI never labels a material as dead stock solely from days since last movement. Risk scores combine inactivity window, historical consumption velocity, turnover ratio, months of supply, upcoming Production Order BOM commitments, reserved quantities, seasonal peak windows, quality grade, and shelf-life limits.',
  },
  {
    docId: 'DOC-COMP-02',
    title: 'Material Compatibility & QC Sign-off Policy',
    content:
      'Material Compatibility Intelligence runs a two-stage hybrid match: hard constraints (category match, unreserved free stock > 0, quality grade floor, <=35% GSM drift) followed by weighted KNN similarity on Composition (32%), Construction (24%), GSM (20%), Width (12%), and Color family (12%). High similarity does NOT guarantee technical compatibility; Production & QC must approve shrinkage, colorfastness, and marker yield.',
  },
  {
    docId: 'DOC-RECOV-03',
    title: 'Dead Stock Recovery Financial Rules',
    content:
      'Net Recovery Value = Expected Recovery Revenue or Avoided Procurement Cost minus Relevant Recovery Costs. Strategies (Reuse in Production, Inter-Warehouse Transfer, Resale/Liquidation, Recycling) are evaluated as mutually exclusive alternatives to prevent double-counting. Estimated recovery values are strictly separated from Realized values recorded upon execution.',
  },
];

export async function runCopilotQuery(user: AuthUser, queryText: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    const err = new Error(
      'GEMINI_API_KEY is not configured. Add your Gemini API key in Settings > Secrets to enable the AI Inventory Copilot.'
    );
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  // Retrieve verified business data from PostgreSQL & intelligence engines
  const materials = await getAllMaterials();
  const risks = await computeAllRiskAssessments();
  const reorders = await computeReorderRecommendations();

  const totalInventoryValue = materials.reduce(
    (sum, m) => sum + m.availableQty * m.purchasePrice,
    0
  );

  const highRiskItems = risks
    .filter((r) =>
      ['Potential Dead Stock', 'Critical Overstock', 'Excess Stock', 'Slow-Moving Stock'].includes(
        r.riskCategory
      )
    )
    .sort((a, b) => b.inventoryValue - a.inventoryValue)
    .slice(0, 12);

  const stockoutRisks = reorders
    .filter((r) => r.stockoutRiskLevel === 'Critical' || r.stockoutRiskLevel === 'High')
    .sort((a, b) => a.coverageDays - b.coverageDays)
    .slice(0, 10);

  const recoveryRows = await query(
    `SELECT rr.id, m.sku, m.name, rr.strategy, rr.recoverable_qty, rr.net_estimated_value,
            rr.value_type, rr.approval_status, rr.target_reference
     FROM recovery_recommendations rr
     JOIN materials m ON m.id = rr.material_id
     ORDER BY rr.net_estimated_value DESC
     LIMIT 12`
  );

  const realizedRows = await query(
    `SELECT ra.id, m.sku, ra.action_type, ra.actual_recovered_qty, ra.realized_net_value, ra.executed_at
     FROM recovery_actions ra
     JOIN recovery_recommendations rr ON rr.id = ra.recommendation_id
     JOIN materials m ON m.id = rr.material_id
     ORDER BY ra.executed_at DESC
     LIMIT 10`
  );

  const openBoms = await query(
    `SELECT p.order_code, p.style_name, p.status, p.due_date, m.sku, b.required_qty, b.allocated_qty
     FROM bom_items b
     JOIN production_orders p ON p.id = b.production_order_id
     JOIN materials m ON m.id = b.material_id
     WHERE p.status IN ('Planned', 'In Progress')`
  );

  // Simple lexical doc retrieval from internal methodology docs
  const qLower = queryText.toLowerCase();
  const relevantDocs = STOCKMIND_KNOWLEDGE_DOCS.filter(
    (d) =>
      qLower.includes('dead') ||
      qLower.includes('risk') ||
      qLower.includes('compat') ||
      qLower.includes('match') ||
      qLower.includes('recover') ||
      qLower.includes('value') ||
      d.docId === 'DOC-RISK-01'
  );

  // Role-aware financial note
  const canSeeFullFinancials = ['Admin', 'Inventory Manager', 'Procurement Officer'].includes(
    user.role
  );

  const groundedContext = {
    authenticatedUser: { name: user.fullName, role: user.role },
    dataProvenanceNotice:
      'All factory inventory records in this workspace are synthetic knitwear & textile manufacturing data generated for StockMind AI.',
    portfolioSnapshot: {
      totalActiveSkus: materials.length,
      totalInventoryValueUsd: canSeeFullFinancials ? Number(totalInventoryValue.toFixed(2)) : '[Restricted for role]',
      potentialDeadAndOverstockSkus: risks.filter((r) =>
        ['Potential Dead Stock', 'Critical Overstock'].includes(r.riskCategory)
      ).length,
      criticalOrHighStockoutCount: stockoutRisks.length,
    },
    topRiskMaterials: highRiskItems.map((r) => ({
      sku: r.sku,
      name: r.materialName,
      category: r.riskCategory,
      score: r.riskScore,
      daysInactive: r.daysSinceLastMovement,
      monthsOfSupply: r.monthsOfSupply,
      upcomingBomQty: r.upcomingBomQty,
      inventoryValueUsd: canSeeFullFinancials ? r.inventoryValue : '[Restricted]',
      explanation: r.explanation,
    })),
    stockoutAlerts: stockoutRisks.map((s) => ({
      sku: s.sku,
      name: s.materialName,
      riskLevel: s.stockoutRiskLevel,
      availableQty: s.availableQty,
      reservedQty: s.reservedQty,
      incomingPoQty: s.incomingPoQty,
      coverageDays: s.coverageDays,
      estimatedStockoutDate: s.estimatedStockoutDate,
      recommendedReorderQty: s.recommendedReorderQty,
    })),
    recoveryPipeline: recoveryRows.rows,
    realizedRecoveries: realizedRows.rows,
    openProductionBoms: openBoms.rows,
    warehouseInventorySample: materials.map((m) => ({
      sku: m.sku,
      name: m.name,
      warehouse: `${m.warehouseCode} (${m.warehouseName})`,
      freeQty: Math.max(0, m.availableQty - m.reservedQty),
      uom: m.uom,
      gsm: m.gsm,
      widthInches: m.widthInches,
      color: m.color,
      construction: m.construction,
    })),
    methodologyDocs: relevantDocs,
  };

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const systemInstruction = `You are StockMind AI Inventory Copilot for garments and textile manufacturing.
STRICT GROUNDING RULES:
1. Answer ONLY using the verified database records and methodology documents provided in the JSON context below.
2. NEVER invent SKUs, quantities, prices, warehouse codes, dates, or financial savings. If data is missing or restricted for the user's role, explicitly state that it is unavailable.
3. Always cite exact SKU codes (e.g., FAB-SJ-185-SLT), Warehouse codes (e.g., WH-GAZ-02), or Production Order codes (e.g., PRD-2026-401) from the context.
4. Clearly distinguish Estimated Recovery Value from Realized Recovery Value.
5. Remind users that stock mutations, purchase orders, and material substitutions require human approval in the corresponding module—you cannot modify inventory directly.
6. Format responses cleanly with concise bullet points and bold key figures.`;

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `VERIFIED_BUSINESS_DATA_JSON:\n${JSON.stringify(groundedContext)}\n\nUSER_QUESTION:\n${queryText}`,
          },
        ],
      },
    ],
    config: {
      systemInstruction,
    },
  });

  const answerText = (response.text ?? '').trim();
  if (!answerText) {
    throw new Error('Gemini returned an empty response. Please try rephrasing your question.');
  }

  // Extract cited SKUs/IDs mentioned in the answer
  const citations: Array<{ type: string; code: string; label: string }> = [];
  for (const m of materials) {
    if (answerText.includes(m.sku)) {
      citations.push({ type: 'Material', code: m.sku, label: `${m.name} (${m.warehouseCode})` });
    }
  }
  for (const d of relevantDocs) {
    if (answerText.includes(d.docId) || answerText.toLowerCase().includes(d.title.toLowerCase())) {
      citations.push({ type: 'Policy', code: d.docId, label: d.title });
    }
  }

  await query(
    'INSERT INTO ai_conversation_logs (user_id, user_role, query_text, response_text, citations_json) VALUES ($1, $2, $3, $4, $5)',
    [user.id, user.role, queryText, answerText, JSON.stringify(citations)]
  );

  return {
    answer: answerText,
    citations: citations.slice(0, 8),
    groundedRecordsCount: materials.length + recoveryRows.rows.length + openBoms.rows.length,
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  };
}
