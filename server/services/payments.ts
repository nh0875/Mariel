// Caja: cada peso que entra o sale de una cuenta (efectivo, banco, Mercado Pago…)
// es un "movimiento de caja" (tabla payments).
//
// - Un cobro de venta suma a la cuenta; un pago de compra o de gasto resta.
// - Una venta/compra/gasto puede pagarse en partes: el saldo pendiente es total − pagado.
// - La comisión del medio de pago (ej. Mercado Pago) se descuenta sola de la cuenta
//   en cada cobro, proporcional a lo cobrado. Así el saldo de la cuenta coincide con
//   lo que ves en el banco/app.
import { randomUUID } from 'node:crypto'
import { all, get, run, scalar, tx } from '../db'
import { round2 } from '../../shared/calc'
import type { PaymentRefType, PaymentStatus } from '../../shared/constants'
import type { AccountWithBalance, Payment } from '../../shared/types'
import { HttpError } from '../lib/http'
import { accountFor } from './settings'

export interface NewPayment {
  date: string
  account_id: number
  direction: 'in' | 'out'
  amount: number
  ref_type: PaymentRefType
  ref_id?: number | null
  transfer_id?: string | null
  description?: string | null
}

export function addPayment(p: NewPayment): number {
  if (!(p.amount >= 0)) throw new HttpError(400, 'El monto no puede ser negativo.')
  const acc = get<{ id: number }>('SELECT id FROM accounts WHERE id = ?', [p.account_id])
  if (!acc) throw new HttpError(400, 'La cuenta elegida no existe. Elegí otra en "Caja".')
  const { lastInsertRowid } = run(
    `INSERT INTO payments (date, account_id, direction, amount, ref_type, ref_id, transfer_id, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.date, p.account_id, p.direction, round2(p.amount), p.ref_type, p.ref_id ?? null, p.transfer_id ?? null, p.description ?? null],
  )
  return lastInsertRowid
}

export function deletePaymentsByRef(refType: PaymentRefType, refId: number) {
  run('DELETE FROM payments WHERE ref_type = ? AND ref_id = ?', [refType, refId])
}

export function paymentsFor(refType: PaymentRefType, refId: number): Payment[] {
  return all<Payment>('SELECT * FROM payments WHERE ref_type = ? AND ref_id = ? ORDER BY date, id', [refType, refId])
}

/** Total pagado/cobrado de un comprobante. */
export function paidFor(refType: 'sale' | 'purchase' | 'expense', refId: number): number {
  return round2(scalar<number>('SELECT COALESCE(SUM(amount), 0) FROM payments WHERE ref_type = ? AND ref_id = ?', [refType, refId]) ?? 0)
}

/** Estado según lo pagado. Tolerancia de 1 centavo por redondeos. */
export function paymentStatus(total: number, paid: number): PaymentStatus {
  if (total <= 0.009 || paid >= total - 0.01) return 'pagado'
  if (paid > 0.009) return 'parcial'
  return 'pendiente'
}

/**
 * Cuenta a usar si el usuario no eligió una: la configurada para el medio de pago,
 * o la primera cuenta activa. Si no hay ninguna cuenta, crea "Caja (efectivo)".
 */
export function defaultAccountId(method?: string | null): number {
  const configured = method ? accountFor(method) : null
  if (configured && get('SELECT id FROM accounts WHERE id = ? AND active = 1', [configured])) return configured
  const first = get<{ id: number }>('SELECT id FROM accounts WHERE active = 1 ORDER BY id LIMIT 1')
  if (first) return first.id
  return run("INSERT INTO accounts (name, kind) VALUES ('Caja (efectivo)', 'efectivo')").lastInsertRowid
}

/**
 * Recrea las comisiones de cobro de una venta: una por cada cobro, proporcional.
 * Ej: venta $10.000 con comisión $629; si cobrás $5.000, se descuentan $314,50 de esa cuenta.
 */
export function syncSaleFees(saleId: number) {
  const sale = get<{ total: number; fee: number }>('SELECT total, fee FROM sales WHERE id = ?', [saleId])
  run("DELETE FROM payments WHERE ref_type = 'sale_fee' AND ref_id = ?", [saleId])
  if (!sale || sale.fee <= 0 || sale.total <= 0) return
  for (const p of paymentsFor('sale', saleId)) {
    const amount = round2((sale.fee * p.amount) / sale.total)
    if (amount <= 0) continue
    addPayment({
      date: p.date,
      account_id: p.account_id,
      direction: 'out',
      amount,
      ref_type: 'sale_fee',
      ref_id: saleId,
      description: `Comisión de cobro venta #${saleId}`,
    })
  }
}

