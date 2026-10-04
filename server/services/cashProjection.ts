// Por cobrar, por pagar y proyección de caja a 30 días.
// Lo usan Caja (pestaña "Por cobrar y por pagar" y su Excel) e Inicio (alerta "la caja no alcanza"),
// así los dos muestran exactamente los mismos números.
//
// La proyección = plata de hoy + lo que te tienen que pagar − lo que tenés que pagar − gastos fijos
// que todavía no se generaron ± lo PROGRAMADO (movimientos ya cargados con fecha más adelante: su
// documento figura pagado/cobrado, pero la plata se mueve ese día y el saldo de hoy no lo cuenta).
import { round2 } from '../../shared/calc'
import { addDays, daysBetween, endOfMonth, monthsBetween, today } from '../../shared/dates'
import type { SaleWithStatus } from '../../shared/types'
import { all, get } from '../db'
import { scheduledPayments, totalCash, type ScheduledPayment } from './payments'
import { listSales } from './sales'
import { listPurchases } from './purchases'
import { listExpenses } from './expenses'

export type ReceivableRow = SaleWithStatus & {
  /** Días desde el vencimiento (0 si no venció o no tiene fecha). */
  days_overdue: number
  /** Días desde la venta. */
  age_days: number
}

export interface PayableRow {
  type: 'purchase' | 'expense'
  id: number
  date: string
  due_date: string | null
  /** Proveedor (compras) o descripción del gasto. */
  name: string
  /** "Compra #4 · factura A-0003" / "Alquiler · Inmobiliaria Sur". */
  detail: string
  supplier_id: number | null
  total: number
  paid: number
  balance: number
  overdue: boolean
  days_overdue: number
}

export function pendingLists(ref: string = today()): { receivables: ReceivableRow[]; payables: PayableRow[] } {
  const t = ref
  const daysOver = (overdue: boolean, due: string | null) => (overdue && due ? Math.max(0, daysBetween(due, t)) : 0)
  const rec = listSales({})
    .filter((s) => s.balance > 0.01)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((s) => ({ ...s, days_overdue: daysOver(s.overdue, s.due_date), age_days: Math.max(0, daysBetween(s.date, t)) }))
  const pay: PayableRow[] = [
    ...listPurchases({})
      .filter((p) => p.balance > 0.01)
      .map((p) => ({
        type: 'purchase' as const,
        id: p.id,
        date: p.date,
        due_date: p.due_date,
        name: p.supplier_name ?? 'Compra sin proveedor',
        detail: `Compra #${p.id}${p.invoice_number ? ` · factura ${p.invoice_number}` : ''}`,
        supplier_id: p.supplier_id,
        total: p.total,
        paid: p.paid,
        balance: p.balance,
        overdue: p.overdue,
        days_overdue: daysOver(p.overdue, p.due_date),
      })),
    ...listExpenses({})
      .filter((e) => e.balance > 0.01)
      .map((e) => ({
        type: 'expense' as const,
        id: e.id,
        date: e.date,
        due_date: e.due_date,
        name: e.description,
        detail: [e.category, e.supplier_name].filter(Boolean).join(' · '),
        supplier_id: e.supplier_id,
        total: e.amount,
        paid: e.paid,
        balance: e.balance,
        overdue: e.overdue,
        days_overdue: daysOver(e.overdue, e.due_date),
      })),
  ].sort((a, b) => (a.due_date ?? a.date).localeCompare(b.due_date ?? b.date) || a.date.localeCompare(b.date) || a.id - b.id)
  return { receivables: rec, payables: pay }
}

