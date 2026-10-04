// Clientes: quién te compra, cuánto, qué vinos prefiere y quién te debe.
// (Ver docs/ARQUITECTURA.md → módulo "Caja + Clientes")
//
// Todos los números salen de listSales() (el mismo listado que usa la pantalla de Ventas),
// así "te debe $X" o "compró $Y" da igual en todas las pantallas.
import { Router } from 'express'
import { clientInput } from '../../shared/schemas'
import { CLIENT_KIND_LABELS, type ClientKind } from '../../shared/constants'
import { round2, safeDiv } from '../../shared/calc'
import { addMonths, daysBetween, endOfMonth, monthLabel, monthsBetween, startOfMonth, today } from '../../shared/dates'
import type { Client, SaleWithStatus } from '../../shared/types'
import { all, get, run, withBools } from '../db'
import { HttpError, notFound, parseId, validate } from '../lib/http'
import { excelFilename, fmtDate, sendWorkbook, type ExcelColumn } from '../lib/excel'
import { listSales } from '../services/sales'

const router = Router()

const COLS = ['name', 'kind', 'phone', 'email', 'tax_id', 'address', 'city', 'notes', 'active'] as const
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

function readClient(id: number): Client | undefined {
  const row = get<Record<string, unknown>>('SELECT * FROM clients WHERE id = ?', [id])
  return row ? (withBools(row, ['active']) as unknown as Client) : undefined
}

function mustClient(id: number): Client {
  const c = readClient(id)
  if (!c) throw notFound('ese cliente')
  return c
}

/** Evita clientes repetidos ("Bistró La Esquina" y "bistro la esquina"). */
function checkDuplicate(name: string, exceptId?: number) {
  const target = normalize(name)
  const dup = all<{ id: number; name: string; active: number }>('SELECT id, name, active FROM clients').find((c) => c.id !== exceptId && normalize(c.name) === target)
  if (dup) {
    throw new HttpError(
      409,
      dup.active
        ? `Ya tenés un cliente llamado «${dup.name}». Elegilo de la lista; si es otra persona, agregale algo para distinguirlo (ej: «${dup.name} – Palermo»).`
        : `Ya tenés un cliente llamado «${dup.name}», pero está desactivado. Reactivalo desde su ficha en «Clientes».`,
    )
  }
}

interface ClientAgg {
  total_bought: number
  bottles: number
  purchases_count: number
  last_purchase: string | null
  first_purchase: string | null
  balance: number
  overdue: number
  pending_count: number
  year_total: number
  profit: number
}

const emptyAgg = (): ClientAgg => ({
  total_bought: 0,
  bottles: 0,
  purchases_count: 0,
  last_purchase: null,
  first_purchase: null,
  balance: 0,
  overdue: 0,
  pending_count: 0,
  year_total: 0,
  profit: 0,
})

/** Agrega las ventas por cliente: total, botellas, última compra, saldo por cobrar (y vencido). */
function aggregate(sales: SaleWithStatus[]): Map<number, ClientAgg> {
  const year = today().slice(0, 4)
  const map = new Map<number, ClientAgg>()
  for (const s of sales) {
    if (!s.client_id) continue
    if (!map.has(s.client_id)) map.set(s.client_id, emptyAgg())
    const a = map.get(s.client_id)!
    a.total_bought += s.total
    a.bottles += s.bottles
    a.purchases_count++
    a.profit += s.profit
    if (!a.last_purchase || s.date > a.last_purchase) a.last_purchase = s.date
    if (!a.first_purchase || s.date < a.first_purchase) a.first_purchase = s.date
    if (s.date.slice(0, 4) === year) a.year_total += s.total
    if (s.balance > 0.01) {
      a.balance += s.balance
      a.pending_count++
      if (s.overdue) a.overdue += s.balance
    }
  }
  for (const a of map.values()) {
    a.total_bought = round2(a.total_bought)
    a.balance = round2(a.balance)
    a.overdue = round2(a.overdue)
    a.year_total = round2(a.year_total)
    a.profit = round2(a.profit)
  }
  return map
}

