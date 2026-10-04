// Metas: cuánto querés vender y cuánto pensás gastar cada mes, y cómo vas.
// (Ver docs/ARQUITECTURA.md → módulo "Inicio + Metas")
//
// Lo real de cada mes sale de services/finance.ts (monthlySeries), igual que en Inicio y Reportes.
// La sugerencia de meta se explica paso a paso: punto de equilibrio (el piso para no perder)
// y lo que vendiste el año pasado ajustado por inflación (para no achicarte en términos reales).
import { Router } from 'express'
import { roundUpTo, round2, safeDiv } from '../../shared/calc'
import { goalInput } from '../../shared/schemas'
import { addMonths, endOfMonth, monthKey, monthLabel, monthLabelLong, monthsBetween, startOfMonth, today } from '../../shared/dates'
import type { Goal, MonthlyPoint } from '../../shared/types'
import { all, get, run } from '../db'
import { badRequest, HttpError, notFound, qs, validate } from '../lib/http'
import { excelFilename, periodSubtitle, sendWorkbook } from '../lib/excel'
import { monthlySeries } from '../services/finance'

const router = Router()

// ───────────────────────── Tipos de respuesta ─────────────────────────

export interface GoalMonth extends Goal {
  /** 'enero 2026' */
  label: string
  /** 'ene 26' */
  short_label: string
  /** ¿Tiene al menos una meta cargada (ventas, botellas o presupuesto)? */
  has_goal: boolean
  /** past = ya terminó · current = es el mes en curso · future = todavía no empezó */
  status: 'past' | 'current' | 'future'
  actual: { sales: number; bottles: number; expenses: number; net_result: number; gross_margin: number }
  /** ventas reales ÷ meta de ventas (null si no hay meta de ventas). */
  progress: number | null
  bottles_progress: number | null
  /** gastos reales ÷ presupuesto (más de 1 = te pasaste). */
  expense_progress: number | null
  /** Cuánto del mes ya pasó (1 si terminó, 0 si no empezó). */
  expected_progress: number
}

export interface GoalSuggestion {
  month: string
  label: string
  /** Gastos fijos promedio de los últimos 3 meses. */
  fixed_expenses_avg: number | null
  /** Margen de contribución (0..1): lo que queda de cada venta después de los costos variables. */
  contribution_margin: number | null
  /** Ventas para no ganar ni perder (gastos fijos ÷ margen de contribución). */
  break_even_sales: number | null
  last_year_same_month: number | null
  /** Inflación acumulada usada para actualizar lo del año pasado (0.27 = 27 %). */
  inflation_factor: number
  /** Meses sin inflación cargada (se supuso 2 % mensual). */
  inflation_assumed_months: number
  last_year_plus_inflation: number | null
  avg_last_3_months: number | null
  /** La meta sugerida de ventas (redondeada). null si no hay datos para sugerir. */
  suggestion: number | null
  /** De dónde salió la sugerencia. */
  basis: 'break_even' | 'last_year' | 'average' | null
  suggested_bottles: number | null
  suggested_expense_budget: number | null
  /** Explicación completa en castellano. */
  explanation: string
  /** La misma explicación, en pasos (para mostrar como lista). */
  steps: string[]
}

// ───────────────────────── Ayudas ─────────────────────────

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const ASSUMED_MONTHLY_INFLATION = 2

const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })
const nf3 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 })
const $ = (n: number) => `$\u00a0${nf0.format(Math.round(n))}`
const pctTxt = (ratio: number) => `${nf1.format(ratio * 100)} %`

const GOAL_FIELD_LABELS: Record<string, string> = {
  sales_target: 'Meta de ventas',
  bottles_target: 'Meta de botellas',
  expense_budget: 'Presupuesto de gastos',
  notes: 'Notas',
}

/** validate() con los nombres de los campos de metas en castellano. */
function validateGoal(body: unknown) {
  try {
    return validate(goalInput, body)
  } catch (err) {
    if (err instanceof HttpError) err.message = err.message.replace(/\b(sales_target|bottles_target|expense_budget|notes)\b/g, (k) => GOAL_FIELD_LABELS[k] ?? k)
    throw err
  }
}

