// Calculadora: los números del negocio para precargar las herramientas de precios y equilibrio,
// y la revisión de precios de todo el catálogo (con Excel).
//
// GET /calculator/context        → CalculatorContext (ver shared/pricing.ts)
// GET /calculator/prices         → PriceReviewRow[] con el margen deseado (params opcionales)
// GET /calculator/prices/export  → lo mismo en Excel
//
// Los promedios salen de los últimos 3 meses COMPLETOS (el mes en curso no cuenta: a medio terminar
// engaña) y se calculan con monthlySeries() de services/finance.ts, el mismo motor de Inicio,
// Reportes y Metas. Así el "resultado promedio" de la calculadora es el mismo que ves en Reportes.
import { Router, type Request } from 'express'
import { all } from '../db'
import { HttpError, qn } from '../lib/http'
import { excelFilename, sendWorkbook } from '../lib/excel'
import { monthlySeries } from '../services/finance'
import { getSettings } from '../services/settings'
import { round2, safeDiv } from '../../shared/calc'
import { addMonths, endOfMonth, startOfMonth, today } from '../../shared/dates'
import {
  reviewPrices,
  type CalculatorContext,
  type CalculatorProduct,
  type PriceReviewParams,
  type PriceReviewRow,
  type PriceReviewStatus,
} from '../../shared/pricing'

const router = Router()

/** Los últimos 3 meses completos antes del mes de `ref` (ej: ref 15/10 → julio, agosto, septiembre). */
export function contextWindow(ref: string = today()): { from: string; to: string } {
  const lastFull = addMonths(startOfMonth(ref), -1)
  return { from: addMonths(lastFull, -2), to: endOfMonth(lastFull) }
}

function activeProducts(): CalculatorProduct[] {
  return all<CalculatorProduct>(
    `SELECT id, name, winery, vintage, unit_cost, price_retail, price_wholesale, units_per_box
     FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE, id`,
  ).map((p) => ({ ...p, unit_cost: round2(p.unit_cost) }))
}

/** Arma el contexto de la calculadora. `ref` = "hoy" (se puede pasar otra fecha en los tests). */
export function calculatorContext(ref: string = today()): CalculatorContext {
  const s = getSettings()
  const { from, to } = contextWindow(ref)
  // Solo cuentan los meses con movimiento: si el negocio arrancó hace un mes, promediar
  // con dos meses vacíos daría números falsamente bajos.
  const months = monthlySeries(from, to).filter((m) => m.sales > 0 || m.expenses > 0)
  const count = months.length
  const sum = (f: (m: (typeof months)[number]) => number) => months.reduce((acc, m) => acc + f(m), 0)
  const sales = sum((m) => m.sales)
  const bottles = sum((m) => m.bottles_sold)
  const cogs = sum((m) => m.cogs)
  const fees = sum((m) => m.fees)
  const shrinkage = sum((m) => m.shrinkage)
  const fixed = sum((m) => m.expenses_fixed)
  const variable = sum((m) => m.expenses_variable)
  const net = sum((m) => m.net_result)
  const avg = (v: number) => (count ? round2(v / count) : 0)

  // Los meses sin movimiento no tienen gastos, así que sumar toda la ventana es lo mismo que
  // sumar solo los meses usados.
  const fixedByCategory = count
    ? all<{ category: string; amount: number }>(
        `SELECT category, SUM(amount) AS amount FROM expenses
         WHERE nature = 'fijo' AND date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC, category`,
        [from, to],
      ).map((r) => ({ category: r.category, avg: round2(r.amount / count) }))
    : []

  return {
    has_data: sales > 0,
    months_used: months.map((m) => m.month),
    avg_sales: avg(sales),
    avg_bottles: count ? Math.round(bottles / count) : 0,
    avg_price_per_bottle: round2(safeDiv(sales, bottles)),
    avg_cost_per_bottle: round2(safeDiv(cogs, bottles)),
    avg_fixed_expenses: avg(fixed),
    avg_variable_expenses: avg(variable),
    avg_fees: avg(fees),
    avg_shrinkage: avg(shrinkage),
    avg_fee_pct: round2(safeDiv(fees, sales) * 100),
    variable_pct_of_sales: round2(safeDiv(fees + shrinkage + variable, sales) * 100),
    gross_margin: safeDiv(sales - cogs, sales),
    avg_net_result: avg(net),
    fixed_by_category: fixedByCategory,
    pricing: {
      target_margin_pct: s.pricing.target_margin_pct,
      iibb_pct: s.pricing.iibb_pct,
      iva_pct: s.pricing.iva_pct,
      wholesale_discount_pct: s.pricing.wholesale_discount_pct,
    },
    usd_rate: s.usd_rate,
    usd_rate_date: s.usd_rate_date,
    payment_methods: s.payment_methods.map((m) => ({ key: m.key, label: m.label, fee_pct: m.fee_pct })),
    units_per_box: s.defaults.units_per_box,
    products: activeProducts(),
  }
}