export interface Projection {
  days: number
  from: string
  until: string
  /** Plata en todas las cuentas hoy. */
  cash_now: number
  /** Lo que te tendrían que pagar hasta `until` (vencido + vence en el plazo + ventas a cuenta sin fecha + cobros programados). */
  next_30_days_in: number
  /** Lo que tendrías que pagar hasta `until` (vencido + vence en el plazo + sin fecha + pagos programados + gastos fijos que todavía no se generaron). */
  next_30_days_out: number
  /** cash_now + entra − sale. */
  expected_balance: number
  /**
   * scheduled: movimientos ya cargados con fecha entre mañana y `until` (ej. gastos fijos generados como
   * pagados con fecha del 20). Su documento figura como pagado, pero la plata todavía no salió: el saldo
   * de hoy no los cuenta, así que se suman acá aparte.
   */
  in_breakdown: { overdue: number; upcoming: number; no_date: number; later: number; scheduled: number }
  out_breakdown: { overdue: number; upcoming: number; no_date: number; later: number; fixed: number; scheduled: number }
  fixed_items: { id: number; description: string; category: string; amount: number; date: string }[]
  /** Detalle de los movimientos programados (cobros y pagos) que entran en la cuenta. */
  scheduled_items: ScheduledPayment[]
}

/** Qué pasaría con la caja en los próximos N días si se cobra y se paga todo lo que vence. */
export function projection(lists?: ReturnType<typeof pendingLists>, days = 30, ref: string = today()): Projection {
  const t = ref
  lists ??= pendingLists(ref)
  const until = addDays(t, days)
  const bucket = (rows: { due_date: string | null; balance: number }[]) => {
    const b = { overdue: 0, upcoming: 0, no_date: 0, later: 0 }
    for (const r of rows) {
      if (!r.due_date) b.no_date += r.balance
      else if (r.due_date < t) b.overdue += r.balance
      else if (r.due_date <= until) b.upcoming += r.balance
      else b.later += r.balance
    }
    return { overdue: round2(b.overdue), upcoming: round2(b.upcoming), no_date: round2(b.no_date), later: round2(b.later) }
  }
  const inB = bucket(lists.receivables)
  const outB = bucket(lists.payables)

  // Gastos fijos (plantillas de "Gastos fijos") que caen en el plazo y todavía no se generaron.
  const templates = all<{ id: number; description: string; category: string; amount: number; day_of_month: number }>(
    'SELECT id, description, category, amount, day_of_month FROM recurring_expenses WHERE active = 1 ORDER BY day_of_month, id',
  )
  const fixed_items: Projection['fixed_items'] = []
  for (const m of monthsBetween(t, until)) {
    const last = Number(endOfMonth(`${m}-01`).slice(8, 10))
    for (const tpl of templates) {
      const date = `${m}-${String(Math.min(tpl.day_of_month, last)).padStart(2, '0')}`
      if (date > until) continue
      const generated = get('SELECT id FROM expenses WHERE recurring_id = ? AND substr(date, 1, 7) = ?', [tpl.id, m])
      if (generated) continue
      fixed_items.push({ id: tpl.id, description: tpl.description, category: tpl.category, amount: round2(tpl.amount), date })
    }
  }
  const fixed = round2(fixed_items.reduce((s, f) => s + f.amount, 0))
  // Programados: ya cargados (el documento figura pagado/cobrado) pero con fecha más adelante.
  const scheduled_items = scheduledPayments(t, until)
  const schedIn = round2(scheduled_items.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount, 0))
  const schedOut = round2(scheduled_items.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount, 0))
  const cash_now = totalCash(t)
  const next_in = round2(inB.overdue + inB.upcoming + inB.no_date + schedIn)
  const next_out = round2(outB.overdue + outB.upcoming + outB.no_date + fixed + schedOut)
  return {
    days,
    from: t,
    until,
    cash_now,
    next_30_days_in: next_in,
    next_30_days_out: next_out,
    expected_balance: round2(cash_now + next_in - next_out),
    in_breakdown: { ...inB, scheduled: schedIn },
    out_breakdown: { ...outB, fixed, scheduled: schedOut },
    fixed_items,
    scheduled_items,
  }
}