function checkMonth(m: string | undefined): string {
  if (!m || !MONTH_RE.test(m)) throw badRequest('Revisá estos datos → Mes: tiene que ser un mes válido (AAAA-MM)')
  return m
}

function readYear(raw: string | undefined): number {
  if (raw == null) return Number(today().slice(0, 4))
  const y = Number(raw)
  if (!/^\d{4}$/.test(raw) || y < 2000 || y > 2100) throw badRequest('Revisá estos datos → Año: tiene que ser un año válido (por ejemplo 2026).')
  return y
}

const hasGoal = (g: Pick<Goal, 'sales_target' | 'bottles_target' | 'expense_budget'> | undefined) =>
  !!g && (g.sales_target != null || g.bottles_target != null || g.expense_budget != null)

function getGoal(month: string): Goal | undefined {
  return get<Goal>('SELECT month, sales_target, bottles_target, expense_budget, notes FROM goals WHERE month = ?', [month])
}

/** Las 12 filas del año: meta + lo real de cada mes. */
export function goalsForYear(year: number, ref: string = today()): GoalMonth[] {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const goals = new Map(all<Goal>('SELECT month, sales_target, bottles_target, expense_budget, notes FROM goals WHERE month BETWEEN ? AND ?', [`${year}-01`, `${year}-12`]).map((g) => [g.month, g]))
  const series = monthlySeries(from, to)
  const curMonth = monthKey(ref)
  return series.map((m: MonthlyPoint) => {
    const g = goals.get(m.month)
    const status: GoalMonth['status'] = m.month < curMonth ? 'past' : m.month > curMonth ? 'future' : 'current'
    const daysTotal = Number(m.to.slice(8, 10))
    const expected = status === 'past' ? 1 : status === 'future' ? 0 : Number(ref.slice(8, 10)) / daysTotal
    return {
      month: m.month,
      label: monthLabelLong(m.month),
      short_label: monthLabel(m.month),
      sales_target: g?.sales_target ?? null,
      bottles_target: g?.bottles_target ?? null,
      expense_budget: g?.expense_budget ?? null,
      notes: g?.notes ?? null,
      has_goal: hasGoal(g),
      status,
      actual: { sales: m.sales, bottles: m.bottles_sold, expenses: m.expenses, net_result: m.net_result, gross_margin: m.gross_margin },
      progress: g?.sales_target ? m.sales / g.sales_target : null,
      bottles_progress: g?.bottles_target ? m.bottles_sold / g.bottles_target : null,
      expense_progress: g?.expense_budget ? m.expenses / g.expense_budget : null,
      expected_progress: expected,
    }
  })
}

// ───────────────────────── Sugerencia de meta ─────────────────────────

/**
 * Sugiere una meta de ventas para un mes, explicando de dónde sale:
 * 1) Punto de equilibrio: gastos fijos promedio (últimos 3 meses) ÷ margen de contribución.
 *    Es el piso: vendiendo eso no ganás ni perdés. Le sumamos 15 % para que quede ganancia.
 * 2) Mismo mes del año pasado + inflación de los 12 meses (si falta algún mes, se supone 2 % mensual).
 *    Para no achicarte en términos reales.
 * La sugerencia es el mayor de los dos (redondeado hacia arriba a $ 10.000).
 */
