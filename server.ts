import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { query, pool } from './server/db/pool.js';
import { runMigrations } from './server/db/migrate.js';
import { seedDatabaseIfEmpty } from './server/seed.js';
import {
  hashPassword,
  requireAuth,
  requireRoles,
  signToken,
  verifyPassword,
  type AuthedRequest,
} from './server/auth.js';
import {
  computeAllRiskAssessments,
  computeInventoryAnalytics,
  computeCompatibilityMatches,
  computeMaterialForecast,
  computeRecoveryEvaluationForMaterial,
  computeReorderRecommendations,
  getAllMaterials,
  getMaterialById,
  getMaterialByIdForUpdate,
  getMaterialSnapshots,
  logAudit,
  REFERENCE_DATE_ISO,
} from './server/services.js';
import { simulateProductionReuse } from './src/engine/recoveryEngine.js';
import { runCopilotQuery } from './server/copilot.js';
import type { ForecastModelName, UserRole } from './src/engine/types.js';

const app = express();
app.use(express.json({ limit: '4mb' }));

// Health endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', platform: 'StockMind AI', referenceDate: REFERENCE_DATE_ISO });
});

// ==================== AUTH & USERS ====================
app.get('/api/auth/demo-accounts', requireAuth, requireRoles(['Admin']), async (_req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.full_name, u.email, u.department, r.name as role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = TRUE ORDER BY u.id ASC`
    );
    res.json({ accounts: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch demo accounts.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  try {
    const result = await query(
      `SELECT u.id, u.full_name, u.email, u.password_hash, u.is_active, u.department, r.name as role, r.permissions_json
       FROM users u JOIN roles r ON r.id = u.role_id WHERE lower(u.email) = lower($1)`,
      [String(email).trim()]
    );
    const row = result.rows[0] as {
      id: number; full_name: string; email: string; password_hash: string;
      is_active: boolean; department: string; role: UserRole; permissions_json: string;
    } | undefined;

    if (!row || !row.is_active || !verifyPassword(String(password), row.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const permissions = JSON.parse(row.permissions_json || '[]') as string[];
    const authUser = {
      id: row.id, email: row.email, fullName: row.full_name,
      role: row.role, permissions,
    };
    const token = signToken(authUser);
    await logAudit(row.id, row.email, 'USER_LOGIN', 'user', row.id, `Signed in as ${row.role}`);
    res.json({ token, user: { ...authUser, department: row.department } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed due to server error.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { fullName, email, password, roleName, department } = req.body ?? {};
  if (!fullName || !email || !password) {
    res.status(400).json({ error: 'Full name, email, and password are required.' });
    return;
  }
  if (String(password).length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  try {
    const existing = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [String(email).trim()]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const allowedSelfRoles: UserRole[] = [
      'Inventory Manager', 'Procurement Officer', 'Warehouse Manager', 'Production Planner',
    ];
    const requestedRole: UserRole = allowedSelfRoles.includes(roleName) ? roleName : 'Inventory Manager';

    const roleResult = await query<{ id: number; name: UserRole; permissions_json: string }>(
      'SELECT id, name, permissions_json FROM roles WHERE name = $1',
      [requestedRole]
    );
    const roleRow = roleResult.rows[0];

    const insertResult = await query<{ id: number }>(
      'INSERT INTO users (full_name, email, password_hash, role_id, department) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [
        String(fullName).trim(),
        String(email).trim().toLowerCase(),
        hashPassword(String(password)),
        roleRow.id,
        String(department || 'Operations').trim()
      ]
    );

    const authUser = {
      id: insertResult.rows[0].id,
      email: String(email).trim().toLowerCase(),
      fullName: String(fullName).trim(),
      role: roleRow.name,
      permissions: JSON.parse(roleRow.permissions_json) as string[],
    };
    const token = signToken(authUser);
    await logAudit(authUser.id, authUser.email, 'USER_REGISTER', 'user', authUser.id, `Registered role ${roleRow.name}`);
    res.status(201).json({ token, user: { ...authUser, department: department || 'Operations' } });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed due to server error.' });
  }
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

app.get('/api/users', requireAuth, requireRoles(['Admin']), async (_req, res) => {
  try {
    const users = await query(
      `SELECT u.id, u.full_name, u.email, u.department, u.is_active, u.created_at, r.name as role
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id ASC`
    );
    const roles = await query('SELECT id, name, description FROM roles ORDER BY id ASC');
    res.json({ users: users.rows, roles: roles.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

app.patch('/api/users/:id/role', requireAuth, requireRoles(['Admin']), async (req: AuthedRequest, res) => {
  const userId = Number(req.params.id);
  const { roleName } = req.body ?? {};
  try {
    const roleResult = await query<{ id: number; name: string }>(
      'SELECT id, name FROM roles WHERE name = $1', [roleName]
    );
    const roleRow = roleResult.rows[0];
    if (!roleRow) {
      res.status(400).json({ error: 'Invalid role name.' });
      return;
    }
    await query('UPDATE users SET role_id = $1 WHERE id = $2', [roleRow.id, userId]);
    await logAudit(req.user!.id, req.user!.email, 'UPDATE_ROLE', 'user', userId, `Assigned role ${roleRow.name}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user role.' });
  }
});

