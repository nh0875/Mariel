// Gastos: alquiler, sueldos, servicios, envíos, packaging… y las plantillas de "gastos fijos del mes".
// (Ver docs/ARQUITECTURA.md → módulo "Gastos")
//
// Toda la lógica de plata vive en los servicios:
// - services/expenses.ts: alta/edición/borrado de gastos y generación de los gastos fijos del mes.
// - services/payments.ts: pagos (totales o parciales) y movimientos de caja.
// - services/finance.ts: los números del período (los mismos que Inicio y Reportes).
// Acá solo se valida, se filtra y se arma la respuesta para la pantalla.
import { Router, type Request } from 'express'
import { z } from 'zod'
import { expenseInput, recurringExpenseInput, settlementInput } from '../../shared/schemas'
import { EXPENSE_NATURES, type ExpenseNature } from '../../shared/constants'
import { pctChange, round2, safeDiv } from '../../shared/calc'
import { addDays, addMonths, daysBetween, endOfMonth, monthKey, monthLabelLong, previousPeriod, startOfMonth, today } from '../../shared/dates'
import type { ExpenseWithStatus, Payment, RecurringExpense } from '../../shared/types'
import { all, get, run, scalar, tx } from '../db'
import { badRequest, notFound, parseId, parsePeriod, qn, qs, validate } from '../lib/http'
import { excelFilename, periodSubtitle, sendWorkbook, type ExcelColumn } from '../lib/excel'
import {
  createExpense,
  decorateExpense,
  deleteExpense,
  EXPENSES_SELECT,
  generateRecurringForMonth,
  listExpenses,
  updateExpense,
  type ExpenseData,
  type ExpensesFilter,
} from '../services/expenses'
import { addPayment, addSettlement, deletePayment, deletePaymentsByRef, paidFor, paymentsFor } from '../services/payments'
import { expensesByCategory, monthlySeries, payables, periodSummary } from '../services/finance'
import { getSettings } from '../services/settings'

const router = Router()

// ───────────────────────── Tipos de respuesta ─────────────────────────

export type ExpensePaymentRow = Payment & { account_name: string | null }

/** Un gasto con sus pagos (lo que muestra el detalle). */
export interface ExpenseDetail extends ExpenseWithStatus {
  payments: ExpensePaymentRow[]
  /** Si salió de una plantilla de "gastos fijos del mes". */
  recurring: { id: number; description: string; active: boolean } | null
}

export interface RecurringRow extends RecurringExpense {
  account_name: string | null
  /** Último mes ('YYYY-MM') en que se generó un gasto desde esta plantilla. */
  last_generated_month: string | null
  /** Cuántos gastos se generaron en total desde esta plantilla. */
  generated_count: number
}

// ───────────────────────── Filtros ─────────────────────────

/**
 * Estados que se pueden filtrar:
 * - pagado / parcial / pendiente: el estado exacto.
 * - por_pagar: todo lo que tiene saldo (pendiente + parcial).
 * - vencido: tiene saldo y la fecha de vencimiento ya pasó.
 */
