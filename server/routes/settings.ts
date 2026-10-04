// Configuración, copias de seguridad, datos de ejemplo, exportación completa e información del sistema.
// (Ver docs/ARQUITECTURA.md → módulo "Configuración")
//
// Reglas que se respetan acá:
// - La configuración se guarda por partes (PUT /settings con solo las claves que cambian): cada
//   sección de la pantalla guarda lo suyo sin pisar lo de las demás.
// - Antes de cualquier operación que reemplaza datos (cargar ejemplo, borrar todo, restaurar) se
//   guarda una copia de seguridad, así siempre hay vuelta atrás.
// - Los saldos y estados de cobro/pago del Excel completo salen de los mismos servicios que usan
//   las pantallas (listSales/listPurchases/listExpenses/accountBalances), así los números coinciden.
import express, { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { settingsInput } from '../../shared/schemas'
import {
  ACCOUNT_KIND_LABELS,
  CLIENT_KIND_LABELS,
  EVENT_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_REF_LABELS,
  PRICE_LIST_LABELS,
  SALE_CHANNEL_LABELS,
  STOCK_MOVEMENT_LABELS,
  SUPPLIER_KIND_LABELS,
  WINE_TYPE_LABELS,
  type AccountKind,
  type ClientKind,
  type EventKind,
  type PaymentStatus,
  type PaymentMethod,
  type PaymentRefType,
  type PriceList,
  type SaleChannel,
  type StockMovementKind,
  type SupplierKind,
  type WineType,
} from '../../shared/constants'
import { marginOnPrice, round2 } from '../../shared/calc'
import { monthLabelLong } from '../../shared/dates'
import type { Client, Goal, InflationRate, Product, RecurringExpense, Supplier, WineEvent } from '../../shared/types'
import { all, BACKUP_DIR, DATA_DIR, DATA_TABLES, DB_PATH, IN_MEMORY, PROJECT_ROOT, run, scalar, tx } from '../db'
import { HttpError, badRequest, notFound, validate } from '../lib/http'
import { addSheet, excelFilename, newWorkbook, sendWorkbookFile, type ExcelSheet } from '../lib/excel'
import { backupPath, createBackup, listBackups, restoreFromBuffer, restoreFromFile, type BackupInfo } from '../lib/backup'
import { getSettings, updateSettings } from '../services/settings'
import { loadDemoData } from '../seed/demo'
import { ensureBaseData, wipeAllData } from '../services/setup'
import { listSales } from '../services/sales'
import { listPurchases } from '../services/purchases'
import { listExpenses } from '../services/expenses'
import { accountBalances } from '../services/payments'

const router = Router()

// ───────────────────────── Configuración ─────────────────────────

router.get('/settings', (_req, res) => {
  res.json(getSettings())
})

const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Renombres de categorías que manda la pantalla junto con la lista nueva ({ from, to }).
 * Los gastos ya cargados NO cambian (quedan como se registraron), pero los gastos fijos sí: son
 * plantillas para los meses que vienen, y si quedaran con el nombre viejo seguirían generando gastos
 * con una categoría que ya no está en la lista.
 */
const categoryRenames = z
  .array(z.object({ from: z.string().trim().min(1).max(80), to: z.string().trim().min(1).max(80) }))
  .max(100)
  .optional()

/** Guarda solo las claves que vienen (los objetos como "business" se mezclan con lo que ya había). */
router.put('/settings', (req, res) => {
  const patch = validate(settingsInput, req.body)
  const renames = validate(categoryRenames, (req.body as Record<string, unknown> | undefined)?.category_renames) ?? []
  if (patch.expense_categories) {
    const seen = new Set<string>()
    for (const c of patch.expense_categories) {
      const k = normName(c.name)
      if (seen.has(k)) throw badRequest(`La categoría «${c.name}» está repetida. Dejá una sola.`)
      seen.add(k)
    }
  }
  if (patch.payment_methods) {
    // Se guardan por medio de pago: los que no vienen quedan como estaban (así nunca se pierde uno).
    const seen = new Set<string>()
    for (const m of patch.payment_methods) {
      if (seen.has(m.key)) throw badRequest(`El medio de pago «${m.label}» vino repetido. Recargá la página y probá de nuevo.`)
      seen.add(m.key)
    }
    const accounts = all<{ id: number; name: string; active: number }>('SELECT id, name, active FROM accounts')
    for (const m of patch.payment_methods) {
      if (m.account_id == null) continue
      const acc = accounts.find((a) => a.id === m.account_id)
      if (!acc) throw badRequest(`La cuenta elegida para «${m.label}» ya no existe. Elegí otra.`)
      if (!acc.active) throw badRequest(`La cuenta «${acc.name}» (elegida para «${m.label}») está desactivada. Elegí una cuenta activa.`)
    }
    const current = getSettings().payment_methods
    const byKey = new Map(patch.payment_methods.map((m) => [m.key, m]))
    const merged = current.map((m) => ({ ...m, ...(byKey.get(m.key) ?? {}) }))
    for (const m of patch.payment_methods) if (!current.some((c) => c.key === m.key)) merged.push(m)
    patch.payment_methods = merged
  }
  const result = tx(() => {
    const saved = updateSettings(patch)
    if (patch.expense_categories && renames.length) {
      const names = new Set(saved.expense_categories.map((c) => c.name))
      for (const r of renames) {
        if (r.from === r.to || !names.has(r.to)) continue
        run('UPDATE recurring_expenses SET category = ? WHERE category = ?', [r.to, r.from])
      }
    }
    return saved
  })
  res.json(result)
})

/**
 * Cuántos gastos (y gastos fijos) usan cada categoría. Sirve para avisar antes de renombrar o sacar
 * una categoría, y para mostrar las categorías "viejas" que siguen en gastos cargados.
 */
router.get('/settings/category-usage', (_req, res) => {
  const settings = getSettings()
  const usage = new Map<string, { expenses: number; amount: number; recurring: number; last_date: string | null }>()
  for (const r of all<{ category: string; n: number; amount: number; last: string | null }>(
    'SELECT category, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount, MAX(date) AS last FROM expenses GROUP BY category',
  )) {
    usage.set(r.category, { expenses: r.n, amount: round2(r.amount), recurring: 0, last_date: r.last })
  }
  for (const r of all<{ category: string; n: number }>('SELECT category, COUNT(*) AS n FROM recurring_expenses GROUP BY category')) {
    const u = usage.get(r.category) ?? { expenses: 0, amount: 0, recurring: 0, last_date: null }
    u.recurring = r.n
    usage.set(r.category, u)
  }
  const names = new Set(settings.expense_categories.map((c) => c.name))
  const empty = { expenses: 0, amount: 0, recurring: 0, last_date: null }
  res.json({
    categories: settings.expense_categories.map((c) => ({ ...c, ...(usage.get(c.name) ?? empty) })),
    /** Categorías que aparecen en gastos cargados pero ya no están en la lista. */
    others: [...usage.entries()].filter(([name]) => !names.has(name)).map(([name, u]) => ({ name, ...u })),
  })
})

// ───────────────────────── Datos de ejemplo / borrar todo ─────────────────────────

/** Borra todo y carga los datos de ejemplo (antes guarda una copia de seguridad). */
router.post('/demo/load', async (_req, res) => {
  if (!IN_MEMORY) {
    await freeBackupSecond()
    createBackup('antes-de-ejemplo')
  }
  const counts = loadDemoData()
  res.json({ ok: true, ...counts })
})

/**
 * Borra todos los datos del negocio (antes guarda una copia de seguridad). La configuración se mantiene.
 * Con { restart_onboarding: true } vuelve a mostrar la bienvenida (para cargar saldos iniciales, etc.).
 */
router.post('/data/reset', async (req, res) => {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { restart_onboarding?: unknown }
  if (!IN_MEMORY) {
    await freeBackupSecond()
    createBackup('antes-de-borrar')
  }
  wipeAllData()
  ensureBaseData()
  if (body.restart_onboarding === true) updateSettings({ onboarding: { completed: false, demo_loaded: false } })
  res.json({ ok: true })
})

// ───────────────────────── Copias de seguridad ─────────────────────────

const KEEP_BACKUPS = 30
const NO_DISK_MSG =
  'Este sistema está funcionando sin guardar en disco (modo de prueba), así que no hay copias de seguridad para hacer, bajar ni restaurar.'

function requireDisk() {
  if (IN_MEMORY) throw badRequest(NO_DISK_MSG)
}

/**
 * lib/backup.ts nombra las copias con precisión de segundos ("vinoh-manual-2026-01-31-10-00-00.db"):
 * dos copias del mismo tipo en el mismo segundo chocan ("output file already exists"). Antes de hacer
 * una copia (o restaurar, que también hace una), si ya hay una de este segundo esperamos al siguiente.
 */
async function freeBackupSecond() {
  if (IN_MEMORY) return
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  let taken = false
  try {
    taken = fs.readdirSync(BACKUP_DIR).some((f) => f.includes(stamp))
  } catch {
    taken = false
  }
  if (taken) await new Promise((r) => setTimeout(r, 1000 - (Date.now() % 1000) + 25))
}

const BACKUP_KIND_LABELS: Record<string, string> = {
  auto: 'Automática del día',
  manual: 'Hecha a mano',
  'antes-de-restaurar': 'Antes de restaurar otra copia',
  'antes-de-ejemplo': 'Antes de cargar datos de ejemplo',
  'antes-de-demo': 'Antes de cargar datos de ejemplo',
  'antes-de-borrar': 'Antes de borrar todo',
}

export interface BackupRow extends BackupInfo {
  kind: string
  label: string
}

function describeBackup(b: BackupInfo): BackupRow {
  const m = /^vinoh-(.+)-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/.exec(b.file)
  const kind = m ? m[1] : 'otra'
  return { ...b, kind, label: BACKUP_KIND_LABELS[kind] ?? 'Copia de seguridad' }
}

function mustBackup(file: string): string {
  try {
    return backupPath(file)
  } catch {
    throw notFound('esa copia de seguridad')
  }
}

/** Copias guardadas (la más nueva primero) + dónde están los datos. */
router.get('/backups', (_req, res) => {
  res.json({
    available: !IN_MEMORY,
    message: IN_MEMORY ? NO_DISK_MSG : null,
    data_dir: DATA_DIR,
    db_path: DB_PATH,
    backup_dir: BACKUP_DIR,
    keep: KEEP_BACKUPS,
    backups: listBackups().map(describeBackup),
  })
})

/** Hace una copia ahora. */
router.post('/backups', async (_req, res) => {
  requireDisk()
  await freeBackupSecond()
  const file = path.basename(createBackup('manual'))
  const info = listBackups().find((b) => b.file === file)
  if (!info) throw new HttpError(500, 'La copia se hizo pero no la encontramos en la carpeta. Probá de nuevo.')
  res.status(201).json(describeBackup(info))
})

router.get('/backups/:file/download', (req, res, next) => {
  requireDisk()
  const full = mustBackup(String(req.params.file))
  res.download(full, path.basename(full), (err) => {
    if (err && !res.headersSent) next(err)
  })
})

/**
 * Vuelve a una copia guardada. Antes guarda una copia del estado actual ("antes de restaurar").
 * Se trabaja sobre una copia temporal del archivo para que la limpieza de copias viejas no lo borre
 * en el medio.
 */
router.post('/backups/:file/restore', async (req, res) => {
  requireDisk()
  const full = mustBackup(String(req.params.file))
  await freeBackupSecond()
  const tmp = path.join(BACKUP_DIR, `restaurando-${Date.now()}.tmp`)
  fs.copyFileSync(full, tmp)
  try {
    restoreFromFile(tmp)
  } catch (err) {
    throw badRequest((err as Error).message || 'No se pudo restaurar esa copia.')
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ya no está */
    }
  }
  ensureBaseData()
  res.json({ ok: true, restored: path.basename(full) })
})

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1')

