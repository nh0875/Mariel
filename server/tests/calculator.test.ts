// Tests de la API de la Calculadora: contexto con promedios de los últimos 3 meses completos
// (y su coherencia con el motor de finanzas, el simulador y Metas), base vacía, revisión de
// precios del catálogo (JSON + Excel) y el flujo "Usar este precio" (PUT /products/:id).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { run } from '../db'
import { addMovement } from '../services/stock'
import { createSale } from '../services/sales'
import { createExpense } from '../services/expenses'
import { monthlySeries } from '../services/finance'
import { updateSettings } from '../services/settings'
import { contextWindow } from '../routes/calculator'
import { expenseInput, saleInput } from '../../shared/schemas'
import { addMonths, endOfMonth, monthKey, startOfMonth, today } from '../../shared/dates'
import { breakEven, simulate, suggestPrice, variableCostPerBottle, type CalculatorContext } from '../../shared/pricing'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

/** Vino con stock inicial (directo en la base, no depende del módulo Vinos). */
function wine(name: string, opts: { stock?: number; cost?: number; retail?: number; wholesale?: number; active?: boolean } = {}) {
  const { stock = 1000, cost = 6000, retail = 10000, wholesale = 8000, active = true } = opts
  const id = run('INSERT INTO products (name, winery, price_retail, price_wholesale, active) VALUES (?, ?, ?, ?, ?)', [name, 'Bodega Test', retail, wholesale, active]).lastInsertRowid
  if (stock || cost) addMovement({ product_id: id, date: '2023-01-01', kind: 'inicial', qty: stock, unit_cost: cost })
  return id
}
const sale = (date: string, productId: number, qty: number, price: number, payment_method: 'efectivo' | 'mercadopago' = 'efectivo') =>
  createSale(saleInput.parse({ date, payment_method, items: [{ product_id: productId, qty, unit_price: price }] }))
const expense = (date: string, amount: number, nature: 'fijo' | 'variable', category = 'Alquiler') =>
  createExpense(expenseInput.parse({ date, category, description: category, amount, nature }))

/** Día 10 del mes que está `offset` meses antes del actual. */
const monthDay = (offset: number) => addMonths(startOfMonth(today()), offset).slice(0, 8) + '10'

