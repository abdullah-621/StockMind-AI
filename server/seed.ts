import { pool } from './db/pool.js';
import { hashPassword } from './auth.js';

// Deterministic PRNG for reproducible synthetic manufacturing data
function createRng(seed = 20261117) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export async function seedDatabaseIfEmpty(): Promise<void> {
  const rng = createRng(42026);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // Serialize first-run seeding across multiple app instances.
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [731_904_222]);
    const roleCheck = await client.query<{ c: string }>('SELECT COUNT(*)::text as c FROM roles');
    if (Number(roleCheck.rows[0].c) > 0) {
      await client.query('COMMIT');
      console.log('[Seed] Existing database detected; seed skipped.');
      return;
    }

    console.log('[Seed] Seeding database with synthetic StockMind AI dataset...');

    // 1. Roles
    const rolesData: [string, string, string][] = [
      ['Admin', JSON.stringify(['*']), 'Full platform governance, user management, and financial approvals'],
      ['Inventory Manager', JSON.stringify(['inventory:write', 'risk:read', 'recovery:approve', 'forecast:read', 'reports:export']), 'Oversees stock health, dead-stock risk, and recovery approvals'],
      ['Procurement Officer', JSON.stringify(['po:write', 'suppliers:write', 'forecast:read', 'inventory:read']), 'Manages supplier lead times, reorder approvals, and purchase orders'],
      ['Warehouse Manager', JSON.stringify(['movements:write', 'inventory:write', 'transfer:execute']), 'Executes stock-in, stock-out, lot tracking, and warehouse transfers'],
      ['Production Planner', JSON.stringify(['bom:read', 'matching:write', 'forecast:read', 'recovery:propose']), 'Plans production BOMs and reviews compatible substitute fabrics'],
    ];

    for (const [name, perms, desc] of rolesData) {
      await client.query(
        'INSERT INTO roles (name, permissions_json, description) VALUES ($1, $2, $3)',
        [name, perms, desc]
      );
    }

    const roleRows = await client.query<{ id: number; name: string }>('SELECT id, name FROM roles');
    const roleMap = new Map(roleRows.rows.map((r) => [r.name, r.id]));

    // 2. Demo Users (password: StockMind2026!)
    const defaultHash = hashPassword('StockMind2026!');
    const usersData: [string, string, string, number | undefined, string][] = [
      ['Tariq Hasan', 'admin@stockmind.ai', defaultHash, roleMap.get('Admin'), 'Executive Operations'],
      ['Nadia Rahman', 'inventory@stockmind.ai', defaultHash, roleMap.get('Inventory Manager'), 'Inventory Intelligence'],
      ['Kamrul Islam', 'procurement@stockmind.ai', defaultHash, roleMap.get('Procurement Officer'), 'Global Sourcing'],
      ['Farhana Akter', 'warehouse@stockmind.ai', defaultHash, roleMap.get('Warehouse Manager'), 'Dhaka Hub Logistics'],
      ['Sajjad Mahmud', 'planner@stockmind.ai', defaultHash, roleMap.get('Production Planner'), 'Knitwear Planning'],
    ];

    for (const [fullName, email, pwHash, roleId, dept] of usersData) {
      await client.query(
        'INSERT INTO users (full_name, email, password_hash, role_id, department) VALUES ($1, $2, $3, $4, $5)',
        [fullName, email, pwHash, roleId, dept]
      );
    }

    // 3. Warehouses
    const warehousesData: [string, string, string, number, string][] = [
      ['WH-DHK-01', 'Dhaka Knit Main Hub', 'Tejgaon Industrial Area, Dhaka', 120000, 'Farhana Akter'],
      ['WH-GAZ-02', 'Gazipur Dyeing & Finishing Store', 'Konabari, Gazipur', 95000, 'Rafiq Chowdhury'],
      ['WH-NAR-03', 'Narayanganj Sewing Unit Store', 'Fatullah, Narayanganj', 75000, 'Mizanur Rahman'],
      ['WH-CTG-04', 'Chattogram Export Buffer', 'CEPZ Zone, Chattogram', 60000, 'Shafiqul Alam'],
    ];

    for (const [code, name, location, cap, mgr] of warehousesData) {
      await client.query(
        'INSERT INTO warehouses (code, name, location, capacity_units, manager_name) VALUES ($1, $2, $3, $4, $5)',
        [code, name, location, cap, mgr]
      );
    }

    const whRows = await client.query<{ id: number; code: string }>('SELECT id, code FROM warehouses');
    const whMap = new Map(whRows.rows.map((w) => [w.code, w.id]));

    // 4. Suppliers
    const suppliersData: [string, string, string, number, number, string][] = [
      ['SUP-APX', 'Apex Textile Mills Ltd.', 'Bangladesh', 14, 0.94, 'sourcing@apextextiles.example'],
      ['SUP-SQC', 'Square Knit Composite', 'Bangladesh', 18, 0.91, 'orders@squareknit.example'],
      ['SUP-SHN', 'Shanghai Specialty Fibers', 'China', 32, 0.84, 'export@shanghaifibers.example'],
      ['SUP-YKK', 'Pacific Trim & Fasteners', 'Vietnam', 21, 0.89, 'sales@pacifictrim.example'],
      ['SUP-IND', 'Surat Dyed Yarns Co.', 'India', 26, 0.87, 'dispatch@suratdyed.example'],
    ];

    for (const [code, name, country, lead, rate, email] of suppliersData) {
      await client.query(
        'INSERT INTO suppliers (code, name, country, avg_lead_time_days, on_time_rate, contact_email) VALUES ($1, $2, $3, $4, $5, $6)',
        [code, name, country, lead, rate, email]
      );
    }

    const supRows = await client.query<{ id: number; code: string }>('SELECT id, code FROM suppliers');
    const supMap = new Map(supRows.rows.map((s) => [s.code, s.id]));

    // 5. Material Categories
    const catsData: [string, string][] = [
      ['Knitted Fabrics', 'Single jersey, pique, rib, interlock, and French terry knit rolls'],
      ['Woven Fabrics', 'Twill, poplin, denim, and canvas woven textiles'],
      ['Spinning Yarns', 'Combed cotton, CVC, melange, and elastane yarn cones'],
      ['Trims & Accessories', 'Zippers, buttons, woven labels, drawcords, and elastic bands'],
      ['Dyeing Auxiliaries', 'Reactive dyes, softeners, and enzyme finishing chemicals'],
    ];

    for (const [name, desc] of catsData) {
      await client.query('INSERT INTO material_categories (name, description) VALUES ($1, $2)', [name, desc]);
    }

    const catRows = await client.query<{ id: number; name: string }>('SELECT id, name FROM material_categories');
    const catMap = new Map(catRows.rows.map((c) => [c.name, c.id]));

    // 6. Synthetic Materials Catalog
    type MatSeed = {
      sku: string; name: string; cat: string; type: string; comp: string;
      color: string; family: string; gsm: number; width: number; constr: string;
      grade: 'A' | 'B' | 'C'; uom: 'kg' | 'meters' | 'cones' | 'pcs';
      avail: number; res: number; wh: string; sup: string; price: number;
      pDate: string; lastMove: string; lot: string; minLvl: number; lead: number;
      shelf: number | null; peaks: number[];
      pattern: 'healthy' | 'growing' | 'slow' | 'dead' | 'overstock' | 'stockout';
      baseDemand: number;
    };

    const seeds: MatSeed[] = [
      { sku: 'FAB-SJ-180-NVY', name: '100% Cotton Single Jersey 180 GSM Navy', cat: 'Knitted Fabrics', type: 'Single Jersey', comp: '100% Combed Cotton', color: 'Navy Blue', family: 'Blue', gsm: 180, width: 72, constr: 'Single Jersey', grade: 'A', uom: 'kg', avail: 2450, res: 850, wh: 'WH-DHK-01', sup: 'SUP-APX', price: 5.9, pDate: '2026-09-12', lastMove: '2026-11-15', lot: 'LOT-2609-SJ1', minLvl: 800, lead: 14, shelf: null, peaks: [10, 11, 12], pattern: 'growing', baseDemand: 1450 },
      { sku: 'FAB-SJ-160-WHT', name: 'Combed Cotton Single Jersey 160 GSM Optic White', cat: 'Knitted Fabrics', type: 'Single Jersey', comp: '100% Combed Cotton', color: 'Optic White', family: 'White', gsm: 160, width: 72, constr: 'Single Jersey', grade: 'A', uom: 'kg', avail: 1920, res: 600, wh: 'WH-DHK-01', sup: 'SUP-APX', price: 5.4, pDate: '2026-09-28', lastMove: '2026-11-14', lot: 'LOT-2609-W04', minLvl: 700, lead: 14, shelf: null, peaks: [3, 4, 5], pattern: 'healthy', baseDemand: 1180 },
      { sku: 'FAB-FT-280-HGR', name: 'CVC French Terry 280 GSM Heather Grey', cat: 'Knitted Fabrics', type: 'French Terry', comp: '80% Cotton 20% Polyester', color: 'Heather Grey', family: 'Grey', gsm: 280, width: 70, constr: 'French Terry', grade: 'A', uom: 'kg', avail: 1650, res: 700, wh: 'WH-NAR-03', sup: 'SUP-SQC', price: 6.4, pDate: '2026-10-04', lastMove: '2026-11-16', lot: 'LOT-2610-FT2', minLvl: 650, lead: 18, shelf: null, peaks: [9, 10, 11, 12], pattern: 'growing', baseDemand: 1100 },
      { sku: 'FAB-PQ-220-BLK', name: 'Lacoste Pique 220 GSM Jet Black', cat: 'Knitted Fabrics', type: 'Pique', comp: '100% Combed Cotton', color: 'Jet Black', family: 'Black', gsm: 220, width: 72, constr: 'Pique Knit', grade: 'A', uom: 'kg', avail: 1480, res: 400, wh: 'WH-DHK-01', sup: 'SUP-SQC', price: 6.1, pDate: '2026-10-01', lastMove: '2026-11-12', lot: 'LOT-2610-PQ8', minLvl: 500, lead: 18, shelf: null, peaks: [4, 5, 6], pattern: 'healthy', baseDemand: 900 },
      { sku: 'FAB-RB-240-NVY', name: '1x1 Elastane Rib 240 GSM Navy Blue', cat: 'Knitted Fabrics', type: 'Rib 1x1', comp: '95% Cotton 5% Elastane', color: 'Navy Blue', family: 'Blue', gsm: 240, width: 58, constr: 'Rib 1x1', grade: 'A', uom: 'kg', avail: 620, res: 210, wh: 'WH-NAR-03', sup: 'SUP-APX', price: 6.8, pDate: '2026-10-10', lastMove: '2026-11-15', lot: 'LOT-2610-RB1', minLvl: 240, lead: 14, shelf: null, peaks: [10, 11], pattern: 'healthy', baseDemand: 380 },
      { sku: 'FAB-FL-320-BLK', name: 'Brushed 3-End Fleece 320 GSM Jet Black', cat: 'Knitted Fabrics', type: 'Fleece', comp: '80% Cotton 20% Polyester', color: 'Jet Black', family: 'Black', gsm: 320, width: 72, constr: '3-End Fleece', grade: 'A', uom: 'kg', avail: 290, res: 180, wh: 'WH-NAR-03', sup: 'SUP-SQC', price: 7.25, pDate: '2026-10-18', lastMove: '2026-11-16', lot: 'LOT-2610-FL9', minLvl: 550, lead: 21, shelf: null, peaks: [10, 11, 12], pattern: 'stockout', baseDemand: 920 },
      { sku: 'YRN-CC-30S-RAW', name: 'Combed Ring-Spun Cotton Yarn 30/1 Ne Raw', cat: 'Spinning Yarns', type: 'Combed Yarn', comp: '100% Combed Cotton', color: 'Raw Ecru', family: 'White', gsm: 0, width: 0, constr: 'Ring Spun 30/1', grade: 'A', uom: 'cones', avail: 410, res: 250, wh: 'WH-DHK-01', sup: 'SUP-IND', price: 4.3, pDate: '2026-10-20', lastMove: '2026-11-16', lot: 'LOT-2610-YR3', minLvl: 900, lead: 26, shelf: null, peaks: [1, 2, 11, 12], pattern: 'stockout', baseDemand: 1150 },
      { sku: 'TRM-ZIP-NYL-BLK', name: 'YKK #5 Nylon Coil Zipper 22in Black', cat: 'Trims & Accessories', type: 'Zipper', comp: '100% Polyester Coil', color: 'Jet Black', family: 'Black', gsm: 0, width: 0, constr: 'Coil #5', grade: 'A', uom: 'pcs', avail: 1250, res: 900, wh: 'WH-NAR-03', sup: 'SUP-YKK', price: 0.48, pDate: '2026-10-15', lastMove: '2026-11-15', lot: 'LOT-2610-ZP5', minLvl: 2500, lead: 21, shelf: null, peaks: [10, 11, 12], pattern: 'stockout', baseDemand: 3200 },
      { sku: 'FAB-IN-210-CHR', name: 'Double Knit Interlock 210 GSM Charcoal', cat: 'Knitted Fabrics', type: 'Interlock', comp: '100% Combed Cotton', color: 'Charcoal', family: 'Grey', gsm: 210, width: 68, constr: 'Interlock', grade: 'A', uom: 'kg', avail: 340, res: 120, wh: 'WH-DHK-01', sup: 'SUP-SHN', price: 6.6, pDate: '2026-09-29', lastMove: '2026-11-14', lot: 'LOT-2609-IN2', minLvl: 500, lead: 32, shelf: null, peaks: [11, 12], pattern: 'stockout', baseDemand: 680 },
      { sku: 'FAB-SJ-185-SLT', name: '100% Cotton Single Jersey 185 GSM Slate Blue', cat: 'Knitted Fabrics', type: 'Single Jersey', comp: '100% Combed Cotton', color: 'Slate Blue', family: 'Blue', gsm: 185, width: 72, constr: 'Single Jersey', grade: 'A', uom: 'kg', avail: 1850, res: 0, wh: 'WH-GAZ-02', sup: 'SUP-APX', price: 5.75, pDate: '2025-11-12', lastMove: '2026-02-18', lot: 'LOT-2511-SL8', minLvl: 150, lead: 14, shelf: null, peaks: [5, 6], pattern: 'dead', baseDemand: 25 },
      { sku: 'FAB-SJ-175-MDN', name: 'Combed Cotton Single Jersey 175 GSM Midnight Blue', cat: 'Knitted Fabrics', type: 'Single Jersey', comp: '100% Combed Cotton', color: 'Midnight Blue', family: 'Blue', gsm: 175, width: 70, constr: 'Single Jersey', grade: 'A', uom: 'kg', avail: 1420, res: 0, wh: 'WH-CTG-04', sup: 'SUP-SQC', price: 5.65, pDate: '2025-12-03', lastMove: '2026-03-04', lot: 'LOT-2512-MD2', minLvl: 150, lead: 18, shelf: null, peaks: [4, 5], pattern: 'dead', baseDemand: 18 },
      { sku: 'FAB-FT-275-ASH', name: 'CVC French Terry 275 GSM Ash Melange', cat: 'Knitted Fabrics', type: 'French Terry', comp: '80% Cotton 20% Polyester', color: 'Ash Melange', family: 'Grey', gsm: 275, width: 68, constr: 'French Terry', grade: 'A', uom: 'kg', avail: 2100, res: 0, wh: 'WH-GAZ-02', sup: 'SUP-SQC', price: 6.2, pDate: '2025-10-20', lastMove: '2026-02-09', lot: 'LOT-2510-AS4', minLvl: 200, lead: 18, shelf: null, peaks: [2, 3], pattern: 'dead', baseDemand: 30 },
      { sku: 'FAB-PQ-230-OLI', name: 'Honeycomb Pique 230 GSM Olive Drab', cat: 'Knitted Fabrics', type: 'Pique', comp: '100% Combed Cotton', color: 'Olive Drab', family: 'Green', gsm: 230, width: 70, constr: 'Pique Knit', grade: 'B', uom: 'kg', avail: 1290, res: 0, wh: 'WH-CTG-04', sup: 'SUP-APX', price: 5.5, pDate: '2025-09-15', lastMove: '2026-01-22', lot: 'LOT-2509-OL7', minLvl: 120, lead: 14, shelf: null, peaks: [4, 5], pattern: 'dead', baseDemand: 15 },
      { sku: 'FAB-WV-260-KHK', name: 'Cotton Twill Chino 260 GSM Khaki Sand', cat: 'Woven Fabrics', type: 'Twill', comp: '98% Cotton 2% Elastane', color: 'Khaki Sand', family: 'Beige', gsm: 260, width: 58, constr: '3/1 Twill', grade: 'A', uom: 'meters', avail: 4600, res: 0, wh: 'WH-GAZ-02', sup: 'SUP-SHN', price: 4.15, pDate: '2025-11-28', lastMove: '2026-03-11', lot: 'LOT-2511-KH9', minLvl: 400, lead: 32, shelf: null, peaks: [3, 4], pattern: 'overstock', baseDemand: 110 },
      { sku: 'FAB-FL-310-BRG', name: 'Brushed Fleece 310 GSM Deep Burgundy', cat: 'Knitted Fabrics', type: 'Fleece', comp: '80% Cotton 20% Polyester', color: 'Deep Burgundy', family: 'Red', gsm: 310, width: 70, constr: '3-End Fleece', grade: 'B', uom: 'kg', avail: 1680, res: 0, wh: 'WH-CTG-04', sup: 'SUP-SQC', price: 6.9, pDate: '2025-08-19', lastMove: '2026-01-12', lot: 'LOT-2508-BG3', minLvl: 150, lead: 21, shelf: null, peaks: [1, 2], pattern: 'dead', baseDemand: 12 },
      { sku: 'DYE-RX-TURQ-01', name: 'Reactive Turquoise G-133 Dye Powder', cat: 'Dyeing Auxiliaries', type: 'Reactive Dye', comp: 'Reactive Phthalocyanine Dye', color: 'Turquoise', family: 'Blue', gsm: 0, width: 0, constr: 'Granular Dye', grade: 'A', uom: 'kg', avail: 420, res: 0, wh: 'WH-GAZ-02', sup: 'SUP-SHN', price: 14.5, pDate: '2025-07-10', lastMove: '2026-02-25', lot: 'LOT-2507-DY1', minLvl: 40, lead: 30, shelf: 540, peaks: [4, 5], pattern: 'dead', baseDemand: 8 },
      { sku: 'YRN-ML-24S-GRY', name: 'Viscose Cotton Melange Yarn 24/1 Ne Grey', cat: 'Spinning Yarns', type: 'Melange Yarn', comp: '85% Cotton 15% Viscose', color: 'Grey Melange', family: 'Grey', gsm: 0, width: 0, constr: 'Ring Spun 24/1', grade: 'B', uom: 'cones', avail: 2200, res: 0, wh: 'WH-DHK-01', sup: 'SUP-IND', price: 4.6, pDate: '2025-10-05', lastMove: '2026-03-19', lot: 'LOT-2510-YM6', minLvl: 200, lead: 26, shelf: null, peaks: [5, 6], pattern: 'overstock', baseDemand: 65 },
      { sku: 'TRM-EL-38MM-WHT', name: 'Jacquard Waistband Elastic 38mm Off-White', cat: 'Trims & Accessories', type: 'Elastic', comp: '70% Polyester 30% Spandex', color: 'Off-White', family: 'White', gsm: 0, width: 0, constr: 'Woven Elastic', grade: 'C', uom: 'meters', avail: 8400, res: 0, wh: 'WH-NAR-03', sup: 'SUP-YKK', price: 0.24, pDate: '2025-06-15', lastMove: '2026-01-05', lot: 'LOT-2506-EL2', minLvl: 500, lead: 21, shelf: 720, peaks: [3, 4], pattern: 'dead', baseDemand: 90 },
      { sku: 'FAB-SJ-190-FST', name: '100% Cotton Single Jersey 190 GSM Forest Green', cat: 'Knitted Fabrics', type: 'Single Jersey', comp: '100% Combed Cotton', color: 'Forest Green', family: 'Green', gsm: 190, width: 72, constr: 'Single Jersey', grade: 'A', uom: 'kg', avail: 1340, res: 480, wh: 'WH-DHK-01', sup: 'SUP-APX', price: 5.85, pDate: '2026-05-12', lastMove: '2026-08-05', lot: 'LOT-2605-FG1', minLvl: 250, lead: 14, shelf: null, peaks: [11, 12], pattern: 'slow', baseDemand: 210 },
      { sku: 'FAB-WV-140-LBL', name: '100% Cotton Poplin Shirting 140 GSM Sky Blue', cat: 'Woven Fabrics', type: 'Poplin', comp: '100% Combed Cotton', color: 'Sky Blue', family: 'Blue', gsm: 140, width: 58, constr: 'Plain Weave', grade: 'A', uom: 'meters', avail: 3100, res: 200, wh: 'WH-DHK-01', sup: 'SUP-SHN', price: 3.4, pDate: '2026-04-20', lastMove: '2026-07-18', lot: 'LOT-2604-PP5', minLvl: 450, lead: 32, shelf: null, peaks: [2, 3, 4], pattern: 'overstock', baseDemand: 310 },
      { sku: 'FAB-RB-250-BLK', name: '2x2 Heavy Rib Cuff 250 GSM Jet Black', cat: 'Knitted Fabrics', type: 'Rib 2x2', comp: '95% Cotton 5% Elastane', color: 'Jet Black', family: 'Black', gsm: 250, width: 56, constr: 'Rib 2x2', grade: 'A', uom: 'kg', avail: 980, res: 150, wh: 'WH-GAZ-02', sup: 'SUP-SQC', price: 6.75, pDate: '2026-06-11', lastMove: '2026-09-02', lot: 'LOT-2606-RB4', minLvl: 180, lead: 18, shelf: null, peaks: [10, 11, 12], pattern: 'slow', baseDemand: 190 },
      { sku: 'YRN-PLY-40S-WHT', name: 'Core-Spun Polyester Sewing Thread 40/2 White', cat: 'Spinning Yarns', type: 'Sewing Thread', comp: '100% Polyester', color: 'Optic White', family: 'White', gsm: 0, width: 0, constr: '40/2 Spun', grade: 'A', uom: 'cones', avail: 3400, res: 600, wh: 'WH-NAR-03', sup: 'SUP-YKK', price: 1.85, pDate: '2026-08-14', lastMove: '2026-11-11', lot: 'LOT-2608-TH1', minLvl: 800, lead: 14, shelf: null, peaks: [1, 6, 11], pattern: 'healthy', baseDemand: 950 },
      { sku: 'FAB-PQ-215-NVY', name: 'Micro Pique 215 GSM Navy Blue', cat: 'Knitted Fabrics', type: 'Pique', comp: '100% Combed Cotton', color: 'Navy Blue', family: 'Blue', gsm: 215, width: 72, constr: 'Pique Knit', grade: 'A', uom: 'kg', avail: 1120, res: 100, wh: 'WH-GAZ-02', sup: 'SUP-APX', price: 6.05, pDate: '2026-07-08', lastMove: '2026-09-14', lot: 'LOT-2607-PQ3', minLvl: 220, lead: 14, shelf: null, peaks: [4, 5, 6], pattern: 'slow', baseDemand: 185 },
      { sku: 'FAB-SJ-180-CHR', name: 'Organic Cotton Single Jersey 180 GSM Charcoal', cat: 'Knitted Fabrics', type: 'Single Jersey', comp: '100% Organic Cotton', color: 'Charcoal', family: 'Grey', gsm: 180, width: 72, constr: 'Single Jersey', grade: 'A', uom: 'kg', avail: 1560, res: 300, wh: 'WH-DHK-01', sup: 'SUP-APX', price: 6.45, pDate: '2026-08-22', lastMove: '2026-11-08', lot: 'LOT-2608-OC7', minLvl: 400, lead: 14, shelf: null, peaks: [9, 10, 11], pattern: 'healthy', baseDemand: 610 },
      { sku: 'TRM-LBL-SAT-BLK', name: 'Woven Satin Care Label Roll Black/Silver', cat: 'Trims & Accessories', type: 'Label', comp: '100% Recycled Polyester', color: 'Black', family: 'Black', gsm: 0, width: 0, constr: 'Satin Woven', grade: 'A', uom: 'pcs', avail: 42000, res: 12000, wh: 'WH-NAR-03', sup: 'SUP-YKK', price: 0.04, pDate: '2026-07-20', lastMove: '2026-11-01', lot: 'LOT-2607-LB9', minLvl: 10000, lead: 21, shelf: null, peaks: [10, 11, 12], pattern: 'healthy', baseDemand: 14000 },
      { sku: 'DYE-SFT-SIL-02', name: 'Hydrophilic Silicone Softener Drum 120kg', cat: 'Dyeing Auxiliaries', type: 'Finishing Softener', comp: 'Amino Silicone Emulsion', color: 'Milky White', family: 'White', gsm: 0, width: 0, constr: 'Liquid Emulsion', grade: 'A', uom: 'kg', avail: 1440, res: 240, wh: 'WH-GAZ-02', sup: 'SUP-SHN', price: 3.95, pDate: '2026-08-05', lastMove: '2026-11-10', lot: 'LOT-2608-SF2', minLvl: 360, lead: 28, shelf: 365, peaks: [10, 11, 12], pattern: 'healthy', baseDemand: 480 },
    ];

    const months = [
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
      '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
    ];

    const materialIdBySku = new Map<string, number>();

    for (const s of seeds) {
      const whId = whMap.get(s.wh)!;
      const supId = supMap.get(s.sup)!;
      const catId = catMap.get(s.cat)!;

      const matRes = await client.query<{ id: number }>(
        `INSERT INTO materials (
          sku, name, category_id, material_type, composition, color, color_family,
          gsm, width_inches, construction, quality_grade, uom, available_qty, reserved_qty,
          warehouse_id, supplier_id, purchase_price, purchase_date, last_movement_date,
          batch_number, min_stock_level, lead_time_days, shelf_life_days, seasonal_peak_months, is_synthetic
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,TRUE)
        RETURNING id`,
        [
          s.sku, s.name, catId, s.type, s.comp, s.color, s.family,
          s.gsm, s.width, s.constr, s.grade, s.uom, s.avail, s.res,
          whId, supId, s.price, s.pDate, s.lastMove,
          s.lot, s.minLvl, s.lead, s.shelf, JSON.stringify(s.peaks)
        ]
      );
      const matId = matRes.rows[0].id;
      materialIdBySku.set(s.sku, matId);

      // Build monthly consumption & snapshot
      let runningClosing = s.avail;
      const monthlyConsumptions: number[] = [];
      for (let i = 0; i < months.length; i++) {
        const mNum = Number(months[i].split('-')[1]);
        const isPeak = s.peaks.includes(mNum) ? 1.22 : 0.94;
        const noise = 0.88 + rng() * 0.24;
        let consumed = 0;

        if (s.pattern === 'growing') {
          consumed = s.baseDemand * (0.72 + i * 0.032) * isPeak * noise;
        } else if (s.pattern === 'healthy' || s.pattern === 'stockout') {
          consumed = s.baseDemand * isPeak * noise;
        } else if (s.pattern === 'slow') {
          const decay = Math.max(0.28, 1 - i * 0.055);
          consumed = s.baseDemand * decay * isPeak * noise;
        } else if (s.pattern === 'overstock') {
          const decay = i < 6 ? 1 : Math.max(0.18, 1 - (i - 5) * 0.11);
          consumed = s.baseDemand * decay * noise;
        } else {
          consumed = i < 4 ? s.baseDemand * 6 * (0.8 + rng() * 0.4) : i < 6 ? s.baseDemand : 0;
        }
        consumed = Math.max(0, Math.round(consumed));
        monthlyConsumptions.push(consumed);
      }

      for (let i = months.length - 1; i >= 0; i--) {
        const consumed = monthlyConsumptions[i];
        const received =
          s.pattern === 'dead'
            ? i === 1 ? Math.round(s.avail * 0.9) : 0
            : i % 2 === 0 ? Math.round(consumed * 1.15) : Math.round(consumed * 0.85);
        const snapVal = Number((runningClosing * s.price).toFixed(2));

        await client.query(
          `INSERT INTO inventory_snapshots (material_id, warehouse_id, period_ym, closing_qty, consumed_qty, received_qty, snapshot_value, is_synthetic)
           VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
          [matId, whId, months[i], runningClosing, consumed, received, snapVal]
        );

        if (consumed > 0 && i >= 8) {
          await client.query(
            `INSERT INTO stock_movements (material_id, warehouse_id, movement_type, quantity, reference_code, batch_number, notes, performed_by, movement_date, is_synthetic)
             VALUES ($1,$2,'OUT',$3,$4,$5,$6,1,$7,TRUE)`,
            [matId, whId, consumed, `ISS-${months[i]}-${matId}`, s.lot, `Synthetic monthly floor consumption (${months[i]})`, `${months[i]}-15`]
          );
        }
        if (received > 0 && i >= 10) {
          await client.query(
            `INSERT INTO stock_movements (material_id, warehouse_id, movement_type, quantity, reference_code, batch_number, notes, performed_by, movement_date, is_synthetic)
             VALUES ($1,$2,'IN',$3,$4,$5,$6,1,$7,TRUE)`,
            [matId, whId, received, `GRN-${months[i]}-${matId}`, s.lot, `Synthetic supplier receipt`, `${months[i]}-04`]
          );
        }

        runningClosing = Math.max(10, Math.round(runningClosing + consumed - received));
      }
    }

    // 7. Production Orders & BOM Items
    const p1Res = await client.query<{ id: number }>(
      `INSERT INTO production_orders (order_code, style_name, buyer_name, warehouse_id, status, target_qty, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ['PRD-2026-401', 'Mens Essential Crew Tee (Navy)', 'Nordic Apparel AB', whMap.get('WH-DHK-01'), 'In Progress', 12000, '2026-12-05']
    );
    const p1 = p1Res.rows[0].id;
    await client.query('INSERT INTO bom_items (production_order_id, material_id, required_qty, allocated_qty) VALUES ($1,$2,$3,$4)', [p1, materialIdBySku.get('FAB-SJ-180-NVY'), 1800, 850]);
    await client.query('INSERT INTO bom_items (production_order_id, material_id, required_qty, allocated_qty) VALUES ($1,$2,$3,$4)', [p1, materialIdBySku.get('FAB-RB-240-NVY'), 260, 210]);
    await client.query('INSERT INTO bom_items (production_order_id, material_id, required_qty, allocated_qty) VALUES ($1,$2,$3,$4)', [p1, materialIdBySku.get('YRN-PLY-40S-WHT'), 420, 300]);

    const p2Res = await client.query<{ id: number }>(
      `INSERT INTO production_orders (order_code, style_name, buyer_name, warehouse_id, status, target_qty, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ['PRD-2026-402', 'Winter Zip Hoodie Program', 'Alpen Sport GmbH', whMap.get('WH-NAR-03'), 'Planned', 8500, '2026-12-12']
    );
    const p2 = p2Res.rows[0].id;
    await client.query('INSERT INTO bom_items (production_order_id, material_id, required_qty, allocated_qty) VALUES ($1,$2,$3,$4)', [p2, materialIdBySku.get('FAB-FL-320-BLK'), 1450, 180]);
    await client.query('INSERT INTO bom_items (production_order_id, material_id, required_qty, allocated_qty) VALUES ($1,$2,$3,$4)', [p2, materialIdBySku.get('TRM-ZIP-NYL-BLK'), 8500, 900]);
    await client.query('INSERT INTO bom_items (production_order_id, material_id, required_qty, allocated_qty) VALUES ($1,$2,$3,$4)', [p2, materialIdBySku.get('FAB-RB-250-BLK'), 320, 150]);

    const p3Res = await client.query<{ id: number }>(
      `INSERT INTO production_orders (order_code, style_name, buyer_name, warehouse_id, status, target_qty, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ['PRD-2026-403', 'Athleisure Terry Joggers', 'Urban Loom UK', whMap.get('WH-NAR-03'), 'Planned', 9200, '2026-12-20']
    );
    const p3 = p3Res.rows[0].id;
    await client.query('INSERT INTO bom_items (production_order_id, material_id, required_qty, allocated_qty) VALUES ($1,$2,$3,$4)', [p3, materialIdBySku.get('FAB-FT-280-HGR'), 1750, 700]);
    await client.query('INSERT INTO bom_items (production_order_id, material_id, required_qty, allocated_qty) VALUES ($1,$2,$3,$4)', [p3, materialIdBySku.get('TRM-LBL-SAT-BLK'), 9200, 4000]);

    const p4Res = await client.query<{ id: number }>(
      `INSERT INTO production_orders (order_code, style_name, buyer_name, warehouse_id, status, target_qty, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ['PRD-2026-404', 'Spring Polo Pique Capsule', 'Meridian Retail', whMap.get('WH-DHK-01'), 'Planned', 6400, '2027-01-10']
    );
    const p4 = p4Res.rows[0].id;
    await client.query('INSERT INTO bom_items (production_order_id, material_id, required_qty, allocated_qty) VALUES ($1,$2,$3,$4)', [p4, materialIdBySku.get('FAB-PQ-220-BLK'), 950, 400]);
    await client.query('INSERT INTO bom_items (production_order_id, material_id, required_qty, allocated_qty) VALUES ($1,$2,$3,$4)', [p4, materialIdBySku.get('FAB-SJ-190-FST'), 580, 480]);

    // 8. Purchase Orders
    const po1Res = await client.query<{ id: number }>(
      `INSERT INTO purchase_orders (po_number, supplier_id, warehouse_id, status, expected_delivery_date, total_amount, created_by, approved_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,3,1,$7) RETURNING id`,
      ['PO-2026-881', supMap.get('SUP-APX'), whMap.get('WH-DHK-01'), 'Ordered', '2026-11-24', 11800, 'Standard replenishment for Q4 crew tee run']
    );
    await client.query('INSERT INTO purchase_order_items (purchase_order_id, material_id, ordered_qty, received_qty, unit_price) VALUES ($1,$2,$3,0,$4)', [po1Res.rows[0].id, materialIdBySku.get('FAB-SJ-180-NVY'), 2000, 5.9]);

    const po2Res = await client.query<{ id: number }>(
      `INSERT INTO purchase_orders (po_number, supplier_id, warehouse_id, status, expected_delivery_date, total_amount, created_by, approved_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,3,1,$7) RETURNING id`,
      ['PO-2026-882', supMap.get('SUP-IND'), whMap.get('WH-DHK-01'), 'Approved', '2026-12-02', 6450, 'Urgent yarn replenishment']
    );
    await client.query('INSERT INTO purchase_order_items (purchase_order_id, material_id, ordered_qty, received_qty, unit_price) VALUES ($1,$2,$3,0,$4)', [po2Res.rows[0].id, materialIdBySku.get('YRN-CC-30S-RAW'), 1500, 4.3]);

    // 9. Recovery Recommendations & Actions
    const rec1Res = await client.query<{ id: number }>(
      `INSERT INTO recovery_recommendations (material_id, strategy, recoverable_qty, gross_estimated_value, estimated_costs, net_estimated_value, value_type, assumptions_json, target_reference, approval_status, approved_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        materialIdBySku.get('FAB-SJ-185-SLT'), 'Reuse in Production', 950, 5605.0, 448.4, 5156.6,
        'Avoided Procurement Cost',
        JSON.stringify(['87% compatibility with FAB-SJ-180-NVY (PRD-2026-401)', 'Includes 8% shade over-dye / QC allowance ($448.40)']),
        'PRD-2026-401', 'Pending Review', null, 'Awaiting Production Planner & QC shade lab-dip review'
      ]
    );
    void rec1Res;

    const rec2Res = await client.query<{ id: number }>(
      `INSERT INTO recovery_recommendations (material_id, strategy, recoverable_qty, gross_estimated_value, estimated_costs, net_estimated_value, value_type, assumptions_json, target_reference, approval_status, approved_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        materialIdBySku.get('FAB-FT-275-ASH'), 'Reuse in Production', 1050, 6720.0, 537.6, 6182.4,
        'Avoided Procurement Cost',
        JSON.stringify(['89% compatibility with FAB-FT-280-HGR (PRD-2026-403)', 'Includes 8% finishing & marker check ($537.60)']),
        'PRD-2026-403', 'Executed', 1, 'Approved for Athleisure Terry Joggers secondary colorway'
      ]
    );
    const rec2 = rec2Res.rows[0].id;
    await client.query(
      `INSERT INTO recovery_actions (recommendation_id, action_type, actual_recovered_qty, realized_net_value, executed_by, outcome_notes)
       VALUES ($1,$2,$3,$4,2,$5)`,
      [rec2, 'Production Substitution Issued', 980, 5740.0, 'Issued 980 kg to Narayanganj cutting floor after QC GSM approval']
    );

    const rec3Res = await client.query<{ id: number }>(
      `INSERT INTO recovery_recommendations (material_id, strategy, recoverable_qty, gross_estimated_value, estimated_costs, net_estimated_value, value_type, assumptions_json, target_reference, approval_status, approved_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        materialIdBySku.get('FAB-PQ-230-OLI'), 'Resale / Liquidation', 1290, 2838.0, 380.56, 2457.44,
        'Recovery Revenue',
        JSON.stringify(['Grade B secondary stocklot estimated at 40% of $7,095 book value', '12% brokerage + $40 local freight']),
        'Stocklot Secondary Market', 'Approved', 2, 'Approved by Inventory Manager for local stocklot tender'
      ]
    );
    void rec3Res;

    // 10. Notifications
    const notifs: [string, string, string, string][] = [
      ['critical', 'Stockout Exposure: Brushed Fleece 320 GSM', 'Net effective stock (110 kg free) covers only ~3.6 days vs 21-day supplier lead time.', 'FAB-FL-320-BLK'],
      ['critical', 'Critical Shortage: Cotton Yarn 30/1 Ne Raw', '160 free cones remaining against 1,150 cones/mo consumption; PO-2026-882 incoming Dec 02.', 'YRN-CC-30S-RAW'],
      ['warning', 'Dead Stock Value Alert: Slate Blue Jersey 185 GSM', '$10,637.50 idle for 272 days in WH-GAZ-02; 87% compatible with PRD-2026-401.', 'FAB-SJ-185-SLT'],
      ['info', 'Recovery Realized: Ash Melange French Terry', '$5,740.00 net procurement cost avoided via PRD-2026-403 substitution.', 'FAB-FT-275-ASH'],
    ];
    for (const [sev, title, msg, sku] of notifs) {
      await client.query(
        'INSERT INTO notifications (severity, title, message, material_id) VALUES ($1,$2,$3,$4)',
        [sev, title, msg, materialIdBySku.get(sku)]
      );
    }

    // 11. Audit Log
    await client.query(
      'INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details) VALUES (1,$1,$2,$3,$4,$5)',
      [
        'admin@stockmind.ai', 'SEED_SYNTHETIC_DATASET', 'system', 'stockmind-v1',
        'Initialized synthetic knitwear & textile manufacturing dataset (26 SKUs, 4 warehouses, 14-month snapshot history).'
      ]
    );

    await client.query('COMMIT');
    console.log('[Seed] Database seeded successfully with synthetic StockMind AI dataset.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Seed] Seeding failed, rolling back:', (err as Error).message);
    throw err;
  } finally {
    client.release();
  }
}
