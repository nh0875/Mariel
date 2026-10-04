// Base de datos: un único archivo SQLite en /data/vinoh.db.
// Usamos node:sqlite (viene con Node 22.13+), así no hay que compilar nada al instalar.
import './lib/quiet'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDirEnv = process.env.VINOH_DATA_DIR
export const IN_MEMORY = dataDirEnv === ':memory:'
export const DATA_DIR = IN_MEMORY ? '' : path.resolve(dataDirEnv || path.join(PROJECT_ROOT, 'data'))
export const DB_PATH = IN_MEMORY ? ':memory:' : path.join(DATA_DIR, 'vinoh.db')
export const BACKUP_DIR = IN_MEMORY ? '' : path.join(DATA_DIR, 'backups')

let _db: DatabaseSync | null = null

export function db(): DatabaseSync {
  if (!_db) _db = openDatabase()
  return _db
}

function openDatabase(): DatabaseSync {
  if (!IN_MEMORY) fs.mkdirSync(DATA_DIR, { recursive: true })
  const conn = new DatabaseSync(DB_PATH)
  conn.exec('PRAGMA foreign_keys = ON')
  if (!IN_MEMORY) conn.exec('PRAGMA journal_mode = WAL')
  conn.exec('PRAGMA busy_timeout = 5000')
  migrate(conn)
  return conn
}

/** Cierra la conexión (se usa al restaurar un backup y en los tests). */
export function closeDatabase() {
  if (_db) {
    _db.close()
    _db = null
  }
}

/** Abre una base nueva en memoria (para tests). */
export function resetInMemoryDatabase() {
  if (!IN_MEMORY) throw new Error('Solo disponible con VINOH_DATA_DIR=:memory:')
  closeDatabase()
  _db = openDatabase()
}

// ───────────────────────── Helpers de consulta ─────────────────────────

type Param = SQLInputValue | boolean | undefined
export type Params = Param[] | Record<string, Param>

function normalizeValue(v: Param): SQLInputValue {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

function normalize(params?: Params): SQLInputValue[] | Record<string, SQLInputValue>[] {
  if (!params) return []
  if (Array.isArray(params)) return params.map(normalizeValue)
  const out: Record<string, SQLInputValue> = {}
  for (const [k, v] of Object.entries(params)) out[k] = normalizeValue(v)
  return [out]
}

/** Devuelve todas las filas. Params: array (para ?) u objeto (para :nombre). */
export function all<T = Record<string, unknown>>(sql: string, params?: Params): T[] {
  return db()
    .prepare(sql)
    .all(...(normalize(params) as SQLInputValue[]))
    .map((r) => ({ ...r }) as T)
}

/** Devuelve la primera fila o undefined. */
export function get<T = Record<string, unknown>>(sql: string, params?: Params): T | undefined {
  const row = db()
    .prepare(sql)
    .get(...(normalize(params) as SQLInputValue[]))
  return row ? ({ ...row } as T) : undefined
}

/** Ejecuta un INSERT/UPDATE/DELETE. Devuelve { changes, lastInsertRowid }. */
export function run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
  const r = db()
    .prepare(sql)
    .run(...(normalize(params) as SQLInputValue[]))
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
}

/** Valor escalar (primera columna de la primera fila). */
export function scalar<T = number>(sql: string, params?: Params): T {
  const row = get<Record<string, unknown>>(sql, params)
  return (row ? Object.values(row)[0] : null) as T
}

let txDepth = 0
/**
 * Ejecuta fn dentro de una transacción: o se guarda todo, o nada.
 * Se puede anidar (usa SAVEPOINT).
 */