describe('GET /calculator/context', () => {
  it('con la base vacía devuelve ceros, has_data:false y la configuración', async () => {
    const r = await t.get<CalculatorContext>('/calculator/context')
    expect(r.status).toBe(200)
    const c = r.body
    expect(c.has_data).toBe(false)
    expect(c.months_used).toEqual([])
    for (const k of [
      'avg_sales',
      'avg_bottles',
      'avg_price_per_bottle',
      'avg_cost_per_bottle',
      'avg_fixed_expenses',
      'avg_variable_expenses',
      'avg_fees',
      'avg_shrinkage',
      'avg_fee_pct',
      'variable_pct_of_sales',
      'gross_margin',
      'avg_net_result',
    ] as const) {
      expect(c[k], k).toBe(0)
    }
    expect(c.fixed_by_category).toEqual([])
    expect(c.products).toEqual([])
    expect(c.pricing).toEqual({ target_margin_pct: 40, iibb_pct: 3.5, iva_pct: 21, wholesale_discount_pct: 20 })
    expect(c.usd_rate).toBe(0)
    expect(c.units_per_box).toBe(6)
    expect(c.payment_methods.find((m) => m.key === 'mercadopago')).toEqual({ key: 'mercadopago', label: 'Mercado Pago / QR', fee_pct: 6.29 })
    expect(c.payment_methods).toHaveLength(6)
  })

  it('promedia los últimos 3 meses completos (sin el mes en curso) con el motor de finanzas', async () => {
    const p = wine('Malbec Reserva')
    // 3 meses completos: −3, −2, −1
    sale(monthDay(-3), p, 10, 10000)
    expense(monthDay(-3), 50000, 'fijo', 'Alquiler')
    expense(monthDay(-3), 5000, 'variable', 'Envíos y logística')
    sale(monthDay(-2), p, 20, 10000, 'mercadopago') // comisión 6,29 % = 12.580
    expense(monthDay(-2), 50000, 'fijo', 'Alquiler')
    expense(monthDay(-2), 30000, 'fijo', 'Sueldos y cargas sociales')
    expense(monthDay(-1), 50000, 'fijo', 'Alquiler') // mes sin ventas pero con gastos: cuenta
    addMovement({ product_id: p, date: monthDay(-1), kind: 'rotura', qty: -1 }) // merma $6.000
    // Fuera de la ventana: no cuentan
    sale(monthDay(-4), p, 100, 10000)
    expense(monthDay(-4), 999999, 'fijo')
    sale(today(), p, 50, 10000)
    expense(today(), 777777, 'fijo')

    const r = await t.get<CalculatorContext>('/calculator/context')
    expect(r.status).toBe(200)
    const c = r.body
    const w = contextWindow()
    expect(c.months_used).toEqual([monthKey(monthDay(-3)), monthKey(monthDay(-2)), monthKey(monthDay(-1))])
    expect(c.months_used).not.toContain(monthKey(today()))
    expect(w.to).toBe(endOfMonth(monthDay(-1)))
    expect(c.has_data).toBe(true)
    // Ventas 300.000 / 3 meses; 30 botellas / 3
    expect(c.avg_sales).toBe(100000)
    expect(c.avg_bottles).toBe(10)
    expect(c.avg_price_per_bottle).toBe(10000)
    expect(c.avg_cost_per_bottle).toBe(6000)
    expect(c.gross_margin).toBeCloseTo(0.4, 6)
    // Fijos 180.000 / 3; variables 5.000 / 3
    expect(c.avg_fixed_expenses).toBe(60000)
    expect(c.avg_variable_expenses).toBe(1666.67)
    expect(c.avg_fees).toBe(4193.33)
    expect(c.avg_shrinkage).toBe(2000)
    expect(c.avg_fee_pct).toBe(4.19)
    // (12.580 + 6.000 + 5.000) / 300.000 = 7,86 %
    expect(c.variable_pct_of_sales).toBe(7.86)
    // Resultado: 300.000 − 180.000 − 12.580 − 6.000 − 185.000 = −83.580 → −27.860 por mes
    expect(c.avg_net_result).toBe(-27860)
    expect(c.fixed_by_category).toEqual([
      { category: 'Alquiler', avg: 50000 },
      { category: 'Sueldos y cargas sociales', avg: 10000 },
    ])

    // Coherencia: es el mismo número que el motor de finanzas (Reportes/Inicio).
    const series = monthlySeries(w.from, w.to)
    expect(c.avg_net_result).toBeCloseTo(series.reduce((s, m) => s + m.net_result, 0) / 3, 2)

    // Coherencia: el simulador sin cambios reproduce el resultado promedio real.
    const sim = simulate({
      base: { bottles: c.avg_bottles, avg_price: c.avg_price_per_bottle, avg_cost: c.avg_cost_per_bottle, fixed: c.avg_fixed_expenses, variable_pct: c.variable_pct_of_sales },
    })
    expect(sim.before.result).toBeCloseTo(c.avg_net_result, 0)

    // Coherencia: el punto de equilibrio da lo mismo que la sugerencia de Metas.
    const be = breakEven({
      fixed_costs: c.avg_fixed_expenses,
      avg_price: c.avg_price_per_bottle,
      avg_variable_cost_per_bottle: variableCostPerBottle(c.avg_price_per_bottle, c.avg_cost_per_bottle, c.variable_pct_of_sales),
    })
    expect(be.ok).toBe(true)
    // 60.000 ÷ (10.000 − 6.000 − 786) = 18,67 → 19 botellas
    expect(be.bottles).toBe(19)
    const goal = await t.get(`/goals/suggest?month=${monthKey(today())}`)
    expect(goal.status).toBe(200)
    if (typeof goal.body?.break_even_sales === 'number') {
      expect(be.sales).toBeCloseTo(goal.body.break_even_sales, 0)
    }
  })

  it('si el negocio arrancó hace poco, promedia solo los meses con movimiento', async () => {
    const p = wine('Torrontés')
    sale(monthDay(-1), p, 12, 9000)
    expense(monthDay(-1), 40000, 'fijo')
    const c = (await t.get<CalculatorContext>('/calculator/context')).body
    expect(c.months_used).toEqual([monthKey(monthDay(-1))])
    expect(c.avg_sales).toBe(108000)
    expect(c.avg_bottles).toBe(12)
    expect(c.avg_fixed_expenses).toBe(40000)
  })

  it('con gastos pero sin ventas: has_data false, pero informa los fijos', async () => {
    expense(monthDay(-2), 90000, 'fijo')
    const c = (await t.get<CalculatorContext>('/calculator/context')).body
    expect(c.has_data).toBe(false)
    expect(c.months_used).toHaveLength(1)
    expect(c.avg_fixed_expenses).toBe(90000)
    expect(c.avg_price_per_bottle).toBe(0)
    expect(c.variable_pct_of_sales).toBe(0)
  })

  it('lista solo los vinos activos, ordenados, con costo y precios; y usa la configuración guardada', async () => {
    wine('Zeta Blend', { cost: 5000, retail: 9000 })
    wine('alfa Malbec', { cost: 7000, retail: 12000, wholesale: 9600 })
    wine('Viejo (inactivo)', { active: false })
    updateSettings({ usd_rate: 1250, usd_rate_date: '2026-09-30', pricing: { target_margin_pct: 45, wholesale_discount_pct: 15, iva_pct: 21, iibb_pct: 4 } })
    const c = (await t.get<CalculatorContext>('/calculator/context')).body
    expect(c.products.map((p) => p.name)).toEqual(['alfa Malbec', 'Zeta Blend'])
    expect(c.products[0]).toMatchObject({ unit_cost: 7000, price_retail: 12000, price_wholesale: 9600, units_per_box: 6, winery: 'Bodega Test' })
    expect(c.usd_rate).toBe(1250)
    expect(c.usd_rate_date).toBe('2026-09-30')
    expect(c.pricing).toEqual({ target_margin_pct: 45, iibb_pct: 4, iva_pct: 21, wholesale_discount_pct: 15 })
  })
})