export function suggestGoal(month: string, ref: string = today()): GoalSuggestion {
  const mStart = `${month}-01`
  const steps: string[] = []

  // Últimos 3 meses COMPLETOS antes del mes elegido (si el mes es el actual o uno futuro,
  // los 3 anteriores al mes en curso: un mes a medio terminar engañaría los promedios).
  const curStart = startOfMonth(ref)
  const windowEnd = addMonths(mStart < curStart ? mStart : curStart, -1)
  const last3 = monthlySeries(addMonths(windowEnd, -2), endOfMonth(windowEnd))
  const active = last3.filter((m) => m.sales > 0 || m.expenses > 0)
  const withSales = last3.filter((m) => m.sales > 0)
  const totSales = active.reduce((s, m) => s + m.sales, 0)
  const totVariable = active.reduce((s, m) => s + m.cogs + m.fees + m.shrinkage + m.expenses_variable, 0)
  const totBottles = active.reduce((s, m) => s + m.bottles_sold, 0)
  const fixedAvg = active.length ? round2(active.reduce((s, m) => s + m.expenses_fixed, 0) / active.length) : null
  // Redondeado a 3 decimales: es el número que mostramos en la cuenta ("÷ 0,28"), así se puede verificar con la calculadora.
  const contribution = totSales > 0 ? Math.round(((totSales - totVariable) / totSales) * 1000) / 1000 : null
  const breakEven = fixedAvg != null && fixedAvg > 0 && contribution != null && contribution > 0 ? round2(fixedAvg / contribution) : null
  const monthsTxt = active.map((m) => monthLabelLong(m.month).split(' ')[0]).join(', ')

  if (breakEven != null) {
    steps.push(
      `Punto de equilibrio: en los últimos meses completos (${monthsTxt}) tus gastos fijos promediaron ${$(fixedAvg!)} por mes, y de cada $\u00a0100 que vendiste te quedaron $\u00a0${nf0.format(
        Math.round(contribution! * 100),
      )} después de pagar el vino, las comisiones, las mermas y los gastos variables (margen de contribución ${pctTxt(contribution!)}). Para cubrir los fijos necesitás vender ${$(
        fixedAvg!,
      )} ÷ ${nf3.format(contribution!)} = ${$(breakEven)}. Ese es tu piso: vendiendo eso no ganás ni perdés. Con un 15 % de colchón para que quede ganancia: ${$(breakEven * 1.15)}.`,
    )
  } else if (!active.length) {
    steps.push('Punto de equilibrio: todavía no hay ventas ni gastos cargados en los 3 meses anteriores, así que no lo podemos calcular.')
  } else if (fixedAvg == null || fixedAvg <= 0) {
    steps.push('Punto de equilibrio: no hay gastos fijos cargados en los últimos 3 meses (alquiler, sueldos…). Cargalos en «Gastos» para que el cálculo sea real.')
  } else if (contribution == null) {
    steps.push('Punto de equilibrio: no hubo ventas en los últimos 3 meses, así que no sabemos cuánto te deja cada venta.')
  } else {
    steps.push(
      `Punto de equilibrio: con los números de los últimos meses, lo que te deja cada venta (${pctTxt(contribution)}) no alcanza a cubrir los costos variables. Así no hay nivel de ventas que cubra los gastos fijos: revisá precios antes de ponerte una meta.`,
    )
  }

  // Mismo mes del año pasado + inflación
  const lyMonth = monthKey(addMonths(mStart, -12))
  const lastYear = monthlySeries(`${lyMonth}-01`, endOfMonth(`${lyMonth}-01`))[0]
  const lastYearSales = lastYear && lastYear.sales > 0 ? lastYear.sales : null
  const infMonths = monthsBetween(addMonths(mStart, -11), mStart)
  const rates = new Map(all<{ month: string; rate: number }>('SELECT month, rate FROM inflation WHERE month BETWEEN ? AND ?', [infMonths[0], infMonths[infMonths.length - 1]]).map((r) => [r.month, r.rate]))
  let factor = 1
  let assumed = 0
  for (const m of infMonths) {
    const r = rates.get(m)
    if (r == null) assumed++
    factor *= 1 + (r ?? ASSUMED_MONTHLY_INFLATION) / 100
  }
  const lastYearPlus = lastYearSales != null ? round2(lastYearSales * factor) : null
  const assumedTxt = assumed
    ? assumed === infMonths.length
      ? ` No tenés cargada la inflación de esos meses (se carga en Reportes → Inflación), así que supusimos 2 % mensual.`
      : ` Para ${assumed === 1 ? '1 mes' : `${assumed} meses`} no tenías cargada la inflación: supusimos 2 % mensual.`
    : ''
  if (lastYearPlus != null) {
    steps.push(
      `Año pasado + inflación: en ${monthLabelLong(lyMonth)} vendiste ${$(lastYearSales!)}. Con la inflación de los 12 meses siguientes (${pctTxt(factor - 1)} acumulada) eso equivale a ${$(
        lastYearPlus,
      )} en pesos de ${monthLabelLong(month)}. Vender menos que eso sería achicarte en términos reales, aunque en pesos parezca más.${assumedTxt}`,
    )
  } else {
    steps.push(`Año pasado + inflación: no hay ventas cargadas en ${monthLabelLong(lyMonth)} para comparar.`)
  }

  // Promedio de los últimos 3 meses
  const avg3 = withSales.length ? round2(withSales.reduce((s, m) => s + m.sales, 0) / withSales.length) : null
  if (avg3 != null) steps.push(`Como referencia: en los últimos ${withSales.length === 1 ? 'mes' : `${withSales.length} meses`} vendiste en promedio ${$(avg3)} por mes.`)

  // La sugerencia
  const candidates: { v: number; basis: GoalSuggestion['basis'] }[] = []
  if (breakEven != null) candidates.push({ v: breakEven * 1.15, basis: 'break_even' })
  if (lastYearPlus != null) candidates.push({ v: lastYearPlus, basis: 'last_year' })
  let suggestion: number | null = null
  let basis: GoalSuggestion['basis'] = null
  if (candidates.length) {
    const best = candidates.reduce((a, b) => (b.v > a.v ? b : a))
    suggestion = roundUpTo(best.v, 10000)
    basis = best.basis
    steps.push(
      candidates.length > 1
        ? `Te sugerimos el mayor de los dos (${basis === 'break_even' ? 'punto de equilibrio + 15 %' : 'año pasado + inflación'}), redondeado: ${$(suggestion)}. Si llegás, cubrís los gastos fijos con resto y no vendés menos que el año pasado en términos reales.`
        : `Te sugerimos ${$(suggestion)} (${basis === 'break_even' ? 'punto de equilibrio + 15 %' : 'año pasado + inflación'}, redondeado).`,
    )
  } else if (avg3 != null) {
    suggestion = roundUpTo(avg3 * (1 + ASSUMED_MONTHLY_INFLATION / 100), 10000)
    basis = 'average'
    steps.push(`Como no hay datos para lo anterior, te sugerimos tu promedio de los últimos meses más un 2 % de inflación: ${$(suggestion)}.`)
  } else {
    steps.push('Todavía no hay suficientes datos para sugerir una meta. Poné una que te parezca alcanzable y en unos meses el sistema te va a poder ayudar más.')
  }

  // Botellas y presupuesto de gastos
  const avgPrice = totBottles > 0 ? totSales / totBottles : 0
  const suggestedBottles = suggestion != null && avgPrice > 0 ? Math.max(1, Math.round(suggestion / avgPrice / 5) * 5) : null
  if (suggestedBottles != null) steps.push(`En botellas: con un precio promedio de ${$(avgPrice)} por botella, son unas ${nf0.format(suggestedBottles)} botellas.`)
  const expAvg = active.length ? active.reduce((s, m) => s + m.expenses, 0) / active.length : null
  const lastRate = all<{ rate: number }>('SELECT rate FROM inflation WHERE month <= ? ORDER BY month DESC LIMIT 1', [month])[0]?.rate ?? ASSUMED_MONTHLY_INFLATION
  const suggestedBudget = expAvg && expAvg > 0 ? roundUpTo(expAvg * (1 + lastRate / 100), 10000) : null
  if (suggestedBudget != null)
    steps.push(`Presupuesto de gastos: tus gastos promediaron ${$(expAvg!)} por mes; con ${nf1.format(lastRate)} % de inflación, un presupuesto razonable es ${$(suggestedBudget)}.`)

  return {
    month,
    label: monthLabelLong(month),
    fixed_expenses_avg: fixedAvg,
    contribution_margin: contribution,
    break_even_sales: breakEven,
    last_year_same_month: lastYearSales,
    inflation_factor: round2((factor - 1) * 10000) / 10000,
    inflation_assumed_months: assumed,
    last_year_plus_inflation: lastYearPlus,
    avg_last_3_months: avg3,
    suggestion,
    basis,
    suggested_bottles: suggestedBottles,
    suggested_expense_budget: suggestedBudget,
    explanation: steps.join('\n'),
    steps,
  }
}