/** Promedio de días entre compras, contando días distintos (null si compró un solo día). Mínimo 1. */
function frequencyDays(sales: SaleWithStatus[]): number | null {
  const days = [...new Set(sales.map((s) => s.date))].sort()
  if (days.length < 2) return null
  return Math.max(1, Math.round(daysBetween(days[0], days[days.length - 1]) / (days.length - 1)))
}

export type ClientListRow = Client & ClientAgg

function listClients(): ClientListRow[] {
  const agg = aggregate(listSales({}))
  return all<Record<string, unknown>>('SELECT * FROM clients')
    .map((r) => {
      const c = withBools(r, ['active']) as unknown as Client
      return { ...c, ...(agg.get(c.id) ?? emptyAgg()) }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
}

// ───────────────────────── Listado ─────────────────────────

router.get('/clients', (_req, res) => {
  res.json(listClients())
})

router.get('/clients/export', async (_req, res) => {
  const rows = listClients()
  const cols: ExcelColumn<ClientListRow>[] = [
    { header: 'Cliente', key: 'name', width: 30 },
    { header: 'Tipo', key: 'kind', value: (c) => CLIENT_KIND_LABELS[c.kind as ClientKind] ?? c.kind, width: 24 },
    { header: 'Teléfono', key: 'phone', value: (c) => c.phone || '', width: 18 },
    { header: 'Email', key: 'email', value: (c) => c.email || '', width: 26 },
    { header: 'Ciudad', key: 'city', value: (c) => c.city || '', width: 18 },
    { header: 'Dirección', key: 'address', value: (c) => c.address || '', width: 26 },
    { header: 'CUIT / DNI', key: 'tax_id', value: (c) => c.tax_id || '', width: 16 },
    { header: 'Compras', key: 'purchases_count', type: 'int', width: 10 },
    { header: 'Botellas', key: 'bottles', type: 'int', width: 10 },
    { header: 'Total comprado', key: 'total_bought', type: 'money' },
    { header: `Comprado en ${today().slice(0, 4)}`, key: 'year_total', type: 'money' },
    { header: 'Ticket promedio', key: 'avg', type: 'money', total: false, value: (c) => (c.purchases_count ? round2(c.total_bought / c.purchases_count) : null) },
    { header: 'Primera compra', key: 'first_purchase', type: 'date' },
    { header: 'Última compra', key: 'last_purchase', type: 'date' },
    { header: 'Te debe', key: 'balance', type: 'money' },
    { header: 'De eso, vencido', key: 'overdue', type: 'money' },
    { header: 'Activo', key: 'active', value: (c) => (c.active ? 'Sí' : 'No'), width: 9 },
    { header: 'Notas', key: 'notes', value: (c) => c.notes || '', width: 30 },
  ]
  await sendWorkbook(res, excelFilename('clientes'), [
    {
      name: 'Clientes',
      title: 'Clientes',
      subtitle: `Totales históricos al ${fmtDate(today())}`,
      columns: cols,
      rows,
      notes: [
        'Una fila por cliente. Total comprado = suma de todas sus ventas (con descuentos y envíos), se hayan cobrado o no.',
        'Ticket promedio = total comprado ÷ cantidad de compras. Sirve para saber cuánto gasta cada uno cada vez que te compra.',
        'Te debe = ventas a ese cliente que todavía no cobraste (o cobraste en parte). "De eso, vencido" es lo que ya pasó su fecha de pago.',
        'Las ventas sin cliente asignado (mostrador) no aparecen acá. Las deudas de esas ventas las ves en «Caja y bancos» → «Por cobrar y por pagar».',
        'Activo = "No" significa que lo desactivaste: no aparece al cargar ventas, pero su historial se conserva.',
      ],
    },
  ])
})

// ───────────────────────── Ficha de un cliente ─────────────────────────

router.get('/clients/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese cliente')
  const client = mustClient(id)
  const sales = listSales({ client_id: id })
  const a = aggregate(sales).get(id) ?? emptyAgg()

  const favorite_wines = all<{ product_id: number; name: string; bottles: number; total: number }>(
    `SELECT p.id AS product_id, p.name, SUM(si.qty) AS bottles, SUM(si.qty * si.unit_price) AS total
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     WHERE s.client_id = ?
     GROUP BY p.id ORDER BY bottles DESC, total DESC LIMIT 6`,
    [id],
  ).map((w) => ({ ...w, total: round2(w.total) }))

  // Últimos 12 meses (hasta el mes actual).
  const t = today()
  const months = monthsBetween(addMonths(startOfMonth(t), -11), endOfMonth(t))
  const byMonth = new Map(months.map((m) => [m, { total: 0, bottles: 0, count: 0 }]))
  for (const s of sales) {
    const m = byMonth.get(s.date.slice(0, 7))
    if (!m) continue
    m.total += s.total
    m.bottles += s.bottles
    m.count++
  }
  const monthly = months.map((m) => {
    const v = byMonth.get(m)!
    return { month: m, label: monthLabel(m), total: round2(v.total), bottles: v.bottles, count: v.count }
  })

  res.json({
    client,
    sales,
    stats: {
      total_bought: a.total_bought,
      bottles: a.bottles,
      purchases_count: a.purchases_count,
      avg_ticket: round2(safeDiv(a.total_bought, a.purchases_count)),
      first_purchase: a.first_purchase,
      last_purchase: a.last_purchase,
      days_since_last: a.last_purchase ? Math.max(0, daysBetween(a.last_purchase, t)) : null,
      /**
       * Cada cuántos días compra, en promedio: días entre su primera y su última compra ÷ (días distintos en que compró − 1).
       * Se cuentan días distintos (dos ventas el mismo día son una visita). null si compró un solo día.
       */
      frequency_days: frequencyDays(sales),
      balance: a.balance,
      overdue: a.overdue,
      pending_count: a.pending_count,
      year_total: a.year_total,
      /** Lo que te dejaron sus compras: ventas − comisiones − costo de las botellas. */
      profit: a.profit,
      margin: safeDiv(a.profit, a.total_bought),
      favorite_wines,
    },
    monthly,
  })
})

