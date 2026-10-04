// Ventas: el corazón del negocio.
// Al guardar una venta:
//   1) se descuentan las botellas del stock (movimiento "venta"),
//   2) se congela el costo de cada botella (para saber cuánto ganaste de verdad),
//   3) si ya la cobraste, entra la plata en la cuenta elegida (y sale la comisión del medio de pago).
import { all, get, run, tx } from '../db'
import { round2 } from '../../shared/calc'
import { today } from '../../shared/dates'
import type { z } from 'zod'
import type { saleInput } from '../../shared/schemas'
import type { SaleDetail, SaleWithStatus } from '../../shared/types'
import { HttpError } from '../lib/http'
import { addMovement, removeMovementsByRef } from './stock'
import { addPayment, defaultAccountId, deletePaymentsByRef, paidFor, paymentsFor, syncSaleFees } from './payments'
import { feePctFor } from './settings'

export type SaleData = z.output<typeof saleInput>

function computeTotals(data: SaleData) {
  const subtotal = round2(data.items.reduce((s, i) => s + i.qty * i.unit_price, 0))
  const discount = round2(data.discount ?? 0)
  const shipping = round2(data.shipping ?? 0)
  if (discount > subtotal + shipping + 0.001) throw new HttpError(400, 'El descuento no puede ser mayor que el total de la venta.')
  const total = round2(subtotal - discount + shipping)
  const fee = data.fee != null ? round2(data.fee) : round2((total * feePctFor(data.payment_method)) / 100)
  return { subtotal, discount, shipping, total, fee }
}

function checkRefs(data: SaleData) {
  if (data.client_id && !get('SELECT id FROM clients WHERE id = ?', [data.client_id])) throw new HttpError(400, 'El cliente elegido no existe.')
  if (data.event_id && !get('SELECT id FROM events WHERE id = ?', [data.event_id])) throw new HttpError(400, 'El evento elegido no existe.')
  for (const it of data.items) {
    if (it.product_id && !get('SELECT id FROM products WHERE id = ?', [it.product_id])) {
      throw new HttpError(400, 'Uno de los vinos elegidos no existe más. Revisá los renglones.')
    }
  }
}

function insertItems(saleId: number, date: string, data: SaleData) {
  for (const it of data.items) {
    const { lastInsertRowid: itemId } = run(
      'INSERT INTO sale_items (sale_id, product_id, description, qty, unit_price, unit_cost) VALUES (?, ?, ?, ?, ?, 0)',
      [saleId, it.product_id ?? null, it.description ?? null, it.qty, round2(it.unit_price)],
    )
    if (it.product_id) {
      addMovement({ product_id: it.product_id, date, kind: 'venta', qty: -it.qty, ref_type: 'sale_item', ref_id: itemId })
    }
  }
}

function removeItems(saleId: number) {
  const itemIds = all<{ id: number }>('SELECT id FROM sale_items WHERE sale_id = ?', [saleId]).map((r) => r.id)
  removeMovementsByRef('sale_item', itemIds)
  run('DELETE FROM sale_items WHERE sale_id = ?', [saleId])
}

function registerFullPayment(saleId: number, date: string, total: number, data: SaleData, accountId?: number | null) {
  if (total <= 0) return
  addPayment({
    date,
    account_id: accountId ?? data.account_id ?? defaultAccountId(data.payment_method),
    direction: 'in',
    amount: total,
    ref_type: 'sale',
    ref_id: saleId,
    description: `Cobro venta #${saleId}`,
  })
}