describe('GET /calculator/prices (revisión del catálogo)', () => {
  it('compara cada vino con el precio sugerido y marca los que quedan por debajo', async () => {
    const barato = wine('Barato', { cost: 6000, retail: 8000 })
    const bien = wine('Bien', { cost: 6000, retail: 11000 })
    wine('Sin precio', { cost: 6000, retail: 0, wholesale: 0 })
    wine('Sin costo', { stock: 0, cost: 0, retail: 5000 })
    const r = await t.get('/calculator/prices?target_margin_pct=40&iibb_pct=3.5&fee_pct=0&round_to=100&wholesale_discount_pct=20')
    expect(r.status).toBe(200)
    const byName = Object.fromEntries(r.body.map((x: any) => [x.name, x]))
    expect(byName['Barato']).toMatchObject({ id: barato, status: 'debajo', suggested_retail: 10700, diff_retail: 2700, suggested_wholesale: 8600 })
    expect(byName['Barato'].margin_retail).toBeCloseTo((8000 - 6000 - 280) / 8000, 6)
    expect(byName['Barato'].verdict.level).toBe('bajo')
    expect(byName['Bien']).toMatchObject({ id: bien, status: 'ok', suggested_retail: 10700, diff_retail: -300 })
    expect(byName['Sin precio']).toMatchObject({ status: 'sin_precio', diff_retail: null, suggested_retail: 10700 })
    expect(byName['Sin costo']).toMatchObject({ status: 'sin_costo', suggested_retail: null, suggested_wholesale: null })
    // El sugerido es el mismo que calcula la calculadora.
    const s = suggestPrice({ cost: 6000, target_margin: 0.4, iibb_pct: 3.5, round_to: 100 })
    expect(s.ok && s.price).toBe(byName['Barato'].suggested_retail)
  })

  it('sin parámetros usa la configuración (margen 40 %, IIBB 3,5 %, sin comisión)', async () => {
    wine('Malbec', { cost: 6000, retail: 8000 })
    const r = await t.get('/calculator/prices')
    expect(r.status).toBe(200)
    expect(r.body[0].suggested_retail).toBe(10619.47)
  })

  it('rechaza parámetros inválidos o imposibles con mensajes claros', async () => {
    let r = await t.get('/calculator/prices?target_margin_pct=abc')
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('Margen deseado')
    r = await t.get('/calculator/prices?iibb_pct=-3')
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('Ingresos Brutos')
    r = await t.get('/calculator/prices?target_margin_pct=90&iibb_pct=5&fee_pct=6')
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('100 %')
  })

  it('exporta la revisión a Excel con columnas tipadas y notas', async () => {
    wine('Barato', { cost: 6000, retail: 8000 })
    const res = await t.raw('/calculator/prices/export?target_margin_pct=40&iibb_pct=3.5&round_to=100')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('spreadsheetml')
    expect(res.headers.get('content-disposition')).toContain('vinoh-revision-de-precios-')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer)
    const ws = wb.worksheets[0]
    expect(ws.name).toBe('Revisión de precios')
    const headers = (ws.getRow(4).values as unknown[]).filter(Boolean)
    expect(headers).toContain('Precio minorista sugerido')
    expect(headers).toContain('Margen actual')
    const row = ws.getRow(5)
    expect(row.getCell(1).value).toBe('Barato')
    expect(row.getCell(7).value).toBe(10700)
    expect(row.getCell(5).numFmt).toBe('0.0%')
    expect(row.getCell(13).value).toBe('Por debajo del margen')
    let notes = ''
    ws.eachRow((r) => (notes += ` ${r.getCell(1).text}`))
    expect(notes).toContain('¿Cómo leer esta planilla?')
    expect(notes).toContain('no cambia ningún precio')
  })

  it('exporta aunque no haya vinos', async () => {
    const res = await t.raw('/calculator/prices/export')
    expect(res.status).toBe(200)
  })
})