const STATUS_FILTERS = ['pagado', 'parcial', 'pendiente', 'por_pagar', 'vencido'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const ISO = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

interface ListFilter {
  base: ExpensesFilter
  status?: StatusFilter
}

/**
 * Lee los filtros del listado. Las fechas son opcionales: sin from/to trae todos los gastos
 * (lo usan, por ejemplo, la ficha de un evento o de un proveedor).
 */
function readFilters(req: Request, period?: { from: string; to: string }): ListFilter {
  const rawFrom = qs(req, 'from')
  const rawTo = qs(req, 'to')
  const from = period?.from ?? (rawFrom && ISO.test(rawFrom) ? rawFrom : undefined)
  const to = period?.to ?? (rawTo && ISO.test(rawTo) ? rawTo : undefined)
  const nature = qs(req, 'nature')
  if (nature && !(EXPENSE_NATURES as readonly string[]).includes(nature)) {
    throw badRequest('Ese tipo de gasto no existe. Elegí «fijo» o «variable».')
  }
  const status = qs(req, 'status')
  if (status && !(STATUS_FILTERS as readonly string[]).includes(status)) {
    throw badRequest('Ese estado de pago no existe. Probá con: pagados, por pagar o vencidos.')
  }
  const swap = from && to && from > to
  const base: ExpensesFilter = {
    from: swap ? to : from,
    to: swap ? from : to,
    category: qs(req, 'category'),
    nature: nature as ExpenseNature | undefined,
    event_id: qn(req, 'event_id'),
    supplier_id: qn(req, 'supplier_id'),
  }
  // Los estados exactos los filtra el servicio; los combinados, acá.
  if (status === 'pagado' || status === 'parcial' || status === 'pendiente') base.status = status
  return { base, status: status as StatusFilter | undefined }
}

function applyStatus(list: ExpenseWithStatus[], status?: StatusFilter): ExpenseWithStatus[] {
  if (status === 'por_pagar') return list.filter((e) => e.status !== 'pagado')
  if (status === 'vencido') return list.filter((e) => e.overdue)
  return list
}

const statusLabel = (e: ExpenseWithStatus) =>
  e.status === 'pagado' ? 'Pagado' : e.overdue ? 'Vencido' : e.status === 'parcial' ? 'Pago parcial' : 'Por pagar'
const natureLabel = (n: string) => (n === 'fijo' ? 'Fijo' : 'Variable')

// ───────────────────────── Ayudas ─────────────────────────

/**
 * Si no mandaron "fijo/variable", se usa el de la categoría configurada
 * (Configuración → Categorías de gastos). Ej: "Alquiler" → fijo, "Envíos" → variable.
 */
function withDefaultNature(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const b = body as Record<string, unknown>
  if (b.nature != null || typeof b.category !== 'string') return body
  const cat = getSettings().expense_categories.find((c) => c.name.trim().toLowerCase() === String(b.category).trim().toLowerCase())
  return cat ? { ...b, nature: cat.nature } : body
}

function getExpenseDetail(id: number): ExpenseDetail {
  const row = get(`${EXPENSES_SELECT} WHERE ex.id = ?`, [id])
  if (!row) throw notFound('ese gasto')
  const e = decorateExpense(row)
  const names = new Map(all<{ id: number; name: string }>('SELECT id, name FROM accounts').map((a) => [a.id, a.name]))
  const payments = paymentsFor('expense', id).map((p) => ({ ...p, account_name: names.get(p.account_id) ?? null }))
  const rec = e.recurring_id
    ? get<{ id: number; description: string; active: number }>('SELECT id, description, active FROM recurring_expenses WHERE id = ?', [e.recurring_id])
    : undefined
  return { ...e, payments, recurring: rec ? { id: rec.id, description: rec.description, active: !!rec.active } : null }
}

/** Día del mes para la plantilla: el de la fecha del gasto, como máximo 28 (así existe en todos los meses). */
const templateDay = (date: string) => Math.min(Number(date.slice(8, 10)) || 1, 28)

function recurringRows(where = '', params: (string | number)[] = []): RecurringRow[] {
  return all<Omit<RecurringRow, 'active' | 'auto_paid'> & { active: number; auto_paid: number }>(
    `SELECT r.*, a.name AS account_name,
       (SELECT MAX(substr(e.date, 1, 7)) FROM expenses e WHERE e.recurring_id = r.id) AS last_generated_month,
       (SELECT COUNT(*) FROM expenses e WHERE e.recurring_id = r.id) AS generated_count
     FROM recurring_expenses r
     LEFT JOIN accounts a ON a.id = r.account_id
     ${where}
     ORDER BY r.active DESC, r.day_of_month, r.description COLLATE NOCASE`,
    params,
  ).map((r) => ({ ...r, active: !!r.active, auto_paid: !!r.auto_paid }))
}

function getRecurring(id: number): RecurringRow {
  const row = recurringRows('WHERE r.id = ?', [id])[0]
  if (!row) throw notFound('ese gasto fijo')
  return row
}

function checkAccount(accountId: number | null | undefined) {
  if (accountId && !get('SELECT id FROM accounts WHERE id = ?', [accountId])) {
    throw badRequest('La cuenta elegida no existe. Elegí otra (o creala en «Caja y bancos»).')
  }
}

/** Estado de los gastos fijos de un mes: cuáles ya se cargaron y cuáles faltan. */
function recurringStatus(month: string) {
  const templates = recurringRows('WHERE r.active = 1')
  const generated = new Map(
    all<{ id: number; recurring_id: number; date: string }>(
      'SELECT id, recurring_id, date FROM expenses WHERE recurring_id IS NOT NULL AND substr(date, 1, 7) = ? ORDER BY id',
      [month],
    ).map((e) => [e.recurring_id, e]),
  )
  const items = templates.map((t) => {
    const e = generated.get(t.id)
    const detail = e ? decorateExpense(get(`${EXPENSES_SELECT} WHERE ex.id = ?`, [e.id])!) : null
    return {
      id: t.id,
      description: t.description,
      category: t.category,
      amount: t.amount,
      day_of_month: t.day_of_month,
      auto_paid: t.auto_paid,
      expense_id: detail?.id ?? null,
      expense_amount: detail?.amount ?? null,
      expense_status: detail?.status ?? null,
      expense_overdue: detail?.overdue ?? false,
    }
  })
  const missing = items.filter((i) => i.expense_id == null)
  return {
    month,
    label: monthLabelLong(month),
    templates: items.length,
    generated: items.length - missing.length,
    missing: missing.length,
    missing_amount: round2(missing.reduce((s, i) => s + i.amount, 0)),
    /** Lo que suman por mes todas las plantillas activas: el piso de gastos a cubrir. */
    monthly_total: round2(templates.reduce((s, t) => s + t.amount, 0)),
    items,
  }
}

const monthBody = z.object({ month: z.string().regex(MONTH, 'tiene que ser un mes válido (AAAA-MM)') })

// ───────────────────────── Listado y resumen ─────────────────────────

router.get('/expenses', (req, res) => {
  const f = readFilters(req)
  res.json(applyStatus(listExpenses(f.base), f.status))
})

/**
 * Resumen del período para la pantalla de Gastos.
 * Los totales salen de finance.periodSummary (los mismos números que Inicio y Reportes).
 *
 * Comparación justa: si el período todavía no terminó (ej. "este mes" al día 4), se comparan
 * los mismos días del período anterior (1 al 4 del mes pasado). Si no, el mes en curso
 * siempre parecería "mucho más barato" que el anterior.
 */
router.get('/expenses/summary', (req, res) => {
  const { from, to } = parsePeriod(req)
  const t = today()
  const ps = periodSummary(from, to)
  const list = listExpenses({ from, to })

  const pendingRows = list.filter((e) => e.balance > 0.009)
  const overdueRows = pendingRows.filter((e) => e.overdue)

  // Período anterior completo (mismo largo) y la ventana de comparación "justa".
  const prev = previousPeriod({ from, to })
  const prevPs = periodSummary(prev.from, prev.to)
  const partial = from <= t && t < to
  const cmpCur = { from, to: partial ? t : to }
  const cmpPrevTo = partial ? addDays(prev.from, daysBetween(from, t)) : prev.to
  const cmpPrev = { from: prev.from, to: cmpPrevTo < prev.to ? cmpPrevTo : prev.to }
  const curCmpPs = partial ? periodSummary(cmpCur.from, cmpCur.to) : ps
  const prevCmpPs = partial ? periodSummary(cmpPrev.from, cmpPrev.to) : prevPs
  const firstExpense = scalar<string | null>('SELECT MIN(date) FROM expenses')

  // Por categoría, con lo que se gastó en la ventana de comparación (para "lo que más creció").
  const prevByCat = new Map(expensesByCategory(cmpPrev.from, cmpPrev.to).map((c) => [c.category, c.amount]))
  const curByCat = partial ? new Map(expensesByCategory(cmpCur.from, cmpCur.to).map((c) => [c.category, c.amount])) : null
  // Cuánto de cada categoría fue fijo y cuánto variable (una categoría puede tener de los dos:
  // ej. "Impuestos" con el monotributo fijo y los Ingresos Brutos variables).
  const split = new Map<string, { fixed: number; variable: number }>()
  for (const e of list) {
    const s = split.get(e.category) ?? { fixed: 0, variable: 0 }
    if (e.nature === 'fijo') s.fixed += e.amount
    else s.variable += e.amount
    split.set(e.category, s)
  }
  const by_category = expensesByCategory(from, to).map((c) => {
    const current = curByCat ? (curByCat.get(c.category) ?? 0) : c.amount
    const previous = prevByCat.get(c.category) ?? 0
    const sp = split.get(c.category) ?? { fixed: 0, variable: 0 }
    return {
      ...c,
      // 'mixto' si en el período hubo gastos fijos y variables con esta categoría.
      nature: sp.fixed > 0.009 && sp.variable > 0.009 ? 'mixto' : sp.fixed > 0.009 ? 'fijo' : 'variable',
      fixed: round2(sp.fixed),
      variable: round2(sp.variable),
      pct: safeDiv(c.amount, ps.expenses),
      compare_current: round2(current),
      compare_previous: round2(previous),
      change: pctChange(current, previous),
    }
  })
  // Categorías que el período anterior tuvieron gasto y ahora no (para no esconder lo que bajó a cero).
  const gone = [...prevByCat.entries()]
    .filter(([cat, amount]) => amount > 0 && !by_category.some((c) => c.category === cat))
    .map(([category, amount]) => ({ category, previous: round2(amount) }))

  // Últimos 12 meses (terminando en el mes de "hasta", o en el actual si el período sigue abierto).
  const endRef = partial || to > t ? (from <= t ? t : to) : to
  const monthly = monthlySeries(addMonths(startOfMonth(endRef), -11), endOfMonth(endRef)).map((m) => ({
    month: m.month,
    label: m.label,
    fixed: m.expenses_fixed,
    variable: m.expenses_variable,
    total: m.expenses,
    sales: m.sales,
    vs_sales: m.sales > 0 ? safeDiv(m.expenses, m.sales) : null,
  }))

  const totals = (p: { expenses: number; expenses_fixed: number; expenses_variable: number; sales: number }) => ({
    total: p.expenses,
    fixed: p.expenses_fixed,
    variable: p.expenses_variable,
    sales: p.sales,
    vs_sales: p.sales > 0 ? safeDiv(p.expenses, p.sales) : null,
  })

  res.json({
    from,
    to,
    total: ps.expenses,
    fixed: ps.expenses_fixed,
    variable: ps.expenses_variable,
    count: list.length,
    pending: round2(pendingRows.reduce((s, e) => s + e.balance, 0)),
    pending_count: pendingRows.length,
    overdue: round2(overdueRows.reduce((s, e) => s + e.balance, 0)),
    overdue_count: overdueRows.length,
    /** Todo lo que debés de gastos, de cualquier fecha (no solo de este período). */
    payables_total: payables().expenses,
    sales: ps.sales,
    /** Gastos ÷ ventas del período (null si no hubo ventas). */
    vs_sales: ps.sales > 0 ? safeDiv(ps.expenses, ps.sales) : null,
    by_category,
    gone_categories: gone,
    previous: { from: prev.from, to: prev.to, ...totals(prevPs) },
    comparison: {
      mode: partial ? 'same_days' : 'full',
      /** Solo tiene sentido comparar si ya cargabas gastos al empezar el período anterior. */
      comparable: !!firstExpense && firstExpense <= cmpPrev.from,
      current: { ...cmpCur, ...totals(curCmpPs) },
      previous: { ...cmpPrev, ...totals(prevCmpPs) },
    },
    monthly,
    first_expense_date: firstExpense ?? null,
  })
})

// ───────────────────────── Excel ─────────────────────────

router.get('/expenses/export', async (req, res) => {
  const period = parsePeriod(req)
  const f = readFilters(req, period)
  const list = applyStatus(listExpenses(f.base), f.status).sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
  const total = list.reduce((s, e) => s + e.amount, 0)

  const cols: ExcelColumn<ExpenseWithStatus>[] = [
    { header: 'Fecha', key: 'date', type: 'date' },
    { header: 'Descripción', key: 'description', width: 34 },
    { header: 'Categoría', key: 'category', width: 28 },
    { header: 'Tipo', key: 'nature', value: (e) => natureLabel(e.nature), width: 10 },
    { header: 'Proveedor', key: 'supplier_name', value: (e) => e.supplier_name || '', width: 22 },
    { header: 'Evento', key: 'event_name', value: (e) => e.event_name || '', width: 22 },
    { header: 'Monto', key: 'amount', type: 'money' },
    { header: 'Pagado', key: 'paid', type: 'money' },
    { header: 'Falta pagar', key: 'balance', type: 'money' },
    { header: 'Estado', key: 'status', value: statusLabel, width: 13 },
    { header: 'Vence el', key: 'due_date', type: 'date' },
    { header: 'Gasto fijo automático', key: 'recurring_id', value: (e) => (e.recurring_id ? 'Sí' : ''), width: 12 },
    { header: 'Notas', key: 'notes', value: (e) => e.notes || '', width: 30 },
  ]

  // Por categoría: se arma con la misma lista (así respeta los filtros que se hayan elegido).
  const byCat = new Map<string, { category: string; fixed: number; variable: number; amount: number; count: number; pending: number }>()
  for (const e of list) {
    const c = byCat.get(e.category) ?? { category: e.category, fixed: 0, variable: 0, amount: 0, count: 0, pending: 0 }
    if (e.nature === 'fijo') c.fixed += e.amount
    else c.variable += e.amount
    c.amount += e.amount
    c.count += 1
    c.pending += e.balance
    byCat.set(e.category, c)
  }
  const catRows = [...byCat.values()].map((c) => ({ ...c, pct: safeDiv(c.amount, total) })).sort((a, b) => b.amount - a.amount)
  type CatRow = (typeof catRows)[number]
  const catCols: ExcelColumn<CatRow>[] = [
    { header: 'Categoría', key: 'category', width: 34 },
    { header: 'Cantidad de gastos', key: 'count', type: 'int', width: 12 },
    { header: 'Fijos', key: 'fixed', type: 'money' },
    { header: 'Variables', key: 'variable', type: 'money' },
    { header: 'Total', key: 'amount', type: 'money' },
    { header: '% del total', key: 'pct', type: 'percent', total: false, width: 11 },
    { header: 'Falta pagar', key: 'pending', type: 'money' },
  ]

  // Por mes (solo si el período tiene más de un mes): fijos vs. variables y su peso sobre las ventas.
  const months = monthlySeries(period.from, period.to)
  type MonthRow = (typeof months)[number]
  const monthCols: ExcelColumn<MonthRow>[] = [
    { header: 'Mes', key: 'label', width: 12 },
    { header: 'Gastos fijos', key: 'expenses_fixed', type: 'money' },
    { header: 'Gastos variables', key: 'expenses_variable', type: 'money' },
    { header: 'Total gastos', key: 'expenses', type: 'money' },
    { header: 'Ventas', key: 'sales', type: 'money' },
    { header: 'Gastos sobre ventas', key: 'ratio', value: (m) => (m.sales > 0 ? safeDiv(m.expenses, m.sales) : null), type: 'percent', total: false, width: 12 },
  ]

  const filterParts = [
    f.base.category ? `categoría ${f.base.category}` : '',
    f.base.nature ? `solo ${f.base.nature === 'fijo' ? 'fijos' : 'variables'}` : '',
    f.status ? { pagado: 'solo pagados', parcial: 'solo con pago parcial', pendiente: 'solo sin pagar', por_pagar: 'solo por pagar', vencido: 'solo vencidos' }[f.status] : '',
    f.base.supplier_id ? `proveedor ${get<{ name: string }>('SELECT name FROM suppliers WHERE id = ?', [f.base.supplier_id])?.name ?? '—'}` : '',
    f.base.event_id ? `evento ${get<{ name: string }>('SELECT name FROM events WHERE id = ?', [f.base.event_id])?.name ?? '—'}` : '',
  ].filter(Boolean)
  const subtitle = periodSubtitle(period.from, period.to) + (filterParts.length ? ` · Filtro: ${filterParts.join(', ')}` : '')

  const fixedVsVariable =
    'Fijo = lo pagás igual vendas o no (alquiler, sueldos, internet, contador). Variable = sube o baja según cuánto vendés (envíos, packaging, publicidad, impuestos sobre ventas). Los fijos son el piso que tenés que cubrir cada mes: con ellos se calcula el punto de equilibrio (Calculadora).'
  const sheets = [
    {
      name: 'Gastos',
      title: 'Gastos',
      subtitle,
      columns: cols,
      rows: list,
      notes: [
        'Una fila por gasto. Comprar vino NO está acá (es stock: va en «Compras de vino»), ni los retiros de los dueños (van en «Caja»).',
        fixedVsVariable,
        'Monto = lo que cuesta el gasto. Cuenta para el resultado en su fecha, aunque lo pagues después (criterio "devengado").',
        'Pagado / Falta pagar: lo que ya salió de tus cuentas y lo que todavía debés. Estado: Pagado, Pago parcial, Por pagar o Vencido (pasó la fecha de vencimiento).',
        '«Gasto fijo automático» = lo generó el sistema desde «Gastos fijos del mes».',
      ],
    },
    {
      name: 'Por categoría',
      title: 'Gastos por categoría',
      subtitle,
      columns: catCols,
      rows: catRows,
      notes: [
        'Suma de los gastos de la hoja «Gastos» agrupados por categoría, de mayor a menor.',
        '% del total = cuánto pesa cada categoría sobre todo lo que gastaste en el período. Las 2 o 3 primeras suelen explicar casi todo: ahí conviene mirar si querés ahorrar.',
        fixedVsVariable,
      ],
    },
  ]
  if (months.length > 1) {
    sheets.push({
      name: 'Por mes',
      title: 'Gastos por mes: fijos y variables',
      subtitle: periodSubtitle(period.from, period.to),
      columns: monthCols as ExcelColumn<any>[],
      rows: months as any[],
      notes: [
        'Todos los gastos de cada mes (sin filtros), separados en fijos y variables.',
        'Gastos sobre ventas = total de gastos ÷ ventas del mes. Ej: 30 % quiere decir que de cada $100 que vendiste, $30 se fueron en gastos (sin contar el costo del vino).',
        'Si los fijos suben mes a mes sin que suban las ventas, el punto de equilibrio se te aleja: revisá alquiler, abonos y suscripciones.',
        ...(months.some((m) => m.month === monthKey(today()))
          ? [`El mes de ${monthLabelLong(monthKey(today()))} todavía no terminó: sus números van hasta hoy, así que no los compares tal cual con un mes completo.`]
          : []),
      ],
    } as (typeof sheets)[number])
  }
  await sendWorkbook(res, excelFilename('gastos'), sheets)
})

// ───────────────────────── Un gasto ─────────────────────────

router.get('/expenses/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese gasto')
  res.json(getExpenseDetail(id))
})

