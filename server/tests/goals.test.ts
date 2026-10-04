// Tests de Metas: listado del año con lo real, alta/edición (upsert), borrado, validaciones,
// sugerencia de meta (punto de equilibrio y año pasado + inflación) y Excel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { run } from '../db'
import { addMovement } from '../services/stock'
import { createSale } from '../services/sales'
import { createExpense } from '../services/expenses'
import { monthlySeries } from '../services/finance'
import { expenseInput, saleInput } from '../../shared/schemas'
import { addMonths, monthKey, monthsBetween, startOfMonth, today } from '../../shared/dates'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

function wine(stock = 500, cost = 1000) {
  const id = run("INSERT INTO products (name, price_retail) VALUES ('Malbec', 2000)").lastInsertRowid
  addMovement({ product_id: id, date: '2023-01-01', kind: 'inicial', qty: stock, unit_cost: cost })
  return id
}
const sale = (date: string, productId: number, qty: number, price: number) =>
  createSale(saleInput.parse({ date, payment_method: 'efectivo', items: [{ product_id: productId, qty, unit_price: price }] }))
const expense = (date: string, amount: number, nature: 'fijo' | 'variable') =>
  createExpense(expenseInput.parse({ date, category: 'Alquiler', description: 'Gasto', amount, nature }))

describe('GET /goals', () => {
  it('devuelve los 12 meses del año, con lo real aunque no haya metas', async () => {
    const p = wine()
    sale('2025-03-10', p, 3, 2000)
    expense('2025-03-11', 1500, 'fijo')
    const r = await t.get('/goals?year=2025')
    expect(r.status).toBe(200)
    expect(r.body).toHaveLength(12)
    expect(r.body.map((g: any) => g.month)).toEqual(monthsBetween('2025-01-01', '2025-12-31'))
    const mar = r.body[2]
    expect(mar).toMatchObject({
      month: '2025-03',
      label: 'marzo 2025',
      short_label: 'mar 25',
      has_goal: false,
      sales_target: null,
      progress: null,
      status: 'past',
      expected_progress: 1,
      actual: { sales: 6000, bottles: 3, expenses: 1500, net_result: 1500 },
    })
    // Lo real es lo mismo que calcula el motor de finanzas.
    const series = monthlySeries('2025-01-01', '2025-12-31')
    r.body.forEach((g: any, i: number) => expect(g.actual.sales).toBe(series[i].sales))
  })

  it('sin año usa el actual y marca el mes en curso', async () => {
    const r = await t.get('/goals')
    expect(r.status).toBe(200)
    expect(r.body[0].month).toBe(`${today().slice(0, 4)}-01`)
    const cur = r.body.find((g: any) => g.month === monthKey(today()))
    expect(cur.status).toBe('current')
    expect(cur.expected_progress).toBeGreaterThan(0)
    expect(cur.expected_progress).toBeLessThanOrEqual(1)
  })

  it('rechaza un año inválido con un mensaje claro', async () => {
    const r = await t.get('/goals?year=abc')
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('Año')
  })
})

describe('PUT /goals/:month y DELETE', () => {
  it('crea la meta, la edita (upsert) y el listado muestra el avance', async () => {
    const p = wine()
    sale('2025-05-05', p, 10, 2000)
    expense('2025-05-06', 3000, 'fijo')
    let r = await t.put('/goals/2025-05', { sales_target: 40000, bottles_target: 20, expense_budget: 2000, notes: '  Meta del Día de la Madre ' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ month: '2025-05', sales_target: 40000, bottles_target: 20, expense_budget: 2000, notes: 'Meta del Día de la Madre' })

    r = await t.put('/goals/2025-05', { sales_target: 25000, bottles_target: null, expense_budget: 6000 })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ month: '2025-05', sales_target: 25000, bottles_target: null, expense_budget: 6000, notes: null })

    const list = await t.get('/goals?year=2025')
    const may = list.body[4]
    expect(may).toMatchObject({ has_goal: true, sales_target: 25000, bottles_target: null, progress: 0.8, bottles_progress: null, expense_progress: 0.5 })
  })

  it('el mes de la URL manda sobre el del cuerpo', async () => {
    const r = await t.put('/goals/2025-07', { month: '2019-01', sales_target: 1000 })
    expect(r.status).toBe(200)
    expect(r.body.month).toBe('2025-07')
    const old = await t.get('/goals?year=2019')
    expect(old.body.every((g: any) => !g.has_goal)).toBe(true)
  })

  it('valida montos y meses con mensajes en castellano', async () => {
    let r = await t.put('/goals/2025-07', { sales_target: -5 })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('Meta de ventas')
    r = await t.put('/goals/2025-07', { bottles_target: 2.5 })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('Meta de botellas')
    r = await t.put('/goals/2025-13', { sales_target: 5 })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('Mes')
    r = await t.put('/goals/julio', { sales_target: 5 })
    expect(r.status).toBe(400)
  })

  it('no guarda una meta vacía (sin ventas, botellas ni presupuesto)', async () => {
    let r = await t.put('/goals/2025-07', { notes: 'solo una nota' })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('al menos una meta')
    r = await t.put('/goals/2025-07', { sales_target: null, bottles_target: null, expense_budget: null })
    expect(r.status).toBe(400)
    const list = await t.get('/goals?year=2025')
    expect(list.body[6].has_goal).toBe(false)
  })

  it('borra la meta; si no existe responde 404', async () => {
    await t.put('/goals/2025-08', { sales_target: 1000 })
    let r = await t.del('/goals/2025-08')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    const list = await t.get('/goals?year=2025')
    expect(list.body[7].has_goal).toBe(false)
    r = await t.del('/goals/2025-08')
    expect(r.status).toBe(404)
    expect(r.body.error).toContain('agosto 2025')
  })

  it('la meta del mes que muestra Inicio es la misma que la de Metas', async () => {
    const p = wine()
    sale('2025-09-03', p, 5, 2000)
    await t.put('/goals/2025-09', { sales_target: 20000 })
    const d = await t.get('/dashboard?from=2025-09-01&to=2025-09-30')
    const g = await t.get('/goals?year=2025')
    expect(d.body.goal.progress).toBe(g.body[8].progress)
    expect(d.body.goal.sales).toBe(g.body[8].actual.sales)
  })
})