/** Restaurar desde un archivo .db subido (por ejemplo, una copia traída de otra computadora). */
router.post('/backups/restore-upload', express.raw({ type: () => true, limit: '200mb' }), async (req, res) => {
  requireDisk()
  const buf = req.body as unknown
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw badRequest('No llegó ningún archivo. Elegí la copia (.db) y probá de nuevo.')
  if (buf.length < 100 || !buf.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
    throw badRequest('Ese archivo no es una copia de seguridad de VINOH!. Tiene que ser un archivo que termine en .db (por ejemplo, vinoh-manual-2026-01-31-….db).')
  }
  await freeBackupSecond()
  try {
    restoreFromBuffer(buf)
  } catch (err) {
    throw badRequest((err as Error).message || 'No se pudo restaurar ese archivo.')
  }
  ensureBaseData()
  res.json({ ok: true })
})

// ───────────────────────── Información del sistema ─────────────────────────

const TABLE_LABELS: Record<(typeof DATA_TABLES)[number], string> = {
  products: 'Vinos',
  stock_movements: 'Movimientos de stock',
  sales: 'Ventas',
  sale_items: 'Renglones de ventas',
  purchases: 'Compras',
  purchase_items: 'Renglones de compras',
  expenses: 'Gastos',
  recurring_expenses: 'Gastos fijos',
  accounts: 'Cuentas',
  payments: 'Movimientos de caja',
  clients: 'Clientes',
  suppliers: 'Proveedores',
  events: 'Eventos',
  goals: 'Metas',
  inflation: 'Meses con inflación',
}
const TABLE_ORDER: (typeof DATA_TABLES)[number][] = [
  'products',
  'sales',
  'purchases',
  'expenses',
  'recurring_expenses',
  'payments',
  'stock_movements',
  'accounts',
  'clients',
  'suppliers',
  'events',
  'goals',
  'inflation',
  'sale_items',
  'purchase_items',
]