// ==================== MASTER DATA ====================
app.get('/api/warehouses', requireAuth, async (_req, res) => {
  try {
    const result = await query(
      `SELECT w.*, COUNT(m.id) as sku_count, COALESCE(SUM(m.available_qty * m.purchase_price), 0) as total_value
       FROM warehouses w LEFT JOIN materials m ON m.warehouse_id = w.id
       GROUP BY w.id ORDER BY w.id ASC`
    );
    res.json({ warehouses: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch warehouses.' });
  }
});

app.get('/api/suppliers', requireAuth, async (_req, res) => {
  try {
    const result = await query('SELECT * FROM suppliers ORDER BY id ASC');
    res.json({ suppliers: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch suppliers.' });
  }
});

app.get('/api/categories', requireAuth, async (_req, res) => {
  try {
    const result = await query('SELECT * FROM material_categories ORDER BY id ASC');
    res.json({ categories: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories.' });
  }
});

// ==================== MATERIALS & INVENTORY ====================
app.get('/api/materials', requireAuth, async (req, res) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;

  try {
    const materials = await getAllMaterials({ warehouseId, categoryId, search });
    const risks = await computeAllRiskAssessments({ warehouseId, categoryId });
    const riskMap = new Map(risks.map((r) => [r.materialId, r]));

    const enriched = materials.map((m) => ({
      ...m,
      risk: riskMap.get(m.id) ?? null,
    }));

    res.json({ materials: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch materials.' });
  }
});

app.get('/api/materials/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const mat = await getMaterialById(id);
    if (!mat) {
      res.status(404).json({ error: 'Material not found.' });
      return;
    }
    const snapshots = await getMaterialSnapshots(id);
    const movements = await query(
      `SELECT sm.*, w.code as warehouse_code FROM stock_movements sm
       JOIN warehouses w ON w.id = sm.warehouse_id
       WHERE sm.material_id = $1 ORDER BY sm.movement_date DESC, sm.id DESC LIMIT 25`,
      [id]
    );
    const risks = await computeAllRiskAssessments();
    const risk = risks.find((r) => r.materialId === id) ?? null;

    res.json({ material: mat, snapshots, movements: movements.rows, risk });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch material.' });
  }
});

app.post(
  '/api/materials',
  requireAuth,
  requireRoles(['Admin', 'Inventory Manager', 'Warehouse Manager']),
  async (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    if (!b.sku || !b.name || !b.categoryId || !b.warehouseId || !b.supplierId) {
      res.status(400).json({ error: 'SKU, name, category, warehouse, and supplier are required.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query('SELECT id FROM materials WHERE sku = $1', [String(b.sku).trim()]);
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: `Material SKU '${b.sku}' already exists.` });
        return;
      }

      const avail = Math.max(0, Number(b.availableQty || 0));
      const resQty = Math.max(0, Number(b.reservedQty || 0));
      if (resQty > avail) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Reserved quantity cannot exceed available quantity.' });
        return;
      }

      const matResult = await client.query<{ id: number }>(
        `INSERT INTO materials (
          sku, name, category_id, material_type, composition, color, color_family,
          gsm, width_inches, construction, quality_grade, uom, available_qty, reserved_qty,
          warehouse_id, supplier_id, purchase_price, purchase_date, last_movement_date,
          batch_number, min_stock_level, lead_time_days, shelf_life_days, seasonal_peak_months, is_synthetic
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,FALSE)
        RETURNING id`,
        [
          String(b.sku).trim(), String(b.name).trim(), Number(b.categoryId),
          String(b.materialType || 'Fabric').trim(), String(b.composition || '100% Cotton').trim(),
          String(b.color || 'Unbleached').trim(), String(b.colorFamily || 'White').trim(),
          Number(b.gsm || 0), Number(b.widthInches || 0),
          String(b.construction || 'Standard').trim(),
          b.qualityGrade || 'A', b.uom || 'kg',
          avail, resQty,
          Number(b.warehouseId), Number(b.supplierId),
          Math.max(0, Number(b.purchasePrice || 0)),
          b.purchaseDate || REFERENCE_DATE_ISO,
          b.lastMovementDate || REFERENCE_DATE_ISO,
          String(b.batchNumber || `LOT-${Date.now().toString().slice(-6)}`).trim(),
          Math.max(0, Number(b.minStockLevel || 100)),
          Math.max(1, Number(b.leadTimeDays || 14)),
          b.shelfLifeDays ? Number(b.shelfLifeDays) : null,
          JSON.stringify(Array.isArray(b.seasonalPeakMonths) ? b.seasonalPeakMonths : [])
        ]
      );

      const newId = matResult.rows[0].id;

      if (avail > 0) {
        await client.query(
          `INSERT INTO stock_movements (material_id, warehouse_id, movement_type, quantity, reference_code, batch_number, notes, performed_by, movement_date, is_synthetic)
           VALUES ($1,$2,'IN',$3,$4,$5,'Opening stock on material creation',$6,$7,FALSE)`,
          [
            newId, Number(b.warehouseId), avail,
            `OPEN-${newId}`,
            String(b.batchNumber || `LOT-${Date.now().toString().slice(-6)}`),
            req.user!.id, REFERENCE_DATE_ISO
          ]
        );
      }

      await client.query(
        'INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.user!.id, req.user!.email, 'CREATE_MATERIAL', 'material', String(newId), `Created SKU ${b.sku}`]
      );

      await client.query('COMMIT');

      const material = await getMaterialById(newId);
      res.status(201).json({ material });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Failed to create material.' });
    } finally {
      client.release();
    }
  }
);

app.put(
  '/api/materials/:id',
  requireAuth,
  requireRoles(['Admin', 'Inventory Manager', 'Warehouse Manager']),
  async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    try {
      const existing = await getMaterialById(id);
      if (!existing) {
        res.status(404).json({ error: 'Material not found.' });
        return;
      }
      const b = req.body ?? {};
      await query(
        `UPDATE materials SET
          name = $1, composition = $2, color = $3, color_family = $4, gsm = $5, width_inches = $6,
          construction = $7, quality_grade = $8, purchase_price = $9, min_stock_level = $10,
          lead_time_days = $11, reserved_qty = $12, updated_at = NOW()
         WHERE id = $13`,
        [
          b.name ?? existing.name,
          b.composition ?? existing.composition,
          b.color ?? existing.color,
          b.colorFamily ?? existing.colorFamily,
          b.gsm ?? existing.gsm,
          b.widthInches ?? existing.widthInches,
          b.construction ?? existing.construction,
          b.qualityGrade ?? existing.qualityGrade,
          b.purchasePrice ?? existing.purchasePrice,
          b.minStockLevel ?? existing.minStockLevel,
          b.leadTimeDays ?? existing.leadTimeDays,
          Math.min(existing.availableQty, Math.max(0, Number(b.reservedQty ?? existing.reservedQty))),
          id
        ]
      );
      await logAudit(req.user!.id, req.user!.email, 'UPDATE_MATERIAL', 'material', id, `Updated SKU ${existing.sku}`);
      res.json({ material: await getMaterialById(id) });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update material.' });
    }
  }
);

app.delete(
  '/api/materials/:id',
  requireAuth,
  requireRoles(['Admin', 'Inventory Manager']),
  async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    try {
      const existing = await getMaterialById(id);
      if (!existing) {
        res.status(404).json({ error: 'Material not found.' });
        return;
      }
      await query('DELETE FROM materials WHERE id = $1', [id]);
      await logAudit(req.user!.id, req.user!.email, 'DELETE_MATERIAL', 'material', id, `Deleted SKU ${existing.sku}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete material.' });
    }
  }
);

app.post(
  '/api/materials/import',
  requireAuth,
  requireRoles(['Admin', 'Inventory Manager', 'Warehouse Manager']),
  async (req: AuthedRequest, res) => {
    const { rows } = req.body ?? {};
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'Import payload must include at least one row.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const cats = await client.query<{ id: number; name: string }>('SELECT id, name FROM material_categories');
      const whs = await client.query<{ id: number; code: string }>('SELECT id, code FROM warehouses');
      const sups = await client.query<{ id: number }>('SELECT id FROM suppliers LIMIT 1');

      const catByName = new Map(cats.rows.map((c) => [c.name.toLowerCase(), c.id]));
      const whByCode = new Map(whs.rows.map((w) => [w.code.toLowerCase(), w.id]));
      const defaultCat = cats.rows[0]?.id ?? 1;
      const defaultWh = whs.rows[0]?.id ?? 1;
      const defaultSup = sups.rows[0]?.id ?? 1;

      let inserted = 0;
      const skipped: string[] = [];

      for (const r of rows) {
        const sku = String(r.sku || r.SKU || '').trim();
        const name = String(r.name || r.Name || r['Material Name'] || '').trim();
        if (!sku || !name) { skipped.push('Missing SKU or Material Name'); continue; }

        const exists = await client.query('SELECT id FROM materials WHERE sku = $1', [sku]);
        if (exists.rows.length > 0) { skipped.push(`${sku} (duplicate SKU)`); continue; }

        const catId = catByName.get(String(r.category || r.Category || '').toLowerCase()) ?? defaultCat;
        const whId = whByCode.get(String(r.warehouse || r.Warehouse || '').toLowerCase()) ?? defaultWh;
        const qty = Math.max(0, Number(r.availableQty ?? r['Available Qty'] ?? r.quantity ?? 0));
        const price = Math.max(0, Number(r.purchasePrice ?? r['Purchase Price'] ?? 5));

        await client.query(
          `INSERT INTO materials (
            sku, name, category_id, material_type, composition, color, color_family,
            gsm, width_inches, construction, quality_grade, uom, available_qty, reserved_qty,
            warehouse_id, supplier_id, purchase_price, purchase_date, last_movement_date,
            batch_number, min_stock_level, lead_time_days, is_synthetic
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,$17,$18,$19,$20,$21,FALSE)`,
          [
            sku, name, catId,
            String(r.materialType || 'Imported Fabric'),
            String(r.composition || r.Composition || '100% Cotton'),
            String(r.color || r.Color || 'Natural'),
            String(r.colorFamily || 'Neutral'),
            Number(r.gsm || r.GSM || 180),
            Number(r.widthInches || r.Width || 72),
            String(r.construction || r.Construction || 'Single Jersey'),
            ['A', 'B', 'C'].includes(String(r.qualityGrade || 'A')) ? String(r.qualityGrade || 'A') : 'A',
            ['kg', 'meters', 'cones', 'pcs'].includes(String(r.uom || 'kg')) ? String(r.uom || 'kg') : 'kg',
            qty, whId, defaultSup, price,
            REFERENCE_DATE_ISO, REFERENCE_DATE_ISO,
            String(r.batchNumber || `IMP-${Date.now().toString().slice(-5)}`),
            Math.max(0, Number(r.minStockLevel || 100)),
            Math.max(1, Number(r.leadTimeDays || 14))
          ]
        );
        inserted++;
      }

      await client.query(
        'INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.user!.id, req.user!.email, 'IMPORT_MATERIALS', 'material', 'bulk', `Imported ${inserted} materials (${skipped.length} skipped)`]
      );

      await client.query('COMMIT');
      res.json({ inserted, skipped });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Import failed due to server error.' });
    } finally {
      client.release();
    }
  }
);

// ==================== STOCK MOVEMENTS & TRANSFERS ====================
app.get('/api/stock-movements', requireAuth, async (req, res) => {
  const materialId = req.query.materialId ? Number(req.query.materialId) : undefined;
  const movementType = req.query.movementType ? String(req.query.movementType) : undefined;

  let sql = `
    SELECT sm.*, m.sku, m.name as material_name, m.uom, w.code as warehouse_code, w.name as warehouse_name,
           u.full_name as performed_by_name
    FROM stock_movements sm
    JOIN materials m ON m.id = sm.material_id
    JOIN warehouses w ON w.id = sm.warehouse_id
    LEFT JOIN users u ON u.id = sm.performed_by
    WHERE 1=1
  `;
  const params: unknown[] = [];
  let paramIdx = 1;

  if (materialId) {
    sql += ` AND sm.material_id = $${paramIdx++}`;
    params.push(materialId);
  }
  if (movementType && movementType !== 'ALL') {
    sql += ` AND sm.movement_type = $${paramIdx++}`;
    params.push(movementType);
  }
  sql += ' ORDER BY sm.movement_date DESC, sm.id DESC LIMIT 200';

  try {
    const result = await query(sql, params);
    res.json({ movements: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stock movements.' });
  }
});

app.post(
  '/api/stock-movements',
  requireAuth,
  requireRoles(['Admin', 'Inventory Manager', 'Warehouse Manager']),
  async (req: AuthedRequest, res) => {
    const { materialId, movementType, quantity, referenceCode, notes, targetWarehouseId } = req.body ?? {};
    const qty = Number(quantity);
    if (!materialId || !movementType || Number.isNaN(qty) || qty <= 0) {
      res.status(400).json({ error: 'Valid materialId, movementType, and positive quantity are required.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const mat = await getMaterialByIdForUpdate(Number(materialId), client);
      if (!mat) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Material not found.' });
        return;
      }

      if ((movementType === 'OUT' || movementType === 'TRANSFER_OUT') && qty > mat.availableQty) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: `Insufficient stock for ${mat.sku}. Available: ${mat.availableQty} ${mat.uom}, requested: ${qty} ${mat.uom}. Negative stock is blocked.`,
        });
        return;
      }

      const ref = String(referenceCode || `MOV-${Date.now().toString().slice(-6)}`).trim();
      let newAvail = mat.availableQty;
      let newWhId = mat.warehouseId;

      if (movementType === 'IN') {
        newAvail = mat.availableQty + qty;
      } else if (movementType === 'OUT') {
        newAvail = mat.availableQty - qty;
      } else if (movementType === 'ADJUST') {
        newAvail = qty;
      } else if (movementType === 'TRANSFER_OUT' && targetWarehouseId) {
        newAvail = mat.availableQty - qty;
        newWhId = Number(targetWarehouseId);
      }

      await client.query(
        'UPDATE materials SET available_qty = $1, last_movement_date = $2, updated_at = NOW() WHERE id = $3',
        [newAvail, REFERENCE_DATE_ISO, mat.id]
      );

      const movResult = await client.query<{ id: number }>(
        `INSERT INTO stock_movements (material_id, warehouse_id, movement_type, quantity, reference_code, batch_number, notes, performed_by, movement_date, is_synthetic)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE) RETURNING id`,
        [mat.id, mat.warehouseId, movementType, qty, ref, mat.batchNumber, String(notes || '').trim(), req.user!.id, REFERENCE_DATE_ISO]
      );

      if (movementType === 'TRANSFER_OUT' && targetWarehouseId && newWhId !== mat.warehouseId) {
        await client.query(
          `INSERT INTO stock_movements (material_id, warehouse_id, movement_type, quantity, reference_code, batch_number, notes, performed_by, movement_date, is_synthetic)
           VALUES ($1,$2,'TRANSFER_IN',$3,$4,$5,$6,$7,$8,FALSE)`,
          [
            mat.id, newWhId, qty, `${ref}-RCV`, mat.batchNumber,
            `Received transfer from ${mat.warehouseCode}`, req.user!.id, REFERENCE_DATE_ISO
          ]
        );
      }

      await client.query(
        'INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.user!.id, req.user!.email, `STOCK_${movementType}`, 'material', String(mat.id),
         `${movementType} ${qty} ${mat.uom} for ${mat.sku} (Ref: ${ref}). New balance: ${newAvail} ${mat.uom}.`]
      );

      await client.query('COMMIT');
      const updatedMat = await getMaterialById(mat.id);
      res.status(201).json({ movementId: movResult.rows[0].id, material: updatedMat });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Failed to record stock movement.' });
    } finally {
      client.release();
    }
  }
);

// ==================== PRODUCTION & PURCHASE ORDERS ====================
app.get('/api/production-orders', requireAuth, async (_req, res) => {
  try {
    const orders = await query(
      `SELECT p.*, w.code as warehouse_code, w.name as warehouse_name
       FROM production_orders p JOIN warehouses w ON w.id = p.warehouse_id
       ORDER BY p.due_date ASC`
    );

    const boms = await query(
      `SELECT b.*, m.sku, m.name as material_name, m.uom, m.composition, m.color, m.color_family,
              m.gsm, m.width_inches, m.construction, c.name as category_name
       FROM bom_items b
       JOIN materials m ON m.id = b.material_id
       JOIN material_categories c ON c.id = m.category_id`
    );

    const bomByOrder = new Map<number, Array<Record<string, unknown>>>();
    for (const b of boms.rows as Array<Record<string, unknown>>) {
      const pid = Number(b.production_order_id);
      const list = bomByOrder.get(pid) ?? [];
      list.push(b);
      bomByOrder.set(pid, list);
    }

    res.json({
      productionOrders: (orders.rows as Array<Record<string, unknown>>).map((o) => ({
        ...o,
        bomItems: bomByOrder.get(Number(o.id)) ?? [],
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch production orders.' });
  }
});

app.get('/api/purchase-orders', requireAuth, async (_req, res) => {
  try {
    const pos = await query(
      `SELECT po.*, s.name as supplier_name, w.code as warehouse_code
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN warehouses w ON w.id = po.warehouse_id
       ORDER BY po.created_at DESC`
    );

    const items = await query(
      `SELECT poi.*, m.sku, m.name as material_name, m.uom
       FROM purchase_order_items poi JOIN materials m ON m.id = poi.material_id`
    );

    const itemsByPo = new Map<number, Array<Record<string, unknown>>>();
    for (const it of items.rows as Array<Record<string, unknown>>) {
      const pid = Number(it.purchase_order_id);
      const list = itemsByPo.get(pid) ?? [];
      list.push(it);
      itemsByPo.set(pid, list);
    }

    res.json({
      purchaseOrders: (pos.rows as Array<Record<string, unknown>>).map((p) => ({
        ...p, items: itemsByPo.get(Number(p.id)) ?? []
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch purchase orders.' });
  }
});

app.post(
  '/api/purchase-orders',
  requireAuth,
  requireRoles(['Admin', 'Procurement Officer', 'Inventory Manager']),
  async (req: AuthedRequest, res) => {
    const { materialId, quantity, notes } = req.body ?? {};
    const qty = Number(quantity);
    if (!materialId || Number.isNaN(qty) || qty <= 0) {
      res.status(400).json({ error: 'Valid materialId and positive quantity are required.' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const mat = await getMaterialByIdForUpdate(Number(materialId), client);
      if (!mat) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Material not found.' });
        return;
      }

      const poNum = `PO-2026-${Math.floor(1000 + Math.random() * 9000)}`;
      const eta = new Date(REFERENCE_DATE_ISO);
      eta.setUTCDate(eta.getUTCDate() + mat.leadTimeDays);
      const etaIso = eta.toISOString().slice(0, 10);
      const total = Number((qty * mat.purchasePrice).toFixed(2));

      const poResult = await client.query<{ id: number }>(
        `INSERT INTO purchase_orders (po_number, supplier_id, warehouse_id, status, expected_delivery_date, total_amount, created_by, notes)
         VALUES ($1,$2,$3,'Pending Approval',$4,$5,$6,$7) RETURNING id`,
        [poNum, mat.supplierId, mat.warehouseId, etaIso, total, req.user!.id,
         String(notes || `Created from StockMind Reorder Recommendation for ${mat.sku}`)]
      );
      const poId = poResult.rows[0].id;

      await client.query(
        'INSERT INTO purchase_order_items (purchase_order_id, material_id, ordered_qty, received_qty, unit_price) VALUES ($1,$2,$3,0,$4)',
        [poId, mat.id, qty, mat.purchasePrice]
      );

      await client.query(
        'INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.user!.id, req.user!.email, 'CREATE_DRAFT_PO', 'purchase_order', poNum,
         `Created Pending Approval PO for ${qty} ${mat.uom} of ${mat.sku} ($${total})`]
      );

      await client.query('COMMIT');
      res.status(201).json({ id: poId, poNumber: poNum, status: 'Pending Approval' });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Failed to create purchase order.' });
    } finally {
      client.release();
    }
  }
);

app.patch(
  '/api/purchase-orders/:id/status',
  requireAuth,
  requireRoles(['Admin', 'Procurement Officer']),
  async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { status } = req.body ?? {};
    if (!['Approved', 'Ordered', 'Cancelled'].includes(status)) {
      res.status(400).json({ error: 'Invalid status transition.' });
      return;
    }
    try {
      await query('UPDATE purchase_orders SET status = $1, approved_by = $2 WHERE id = $3', [status, req.user!.id, id]);
      await logAudit(req.user!.id, req.user!.email, 'UPDATE_PO_STATUS', 'purchase_order', id, `Set PO status to ${status}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update purchase order status.' });
    }
  }
);

// ==================== FORECASTING, RISK & REORDER ====================
app.get('/api/forecasting/:materialId', requireAuth, async (req, res) => {
  const materialId = Number(req.params.materialId);
  const horizon = Math.min(12, Math.max(1, Number(req.query.horizon || 3)));
  const modelParam = req.query.model ? String(req.query.model) as ForecastModelName : undefined;

  try {
    const result = await computeMaterialForecast(materialId, horizon, modelParam);
    if (!result) {
      res.status(404).json({ error: 'Material not found.' });
      return;
    }
    res.json({ forecast: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute forecast.' });
  }
});

app.get('/api/inventory-risk', requireAuth, async (req, res) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
  try {
    const assessments = await computeAllRiskAssessments({ warehouseId, categoryId });
    res.json({ assessments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute risk assessments.' });
  }
});

app.get('/api/inventory-risk/reorders', requireAuth, async (req, res) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
  const demandMultiplier = req.query.demandMultiplier ? Number(req.query.demandMultiplier) : 1;
  const leadTimeDeltaDays = req.query.leadTimeDeltaDays ? Number(req.query.leadTimeDeltaDays) : 0;
  const serviceLevelZ = req.query.serviceLevelZ ? Number(req.query.serviceLevelZ) : 1.65;

  try {
    const reorders = await computeReorderRecommendations(
      { warehouseId, categoryId },
      { demandMultiplier, leadTimeDeltaDays, serviceLevelZ }
    );
    res.json({ reorders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute reorder recommendations.' });
  }
});

// ==================== MATERIAL COMPATIBILITY ====================
app.post('/api/material-matching/search', requireAuth, async (req, res) => {
  const q = req.body ?? {};
  if (!q.categoryName || !q.composition) {
    res.status(400).json({ error: 'Category and composition are required for compatibility matching.' });
    return;
  }
  try {
    const candidates = await computeCompatibilityMatches({
      targetMaterialId: q.targetMaterialId ? Number(q.targetMaterialId) : undefined,
      categoryName: String(q.categoryName),
      composition: String(q.composition),
      color: String(q.color || ''),
      colorFamily: String(q.colorFamily || ''),
      gsm: Number(q.gsm || 0),
      widthInches: Number(q.widthInches || 0),
      construction: String(q.construction || ''),
      minQualityGrade: q.minQualityGrade || 'B',
      strictComposition: Boolean(q.strictComposition),
      requiredQty: q.requiredQty ? Number(q.requiredQty) : undefined,
    });
    res.json({ candidates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute material matches.' });
  }
});

app.get('/api/material-matching/approvals', requireAuth, async (_req, res) => {
  try {
    const result = await query(
      `SELECT mc.*, s.sku as source_sku, s.name as source_name,
              c.sku as candidate_sku, c.name as candidate_name, u.full_name as reviewer_name
       FROM material_compatibility mc
       JOIN materials s ON s.id = mc.source_material_id
       JOIN materials c ON c.id = mc.candidate_material_id
       LEFT JOIN users u ON u.id = mc.reviewed_by
       ORDER BY mc.created_at DESC`
    );
    res.json({ approvals: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch compatibility approvals.' });
  }
});

app.post(
  '/api/material-matching/approvals',
  requireAuth,
  requireRoles(['Admin', 'Production Planner', 'Inventory Manager']),
  async (req: AuthedRequest, res) => {
    const { sourceMaterialId, candidateMaterialId, similarityScore, qcStatus, notes } = req.body ?? {};
    if (!sourceMaterialId || !candidateMaterialId) {
      res.status(400).json({ error: 'Source and candidate material IDs are required.' });
      return;
    }
    const status = ['Pending QC', 'Approved', 'Rejected'].includes(qcStatus) ? qcStatus : 'Pending QC';
    try {
      const result = await query<{ id: number }>(
        `INSERT INTO material_compatibility (source_material_id, candidate_material_id, similarity_score, qc_status, reviewed_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [Number(sourceMaterialId), Number(candidateMaterialId), Number(similarityScore || 0), status, req.user!.id, String(notes || 'Submitted from Material Compatibility Engine')]
      );
      await logAudit(
        req.user!.id, req.user!.email, 'QC_COMPATIBILITY_LOG', 'material_compatibility',
        result.rows[0].id,
        `Logged compatibility pair ${sourceMaterialId} -> ${candidateMaterialId} (${status})`
      );
      res.status(201).json({ id: result.rows[0].id, qcStatus: status });
    } catch (err) {
      res.status(500).json({ error: 'Failed to log compatibility approval.' });
    }
  }
);

// ==================== DEAD STOCK RECOVERY ENGINE ====================
app.get('/api/recovery/recommendations', requireAuth, async (_req, res) => {
  try {
    const rows = await query(
      `SELECT rr.*, m.sku, m.name as material_name, m.uom, m.quality_grade,
              w.code as warehouse_code, w.name as warehouse_name,
              u.full_name as approved_by_name
       FROM recovery_recommendations rr
       JOIN materials m ON m.id = rr.material_id
       JOIN warehouses w ON w.id = m.warehouse_id
       LEFT JOIN users u ON u.id = rr.approved_by
       ORDER BY rr.net_estimated_value DESC`
    );

    const actions = await query(
      `SELECT ra.*, rr.material_id, m.sku, m.name as material_name, rr.strategy, u.full_name as executed_by_name
       FROM recovery_actions ra
       JOIN recovery_recommendations rr ON rr.id = ra.recommendation_id
       JOIN materials m ON m.id = rr.material_id
       LEFT JOIN users u ON u.id = ra.executed_by
       ORDER BY ra.executed_at DESC`
    );

    res.json({
      recommendations: (rows.rows as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        assumptions: JSON.parse(String(r.assumptions_json || '[]')),
      })),
      actions: actions.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch recovery recommendations.' });
  }
});

app.get('/api/recovery/evaluate/:materialId', requireAuth, async (req, res) => {
  const materialId = Number(req.params.materialId);
  try {
    const evaluation = await computeRecoveryEvaluationForMaterial(materialId);
    if (!evaluation) {
      res.status(404).json({ error: 'Material not found.' });
      return;
    }
    res.json({ evaluation });
  } catch (err) {
    res.status(500).json({ error: 'Failed to evaluate recovery options.' });
  }
});

app.post(
  '/api/recovery/recommendations',
  requireAuth,
  requireRoles(['Admin', 'Inventory Manager', 'Production Planner']),
  async (req: AuthedRequest, res) => {
    const { materialId, strategy, recoverableQty, grossEstimatedValue, estimatedCosts,
            netEstimatedValue, valueType, assumptions, targetReference, notes } = req.body ?? {};
    if (!materialId || !strategy) {
      res.status(400).json({ error: 'materialId and strategy are required.' });
      return;
    }
    try {
      const result = await query<{ id: number }>(
        `INSERT INTO recovery_recommendations (
          material_id, strategy, recoverable_qty, gross_estimated_value, estimated_costs,
          net_estimated_value, value_type, assumptions_json, target_reference, approval_status, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Pending Review',$10) RETURNING id`,
        [
          Number(materialId), String(strategy), Number(recoverableQty || 0),
          Number(grossEstimatedValue || 0), Number(estimatedCosts || 0), Number(netEstimatedValue || 0),
          String(valueType || 'Avoided Procurement Cost'),
          JSON.stringify(Array.isArray(assumptions) ? assumptions : []),
          targetReference ? String(targetReference) : null, String(notes || '')
        ]
      );
      await logAudit(
        req.user!.id, req.user!.email, 'CREATE_RECOVERY_PROPOSAL', 'recovery_recommendation',
        result.rows[0].id,
        `Proposed ${strategy} for material #${materialId} (Est. Net $${netEstimatedValue})`
      );
      res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create recovery recommendation.' });
    }
  }
);

app.patch(
  '/api/recovery/recommendations/:id/decision',
  requireAuth,
  requireRoles(['Admin', 'Inventory Manager']),
  async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { decision, modifiedQty, modifiedNetValue, notes } = req.body ?? {};
    if (!['Approved', 'Rejected', 'Modified'].includes(decision)) {
      res.status(400).json({ error: 'Decision must be Approved, Rejected, or Modified.' });
      return;
    }

    try {
      const row = await query('SELECT id FROM recovery_recommendations WHERE id = $1', [id]);
      if (row.rows.length === 0) {
        res.status(404).json({ error: 'Recommendation not found.' });
        return;
      }

      await query(
        `UPDATE recovery_recommendations
         SET approval_status = $1,
             recoverable_qty = COALESCE($2, recoverable_qty),
             net_estimated_value = COALESCE($3, net_estimated_value),
             approved_by = $4,
             notes = COALESCE($5, notes),
             updated_at = NOW()
         WHERE id = $6`,
        [
          decision,
          modifiedQty !== undefined ? Number(modifiedQty) : null,
          modifiedNetValue !== undefined ? Number(modifiedNetValue) : null,
          req.user!.id,
          notes ? String(notes) : null,
          id
        ]
      );

      await logAudit(
        req.user!.id, req.user!.email, `RECOVERY_${decision.toUpperCase()}`,
        'recovery_recommendation', id, `Set recovery recommendation #${id} to ${decision}`
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update recovery decision.' });
    }
  }
);

app.post(
  '/api/recovery/recommendations/:id/execute',
  requireAuth,
  requireRoles(['Admin', 'Inventory Manager', 'Warehouse Manager']),
  async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { actualRecoveredQty, realizedNetValue, outcomeNotes } = req.body ?? {};

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const rec = await client.query<{ id: number; material_id: number; strategy: string; approval_status: string }>(
        'SELECT id, material_id, strategy, approval_status FROM recovery_recommendations WHERE id = $1 FOR UPDATE', [id]
      );
      if (rec.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Recommendation not found.' });
        return;
      }

      const qty = Number(actualRecoveredQty);
      const realized = Number(realizedNetValue);
      if (Number.isNaN(qty) || qty <= 0 || Number.isNaN(realized)) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Valid actualRecoveredQty and realizedNetValue are required.' });
        return;
      }

      const recRow = rec.rows[0];
      await client.query(
        "UPDATE recovery_recommendations SET approval_status = 'Executed', updated_at = NOW() WHERE id = $1",
        [id]
      );

      const actResult = await client.query<{ id: number }>(
        `INSERT INTO recovery_actions (recommendation_id, action_type, actual_recovered_qty, realized_net_value, executed_by, outcome_notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [id, `${recRow.strategy} Executed`, qty, realized, req.user!.id, String(outcomeNotes || 'Realized recovery recorded')]
      );

      await client.query(
        'INSERT INTO financial_records (record_type, reference_id, material_id, amount, is_realized, description) VALUES ($1,$2,$3,$4,TRUE,$5)',
        [recRow.strategy, actResult.rows[0].id, recRow.material_id, realized, `Realized recovery via ${recRow.strategy} (${qty} units)`]
      );

      await client.query(
        'INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.user!.id, req.user!.email, 'EXECUTE_RECOVERY', 'recovery_recommendation', String(id),
         `Executed recovery #${id}: ${qty} units, realized net value $${realized.toFixed(2)}`]
      );

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Failed to execute recovery action.' });
    } finally {
      client.release();
    }
  }
);

// ==================== FINANCIAL & WHAT-IF SIMULATOR ====================
app.get('/api/financial/summary', requireAuth, async (req, res) => {
  const annualHoldingRate = req.query.holdingRate ? Number(req.query.holdingRate) : 0.18;

  try {
    const materials = await getAllMaterials();
    const risks = await computeAllRiskAssessments();
    const riskMap = new Map(risks.map((r) => [r.materialId, r]));

    let totalInventoryValue = 0;
    let blockedWorkingCapital = 0;
    let potentialDeadStockValue = 0;
    let excessOverstockValue = 0;

    const breakdownByMaterial = materials.map((m) => {
      const val = Number((m.availableQty * m.purchasePrice).toFixed(2));
      const r = riskMap.get(m.id)!;
      totalInventoryValue += val;
      if (['Slow-Moving Stock', 'Excess Stock', 'Potential Dead Stock', 'Critical Overstock'].includes(r.riskCategory)) {
        blockedWorkingCapital += val;
      }
      if (r.riskCategory === 'Potential Dead Stock') potentialDeadStockValue += val;
      if (r.riskCategory === 'Critical Overstock' || r.riskCategory === 'Excess Stock') excessOverstockValue += val;
      return {
        materialId: m.id, sku: m.sku, name: m.name, warehouseCode: m.warehouseCode,
        riskCategory: r.riskCategory, bookValue: val,
        annualHoldingCost: Number((val * annualHoldingRate).toFixed(2)),
        monthsOfSupply: r.monthsOfSupply,
      };
    });

    const pendingRecs = await query<{ est_total: number }>(
      `SELECT COALESCE(SUM(net_estimated_value), 0) as est_total
       FROM recovery_recommendations WHERE approval_status IN ('Pending Review','Approved','Modified')`
    );
    const realizedActions = await query<{ realized_total: number }>(
      'SELECT COALESCE(SUM(realized_net_value), 0) as realized_total FROM recovery_actions'
    );

    res.json({
      summary: {
        totalInventoryValue: Number(totalInventoryValue.toFixed(2)),
        blockedWorkingCapital: Number(blockedWorkingCapital.toFixed(2)),
        potentialDeadStockValue: Number(potentialDeadStockValue.toFixed(2)),
        excessOverstockValue: Number(excessOverstockValue.toFixed(2)),
        annualHoldingRatePct: Number((annualHoldingRate * 100).toFixed(1)),
        estimatedAnnualHoldingCost: Number((totalInventoryValue * annualHoldingRate).toFixed(2)),
        blockedAnnualHoldingCost: Number((blockedWorkingCapital * annualHoldingRate).toFixed(2)),
        estimatedPipelineRecoveryValue: Number((Number(pendingRecs.rows[0].est_total) || 0).toFixed(2)),
        realizedRecoveryValue: Number((Number(realizedActions.rows[0].realized_total) || 0).toFixed(2)),
      },
      breakdown: breakdownByMaterial.sort((a, b) => b.bookValue - a.bookValue),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute financial summary.' });
  }
});

app.post('/api/financial/simulate-reuse', requireAuth, async (req, res) => {
  const b = req.body ?? {};
  try {
    const mat = await getMaterialById(Number(b.sourceMaterialId));
    if (!mat) {
      res.status(404).json({ error: 'Source material not found.' });
      return;
    }
    const freeQty = Math.max(0, mat.availableQty - mat.reservedQty);
    const simResult = simulateProductionReuse({
      sourceMaterialId: mat.id,
      sourceMaterialName: mat.name,
      sourceUnitPrice: mat.purchasePrice,
      availableExcessQty: freeQty,
      requiredQty: Math.max(1, Number(b.requiredQty || 500)),
      newPurchaseUnitPrice: Math.max(0.01, Number(b.newPurchaseUnitPrice || mat.purchasePrice * 1.05)),
      reprocessingCostPerUnit: Math.max(0, Number(b.reprocessingCostPerUnit ?? 0.35)),
      handlingAndTransferCost: Math.max(0, Number(b.handlingAndTransferCost ?? 60)),
    });
    res.json({ simulation: simResult, sourceMaterial: mat });
  } catch (err) {
    res.status(500).json({ error: 'Failed to simulate production reuse.' });
  }
});

// ==================== EXECUTIVE DASHBOARD ANALYTICS ====================
app.get('/api/analytics/dashboard', requireAuth, async (req, res) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;

  try {
    const { materials, risks, reorders } = await computeInventoryAnalytics({ warehouseId, categoryId });

    const totalInventoryValue = materials.reduce((s, m) => s + m.availableQty * m.purchasePrice, 0);
    const slowMovingValue = risks.filter((r) => r.riskCategory === 'Slow-Moving Stock').reduce((s, r) => s + r.inventoryValue, 0);
    const deadStockValue = risks.filter((r) => r.riskCategory === 'Potential Dead Stock').reduce((s, r) => s + r.inventoryValue, 0);
    const excessQty = risks
      .filter((r) => ['Excess Stock', 'Critical Overstock', 'Potential Dead Stock'].includes(r.riskCategory))
      .reduce((s, r) => {
        const m = materials.find((x) => x.id === r.materialId);
        return s + (m ? Math.max(0, m.availableQty - m.reservedQty) : 0);
      }, 0);

    const stockoutRiskCount = reorders.filter(
      (r) => r.stockoutRiskLevel === 'Critical' || r.stockoutRiskLevel === 'High'
    ).length;

    const avgTurnover = risks.length > 0 ? risks.reduce((s, r) => s + r.turnoverRatio, 0) / risks.length : 0;

    const recRows = await query<{ strategy: string; net_estimated_value: number; approval_status: string; warehouse_id: number; category_id: number }>(
      `SELECT rr.strategy, rr.net_estimated_value, rr.approval_status, m.warehouse_id, m.category_id
       FROM recovery_recommendations rr JOIN materials m ON m.id = rr.material_id`
    );

    const filteredRecs = recRows.rows.filter(
      (r) => (!warehouseId || r.warehouse_id === warehouseId) && (!categoryId || r.category_id === categoryId)
    );

    const realizedRows = await query<{ realized_net_value: number; warehouse_id: number; category_id: number }>(
      `SELECT ra.realized_net_value, m.warehouse_id, m.category_id
       FROM recovery_actions ra
       JOIN recovery_recommendations rr ON rr.id = ra.recommendation_id
       JOIN materials m ON m.id = rr.material_id`
    );

    const realizedTotal = realizedRows.rows
      .filter((r) => (!warehouseId || r.warehouse_id === warehouseId) && (!categoryId || r.category_id === categoryId))
      .reduce((s, r) => s + Number(r.realized_net_value), 0);

    const pipelinePotential = filteredRecs
      .filter((r) => r.approval_status !== 'Rejected' && r.approval_status !== 'Executed')
      .reduce((s, r) => s + Number(r.net_estimated_value), 0);

    // Category aggregation
    const catAgg = new Map<string, { category: string; value: number; skuCount: number }>();
    for (const m of materials) {
      const prev = catAgg.get(m.categoryName) ?? { category: m.categoryName, value: 0, skuCount: 0 };
      prev.value = Number((prev.value + m.availableQty * m.purchasePrice).toFixed(2));
      prev.skuCount += 1;
      catAgg.set(m.categoryName, prev);
    }

    // Warehouse aggregation
    const whAgg = new Map<string, { warehouse: string; code: string; value: number; skuCount: number }>();
    for (const m of materials) {
      const prev = whAgg.get(m.warehouseCode) ?? { warehouse: m.warehouseName, code: m.warehouseCode, value: 0, skuCount: 0 };
      prev.value = Number((prev.value + m.availableQty * m.purchasePrice).toFixed(2));
      prev.skuCount += 1;
      whAgg.set(m.warehouseCode, prev);
    }

    // Risk distribution
    const riskDistMap = new Map<string, { category: string; count: number; value: number }>();
    for (const r of risks) {
      const prev = riskDistMap.get(r.riskCategory) ?? { category: r.riskCategory, count: 0, value: 0 };
      prev.count += 1;
      prev.value = Number((prev.value + r.inventoryValue).toFixed(2));
      riskDistMap.set(r.riskCategory, prev);
    }

    // Monthly aggregate consumption trend
    const matIds = materials.map((m) => m.id);
    let monthlyTrend: Array<{ period: string; consumedQty: number; receivedQty: number; inventoryValue: number }> = [];
    if (matIds.length > 0) {
      const placeholders = matIds.map((_, i) => `$${i + 1}`).join(',');
      const trendResult = await query<{ period: string; consumedqty: number; receivedqty: number; inventoryvalue: number }>(
        `SELECT period_ym as period,
                ROUND(CAST(SUM(consumed_qty) AS NUMERIC), 1) as consumedQty,
                ROUND(CAST(SUM(received_qty) AS NUMERIC), 1) as receivedQty,
                ROUND(CAST(SUM(snapshot_value) AS NUMERIC), 2) as inventoryValue
         FROM inventory_snapshots
         WHERE material_id IN (${placeholders})
         GROUP BY period_ym
         ORDER BY period_ym ASC`,
        matIds
      );
      monthlyTrend = trendResult.rows.map((r) => ({
        period: r.period,
        consumedQty: Number(r.consumedqty),
        receivedQty: Number(r.receivedqty),
        inventoryValue: Number(r.inventoryvalue),
      }));
    }

    // Strategy distribution
    const stratMap = new Map<string, { strategy: string; estimatedValue: number; count: number }>();
    for (const r of filteredRecs) {
      const prev = stratMap.get(r.strategy) ?? { strategy: r.strategy, estimatedValue: 0, count: 0 };
      prev.estimatedValue = Number((prev.estimatedValue + Number(r.net_estimated_value)).toFixed(2));
      prev.count += 1;
      stratMap.set(r.strategy, prev);
    }

    res.json({
      kpis: {
        totalInventoryValue: Number(totalInventoryValue.toFixed(2)),
        totalActiveMaterials: materials.length,
        slowMovingValue: Number(slowMovingValue.toFixed(2)),
        potentialDeadStockValue: Number(deadStockValue.toFixed(2)),
        stockoutRiskCount,
        excessInventoryQty: Math.round(excessQty),
        potentialRecoveryValue: Number(pipelinePotential.toFixed(2)),
        realizedRecoveryValue: Number(realizedTotal.toFixed(2)),
        inventoryTurnover: Number(avgTurnover.toFixed(2)),
      },
      charts: {
        byCategory: Array.from(catAgg.values()).sort((a, b) => b.value - a.value),
        byWarehouse: Array.from(whAgg.values()).sort((a, b) => b.value - a.value),
        riskDistribution: Array.from(riskDistMap.values()),
        monthlyTrend,
        recoveryByStrategy: Array.from(stratMap.values()),
      },
      priorityActions: {
        topDeadStock: risks
          .filter((r) => ['Potential Dead Stock', 'Critical Overstock'].includes(r.riskCategory))
          .sort((a, b) => b.inventoryValue - a.inventoryValue)
          .slice(0, 5),
        topStockouts: reorders
          .filter((r) => r.stockoutRiskLevel === 'Critical' || r.stockoutRiskLevel === 'High')
          .sort((a, b) => a.coverageDays - b.coverageDays)
          .slice(0, 5),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute dashboard analytics.' });
  }
});

// ==================== AI INVENTORY COPILOT ====================
app.post('/api/copilot/chat', requireAuth, async (req: AuthedRequest, res) => {
  const { query: q } = req.body ?? {};
  if (!q || !String(q).trim()) {
    res.status(400).json({ error: 'Please enter a question for the AI Inventory Copilot.' });
    return;
  }
  try {
    const result = await runCopilotQuery(req.user!, String(q).trim());
    res.json(result);
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    res.status(e.statusCode || 500).json({ error: e.message || 'Copilot request failed.' });
  }
});

app.get('/api/copilot/history', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const result = await query(
      `SELECT id, query_text, response_text, citations_json, created_at
       FROM ai_conversation_logs WHERE user_id = $1 ORDER BY id DESC LIMIT 20`,
      [req.user!.id]
    );
    res.json({
      history: (result.rows as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        citations: JSON.parse(String(r.citations_json || '[]')),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch copilot history.' });
  }
});

// ==================== NOTIFICATIONS & AUDIT LOGS ====================
app.get('/api/notifications', requireAuth, async (_req, res) => {
  try {
    const result = await query(
      `SELECT n.*, m.sku FROM notifications n LEFT JOIN materials m ON m.id = n.material_id
       ORDER BY n.is_read ASC, n.id DESC LIMIT 50`
    );
    res.json({ notifications: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read = TRUE WHERE id = $1', [Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notification as read.' });
  }
});

app.post('/api/notifications/read-all', requireAuth, async (_req, res) => {
  try {
    await query('UPDATE notifications SET is_read = TRUE');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark all notifications as read.' });
  }
});

app.get('/api/audit-logs', requireAuth, requireRoles(['Admin']), async (_req, res) => {
  try {
    const result = await query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100');
    res.json({ logs: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

// ==================== SERVER STARTUP & VITE ====================
async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const distPath = path.resolve(process.cwd(), 'dist');

  // Run migrations then seed
  try {
    await runMigrations();
    await seedDatabaseIfEmpty();
  } catch (err) {
    console.error('[StockMind] Database initialization failed:', (err as Error).message);
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API endpoint not found.' });
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`StockMind AI server listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[StockMind] ${signal} received; shutting down gracefully.`);
    httpServer.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer();