describe('GET /goals/suggest', () => {
  it('sin datos no inventa: no sugiere nada pero explica por qué', async () => {
    const r = await t.get('/goals/suggest?month=2025-06')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ month: '2025-06', suggestion: null, break_even_sales: null, last_year_same_month: null, basis: null })
    expect(r.body.explanation).toContain('no hay')
    expect(r.body.steps.length).toBeGreaterThan(0)
  })

  it('calcula punto de equilibrio y año pasado + inflación, y sugiere el mayor', async () => {
    const p = wine(1000, 1000)
    // Últimos 3 meses completos antes de junio 2025: marzo, abril y mayo.
    for (const m of ['2025-03', '2025-04', '2025-05']) {
      sale(`${m}-10`, p, 10, 2000) // ventas 20.000, costo 10.000
      expense(`${m}-05`, 6000, 'fijo')
      expense(`${m}-06`, 1000, 'variable')
    }
    // Mismo mes del año pasado
    sale('2024-06-15', p, 15, 2000) // 30.000
    // Inflación: 11 de los 12 meses cargados al 3 %, falta uno (se supone 2 %).
    const infMonths = monthsBetween('2024-07-01', '2025-06-01')
    infMonths.slice(0, 11).forEach((m) => run('INSERT INTO inflation (month, rate) VALUES (?, ?)', [m, 3]))

    const r = await t.get('/goals/suggest?month=2025-06')
    expect(r.status).toBe(200)
    const s = r.body
    // Margen de contribución = (60.000 − 30.000 de vino − 3.000 variables) ÷ 60.000 = 45 %
    expect(s.contribution_margin).toBeCloseTo(0.45, 6)
    expect(s.fixed_expenses_avg).toBe(6000)
    expect(s.break_even_sales).toBeCloseTo(6000 / 0.45, 1)
    expect(s.last_year_same_month).toBe(30000)
    expect(s.inflation_assumed_months).toBe(1)
    const factor = 1.03 ** 11 * 1.02
    expect(s.last_year_plus_inflation).toBeCloseTo(30000 * factor, 1)
    expect(s.inflation_factor).toBeCloseTo(factor - 1, 3)
    expect(s.avg_last_3_months).toBe(20000)
    // Año pasado + inflación (~43.000) > equilibrio × 1,15 (~15.333) → redondeado hacia arriba a $ 10.000.
    expect(s.basis).toBe('last_year')
    expect(s.suggestion).toBe(50000)
    expect(s.suggested_bottles).toBe(25)
    expect(s.suggested_expense_budget).toBe(10000)
    expect(s.explanation).toContain('Punto de equilibrio')
    expect(s.explanation).toContain('supusimos 2 % mensual')
    expect(s.explanation).toContain('junio 2024')
  })

  it('si no hay año pasado, usa el punto de equilibrio + 15 %', async () => {
    const p = wine(1000, 1000)
    for (const m of ['2025-03', '2025-04', '2025-05']) {
      sale(`${m}-10`, p, 10, 2000)
      expense(`${m}-05`, 9000, 'fijo')
    }
    const r = await t.get('/goals/suggest?month=2025-06')
    // contribución 50 % → equilibrio 18.000 → × 1,15 = 20.700 → 30.000
    expect(r.body.break_even_sales).toBe(18000)
    expect(r.body.basis).toBe('break_even')
    expect(r.body.suggestion).toBe(30000)
    expect(r.body.explanation).toContain('no hay ventas cargadas en junio 2024')
  })

  it('para el mes en curso no usa el mes a medio terminar en los promedios', async () => {
    const p = wine(1000, 1000)
    const cur = startOfMonth(today())
    const prev = addMonths(cur, -1)
    sale(prev, p, 10, 2000)
    sale(cur, p, 1, 2000)
    const r = await t.get(`/goals/suggest?month=${monthKey(addMonths(cur, 1))}`)
    expect(r.status).toBe(200)
    expect(r.body.avg_last_3_months).toBe(20000)
  })

  it('rechaza un mes inválido', async () => {
    const r = await t.get('/goals/suggest?month=2025-6')
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('Mes')
  })
})

describe('GET /goals/export', () => {
  it('descarga el Excel del año con meta vs. real', async () => {
    const p = wine()
    sale('2025-02-02', p, 4, 2000)
    await t.put('/goals/2025-02', { sales_target: 10000 })
    const res = await t.raw('/goals/export?year=2025')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('metas-2025')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.worksheets[0]
    expect(ws.name).toBe('Metas 2025')
    expect(ws.getCell('A6').value).toBe('febrero 2025')
    expect(ws.getCell('B6').value).toBe(10000)
    expect(ws.getCell('C6').value).toBe(8000)
    expect(ws.getCell('D6').value).toBeCloseTo(0.8, 6)
  })
})