let cachedVersion: string | null = null
function appVersion(): string {
  if (cachedVersion) return cachedVersion
  try {
    cachedVersion = String(JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version ?? '—')
  } catch {
    cachedVersion = '—'
  }
  return cachedVersion
}

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}

router.get('/system', (_req, res) => {
  const backups = listBackups()
  const last = backups[0] ? describeBackup(backups[0]) : null
  res.json({
    version: appVersion(),
    node: process.version,
    platform: process.platform,
    in_memory: IN_MEMORY,
    db_path: DB_PATH,
    data_dir: DATA_DIR,
    backup_dir: BACKUP_DIR,
    db_size: IN_MEMORY ? 0 : fileSize(DB_PATH) + fileSize(DB_PATH + '-wal'),
    counts: TABLE_ORDER.map((table) => ({ table, label: TABLE_LABELS[table], count: scalar<number>(`SELECT COUNT(*) FROM ${table}`) ?? 0 })),
    last_backup: last,
    backups_count: backups.length,
  })
})

// ───────────────────────── Excel con TODO ─────────────────────────

const yesNo = (v: unknown) => (v ? 'Sí' : 'No')
const STATUS_SALE: Record<PaymentStatus, string> = { pagado: 'Cobrada', parcial: 'Cobro parcial', pendiente: 'Por cobrar' }
const STATUS_PAY: Record<PaymentStatus, string> = { pagado: 'Pagada', parcial: 'Pago parcial', pendiente: 'Por pagar' }
const STATUS_EXPENSE: Record<PaymentStatus, string> = { pagado: 'Pagado', parcial: 'Pago parcial', pendiente: 'Por pagar' }
const REF_PREFIX: Partial<Record<PaymentRefType, string>> = { sale: 'Venta', sale_fee: 'Venta', purchase: 'Compra', expense: 'Gasto' }

function sheet<T>(s: ExcelSheet<T>): ExcelSheet<T> {
  return s
}