/** Lee un % de la query con valor por defecto y rango; si es inválido, 400 con mensaje claro. */
function pctParam(req: Request, key: string, label: string, def: number, max: number): number {
  const raw = (req.query as Record<string, unknown>)[key]
  if (raw === undefined || raw === '') return def
  const v = qn(req, key)
  if (v == null || v < 0 || v > max) throw new HttpError(400, `Revisá estos datos → ${label}: tiene que ser un número entre 0 y ${max}`)
  return v
}

function reviewParams(req: Request): PriceReviewParams {
  const s = getSettings()
  const p: PriceReviewParams = {
    target_margin_pct: pctParam(req, 'target_margin_pct', 'Margen deseado', s.pricing.target_margin_pct, 95),
    iibb_pct: pctParam(req, 'iibb_pct', 'Ingresos Brutos', s.pricing.iibb_pct, 20),
    fee_pct: pctParam(req, 'fee_pct', 'Comisión', 0, 50),
    round_to: pctParam(req, 'round_to', 'Redondeo', 0, 100000),
    wholesale_discount_pct: pctParam(req, 'wholesale_discount_pct', 'Descuento mayorista', s.pricing.wholesale_discount_pct, 90),
  }
  if (p.target_margin_pct + p.iibb_pct + p.fee_pct >= 100) {
    throw new HttpError(400, 'Margen + Ingresos Brutos + comisión suman 100 % o más: no queda nada para pagar el vino. Bajá el margen deseado.')
  }
  return p
}

router.get('/calculator/context', (_req, res) => {
  res.json(calculatorContext())
})

router.get('/calculator/prices', (req, res) => {
  res.json(reviewPrices(activeProducts(), reviewParams(req)))
})

const STATUS_LABEL: Record<PriceReviewStatus, string> = {
  ok: 'Llega al margen',
  debajo: 'Por debajo del margen',
  sin_precio: 'Sin precio cargado',
  sin_costo: 'Sin costo cargado',
}

const nf = (v: number, d = 2) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: d }).format(v)

router.get('/calculator/prices/export', async (req, res) => {
  const p = reviewParams(req)
  const rows = reviewPrices(activeProducts(), p)
  const below = rows.filter((r) => r.status === 'debajo').length
  await sendWorkbook(res, excelFilename('revision-de-precios'), [
    {
      name: 'Revisión de precios',
      title: 'Revisión de precios con la calculadora',
      subtitle: `Margen deseado ${nf(p.target_margin_pct)} % · IIBB ${nf(p.iibb_pct)} % · comisión ${nf(p.fee_pct)} %${p.round_to ? ` · redondeo a $ ${nf(p.round_to, 0)}` : ''}`,
      totals: false,
      columns: [
        { header: 'Vino', key: 'name', width: 34 },
        { header: 'Bodega', key: 'winery', width: 22 },
        { header: 'Costo por botella', key: 'cost', type: 'money', total: false },
        { header: 'Precio minorista actual', key: 'price_retail', type: 'money', total: false },
        { header: 'Margen actual', key: 'margin_retail', type: 'percent', value: (r: PriceReviewRow) => (r.price_retail > 0 ? r.margin_retail : null) },
        { header: 'Semáforo', key: 'verdict', value: (r: PriceReviewRow) => (r.price_retail > 0 ? r.verdict.label : '—'), width: 16 },
        { header: 'Precio minorista sugerido', key: 'suggested_retail', type: 'money', total: false },
        { header: 'Diferencia', key: 'diff_retail', type: 'money', total: false },
        { header: 'Diferencia %', key: 'diff_retail_pct', type: 'percent' },
        { header: 'Precio mayorista actual', key: 'price_wholesale', type: 'money', total: false },
        { header: 'Margen mayorista', key: 'margin_wholesale', type: 'percent', value: (r: PriceReviewRow) => (r.price_wholesale > 0 ? r.margin_wholesale : null) },
        { header: 'Mayorista sugerido', key: 'suggested_wholesale', type: 'money', total: false },
        { header: 'Estado', key: 'status', value: (r: PriceReviewRow) => STATUS_LABEL[r.status], width: 22 },
      ],
      rows,
      notes: [
        `Compara el precio de cada vino activo con el que tendría para dejarte un margen del ${nf(p.target_margin_pct)} % después de pagar Ingresos Brutos (${nf(p.iibb_pct)} %) y la comisión del medio de pago (${nf(p.fee_pct)} %).`,
        'Precio sugerido = costo por botella ÷ (1 − margen − IIBB − comisión), redondeado hacia arriba. El costo es el costo promedio actual de cada vino (ya incluye el flete de las compras).',
        'Margen actual = (precio − costo − IIBB − comisión) ÷ precio. Semáforo: "Margen sano" desde 35 %, "Justo" entre 25 % y 35 %, "Margen bajo" por debajo de 25 %.',
        `Diferencia positiva = el precio actual está por debajo del sugerido (te conviene subirlo). Hay ${below} ${below === 1 ? 'vino' : 'vinos'} por debajo del margen deseado.`,
        `El mayorista sugerido es el minorista sugerido con ${nf(p.wholesale_discount_pct)} % de descuento (Configuración → Precios).`,
        'Esta planilla es una simulación: no cambia ningún precio. Para cambiarlos usá «Usar este precio» en la Calculadora o «Vinos y stock».',
      ],
    },
  ])
})

export default router
