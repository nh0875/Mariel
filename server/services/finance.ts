// Motor de números: todas las pantallas (Inicio, Reportes, Metas, Calculadora) usan estas
// funciones, así un mismo número da igual en todos lados.
//
// Criterio: "devengado" para el resultado (una venta cuenta el día que se hizo, aunque se cobre
// después; un gasto cuenta en su fecha, aunque se pague después) y "percibido" para la caja
// (la plata que efectivamente entró y salió). Por eso RESULTADO ≠ CAJA, y está bien que así sea.
//
// Resultado del período =
//     Ventas
//   − Costo de las botellas vendidas (CMV)
//   = Ganancia bruta
//   − Comisiones de cobro (Mercado Pago, tarjetas)
//   − Mermas (roturas, degustaciones, regalos, faltantes) valorizadas al costo
//   − Gastos (fijos + variables)
//   = Resultado (ganancia o pérdida)
import { all, get } from '../db'
import { round2, safeDiv } from '../../shared/calc'
import { SHRINKAGE_KINDS } from '../../shared/constants'
import { monthLabel, monthsBetween, today } from '../../shared/dates'
import type { MonthlyPoint, PeriodSummary } from '../../shared/types'

type Agg = Omit<PeriodSummary, 'from' | 'to'>

function emptyAgg(): Agg {
  return {
    sales: 0,
    sales_count: 0,
    bottles_sold: 0,
    cogs: 0,
    gross_profit: 0,
    gross_margin: 0,
    fees: 0,
    shrinkage: 0,
    expenses: 0,
    expenses_fixed: 0,
    expenses_variable: 0,
    net_result: 0,
    net_margin: 0,
    avg_ticket: 0,
    cash_in: 0,
    cash_out: 0,
    purchases: 0,
  }
}

function finish(a: Agg): Agg {
  const sales = round2(a.sales)
  const cogs = round2(a.cogs)
  const gross = round2(sales - cogs)
  const net = round2(gross - a.fees - a.shrinkage - a.expenses)
  return {
    ...a,
    sales,
    cogs,
    fees: round2(a.fees),
    shrinkage: round2(a.shrinkage),
    expenses: round2(a.expenses),
    expenses_fixed: round2(a.expenses_fixed),
    expenses_variable: round2(a.expenses_variable),
    cash_in: round2(a.cash_in),
    cash_out: round2(a.cash_out),
    purchases: round2(a.purchases),
    gross_profit: gross,
    gross_margin: safeDiv(gross, sales),
    net_result: net,
    net_margin: safeDiv(net, sales),
    avg_ticket: round2(safeDiv(sales, a.sales_count)),
  }
}

/**
 * Calcula los agregados agrupados por mes ('YYYY-MM') o todo junto ('all').
 */
