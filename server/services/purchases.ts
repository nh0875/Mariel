// Compras de vino a bodegas/distribuidores.
//
// Importante (y está explicado en la Ayuda): COMPRAR VINO NO ES UN GASTO.
// La plata se transforma en botellas (stock). Recién cuando vendés una botella,
// su costo pasa a ser "costo de la mercadería vendida" (CMV) en el resultado.
//
// El flete/envío de la compra se reparte entre las botellas (proporcional a su precio),
// así el costo de cada vino es el real: lo que pagaste para tenerlo en tu depósito.
import { all, get, run, tx } from '../db'
import { round2 } from '../../shared/calc'
import { today } from '../../shared/dates'
import type { z } from 'zod'
import type { purchaseInput } from '../../shared/schemas'
import type { PurchaseDetail, PurchaseWithStatus } from '../../shared/types'
import { HttpError } from '../lib/http'
import { addMovement, removeMovementsByRef } from './stock'
import { addPayment, defaultAccountId, deletePaymentsByRef, paidFor, paymentsFor } from './payments'

export type PurchaseData = z.output<typeof purchaseInput>

/** Costo real por botella = precio + parte proporcional del flete. */
export function landedCosts(items: { qty: number; unit_cost: number }[], shipping: number): number[] {
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_cost, 0)
  const bottles = items.reduce((s, i) => s + i.qty, 0)
  return items.map((i) => {
    if (!shipping) return i.unit_cost
    // Si todo vino bonificado (subtotal 0), el flete se reparte por botella.
    const share = subtotal > 0 ? (shipping * (i.qty * i.unit_cost)) / subtotal : (shipping * i.qty) / Math.max(bottles, 1)
    return Math.round((i.unit_cost + share / i.qty) * 10000) / 10000
  })
}

function checkRefs(data: PurchaseData) {
  if (data.supplier_id && !get('SELECT id FROM suppliers WHERE id = ?', [data.supplier_id])) {
    throw new HttpError(400, 'El proveedor elegido no existe.')
  }
  for (const it of data.items) {
    if (!get('SELECT id FROM products WHERE id = ?', [it.product_id])) throw new HttpError(400, 'Uno de los vinos elegidos no existe más.')
  }
}

function insertItems(purchaseId: number, date: string, data: PurchaseData) {
  const landed = landedCosts(data.items, data.shipping ?? 0)
  data.items.forEach((it, idx) => {
    const { lastInsertRowid: itemId } = run(
      'INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost, landed_unit_cost) VALUES (?, ?, ?, ?, ?)',
      [purchaseId, it.product_id, it.qty, round2(it.unit_cost), landed[idx]],
    )
    addMovement({
      product_id: it.product_id,
      date,
      kind: 'compra',
      qty: it.qty,
      unit_cost: landed[idx],
      ref_type: 'purchase_item',
      ref_id: itemId,
    })
  })
}

function removeItems(purchaseId: number) {
  const ids = all<{ id: number }>('SELECT id FROM purchase_items WHERE purchase_id = ?', [purchaseId]).map((r) => r.id)
  removeMovementsByRef('purchase_item', ids)
  run('DELETE FROM purchase_items WHERE purchase_id = ?', [purchaseId])
}

function totals(data: PurchaseData) {
  const subtotal = round2(data.items.reduce((s, i) => s + i.qty * i.unit_cost, 0))
  const shipping = round2(data.shipping ?? 0)
  return { subtotal, shipping, total: round2(subtotal + shipping) }
}

function registerFullPayment(id: number, date: string, total: number, accountId: number | null | undefined) {
  if (total <= 0) return
  addPayment({
    date,
    account_id: accountId ?? defaultAccountId('transferencia'),
    direction: 'out',
    amount: total,
    ref_type: 'purchase',
    ref_id: id,
    description: `Pago compra #${id}`,
  })
}