const SETTLEMENT_INFO = {
  sale: { table: 'sales', direction: 'in' as const, label: 'venta', verb: 'cobro', what: 'falta cobrar' },
  purchase: { table: 'purchases', direction: 'out' as const, label: 'compra', verb: 'pago', what: 'falta pagar' },
  expense: { table: 'expenses', direction: 'out' as const, label: 'gasto', verb: 'pago', what: 'falta pagar' },
}

/** Total del comprobante (ventas/compras: total; gastos: amount). */
export function documentTotal(refType: 'sale' | 'purchase' | 'expense', refId: number): number | null {
  const col = refType === 'expense' ? 'amount' : 'total'
  const row = get<{ t: number }>(`SELECT ${col} AS t FROM ${SETTLEMENT_INFO[refType].table} WHERE id = ?`, [refId])
  return row ? row.t : null
}

/**
 * Registra un cobro (venta) o pago (compra/gasto), total o parcial.
 * No deja cobrar/pagar más de lo que falta.
 */
export function addSettlement(
  refType: 'sale' | 'purchase' | 'expense',
  refId: number,
  s: { date: string; amount: number; account_id: number; description?: string | null },
): number {
  const info = SETTLEMENT_INFO[refType]
  return tx(() => {
    const total = documentTotal(refType, refId)
    if (total == null) throw new HttpError(404, `No encontramos esa ${info.label}.`)
    const balance = round2(total - paidFor(refType, refId))
    if (balance <= 0.009) throw new HttpError(400, `Esta ${info.label} ya está saldada. No hay nada pendiente.`)
    if (s.amount > balance + 0.01) {
      throw new HttpError(400, `El ${info.verb} no puede superar lo que ${info.what}: $${balance.toLocaleString('es-AR')}.`)
    }
    const id = addPayment({
      date: s.date,
      account_id: s.account_id,
      direction: info.direction,
      amount: s.amount,
      ref_type: refType,
      ref_id: refId,
      description: s.description ?? null,
    })
    if (refType === 'sale') syncSaleFees(refId)
    return id
  })
}

/** Borra un movimiento de caja. Si era un cobro de venta, recalcula las comisiones; si era una transferencia, borra las dos patas. */
export function deletePayment(id: number) {
  tx(() => {
    const p = get<Payment>('SELECT * FROM payments WHERE id = ?', [id])
    if (!p) throw new HttpError(404, 'No encontramos ese movimiento.')
    if (p.ref_type === 'sale_fee') {
      throw new HttpError(400, 'Las comisiones se calculan solas. Para cambiarlas, editá la venta o su cobro.')
    }
    if (p.transfer_id) run('DELETE FROM payments WHERE transfer_id = ?', [p.transfer_id])
    else run('DELETE FROM payments WHERE id = ?', [id])
    if (p.ref_type === 'sale' && p.ref_id) syncSaleFees(p.ref_id)
  })
}

/** Transferencia entre cuentas: dos movimientos (sale de una, entra en otra) unidos por transfer_id. */
export function addTransfer(t: { date: string; from_account_id: number; to_account_id: number; amount: number; description?: string | null }) {
  const transferId = randomUUID()
  tx(() => {
    const desc = t.description || 'Transferencia entre cuentas'
    addPayment({ date: t.date, account_id: t.from_account_id, direction: 'out', amount: t.amount, ref_type: 'transfer', transfer_id: transferId, description: desc })
    addPayment({ date: t.date, account_id: t.to_account_id, direction: 'in', amount: t.amount, ref_type: 'transfer', transfer_id: transferId, description: desc })
  })
  return transferId
}

/** Saldos de todas las cuentas (saldo inicial + entradas − salidas), opcionalmente a una fecha. */
export function accountBalances(asOf?: string): AccountWithBalance[] {
  const rows = all<Omit<AccountWithBalance, 'active'> & { active: number }>(
    `SELECT a.*,
       COALESCE(SUM(CASE WHEN p.direction = 'in' THEN p.amount END), 0) AS total_in,
       COALESCE(SUM(CASE WHEN p.direction = 'out' THEN p.amount END), 0) AS total_out
     FROM accounts a
     LEFT JOIN payments p ON p.account_id = a.id ${asOf ? 'AND p.date <= ?' : ''}
     GROUP BY a.id
     ORDER BY a.active DESC, a.id`,
    asOf ? [asOf] : [],
  )
  return rows.map((r) => ({
    ...r,
    active: !!r.active,
    total_in: round2(r.total_in),
    total_out: round2(r.total_out),
    balance: round2(r.initial_balance + r.total_in - r.total_out),
  }))
}

/** Plata total disponible sumando todas las cuentas. */
export function totalCash(asOf?: string): number {
  return round2(accountBalances(asOf).reduce((s, a) => s + a.balance, 0))
}
