// Compras de vino: listado, resumen del período, alta/edición/borrado, pagos y Excel.
// (Ver docs/ARQUITECTURA.md → módulo "Compras + Proveedores")
//
// La lógica contable vive en los servicios centrales:
//   - services/purchases.ts → costo real con flete (landedCosts), movimientos de stock y pago total.
//   - services/stock.ts     → costo promedio ponderado (recalcula toda la historia del vino).
//   - services/payments.ts  → pagos parciales (addSettlement) y borrado de pagos.
//   - services/finance.ts   → números del período (los mismos que Inicio y Reportes).
// Acá solo se valida, se filtra y se arma la respuesta.
//
// Idea clave (y se explica en todas las pantallas): COMPRAR VINO NO ES UN GASTO.
// La plata se transforma en botellas (stock). Recién cuando vendés la botella,
// su costo pasa a ser "costo de lo vendido" (CMV) en el resultado.
import { Router, type Request } from 'express'
import { purchaseInput, settlementInput } from '../../shared/schemas'
import { round2, safeDiv } from '../../shared/calc'
import { addMonths, endOfMonth, monthsBetween, startOfMonth, today } from '../../shared/dates'
import type { Payment, PurchaseDetail, PurchaseWithStatus } from '../../shared/types'
import { all, get, scalar } from '../db'
import { badRequest, notFound, parseId, parsePeriod, qn, qs, validate } from '../lib/http'
import { excelFilename, periodSubtitle, sendWorkbook, type ExcelColumn } from '../lib/excel'
import { createPurchase, deletePurchase, getPurchaseDetail, listPurchases, updatePurchase, type PurchasesFilter } from '../services/purchases'
import { addSettlement, deletePayment, paidFor } from '../services/payments'
import { monthlySeries, periodSummary, stockValue } from '../services/finance'

const router = Router()

// ───────────────────────── Filtros ─────────────────────────

/**
 * Estados de pago que se pueden filtrar:
 * - pagado / parcial / pendiente: el estado exacto.
 * - por_pagar: todo lo que tiene saldo (pendiente + parcial).
 * - vencida: tiene saldo y la fecha de vencimiento ya pasó.
 */
