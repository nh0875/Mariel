// Proveedores: bodegas, distribuidores y servicios. Listado con lo comprado y lo que se les debe,
// ficha con su historial, alta/edición/borrado y Excel.
// (Ver docs/ARQUITECTURA.md → módulo "Compras + Proveedores")
//
// Los saldos salen de los mismos listados que usan Compras y Gastos (listPurchases / listExpenses),
// así "le debés $X" da igual en todas las pantallas.
import { Router } from 'express'
import { supplierInput } from '../../shared/schemas'
import { SUPPLIER_KIND_LABELS, type SupplierKind } from '../../shared/constants'
import { round2, safeDiv } from '../../shared/calc'
import { addMonths, endOfMonth, monthLabel, monthsBetween, startOfMonth, today } from '../../shared/dates'
import type { ExpenseWithStatus, PurchaseWithStatus, Supplier } from '../../shared/types'
import { all, get, run, withBools } from '../db'
import { HttpError, notFound, parseId, validate } from '../lib/http'
import { excelFilename, sendWorkbook, type ExcelColumn } from '../lib/excel'
import { listPurchases } from '../services/purchases'
import { listExpenses } from '../services/expenses'

const router = Router()

// ───────────────────────── Ayudas ─────────────────────────

function readSupplier(id: number): Supplier | undefined {
  const row = get<Record<string, unknown>>('SELECT * FROM suppliers WHERE id = ?', [id])
  return row ? (withBools(row, ['active']) as unknown as Supplier) : undefined
}

