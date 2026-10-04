// Inicio ("¿Cómo venimos?"): el resumen del negocio de un vistazo.
// (Ver docs/ARQUITECTURA.md → módulo "Inicio + Metas")
//
// Todos los números salen de services/finance.ts (los mismos que usan Reportes y Metas),
// así un mismo número da igual en todas las pantallas. Acá solo se juntan, se comparan
// con el período anterior y se traducen a alertas y frases en castellano.
import { Router } from 'express'
import { pctChange, round2, roundUpTo, safeDiv } from '../../shared/calc'
import { SALE_CHANNEL_LABELS, type SaleChannel } from '../../shared/constants'
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  MONTHS_LONG,
  monthKey,
  monthLabelLong,
  presetToPeriod,
  previousPeriod,
  startOfMonth,
  today,
  type Period,
} from '../../shared/dates'
import type { AccountWithBalance, Goal, MonthlyPoint, PeriodSummary } from '../../shared/types'
import { all, get, scalar } from '../db'
import { parsePeriod } from '../lib/http'
import { excelFilename, fmtDate, periodSubtitle, sendWorkbook } from '../lib/excel'
import {
  lowStock,
  monthlySeries,
  payables,
  periodSummary,
  receivables,
  salesByChannel,
  salesByProduct,
  stockValue,
  type ChannelSales,
  type ProductSales,
} from '../services/finance'
import { accountBalances } from '../services/payments'
import { getSettings } from '../services/settings'

const router = Router()

// ───────────────────────── Tipos de respuesta ─────────────────────────

export type AlertTone = 'good' | 'warn' | 'bad' | 'info'

export interface DashboardAlert {
  tone: AlertTone
  title: string
  text: string
  /** Ruta de la pantalla donde se resuelve (ej: "/caja?tab=pendientes"). */
  link?: string
  /** Texto del link ("Ver qué hay que pagar"). */
  link_label?: string
}

export interface DashboardGoal {
  month: string
  label: string
  sales_target: number | null
  bottles_target: number | null
  expense_budget: number | null
  notes: string | null
  /** Lo real del mes (ventas, botellas, gastos, resultado). */
  sales: number
  bottles: number
  expenses: number
  net_result: number
  /** ventas ÷ meta de ventas (0..∞). null si no hay meta de ventas. */
  progress: number | null
  bottles_progress: number | null
  expense_progress: number | null
  /** Cuánto del mes ya pasó (días transcurridos ÷ días del mes). */
  expected_progress: number
  days_elapsed: number
  days_total: number
  /** Ventas ÷ (meta × avance esperado) − 1. +0,08 = vas 8 % adelante del ritmo. null si no se puede calcular. */
  pace: number | null
  /** Lo que deberías llevar vendido hoy para ir al ritmo de la meta. */
  expected_sales: number | null
  /** Si seguís al mismo ritmo, cómo cerrarías el mes. */
  projection: number
}

export interface DashboardComparison {
  /** same_days: el período todavía no terminó y comparamos los mismos días; previous: período anterior completo. */
  mode: 'same_days' | 'previous'
  /** Texto corto para debajo de cada número ("vs. mismos días del mes pasado"). */
  label: string
  /** Explicación completa ("Comparamos del 1 al 4 de octubre con del 1 al 4 de septiembre…"). */
  detail: string
  current: PeriodSummary
  previous: PeriodSummary
  /**
   * true si tus registros empiezan después del arranque del período anterior: comparar contra un
   * período a medio cargar engaña ("vendiste 900 % más"), así que la pantalla no muestra variaciones.
   */
  partial: boolean
  /** Fecha del primer registro (venta o gasto) cargado. null si no hay nada. */
  data_since: string | null
  /**
   * Lo que ya está cargado con fecha posterior a hoy (ej: gastos fijos generados para todo el mes).
   * Suma en el resumen del período pero no en la comparación (que va solo hasta hoy). null si no hay.
   */
  after_today: { sales: number; expenses: number; net_result: number } | null
}

export interface DashboardResponse {
  period: Period
  today: string
  /** Período en palabras ("octubre 2026", "1 de enero al 31 de marzo de 2026"). */
  period_label: string
  /** El período listo para usar en una frase: "en octubre 2026", "en el año 2026", "del 1 de agosto al 31 de octubre", "desde el 1 de septiembre de 2025". */
  period_phrase: string
  summary: PeriodSummary
  previous: PeriodSummary
  same_days_previous: PeriodSummary | null
  comparison: DashboardComparison
  series: MonthlyPoint[]
  /**
   * scheduled: neto de movimientos de caja con fecha posterior a hoy que ya están cargados (ej: gastos fijos
   * generados como "pagados" para todo el mes). El saldo de hoy todavía NO los cuenta (accountBalances() suma hasta
   * hoy); lo informamos para explicar por qué la plata va a bajar esos días.
   */
  cash: { total: number; accounts: AccountWithBalance[]; scheduled: { out: number; in: number } }
  stock: { value: number; bottles: number; products: number }
  receivables: { total: number; count: number; overdue: number }
  payables: { total: number; count: number; overdue: number; purchases: number; expenses: number }
  low_stock: { id: number; name: string; stock: number; min_stock: number; winery: string | null }[]
  top_products: ProductSales[]
  by_channel: (ChannelSales & { label: string })[]
  /** Mes de la meta que se muestra ('YYYY-MM'): el del final del período, el actual si el período sigue, o el primero si es futuro. */
  goal_month: string
  goal: DashboardGoal | null
  alerts: DashboardAlert[]
  insights: string[]
  /** Cuántas cosas cargadas hay (para la bienvenida cuando la base está vacía). */
  setup: { products: number; sales: number; purchases: number; expenses: number; recurring: number; goals: number }
}