export function createPurchase(data: PurchaseData): number {
  return tx(() => {
    checkRefs(data)
    const t = totals(data)
    const { lastInsertRowid: id } = run(
      `INSERT INTO purchases (date, supplier_id, invoice_number, subtotal, shipping, total, due_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.date, data.supplier_id, data.invoice_number, t.subtotal, t.shipping, t.total, data.due_date, data.notes],
    )
    insertItems(id, data.date, data)
    if (data.paid) registerFullPayment(id, data.date, t.total, data.account_id)
    return id
  })
}

/** Misma lógica de pagos que en ventas: paid=true deja todo pagado; paid=false revierte un pago total. */
export function updatePurchase(id: number, data: PurchaseData) {
  tx(() => {
    const prev = get<{ total: number }>('SELECT total FROM purchases WHERE id = ?', [id])
    if (!prev) throw new HttpError(404, 'No encontramos esa compra.')
    checkRefs(data)
    const t = totals(data)
    const prevPayments = paymentsFor('purchase', id)
    const prevPaid = paidFor('purchase', id)
    removeItems(id)
    run(
      `UPDATE purchases SET date = ?, supplier_id = ?, invoice_number = ?, subtotal = ?, shipping = ?, total = ?, due_date = ?, notes = ? WHERE id = ?`,
      [data.date, data.supplier_id, data.invoice_number, t.subtotal, t.shipping, t.total, data.due_date, data.notes, id],
    )
    insertItems(id, data.date, data)
    if (data.paid) {
      const acc = data.account_id ?? prevPayments[0]?.account_id ?? null
      deletePaymentsByRef('purchase', id)
      registerFullPayment(id, data.date, t.total, acc)
    } else if (prevPaid >= prev.total - 0.01 && prevPayments.length) {
      deletePaymentsByRef('purchase', id)
    }
  })
}

export function deletePurchase(id: number) {
  tx(() => {
    if (!get('SELECT id FROM purchases WHERE id = ?', [id])) throw new HttpError(404, 'No encontramos esa compra.')
    removeItems(id)
    deletePaymentsByRef('purchase', id)
    run('DELETE FROM purchases WHERE id = ?', [id])
  })
}

// ───────────────────────── Consultas ─────────────────────────

export const PURCHASES_SELECT = `
  SELECT pu.*,
    s.name AS supplier_name,
    (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = pu.id) AS items_count,
    (SELECT COALESCE(SUM(pi.qty), 0) FROM purchase_items pi WHERE pi.purchase_id = pu.id) AS bottles,
    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.ref_type = 'purchase' AND p.ref_id = pu.id) AS paid
  FROM purchases pu
  LEFT JOIN suppliers s ON s.id = pu.supplier_id
`

export function decoratePurchase(row: Record<string, unknown>): PurchaseWithStatus {
  const r = row as unknown as PurchaseWithStatus
  const paid = round2(r.paid)
  const balance = round2(r.total - paid)
  const status = balance <= 0.01 ? 'pagado' : paid > 0.009 ? 'parcial' : 'pendiente'
  return { ...r, paid, balance, status, overdue: status !== 'pagado' && !!r.due_date && r.due_date < today() }
}

export interface PurchasesFilter {
  from?: string
  to?: string
  supplier_id?: number
  status?: 'pagado' | 'parcial' | 'pendiente'
  product_id?: number
}

export function listPurchases(f: PurchasesFilter = {}): PurchaseWithStatus[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (f.from) (where.push('pu.date >= ?'), params.push(f.from))
  if (f.to) (where.push('pu.date <= ?'), params.push(f.to))
  if (f.supplier_id) (where.push('pu.supplier_id = ?'), params.push(f.supplier_id))
  if (f.product_id) (where.push('EXISTS (SELECT 1 FROM purchase_items x WHERE x.purchase_id = pu.id AND x.product_id = ?)'), params.push(f.product_id))
  const list = all(`${PURCHASES_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pu.date DESC, pu.id DESC`, params).map(decoratePurchase)
  return f.status ? list.filter((p) => p.status === f.status) : list
}

export function getPurchaseDetail(id: number): PurchaseDetail {
  const row = get(`${PURCHASES_SELECT} WHERE pu.id = ?`, [id])
  if (!row) throw new HttpError(404, 'No encontramos esa compra.')
  const items = all<PurchaseDetail['items'][number]>(
    'SELECT pi.*, p.name AS product_name FROM purchase_items pi JOIN products p ON p.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.id',
    [id],
  )
  return { ...decoratePurchase(row), items, payments: paymentsFor('purchase', id) }
}
