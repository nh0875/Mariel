// Reportes: el análisis en profundidad de "¿Cómo venimos?" + los mejores Excel del sistema.
// (Ver docs/ARQUITECTURA.md → módulo "Reportes")
//
// Regla de oro: todos los números salen de services/finance.ts (periodSummary, monthlySeries,
// salesByProduct, salesByChannel, expensesByCategory). Acá solo se agrupan, se clasifican
// (ABC, canales, días de la semana…) y se explican. Así un mismo número da igual en Inicio,
// Metas y Reportes.
//
// Endpoints:
//   GET /reports/pnl|products|channels|clients|expenses|inflation?from&to   (+ /export cada uno)
//   GET /reports/full/export        → un solo Excel con todas las hojas y un "Índice" al principio
//   GET /inflation · PUT /inflation/:month { rate } · DELETE /inflation/:month
import { Router, type Request } from 'express'
import type ExcelJS from 'exceljs'
import { round2, safeDiv } from '../../shared/calc'
import {
  CLIENT_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  SALE_CHANNEL_LABELS,
  SHRINKAGE_KINDS,
  WINE_TYPE_LABELS,
  type ClientKind,
  type PaymentMethod,
  type SaleChannel,
  type WineType,
} from '../../shared/constants'
import { addDays, addMonths, endOfMonth, monthLabel, monthLabelLong, monthsBetween, presetToPeriod, startOfMonth, today } from '../../shared/dates'
import { inflationInput } from '../../shared/schemas'
import type { InflationRate, MonthlyPoint, PeriodSummary } from '../../shared/types'
import { all, get, run } from '../db'
import { HttpError, notFound, parsePeriod, validate } from '../lib/http'
import { addSheet, excelFilename, fmtDate, newWorkbook, periodSubtitle, sendWorkbookFile, type ExcelColumn } from '../lib/excel'
import { expensesByCategory, monthlySeries, periodSummary, salesByChannel, salesByProduct, type ChannelSales, type ProductSales } from '../services/finance'
import { getSettings } from '../services/settings'

const router = Router()

// ───────────────────────── Período ─────────────────────────

export interface ReportPeriod {
  /** Período que se usa para calcular (el pedido, recortado a los meses con movimiento). */
  from: string
  to: string
  /** Lo que se pidió. */
  requested: { from: string; to: string }
  /** true si se recortaron meses vacíos del principio o del final. */
  trimmed: boolean
}

/**
 * Recorta el período a los meses donde hay movimiento. Ejemplos:
 * - "Desde siempre" (2000-01-01 → fin de año) empieza en el mes de la primera venta/gasto/compra.
 * - "Este año" no muestra los meses que todavía no llegaron.
 * Los totales no cambian (afuera no hay nada), pero los promedios por mes y las tablas mes a mes
 * quedan honestos (sin 300 columnas vacías ni meses futuros en cero).
 */
export function effectivePeriod(from: string, to: string): ReportPeriod {
  const kinds = SHRINKAGE_KINDS.map((k) => `'${k}'`).join(',')
  const r = get<{ first: string | null; last: string | null }>(
    `SELECT MIN(d) AS first, MAX(d) AS last FROM (
       SELECT MIN(date) AS d FROM sales UNION ALL SELECT MAX(date) FROM sales
       UNION ALL SELECT MIN(date) FROM expenses UNION ALL SELECT MAX(date) FROM expenses
       UNION ALL SELECT MIN(date) FROM purchases UNION ALL SELECT MAX(date) FROM purchases
       UNION ALL SELECT MIN(date) FROM stock_movements WHERE kind IN (${kinds})
       UNION ALL SELECT MAX(date) FROM stock_movements WHERE kind IN (${kinds})
     ) WHERE d IS NOT NULL`,
  )
  const cap = endOfMonth(today())
  let f = from
  let t = to
  if (r?.first) {
    const firstMonth = startOfMonth(r.first)
    if (f < firstMonth) f = firstMonth
    const lastBound = r.last && endOfMonth(r.last) > cap ? endOfMonth(r.last) : cap
    if (t > lastBound) t = lastBound
  } else {
    // Sin datos: no tiene sentido mostrar años vacíos. Como mucho, los 12 meses hasta hoy.
    if (t > cap) t = cap
    const min = startOfMonth(addMonths(t, -11))
    if (f < min) f = min
  }
  if (f > t) return { from, to, requested: { from, to }, trimmed: false }
  return { from: f, to: t, requested: { from, to }, trimmed: f !== from || t !== to }
}

/** Lee ?from&to (por defecto: últimos 12 meses, lo más útil para un reporte) y lo recorta. */
function reportPeriod(req: Request): ReportPeriod {
  const p = parsePeriod(req, presetToPeriod('ultimos_12_meses'))
  return effectivePeriod(p.from, p.to)
}

const currentMonth = () => today().slice(0, 7)
const isCurrentPartialMonth = (month: string) => month === currentMonth() && today() < endOfMonth(today())

// ───────────────────────── Estado de resultados ─────────────────────────

export interface ExpenseCategoryByMonth {
  category: string
  nature: 'fijo' | 'variable'
  total: number
  count: number
  /** 'YYYY-MM' → monto del mes (todos los meses del período, 0 si no hubo). */
  months: Record<string, number>
}

export interface PnlReport {
  period: ReportPeriod
  months: MonthlyPoint[]
  total: PeriodSummary
  expenses_by_category: ExpenseCategoryByMonth[]
}

export function pnlReport(from: string, to: string): Omit<PnlReport, 'period'> {
  const months = monthlySeries(from, to)
  const total = periodSummary(from, to)
  const keys = months.map((m) => m.month)
  // Agrupado por categoría Y naturaleza, así el detalle suma exacto a "Gastos fijos" y "Gastos variables".
  const rows = all<{ category: string; nature: string; m: string; amount: number; n: number }>(
    `SELECT category, CASE WHEN nature = 'fijo' THEN 'fijo' ELSE 'variable' END AS nature, substr(date, 1, 7) AS m,
            SUM(amount) AS amount, COUNT(*) AS n
     FROM expenses WHERE date BETWEEN ? AND ?
     GROUP BY category, nature, m`,
    [from, to],
  )
  const map = new Map<string, ExpenseCategoryByMonth>()
  for (const r of rows) {
    const k = `${r.nature}|${r.category}`
    let c = map.get(k)
    if (!c) {
      c = { category: r.category, nature: r.nature as 'fijo' | 'variable', total: 0, count: 0, months: Object.fromEntries(keys.map((m) => [m, 0])) }
      map.set(k, c)
    }
    c.months[r.m] = round2((c.months[r.m] ?? 0) + (r.amount || 0))
    c.total += r.amount || 0
    c.count += r.n || 0
  }
  const expenses_by_category = [...map.values()].map((c) => ({ ...c, total: round2(c.total) })).sort((a, b) => (a.nature === b.nature ? b.total - a.total : a.nature === 'fijo' ? -1 : 1))
  return { months, total, expenses_by_category }
}

// ───────────────────────── Rentabilidad por vino (ABC) ─────────────────────────

export type AbcClass = 'A' | 'B' | 'C'

export interface ProductReportRow extends ProductSales {
  active: boolean
  stock: number
  unit_cost: number
  price_retail: number
  /** Botellas en stock × costo promedio (0 si el stock es negativo). */
  stock_value: number
  /** Botellas vendidas en los últimos 90 días (igual que en Vinos). */
  sold_90d: number
  /** Para cuántos días alcanza el stock al ritmo de los últimos 90 días (null si no vendió). */
  days_of_stock: number | null
  /** Parte de la ganancia bruta del período que dejó este vino (0..1; negativa si perdió). */
  share: number
  /** Suma de "share" de este vino y todos los que dejaron más (0..1). */
  cumulative_share: number
  abc: AbcClass
  /** true = tiene stock pero no se vendió en el período ("vino quieto"). */
  idle: boolean
  /** Última vez que se vendió (en toda la historia). */
  last_sale: string | null
}