/** Arma todas las hojas (sin la de "Léeme"). Exportado para poder probarlo. */
export function buildFullExport() {
  const sales = listSales()
  const purchases = listPurchases()
  const expenses = listExpenses()

  // ── Vinos
  const products = all<Product>('SELECT * FROM products ORDER BY active DESC, name COLLATE NOCASE')
  const productName = new Map(products.map((p) => [p.id, `${p.name}${p.vintage ? ` ${p.vintage}` : ''}`]))
  const vinos = sheet<Product>({
    name: 'Vinos',
    title: 'Vinos y stock',
    columns: [
      { header: 'Vino', key: 'name', width: 30 },
      { header: 'Bodega', key: 'winery', width: 24 },
      { header: 'Varietal', key: 'varietal', width: 18 },
      { header: 'Tipo', key: 'wine_type', value: (p) => WINE_TYPE_LABELS[p.wine_type as WineType] ?? p.wine_type },
      { header: 'Cosecha', key: 'vintage', type: 'int', total: false, width: 10 },
      { header: 'Región', key: 'region', width: 22 },
      { header: 'Tamaño (ml)', key: 'size_ml', type: 'int', total: false, width: 11 },
      { header: 'Código (SKU)', key: 'sku' },
      { header: 'Costo por botella', key: 'unit_cost', type: 'money', total: false },
      { header: 'Precio minorista', key: 'price_retail', type: 'money', total: false },
      { header: 'Precio mayorista', key: 'price_wholesale', type: 'money', total: false },
      { header: 'Margen minorista', key: 'margin', type: 'percent', value: (p) => (p.price_retail > 0 ? marginOnPrice(p.price_retail, p.unit_cost) : null) },
      { header: 'Botellas en stock', key: 'stock', type: 'int' },
      { header: 'Stock mínimo', key: 'min_stock', type: 'int', total: false },
      { header: 'Botellas por caja', key: 'units_per_box', type: 'int', total: false },
      { header: 'Valor del stock (a costo)', key: 'stock_value', type: 'money', value: (p) => round2(Math.max(p.stock, 0) * p.unit_cost) },
      { header: 'Activo', key: 'active', value: (p) => yesNo(p.active) },
      { header: 'Notas', key: 'notes', width: 30 },
    ],
    rows: products,
    notes: [
      'Una fila por vino. El costo por botella es el costo promedio de tus compras (con el flete incluido); lo calcula el sistema solo.',
      'Margen minorista = (precio minorista − costo) ÷ precio minorista. Ej: costo $6.000 y precio $10.000 → 40 %.',
      'Valor del stock = botellas × costo por botella: es la plata que tenés "invertida" en ese vino.',
    ],
  })

  // ── Movimientos de stock
  type MovRow = { id: number; product_id: number; date: string; kind: StockMovementKind; qty: number; unit_cost: number; ref_type: string | null; ref_id: number | null; notes: string | null; sale_id: number | null; purchase_id: number | null; event_name: string | null }
  const movements = all<MovRow>(
    `SELECT m.*,
       CASE WHEN m.ref_type = 'sale_item' THEN (SELECT si.sale_id FROM sale_items si WHERE si.id = m.ref_id) END AS sale_id,
       CASE WHEN m.ref_type = 'purchase_item' THEN (SELECT pi.purchase_id FROM purchase_items pi WHERE pi.id = m.ref_id) END AS purchase_id,
       CASE WHEN m.ref_type = 'event' THEN (SELECT e.name FROM events e WHERE e.id = m.ref_id) END AS event_name
     FROM stock_movements m ORDER BY m.date DESC, m.id DESC`,
  )
  const movimientos = sheet<MovRow>({
    name: 'Movimientos de stock',
    title: 'Movimientos de stock (entradas y salidas de botellas)',
    columns: [
      { header: 'Fecha', key: 'date', type: 'date' },
      { header: 'Vino', key: 'product', width: 30, value: (m) => productName.get(m.product_id) ?? '—' },
      { header: 'Movimiento', key: 'kind', width: 24, value: (m) => STOCK_MOVEMENT_LABELS[m.kind] ?? m.kind },
      { header: 'Botellas (+ entra / − sale)', key: 'qty', type: 'int', width: 14 },
      { header: 'Costo por botella', key: 'unit_cost', type: 'money', total: false },
      { header: 'Valorizado a costo', key: 'value', type: 'money', value: (m) => round2(m.qty * m.unit_cost) },
      {
        header: 'Origen',
        key: 'origin',
        width: 22,
        value: (m) => (m.sale_id ? `Venta Nº ${m.sale_id}` : m.purchase_id ? `Compra Nº ${m.purchase_id}` : m.event_name ? `Evento: ${m.event_name}` : 'Carga manual'),
      },
      { header: 'Nota', key: 'notes', width: 30 },
    ],
    rows: movements,
    notes: [
      'El stock de cada vino es la suma de estos movimientos: las compras suman, las ventas, roturas, degustaciones y regalos restan.',
      '"Cambio de costo" no mueve botellas: fija un costo nuevo desde esa fecha.',
      'El total de "Botellas" es el stock total de todos los vinos; el de "Valorizado" es lo que entró menos lo que salió, a costo.',
    ],
  })

  // ── Ventas
  type SaleRow = (typeof sales)[number]
  const ventas = sheet<SaleRow>({
    name: 'Ventas',
    title: 'Ventas',
    columns: [
      { header: 'Nº', key: 'id', type: 'int', total: false, width: 8 },
      { header: 'Fecha', key: 'date', type: 'date' },
      { header: 'Cliente', key: 'client_name', width: 24 },
      { header: 'Canal', key: 'channel', width: 22, value: (s) => SALE_CHANNEL_LABELS[s.channel as SaleChannel] ?? s.channel },
      { header: 'Lista de precios', key: 'price_list', value: (s) => PRICE_LIST_LABELS[s.price_list as PriceList] ?? s.price_list },
      { header: 'Medio de pago', key: 'payment_method', width: 18, value: (s) => PAYMENT_METHOD_LABELS[s.payment_method as PaymentMethod] ?? s.payment_method },
      { header: 'Botellas', key: 'bottles', type: 'int', width: 10 },
      { header: 'Subtotal', key: 'subtotal', type: 'money' },
      { header: 'Descuento', key: 'discount', type: 'money' },
      { header: 'Envío cobrado', key: 'shipping', type: 'money' },
      { header: 'Total', key: 'total', type: 'money' },
      { header: 'Comisión del medio de pago', key: 'fee', type: 'money' },
      { header: 'Costo del vino (CMV)', key: 'cost', type: 'money' },
      { header: 'Ganancia de la venta', key: 'profit', type: 'money' },
      { header: 'Cobrado', key: 'paid', type: 'money' },
      { header: 'Falta cobrar', key: 'balance', type: 'money' },
      { header: 'Estado', key: 'status', width: 14, value: (s) => (s.overdue ? 'Vencida' : STATUS_SALE[s.status]) },
      { header: 'Vence', key: 'due_date', type: 'date' },
      { header: 'Evento', key: 'event_name', width: 22 },
      { header: 'Nota', key: 'notes', width: 30 },
    ],
    rows: sales,
    notes: [
      'Total = subtotal − descuento + envío cobrado. Es lo que paga el cliente.',
      'Ganancia de la venta = total − comisión − costo del vino. Todavía no descuenta gastos (alquiler, sueldos…): eso está en la hoja Gastos.',
      'Las ventas cuentan el día que vendiste aunque te paguen después: lo que falta cobrar está en "Falta cobrar".',
      'El detalle de qué vinos tiene cada venta está en la hoja "Detalle de ventas" (buscá por el Nº).',
    ],
  })

  type SaleItemRow = { sale_id: number; date: string; product_id: number | null; product_name: string | null; description: string | null; qty: number; unit_price: number; unit_cost: number }
  const saleItems = all<SaleItemRow>(
    `SELECT si.sale_id, s.date, si.product_id, p.name AS product_name, si.description, si.qty, si.unit_price, si.unit_cost
     FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
     ORDER BY s.date DESC, si.sale_id DESC, si.id`,
  )
  const detalleVentas = sheet<SaleItemRow>({
    name: 'Detalle de ventas',
    title: 'Detalle de ventas (qué vinos se vendieron en cada venta)',
    columns: [
      { header: 'Venta Nº', key: 'sale_id', type: 'int', total: false, width: 10 },
      { header: 'Fecha', key: 'date', type: 'date' },
      { header: 'Vino o ítem', key: 'item', width: 32, value: (r) => (r.product_id ? productName.get(r.product_id) ?? r.product_name : r.description) ?? '—' },
      { header: 'Cantidad', key: 'qty', type: 'int', width: 10 },
      { header: 'Precio unitario', key: 'unit_price', type: 'money', total: false },
      { header: 'Subtotal', key: 'subtotal', type: 'money', value: (r) => round2(r.qty * r.unit_price) },
      { header: 'Costo por botella', key: 'unit_cost', type: 'money', total: false },
      { header: 'Costo total', key: 'cost', type: 'money', value: (r) => round2(r.qty * r.unit_cost) },
      { header: 'Ganancia bruta', key: 'gross', type: 'money', value: (r) => round2(r.qty * (r.unit_price - r.unit_cost)) },
    ],
    rows: saleItems,
    notes: [
      'Una fila por cada vino (o ítem) de cada venta. El costo por botella es el costo promedio del día de la venta.',
      'La "Cantidad" también cuenta ítems que no son vino (entradas a un evento, cajas de regalo…): por eso el total puede dar más que las botellas de la hoja Ventas, que cuenta solo vino.',
      'La ganancia bruta es antes de descuentos, comisiones y gastos; la ganancia de cada venta completa está en la hoja Ventas.',
    ],
  })

  // ── Compras
  type PurchaseRow = (typeof purchases)[number]
  const compras = sheet<PurchaseRow>({
    name: 'Compras',
    title: 'Compras de vino',
    columns: [
      { header: 'Nº', key: 'id', type: 'int', total: false, width: 8 },
      { header: 'Fecha', key: 'date', type: 'date' },
      { header: 'Proveedor', key: 'supplier_name', width: 26 },
      { header: 'Factura Nº', key: 'invoice_number' },
      { header: 'Botellas', key: 'bottles', type: 'int', width: 10 },
      { header: 'Subtotal (vino)', key: 'subtotal', type: 'money' },
      { header: 'Flete y otros costos', key: 'shipping', type: 'money' },
      { header: 'Total', key: 'total', type: 'money' },
      { header: 'Pagado', key: 'paid', type: 'money' },
      { header: 'Falta pagar', key: 'balance', type: 'money' },
      { header: 'Estado', key: 'status', width: 14, value: (p) => (p.overdue ? 'Vencida' : STATUS_PAY[p.status]) },
      { header: 'Vence', key: 'due_date', type: 'date' },
      { header: 'Nota', key: 'notes', width: 30 },
    ],
    rows: purchases,
    notes: [
      'Comprar vino NO es un gasto: es stock. Se vuelve costo recién cuando vendés las botellas (CMV).',
      'El flete se reparte en el costo de cada botella, proporcional a su precio (ver "Detalle de compras").',
    ],
  })

  type PurchaseItemRow = { purchase_id: number; date: string; supplier_name: string | null; product_id: number; qty: number; unit_cost: number; landed_unit_cost: number }
  const purchaseItems = all<PurchaseItemRow>(
    `SELECT pi.purchase_id, pu.date, s.name AS supplier_name, pi.product_id, pi.qty, pi.unit_cost, pi.landed_unit_cost
     FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id LEFT JOIN suppliers s ON s.id = pu.supplier_id
     ORDER BY pu.date DESC, pi.purchase_id DESC, pi.id`,
  )
  const detalleCompras = sheet<PurchaseItemRow>({
    name: 'Detalle de compras',
    title: 'Detalle de compras (qué vinos entraron en cada compra)',
    columns: [
      { header: 'Compra Nº', key: 'purchase_id', type: 'int', total: false, width: 10 },
      { header: 'Fecha', key: 'date', type: 'date' },
      { header: 'Proveedor', key: 'supplier_name', width: 24 },
      { header: 'Vino', key: 'product', width: 30, value: (r) => productName.get(r.product_id) ?? '—' },
      { header: 'Botellas', key: 'qty', type: 'int', width: 10 },
      { header: 'Precio por botella (factura)', key: 'unit_cost', type: 'money', total: false },
      { header: 'Costo real por botella (con flete)', key: 'landed_unit_cost', type: 'money', total: false },
      { header: 'Total factura', key: 'line_total', type: 'money', value: (r) => round2(r.qty * r.unit_cost) },
      { header: 'Total con flete', key: 'landed_total', type: 'money', value: (r) => round2(r.qty * r.landed_unit_cost) },
    ],
    rows: purchaseItems,
    notes: ['"Costo real por botella" = precio de factura + la parte del flete que le toca. Es el costo que entra al stock.'],
  })

  // ── Gastos
  type ExpenseRow = (typeof expenses)[number]
  const gastos = sheet<ExpenseRow>({
    name: 'Gastos',
    title: 'Gastos',
    columns: [
      { header: 'Nº', key: 'id', type: 'int', total: false, width: 8 },
      { header: 'Fecha', key: 'date', type: 'date' },
      { header: 'Categoría', key: 'category', width: 26 },
      { header: 'Descripción', key: 'description', width: 30 },
      { header: 'Fijo o variable', key: 'nature', value: (e) => (e.nature === 'fijo' ? 'Fijo' : 'Variable') },
      { header: 'Monto', key: 'amount', type: 'money' },
      { header: 'Pagado', key: 'paid', type: 'money' },
      { header: 'Falta pagar', key: 'balance', type: 'money' },
      { header: 'Estado', key: 'status', width: 14, value: (e) => (e.overdue ? 'Vencido' : STATUS_EXPENSE[e.status]) },
      { header: 'Vence', key: 'due_date', type: 'date' },
      { header: 'Proveedor', key: 'supplier_name', width: 22 },
      { header: 'Evento', key: 'event_name', width: 22 },
      { header: 'Generado de un gasto fijo', key: 'recurring_id', value: (e) => yesNo(e.recurring_id) },
      { header: 'Nota', key: 'notes', width: 30 },
    ],
    rows: expenses,
    notes: [
      'Todo lo que pagás para que el negocio funcione y que no es comprar vino: alquiler, sueldos, envíos, packaging, impuestos…',
      'Cada gasto cuenta en su fecha aunque lo pagues después (lo pendiente está en "Falta pagar").',
    ],
  })

  type RecRow = RecurringExpense & { account_name: string | null }
  const recurring = all<RecRow>(
    'SELECT r.*, a.name AS account_name FROM recurring_expenses r LEFT JOIN accounts a ON a.id = r.account_id ORDER BY r.active DESC, r.day_of_month, r.description',
  )
  const gastosFijos = sheet<RecRow>({
    name: 'Gastos fijos',
    title: 'Gastos fijos (plantillas que se generan cada mes)',
    columns: [
      { header: 'Descripción', key: 'description', width: 30 },
      { header: 'Categoría', key: 'category', width: 26 },
      { header: 'Monto por mes', key: 'amount', type: 'money' },
      { header: 'Fijo o variable', key: 'nature', value: (r) => (r.nature === 'fijo' ? 'Fijo' : 'Variable') },
      { header: 'Día del mes', key: 'day_of_month', type: 'int', total: false, width: 10 },
      { header: 'Se paga desde', key: 'account_name', width: 20 },
      { header: 'Se marca pagado solo', key: 'auto_paid', value: (r) => yesNo(r.auto_paid) },
      { header: 'Activo', key: 'active', value: (r) => yesNo(r.active) },
    ],
    rows: recurring,
    notes: ['Son los gastos que se repiten todos los meses. Desde Gastos → "Gastos fijos" se generan de una vez para cada mes.'],
  })

  // ── Cuentas y caja
  const accounts = accountBalances()
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const cuentas = sheet<(typeof accounts)[number]>({
    name: 'Cuentas',
    title: 'Cuentas (dónde está la plata)',
    columns: [
      { header: 'Cuenta', key: 'name', width: 24 },
      { header: 'Tipo', key: 'kind', width: 22, value: (a) => ACCOUNT_KIND_LABELS[a.kind as AccountKind] ?? a.kind },
      { header: 'Saldo inicial', key: 'initial_balance', type: 'money' },
      { header: 'Entró', key: 'total_in', type: 'money' },
      { header: 'Salió', key: 'total_out', type: 'money' },
      { header: 'Saldo hoy', key: 'balance', type: 'money' },
      { header: 'Activa', key: 'active', value: (a) => yesNo(a.active) },
      { header: 'Notas', key: 'notes', width: 30 },
    ],
    rows: accounts,
    notes: ['Saldo hoy = saldo inicial + todo lo que entró − todo lo que salió. El total es toda la plata disponible del negocio.'],
  })

  type PayRow = { id: number; date: string; account_id: number; direction: 'in' | 'out'; amount: number; ref_type: PaymentRefType; ref_id: number | null; description: string | null }
  const payments = all<PayRow>('SELECT id, date, account_id, direction, amount, ref_type, ref_id, description FROM payments ORDER BY date DESC, id DESC')
  const caja = sheet<PayRow>({
    name: 'Movimientos de caja',
    title: 'Movimientos de caja (cobros, pagos, transferencias)',
    columns: [
      { header: 'Fecha', key: 'date', type: 'date' },
      { header: 'Cuenta', key: 'account', width: 20, value: (p) => accountName.get(p.account_id) ?? '—' },
      { header: 'Qué fue', key: 'ref_type', width: 26, value: (p) => PAYMENT_REF_LABELS[p.ref_type] ?? p.ref_type },
      { header: 'Entró', key: 'in', type: 'money', value: (p) => (p.direction === 'in' ? p.amount : null) },
      { header: 'Salió', key: 'out', type: 'money', value: (p) => (p.direction === 'out' ? p.amount : null) },
      { header: 'Referencia', key: 'ref', width: 14, value: (p) => (REF_PREFIX[p.ref_type] && p.ref_id ? `${REF_PREFIX[p.ref_type]} Nº ${p.ref_id}` : null) },
      { header: 'Detalle', key: 'description', width: 36 },
    ],
    rows: payments,
    notes: [
      'Cada fila es plata que entró o salió de una cuenta (criterio "percibido": cuenta cuando se cobra o se paga).',
      'Las transferencias entre cuentas aparecen dos veces (sale de una y entra en otra): en el total se compensan.',
      'Por eso el resultado del negocio y la caja no coinciden: vender a cuenta suma ventas hoy y caja cuando te pagan.',
    ],
  })

  // ── Clientes y proveedores (saldos con los mismos listados de ventas/compras/gastos)
  const clientAgg = new Map<number, { n: number; total: number; balance: number; last: string | null }>()
  for (const s of sales) {
    if (!s.client_id) continue
    const a = clientAgg.get(s.client_id) ?? { n: 0, total: 0, balance: 0, last: null }
    a.n++
    a.total += s.total
    a.balance += Math.max(s.balance, 0)
    if (!a.last || s.date > a.last) a.last = s.date
    clientAgg.set(s.client_id, a)
  }
  const clients = all<Client>('SELECT * FROM clients ORDER BY active DESC, name COLLATE NOCASE')
  const clientes = sheet<Client>({
    name: 'Clientes',
    title: 'Clientes',
    columns: [
      { header: 'Nombre', key: 'name', width: 26 },
      { header: 'Tipo', key: 'kind', width: 22, value: (c) => CLIENT_KIND_LABELS[c.kind as ClientKind] ?? c.kind },
      { header: 'Teléfono', key: 'phone' },
      { header: 'Email', key: 'email', width: 24 },
      { header: 'CUIT / DNI', key: 'tax_id' },
      { header: 'Dirección', key: 'address', width: 26 },
      { header: 'Ciudad', key: 'city' },
      { header: 'Compras', key: 'n', type: 'int', width: 10, value: (c) => clientAgg.get(c.id)?.n ?? 0 },
      { header: 'Total comprado', key: 'total', type: 'money', value: (c) => round2(clientAgg.get(c.id)?.total ?? 0) },
      { header: 'Te debe', key: 'balance', type: 'money', value: (c) => round2(clientAgg.get(c.id)?.balance ?? 0) },
      { header: 'Última compra', key: 'last', type: 'date', value: (c) => clientAgg.get(c.id)?.last ?? null },
      { header: 'Activo', key: 'active', value: (c) => yesNo(c.active) },
      { header: 'Notas', key: 'notes', width: 30 },
    ],
    rows: clients,
    notes: ['"Te debe" suma lo que falta cobrar de sus ventas. Las ventas sin cliente (mostrador) no aparecen acá.'],
  })

  const supplierAgg = new Map<number, { total: number; balance: number }>()
  for (const p of purchases) {
    if (!p.supplier_id) continue
    const a = supplierAgg.get(p.supplier_id) ?? { total: 0, balance: 0 }
    a.total += p.total
    a.balance += Math.max(p.balance, 0)
    supplierAgg.set(p.supplier_id, a)
  }
  for (const e of expenses) {
    if (!e.supplier_id) continue
    const a = supplierAgg.get(e.supplier_id) ?? { total: 0, balance: 0 }
    a.balance += Math.max(e.balance, 0)
    supplierAgg.set(e.supplier_id, a)
  }
  const suppliers = all<Supplier>('SELECT * FROM suppliers ORDER BY active DESC, name COLLATE NOCASE')
  const proveedores = sheet<Supplier>({
    name: 'Proveedores',
    title: 'Proveedores',
    columns: [
      { header: 'Nombre', key: 'name', width: 26 },
      { header: 'Tipo', key: 'kind', width: 20, value: (s) => SUPPLIER_KIND_LABELS[s.kind as SupplierKind] ?? s.kind },
      { header: 'Contacto', key: 'contact_name', width: 20 },
      { header: 'Teléfono', key: 'phone' },
      { header: 'Email', key: 'email', width: 24 },
      { header: 'CUIT', key: 'tax_id' },
      { header: 'Dirección', key: 'address', width: 26 },
      { header: 'Total comprado (vino)', key: 'total', type: 'money', value: (s) => round2(supplierAgg.get(s.id)?.total ?? 0) },
      { header: 'Le debés', key: 'balance', type: 'money', value: (s) => round2(supplierAgg.get(s.id)?.balance ?? 0) },
      { header: 'Activo', key: 'active', value: (s) => yesNo(s.active) },
      { header: 'Notas', key: 'notes', width: 30 },
    ],
    rows: suppliers,
    notes: ['"Le debés" suma lo que falta pagar de compras y gastos cargados a ese proveedor.'],
  })

  // ── Eventos
  type EventRow = WineEvent & { sales_total: number; sales_cost: number; sales_fee: number; expenses_total: number; opened_cost: number }
  const events = all<EventRow>(
    `SELECT e.*,
       COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.event_id = e.id), 0) AS sales_total,
       COALESCE((SELECT SUM(si.qty * si.unit_cost) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.event_id = e.id), 0) AS sales_cost,
       COALESCE((SELECT SUM(s.fee) FROM sales s WHERE s.event_id = e.id), 0) AS sales_fee,
       COALESCE((SELECT SUM(x.amount) FROM expenses x WHERE x.event_id = e.id), 0) AS expenses_total,
       COALESCE((SELECT SUM(-m.qty * m.unit_cost) FROM stock_movements m WHERE m.ref_type = 'event' AND m.ref_id = e.id AND m.qty < 0), 0) AS opened_cost
     FROM events e ORDER BY e.date DESC, e.id DESC`,
  )
  const eventos = sheet<EventRow>({
    name: 'Eventos',
    title: 'Eventos, degustaciones y ferias',
    columns: [
      { header: 'Evento', key: 'name', width: 28 },
      { header: 'Fecha', key: 'date', type: 'date' },
      { header: 'Tipo', key: 'kind', width: 18, value: (e) => EVENT_KIND_LABELS[e.kind as EventKind] ?? e.kind },
      { header: 'Lugar', key: 'location', width: 22 },
      { header: 'Asistentes', key: 'attendees', type: 'int', total: false, width: 11 },
      { header: 'Precio de la entrada', key: 'ticket_price', type: 'money', total: false },
      { header: 'Presupuesto', key: 'budget', type: 'money' },
      { header: 'Ventas del evento', key: 'sales_total', type: 'money' },
      { header: 'Costo del vino vendido', key: 'sales_cost', type: 'money' },
      { header: 'Comisiones', key: 'sales_fee', type: 'money' },
      { header: 'Gastos del evento', key: 'expenses_total', type: 'money' },
      { header: 'Botellas abiertas o regaladas (a costo)', key: 'opened_cost', type: 'money' },
      { header: 'Notas', key: 'notes', width: 30 },
    ],
    rows: events.map((e) => ({ ...e, sales_cost: round2(e.sales_cost), opened_cost: round2(e.opened_cost) })),
    notes: ['Ventas y gastos que cargaste asociados a cada evento. El resultado de cada evento, explicado, lo ves en la pantalla Eventos.'],
  })

  // ── Metas e inflación
  const goals = all<Goal>('SELECT * FROM goals ORDER BY month DESC')
  const metas = sheet<Goal>({
    name: 'Metas',
    title: 'Metas y presupuesto por mes',
    columns: [
      { header: 'Mes', key: 'month', width: 16, value: (g) => monthLabelLong(g.month) },
      { header: 'Meta de ventas', key: 'sales_target', type: 'money' },
      { header: 'Meta de botellas', key: 'bottles_target', type: 'int' },
      { header: 'Presupuesto de gastos', key: 'expense_budget', type: 'money' },
      { header: 'Notas', key: 'notes', width: 30 },
    ],
    rows: goals,
    totals: false,
    notes: ['Las metas que te pusiste para cada mes. Cómo vas contra cada meta lo ves en la pantalla Metas.'],
  })

  const inflation = all<InflationRate>('SELECT * FROM inflation ORDER BY month DESC')
  const inflacion = sheet<InflationRate>({
    name: 'Inflación',
    title: 'Inflación mensual cargada',
    columns: [
      { header: 'Mes', key: 'month', width: 16, value: (i) => monthLabelLong(i.month) },
      { header: 'Inflación del mes', key: 'rate', type: 'percent', value: (i) => i.rate / 100 },
    ],
    rows: inflation,
    totals: false,
    notes: ['Se usa en Reportes para comparar meses "a pesos de hoy" (crecimiento real).'],
  })

  return [vinos, movimientos, ventas, detalleVentas, compras, detalleCompras, gastos, gastosFijos, cuentas, caja, clientes, proveedores, eventos, metas, inflacion] as ExcelSheet<any>[]
}