export function tx<T>(fn: () => T): T {
  const conn = db()
  const sp = `sp_${txDepth}`
  if (txDepth === 0) conn.exec('BEGIN')
  else conn.exec(`SAVEPOINT ${sp}`)
  txDepth++
  try {
    const result = fn()
    txDepth--
    if (txDepth === 0) conn.exec('COMMIT')
    else conn.exec(`RELEASE ${sp}`)
    return result
  } catch (err) {
    txDepth--
    if (txDepth === 0) conn.exec('ROLLBACK')
    else conn.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`)
    throw err
  }
}

/** Convierte columnas 0/1 a boolean. */
export function withBools<T extends Record<string, unknown>>(row: T, keys: string[]): T {
  const out: Record<string, unknown> = { ...row }
  for (const k of keys) if (k in out) out[k] = !!out[k]
  return out as T
}

// ───────────────────────── Esquema ─────────────────────────

const MIGRATIONS: string[] = [
  // v1: esquema inicial
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    winery TEXT,
    varietal TEXT,
    wine_type TEXT NOT NULL DEFAULT 'tinto',
    vintage INTEGER,
    region TEXT,
    size_ml INTEGER NOT NULL DEFAULT 750,
    sku TEXT,
    unit_cost REAL NOT NULL DEFAULT 0,
    price_retail REAL NOT NULL DEFAULT 0,
    price_wholesale REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 6,
    units_per_box INTEGER NOT NULL DEFAULT 6,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  );

  CREATE TABLE clients (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'consumidor',
    phone TEXT, email TEXT, tax_id TEXT, address TEXT, city TEXT, notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'bodega',
    contact_name TEXT, phone TEXT, email TEXT, tax_id TEXT, address TEXT, notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'degustacion',
    location TEXT,
    attendees INTEGER,
    ticket_price REAL,
    budget REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'efectivo',
    initial_balance REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE sales (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    channel TEXT NOT NULL DEFAULT 'local',
    price_list TEXT NOT NULL DEFAULT 'minorista',
    payment_method TEXT NOT NULL DEFAULT 'efectivo',
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    shipping REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    fee REAL NOT NULL DEFAULT 0,
    due_date TEXT,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    description TEXT,
    qty INTEGER NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE purchases (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    invoice_number TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    shipping REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    due_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE purchase_items (
    id INTEGER PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0,
    landed_unit_cost REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    date TEXT NOT NULL,
    kind TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0,
    ref_type TEXT,
    ref_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE recurring_expenses (
    id INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    nature TEXT NOT NULL DEFAULT 'fijo',
    day_of_month INTEGER NOT NULL DEFAULT 10,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    auto_paid INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    nature TEXT NOT NULL DEFAULT 'variable',
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    due_date TEXT,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    recurring_id INTEGER REFERENCES recurring_expenses(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    direction TEXT NOT NULL CHECK (direction IN ('in','out')),
    amount REAL NOT NULL CHECK (amount >= 0),
    ref_type TEXT NOT NULL,
    ref_id INTEGER,
    transfer_id TEXT,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE goals (
    month TEXT PRIMARY KEY,
    sales_target REAL,
    bottles_target INTEGER,
    expense_budget REAL,
    notes TEXT
  );

  CREATE TABLE inflation (
    month TEXT PRIMARY KEY,
    rate REAL NOT NULL
  );

  CREATE INDEX idx_sales_date ON sales(date);
  CREATE INDEX idx_sales_client ON sales(client_id);
  CREATE INDEX idx_sales_event ON sales(event_id);
  CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
  CREATE INDEX idx_sale_items_product ON sale_items(product_id);
  CREATE INDEX idx_purchases_date ON purchases(date);
  CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
  CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
  CREATE INDEX idx_expenses_date ON expenses(date);
  CREATE INDEX idx_expenses_event ON expenses(event_id);
  CREATE INDEX idx_movements_product ON stock_movements(product_id, date, id);
  CREATE INDEX idx_movements_ref ON stock_movements(ref_type, ref_id);
  CREATE INDEX idx_movements_date ON stock_movements(date);
  CREATE INDEX idx_payments_ref ON payments(ref_type, ref_id);
  CREATE INDEX idx_payments_account ON payments(account_id, date);
  CREATE INDEX idx_payments_date ON payments(date);
  `,
]

function migrate(conn: DatabaseSync) {
  const row = conn.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = Number(row.user_version)
  while (version < MIGRATIONS.length) {
    conn.exec('BEGIN')
    try {
      conn.exec(MIGRATIONS[version])
      version++
      conn.exec(`PRAGMA user_version = ${version}`)
      conn.exec('COMMIT')
    } catch (err) {
      conn.exec('ROLLBACK')
      throw err
    }
  }
}

/** Tablas con datos del negocio (en orden seguro para borrar). */
export const DATA_TABLES = [
  'payments',
  'stock_movements',
  'sale_items',
  'sales',
  'purchase_items',
  'purchases',
  'expenses',
  'recurring_expenses',
  'events',
  'goals',
  'inflation',
  'products',
  'clients',
  'suppliers',
  'accounts',
] as const