export const ABC_LIMITS = { A: 0.8, B: 0.95 }
const EPS = 1e-9

/**
 * Clasificación ABC por ganancia: se ordenan los vinos de mayor a menor ganancia y se va sumando.
 * A = los que juntos llegan hasta el 80 % de la ganancia (el primero siempre es A),
 * B = hasta el 95 %, C = el resto, los que perdieron plata y los que no se vendieron.
 */
export function classifyAbc<T extends { profit: number; revenue: number }>(rows: T[]): (T & { share: number; cumulative_share: number; abc: AbcClass })[] {
  const positive = rows.reduce((s, r) => s + (r.profit > 0 ? r.profit : 0), 0)
  const sorted = [...rows].sort((a, b) => b.profit - a.profit || b.revenue - a.revenue)
  let cum = 0
  return sorted.map((r, i) => {
    const share = positive > 0 ? r.profit / positive : 0
    if (r.profit > 0) cum += share
    const c = Math.min(1, cum)
    const abc: AbcClass = r.profit <= 0 || positive <= 0 ? 'C' : i === 0 || c <= ABC_LIMITS.A + EPS ? 'A' : c <= ABC_LIMITS.B + EPS ? 'B' : 'C'
    return { ...r, share, cumulative_share: c, abc }
  })
}

export function productsReport(from: string, to: string): ProductReportRow[] {
  const sold = salesByProduct(from, to)
  const products = all<{ id: number; name: string; winery: string | null; wine_type: string; stock: number; unit_cost: number; price_retail: number; active: number }>(
    'SELECT id, name, winery, wine_type, stock, unit_cost, price_retail, active FROM products',
  )
  const byId = new Map(products.map((p) => [p.id, p]))
  const sold90 = new Map(
    all<{ product_id: number; q: number }>(
      `SELECT si.product_id, SUM(si.qty) AS q FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id IS NOT NULL AND s.date BETWEEN ? AND ? GROUP BY si.product_id`,
      [addDays(today(), -89), today()],
    ).map((r) => [r.product_id, r.q || 0]),
  )
  const lastSale = new Map(
    all<{ product_id: number; d: string }>(
      `SELECT si.product_id, MAX(s.date) AS d FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id IS NOT NULL GROUP BY si.product_id`,
    ).map((r) => [r.product_id, r.d]),
  )
  const extras = (id: number) => {
    const p = byId.get(id)
    const stock = p?.stock ?? 0
    const unitCost = p?.unit_cost ?? 0
    const q90 = sold90.get(id) ?? 0
    return {
      active: !!p?.active,
      stock,
      unit_cost: round2(unitCost),
      price_retail: p?.price_retail ?? 0,
      stock_value: stock > 0 ? round2(stock * unitCost) : 0,
      sold_90d: q90,
      days_of_stock: q90 > 0 ? Math.max(0, Math.round(stock / (q90 / 90))) : null,
      last_sale: lastSale.get(id) ?? null,
    }
  }
  const classified = classifyAbc(sold).map((r) => ({ ...r, ...extras(r.product_id), idle: false }))
  const finalCum = classified.length ? classified[classified.length - 1].cumulative_share : 0
  const soldIds = new Set(sold.map((s) => s.product_id))
  const idle: ProductReportRow[] = products
    .filter((p) => p.stock > 0 && !soldIds.has(p.id))
    .map((p) => ({
      product_id: p.id,
      name: p.name,
      winery: p.winery,
      wine_type: p.wine_type,
      bottles: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
      margin: 0,
      ...extras(p.id),
      share: 0,
      cumulative_share: finalCum,
      abc: 'C' as const,
      idle: true,
    }))
    .sort((a, b) => b.stock_value - a.stock_value || a.name.localeCompare(b.name, 'es'))
  return [...classified, ...idle]
}

// ───────────────────────── Canales, medios de cobro y días ─────────────────────────

/** "Mayorista (restós, vinotecas)" → "Mayorista" (igual que en Inicio). */
export const channelLabel = (c: string) => (SALE_CHANNEL_LABELS[c as SaleChannel] ?? c).replace(/\s*\(.*\)\s*$/, '')

export interface ChannelRow extends ChannelSales {
  label: string
  bottles: number
  /** Lo que te dejó ÷ ventas (después del vino y las comisiones, antes de los gastos generales). */
  margin: number
  avg_ticket: number
  /** Parte de las ventas del período (0..1). */
  share: number
}

export interface PaymentMethodRow {
  method: string
  label: string
  total: number
  count: number
  fees: number
  /** Comisiones ÷ lo vendido con ese medio (0..1). */
  fee_pct_effective: number
  /** El % configurado en Configuración (0..1), para comparar. */
  fee_pct_configured: number | null
  share: number
}

export interface WeekdayRow {
  /** 0 = domingo … 6 = sábado (como en JavaScript). */
  dow: number
  label: string
  short: string
  total: number
  count: number
  /** Cuántos días de ese tipo tuvo el período (hasta hoy). */
  days: number
  /** Venta promedio de cada uno de esos días. */
  avg_per_day: number
  share: number
}

export interface ChannelsReport {
  period: ReportPeriod
  total_sales: number
  total_count: number
  channels: ChannelRow[]
  payment_methods: PaymentMethodRow[]
  weekdays: WeekdayRow[]
}

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** Cuántos lunes, martes… hay entre dos fechas (inclusive). */
export function weekdayCounts(from: string, to: string): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0]
  if (from > to) return counts
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  const start = Date.UTC(y1, m1 - 1, d1)
  const end = Date.UTC(y2, m2 - 1, d2)
  const days = Math.min(Math.round((end - start) / 86_400_000) + 1, 366 * 30)
  const firstDow = new Date(start).getUTCDay()
  const full = Math.floor(days / 7)
  for (let i = 0; i < 7; i++) counts[i] = full
  for (let i = 0; i < days % 7; i++) counts[(firstDow + i) % 7]++
  return counts
}

export function channelsReport(from: string, to: string): Omit<ChannelsReport, 'period'> {
  const base = salesByChannel(from, to)
  const totalSales = round2(base.reduce((s, c) => s + c.sales, 0))
  const totalCount = base.reduce((s, c) => s + c.count, 0)
  const bottles = new Map(
    all<{ channel: string; b: number }>(
      `SELECT s.channel, SUM(si.qty) AS b FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id IS NOT NULL AND s.date BETWEEN ? AND ? GROUP BY s.channel`,
      [from, to],
    ).map((r) => [r.channel, r.b || 0]),
  )
  const channels: ChannelRow[] = base.map((c) => ({
    ...c,
    label: channelLabel(c.channel),
    bottles: bottles.get(c.channel) ?? 0,
    margin: safeDiv(c.profit, c.sales),
    avg_ticket: round2(safeDiv(c.sales, c.count)),
    share: safeDiv(c.sales, totalSales),
  }))

  const settings = getSettings()
  const payment_methods: PaymentMethodRow[] = all<{ method: string; total: number; count: number; fees: number }>(
    `SELECT payment_method AS method, SUM(total) AS total, COUNT(*) AS count, SUM(fee) AS fees
     FROM sales WHERE date BETWEEN ? AND ? GROUP BY payment_method ORDER BY total DESC`,
    [from, to],
  ).map((r) => {
    const cfg = settings.payment_methods.find((m) => m.key === r.method)
    return {
      method: r.method,
      label: cfg?.label || PAYMENT_METHOD_LABELS[r.method as PaymentMethod] || r.method,
      total: round2(r.total || 0),
      count: r.count || 0,
      fees: round2(r.fees || 0),
      fee_pct_effective: safeDiv(r.fees || 0, r.total || 0),
      fee_pct_configured: cfg ? cfg.fee_pct / 100 : null,
      share: safeDiv(r.total || 0, totalSales),
    }
  })

  const byDow = new Map(
    all<{ dow: number; total: number; count: number }>(
      `SELECT CAST(strftime('%w', date) AS INTEGER) AS dow, SUM(total) AS total, COUNT(*) AS count
       FROM sales WHERE date BETWEEN ? AND ? GROUP BY dow`,
      [from, to],
    ).map((r) => [Number(r.dow), r]),
  )
  // Los días que todavía no llegaron no cuentan para el promedio.
  const counts = weekdayCounts(from, to < today() ? to : today())
  const weekdays: WeekdayRow[] = [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const r = byDow.get(dow)
    const total = round2(r?.total ?? 0)
    return {
      dow,
      label: WEEKDAYS[dow],
      short: WEEKDAYS_SHORT[dow],
      total,
      count: r?.count ?? 0,
      days: counts[dow],
      avg_per_day: round2(safeDiv(total, counts[dow])),
      share: safeDiv(total, totalSales),
    }
  })

  return { total_sales: totalSales, total_count: totalCount, channels, payment_methods, weekdays }
}