const SHEET_DESCRIPTIONS: Record<string, string> = {
  Vinos: 'Tu catálogo: costo, precios, margen y botellas de cada vino.',
  'Movimientos de stock': 'Cada botella que entró o salió (compras, ventas, roturas, degustaciones, ajustes).',
  Ventas: 'Cada venta con su total, comisión, costo, ganancia y si ya la cobraste.',
  'Detalle de ventas': 'Qué vinos (y cuántos) tiene cada venta.',
  Compras: 'Cada compra de vino, con flete y si ya la pagaste.',
  'Detalle de compras': 'Qué vinos entraron en cada compra y su costo real con flete.',
  Gastos: 'Alquiler, sueldos, envíos… todo lo que no es comprar vino.',
  'Gastos fijos': 'Los gastos que se repiten todos los meses (plantillas).',
  Cuentas: 'Caja, banco, billeteras: saldo inicial, lo que entró, salió y el saldo de hoy.',
  'Movimientos de caja': 'Cada peso que entró o salió de una cuenta.',
  Clientes: 'Tus clientes, cuánto te compraron y cuánto te deben.',
  Proveedores: 'Bodegas y servicios, cuánto les compraste y cuánto les debés.',
  Eventos: 'Degustaciones y ferias con sus ventas y gastos.',
  Metas: 'Las metas de venta y el presupuesto de cada mes.',
  Inflación: 'La inflación mensual que cargaste.',
}