// ───────────────────────── Formatos para las frases ─────────────────────────

const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })
const $ = (n: number) => `$\u00a0${nf0.format(Math.round(n))}`
const pctTxt = (ratio: number, decimals = 0) => `${(decimals ? nf1 : nf0).format(Math.abs(ratio) * 100)} %`
const DAYS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']

const dayNum = (s: string) => Number(s.slice(8, 10))
const monthName = (s: string) => MONTHS_LONG[Number(s.slice(5, 7)) - 1]
const yearOf = (s: string) => s.slice(0, 4)
const minDate = (a: string, b: string) => (a < b ? a : b)
const isFullMonth = (p: Period) => p.from === startOfMonth(p.from) && p.to === endOfMonth(p.from)
const isFullYear = (p: Period) => p.from.slice(5) === '01-01' && p.to.slice(5) === '12-31' && yearOf(p.from) === yearOf(p.to)

/** "1 al 4 de octubre", "28 de septiembre al 4 de octubre", con año si no es el actual. */
export function rangeInWords(from: string, to: string): string {
  const thisYear = yearOf(today())
  const sameYear = yearOf(from) === yearOf(to)
  const yTo = yearOf(to) !== thisYear || !sameYear ? ` de ${yearOf(to)}` : ''
  const yFrom = !sameYear ? ` de ${yearOf(from)}` : ''
  if (from === to) return `${dayNum(from)} de ${monthName(from)}${yTo}`
  if (monthKey(from) === monthKey(to)) return `${dayNum(from)} al ${dayNum(to)} de ${monthName(to)}${yTo}`
  return `${dayNum(from)} de ${monthName(from)}${yFrom} al ${dayNum(to)} de ${monthName(to)}${yTo}`
}

/** El período en palabras: "octubre 2026", "año 2026" o el rango de fechas. */
export function periodInWords(p: Period): string {
  if (isFullMonth(p)) return monthLabelLong(monthKey(p.from))
  if (isFullYear(p)) return `año ${yearOf(p.from)}`
  return rangeInWords(p.from, p.to)
}

/** "Desde siempre" (PeriodPicker) arranca en esta fecha. */
const ALL_TIME_FROM = presetToPeriod('todo').from

/** El período para meter en una frase: "en octubre 2026", "en el año 2026", "del 1 al 15 de marzo", "desde el 1 de septiembre de 2025". */
export function periodPhrase(p: Period, dataSince: string | null): string {
  if (p.from <= ALL_TIME_FROM) return dataSince ? `desde el ${rangeInWords(dataSince, dataSince)}` : 'desde siempre'
  if (isFullMonth(p)) return `en ${monthLabelLong(monthKey(p.from))}`
  if (isFullYear(p)) return `en el año ${yearOf(p.from)}`
  if (p.from === p.to) return `el ${rangeInWords(p.from, p.to)}`
  return `del ${rangeInWords(p.from, p.to)}`
}