// ───────────────────────── Clientes ─────────────────────────

export interface ClientReportRow {
  client_id: number
  name: string
  kind: string
  kind_label: string
  total: number
  count: number
  bottles: number
  /** Lo que te dejaron sus compras: ventas − costo del vino − comisiones. */
  profit: number
  avg_ticket: number
  share: number
  /** Última compra (en toda la historia). */
  last_purchase: string | null
}

export interface ClientsReport {
  period: ReportPeriod
  clients: ClientReportRow[]
  /** Ventas sin cliente cargado ("consumidor final" de mostrador). */
  walk_in: { total: number; count: number; bottles: number; profit: number; share: number }
  totals: { sales: number; count: number; clients: number; top5_share: number; top15_share: number }
}

export function clientsReport(from: string, to: string): Omit<ClientsReport, 'period'> {
  const rows = all<{ client_id: number | null; name: string | null; kind: string | null; total: number; count: number; fees: number; cost: number; bottles: number; last_purchase: string | null }>(
    `SELECT s.client_id, c.name, c.kind, SUM(s.total) AS total, COUNT(*) AS count, SUM(s.fee) AS fees,
       SUM((SELECT COALESCE(SUM(si.qty * si.unit_cost), 0) FROM sale_items si WHERE si.sale_id = s.id)) AS cost,
       SUM((SELECT COALESCE(SUM(CASE WHEN si.product_id IS NOT NULL THEN si.qty ELSE 0 END), 0) FROM sale_items si WHERE si.sale_id = s.id)) AS bottles,
       (SELECT MAX(s2.date) FROM sales s2 WHERE s2.client_id = s.client_id) AS last_purchase
     FROM sales s LEFT JOIN clients c ON c.id = s.client_id
     WHERE s.date BETWEEN ? AND ?
     GROUP BY s.client_id`,
    [from, to],
  )
  const totalSales = round2(rows.reduce((s, r) => s + (r.total || 0), 0))
  const totalCount = rows.reduce((s, r) => s + (r.count || 0), 0)
  const walk = rows.find((r) => r.client_id == null)
  const clients: ClientReportRow[] = rows
    .filter((r) => r.client_id != null)
    .map((r) => ({
      client_id: r.client_id!,
      name: r.name ?? 'Cliente borrado',
      kind: r.kind ?? 'otro',
      kind_label: CLIENT_KIND_LABELS[(r.kind ?? 'otro') as ClientKind] ?? r.kind ?? '',
      total: round2(r.total || 0),
      count: r.count || 0,
      bottles: r.bottles || 0,
      profit: round2((r.total || 0) - (r.cost || 0) - (r.fees || 0)),
      avg_ticket: round2(safeDiv(r.total || 0, r.count || 0)),
      share: safeDiv(r.total || 0, totalSales),
      last_purchase: r.last_purchase,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'))
  const topShare = (n: number) =>
    safeDiv(
      clients.slice(0, n).reduce((s, c) => s + c.total, 0),
      totalSales,
    )
  return {
    clients,
    walk_in: {
      total: round2(walk?.total ?? 0),
      count: walk?.count ?? 0,
      bottles: walk?.bottles ?? 0,
      profit: round2((walk?.total ?? 0) - (walk?.cost ?? 0) - (walk?.fees ?? 0)),
      share: safeDiv(walk?.total ?? 0, totalSales),
    },
    totals: { sales: totalSales, count: totalCount, clients: clients.length, top5_share: topShare(5), top15_share: topShare(15) },
  }
}

// ───────────────────────── Gastos ─────────────────────────

export interface ExpensesReport {
  period: ReportPeriod
  /** monthly_avg = lo de esa categoría en los meses completos ÷ months_for_avg (igual que fixed_avg). */
  by_category: { category: string; nature: string; total: number; count: number; share: number; monthly_avg: number }[]
  by_month: { month: string; label: string; fixed: number; variable: number; total: number; sales: number; pct_of_sales: number | null; partial: boolean }[]
  totals: { total: number; fixed: number; variable: number; sales: number }
  /** Promedio de gastos fijos por mes (meses completos; el mes en curso no cuenta si hay otros). */
  fixed_avg: number
  /** Cuántos meses se usaron para el promedio. */
  months_for_avg: number
  /** Gastos variables ÷ ventas del período (0..1). */
  variable_pct_of_sales: number
  /** Margen de contribución: lo que queda de cada $1 vendido después del vino, comisiones, mermas y gastos variables (0..1). */
  contribution_margin: number
  /** Ventas por mes necesarias para cubrir los gastos fijos promedio (null si el margen de contribución no es positivo). */
  break_even_monthly: number | null
}

export function expensesReport(from: string, to: string): Omit<ExpensesReport, 'period'> {
  const months = monthlySeries(from, to)
  const s = periodSummary(from, to)
  const by_month = months.map((m) => ({
    month: m.month,
    label: m.label,
    fixed: m.expenses_fixed,
    variable: m.expenses_variable,
    total: m.expenses,
    sales: m.sales,
    pct_of_sales: m.sales > 0 ? m.expenses / m.sales : null,
    partial: isCurrentPartialMonth(m.month),
  }))
  // Promedios por mes: solo con meses completos (el mes en curso y los que no llegaron no cuentan, si hay otros).
  const complete = by_month.length > 1 ? by_month.filter((m) => !m.partial && m.month <= currentMonth()) : by_month
  const forAvg = complete.length ? complete : by_month
  const avgMonths = new Set(forAvg.map((m) => m.month))
  const fixed_avg = round2(
    safeDiv(
      forAvg.reduce((x, m) => x + m.fixed, 0),
      forAvg.length,
    ),
  )
  // Lo de cada categoría en esos mismos meses, así "Por mes" se calcula igual que "Fijos por mes".
  const catInAvg = new Map<string, number>()
  for (const r of all<{ category: string; m: string; amount: number }>(
    `SELECT category, substr(date, 1, 7) AS m, SUM(amount) AS amount FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category, m`,
    [from, to],
  )) {
    if (avgMonths.has(r.m)) catInAvg.set(r.category, (catInAvg.get(r.category) ?? 0) + (r.amount || 0))
  }
  const by_category = expensesByCategory(from, to).map((c) => ({
    category: c.category,
    nature: c.nature === 'fijo' ? 'fijo' : 'variable',
    total: c.amount,
    count: c.count,
    share: safeDiv(c.amount, s.expenses),
    monthly_avg: round2(safeDiv(catInAvg.get(c.category) ?? 0, forAvg.length)),
  }))
  const contribution = s.sales - s.cogs - s.fees - s.shrinkage - s.expenses_variable
  const contribution_margin = safeDiv(contribution, s.sales)
  return {
    by_category,
    by_month,
    totals: { total: s.expenses, fixed: s.expenses_fixed, variable: s.expenses_variable, sales: s.sales },
    fixed_avg,
    months_for_avg: forAvg.length,
    variable_pct_of_sales: safeDiv(s.expenses_variable, s.sales),
    contribution_margin,
    break_even_monthly: contribution_margin > 0 ? round2(fixed_avg / contribution_margin) : null,
  }
}

// ───────────────────────── Inflación ─────────────────────────

export interface InflationMonthRow {
  month: string
  label: string
  /** Ventas como se registraron (pesos de ese mes). */
  sales: number
  /** Inflación del mes en % (ej: 2.7). null si no está cargada. */
  rate: number | null
  /** Índice de precios: 100 en el primer mes del período. */
  index: number
  /** Por cuánto se multiplican los pesos de ese mes para llevarlos a pesos del último mes. */
  factor: number
  sales_today_pesos: number
  /** Crecimiento sacando la inflación, contra el mes anterior (0..1). null en el primer mes, en el mes en curso y si el anterior no vendió. */
  real_growth_vs_prev: number | null
  /** Crecimiento en pesos "de cada mes", contra el mes anterior (0..1). null en los mismos casos. */
  nominal_growth_vs_prev: number | null
  /** Mes en curso (todavía no terminó: sus ventas están incompletas). */
  partial: boolean
}

export interface InflationReport {
  period: ReportPeriod
  months: InflationMonthRow[]
  /** Meses que hacen falta para el cálculo y no tienen inflación cargada (se toman como 0 %). */
  missing_months: string[]
  /** Inflación acumulada del período (del primer al último mes), con lo cargado (0..1). */
  inflation_accum: number
  totals: { sales: number; sales_today_pesos: number }
  /** Mes al que se llevan todos los montos ("pesos de hoy"). */
  base_month: string | null
  explanation: string
}

export function inflationReport(from: string, to: string): Omit<InflationReport, 'period'> {
  const series = monthlySeries(from, to)
  const keys = series.map((m) => m.month)
  const rates = new Map(keys.length ? all<InflationRate>('SELECT month, rate FROM inflation WHERE month BETWEEN ? AND ?', [keys[0], keys[keys.length - 1]]).map((r) => [r.month, r.rate]) : [])
  // Índice: 100 en el primer mes; cada mes siguiente se multiplica por (1 + inflación del mes).
  const raw: number[] = []
  let idx = 100
  series.forEach((m, i) => {
    if (i > 0) idx = idx * (1 + (rates.get(m.month) ?? 0) / 100)
    raw.push(idx)
  })
  const lastIdx = raw.length ? raw[raw.length - 1] : 100
  const months: InflationMonthRow[] = series.map((m, i) => {
    const factor = lastIdx / raw[i]
    return {
      month: m.month,
      label: m.label,
      sales: m.sales,
      rate: rates.has(m.month) ? rates.get(m.month)! : null,
      index: Math.round(raw[i] * 10000) / 10000,
      factor: Math.round(factor * 1e6) / 1e6,
      sales_today_pesos: round2(m.sales * factor),
      real_growth_vs_prev: null,
      nominal_growth_vs_prev: null,
      partial: isCurrentPartialMonth(m.month),
    }
  })
  months.forEach((m, i) => {
    // El mes en curso no se compara: todavía no terminó y siempre "caería" (ej: −85 % con 4 días de ventas).
    if (i === 0 || m.partial) return
    const prev = months[i - 1]
    // Comparar en pesos de hoy es lo mismo que: (ventas / ventas anteriores) ÷ (1 + inflación del mes) − 1.
    const prevReal = prev.sales * (lastIdx / raw[i - 1])
    m.real_growth_vs_prev = prev.sales > 0 ? (m.sales * (lastIdx / raw[i])) / prevReal - 1 : null
    m.nominal_growth_vs_prev = prev.sales > 0 ? m.sales / prev.sales - 1 : null
  })
  const missing_months = months
    .slice(1)
    .filter((m) => m.rate == null)
    .map((m) => m.month)
  const missingPast = months.slice(1).filter((m) => m.rate == null && !m.partial).length
  const missingCurrent = months.slice(1).some((m) => m.rate == null && m.partial)
  const base = months.length ? months[months.length - 1].month : null
  const totals = {
    sales: round2(months.reduce((s, m) => s + m.sales, 0)),
    sales_today_pesos: round2(months.reduce((s, m) => s + m.sales_today_pesos, 0)),
  }
  const explanation = base
    ? `Llevamos las ventas de cada mes a "pesos de ${monthLabelLong(base)}": multiplicamos cada mes por la inflación acumulada desde ese mes hasta ${monthLabelLong(base)}. ` +
      `Ejemplo: si después de un mes hubo dos meses de 10 %, sus ventas se multiplican por 1,1 × 1,1 = 1,21. ` +
      `Así se pueden comparar meses distintos sin que la inflación te engañe. Crecimiento real = (ventas del mes ÷ ventas del mes anterior) ÷ (1 + inflación del mes) − 1.` +
      (months.some((m) => m.partial) && months.length > 1 ? ' El mes en curso no se compara con el anterior: todavía no terminó.' : '') +
      (missingPast
        ? ` Faltan cargar ${missingPast} ${missingPast === 1 ? 'mes' : 'meses'}${missingCurrent ? ' (más el mes en curso)' : ''}: mientras tanto se toman como 0 % y los montos ajustados quedan un poco bajos.`
        : missingCurrent
          ? ' El mes en curso todavía no tiene inflación cargada (el INDEC la publica a mediados del mes siguiente): mientras tanto cuenta como 0 %.'
          : '')
    : 'No hay meses para mostrar en este período.'
  return { months, missing_months, inflation_accum: lastIdx / 100 - 1, totals, base_month: base, explanation }
}

// ───────────────────────── Rutas JSON ─────────────────────────

router.get('/reports/pnl', (req, res) => {
  const period = reportPeriod(req)
  res.json({ period, ...pnlReport(period.from, period.to) } satisfies PnlReport)
})

router.get('/reports/products', (req, res) => {
  const period = reportPeriod(req)
  res.json(productsReport(period.from, period.to))
})

router.get('/reports/channels', (req, res) => {
  const period = reportPeriod(req)
  res.json({ period, ...channelsReport(period.from, period.to) } satisfies ChannelsReport)
})

router.get('/reports/clients', (req, res) => {
  const period = reportPeriod(req)
  res.json({ period, ...clientsReport(period.from, period.to) } satisfies ClientsReport)
})

router.get('/reports/expenses', (req, res) => {
  const period = reportPeriod(req)
  res.json({ period, ...expensesReport(period.from, period.to) } satisfies ExpensesReport)
})

router.get('/reports/inflation', (req, res) => {
  const period = reportPeriod(req)
  res.json({ period, ...inflationReport(period.from, period.to) } satisfies InflationReport)
})

// ───────────────────────── Inflación (carga) ─────────────────────────

function checkMonth(month: string) {
  const m = Number(month.slice(5, 7))
  if (!/^\d{4}-\d{2}$/.test(month) || m < 1 || m > 12) throw new HttpError(400, 'Revisá estos datos → Mes: tiene que ser un mes válido (AAAA-MM)')
}

router.get('/inflation', (_req, res) => {
  res.json(all<InflationRate>('SELECT month, rate FROM inflation ORDER BY month'))
})

router.put('/inflation/:month', (req, res) => {
  const body = (req.body ?? {}) as { rate?: unknown }
  const data = validate(inflationInput, { month: String(req.params.month), rate: body.rate })
  checkMonth(data.month)
  const rate = Math.round(data.rate * 100) / 100
  run('INSERT INTO inflation (month, rate) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET rate = excluded.rate', [data.month, rate])
  res.json(get<InflationRate>('SELECT month, rate FROM inflation WHERE month = ?', [data.month]))
})

router.delete('/inflation/:month', (req, res) => {
  const month = String(req.params.month)
  const r = run('DELETE FROM inflation WHERE month = ?', [month])
  if (!r.changes) throw notFound('la inflación de ese mes')
  res.json({ ok: true })
})

// ───────────────────────── Excel ─────────────────────────

type Writer = (wb: ExcelJS.Workbook) => void

interface SheetInfo {
  name: string
  what: string
  why: string
}

const MONEY_FMT = '"$ "#,##0.00;[Red]-"$ "#,##0.00'
const PCT_FMT = '0.0%'

function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const monthHeader = (m: string) => (isCurrentPartialMonth(m) ? `${monthLabel(m)} (en curso)` : monthLabel(m))
const natureLabel = (n: string) => (n === 'fijo' ? 'Fijo' : 'Variable')
const wineTypeLabel = (t: string) => WINE_TYPE_LABELS[t as WineType] ?? t

const PNL_LINES: { key: keyof PeriodSummary; concept: string; kind: 'money' | 'percent'; bold?: boolean }[] = [
  { key: 'sales', concept: 'Ventas', kind: 'money', bold: true },
  { key: 'cogs', concept: '(−) Costo de lo vendido', kind: 'money' },
  { key: 'gross_profit', concept: '= Ganancia bruta', kind: 'money', bold: true },
  { key: 'gross_margin', concept: 'Margen bruto %', kind: 'percent' },
  { key: 'fees', concept: '(−) Comisiones de cobro', kind: 'money' },
  { key: 'shrinkage', concept: '(−) Mermas, degustaciones y regalos', kind: 'money' },
  { key: 'expenses_fixed', concept: '(−) Gastos fijos', kind: 'money' },
  { key: 'expenses_variable', concept: '(−) Gastos variables', kind: 'money' },
  { key: 'net_result', concept: '= Resultado (ganancia o pérdida)', kind: 'money', bold: true },
  { key: 'net_margin', concept: 'Margen neto %', kind: 'percent' },
]

const PNL_SHEETS: SheetInfo[] = [
  {
    name: 'Estado de resultados',
    what: 'Mes a mes: ventas, costo del vino, ganancia bruta, comisiones, mermas, gastos y resultado.',
    why: 'Es la foto completa de si el negocio gana o pierde plata, y por qué. Las filas calculadas tienen fórmulas.',
  },
  {
    name: 'Gastos por categoría y mes',
    what: 'Cada categoría de gasto (alquiler, sueldos, envíos…) mes por mes.',
    why: 'Para ver qué gasto creció y cuándo.',
  },
]

function writePnl(p: ReportPeriod): Writer {
  return (wb) => {
    const d = pnlReport(p.from, p.to)
    const ms = d.months
    const sub = periodSubtitle(p.from, p.to)
    type Row = Record<string, unknown>
    const rows: Row[] = PNL_LINES.map((l) => ({
      concept: l.concept,
      ...Object.fromEntries(ms.map((m) => [m.month, m[l.key]])),
      total: d.total[l.key],
    }))
    const columns: ExcelColumn<Row>[] = [
      { header: 'Concepto', key: 'concept', width: 36 },
      ...ms.map((m) => ({ header: monthHeader(m.month), key: m.month, type: 'money' as const, width: 15 })),
      { header: 'Total del período', key: 'total', type: 'money', width: 18 },
    ]
    const ws = addSheet(wb, {
      name: PNL_SHEETS[0].name,
      title: 'Estado de resultados',
      subtitle: sub,
      columns,
      rows,
      totals: false,
      notes: [
        'Resultado = Ventas − Costo de lo vendido − Comisiones − Mermas − Gastos fijos − Gastos variables. Comprar vino NO es gasto: se vuelve costo recién cuando vendés la botella.',
        'Ventas: lo que pagan los clientes (precio − descuentos + envío cobrado), en la fecha de la venta aunque la cobres después (criterio "devengado").',
        'Costo de lo vendido: cada botella vendida a su costo promedio del momento (con el flete de la compra incluido).',
        'Comisiones: lo que se quedan Mercado Pago, las tarjetas, etc. Mermas: botellas rotas, abiertas para degustar, regaladas o faltantes, valorizadas al costo.',
        'Gastos fijos: los que pagás vendas o no (alquiler, sueldos). Variables: los que suben o bajan con las ventas (envíos, packaging, publicidad).',
        'Margen bruto % = Ganancia bruta ÷ Ventas. Margen neto % = Resultado ÷ Ventas. Las filas con "=" y los márgenes son fórmulas: si cambiás un número, se recalculan.',
        'Por qué el resultado no coincide con la plata de la caja: acá cuenta lo vendido y gastado; la caja cuenta lo cobrado y pagado (y las compras de vino).',
      ],
    })
    // Formato por fila (los % van con formato de porcentaje) + fórmulas en las filas calculadas.
    const first = 5
    const r = (key: keyof PeriodSummary) => first + PNL_LINES.findIndex((l) => l.key === key)
    const lastCol = ms.length + 2
    const lastMonthL = colLetter(ms.length + 1)
    PNL_LINES.forEach((l, i) => {
      const row = ws.getRow(first + i)
      for (let c = 2; c <= lastCol; c++) {
        const cell = row.getCell(c)
        cell.numFmt = l.kind === 'percent' ? PCT_FMT : MONEY_FMT
        const L = colLetter(c)
        const result = typeof cell.value === 'number' ? cell.value : 0
        const isTotal = c === lastCol
        if (l.key === 'gross_profit') cell.value = { formula: `${L}${r('sales')}-${L}${r('cogs')}`, result }
        else if (l.key === 'gross_margin') cell.value = { formula: `IF(${L}${r('sales')}=0,0,${L}${r('gross_profit')}/${L}${r('sales')})`, result }
        else if (l.key === 'net_result') cell.value = { formula: `${L}${r('gross_profit')}-${L}${r('fees')}-${L}${r('shrinkage')}-${L}${r('expenses_fixed')}-${L}${r('expenses_variable')}`, result }
        else if (l.key === 'net_margin') cell.value = { formula: `IF(${L}${r('sales')}=0,0,${L}${r('net_result')}/${L}${r('sales')})`, result }
        else if (isTotal && ms.length > 0) cell.value = { formula: `SUM(B${first + i}:${lastMonthL}${first + i})`, result }
      }
      if (l.bold) row.eachCell({ includeEmpty: true }, (cell) => (cell.font = { ...(cell.font ?? {}), bold: true }))
      if (l.kind === 'percent') row.getCell(1).font = { italic: true, color: { argb: 'FF6B5546' } }
    })
    for (let c = 1; c <= lastCol; c++) {
      ws.getRow(r('net_result')).getCell(c).border = { top: { style: 'thin', color: { argb: 'FFA9520F' } } }
    }
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }]

    // Gastos por categoría × mes
    type CatRow = ExpenseCategoryByMonth
    addSheet<CatRow>(wb, {
      name: PNL_SHEETS[1].name,
      title: 'Gastos por categoría, mes a mes',
      subtitle: sub,
      columns: [
        { header: 'Categoría', key: 'category', width: 34 },
        { header: 'Tipo', key: 'nature', value: (c) => natureLabel(c.nature), width: 10 },
        ...ms.map((m) => ({ header: monthHeader(m.month), key: m.month, type: 'money' as const, width: 14, value: (c: CatRow) => c.months[m.month] ?? 0 })),
        { header: 'Total', key: 'total', type: 'money', width: 16 },
      ],
      rows: d.expenses_by_category,
      notes: [
        'Cada fila es una categoría de gasto (fijo o variable) y cada columna, un mes. La fila TOTAL coincide con "Gastos fijos" + "Gastos variables" del estado de resultados.',
        'Si una categoría tiene gastos fijos y variables, aparece dos veces (una por cada tipo).',
      ],
    })
  }
}

const PRODUCT_SHEETS: SheetInfo[] = [
  {
    name: 'Rentabilidad por vino',
    what: 'Cada vino: botellas vendidas, ventas, costo, ganancia, margen, clase ABC, stock y días de stock. Incluye los vinos quietos.',
    why: 'Para saber qué vinos te hacen ganar plata, cuáles reponer primero y cuáles tienen plata parada.',
  },
  {
    name: 'Resumen ABC',
    what: 'Cuántos vinos hay en cada clase (A, B, C y quietos) y cuánto aportan.',
    why: 'Pocos vinos suelen dejar la mayor parte de la ganancia: cuidá que nunca falten.',
  },
]

const ABC_TEXT: Record<AbcClass | 'Q', string> = {
  A: 'A · Los que más dejan',
  B: 'B · Aportan',
  C: 'C · Aportan poco',
  Q: 'Quieto · No se vendió',
}

function writeProducts(p: ReportPeriod): Writer {
  return (wb) => {
    const rows = productsReport(p.from, p.to)
    const sub = periodSubtitle(p.from, p.to)
    addSheet<ProductReportRow>(wb, {
      name: PRODUCT_SHEETS[0].name,
      title: 'Rentabilidad por vino (análisis ABC)',
      subtitle: sub,
      columns: [
        { header: 'Vino', key: 'name', width: 32 },
        { header: 'Bodega', key: 'winery', value: (r) => r.winery ?? '', width: 20 },
        { header: 'Tipo', key: 'wine_type', value: (r) => wineTypeLabel(r.wine_type), width: 12 },
        { header: 'Clase', key: 'abc', value: (r) => (r.idle ? 'Quieto' : r.abc), width: 9 },
        { header: 'Botellas vendidas', key: 'bottles', type: 'int', width: 12 },
        { header: 'Ventas', key: 'revenue', type: 'money' },
        { header: 'Costo', key: 'cost', type: 'money' },
        { header: 'Ganancia bruta', key: 'profit', type: 'money' },
        { header: 'Margen', key: 'margin', type: 'percent', total: false, width: 10, value: (r) => (r.bottles > 0 ? r.margin : null) },
        { header: '% de la ganancia', key: 'share', type: 'percent', total: false, width: 12, value: (r) => (r.idle ? null : r.share) },
        { header: '% acumulado', key: 'cumulative_share', type: 'percent', total: false, width: 12, value: (r) => (r.idle ? null : r.cumulative_share) },
        { header: 'Stock (botellas)', key: 'stock', type: 'int', width: 11 },
        { header: 'Costo por botella', key: 'unit_cost', type: 'money', total: false },
        { header: 'Stock valorizado', key: 'stock_value', type: 'money' },
        { header: 'Días de stock', key: 'days_of_stock', type: 'int', total: false, width: 10 },
        { header: 'Última venta', key: 'last_sale', type: 'date' },
      ],
      rows,
      notes: [
        'Ventas = cantidad × precio de cada renglón (sin repartir descuentos ni envíos de la venta). Ganancia bruta = ventas − costo de esas botellas. Margen = ganancia ÷ ventas.',
        `Clase ABC: ordenamos los vinos de mayor a menor ganancia y vamos sumando. A = los que juntos llegan al ${ABC_LIMITS.A * 100} % de la ganancia (el primero siempre es A). B = hasta el ${ABC_LIMITS.B * 100} %. C = el resto y los que no dejaron ganancia.`,
        '"Quieto" = tiene stock pero no se vendió en el período: es plata parada en botellas (mirá la columna Stock valorizado).',
        'Días de stock = stock actual ÷ botellas vendidas por día en los últimos 90 días (igual que en Vinos y stock). Vacío = no se vendió en 90 días.',
        'Stock, costo por botella y días de stock son de hoy (no del período).',
      ],
    })
    const classes: (AbcClass | 'Q')[] = ['A', 'B', 'C', 'Q']
    const summary = classes.map((k) => {
      const rs = rows.filter((r) => (k === 'Q' ? r.idle : !r.idle && r.abc === k))
      const profit = rs.reduce((s, r) => s + r.profit, 0)
      return {
        clase: ABC_TEXT[k],
        count: rs.length,
        bottles: rs.reduce((s, r) => s + r.bottles, 0),
        revenue: round2(rs.reduce((s, r) => s + r.revenue, 0)),
        profit: round2(profit),
        share: rs.reduce((s, r) => s + (r.idle ? 0 : r.share), 0),
        stock_value: round2(rs.reduce((s, r) => s + r.stock_value, 0)),
      }
    })
    addSheet(wb, {
      name: PRODUCT_SHEETS[1].name,
      title: 'Resumen ABC',
      subtitle: sub,
      columns: [
        { header: 'Clase', key: 'clase', width: 28 },
        { header: 'Cantidad de vinos', key: 'count', type: 'int', width: 12 },
        { header: 'Botellas vendidas', key: 'bottles', type: 'int', width: 12 },
        { header: 'Ventas', key: 'revenue', type: 'money' },
        { header: 'Ganancia bruta', key: 'profit', type: 'money' },
        { header: '% de la ganancia', key: 'share', type: 'percent', total: true, width: 12 },
        { header: 'Stock valorizado', key: 'stock_value', type: 'money' },
      ],
      rows: summary,
      notes: [
        'Los vinos A son los que sostienen el negocio: que nunca falten y revisá su precio seguido.',
        'Los C y los quietos son candidatos a promo, a combo o a no recomprar. Mirá cuánta plata tenés parada en ellos (Stock valorizado).',
      ],
    })
  }
}

const CHANNEL_SHEETS: SheetInfo[] = [
  {
    name: 'Canales de venta',
    what: 'Ventas, ticket promedio, costo, comisiones y lo que te dejó cada canal (local, online, mayorista…).',
    why: 'No todos los canales dejan lo mismo: uno puede vender mucho y dejar poco.',
  },
  {
    name: 'Medios de cobro',
    what: 'Cuánto cobraste con cada medio (efectivo, transferencia, Mercado Pago…) y cuánto se quedó en comisiones.',
    why: 'Para ver cuánto te cuesta de verdad cada medio de cobro.',
  },
  {
    name: 'Días de la semana',
    what: 'Venta total y venta promedio de cada día de la semana.',
    why: 'Para decidir horarios, personal y cuándo hacer promociones.',
  },
]

function writeChannels(p: ReportPeriod): Writer {
  return (wb) => {
    const d = channelsReport(p.from, p.to)
    const sub = periodSubtitle(p.from, p.to)
    addSheet<ChannelRow>(wb, {
      name: CHANNEL_SHEETS[0].name,
      title: '¿De dónde vienen las ventas?',
      subtitle: sub,
      columns: [
        { header: 'Canal', key: 'label', width: 26 },
        { header: 'Ventas', key: 'sales', type: 'money' },
        { header: '% de las ventas', key: 'share', type: 'percent', total: true, width: 12 },
        { header: 'Cantidad de ventas', key: 'count', type: 'int', width: 12 },
        { header: 'Botellas', key: 'bottles', type: 'int', width: 10 },
        { header: 'Ticket promedio', key: 'avg_ticket', type: 'money', total: false },
        { header: 'Costo del vino', key: 'cost', type: 'money' },
        { header: 'Comisiones', key: 'fees', type: 'money' },
        { header: 'Lo que te dejó', key: 'profit', type: 'money' },
        { header: 'Margen', key: 'margin', type: 'percent', total: false, width: 10 },
      ],
      rows: d.channels,
      notes: [
        '"Lo que te dejó" = ventas − costo del vino − comisiones de cobro de ese canal, antes de los gastos generales (alquiler, sueldos…). Margen = lo que te dejó ÷ ventas.',
        'Ticket promedio = ventas ÷ cantidad de ventas: cuánto gasta en promedio cada cliente por compra en ese canal.',
      ],
    })
    addSheet<PaymentMethodRow>(wb, {
      name: CHANNEL_SHEETS[1].name,
      title: 'Medios de cobro y sus comisiones',
      subtitle: sub,
      columns: [
        { header: 'Medio de cobro', key: 'label', width: 26 },
        { header: 'Vendido con este medio', key: 'total', type: 'money', width: 18 },
        { header: '% de las ventas', key: 'share', type: 'percent', total: true, width: 12 },
        { header: 'Cantidad de ventas', key: 'count', type: 'int', width: 12 },
        { header: 'Comisiones', key: 'fees', type: 'money' },
        { header: 'Comisión real', key: 'fee_pct_effective', type: 'percent', total: false, width: 12 },
        { header: 'Comisión configurada', key: 'fee_pct_configured', type: 'percent', total: false, width: 13 },
      ],
      rows: d.payment_methods,
      notes: [
        'Comisión real = comisiones ÷ lo vendido con ese medio. Puede diferir de la configurada si en alguna venta cargaste la comisión a mano.',
        'Las comisiones son un costo: ya están restadas en el resultado. Si un medio te cobra mucho, pensá en un descuento por pagar en efectivo o transferencia.',
      ],
    })
    addSheet<WeekdayRow>(wb, {
      name: CHANNEL_SHEETS[2].name,
      title: '¿Qué días vendés más?',
      subtitle: sub,
      columns: [
        { header: 'Día', key: 'label', width: 14 },
        { header: 'Ventas', key: 'total', type: 'money' },
        { header: '% de las ventas', key: 'share', type: 'percent', total: true, width: 12 },
        { header: 'Cantidad de ventas', key: 'count', type: 'int', width: 12 },
        { header: 'Días en el período', key: 'days', type: 'int', width: 12 },
        { header: 'Venta promedio de ese día', key: 'avg_per_day', type: 'money', total: false, width: 18 },
      ],
      rows: d.weekdays,
      notes: ['Venta promedio = ventas de ese día de la semana ÷ cuántos de esos días tuvo el período (hasta hoy). Así no influye que un mes tenga 5 sábados y otro 4.'],
    })
  }
}

const CLIENT_SHEETS: SheetInfo[] = [
  {
    name: 'Clientes',
    what: 'Cuánto te compró cada cliente en el período, cuántas veces, cuántas botellas y cuándo fue su última compra. Al final, las ventas sin cliente.',
    why: 'Para cuidar a los que más compran y llamar a los que hace mucho no vuelven.',
  },
]

function writeClients(p: ReportPeriod): Writer {
  return (wb) => {
    const d = clientsReport(p.from, p.to)
    const rows: (Omit<ClientReportRow, 'client_id'> & { client_id: number | null })[] = [
      ...d.clients,
      ...(d.walk_in.count > 0
        ? [
            {
              client_id: null,
              name: 'Ventas sin cliente cargado (mostrador)',
              kind: 'consumidor',
              kind_label: '—',
              total: d.walk_in.total,
              count: d.walk_in.count,
              bottles: d.walk_in.bottles,
              profit: d.walk_in.profit,
              avg_ticket: round2(safeDiv(d.walk_in.total, d.walk_in.count)),
              share: d.walk_in.share,
              last_purchase: null,
            },
          ]
        : []),
    ]
    addSheet(wb, {
      name: CLIENT_SHEETS[0].name,
      title: '¿Quién te compra?',
      subtitle: periodSubtitle(p.from, p.to),
      columns: [
        { header: 'Cliente', key: 'name', width: 34 },
        { header: 'Tipo', key: 'kind_label', width: 22 },
        { header: 'Compró', key: 'total', type: 'money' },
        { header: '% de tus ventas', key: 'share', type: 'percent', total: true, width: 12 },
        { header: 'Compras', key: 'count', type: 'int', width: 10 },
        { header: 'Botellas', key: 'bottles', type: 'int', width: 10 },
        { header: 'Ticket promedio', key: 'avg_ticket', type: 'money', total: false },
        { header: 'Lo que te dejó', key: 'profit', type: 'money' },
        { header: 'Última compra', key: 'last_purchase', type: 'date', width: 13 },
      ],
      rows,
      notes: [
        '"Lo que te dejó" = lo que compró − costo del vino − comisiones de cobro (antes de los gastos generales).',
        'Última compra: la más reciente en toda la historia (no solo en el período). Si hace mucho que no vuelve, es un buen momento para escribirle.',
        d.walk_in.count > 0
          ? `La última fila son las ventas sin cliente cargado (las de mostrador, "consumidor final" en el ticket): ${Math.round(d.walk_in.share * 100)} % de tus ventas. Si cargás aunque sea el nombre, vas a saber quién vuelve.`
          : 'Todas las ventas del período tienen cliente cargado.',
      ],
    })
  }
}

const EXPENSE_SHEETS: SheetInfo[] = [
  {
    name: 'Gastos por categoría',
    what: 'Ranking de categorías de gasto con su total, su peso y el promedio por mes.',
    why: 'Para saber en qué se va la plata y dónde se puede recortar.',
  },
  {
    name: 'Gastos fijos y variables',
    what: 'Mes a mes: gastos fijos, variables y cuánto pesan sobre las ventas. Incluye el punto de equilibrio.',
    why: 'Con los fijos se calcula cuánto tenés que vender por mes para no perder plata.',
  },
]

function writeExpenses(p: ReportPeriod): Writer {
  return (wb) => {
    const d = expensesReport(p.from, p.to)
    const sub = periodSubtitle(p.from, p.to)
    type Cat = ExpensesReport['by_category'][number]
    addSheet<Cat>(wb, {
      name: EXPENSE_SHEETS[0].name,
      title: '¿En qué se va la plata?',
      subtitle: sub,
      columns: [
        { header: 'Categoría', key: 'category', width: 34 },
        { header: 'Tipo', key: 'nature', value: (c) => natureLabel(c.nature), width: 10 },
        { header: 'Total', key: 'total', type: 'money' },
        { header: '% de los gastos', key: 'share', type: 'percent', total: true, width: 12 },
        { header: 'Promedio por mes', key: 'monthly_avg', type: 'money' },
        { header: 'Cantidad de gastos', key: 'count', type: 'int', width: 12 },
      ],
      rows: d.by_category,
      notes: [
        `Promedio por mes = lo gastado en esa categoría en ${d.months_for_avg === 1 ? 'el mes' : `los ${d.months_for_avg} meses`}${d.months_for_avg < d.by_month.length ? ' completos (el mes en curso no cuenta: todavía pueden faltar gastos)' : ' del período'} ÷ ${d.months_for_avg}. Es el mismo criterio que "Gastos fijos promedio por mes".`,
        'Comprar vino no es un gasto (es stock) y los retiros de los dueños tampoco: por eso no aparecen acá.',
      ],
    })
    type Month = ExpensesReport['by_month'][number]
    addSheet<Month>(wb, {
      name: EXPENSE_SHEETS[1].name,
      title: 'Gastos fijos y variables, mes a mes',
      subtitle: sub,
      columns: [
        { header: 'Mes', key: 'label', value: (m) => (m.partial ? `${monthLabelLong(m.month)} (en curso)` : monthLabelLong(m.month)), width: 22 },
        { header: 'Gastos fijos', key: 'fixed', type: 'money' },
        { header: 'Gastos variables', key: 'variable', type: 'money' },
        { header: 'Total gastos', key: 'total', type: 'money' },
        { header: 'Ventas', key: 'sales', type: 'money' },
        { header: 'Gastos sobre ventas', key: 'pct_of_sales', type: 'percent', total: false, width: 12 },
      ],
      rows: d.by_month,
      notes: [
        `Gastos fijos promedio por mes: $ ${fmtNumber(d.fixed_avg)} (${d.months_for_avg} ${d.months_for_avg === 1 ? 'mes' : 'meses'}${d.by_month.some((m) => m.partial) && d.by_month.length > 1 ? ', sin contar el mes en curso' : ''}).`,
        `Gastos variables = ${fmtPct(d.variable_pct_of_sales)} de las ventas. Margen de contribución = ${fmtPct(d.contribution_margin)}: de cada $ 100 vendidos, quedan $ ${Math.round(d.contribution_margin * 100)} para pagar los fijos (después del vino, comisiones, mermas y gastos variables).`,
        d.break_even_monthly != null
          ? `Punto de equilibrio ≈ $ ${fmtNumber(d.break_even_monthly)} de ventas por mes (gastos fijos promedio ÷ margen de contribución). Vendiendo menos que eso, perdés plata.`
          : 'Punto de equilibrio: con los márgenes de este período no se llega a cubrir los gastos fijos (el margen de contribución no es positivo).',
      ],
    })
  }
}

const INFLATION_SHEETS: SheetInfo[] = [
  {
    name: 'Inflación',
    what: 'Ventas de cada mes como se registraron y llevadas a "pesos de hoy", con la inflación cargada y el crecimiento real.',
    why: 'En Argentina comparar pesos de meses distintos engaña: acá ves si vendés más de verdad.',
  },
]

function writeInflation(p: ReportPeriod): Writer {
  return (wb) => {
    const d = inflationReport(p.from, p.to)
    const ws = addSheet<InflationMonthRow>(wb, {
      name: INFLATION_SHEETS[0].name,
      title: d.base_month ? `Ventas en pesos de ${monthLabelLong(d.base_month)}` : 'Ventas ajustadas por inflación',
      subtitle: periodSubtitle(p.from, p.to),
      columns: [
        { header: 'Mes', key: 'label', value: (m) => (m.partial ? `${monthLabelLong(m.month)} (en curso)` : monthLabelLong(m.month)), width: 22 },
        { header: 'Ventas (pesos de ese mes)', key: 'sales', type: 'money', width: 18 },
        { header: 'Inflación del mes', key: 'rate', type: 'percent', total: false, width: 12, value: (m) => (m.rate == null ? null : m.rate / 100) },
        { header: 'Índice de precios', key: 'index', type: 'number', total: false, width: 12 },
        { header: 'Multiplicador', key: 'factor', type: 'number', total: false, width: 12 },
        { header: d.base_month ? `Ventas en pesos de ${monthLabelLong(d.base_month)}` : 'Ventas ajustadas', key: 'sales_today_pesos', type: 'money', width: 20 },
        { header: 'Crecimiento en pesos', key: 'nominal_growth_vs_prev', type: 'percent', total: false, width: 13 },
        { header: 'Crecimiento real', key: 'real_growth_vs_prev', type: 'percent', total: false, width: 13 },
      ],
      rows: d.months,
      notes: [
        d.explanation,
        'Índice de precios: 100 en el primer mes; cada mes se multiplica por (1 + inflación del mes). Multiplicador = índice del último mes ÷ índice de ese mes.',
        'Crecimiento en pesos y crecimiento real son contra el mes anterior (el mes en curso queda vacío porque todavía no terminó). Si el crecimiento real es negativo, vendiste menos "en cantidad de cosas" aunque los pesos hayan subido.',
        d.missing_months.length
          ? `Meses sin inflación cargada (se toman como 0 %): ${d.missing_months.map((m) => monthLabelLong(m)).join(', ')}. Cargalos en Reportes → Inflación.`
          : 'Todos los meses necesarios tienen la inflación cargada.',
      ],
    })
    // Más decimales donde importan: la inflación (2,25 %) y el multiplicador (1,2100).
    d.months.forEach((_, i) => {
      ws.getCell(5 + i, 3).numFmt = '0.0#%'
      ws.getCell(5 + i, 4).numFmt = '0.00'
      ws.getCell(5 + i, 5).numFmt = '0.0000'
    })
  }
}

const fmtNumber = (n: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n)
const fmtPct = (r: number) => `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(r * 100)} %`

async function sendWriters(res: Parameters<typeof sendWorkbookFile>[0], filename: string, writers: Writer[]) {
  const wb = newWorkbook()
  for (const w of writers) w(wb)
  await sendWorkbookFile(res, filename, wb)
}

const fileFor = (base: string, p: ReportPeriod) => excelFilename(`${base}-${p.from}-al-${p.to}`)

router.get('/reports/pnl/export', async (req, res) => {
  const p = reportPeriod(req)
  await sendWriters(res, fileFor('estado-de-resultados', p), [writePnl(p)])
})

router.get('/reports/products/export', async (req, res) => {
  const p = reportPeriod(req)
  await sendWriters(res, fileFor('rentabilidad-por-vino', p), [writeProducts(p)])
})

router.get('/reports/channels/export', async (req, res) => {
  const p = reportPeriod(req)
  await sendWriters(res, fileFor('canales-y-cobros', p), [writeChannels(p)])
})

router.get('/reports/clients/export', async (req, res) => {
  const p = reportPeriod(req)
  await sendWriters(res, fileFor('clientes', p), [writeClients(p)])
})

router.get('/reports/expenses/export', async (req, res) => {
  const p = reportPeriod(req)
  await sendWriters(res, fileFor('gastos', p), [writeExpenses(p)])
})

router.get('/reports/inflation/export', async (req, res) => {
  const p = reportPeriod(req)
  await sendWriters(res, fileFor('inflacion', p), [writeInflation(p)])
})

/** Todas las hojas en un solo archivo, con un "Índice" al principio que explica cada una. */
export const FULL_EXPORT_SHEETS: SheetInfo[] = [...PNL_SHEETS, ...PRODUCT_SHEETS, ...CHANNEL_SHEETS, ...CLIENT_SHEETS, ...EXPENSE_SHEETS, ...INFLATION_SHEETS]

router.get('/reports/full/export', async (req, res) => {
  const p = reportPeriod(req)
  const writeIndex: Writer = (wb) => {
    const ws = addSheet<SheetInfo>(wb, {
      name: 'Índice',
      title: 'Reporte completo · Índice',
      subtitle: periodSubtitle(p.from, p.to),
      columns: [
        { header: 'Hoja', key: 'name', width: 30 },
        { header: 'Qué vas a encontrar', key: 'what', width: 70 },
        { header: 'Para qué te sirve', key: 'why', width: 60 },
      ],
      rows: FULL_EXPORT_SHEETS,
      totals: false,
      notes: [
        'Hacé clic en el nombre de una hoja para ir directo, o usá las pestañas de abajo.',
        'Son los mismos números que ves en la pantalla Reportes del sistema, calculados con el mismo motor que Inicio y Metas.',
        'Criterio "devengado": cada venta y cada gasto cuentan en su fecha, aunque se cobren o paguen después. Por eso el resultado no coincide con la plata de la caja.',
        p.trimmed
          ? `Pediste del ${fmtDate(p.requested.from)} al ${fmtDate(p.requested.to)}; mostramos solo los meses con movimiento (${fmtDate(p.from)} al ${fmtDate(p.to)}).`
          : 'Montos en pesos, con impuestos incluidos (lo que dice el ticket o la factura).',
      ],
    })
    FULL_EXPORT_SHEETS.forEach((s, i) => {
      const cell = ws.getCell(5 + i, 1)
      // HYPERLINK("#'Hoja'!A1") es la forma que entienden Excel, LibreOffice y Google Sheets.
      cell.value = { formula: `HYPERLINK("#'${s.name}'!A1","${s.name}")`, result: s.name }
      cell.font = { color: { argb: 'FF2E74AD' }, underline: true, bold: true }
    })
    for (let i = 0; i < FULL_EXPORT_SHEETS.length; i++) {
      ws.getRow(5 + i).alignment = { wrapText: true, vertical: 'top' }
    }
  }
  await sendWriters(res, fileFor('reporte-completo', p), [writeIndex, writePnl(p), writeProducts(p), writeChannels(p), writeClients(p), writeExpenses(p), writeInflation(p)])
})

export default router