router.get('/export/all', async (_req, res) => {
  const sheets = buildFullExport()
  const business = getSettings().business.name || 'VINOH!'
  const readme = sheet<{ sheet: string; what: string; rows: number }>({
    name: 'Léeme',
    title: 'Todos tus datos en un Excel',
    subtitle: `Copia completa de ${business}`,
    columns: [
      { header: 'Hoja', key: 'sheet', width: 24 },
      { header: '¿Qué tiene?', key: 'what', width: 80 },
      { header: 'Filas', key: 'rows', type: 'int', width: 10 },
    ],
    rows: sheets.map((s) => ({ sheet: s.name, what: SHEET_DESCRIPTIONS[s.name] ?? '', rows: s.rows.length })),
    totals: false,
    notes: [
      'Este archivo es una FOTO de tus datos al día de hoy, para mirar, filtrar, hacer cuentas o mandarle al contador. Si cambiás algo acá, no cambia en el sistema.',
      'Todos los montos están en pesos y con impuestos incluidos (como salen en el ticket o la factura). Las fechas son fechas reales: se pueden ordenar y filtrar.',
      'Cada hoja tiene filtros en los encabezados (la flechita) y una fila de TOTAL al final. Abajo de cada tabla hay una explicación de cómo leerla.',
      'Ventas y gastos cuentan el día en que ocurrieron (aunque se cobren o paguen después). La plata que efectivamente entró y salió está en "Movimientos de caja". Por eso el resultado y la caja no tienen por qué coincidir.',
      'Comprar vino no es un gasto: es stock. Se transforma en costo cuando vendés las botellas (columna "Costo del vino" de Ventas).',
      'Ojo: este Excel NO sirve para volver atrás. Para eso están las copias de seguridad (Configuración → Copias de seguridad).',
    ],
  })
  const wb = newWorkbook()
  addSheet(wb, readme)
  for (const s of sheets) addSheet(wb, s as ExcelSheet<Record<string, unknown>>)
  await sendWorkbookFile(res, excelFilename('todos-los-datos'), wb)
})

// Para usar en tests y en la pantalla (nombres de las hojas, en orden).
export const FULL_EXPORT_SHEETS = ['Léeme', ...Object.keys(SHEET_DESCRIPTIONS)]
export default router