function aggregate(from: string, to: string, group: 'month' | 'all'): Map<string, Agg> {
  const key = (col: string) => (group === 'month' ? `substr(${col}, 1, 7)` : `'all'`)
  const out = new Map<string, Agg>()
  const bucket = (k: string) => {
    if (!out.has(k)) out.set(k, emptyAgg())
    return out.get(k)!
  }
  const p = [from, to]

  for (const r of all<{ k: string; sales: number; n: number; fees: number }>(
    `SELECT ${key('date')} AS k, SUM(total) AS sales, COUNT(*) AS n, SUM(fee) AS fees FROM sales WHERE date BETWEEN ? AND ? GROUP BY k`,
    p,
  )) {
    const b = bucket(r.k)
    b.sales += r.sales || 0
    b.sales_count += r.n || 0
    b.fees += r.fees || 0
  }

  for (const r of all<{ k: string; bottles: number; cogs: number }>(
    `SELECT ${key('s.date')} AS k,
       SUM(CASE WHEN si.product_id IS NOT NULL THEN si.qty ELSE 0 END) AS bottles,
       SUM(si.qty * si.unit_cost) AS cogs
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.date BETWEEN ? AND ? GROUP BY k`,
    p,
  )) {
    const b = bucket(r.k)
    b.bottles_sold += r.bottles || 0
    b.cogs += r.cogs || 0
  }

  const kinds = SHRINKAGE_KINDS.map((k) => `'${k}'`).join(',')
  for (const r of all<{ k: string; v: number }>(
    `SELECT ${key('date')} AS k, -SUM(qty * unit_cost) AS v FROM stock_movements
     WHERE kind IN (${kinds}) AND date BETWEEN ? AND ? GROUP BY k`,
    p,
  )) {
    bucket(r.k).shrinkage += r.v || 0
  }

  for (const r of all<{ k: string; total: number; fixed: number; variable: number }>(
    `SELECT ${key('date')} AS k, SUM(amount) AS total,
       SUM(CASE WHEN nature = 'fijo' THEN amount ELSE 0 END) AS fixed,
       SUM(CASE WHEN nature <> 'fijo' THEN amount ELSE 0 END) AS variable
     FROM expenses WHERE date BETWEEN ? AND ? GROUP BY k`,
    p,
  )) {
    const b = bucket(r.k)
    b.expenses += r.total || 0
    b.expenses_fixed += r.fixed || 0
    b.expenses_variable += r.variable || 0
  }

  for (const r of all<{ k: string; cin: number; cout: number }>(
    `SELECT ${key('date')} AS k,
       SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END) AS cin,
       SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END) AS cout
     FROM payments WHERE ref_type <> 'transfer' AND date BETWEEN ? AND ? GROUP BY k`,
    p,
  )) {
    const b = bucket(r.k)
    b.cash_in += r.cin || 0
    b.cash_out += r.cout || 0
  }

  for (const r of all<{ k: string; v: number }>(
    `SELECT ${key('date')} AS k, SUM(total) AS v FROM purchases WHERE date BETWEEN ? AND ? GROUP BY k`,
    p,
  )) {
    bucket(r.k).purchases += r.v || 0
  }

  return out
}

/** Resumen económico de un período (from y to inclusive). */
export function periodSummary(from: string, to: string): PeriodSummary {
  const agg = aggregate(from, to, 'all').get('all') ?? emptyAgg()
  return { from, to, ...finish(agg) }
}

/** Un punto por mes entre from y to (los meses sin movimiento vienen en 0). */
export function monthlySeries(from: string, to: string): MonthlyPoint[] {
  const map = aggregate(from, to, 'month')
  return monthsBetween(from, to).map((m) => {
    const lastDay = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()
    const mFrom = `${m}-01` < from ? from : `${m}-01`
    const mTo = `${m}-${String(lastDay).padStart(2, '0')}` > to ? to : `${m}-${String(lastDay).padStart(2, '0')}`
    return { month: m, label: monthLabel(m), from: mFrom, to: mTo, ...finish(map.get(m) ?? emptyAgg()) }
  })
}

/** Valor del stock al costo (lo que "tenés invertido en botellas"). */
export function stockValue(): { value: number; bottles: number; products: number } {
  const r = get<{ value: number; bottles: number; products: number }>(
    `SELECT COALESCE(SUM(stock * unit_cost), 0) AS value, COALESCE(SUM(stock), 0) AS bottles, COUNT(*) AS products
     FROM products WHERE stock > 0`,
  )
  return { value: round2(r?.value ?? 0), bottles: r?.bottles ?? 0, products: r?.products ?? 0 }
}

/** Lo que te deben los clientes (ventas no cobradas). */
export function receivables(): { total: number; count: number; overdue: number } {
  const t = today()
  const r = get<{ total: number; count: number; overdue: number }>(
    `WITH x AS (
       SELECT s.total - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.ref_type = 'sale' AND p.ref_id = s.id), 0) AS bal, s.due_date
       FROM sales s
     )
     SELECT COALESCE(SUM(bal), 0) AS total, COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN bal ELSE 0 END), 0) AS overdue
     FROM x WHERE bal > 0.01`,
    [t],
  )
  return { total: round2(r?.total ?? 0), count: r?.count ?? 0, overdue: round2(r?.overdue ?? 0) }
}