// ───────────────────────── Alta, edición y borrado ─────────────────────────

router.post('/clients', (req, res) => {
  const data = validate(clientInput, req.body)
  checkDuplicate(data.name)
  const { lastInsertRowid } = run(`INSERT INTO clients (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})`, COLS.map((c) => data[c]))
  res.status(201).json(readClient(lastInsertRowid))
})

/** Editar. Acepta el cliente completo o solo lo que cambia (ej: { active: false } para desactivarlo). */
router.put('/clients/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese cliente')
  const prev = mustClient(id)
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const merged: Record<string, unknown> = {}
  for (const c of COLS) merged[c] = c in body ? body[c] : prev[c]
  const data = validate(clientInput, merged)
  if (normalize(data.name) !== normalize(prev.name)) checkDuplicate(data.name, id)
  run(`UPDATE clients SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...COLS.map((c) => data[c]), id])
  res.json(readClient(id))
})

/** Borrar: solo si no tiene ventas. Si tiene historial → 409 sugiriendo desactivarlo. */
router.delete('/clients/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese cliente')
  const c = mustClient(id)
  const n = get<{ n: number }>('SELECT COUNT(*) AS n FROM sales WHERE client_id = ?', [id])?.n ?? 0
  if (n > 0) {
    throw new HttpError(
      409,
      `«${c.name}» tiene ${n} ${n === 1 ? 'venta cargada' : 'ventas cargadas'}. Si lo borrás se pierde a quién le vendiste, por eso no se puede. ` +
        'Desactivalo: deja de aparecer al cargar ventas y su historial se conserva.',
      { sales: n },
    )
  }
  run('DELETE FROM clients WHERE id = ?', [id])
  res.json({ ok: true })
})

export default router