/** Pagos y cobros ya cargados con fecha posterior a hoy (el saldo de hoy todavía no los cuenta). */
function scheduledCash(ref: string): { out: number; in: number } {
  const r = get<{ cout: number; cin: number }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS cout,
            COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS cin
     FROM payments WHERE ref_type <> 'transfer' AND date > ?`,
    [ref],
  )
  return { out: round2(r?.cout ?? 0), in: round2(r?.cin ?? 0) }
}

/** Primer día con algo cargado (venta o gasto). */
function firstRecordDate(): string | null {
  return scalar<string | null>(`SELECT MIN(d) FROM (SELECT MIN(date) AS d FROM sales UNION ALL SELECT MIN(date) AS d FROM expenses)`) ?? null
}

/**
 * ¿El período anterior está "a medio cargar"? Si los registros empiezan bastante después de su
 * primer día (más de 1 día y más del 10 % del período), compararlo engaña.
 */
export function isPartialComparison(previous: Period, dataSince: string | null): boolean {
  if (!dataSince || dataSince <= previous.from) return false
  const missing = daysBetween(previous.from, dataSince)
  const len = daysBetween(previous.from, previous.to) + 1
  return missing >= 2 && missing / len > 0.1
}

// ───────────────────────── Comparación justa ─────────────────────────

/**
 * Con qué se compara el período.
 * - Si el período todavía no terminó (incluye hoy), comparamos "lo que va" contra los mismos días
 *   del período anterior: del 1 al 4 de octubre contra del 1 al 4 de septiembre. Comparar 4 días
 *   contra un mes entero haría parecer que todo se vino abajo.
 * - Si ya terminó, se compara contra el período anterior completo.
 */
export function comparisonPeriods(p: Period, ref: string = today()) {
  const prev = previousPeriod(p)
  if (p.from <= ref && ref < p.to) {
    const elapsed = daysBetween(p.from, ref)
    const prevTo = minDate(addDays(prev.from, elapsed), prev.to)
    return { mode: 'same_days' as const, current: { from: p.from, to: ref }, previous: { from: prev.from, to: prevTo }, prev }
  }
  return { mode: 'previous' as const, current: p, previous: prev, prev }
}

function comparisonTexts(
  p: Period,
  c: ReturnType<typeof comparisonPeriods>,
  extra: { dataSince: string | null; partial: boolean; afterToday: DashboardComparison['after_today'] } = { dataSince: null, partial: false, afterToday: null },
): { label: string; detail: string } {
  const base = baseComparisonTexts(p, c)
  if (extra.partial && extra.dataSince) {
    const since = rangeInWords(extra.dataSince, extra.dataSince)
    return {
      label: base.label,
      detail:
        extra.dataSince > c.previous.to
          ? `No hay nada cargado antes del ${since}, así que no hay un período anterior con el que comparar. Cuando tengas más historia, acá vas a ver si vendés más o menos que antes.`
          : `Tus registros empiezan el ${since}, así que el período anterior (del ${rangeInWords(c.previous.from, c.previous.to)}) está cargado a medias. Para no engañarte, no mostramos variaciones: compararías un período completo contra uno cargado a medias.`,
    }
  }
  if (extra.afterToday && (extra.afterToday.expenses > 0.5 || extra.afterToday.sales > 0.5)) {
    const parts = [
      extra.afterToday.expenses > 0.5 ? `${$(extra.afterToday.expenses)} de gastos` : '',
      extra.afterToday.sales > 0.5 ? `${$(extra.afterToday.sales)} de ventas` : '',
    ].filter(Boolean)
    return {
      label: base.label,
      detail: `${base.detail} Ojo: ya hay ${parts.join(' y ')} cargados con fecha posterior a hoy (por ejemplo, gastos fijos generados para todo el mes). Cuentan en los números del período, pero no en la comparación, que va solo hasta hoy.`,
    }
  }
  return base
}

function baseComparisonTexts(p: Period, c: ReturnType<typeof comparisonPeriods>): { label: string; detail: string } {
  if (c.mode === 'same_days') {
    const label = isFullMonth(p) ? 'vs. mismos días del mes pasado' : isFullYear(p) ? 'vs. mismos días del año pasado' : 'vs. mismos días del período anterior'
    return {
      label,
      detail: `Como el período todavía no terminó, comparamos del ${rangeInWords(c.current.from, c.current.to)} con del ${rangeInWords(c.previous.from, c.previous.to)}. Así la comparación es justa: mismos días contra mismos días.`,
    }
  }
  const label = isFullMonth(p) ? 'vs. mes anterior' : isFullYear(p) ? 'vs. año anterior' : 'vs. período anterior'
  return { label, detail: `Comparamos ${periodInWords(p)} con ${periodInWords(c.previous)} (el período anterior, de la misma duración).` }
}

// ───────────────────────── Deudas abiertas (para las alertas) ─────────────────────────

interface OpenDoc {
  kind: 'sale' | 'purchase' | 'expense'
  id: number
  date: string
  due_date: string | null
  who: string | null
  balance: number
}

/** Ventas con saldo por cobrar (misma cuenta que receivables(): total − cobros). */
function openReceivables(): OpenDoc[] {
  return all<OpenDoc>(
    `SELECT 'sale' AS kind, s.id, s.date, s.due_date, c.name AS who,
       s.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.ref_type = 'sale' AND p.ref_id = s.id), 0) AS balance
     FROM sales s LEFT JOIN clients c ON c.id = s.client_id`,
  )
    .filter((r) => r.balance > 0.01)
    .map((r) => ({ ...r, balance: round2(r.balance) }))
}

/** Compras y gastos con saldo por pagar (misma cuenta que payables()). */
function openPayables(): OpenDoc[] {
  return all<OpenDoc>(
    `SELECT 'purchase' AS kind, pu.id, pu.date, pu.due_date, COALESCE(sp.name, 'Compra de vino') AS who,
       pu.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.ref_type = 'purchase' AND p.ref_id = pu.id), 0) AS balance
     FROM purchases pu LEFT JOIN suppliers sp ON sp.id = pu.supplier_id
     UNION ALL
     SELECT 'expense' AS kind, ex.id, ex.date, ex.due_date, ex.description AS who,
       ex.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.ref_type = 'expense' AND p.ref_id = ex.id), 0) AS balance
     FROM expenses ex`,
  )
    .filter((r) => r.balance > 0.01)
    .map((r) => ({ ...r, balance: round2(r.balance) }))
}

const sum = (xs: OpenDoc[]) => round2(xs.reduce((s, x) => s + x.balance, 0))
const plural = (n: number, one: string, many: string) => `${nf0.format(n)} ${n === 1 ? one : many}`
/** "vs. mismos días del mes pasado" → "comparado con los mismos días del mes pasado"; "vs. mes anterior" → "comparado con el mes anterior". */
const comparedWith = (label: string) => {
  const rest = label.replace(/^vs\. /, '')
  return `comparado con ${rest.startsWith('mismos') ? 'los' : 'el'} ${rest}`
}

// ───────────────────────── Meta del mes ─────────────────────────

export function goalForMonth(month: string, ref: string = today()): DashboardGoal | null {
  const g = get<Goal>('SELECT * FROM goals WHERE month = ?', [month])
  if (!g || (g.sales_target == null && g.bottles_target == null && g.expense_budget == null)) return null
  const mFrom = `${month}-01`
  const mTo = endOfMonth(mFrom)
  const s = periodSummary(mFrom, mTo)
  const daysTotal = dayNum(mTo)
  const daysElapsed = ref > mTo ? daysTotal : ref < mFrom ? 0 : dayNum(ref)
  const expected = daysElapsed / daysTotal
  const target = g.sales_target && g.sales_target > 0 ? g.sales_target : null
  const expectedSales = target != null ? round2(target * expected) : null
  return {
    month,
    label: monthLabelLong(month),
    sales_target: g.sales_target,
    bottles_target: g.bottles_target,
    expense_budget: g.expense_budget,
    notes: g.notes,
    sales: s.sales,
    bottles: s.bottles_sold,
    expenses: s.expenses,
    net_result: s.net_result,
    progress: target != null ? s.sales / target : null,
    bottles_progress: g.bottles_target ? s.bottles_sold / g.bottles_target : null,
    expense_progress: g.expense_budget ? s.expenses / g.expense_budget : null,
    expected_progress: expected,
    days_elapsed: daysElapsed,
    days_total: daysTotal,
    pace: expectedSales ? s.sales / expectedSales - 1 : null,
    expected_sales: expectedSales,
    projection: daysElapsed > 0 && daysElapsed < daysTotal ? round2((s.sales / daysElapsed) * daysTotal) : s.sales,
  }
}

// ───────────────────────── Alertas ─────────────────────────

interface AlertContext {
  ref: string
  period: Period
  summary: PeriodSummary
  comparison: DashboardComparison
  cashTotal: number
  low: ReturnType<typeof lowStock>
  goal: DashboardGoal | null
  earlyMonth: boolean
}

function buildAlerts(ctx: AlertContext): DashboardAlert[] {
  const { ref, summary } = ctx
  const out: DashboardAlert[] = []
  const recv = openReceivables()
  const pay = openPayables()

  // 1) Te deben plata vencida
  const overdueRecv = recv.filter((r) => r.due_date && r.due_date < ref).sort((a, b) => b.balance - a.balance)
  if (overdueRecv.length) {
    const top = overdueRecv[0]
    out.push({
      tone: 'bad',
      title: `Te deben ${$(sum(overdueRecv))} que ya vencieron`,
      text: `${plural(overdueRecv.length, 'venta vencida sin cobrar', 'ventas vencidas sin cobrar')}. La más grande: ${top.who ?? 'Consumidor final (venta sin cliente)'}, ${$(top.balance)} (vencía el ${fmtDate(top.due_date!)}). Cuanto más pasa, más cuesta cobrarla: mandale un mensaje hoy.`,
      link: '/caja?tab=pendientes',
      link_label: 'Ver lo que te deben',
    })
  }

  // 2) Pagos vencidos y pagos que vencen en los próximos 7 días
  const overduePay = pay.filter((p) => p.due_date && p.due_date < ref)
  if (overduePay.length) {
    out.push({
      tone: 'bad',
      title: `Tenés ${$(sum(overduePay))} en pagos vencidos`,
      text: `${plural(overduePay.length, 'cuenta vencida', 'cuentas vencidas')} con proveedores o gastos (${overduePay
        .slice(0, 2)
        .map((p) => p.who)
        .join(', ')}${overduePay.length > 2 ? '…' : ''}). Pagar tarde puede traer recargos o cortar la relación con una bodega.`,
      link: '/caja?tab=pendientes',
      link_label: 'Ver qué hay que pagar',
    })
  }
  const in7 = addDays(ref, 7)
  const soon = pay.filter((p) => p.due_date && p.due_date >= ref && p.due_date <= in7).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
  if (soon.length) {
    const first = soon[0]
    out.push({
      tone: 'warn',
      title: `Esta semana vencen ${$(sum(soon))} en pagos`,
      text: `${plural(soon.length, 'pago vence', 'pagos vencen')} en los próximos 7 días. El primero: ${first.who} por ${$(first.balance)} el ${fmtDate(first.due_date!)}. Fijate que haya plata en la cuenta.`,
      link: '/caja?tab=pendientes',
      link_label: 'Ver vencimientos',
    })
  }

  // 3) ¿La caja alcanza para lo que hay que pagar en 30 días?
  const in30 = addDays(ref, 30)
  const due30 = pay.filter((p) => !p.due_date || p.due_date <= in30)
  const toPay30 = sum(due30)
  if (toPay30 > 0 && toPay30 > ctx.cashTotal) {
    const toCollect30 = sum(recv.filter((r) => !r.due_date || r.due_date <= in30))
    const gap = round2(toPay30 - ctx.cashTotal)
    const covers = ctx.cashTotal + toCollect30 >= toPay30
    out.push({
      tone: 'bad',
      title: 'Ojo: la caja no alcanza para lo que viene',
      text: `En los próximos 30 días tenés que pagar ${$(toPay30)} y hoy tenés ${$(ctx.cashTotal)} en tus cuentas: te faltan ${$(gap)}. ${
        toCollect30 > 0
          ? covers
            ? `Si cobrás lo que te deben (${$(toCollect30)}), te alcanza: priorizá esos cobros.`
            : `Aunque cobres lo que te deben (${$(toCollect30)}), no alcanza: pensá en negociar plazos o en vender stock.`
          : 'Priorizá las ventas de contado o negociá plazos con los proveedores.'
      }`,
      link: '/caja',
      link_label: 'Ver caja y bancos',
    })
  }

  // 4) Stock bajo
  if (ctx.low.length) {
    const none = ctx.low.filter((p) => p.stock <= 0)
    const names = ctx.low
      .slice(0, 3)
      .map((p) => `${p.name} (${p.stock < 0 ? `stock negativo: ${nf0.format(p.stock)}, revisalo` : p.stock === 0 ? 'sin stock' : plural(p.stock, 'botella', 'botellas')})`)
      .join(', ')
    out.push({
      tone: none.length ? 'bad' : 'warn',
      title: none.length
        ? `${plural(none.length, 'vino se quedó', 'vinos se quedaron')} sin stock${ctx.low.length > none.length ? ` y ${ctx.low.length - none.length} con poco` : ''}`
        : `${plural(ctx.low.length, 'vino tiene', 'vinos tienen')} poco stock`,
      text: `${names}${ctx.low.length > 3 ? ` y ${ctx.low.length - 3} más` : ''}. Están en o por debajo del mínimo que definiste: reponé antes de perder ventas.`,
      link: '/vinos',
      link_label: 'Ver vinos y stock',
    })
  }

  // 5) Resultado negativo. A principio de mes no es una alerta: los gastos fijos ya están y las ventas
  //    recién arrancan (lo explican el número del resultado y "Lo que vemos en tus números").
  if (!ctx.earlyMonth && summary.net_result < -0.01 && (summary.sales > 0 || summary.expenses > 0)) {
    out.push({
      tone: 'bad',
      title: `En este período perdiste ${$(-summary.net_result)}`,
      text: `Lo que te quedó de las ventas (${$(summary.gross_profit)} de ganancia bruta) no alcanzó para cubrir comisiones, mermas y gastos (${$(
        summary.fees + summary.shrinkage + summary.expenses,
      )}). Mirá en qué se fue la plata y si tus precios están al día.`,
      link: '/reportes?tab=resultados',
      link_label: 'Ver el reporte de resultados',
    })
  }

  // 6) Margen bruto cayendo más de 3 puntos (solo si la comparación es pareja)
  const prevC = ctx.comparison.previous
  const curC = ctx.comparison.current
  if (!ctx.comparison.partial && curC.sales > 0 && prevC.sales > 0) {
    const drop = prevC.gross_margin - curC.gross_margin
    if (drop > 0.03) {
      out.push({
        tone: 'warn',
        title: `Tu margen bruto bajó ${nf1.format(drop * 100)} puntos`,
        text: `Pasó de ${pctTxt(prevC.gross_margin, 1)} a ${pctTxt(curC.gross_margin, 1)} (${comparedWith(ctx.comparison.label)}). Suele pasar cuando sube el costo del vino y no actualizás precios, o cuando hacés muchos descuentos.`,
        link: '/calculadora',
        link_label: 'Revisar precios',
      })
    }
  }

  // 7) Gastos fijos del mes sin generar (solo para el mes en curso)
  const curMonth = monthKey(ref)
  const missing = all<{ description: string; amount: number; day_of_month: number }>(
    `SELECT r.description, r.amount, r.day_of_month FROM recurring_expenses r
     WHERE r.active = 1 AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.recurring_id = r.id AND substr(e.date, 1, 7) = ?)
     ORDER BY r.day_of_month`,
    [curMonth],
  )
  if (missing.length) {
    const already = missing.filter((m) => m.day_of_month <= dayNum(ref))
    out.push({
      tone: already.length ? 'warn' : 'info',
      title: `Faltan cargar ${plural(missing.length, 'gasto fijo', 'gastos fijos')} de ${monthName(ref)}`,
      text: `${missing
        .slice(0, 3)
        .map((m) => m.description)
        .join(', ')}${missing.length > 3 ? '…' : ''} (${$(missing.reduce((s, m) => s + m.amount, 0))} en total). Generalos con un clic: si no están cargados, el resultado del mes parece mejor de lo que es.`,
      link: '/gastos?tab=fijos',
      link_label: 'Generar gastos fijos',
    })
  }

  // 8) Dólar de referencia viejo
  const st = getSettings()
  if (st.usd_rate > 0 && st.usd_rate_date && daysBetween(st.usd_rate_date, ref) > 15) {
    out.push({
      tone: 'info',
      title: 'Actualizá el dólar de referencia',
      text: `La cotización que usás para ver equivalentes en dólares (${$(st.usd_rate)}) es del ${fmtDate(st.usd_rate_date)}, hace ${daysBetween(
        st.usd_rate_date,
        ref,
      )} días. Con un dólar viejo, las comparaciones en USD engañan.`,
      link: '/configuracion',
      link_label: 'Ir a Configuración',
    })
  }

  // 9) ¡Meta cumplida!
  if (ctx.goal?.progress != null && ctx.goal.progress >= 1) {
    out.push({
      tone: 'good',
      title: `¡Llegaste a la meta de ventas de ${monthName(`${ctx.goal.month}-01`)}!`,
      text: `Vendiste ${$(ctx.goal.sales)} contra una meta de ${$(ctx.goal.sales_target!)} (${pctTxt(ctx.goal.progress)}). Buen momento para pensar la meta del mes que viene.`,
      link: '/metas',
      link_label: 'Ver metas',
    })
  }

  const order: Record<AlertTone, number> = { bad: 0, warn: 1, info: 2, good: 3 }
  return out.sort((a, b) => order[a.tone] - order[b.tone])
}

// ───────────────────────── Frases ("Lo que vemos en tus números") ─────────────────────────

/** Promedio de ventas por día de la semana en las últimas 12 semanas (cada día aparece 12 veces). */
function weekdayPattern(ref: string): { best: number; worst: number; ratio: number } | null {
  const from = addDays(ref, -83)
  const rows = all<{ dow: number; sales: number; n: number }>(
    `SELECT CAST(strftime('%w', date) AS INTEGER) AS dow, SUM(total) AS sales, COUNT(*) AS n FROM sales WHERE date BETWEEN ? AND ? GROUP BY dow`,
    [from, ref],
  ).filter((r) => r.sales > 0)
  const count = rows.reduce((s, r) => s + r.n, 0)
  if (rows.length < 4 || count < 40) return null
  const sorted = [...rows].sort((a, b) => b.sales - a.sales)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  return { best: best.dow, worst: worst.dow, ratio: safeDiv(best.sales, worst.sales) }
}

function buildInsights(ctx: {
  ref: string
  period: Period
  summary: PeriodSummary
  comparison: DashboardComparison
  top: ProductSales[]
  channels: (ChannelSales & { label: string })[]
  goal: DashboardGoal | null
  earlyMonth: boolean
}): string[] {
  const { summary: s, comparison: c } = ctx
  const out: string[] = []
  const full = isFullMonth(ctx.period) ? 'month' : isFullYear(ctx.period) ? 'year' : 'range'
  const vsText =
    c.mode === 'same_days'
      ? { month: 'que en los mismos días del mes pasado', year: 'que en los mismos días del año pasado', range: 'que en los mismos días del período anterior' }[full]
      : { month: 'que el mes anterior', year: 'que el año anterior', range: 'que en el período anterior' }[full]

  // Ventas vs. comparación (si el período anterior está cargado a medias, no comparamos: engañaría)
  const dSales = c.partial ? null : pctChange(c.current.sales, c.previous.sales)
  if (dSales != null && c.current.sales > 0) {
    if (Math.abs(dSales) < 0.02) out.push(`Vendiste prácticamente lo mismo ${vsText} (${$(c.current.sales)}).`)
    else out.push(`Vendiste ${pctTxt(dSales)} ${dSales > 0 ? 'más' : 'menos'} ${vsText}: ${$(c.current.sales)} contra ${$(c.previous.sales)}.`)
  } else if (!c.partial && c.current.sales > 0 && c.previous.sales === 0) {
    out.push(`Vendiste ${$(c.current.sales)}; en el período anterior no había ventas cargadas para comparar.`)
  }

  // Principio de mes: el resultado viene en rojo porque los gastos fijos ya están. Decimos cuánto falta vender.
  if (ctx.earlyMonth && s.net_result < 0) {
    const contribution = safeDiv(s.sales - s.cogs - s.fees - s.shrinkage - s.expenses_variable, s.sales)
    if (s.expenses_fixed > 0 && s.sales > 0 && contribution > 0.05) {
      out.push(
        `Es principio de mes y ya están cargados ${$(s.expenses_fixed)} de gastos fijos: para salir del rojo te faltan vender unos ${$(
          roundUpTo(-s.net_result / contribution, 1000),
        )} más (de cada $\u00a0100 que vendés, te quedan $\u00a0${nf0.format(Math.round(contribution * 100))} para cubrir gastos).`,
      )
    } else {
      out.push('Ojo: es principio de mes y ya se cargaron los gastos fijos (alquiler, sueldos…); el resultado mejora a medida que vendés.')
    }
  }

  // Vino estrella
  if (ctx.top.length) {
    const star = ctx.top[0]
    const share = safeDiv(star.revenue, ctx.top.reduce((a, p) => a + p.revenue, 0))
    out.push(
      `Tu vino estrella: ${star.name} (${plural(star.bottles, 'botella', 'botellas')}, ${$(star.revenue)}${ctx.top.length > 1 && share > 0.25 ? `, ${pctTxt(share)} de lo que facturaron tus 6 vinos top` : ''}).`,
    )
  }

  // Día de la semana
  const wd = weekdayPattern(ctx.ref)
  if (wd && wd.ratio >= 1.3) {
    const r = wd.ratio
    const how = r >= 3.3 ? 'más del triple' : r >= 2.8 ? 'el triple' : r >= 2.3 ? 'más del doble' : r >= 1.8 ? 'el doble' : `un ${pctTxt(r - 1)} más`
    out.push(`Los ${DAYS_PLURAL[wd.best]} vendés ${how} que los ${DAYS_PLURAL[wd.worst]} (promedio de las últimas 12 semanas).`)
  }

  // Margen: de cada $100
  if (s.sales > 0 && s.net_result > 0) {
    out.push(`De cada $\u00a0100 que vendiste te quedaron $\u00a0${nf0.format(Math.round(s.net_margin * 100))} de ganancia limpia, después de pagar el vino y todos los gastos.`)
  }

  // Ritmo de la meta
  if (ctx.goal?.sales_target && ctx.goal.days_elapsed > 0 && ctx.goal.days_elapsed < ctx.goal.days_total) {
    const g = ctx.goal
    const diff = safeDiv(g.projection, g.sales_target!) - 1
    out.push(
      `A este ritmo cerrarías ${monthName(`${g.month}-01`)} con ${$(g.projection)} en ventas, ${Math.abs(diff) < 0.02 ? 'justo en la meta' : `un ${pctTxt(diff)} ${diff > 0 ? 'arriba' : 'abajo'} de la meta`}.`,
    )
  }

  // Canal principal
  const totalCh = ctx.channels.reduce((a, ch) => a + ch.sales, 0)
  if (ctx.channels.length > 1 && totalCh > 0) {
    const main = ctx.channels[0]
    out.push(`El ${pctTxt(main.sales / totalCh)} de tus ventas vino de «${main.label}».`)
  }

  // Comisiones
  if (s.sales > 0 && s.fees / s.sales > 0.02) {
    out.push(`Las comisiones de cobro (Mercado Pago, tarjetas) se llevaron ${$(s.fees)}: ${pctTxt(s.fees / s.sales, 1)} de lo que vendiste.`)
  }

  return out.slice(0, 5)
}

// ───────────────────────── Armado del tablero ─────────────────────────

export function buildDashboard(period: Period, ref: string = today()): DashboardResponse {
  const { from, to } = period
  const summary = periodSummary(from, to)
  const cp = comparisonPeriods(period, ref)
  const previous = periodSummary(cp.prev.from, cp.prev.to)
  const sameDays = cp.mode === 'same_days' ? periodSummary(cp.previous.from, cp.previous.to) : null
  const current = cp.mode === 'same_days' ? periodSummary(cp.current.from, cp.current.to) : summary
  const dataSince = firstRecordDate()
  const partial = isPartialComparison(cp.previous, dataSince)
  // Lo cargado con fecha posterior a hoy (gastos fijos generados para todo el mes, por ejemplo).
  const ahead = { sales: round2(summary.sales - current.sales), expenses: round2(summary.expenses - current.expenses), net_result: round2(summary.net_result - current.net_result) }
  const afterToday = cp.mode === 'same_days' && Object.values(ahead).some((v) => Math.abs(v) > 0.5) ? ahead : null
  const texts = comparisonTexts(period, cp, { dataSince, partial, afterToday })
  const comparison: DashboardComparison = {
    mode: cp.mode,
    ...texts,
    current,
    previous: sameDays ?? previous,
    partial,
    data_since: dataSince,
    after_today: afterToday,
  }

  // Últimos 12 meses, terminando en el mes de "to" (o en el mes actual si "to" está en el futuro).
  const lastMonthStart = startOfMonth(minDate(to, endOfMonth(ref)))
  const series = monthlySeries(addMonths(lastMonthStart, -11), endOfMonth(lastMonthStart))

  const accounts = accountBalances(ref).filter((a) => a.active || Math.abs(a.balance) > 0.009)
  const cashTotal = round2(accounts.reduce((s, a) => s + a.balance, 0))

  const low = lowStock()
  const top = salesByProduct(from, to).slice(0, 6)
  const channels = salesByChannel(from, to).map((c) => ({
    ...c,
    label: (SALE_CHANNEL_LABELS[c.channel as SaleChannel] ?? c.channel).replace(/\s*\(.*\)\s*$/, ''),
  }))

  // La meta: la del mes en que termina el período; si el período sigue, la del mes actual; si es futuro, la de su primer mes.
  const goalMonth = to < ref ? monthKey(to) : from > ref ? monthKey(from) : monthKey(ref)
  const goal = goalForMonth(goalMonth, ref)
  const earlyMonth = isFullMonth(period) && monthKey(ref) === monthKey(from) && dayNum(ref) <= 10

  const ctx = { ref, period, summary, comparison, cashTotal, low, goal, earlyMonth }
  const alerts = buildAlerts(ctx)
  const insights = buildInsights({ ...ctx, top, channels })

  const count = (table: string) => scalar<number>(`SELECT COUNT(*) FROM ${table}`) ?? 0
  return {
    period: { from, to },
    today: ref,
    period_label: periodInWords(period),
    period_phrase: periodPhrase(period, dataSince),
    summary,
    previous,
    same_days_previous: sameDays,
    comparison,
    series,
    cash: { total: cashTotal, accounts, scheduled: scheduledCash(ref) },
    stock: stockValue(),
    receivables: receivables(),
    payables: payables(),
    low_stock: low,
    top_products: top,
    by_channel: channels,
    goal_month: goalMonth,
    goal,
    alerts,
    insights,
    setup: {
      products: count('products'),
      sales: count('sales'),
      purchases: count('purchases'),
      expenses: count('expenses'),
      recurring: count('recurring_expenses'),
      goals: count('goals'),
    },
  }
}

// ───────────────────────── Rutas ─────────────────────────

router.get('/dashboard', (req, res) => {
  res.json(buildDashboard(parsePeriod(req)))
})

/** El resumen de Inicio en Excel: resultado explicado, últimos 12 meses, vinos, canales y alertas. */
router.get('/dashboard/export', async (req, res) => {
  const period = parsePeriod(req)
  const d = buildDashboard(period)
  const s = d.summary
  const p = d.comparison.previous
  const c = d.comparison.current
  const share = (v: number) => safeDiv(v, s.sales)
  const sameDays = d.comparison.mode === 'same_days'
  // Variación: siempre sobre los mismos días (columna "Hasta hoy" vs. período anterior), así se puede verificar a mano.
  const delta = (a: number, b: number) => (d.comparison.partial ? null : pctChange(a, b))
  type Key = 'sales' | 'cogs' | 'gross_profit' | 'fees' | 'shrinkage' | 'expenses_fixed' | 'expenses_variable' | 'net_result'
  const line = (concept: string, k: Key, sign: 1 | -1) => ({
    concept,
    value: sign * s[k] || 0,
    share: sign * share(s[k]) || 0,
    upto: sign * c[k] || 0,
    prev: sign * p[k] || 0,
    delta: delta(c[k], p[k]),
  })
  const resultRows = [
    line('Ventas', 'sales', 1),
    line('− Costo del vino vendido', 'cogs', -1),
    line('= Ganancia bruta', 'gross_profit', 1),
    line('− Comisiones de cobro', 'fees', -1),
    line('− Mermas, degustaciones y regalos', 'shrinkage', -1),
    line('− Gastos fijos', 'expenses_fixed', -1),
    line('− Gastos variables', 'expenses_variable', -1),
    line('= RESULTADO', 'net_result', 1),
  ]
  const snapshot = [
    { concept: 'Plata disponible (todas las cuentas)', value: d.cash.total },
    { concept: 'Te deben (ventas sin cobrar)', value: d.receivables.total },
    { concept: 'Debés (compras y gastos sin pagar)', value: d.payables.total },
    { concept: 'Stock valorizado al costo', value: d.stock.value },
  ]
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
  await sendWorkbook(res, excelFilename(`resumen-${d.period_label}`), [
    {
      name: 'Resultado',
      title: `Así se armó tu resultado · ${d.period_label}`,
      subtitle: periodSubtitle(period.from, period.to),
      totals: false,
      columns: [
        { header: 'Concepto', key: 'concept', width: 38 },
        { header: `Todo el período (${d.period_label})`, key: 'value', type: 'money', width: 20 },
        { header: 'De cada $100 vendidos', key: 'share', type: 'percent', width: 18 },
        ...(sameDays ? [{ header: `Hasta hoy (${rangeInWords(c.from, c.to)})`, key: 'upto', type: 'money' as const, width: 22 }] : []),
        {
          header: sameDays ? `Mismos días del período anterior (${rangeInWords(p.from, p.to)})` : `Período anterior (${periodInWords({ from: p.from, to: p.to })})`,
          key: 'prev',
          type: 'money',
          width: 24,
        },
        { header: 'Variación', key: 'delta', type: 'percent' },
      ],
      rows: resultRows,
      notes: [
        'Resultado = Ventas − costo del vino vendido − comisiones − mermas − gastos. Comprar vino NO es gasto: se vuelve costo recién cuando vendés la botella.',
        'Criterio "devengado": cada venta y cada gasto cuentan en su fecha, aunque se cobren o paguen después. Por eso el resultado no coincide con la plata que entró a la caja.',
        '"De cada $100 vendidos" muestra cuánto se lleva cada concepto de cada $100 que vendiste (en todo el período).',
        sameDays
          ? `La variación compara "Hasta hoy" con los mismos días del período anterior. ${d.comparison.detail}`
          : `La variación compara este período con el anterior. ${d.comparison.detail}`,
      ],
    },
    {
      name: 'Tu plata hoy',
      title: 'Tu plata hoy',
      subtitle: `Foto al ${fmtDate(d.today)}`,
      totals: false,
      columns: [
        { header: 'Concepto', key: 'concept', width: 40 },
        { header: 'Monto', key: 'value', type: 'money' },
      ],
      rows: snapshot,
      notes: [
        'Son saldos a hoy, no del período: cuánta plata hay en las cuentas, cuánto te deben, cuánto debés y cuánto tenés invertido en botellas (a costo).',
      ],
    },
    {
      name: 'Últimos 12 meses',
      title: 'Ventas, gastos y resultado — últimos 12 meses',
      subtitle: periodSubtitle(d.series[0].from, d.series[d.series.length - 1].to),
      columns: [
        { header: 'Mes', key: 'label', value: (m: MonthlyPoint) => cap(monthLabelLong(m.month)), width: 16 },
        { header: 'Ventas', key: 'sales', type: 'money' },
        { header: 'Costo del vino', key: 'cogs', type: 'money' },
        { header: 'Comisiones', key: 'fees', type: 'money' },
        { header: 'Mermas', key: 'shrinkage', type: 'money' },
        { header: 'Gastos', key: 'expenses', type: 'money' },
        { header: 'Resultado', key: 'net_result', type: 'money' },
        { header: 'Margen bruto', key: 'gross_margin', type: 'percent' },
        { header: 'Botellas vendidas', key: 'bottles_sold', type: 'int' },
      ],
      rows: d.series,
      notes: ['Cada fila es un mes calendario. La fila TOTAL suma los 12 meses (el margen no se suma: miralo mes a mes).'],
    },
    {
      name: 'Vinos estrella',
      title: 'Vinos más vendidos del período',
      subtitle: periodSubtitle(period.from, period.to),
      columns: [
        { header: 'Vino', key: 'name', width: 32 },
        { header: 'Bodega', key: 'winery', width: 22 },
        { header: 'Botellas', key: 'bottles', type: 'int' },
        { header: 'Facturado', key: 'revenue', type: 'money' },
        { header: 'Costo', key: 'cost', type: 'money' },
        { header: 'Ganancia bruta', key: 'profit', type: 'money' },
        { header: 'Margen', key: 'margin', type: 'percent' },
      ],
      rows: salesByProduct(period.from, period.to),
      notes: ['Facturado = cantidad × precio de cada renglón (sin repartir descuentos ni envíos). Ganancia bruta = facturado − costo de esas botellas.'],
    },
    {
      name: 'Canales',
      title: '¿De dónde vienen las ventas?',
      subtitle: periodSubtitle(period.from, period.to),
      columns: [
        { header: 'Canal', key: 'label', width: 28 },
        { header: 'Ventas', key: 'sales', type: 'money' },
        { header: 'Cantidad de ventas', key: 'count', type: 'int' },
        { header: 'Costo del vino', key: 'cost', type: 'money' },
        { header: 'Comisiones', key: 'fees', type: 'money' },
        { header: 'Lo que te dejó', key: 'profit', type: 'money' },
      ],
      rows: d.by_channel,
      notes: ['"Lo que te dejó" = ventas − costo del vino − comisiones de cobro de ese canal (antes de los gastos generales).'],
    },
    {
      name: 'Alertas',
      title: 'Para tener en cuenta',
      subtitle: `Al ${fmtDate(d.today)}`,
      totals: false,
      columns: [
        { header: 'Importancia', key: 'tone', value: (a: DashboardAlert) => ({ bad: 'Urgente', warn: 'Atención', info: 'Para saber', good: 'Buena noticia' })[a.tone], width: 14 },
        { header: 'Qué pasa', key: 'title', width: 46 },
        { header: 'Detalle', key: 'text', width: 90 },
      ],
      rows: [...d.alerts, ...d.insights.map((t) => ({ tone: 'info' as const, title: 'Lo que vemos en tus números', text: t }))],
      notes: ['Las alertas se calculan solas con tus datos cada vez que abrís Inicio.'],
    },
  ])
})

export default router
