-- ============================================================
-- StockMind AI – Initial PostgreSQL Schema
-- Migration: 001_initial_schema.sql
-- Converts all SQLite tables to PostgreSQL-compatible DDL
-- ============================================================

-- Roles
CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  permissions_json TEXT NOT NULL,
  description TEXT NOT NULL
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  department    TEXT NOT NULL DEFAULT 'Operations',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Warehouses
CREATE TABLE IF NOT EXISTS warehouses (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(50) NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  location        TEXT NOT NULL,
  capacity_units  DOUBLE PRECISION NOT NULL DEFAULT 50000,
  manager_name    TEXT NOT NULL
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id                 SERIAL PRIMARY KEY,
  code               VARCHAR(50) NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  country            TEXT NOT NULL,
  avg_lead_time_days INTEGER NOT NULL,
  on_time_rate       DOUBLE PRECISION NOT NULL,
  contact_email      TEXT NOT NULL
);

-- Material Categories
CREATE TABLE IF NOT EXISTS material_categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

-- Materials
CREATE TABLE IF NOT EXISTS materials (
  id                   SERIAL PRIMARY KEY,
  sku                  VARCHAR(100) NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  category_id          INTEGER NOT NULL REFERENCES material_categories(id),
  material_type        TEXT NOT NULL,
  composition          TEXT NOT NULL,
  color                TEXT NOT NULL,
  color_family         TEXT NOT NULL,
  gsm                  DOUBLE PRECISION NOT NULL DEFAULT 0,
  width_inches         DOUBLE PRECISION NOT NULL DEFAULT 0,
  construction         TEXT NOT NULL,
  quality_grade        VARCHAR(1) NOT NULL CHECK (quality_grade IN ('A','B','C')),
  uom                  VARCHAR(10) NOT NULL CHECK (uom IN ('kg','meters','cones','pcs')),
  available_qty        DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
  reserved_qty         DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  warehouse_id         INTEGER NOT NULL REFERENCES warehouses(id),
  supplier_id          INTEGER NOT NULL REFERENCES suppliers(id),
  purchase_price       DOUBLE PRECISION NOT NULL CHECK (purchase_price >= 0),
  purchase_date        TEXT NOT NULL,
  last_movement_date   TEXT NOT NULL,
  batch_number         TEXT NOT NULL,
  min_stock_level      DOUBLE PRECISION NOT NULL DEFAULT 0,
  lead_time_days       INTEGER NOT NULL DEFAULT 14,
  shelf_life_days      INTEGER,
  seasonal_peak_months TEXT NOT NULL DEFAULT '[]',
  is_synthetic         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_materials_category  ON materials(category_id);
CREATE INDEX IF NOT EXISTS idx_materials_warehouse ON materials(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_materials_sku       ON materials(sku);

-- Inventory Snapshots
CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id             SERIAL PRIMARY KEY,
  material_id    INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
  period_ym      VARCHAR(7) NOT NULL,
  closing_qty    DOUBLE PRECISION NOT NULL,
  consumed_qty   DOUBLE PRECISION NOT NULL,
  received_qty   DOUBLE PRECISION NOT NULL,
  snapshot_value DOUBLE PRECISION NOT NULL,
  is_synthetic   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(material_id, period_ym)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_mat_period ON inventory_snapshots(material_id, period_ym);

-- Stock Movements
CREATE TABLE IF NOT EXISTS stock_movements (
  id            SERIAL PRIMARY KEY,
  material_id   INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('IN','OUT','ADJUST','TRANSFER_IN','TRANSFER_OUT')),
  quantity      DOUBLE PRECISION NOT NULL,
  reference_code TEXT NOT NULL,
  batch_number  TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  performed_by  INTEGER REFERENCES users(id),
  movement_date TEXT NOT NULL,
  is_synthetic  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movements_mat_date ON stock_movements(material_id, movement_date);

-- Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                     SERIAL PRIMARY KEY,
  po_number              TEXT NOT NULL UNIQUE,
  supplier_id            INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id           INTEGER NOT NULL REFERENCES warehouses(id),
  status                 TEXT NOT NULL CHECK (status IN ('Draft','Pending Approval','Approved','Ordered','Received','Cancelled')),
  expected_delivery_date TEXT NOT NULL,
  total_amount           DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_by             INTEGER REFERENCES users(id),
  approved_by            INTEGER REFERENCES users(id),
  notes                  TEXT NOT NULL DEFAULT '',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purchase Order Items
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                 SERIAL PRIMARY KEY,
  purchase_order_id  INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id        INTEGER NOT NULL REFERENCES materials(id),
  ordered_qty        DOUBLE PRECISION NOT NULL,
  received_qty       DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit_price         DOUBLE PRECISION NOT NULL
);

-- Production Orders
CREATE TABLE IF NOT EXISTS production_orders (
  id          SERIAL PRIMARY KEY,
  order_code  TEXT NOT NULL UNIQUE,
  style_name  TEXT NOT NULL,
  buyer_name  TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  status      TEXT NOT NULL CHECK (status IN ('Planned','In Progress','Completed','Cancelled')),
  target_qty  INTEGER NOT NULL,
  due_date    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- BOM Items
CREATE TABLE IF NOT EXISTS bom_items (
  id                  SERIAL PRIMARY KEY,
  production_order_id INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  material_id         INTEGER NOT NULL REFERENCES materials(id),
  required_qty        DOUBLE PRECISION NOT NULL,
  allocated_qty       DOUBLE PRECISION NOT NULL DEFAULT 0
);

-- Material Compatibility
CREATE TABLE IF NOT EXISTS material_compatibility (
  id                   SERIAL PRIMARY KEY,
  source_material_id   INTEGER NOT NULL REFERENCES materials(id),
  candidate_material_id INTEGER NOT NULL REFERENCES materials(id),
  similarity_score     DOUBLE PRECISION NOT NULL,
  qc_status            TEXT NOT NULL CHECK (qc_status IN ('Pending QC','Approved','Rejected')),
  reviewed_by          INTEGER REFERENCES users(id),
  notes                TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Demand Forecasts
CREATE TABLE IF NOT EXISTS demand_forecasts (
  id            SERIAL PRIMARY KEY,
  material_id   INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  model_name    TEXT NOT NULL,
  model_version TEXT NOT NULL,
  period_ym     VARCHAR(7) NOT NULL,
  forecast_qty  DOUBLE PRECISION NOT NULL,
  lower_bound   DOUBLE PRECISION NOT NULL,
  upper_bound   DOUBLE PRECISION NOT NULL,
  wape_score    DOUBLE PRECISION NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inventory Risk Assessments
CREATE TABLE IF NOT EXISTS inventory_risk_assessments (
  id            SERIAL PRIMARY KEY,
  material_id   INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  risk_category TEXT NOT NULL,
  risk_score    DOUBLE PRECISION NOT NULL,
  model_version TEXT NOT NULL,
  explanation   TEXT NOT NULL,
  assessed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recovery Recommendations
CREATE TABLE IF NOT EXISTS recovery_recommendations (
  id                   SERIAL PRIMARY KEY,
  material_id          INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  strategy             TEXT NOT NULL,
  recoverable_qty      DOUBLE PRECISION NOT NULL,
  gross_estimated_value DOUBLE PRECISION NOT NULL,
  estimated_costs      DOUBLE PRECISION NOT NULL,
  net_estimated_value  DOUBLE PRECISION NOT NULL,
  value_type           TEXT NOT NULL,
  assumptions_json     TEXT NOT NULL,
  target_reference     TEXT,
  approval_status      TEXT NOT NULL DEFAULT 'Pending Review' CHECK (approval_status IN ('Pending Review','Approved','Rejected','Modified','Executed')),
  approved_by          INTEGER REFERENCES users(id),
  notes                TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recovery Actions
CREATE TABLE IF NOT EXISTS recovery_actions (
  id                   SERIAL PRIMARY KEY,
  recommendation_id    INTEGER NOT NULL REFERENCES recovery_recommendations(id) ON DELETE CASCADE,
  action_type          TEXT NOT NULL,
  actual_recovered_qty DOUBLE PRECISION NOT NULL,
  realized_net_value   DOUBLE PRECISION NOT NULL,
  executed_by          INTEGER REFERENCES users(id),
  outcome_notes        TEXT NOT NULL DEFAULT '',
  executed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Financial Records
CREATE TABLE IF NOT EXISTS financial_records (
  id           SERIAL PRIMARY KEY,
  record_type  TEXT NOT NULL,
  reference_id INTEGER,
  material_id  INTEGER REFERENCES materials(id),
  amount       DOUBLE PRECISION NOT NULL,
  is_realized  BOOLEAN NOT NULL DEFAULT FALSE,
  description  TEXT NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  severity    TEXT NOT NULL CHECK (severity IN ('critical','warning','info')),
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  material_id INTEGER REFERENCES materials(id),
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  user_email  TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  details     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI Conversation Logs
CREATE TABLE IF NOT EXISTS ai_conversation_logs (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id),
  user_role      TEXT NOT NULL,
  query_text     TEXT NOT NULL,
  response_text  TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