/** Lo que le debés a proveedores y gastos sin pagar. */
export function payables(): { total: number; count: number; overdue: number; purchases: number; expenses: number } {
  const t = today()
  const r = get<{ total: number; count: number; overdue: number; purchases: number; expenses: number }>(
    `WITH x AS (
       SELECT 'purchase' AS t, pu.total - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.ref_type = 'purchase' AND p.ref_id = pu.id), 0) AS bal, pu.due_date
       FROM purchases pu
       UNION ALL
       SELECT 'expense' AS t, ex.amount - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.ref_type = 'expense' AND p.ref_id = ex.id), 0) AS bal, ex.due_date
       FROM expenses ex
     )
     SELECT COALESCE(SUM(bal), 0) AS total, COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN bal ELSE 0 END), 0) AS overdue,
            COALESCE(SUM(CASE WHEN t = 'purchase' THEN bal ELSE 0 END), 0) AS purchases,
            COALESCE(SUM(CASE WHEN t = 'expense' THEN bal ELSE 0 END), 0) AS expenses
     FROM x WHERE bal > 0.01`,
    [t],
  )
  return {
    total: round2(r?.total ?? 0),
    count: r?.count ?? 0,
    overdue: round2(r?.overdue ?? 0),
    purchases: round2(r?.purchases ?? 0),
    expenses: round2(r?.expenses ?? 0),
  }
}

export interface ProductSales {
  product_id: number
  name: string
  winery: string | null
  wine_type: string
  bottles: number
  revenue: number
  cost: number
  profit: number
  margin: number
}

/**
 * Ventas por vino en un período. El "revenue" es lo facturado por renglón (cantidad × precio),
 * sin prorratear descuentos ni envíos de la venta.
 */
export function salesByProduct(from: string, to: string): ProductSales[] {
  return all<Omit<ProductSales, 'profit' | 'margin'>>(
    `SELECT p.id AS product_id, p.name, p.winery, p.wine_type,
       SUM(si.qty) AS bottles, SUM(si.qty * si.unit_price) AS revenue, SUM(si.qty * si.unit_cost) AS cost
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     WHERE s.date BETWEEN ? AND ?
     GROUP BY p.id
     ORDER BY revenue DESC`,
    [from, to],
  ).map((r) => ({
    ...r,
    revenue: round2(r.revenue),
    cost: round2(r.cost),
    profit: round2(r.revenue - r.cost),
    margin: safeDiv(r.revenue - r.cost, r.revenue),
  }))
}

export interface ChannelSales {
  channel: string
  sales: number
  count: number
  cost: number
  fees: number
  profit: number
}

/** Ventas por canal (local, online, mayorista…). profit = ventas − CMV − comisiones. */
export function salesByChannel(from: string, to: string): ChannelSales[] {
  return all<{ channel: string; sales: number; count: number; fees: number; cost: number }>(
    `SELECT s.channel, SUM(s.total) AS sales, COUNT(*) AS count, SUM(s.fee) AS fees,
       SUM((SELECT COALESCE(SUM(si.qty * si.unit_cost), 0) FROM sale_items si WHERE si.sale_id = s.id)) AS cost
     FROM sales s WHERE s.date BETWEEN ? AND ?
     GROUP BY s.channel ORDER BY sales DESC`,
    [from, to],
  ).map((r) => ({
    channel: r.channel,
    sales: round2(r.sales),
    count: r.count,
    cost: round2(r.cost),
    fees: round2(r.fees),
    profit: round2(r.sales - r.cost - r.fees),
  }))
}

/** Gastos por categoría en un período. */
export function expensesByCategory(from: string, to: string): { category: string; nature: string; amount: number; count: number }[] {
  return all<{ category: string; nature: string; amount: number; count: number }>(
    `SELECT category, MAX(nature) AS nature, SUM(amount) AS amount, COUNT(*) AS count
     FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC`,
    [from, to],
  ).map((r) => ({ ...r, amount: round2(r.amount) }))
}

/** Vinos activos con stock en o por debajo del mínimo. */
export function lowStock(): { id: number; name: string; stock: number; min_stock: number; winery: string | null }[] {
  return all(
    `SELECT id, name, stock, min_stock, winery FROM products WHERE active = 1 AND stock <= min_stock ORDER BY (stock - min_stock), name`,
  )
}
