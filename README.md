# StockMind AI — MVP

**AI-powered inventory intelligence and optimization platform for knitwear & textile manufacturing.**

> Built with React + TypeScript + Vite (frontend) and Node.js + Express + PostgreSQL (backend), powered by Google Gemini AI.

---

## 🚀 Quick Start (Development)

### Prerequisites

- Node.js ≥ 20.19.0
- A [Neon PostgreSQL](https://neon.tech) database (free tier works)

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd stockmind-ai-mvp-fixed-v2
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
DATABASE_URL=postgresql://user:password@your-neon-host.neon.tech/stockmind?sslmode=require
JWT_SECRET=your-long-random-secret
GEMINI_API_KEY=your-gemini-api-key   # optional — AI Copilot only
GEMINI_MODEL=gemini-2.0-flash
```

### 3. Run (Development)

```bash
npm run dev
```

The server runs at **http://localhost:3000** (or the PORT from your environment).  
On first start, migrations and seed data are applied automatically.

### 4. Demo Login

| Email | Password | Role |
|-------|----------|------|
| admin@stockmind.ai | StockMind2026! | Admin |
| inventory@stockmind.ai | StockMind2026! | Inventory Manager |
| procurement@stockmind.ai | StockMind2026! | Procurement Officer |
| warehouse@stockmind.ai | StockMind2026! | Warehouse Manager |
| planner@stockmind.ai | StockMind2026! | Production Planner |

---

## 🗄️ Database Setup — Neon PostgreSQL

### Step 1: Create a Neon Project

1. Go to [https://neon.tech](https://neon.tech) and sign up (free).
2. Click **New Project** → give it a name (e.g., `stockmind`).
3. Select your preferred region.
4. Click **Create Project**.

### Step 2: Get the Connection String

1. In your Neon project dashboard, go to **Connection Details**.
2. Select **Node.js** from the connection type dropdown.
3. Copy the connection string — it looks like:
   ```
   postgresql://stockmind_user:AbCdEf123@ep-cool-name-123456.us-east-2.aws.neon.tech/stockmind?sslmode=require
   ```
4. Paste it as `DATABASE_URL` in your `.env` file.

### Step 3: Automatic Schema & Seed

StockMind AI automatically:
- Creates all tables on first run via versioned migrations (`server/db/migrations/`)
- Seeds 26 synthetic SKUs, 4 warehouses, 5 users, production orders, purchase orders, and 14-month inventory history

No manual SQL execution needed.

---

## ☁️ Deploy to Render

### Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "StockMind AI PostgreSQL migration"
git remote add origin https://github.com/YOUR_USERNAME/stockmind-ai.git
git push -u origin main
```

### Step 2: Create a Render Web Service

1. Go to [https://render.com](https://render.com) and sign up.
2. Click **New** → **Web Service**.
3. Connect your GitHub repo.
4. Configure:

| Setting | Value |
|---------|-------|
| **Environment** | Node |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `NODE_ENV=production npm start` |
| **Node Version** | 20 |

### Step 3: Set Environment Variables in Render

In your Render service → **Environment** tab, add:

```
NODE_ENV=production
DATABASE_URL=<your Neon connection string>
JWT_SECRET=<your secure random secret>
GEMINI_API_KEY=<your Gemini API key>
GEMINI_MODEL=gemini-2.0-flash
```

### Step 4: Deploy

Click **Deploy** — Render will build the frontend, run migrations, seed the database, and start the server.

> **Important:** The `DATABASE_URL` must include `sslmode=require` for Neon connections to work.

---

## 📁 Project Structure

```
stockmind-ai-mvp-fixed-v2/
├── server.ts                    # Main Express server (async PostgreSQL)
├── server/
│   ├── auth.ts                  # JWT auth middleware & helpers
│   ├── copilot.ts               # Gemini AI Copilot integration
│   ├── db.ts                    # DB module re-export (compat shim)
│   ├── seed.ts                  # Idempotent seed function
│   ├── services.ts              # Async business logic layer
│   └── db/
│       ├── pool.ts              # PostgreSQL connection pool
│       ├── migrate.ts           # Migration runner
│       └── migrations/
│           └── 001_initial_schema.sql
├── src/
│   ├── App.tsx
│   ├── engine/                  # Pure TypeScript AI engines (no DB dependency)
│   │   ├── riskEngine.ts
│   │   ├── forecastEngine.ts
│   │   ├── reorderEngine.ts
│   │   ├── compatibilityEngine.ts
│   │   ├── recoveryEngine.ts
│   │   ├── types.ts
│   │   └── engines.test.ts
│   ├── pages/                   # React page components
│   └── lib/api.ts               # Frontend API client
├── package.json
├── .env.example
├── vite.config.ts
└── tsconfig.json
```

---

## 🧪 Testing

### Engine Unit Tests (pure, no DB required)

```bash
npm test
```

All 6 engine tests pass: Risk, Forecast, Reorder, Compatibility, Recovery.

### TypeScript Type Check

```bash
npm run lint
```

### Production Build

```bash
npm run build
```

---

## 🔧 Key Technical Changes (PostgreSQL → PostgreSQL)

| PostgreSQL | PostgreSQL |
|--------|-----------|
| `pg (node-postgres)` | `pg` (node-postgres) |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `db.prepare().get()` | `await pool.query()` |
| `db.prepare().all()` | `await pool.query()` |
| `db.prepare().run()` | `await pool.query()` |
| `info.lastInsertRowid` | `RETURNING id` |
| `db.transaction(() => {...})` | `BEGIN / COMMIT / ROLLBACK` with pool client |
| `?` placeholders | `$1`, `$2`, `$3` |
| `datetime('now')` | `NOW()` |
| `INTEGER` boolean | `BOOLEAN` |
| `LIKE` | `ILIKE` (case-insensitive) |
| `MAX(0, x)` | `GREATEST(0, x)` |
| Sync API | Async/await throughout |

---

## 🛡️ Security Notes

- Never commit `.env` to version control (`.gitignore` covers it)
- `JWT_SECRET` **must** be set in production — the server will refuse to start without it
- PostgreSQL credentials are only read from `DATABASE_URL` environment variable
- All passwords are hashed with bcrypt (cost factor 10)
- SSL is enforced for Neon connections

---

## 📜 License

MIT — see LICENSE for details.


## PostgreSQL deployment notes

1. Create a PostgreSQL database (Neon is supported) and copy its connection string into `DATABASE_URL`.
2. Keep TLS certificate verification enabled. `PGSSL_REJECT_UNAUTHORIZED` defaults to `true`; do not disable it in production.
3. Set `NODE_ENV=production`, a strong unique `JWT_SECRET`, and `GEMINI_API_KEY` if AI Copilot is required.
4. Set `PG_POOL_MAX` according to your database provider's connection limits (the default is 10).
5. On startup, the server applies versioned SQL migrations under `server/db/migrations` and seeds the synthetic competition dataset only when the roles table is empty.
6. Back up the Neon database before deploying schema changes. Migrations are serialized with a PostgreSQL advisory lock.

The application serves the built Vite frontend and Express API from the same Node.js web service. Build with `npm run build` and start with `npm start`.

## Performance optimization notes

The PostgreSQL MVP includes a first-pass performance optimization for inventory analytics:

- Risk and reorder calculations load inventory snapshot history for all selected materials with one batched PostgreSQL query instead of one query per material.
- Dashboard analytics reuse the same material, snapshot, BOM commitment, and incoming purchase-order datasets for both risk and reorder calculations.
- Notification data is loaded at application startup and refreshed when the notification panel is opened, rather than being fetched on every sidebar navigation.

These changes reduce avoidable database round-trips while preserving the existing calculation engines and UI. Actual latency still depends on Neon compute state, database region, network conditions, and concurrent requests. Run the test/build commands after installing dependencies, then compare browser Network timings and server slow-query logs before making further changes.