const STATUS_FILTERS = ['pagado', 'parcial', 'pendiente', 'por_pagar', 'vencida'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const ISO = /^\d{4}-\d{2}-\d{2}$/

interface ListFilter {
  base: PurchasesFilter
  status?: StatusFilter
}

/**
 * Lee los filtros del listado. Las fechas son opcionales: sin from/to trae todas las compras
 * (lo usa, por ejemplo, la ficha de un proveedor).
 */
function readFilters(req: Request, period?: { from: string; to: string }): ListFilter {
  const qFrom = qs(req, 'from')
  const qTo = qs(req, 'to')
  const from = period?.from ?? (qFrom && ISO.test(qFrom) ? qFrom : undefined)
  const to = period?.to ?? (qTo && ISO.test(qTo) ? qTo : undefined)
  const status = qs(req, 'status')
  if (status && !(STATUS_FILTERS as readonly string[]).includes(status)) {
    throw badRequest('Ese estado de pago no existe. Probá con: pagadas, por pagar o vencidas.')
  }
  const base: PurchasesFilter = {
    from: from && to && from > to ? to : from,
    to: from && to && from > to ? from : to,
    supplier_id: qn(req, 'supplier_id'),
    product_id: qn(req, 'product_id'),
  }
  // Los estados exactos los filtra el servicio; los combinados, acá.
  if (status === 'pagado' || status === 'parcial' || status === 'pendiente') base.status = status
  return { base, status: status as StatusFilter | undefined }
}

function applyStatus(list: PurchaseWithStatus[], status?: StatusFilter): PurchaseWithStatus[] {
  if (status === 'por_pagar') return list.filter((p) => p.status !== 'pagado')
  if (status === 'vencida') return list.filter((p) => p.overdue)
  return list
}

export interface PurchaseItemPreview {
  name: string
  qty: number
}

export type PurchaseListRow = PurchaseWithStatus & {
  /** Los vinos resumidos, para mostrar "24 botellas · Malbec Clásico +2" sin pedir el detalle. */
  items_preview: PurchaseItemPreview[]
}

/** Agrega a cada compra un resumen de sus vinos (nombre y cantidad). */
function withPreviews(list: PurchaseWithStatus[]): PurchaseListRow[] {
  if (!list.length) return []
  const ids = new Set(list.map((p) => p.id))
  const rows = all<{ purchase_id: number; qty: number; name: string }>(
    `SELECT pi.purchase_id, pi.qty, p.name
     FROM purchase_items pi JOIN products p ON p.id = pi.product_id
     ORDER BY pi.purchase_id, pi.id`,
  )
  const byPurchase = new Map<number, PurchaseItemPreview[]>()
  for (const r of rows) {
    if (!ids.has(r.purchase_id)) continue
    if (!byPurchase.has(r.purchase_id)) byPurchase.set(r.purchase_id, [])
    byPurchase.get(r.purchase_id)!.push({ name: r.name, qty: r.qty })
  }
  return list.map((p) => ({ ...p, items_preview: byPurchase.get(p.id) ?? [] }))
}

const statusLabel = (p: PurchaseWithStatus) => (p.status === 'pagado' ? 'Pagada' : p.overdue ? 'Vencida' : p.status === 'parcial' ? 'Pago parcial' : 'Por pagar')

// ───────────────────────── Detalle enriquecido ─────────────────────────

export type PurchaseDetailItem = PurchaseDetail['items'][number] & {
  winery: string | null
  units_per_box: number
  /** Cantidad × precio de factura. */
  line_total: number
  /** Parte del flete que le tocó a cada botella de este vino. */
  freight_per_bottle: number
  /** Cantidad × costo real (con flete). */
  landed_total: number
}

export type PurchaseDetailOut = Omit<PurchaseDetail, 'items' | 'payments'> & {
  items: PurchaseDetailItem[]
  payments: (Payment & { account_name: string | null })[]
}

/** Detalle de la compra + datos útiles para mostrar (bodega, flete por botella, nombre de la cuenta de cada pago). */
function detail(id: number): PurchaseDetailOut {
  const d = getPurchaseDetail(id)
  const products = new Map(
    all<{ id: number; winery: string | null; units_per_box: number }>(
      `SELECT id, winery, units_per_box FROM products WHERE id IN (SELECT product_id FROM purchase_items WHERE purchase_id = ?)`,
      [id],
    ).map((p) => [p.id, p]),
  )
  const accounts = new Map(all<{ id: number; name: string }>('SELECT id, name FROM accounts').map((a) => [a.id, a.name]))
  return {
    ...d,
    items: d.items.map((i) => ({
      ...i,
      winery: products.get(i.product_id)?.winery ?? null,
      units_per_box: products.get(i.product_id)?.units_per_box ?? 6,
      line_total: round2(i.qty * i.unit_cost),
      freight_per_bottle: round2(i.landed_unit_cost - i.unit_cost),
      landed_total: round2(i.qty * i.landed_unit_cost),
    })),
    payments: d.payments.map((p) => ({ ...p, account_name: accounts.get(p.account_id) ?? null })),
  }
}

function purchaseExists(id: number) {
  if (!get('SELECT id FROM purchases WHERE id = ?', [id])) throw notFound('esa compra')
}

function checkDueDate(data: { date: string; due_date: string | null; paid: boolean }) {
  if (!data.paid && data.due_date && data.due_date < data.date) {
    throw badRequest('El vencimiento no puede ser anterior a la fecha de la compra. Revisá las fechas.')
  }
}

// ───────────────────────── Listado y resumen ─────────────────────────

router.get('/purchases', (req, res) => {
  const f = readFilters(req)
  res.json(withPreviews(applyStatus(listPurchases(f.base), f.status)))
})

/**
 * Resumen del período para la pantalla de Compras.
 * - Lo comprado sale de finance.periodSummary (el mismo número que Inicio y Reportes).
 * - "Por pagar" se informa del período y en total (todas las compras con saldo, de cualquier fecha).
 * - cogs (CMV) y mermas del período sirven para explicar que comprar NO es gastar:
 *   lo que compraste entra al stock; lo que vendiste (a costo) es lo que cuenta en el resultado.
 */
router.get('/purchases/summary', (req, res) => {
  const { from, to } = parsePeriod(req)
  const ps = periodSummary(from, to)
  const list = listPurchases({ from, to })

  const bottles = list.reduce((s, p) => s + p.bottles, 0)
  const subtotal = round2(list.reduce((s, p) => s + p.subtotal, 0))
  const shipping = round2(list.reduce((s, p) => s + p.shipping, 0))
  const total = ps.purchases

  const pendingRows = list.filter((p) => p.balance > 0.01)
  const openAll = listPurchases({}).filter((p) => p.balance > 0.01)
  const overdueAll = openAll.filter((p) => p.overdue)

  const bySupplier = new Map<string, { supplier_id: number | null; name: string; total: number; bottles: number; count: number }>()
  for (const p of list) {
    const k = String(p.supplier_id ?? 'none')
    const acc = bySupplier.get(k) ?? { supplier_id: p.supplier_id, name: p.supplier_name || 'Sin proveedor', total: 0, bottles: 0, count: 0 }
    acc.total += p.total
    acc.bottles += p.bottles
    acc.count += 1
    bySupplier.set(k, acc)
  }

  // Serie mensual "compras vs. costo de lo vendido". Si el período abarca 2 meses o más, se muestra ese período
  // (hasta 24 meses y sin meses futuros); si es un solo mes, los últimos 6 meses hasta ese mes (para tener contexto).
  const t = today()
  const firstData = [scalar<string | null>('SELECT MIN(date) FROM purchases'), scalar<string | null>('SELECT MIN(date) FROM sales')].filter((x): x is string => !!x).sort()[0]
  const span = monthsBetween(from, to).length
  const capTo = to > t ? endOfMonth(t) : to
  let mFrom: string
  let mTo: string
  let mode: 'period' | 'last6'
  if (span >= 2) {
    mode = 'period'
    mTo = capTo < from ? to : capTo
    mFrom = startOfMonth(from)
    if (firstData && startOfMonth(firstData) > mFrom) mFrom = startOfMonth(firstData)
    const cap = addMonths(startOfMonth(mTo), -23)
    if (cap > mFrom) mFrom = cap
    if (mFrom > mTo) mFrom = startOfMonth(mTo)
  } else {
    mode = 'last6'
    mTo = endOfMonth(to)
    mFrom = addMonths(startOfMonth(to), -5)
  }
  const monthly = monthlySeries(mFrom, mTo).map((m) => ({ month: m.month, label: m.label, purchases: m.purchases, cogs: m.cogs }))

  res.json({
    from,
    to,
    count: list.length,
    /** Lo comprado en el período (precio de los vinos + flete). */
    total,
    subtotal,
    shipping,
    bottles,
    /** Costo real promedio de cada botella comprada (con flete): total ÷ botellas. */
    avg_cost_per_bottle: round2(safeDiv(total, bottles)),
    /** Precio promedio de factura (sin flete): subtotal ÷ botellas. */
    avg_invoice_cost: round2(safeDiv(subtotal, bottles)),
    /** Cuánto encareció el flete a los vinos: flete ÷ subtotal (0..1). */
    shipping_share: safeDiv(shipping, subtotal),
    /** Lo que falta pagar de las compras de ESTE período. */
    pending: round2(pendingRows.reduce((s, p) => s + p.balance, 0)),
    pending_count: pendingRows.length,
    /** Lo que le debés a proveedores por compras de vino (todas las fechas). */
    payables: {
      total: round2(openAll.reduce((s, p) => s + p.balance, 0)),
      count: openAll.length,
      overdue: round2(overdueAll.reduce((s, p) => s + p.balance, 0)),
      overdue_count: overdueAll.length,
      next_due:
        openAll
          .filter((p) => p.due_date && !p.overdue)
          .map((p) => p.due_date!)
          .sort()[0] ?? null,
    },
    by_supplier: [...bySupplier.values()].map((s) => ({ ...s, total: round2(s.total) })).sort((a, b) => b.total - a.total),
    /** Costo de las botellas vendidas en el período (lo que SÍ cuenta en el resultado). */
    cogs: ps.cogs,
    /** Roturas, degustaciones, regalos y faltantes del período, al costo. */
    shrinkage: ps.shrinkage,
    /** Lo que tenés hoy invertido en botellas (a costo). */
    stock_value: stockValue(),
    monthly,
    monthly_mode: mode,
    first_purchase_date: scalar<string | null>('SELECT MIN(date) FROM purchases') ?? null,
  })
})

// ───────────────────────── Excel ─────────────────────────

router.get('/purchases/export', async (req, res) => {
  const period = parsePeriod(req)
  const f = readFilters(req, period)
  const list = applyStatus(listPurchases(f.base), f.status)
  const ids = new Set(list.map((p) => p.id))
  const byId = new Map(list.map((p) => [p.id, p]))

  const items = all<{
    purchase_id: number
    product_name: string
    winery: string | null
    qty: number
    unit_cost: number
    landed_unit_cost: number
  }>(
    `SELECT pi.purchase_id, p.name AS product_name, p.winery, pi.qty, pi.unit_cost, pi.landed_unit_cost
     FROM purchase_items pi
     JOIN purchases pu ON pu.id = pi.purchase_id
     JOIN products p ON p.id = pi.product_id
     WHERE pu.date BETWEEN ? AND ?
     ORDER BY pu.date, pu.id, pi.id`,
    [period.from, period.to],
  ).filter((i) => ids.has(i.purchase_id))

  const rows = [...list].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
  const cols: ExcelColumn<PurchaseWithStatus>[] = [
    { header: 'Fecha', key: 'date', type: 'date' },
    { header: 'Compra Nº', key: 'id', type: 'int', total: false, width: 11 },
    { header: 'Proveedor', key: 'supplier_name', value: (p) => p.supplier_name || 'Sin proveedor', width: 28 },
    { header: 'Factura Nº', key: 'invoice_number', value: (p) => p.invoice_number || '', width: 20 },
    { header: 'Botellas', key: 'bottles', type: 'int', width: 10 },
    { header: 'Vinos (precio de factura)', key: 'subtotal', type: 'money', width: 18 },
    { header: 'Flete / envío', key: 'shipping', type: 'money' },
    { header: 'Total', key: 'total', type: 'money' },
    {
      header: 'Costo real por botella (promedio)',
      key: 'avg',
      value: (p) => round2(safeDiv(p.total, p.bottles)),
      type: 'money',
      total: false,
      width: 18,
    },
    { header: 'Pagado', key: 'paid', type: 'money' },
    { header: 'Saldo por pagar', key: 'balance', type: 'money' },
    { header: 'Estado', key: 'status', value: statusLabel, width: 14 },
    { header: 'Vence el', key: 'due_date', type: 'date' },
    { header: 'Notas', key: 'notes', value: (p) => p.notes || '', width: 30 },
  ]

  type ItemRow = (typeof items)[number]
  const itemCols: ExcelColumn<ItemRow>[] = [
    { header: 'Fecha', key: 'date', value: (i) => byId.get(i.purchase_id)?.date, type: 'date' },
    { header: 'Compra Nº', key: 'purchase_id', type: 'int', total: false, width: 11 },
    { header: 'Proveedor', key: 'supplier', value: (i) => byId.get(i.purchase_id)?.supplier_name || 'Sin proveedor', width: 26 },
    { header: 'Factura Nº', key: 'invoice', value: (i) => byId.get(i.purchase_id)?.invoice_number || '', width: 18 },
    { header: 'Vino', key: 'product_name', width: 30 },
    { header: 'Bodega', key: 'winery', value: (i) => i.winery || '', width: 22 },
    { header: 'Botellas', key: 'qty', type: 'int', width: 10 },
    { header: 'Precio por botella (factura)', key: 'unit_cost', type: 'money', total: false, width: 17 },
    { header: 'Flete por botella', key: 'freight', value: (i) => round2(i.landed_unit_cost - i.unit_cost), type: 'money', total: false },
    { header: 'Costo real por botella', key: 'landed_unit_cost', type: 'money', total: false, width: 17 },
    { header: 'Subtotal (factura)', key: 'line_total', value: (i) => round2(i.qty * i.unit_cost), type: 'money' },
    { header: 'Total real (con flete)', key: 'landed_total', value: (i) => round2(i.qty * i.landed_unit_cost), type: 'money', width: 18 },
  ]

  const STATUS_TEXT: Record<StatusFilter, string> = {
    pagado: 'solo pagadas',
    parcial: 'solo con pago parcial',
    pendiente: 'solo sin pagar',
    por_pagar: 'solo por pagar',
    vencida: 'solo vencidas',
  }
  const filterParts = [
    f.status ? STATUS_TEXT[f.status] : '',
    f.base.supplier_id ? `proveedor ${get<{ name: string }>('SELECT name FROM suppliers WHERE id = ?', [f.base.supplier_id])?.name ?? '—'}` : '',
    f.base.product_id ? `vino ${get<{ name: string }>('SELECT name FROM products WHERE id = ?', [f.base.product_id])?.name ?? '—'}` : '',
  ].filter(Boolean)
  const subtitle = periodSubtitle(period.from, period.to) + (filterParts.length ? ` · Filtro: ${filterParts.join(', ')}` : '')

  await sendWorkbook(res, excelFilename('compras'), [
    {
      name: 'Compras',
      title: 'Compras de vino',
      subtitle,
      columns: cols,
      rows,
      notes: [
        'Una fila por compra (factura) a una bodega o distribuidor.',
        'Total = vinos (precio de factura) + flete/envío. Es lo que le pagás (o le debés) al proveedor.',
        'Comprar vino NO es un gasto: la plata se transforma en botellas (stock). Recién cuando vendés una botella, su costo pasa a ser "costo de lo vendido" (CMV) y cuenta en el resultado.',
        'Costo real por botella = total ÷ botellas: incluye la parte del flete que le toca a cada botella.',
        'Pagado / Saldo por pagar: lo que ya salió de tus cuentas y lo que falta. Estado: Pagada, Pago parcial, Por pagar o Vencida (pasó la fecha de vencimiento).',
      ],
    },
    {
      name: 'Detalle por vino',
      title: 'Compras · detalle por vino',
      subtitle,
      columns: itemCols,
      rows: items,
      notes: [
        'Una fila por cada vino de cada compra.',
        'Flete por botella: el flete de la compra se reparte entre las botellas en proporción a su precio (el vino más caro absorbe más flete).',
        'Costo real por botella = precio de factura + flete por botella. Ese es el costo con el que entra al stock y se promedia con lo que ya tenías (costo promedio ponderado).',
        'La suma de "Total real (con flete)" coincide con el total de las compras (salvo centavos de redondeo).',
      ],
    },
  ])
})

// ───────────────────────── Una compra ─────────────────────────

router.get('/purchases/:id', (req, res) => {
  const id = parseId(req.params.id, 'esa compra')
  res.json(detail(id))
})

router.post('/purchases', (req, res) => {
  const data = validate(purchaseInput, req.body)
  checkDueDate(data)
  const id = createPurchase(data)
  res.status(201).json(detail(id))
})

router.put('/purchases/:id', (req, res) => {
  const id = parseId(req.params.id, 'esa compra')
  const data = validate(purchaseInput, req.body)
  const prev = get<{ total: number }>('SELECT total FROM purchases WHERE id = ?', [id])
  if (!prev) throw notFound('esa compra')
  checkDueDate(data)
  // Si queda "sin pagar" y ya tenía pagos parciales, esos pagos se mantienen:
  // no puede quedar pagado más de lo que vale la compra.
  if (!data.paid) {
    const newTotal = round2(data.items.reduce((s, i) => s + i.qty * i.unit_cost, 0) + (data.shipping ?? 0))
    const paid = paidFor('purchase', id)
    const wasFullyPaid = paid >= prev.total - 0.01
    if (!wasFullyPaid && paid > newTotal + 0.01) {
      throw badRequest(
        `Ya le pagaste $${paid.toLocaleString('es-AR')} de esta compra y el nuevo total sería $${newTotal.toLocaleString('es-AR')}. ` +
          'Marcala como pagada, o borrá algún pago desde el detalle de la compra antes de bajar el total.',
      )
    }
  }
  updatePurchase(id, data)
  res.json(detail(id))
})

router.delete('/purchases/:id', (req, res) => {
  const id = parseId(req.params.id, 'esa compra')
  deletePurchase(id)
  res.json({ ok: true })
})

/** Registrar un pago (total o parcial). */
router.post('/purchases/:id/payments', (req, res) => {
  const id = parseId(req.params.id, 'esa compra')
  purchaseExists(id)
  const s = validate(settlementInput, req.body)
  addSettlement('purchase', id, s)
  res.status(201).json(detail(id))
})

/** Borrar un pago de esta compra (la compra vuelve a tener ese saldo por pagar y la plata vuelve a la cuenta). */
router.delete('/purchases/:id/payments/:paymentId', (req, res) => {
  const id = parseId(req.params.id, 'esa compra')
  const paymentId = parseId(req.params.paymentId, 'ese pago')
  purchaseExists(id)
  const p = get<{ id: number }>("SELECT id FROM payments WHERE id = ? AND ref_type = 'purchase' AND ref_id = ?", [paymentId, id])
  if (!p) throw notFound('ese pago (puede que ya lo hayas borrado desde Caja)')
  deletePayment(paymentId)
  res.json({ ok: true })
})

export default router