describe('"Usar este precio" (PUT /products/:id con el producto completo)', () => {
  it('cambia solo los precios: el costo y el stock quedan igual', async () => {
    const id = wine('Malbec', { stock: 24, cost: 6000, retail: 8000, wholesale: 6400 })
    const ctx = (await t.get<CalculatorContext>('/calculator/context')).body
    const prod = (await t.get('/products?active=1')).body.find((p: any) => p.id === id)
    expect(prod).toBeTruthy()
    const s = suggestPrice({ cost: ctx.products[0].unit_cost, target_margin: 0.4, iibb_pct: 3.5, round_to: 100 })
    expect(s.ok).toBe(true)
    if (!s.ok) return
    // Mismo armado que hace la pantalla: todos los campos editables del vino + los precios nuevos.
    const body = {
      name: prod.name,
      winery: prod.winery,
      varietal: prod.varietal,
      wine_type: prod.wine_type,
      vintage: prod.vintage,
      region: prod.region,
      size_ml: prod.size_ml,
      sku: prod.sku,
      price_retail: s.price,
      price_wholesale: 8560,
      min_stock: prod.min_stock,
      units_per_box: prod.units_per_box,
      active: prod.active,
      notes: prod.notes,
    }
    const r = await t.put(`/products/${id}`, body)
    expect(r.status).toBe(200)
    const after = (await t.get<CalculatorContext>('/calculator/context')).body.products[0]
    expect(after).toMatchObject({ price_retail: 10700, price_wholesale: 8560, unit_cost: 6000 })
    const again = (await t.get('/products?active=1')).body.find((p: any) => p.id === id)
    expect(again.stock).toBe(24)
    expect(again.name).toBe('Malbec')
  })
})

describe('contextWindow', () => {
  it('son los 3 meses completos anteriores al mes de la fecha', () => {
    expect(contextWindow('2026-10-04')).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(contextWindow('2026-01-31')).toEqual({ from: '2025-10-01', to: '2025-12-31' })
    expect(contextWindow('2026-03-01')).toEqual({ from: '2025-12-01', to: '2026-02-28' })
  })
})
