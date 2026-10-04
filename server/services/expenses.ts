// Gastos del negocio (alquiler, sueldos, envíos, marketing…).
// Fijos: se pagan igual vendas o no (alquiler, sueldos). Variables: crecen con las ventas (envíos, packaging).
// Separarlos es clave para calcular el punto de equilibrio.
import { all, get, run, tx } from '../db'
import { round2 } from '../../shared/calc'
import { endOfMonth, today } from '../../shared/dates'
import type { z } from 'zod'
import type { expenseInput } from '../../shared/schemas'
import type { ExpenseWithStatus, RecurringExpense } from '../../shared/types'
import { HttpError } from '../lib/http'
import { addPayment, defaultAccountId, deletePaymentsByRef, paidFor, paymentsFor } from './payments'

export type ExpenseData = z.output<typeof expenseInput> & { recurring_id?: number | null }

function checkRefs(data: ExpenseData) {
  if (data.supplier_id && !get('SELECT id FROM suppliers WHERE id = ?', [data.supplier_id])) throw new HttpError(400, 'El proveedor elegido no existe.')
  if (data.event_id && !get('SELECT id FROM events WHERE id = ?', [data.event_id])) throw new HttpError(400, 'El evento elegido no existe.')
}

function registerFullPayment(id: number, date: string, amount: number, accountId: number | null | undefined, description: string) {
  addPayment({
    date,
    account_id: accountId ?? defaultAccountId('efectivo'),
    direction: 'out',
    amount,
    ref_type: 'expense',
    ref_id: id,
    description,
  })
}

export function createExpense(data: ExpenseData): number {
  return tx(() => {
    checkRefs(data)
    const amount = round2(data.amount)
    const { lastInsertRowid: id } = run(
      `INSERT INTO expenses (date, category, description, amount, nature, supplier_id, due_date, event_id, recurring_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.date, data.category, data.description, amount, data.nature, data.supplier_id, data.due_date, data.event_id, data.recurring_id ?? null, data.notes],
    )
    if (data.paid) registerFullPayment(id, data.date, amount, data.account_id, data.description)
    return id
  })
}

export function updateExpense(id: number, data: ExpenseData) {
  tx(() => {
    const prev = get<{ amount: number; recurring_id: number | null }>('SELECT amount, recurring_id FROM expenses WHERE id = ?', [id])
    if (!prev) throw new HttpError(404, 'No encontramos ese gasto.')
    checkRefs(data)
    const amount = round2(data.amount)
    const prevPayments = paymentsFor('expense', id)
    const prevPaid = paidFor('expense', id)
    run(
      `UPDATE expenses SET date = ?, category = ?, description = ?, amount = ?, nature = ?, supplier_id = ?, due_date = ?, event_id = ?, notes = ? WHERE id = ?`,
      [data.date, data.category, data.description, amount, data.nature, data.supplier_id, data.due_date, data.event_id, data.notes, id],
    )
    if (data.paid) {
      const acc = data.account_id ?? prevPayments[0]?.account_id ?? null
      deletePaymentsByRef('expense', id)
      registerFullPayment(id, data.date, amount, acc, data.description)
    } else if (prevPaid >= prev.amount - 0.01 && prevPayments.length) {
      deletePaymentsByRef('expense', id)
    }
  })
}

export function deleteExpense(id: number) {
  tx(() => {
    if (!get('SELECT id FROM expenses WHERE id = ?', [id])) throw new HttpError(404, 'No encontramos ese gasto.')
    deletePaymentsByRef('expense', id)
    run('DELETE FROM expenses WHERE id = ?', [id])
  })
}

// ───────────────────────── Consultas ─────────────────────────

export const EXPENSES_SELECT = `
  SELECT ex.*,
    s.name AS supplier_name,
    ev.name AS event_name,
    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.ref_type = 'expense' AND p.ref_id = ex.id) AS paid
  FROM expenses ex
  LEFT JOIN suppliers s ON s.id = ex.supplier_id
  LEFT JOIN events ev ON ev.id = ex.event_id
`

export function decorateExpense(row: Record<string, unknown>): ExpenseWithStatus {
  const r = row as unknown as ExpenseWithStatus
  const paid = round2(r.paid)
  const balance = round2(r.amount - paid)
  const status = balance <= 0.01 ? 'pagado' : paid > 0.009 ? 'parcial' : 'pendiente'
  return { ...r, paid, balance, status, overdue: status !== 'pagado' && !!r.due_date && r.due_date < today() }
}

export interface ExpensesFilter {
  from?: string
  to?: string
  category?: string
  nature?: 'fijo' | 'variable'
  event_id?: number
  supplier_id?: number
  status?: 'pagado' | 'parcial' | 'pendiente'
}

export function listExpenses(f: ExpensesFilter = {}): ExpenseWithStatus[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (f.from) (where.push('ex.date >= ?'), params.push(f.from))
  if (f.to) (where.push('ex.date <= ?'), params.push(f.to))
  if (f.category) (where.push('ex.category = ?'), params.push(f.category))
  if (f.nature) (where.push('ex.nature = ?'), params.push(f.nature))
  if (f.event_id) (where.push('ex.event_id = ?'), params.push(f.event_id))
  if (f.supplier_id) (where.push('ex.supplier_id = ?'), params.push(f.supplier_id))
  const list = all(`${EXPENSES_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ex.date DESC, ex.id DESC`, params).map(decorateExpense)
  return f.status ? list.filter((e) => e.status === f.status) : list
}

// ───────────────────────── Gastos fijos recurrentes ─────────────────────────

/**
 * Genera los gastos del mes a partir de las plantillas de gastos fijos (alquiler, sueldos…).
 * Es seguro apretarlo varias veces: si ya existe el gasto de ese mes, no lo duplica.
 * Devuelve cuántos gastos creó.
 */
export function generateRecurringForMonth(month: string): { created: number; skipped: number } {
  return tx(() => {
    const templates = all<Omit<RecurringExpense, 'active' | 'auto_paid'> & { active: number; auto_paid: number }>('SELECT * FROM recurring_expenses WHERE active = 1')
    let created = 0
    let skipped = 0
    const last = Number(endOfMonth(`${month}-01`).slice(8, 10))
    for (const t of templates) {
      const exists = get('SELECT id FROM expenses WHERE recurring_id = ? AND substr(date, 1, 7) = ?', [t.id, month])
      if (exists) {
        skipped++
        continue
      }
      const day = String(Math.min(t.day_of_month, last)).padStart(2, '0')
      createExpense({
        date: `${month}-${day}`,
        category: t.category,
        description: t.description,
        amount: t.amount,
        nature: t.nature,
        supplier_id: null,
        due_date: `${month}-${day}`,
        event_id: null,
        notes: 'Generado automáticamente desde "Gastos fijos".',
        paid: !!t.auto_paid,
        account_id: t.account_id,
        recurring_id: t.id,
      })
      created++
    }
    return { created, skipped }
  })
}