// ───────────────────────── Rutas ─────────────────────────

router.get('/goals', (req, res) => {
  res.json(goalsForYear(readYear(qs(req, 'year'))))
})

router.get('/goals/suggest', (req, res) => {
  res.json(suggestGoal(checkMonth(qs(req, 'month') ?? monthKey(today()))))
})

router.get('/goals/export', async (req, res) => {
  const year = readYear(qs(req, 'year'))
  const STATUS = { past: 'Terminado', current: 'En curso', future: 'Todavía no empezó' } as const
  // Los meses que todavía no empezaron van sin "real" (vacío, no 0 %): no hay nada que medir.
  const rows = goalsForYear(year).map((r) => {
    const future = r.status === 'future'
    return {
      label: r.label.charAt(0).toUpperCase() + r.label.slice(1),
      status: STATUS[r.status],
      sales_target: r.sales_target,
      sales: future ? null : r.actual.sales,
      progress: future ? null : r.progress,
      bottles_target: r.bottles_target,
      bottles: future ? null : r.actual.bottles,
      expense_budget: r.expense_budget,
      expenses: future ? null : r.actual.expenses,
      expense_progress: future ? null : r.expense_progress,
      net_result: future ? null : r.actual.net_result,
      notes: r.notes,
    }
  })
  await sendWorkbook(res, excelFilename(`metas-${year}`), [
    {
      name: `Metas ${year}`,
      title: `Metas ${year}: meta vs. real`,
      subtitle: periodSubtitle(`${year}-01-01`, `${year}-12-31`),
      columns: [
        { header: 'Mes', key: 'label', width: 16 },
        { header: 'Estado', key: 'status', width: 18 },
        { header: 'Meta de ventas', key: 'sales_target', type: 'money' },
        { header: 'Ventas reales', key: 'sales', type: 'money' },
        { header: 'Avance de la meta', key: 'progress', type: 'percent', total: false },
        { header: 'Meta de botellas', key: 'bottles_target', type: 'int' },
        { header: 'Botellas vendidas', key: 'bottles', type: 'int' },
        { header: 'Presupuesto de gastos', key: 'expense_budget', type: 'money' },
        { header: 'Gastos reales', key: 'expenses', type: 'money' },
        { header: 'Uso del presupuesto', key: 'expense_progress', type: 'percent', total: false },
        { header: 'Resultado', key: 'net_result', type: 'money' },
        { header: 'Notas', key: 'notes', width: 30 },
      ],
      rows,
      notes: [
        'Avance de la meta = ventas reales ÷ meta de ventas. 100 % o más = meta cumplida.',
        'Uso del presupuesto = gastos reales ÷ presupuesto. Más de 100 % = te pasaste del presupuesto.',
        'Las ventas y los gastos cuentan en su fecha (aunque se cobren o paguen después), igual que en Inicio y Reportes.',
        'El mes "En curso" todavía no terminó: compará su avance con cuánto del mes ya pasó. Los meses que no empezaron quedan vacíos.',
        'La fila TOTAL suma las metas de todo el año (incluidas las de los meses que faltan) y lo real hasta hoy.',
      ],
    },
  ])
})

/** Crear o cambiar la meta de un mes. El mes de la URL manda (si el cuerpo trae otro, se ignora). */
router.put('/goals/:month', (req, res) => {
  const month = checkMonth(req.params.month)
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const data = validateGoal({ ...body, month })
  if (!hasGoal(data)) {
    throw badRequest('Poné al menos una meta: de ventas, de botellas o un presupuesto de gastos. (Para sacar la meta de un mes, borrala.)')
  }
  run(
    `INSERT INTO goals (month, sales_target, bottles_target, expense_budget, notes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(month) DO UPDATE SET sales_target = excluded.sales_target, bottles_target = excluded.bottles_target,
       expense_budget = excluded.expense_budget, notes = excluded.notes`,
    [month, data.sales_target, data.bottles_target, data.expense_budget, data.notes],
  )
  const saved = getGoal(month)
  if (!saved) throw new HttpError(500, 'No se pudo guardar la meta. Probá de nuevo.')
  res.json(saved)
})

router.delete('/goals/:month', (req, res) => {
  const month = checkMonth(req.params.month)
  if (!getGoal(month)) throw notFound(`la meta de ${monthLabelLong(month)}`)
  run('DELETE FROM goals WHERE month = ?', [month])
  res.json({ ok: true })
})

export default router