/**
 * Nuevo gasto. Además de los campos del gasto acepta:
 * - repeat_monthly: true → crea también la plantilla en "Gastos fijos del mes" (día = el de la fecha, máx. 28)
 *   y la vincula a este gasto (así al generar ese mes no se duplica).
 * - repeat_auto_paid: true → la plantilla se marca "se paga sola" (débito automático) desde la misma cuenta.
 */
router.post('/expenses', (req, res) => {
  const data = validate(expenseInput, withDefaultNature(req.body))
  const repeat = req.body?.repeat_monthly === true
  const repeatAutoPaid = req.body?.repeat_auto_paid === true
  checkAccount(data.account_id)
  const id = tx(() => {
    let recurringId: number | null = null
    if (repeat) {
      recurringId = run(
        `INSERT INTO recurring_expenses (description, category, amount, nature, day_of_month, account_id, auto_paid, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [data.description, data.category, round2(data.amount), data.nature, templateDay(data.date), data.account_id, repeatAutoPaid],
      ).lastInsertRowid
    }
    const expenseId = createExpense({ ...data, recurring_id: recurringId } as ExpenseData)
    // Si no eligieron cuenta pero lo pagaron (salió de la caja principal), la plantilla recuerda esa misma cuenta:
    // así "se debita solo" sabe de dónde sale cada mes.
    if (recurringId && data.account_id == null) {
      const used = paymentsFor('expense', expenseId)[0]?.account_id
      if (used) run('UPDATE recurring_expenses SET account_id = ? WHERE id = ?', [used, recurringId])
    }
    return expenseId
  })
  res.status(201).json(getExpenseDetail(id))
})

router.put('/expenses/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese gasto')
  const data = validate(expenseInput, withDefaultNature(req.body))
  const prev = get<{ amount: number; date: string }>('SELECT amount, date FROM expenses WHERE id = ?', [id])
  if (!prev) throw notFound('ese gasto')
  checkAccount(data.account_id)
  const before = paymentsFor('expense', id)
  const paid = paidFor('expense', id)
  const wasFullyPaid = before.length > 0 && paid >= prev.amount - 0.01
  const amount = round2(data.amount)

  // "Todavía no lo pagué" con pagos parciales: los pagos se mantienen, así que el monto no puede quedar por debajo.
  if (!data.paid && !wasFullyPaid && paid > amount + 0.01) {
    throw badRequest(
      `Ya pagaste $${paid.toLocaleString('es-AR')} de este gasto y el nuevo monto sería $${amount.toLocaleString('es-AR')}. ` +
        'Marcalo como pagado, o borrá algún pago desde el detalle del gasto antes de bajar el monto.',
    )
  }

  // Si ya estaba pagado en varias partes (o en otra fecha) y no cambió ni el monto ni la cuenta,
  // se conservan los pagos tal cual: editar la descripción no tiene por qué mover la caja.
  const sameAccount = data.account_id == null || before.every((p) => p.account_id === data.account_id)
  const keepPayments =
    data.paid && wasFullyPaid && Math.abs(amount - prev.amount) < 0.005 && sameAccount && (before.length > 1 || before[0].date !== prev.date)

  tx(() => {
    updateExpense(id, data)
    if (keepPayments) {
      deletePaymentsByRef('expense', id)
      for (const p of before) {
        addPayment({ date: p.date, account_id: p.account_id, direction: p.direction, amount: p.amount, ref_type: 'expense', ref_id: id, description: p.description })
      }
    }
  })
  res.json(getExpenseDetail(id))
})

router.delete('/expenses/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese gasto')
  deleteExpense(id)
  res.json({ ok: true })
})

/** Registrar un pago (total o parcial). */
router.post('/expenses/:id/payments', (req, res) => {
  const id = parseId(req.params.id, 'ese gasto')
  if (!get('SELECT id FROM expenses WHERE id = ?', [id])) throw notFound('ese gasto')
  const s = validate(settlementInput, req.body)
  addSettlement('expense', id, s)
  res.status(201).json(getExpenseDetail(id))
})

/** Borrar un pago de este gasto (si se cargó mal). El gasto vuelve a quedar con ese saldo por pagar. */
router.delete('/expenses/:id/payments/:paymentId', (req, res) => {
  const id = parseId(req.params.id, 'ese gasto')
  const paymentId = parseId(req.params.paymentId, 'ese pago')
  const p = get<{ id: number }>("SELECT id FROM payments WHERE id = ? AND ref_type = 'expense' AND ref_id = ?", [paymentId, id])
  if (!p) throw notFound('ese pago')
  deletePayment(paymentId)
  res.json(getExpenseDetail(id))
})

// ───────────────────────── Gastos fijos del mes (plantillas) ─────────────────────────

router.get('/recurring-expenses', (_req, res) => {
  res.json(recurringRows())
})

/** ¿Qué gastos fijos ya se cargaron este mes y cuáles faltan? (?month=YYYY-MM, por defecto el actual) */
router.get('/recurring-expenses/status', (req, res) => {
  const m = qs(req, 'month')
  if (m && !MONTH.test(m)) throw badRequest('Revisá estos datos → Mes: tiene que ser un mes válido (AAAA-MM)')
  res.json(recurringStatus(m ?? monthKey(today())))
})

/**
 * Genera los gastos del mes a partir de las plantillas activas.
 * Es seguro apretarlo varias veces: si ya existe el gasto de ese mes, no lo duplica.
 */
router.post('/recurring-expenses/generate', (req, res) => {
  const { month } = validate(monthBody, req.body)
  const r = generateRecurringForMonth(month)
  res.json({ month, label: monthLabelLong(month), ...r, status: recurringStatus(month) })
})

router.post('/recurring-expenses', (req, res) => {
  const data = validate(recurringExpenseInput, req.body)
  checkAccount(data.account_id)
  const id = run(
    `INSERT INTO recurring_expenses (description, category, amount, nature, day_of_month, account_id, auto_paid, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.description, data.category, round2(data.amount), data.nature, data.day_of_month, data.account_id, data.auto_paid, data.active],
  ).lastInsertRowid
  res.status(201).json(getRecurring(id))
})

/** Editar una plantilla. Vale para los meses que se generen de ahora en adelante: los gastos ya cargados no cambian. */
router.put('/recurring-expenses/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese gasto fijo')
  if (!get('SELECT id FROM recurring_expenses WHERE id = ?', [id])) throw notFound('ese gasto fijo')
  const data = validate(recurringExpenseInput, req.body)
  checkAccount(data.account_id)
  run(
    `UPDATE recurring_expenses SET description = ?, category = ?, amount = ?, nature = ?, day_of_month = ?, account_id = ?, auto_paid = ?, active = ? WHERE id = ?`,
    [data.description, data.category, round2(data.amount), data.nature, data.day_of_month, data.account_id, data.auto_paid, data.active, id],
  )
  res.json(getRecurring(id))
})

/** Borrar una plantilla. Los gastos que ya se generaron quedan (son gastos reales); solo deja de generarse. */
router.delete('/recurring-expenses/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese gasto fijo')
  const r = run('DELETE FROM recurring_expenses WHERE id = ?', [id])
  if (!r.changes) throw notFound('ese gasto fijo')
  res.json({ ok: true })
})

export default router