function mustSupplier(id: number): Supplier {
  const s = readSupplier(id)
  if (!s) throw notFound('ese proveedor')
  return s
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Evita proveedores repetidos ("Bodega Los Cerros" y "bodega los cerros"). */
function checkDuplicate(name: string, exceptId?: number) {
  const target = normalize(name)
  const dup = all<{ id: number; name: string; active: number }>('SELECT id, name, active FROM suppliers').find((s) => s.id !== exceptId && normalize(s.name) === target)
  if (dup) {
    throw new HttpError(
      409,
      dup.active
        ? `Ya tenés un proveedor llamado «${dup.name}». Elegilo de la lista en vez de crear otro.`
        : `Ya tenés un proveedor llamado «${dup.name}», pero está desactivado. Reactivalo desde «Proveedores».`,
    )
  }
}

interface Balances {
  purchases_balance: number
  expenses_balance: number
  overdue: number
}

/** Saldo por pagar de cada proveedor (compras + gastos con saldo), usando los mismos cálculos que Compras y Gastos. */
function balancesBySupplier(purchases: PurchaseWithStatus[], expenses: ExpenseWithStatus[]): Map<number, Balances> {
  const map = new Map<number, Balances>()
  const bucket = (id: number) => {
    if (!map.has(id)) map.set(id, { purchases_balance: 0, expenses_balance: 0, overdue: 0 })
    return map.get(id)!
  }
  for (const p of purchases) {
    if (!p.supplier_id || p.balance <= 0.01) continue
    const b = bucket(p.supplier_id)
    b.purchases_balance += p.balance
    if (p.overdue) b.overdue += p.balance
  }
  for (const e of expenses) {
    if (!e.supplier_id || e.balance <= 0.01) continue
    const b = bucket(e.supplier_id)
    b.expenses_balance += e.balance
    if (e.overdue) b.overdue += e.balance
  }
  return map
}

export type SupplierListRow = Supplier & {
  /** Lo que le debés (compras + gastos sin pagar). */
  balance: number
  /** Parte del saldo que ya venció. */
  overdue: number
  purchases_balance: number
  expenses_balance: number
  /** Total de compras de vino (todas las fechas, con flete). */
  total_bought: number
  bottles: number
  purchases_count: number
  last_purchase: string | null
  expenses_total: number
  expenses_count: number
}

function listSuppliers(): SupplierListRow[] {
  const rows = all<Record<string, unknown>>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM purchases pu WHERE pu.supplier_id = s.id) AS purchases_count,
       (SELECT COALESCE(SUM(pu.total), 0) FROM purchases pu WHERE pu.supplier_id = s.id) AS total_bought,
       (SELECT MAX(pu.date) FROM purchases pu WHERE pu.supplier_id = s.id) AS last_purchase,
       (SELECT COALESCE(SUM(pi.qty), 0) FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id WHERE pu.supplier_id = s.id) AS bottles,
       (SELECT COUNT(*) FROM expenses ex WHERE ex.supplier_id = s.id) AS expenses_count,
       (SELECT COALESCE(SUM(ex.amount), 0) FROM expenses ex WHERE ex.supplier_id = s.id) AS expenses_total
     FROM suppliers s`,
  )
  const balances = balancesBySupplier(listPurchases({}), listExpenses({}))
  return rows
    .map((r) => {
      const s = withBools(r, ['active']) as unknown as SupplierListRow
      const b = balances.get(s.id)
      const purchases_balance = round2(b?.purchases_balance ?? 0)
      const expenses_balance = round2(b?.expenses_balance ?? 0)
      return {
        ...s,
        total_bought: round2(s.total_bought),
        expenses_total: round2(s.expenses_total),
        purchases_balance,
        expenses_balance,
        balance: round2(purchases_balance + expenses_balance),
        overdue: round2(b?.overdue ?? 0),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
}

// ───────────────────────── Listado ─────────────────────────

router.get('/suppliers', (_req, res) => {
  res.json(listSuppliers())
})

router.get('/suppliers/export', async (_req, res) => {
  const rows = listSuppliers()
  const cols: ExcelColumn<SupplierListRow>[] = [
    { header: 'Proveedor', key: 'name', width: 30 },
    { header: 'Tipo', key: 'kind', value: (s) => SUPPLIER_KIND_LABELS[s.kind as SupplierKind] ?? s.kind, width: 22 },
    { header: 'Contacto', key: 'contact_name', value: (s) => s.contact_name || '', width: 22 },
    { header: 'Teléfono', key: 'phone', value: (s) => s.phone || '', width: 18 },
    { header: 'Email', key: 'email', value: (s) => s.email || '', width: 26 },
    { header: 'CUIT', key: 'tax_id', value: (s) => s.tax_id || '', width: 16 },
    { header: 'Dirección', key: 'address', value: (s) => s.address || '', width: 28 },
    { header: 'Compras', key: 'purchases_count', type: 'int', width: 10 },
    { header: 'Botellas compradas', key: 'bottles', type: 'int', width: 12 },
    { header: 'Total comprado (vino + flete)', key: 'total_bought', type: 'money', width: 18 },
    { header: 'Última compra', key: 'last_purchase', type: 'date', width: 13 },
    { header: 'Gastos cargados', key: 'expenses_total', type: 'money', width: 16 },
    { header: 'Saldo a pagar', key: 'balance', type: 'money' },
    { header: 'De eso, vencido', key: 'overdue', type: 'money' },
    { header: 'Activo', key: 'active', value: (s) => (s.active ? 'Sí' : 'No'), width: 9 },
    { header: 'Notas', key: 'notes', value: (s) => s.notes || '', width: 30 },
  ]
  await sendWorkbook(res, excelFilename('proveedores'), [
    {
      name: 'Proveedores',
      title: 'Proveedores',
      subtitle: 'Totales históricos (desde la primera compra cargada)',
      columns: cols,
      rows,
      notes: [
        'Una fila por proveedor: bodegas, distribuidores y servicios (logística, packaging, contador…).',
        'Total comprado = suma de las compras de vino a ese proveedor, con el flete incluido. Comprar vino no es un gasto: es stock.',
        'Gastos cargados = gastos (servicios, packaging, envíos…) que asociaste a ese proveedor al cargarlos en «Gastos».',
        'Saldo a pagar = lo que todavía le debés: compras y gastos sin pagar o pagados en parte. "De eso, vencido" es lo que ya pasó su fecha de vencimiento.',
        'Activo = "No" significa que lo desactivaste: no aparece al cargar compras o gastos, pero su historial se conserva.',
      ],
    },
  ])
})

// ───────────────────────── Ficha de un proveedor ─────────────────────────

router.get('/suppliers/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese proveedor')
  const supplier = mustSupplier(id)
  const purchases = listPurchases({ supplier_id: id })
  const expenses = listExpenses({ supplier_id: id })
  const bal = balancesBySupplier(purchases, expenses).get(id)

  const total_bought = round2(purchases.reduce((s, p) => s + p.total, 0))
  const bottles = purchases.reduce((s, p) => s + p.bottles, 0)
  const shipping = round2(purchases.reduce((s, p) => s + p.shipping, 0))

  // Vinos que le comprás: cuántas botellas, cuánto (costo real con flete) y cómo cambió el precio de factura.
  const wineRows = all<{
    product_id: number
    name: string
    winery: string | null
    bottles: number
    total: number
    purchases: number
    first_date: string
    last_date: string
  }>(
    `SELECT p.id AS product_id, p.name, p.winery,
       SUM(pi.qty) AS bottles, SUM(pi.qty * pi.landed_unit_cost) AS total,
       COUNT(DISTINCT pu.id) AS purchases,
       MIN(pu.date) AS first_date, MAX(pu.date) AS last_date
     FROM purchase_items pi
     JOIN purchases pu ON pu.id = pi.purchase_id
     JOIN products p ON p.id = pi.product_id
     WHERE pu.supplier_id = ?
     GROUP BY p.id
     ORDER BY total DESC`,
    [id],
  )
  const priceAt = (productId: number, order: 'ASC' | 'DESC') =>
    get<{ unit_cost: number }>(
      `SELECT pi.unit_cost FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
       WHERE pu.supplier_id = ? AND pi.product_id = ? ORDER BY pu.date ${order}, pi.id ${order} LIMIT 1`,
      [id, productId],
    )?.unit_cost ?? 0
  const wines = wineRows.map((w) => {
    const first_unit_cost = priceAt(w.product_id, 'ASC')
    const last_unit_cost = priceAt(w.product_id, 'DESC')
    return {
      ...w,
      total: round2(w.total),
      first_unit_cost,
      last_unit_cost,
      /** Variación del precio de factura entre la primera y la última compra (0..1). null si se compró una sola vez. */
      price_change: w.first_date === w.last_date || !first_unit_cost ? null : safeDiv(last_unit_cost - first_unit_cost, first_unit_cost),
    }
  })

  // Últimos 12 meses (hasta el mes actual): compras de vino y gastos con este proveedor.
  const t = today()
  const months = monthsBetween(addMonths(startOfMonth(t), -11), endOfMonth(t))
  const byMonth = new Map(months.map((m) => [m, { purchases: 0, expenses: 0, bottles: 0 }]))
  for (const p of purchases) {
    const m = byMonth.get(p.date.slice(0, 7))
    if (m) {
      m.purchases += p.total
      m.bottles += p.bottles
    }
  }
  for (const e of expenses) {
    const m = byMonth.get(e.date.slice(0, 7))
    if (m) m.expenses += e.amount
  }
  const monthly = months.map((m) => {
    const v = byMonth.get(m)!
    return { month: m, label: monthLabel(m), purchases: round2(v.purchases), expenses: round2(v.expenses), bottles: v.bottles }
  })

  const purchases_balance = round2(bal?.purchases_balance ?? 0)
  const expenses_balance = round2(bal?.expenses_balance ?? 0)
  res.json({
    supplier,
    purchases,
    expenses,
    stats: {
      total_bought,
      bottles,
      shipping,
      /** Costo real promedio por botella (con flete) de todo lo que le compraste. */
      avg_cost_per_bottle: round2(safeDiv(total_bought, bottles)),
      balance: round2(purchases_balance + expenses_balance),
      purchases_balance,
      expenses_balance,
      overdue: round2(bal?.overdue ?? 0),
      last_purchase: purchases[0]?.date ?? null,
      first_purchase: purchases.length ? purchases[purchases.length - 1].date : null,
      purchases_count: purchases.length,
      expenses_total: round2(expenses.reduce((s, e) => s + e.amount, 0)),
      expenses_count: expenses.length,
      top_wines: wines.slice(0, 6).map((w) => ({ product_id: w.product_id, name: w.name, bottles: w.bottles, total: w.total })),
    },
    wines,
    monthly,
  })
})

// ───────────────────────── Alta, edición y borrado ─────────────────────────

const INSERT_COLS = ['name', 'kind', 'contact_name', 'phone', 'email', 'tax_id', 'address', 'notes', 'active'] as const

router.post('/suppliers', (req, res) => {
  const data = validate(supplierInput, req.body)
  checkDuplicate(data.name)
  const { lastInsertRowid } = run(
    `INSERT INTO suppliers (${INSERT_COLS.join(', ')}) VALUES (${INSERT_COLS.map(() => '?').join(', ')})`,
    INSERT_COLS.map((c) => data[c]),
  )
  res.status(201).json(readSupplier(lastInsertRowid))
})

/**
 * Editar. Acepta el proveedor completo o solo lo que cambia (ej: { active: false } para desactivarlo):
 * lo que no venga se mantiene como estaba.
 */
router.put('/suppliers/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese proveedor')
  const prev = mustSupplier(id)
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const merged: Record<string, unknown> = {}
  for (const c of INSERT_COLS) merged[c] = c in body ? body[c] : prev[c]
  const data = validate(supplierInput, merged)
  if (normalize(data.name) !== normalize(prev.name)) checkDuplicate(data.name, id)
  run(`UPDATE suppliers SET ${INSERT_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...INSERT_COLS.map((c) => data[c]), id])
  res.json(readSupplier(id))
})

/** Borrar: solo si no tiene compras ni gastos. Si tiene historial → 409 sugiriendo desactivarlo. */
router.delete('/suppliers/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese proveedor')
  const s = mustSupplier(id)
  const purchases = get<{ n: number }>('SELECT COUNT(*) AS n FROM purchases WHERE supplier_id = ?', [id])?.n ?? 0
  const expenses = get<{ n: number }>('SELECT COUNT(*) AS n FROM expenses WHERE supplier_id = ?', [id])?.n ?? 0
  if (purchases || expenses) {
    const parts = [purchases ? `${purchases} ${purchases === 1 ? 'compra' : 'compras'}` : '', expenses ? `${expenses} ${expenses === 1 ? 'gasto' : 'gastos'}` : ''].filter(Boolean)
    throw new HttpError(
      409,
      `«${s.name}» ya tiene historial (${parts.join(' y ')}). Si lo borrás se pierde, por eso no se puede. ` +
        'Desactivalo: deja de aparecer al cargar compras y gastos, y sus números se conservan.',
      { purchases, expenses },
    )
  }
  run('DELETE FROM suppliers WHERE id = ?', [id])
  res.json({ ok: true })
})

export default router