export function createSale(data: SaleData): number {
  return tx(() => {
    checkRefs(data)
    const t = computeTotals(data)
    const { lastInsertRowid: id } = run(
      `INSERT INTO sales (date, client_id, channel, price_list, payment_method, subtotal, discount, shipping, total, fee, due_date, event_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.date, data.client_id, data.channel, data.price_list, data.payment_method, t.subtotal, t.discount, t.shipping, t.total, t.fee, data.due_date, data.event_id, data.notes],
    )
    insertItems(id, data.date, data)
    if (data.paid) registerFullPayment(id, data.date, t.total, data)
    syncSaleFees(id)
    return id
  })
}

/**
 * Edita una venta. Los renglones se reemplazan (y el stock se recalcula).
 * Cobros:
 *  - paid = true  → queda cobrada completa (se reemplazan los cobros por uno solo por el total nuevo).
 *  - paid = false → si estaba cobrada completa, vuelve a "pendiente" (se borran los cobros);
 *                   si tenía cobros parciales, se mantienen.
 */
export function updateSale(id: number, data: SaleData) {
  tx(() => {
    const prev = get<{ id: number; total: number }>('SELECT id, total FROM sales WHERE id = ?', [id])
    if (!prev) throw new HttpError(404, 'No encontramos esa venta.')
    checkRefs(data)
    const t = computeTotals(data)
    const prevPayments = paymentsFor('sale', id)
    const prevPaid = paidFor('sale', id)
    removeItems(id)
    run(
      `UPDATE sales SET date = ?, client_id = ?, channel = ?, price_list = ?, payment_method = ?, subtotal = ?, discount = ?, shipping = ?,
         total = ?, fee = ?, due_date = ?, event_id = ?, notes = ? WHERE id = ?`,
      [data.date, data.client_id, data.channel, data.price_list, data.payment_method, t.subtotal, t.discount, t.shipping, t.total, t.fee, data.due_date, data.event_id, data.notes, id],
    )
    insertItems(id, data.date, data)
    if (data.paid) {
      const keepAccount = data.account_id ?? prevPayments[0]?.account_id ?? null
      deletePaymentsByRef('sale', id)
      registerFullPayment(id, data.date, t.total, data, keepAccount)
    } else if (prevPaid >= prev.total - 0.01 && prevPayments.length) {
      deletePaymentsByRef('sale', id)
    }
    syncSaleFees(id)
  })
}

export function deleteSale(id: number) {
  tx(() => {
    if (!get('SELECT id FROM sales WHERE id = ?', [id])) throw new HttpError(404, 'No encontramos esa venta.')
    removeItems(id)
    deletePaymentsByRef('sale', id)
    deletePaymentsByRef('sale_fee', id)
    run('DELETE FROM sales WHERE id = ?', [id])
  })
}

// ───────────────────────── Consultas ─────────────────────────

/** SELECT base de ventas con costo, cobrado y saldo ya calculados. */
export const SALES_SELECT = `
  SELECT s.*,
    c.name AS client_name,
    e.name AS event_name,
    (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items_count,
    (SELECT COALESCE(SUM(si.qty), 0) FROM sale_items si WHERE si.sale_id = s.id AND si.product_id IS NOT NULL) AS bottles,
    (SELECT COALESCE(SUM(si.qty * si.unit_cost), 0) FROM sale_items si WHERE si.sale_id = s.id) AS cost,
    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.ref_type = 'sale' AND p.ref_id = s.id) AS paid
  FROM sales s
  LEFT JOIN clients c ON c.id = s.client_id
  LEFT JOIN events e ON e.id = s.event_id
`

export function decorateSale(row: Record<string, unknown>): SaleWithStatus {
  const r = row as unknown as SaleWithStatus
  const cost = round2(r.cost)
  const paid = round2(r.paid)
  const balance = round2(r.total - paid)
  const status = balance <= 0.01 ? 'pagado' : paid > 0.009 ? 'parcial' : 'pendiente'
  return {
    ...r,
    cost,
    paid,
    balance,
    profit: round2(r.total - r.fee - cost),
    status,
    overdue: status !== 'pagado' && !!r.due_date && r.due_date < today(),
  }
}

export interface SalesFilter {
  from?: string
  to?: string
  channel?: string
  client_id?: number
  event_id?: number
  status?: 'pagado' | 'parcial' | 'pendiente'
  product_id?: number
}

export function listSales(f: SalesFilter = {}): SaleWithStatus[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (f.from) (where.push('s.date >= ?'), params.push(f.from))
  if (f.to) (where.push('s.date <= ?'), params.push(f.to))
  if (f.channel) (where.push('s.channel = ?'), params.push(f.channel))
  if (f.client_id) (where.push('s.client_id = ?'), params.push(f.client_id))
  if (f.event_id) (where.push('s.event_id = ?'), params.push(f.event_id))
  if (f.product_id) (where.push('EXISTS (SELECT 1 FROM sale_items x WHERE x.sale_id = s.id AND x.product_id = ?)'), params.push(f.product_id))
  const rows = all(`${SALES_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.date DESC, s.id DESC`, params)
  const list = rows.map(decorateSale)
  return f.status ? list.filter((s) => s.status === f.status) : list
}

export function getSaleDetail(id: number): SaleDetail {
  const row = get(`${SALES_SELECT} WHERE s.id = ?`, [id])
  if (!row) throw new HttpError(404, 'No encontramos esa venta.')
  const items = all<SaleDetail['items'][number]>(
    `SELECT si.*, p.name AS product_name FROM sale_items si LEFT JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id`,
    [id],
  )
  return { ...decorateSale(row), items, payments: paymentsFor('sale', id) }
}
