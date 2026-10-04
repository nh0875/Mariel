// Tests de Reportes: que el estado de resultados sea exactamente el del motor de finanzas,
// la clasificación ABC, la cuenta de inflación (pesos de hoy), canales/medios de cobro/días,
// clientes, gastos, la carga de inflación y que cada Excel sea un archivo válido con sus hojas.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { run } from '../db'
import { addMovement } from '../services/stock'
import { createSale } from '../services/sales'
import { createExpense } from '../services/expenses'
import { createPurchase } from '../services/purchases'
import { monthlySeries, periodSummary, salesByChannel } from '../services/finance'
import { expenseInput, purchaseInput, saleInput } from '../../shared/schemas'
import { addMonths, endOfMonth, monthKey, startOfMonth, today } from '../../shared/dates'
import { classifyAbc, effectivePeriod, FULL_EXPORT_SHEETS, weekdayCounts } from '../routes/reports'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

// ── Ayudas para cargar datos directo con los servicios ──

function wine(name: string, stock = 100, cost = 1000, date = '2024-01-01') {
  const id = run('INSERT INTO products (name, price_retail, price_wholesale) VALUES (?, ?, ?)', [name, 2000, 1600]).lastInsertRowid
  if (stock) addMovement({ product_id: id, date, kind: 'inicial', qty: stock, unit_cost: cost })
  return id
}
function sale(date: string, productId: number, qty: number, price: number, extra: Record<string, unknown> = {}) {
  return createSale(saleInput.parse({ date, payment_method: 'efectivo', items: [{ product_id: productId, qty, unit_price: price }], ...extra }))
}
function expense(date: string, amount: number, nature: 'fijo' | 'variable' = 'fijo', category?: string) {
  return createExpense(
    expenseInput.parse({ date, category: category ?? (nature === 'fijo' ? 'Alquiler' : 'Envíos y logística'), description: `Gasto ${nature}`, amount, nature }),
  )
}
function client(name: string, kind = 'restaurante') {
  return run('INSERT INTO clients (name, kind) VALUES (?, ?)', [name, kind]).lastInsertRowid
}

async function workbook(path: string) {
  const res = await t.raw(path)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('spreadsheetml')
  expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="vinoh-.+\.xlsx"/)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer)
  return wb
}
const sheetNames = (wb: ExcelJS.Workbook) => wb.worksheets.map((w) => w.name)

/** Un trimestre que ya pasó (Q1 2025), así no depende del día de hoy. */
const Q = { from: '2025-01-01', to: '2025-03-31' }

function loadQuarter() {
  const malbec = wine('Malbec Clásico', 200, 1000)
  const torrontes = wine('Torrontés', 100, 800)
  sale('2025-01-10', malbec, 10, 2000) // 20.000 · costo 10.000
  sale('2025-02-03', torrontes, 5, 1600, { channel: 'online', payment_method: 'mercadopago' }) // 8.000
  sale('2025-03-15', malbec, 4, 2500, { channel: 'mayorista' }) // 10.000
  expense('2025-01-05', 3000, 'fijo')
  expense('2025-02-05', 3000, 'fijo')
  expense('2025-03-05', 3000, 'fijo')
  expense('2025-02-20', 700, 'variable')
  expense('2025-03-20', 300, 'variable', 'Packaging (cajas, bolsas, etiquetas)')
  addMovement({ product_id: torrontes, date: '2025-03-01', kind: 'rotura', qty: -1 })
  return { malbec, torrontes }
}

// ───────────────────────── Estado de resultados ─────────────────────────

describe('GET /reports/pnl', () => {
  it('es exactamente monthlySeries + periodSummary, y los meses suman el total', async () => {
    loadQuarter()
    const r = await t.get(`/reports/pnl?from=${Q.from}&to=${Q.to}`)
    expect(r.status).toBe(200)
    expect(r.body.months).toEqual(monthlySeries(Q.from, Q.to))
    expect(r.body.total).toEqual(periodSummary(Q.from, Q.to))
    expect(r.body.months.map((m: any) => m.month)).toEqual(['2025-01', '2025-02', '2025-03'])

    const sum = (k: string) => r.body.months.reduce((s: number, m: any) => s + m[k], 0)
    for (const k of ['sales', 'cogs', 'fees', 'shrinkage', 'expenses', 'expenses_fixed', 'expenses_variable', 'net_result', 'sales_count', 'bottles_sold']) {
      expect(sum(k)).toBeCloseTo(r.body.total[k], 2)
    }
    const tot = r.body.total
    expect(tot.sales).toBe(38000)
    expect(tot.cogs).toBe(14000 + 4000)
    expect(tot.shrinkage).toBe(800)
    expect(tot.expenses_fixed).toBe(9000)
    expect(tot.expenses_variable).toBe(1000)
    expect(tot.net_result).toBeCloseTo(tot.sales - tot.cogs - tot.fees - tot.shrinkage - tot.expenses, 2)
  })

  it('detalla los gastos por categoría y mes, y suman justo a fijos y variables', async () => {
    loadQuarter()
    const r = await t.get(`/reports/pnl?from=${Q.from}&to=${Q.to}`)
    const cats = r.body.expenses_by_category as any[]
    expect(cats.map((c) => [c.category, c.nature, c.total])).toEqual([
      ['Alquiler', 'fijo', 9000],
      ['Envíos y logística', 'variable', 700],
      ['Packaging (cajas, bolsas, etiquetas)', 'variable', 300],
    ])
    expect(cats[0].months).toEqual({ '2025-01': 3000, '2025-02': 3000, '2025-03': 3000 })
    expect(cats[1].months).toEqual({ '2025-01': 0, '2025-02': 700, '2025-03': 0 })
    const fixed = cats.filter((c) => c.nature === 'fijo').reduce((s, c) => s + c.total, 0)
    const variable = cats.filter((c) => c.nature === 'variable').reduce((s, c) => s + c.total, 0)
    expect(fixed).toBe(r.body.total.expenses_fixed)
    expect(variable).toBe(r.body.total.expenses_variable)
  })

  it('"Desde siempre" arranca en el primer mes con movimiento y no muestra meses futuros', async () => {
    loadQuarter()
    const r = await t.get(`/reports/pnl?from=2000-01-01&to=${endOfMonth(addMonths(today(), 14))}`)
    expect(r.status).toBe(200)
    expect(r.body.period.from).toBe('2025-01-01')
    expect(r.body.period.to).toBe(endOfMonth(today()))
    expect(r.body.period.trimmed).toBe(true)
    expect(r.body.months[0].month).toBe('2025-01')
    expect(r.body.months.at(-1).month).toBe(monthKey(today()))
    expect(r.body.total).toEqual(periodSummary('2025-01-01', endOfMonth(today())))
  })

  it('sin datos devuelve ceros y como mucho 12 meses; sin fechas usa los últimos 12 meses', async () => {
    const r = await t.get('/reports/pnl?from=2000-01-01&to=2030-12-31')
    expect(r.status).toBe(200)
    expect(r.body.months.length).toBeLessThanOrEqual(12)
    expect(r.body.total).toMatchObject({ sales: 0, net_result: 0, expenses: 0 })
    expect(r.body.expenses_by_category).toEqual([])

    const d = await t.get('/reports/pnl')
    expect(d.body.months).toHaveLength(12)
    expect(d.body.months.at(-1).month).toBe(monthKey(today()))
    expect(d.body.period.requested.from).toBe(startOfMonth(addMonths(today(), -11)))
  })

  it('un período que no toca los datos no se recorta (no se inventa nada)', () => {
    loadQuarter()
    expect(effectivePeriod('2025-02-10', '2025-02-20')).toMatchObject({ from: '2025-02-10', to: '2025-02-20', trimmed: false })
    // Todo antes del primer movimiento: se deja como se pidió (da ceros).
    expect(effectivePeriod('2020-01-01', '2020-03-31')).toMatchObject({ from: '2020-01-01', to: '2020-03-31', trimmed: false })
  })
})

// ───────────────────────── Rentabilidad por vino ─────────────────────────

describe('GET /reports/products — clasificación ABC', () => {
  it('clasifica por ganancia (A ≤ 80 %, B ≤ 95 %, C el resto) e incluye los vinos quietos', async () => {
    const ids = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'].map((n) => wine(n, 100, 1000))
    // Ganancias: 5.000, 3.000, 1.000, 600, 400 → acumulado 50 %, 80 %, 90 %, 96 %, 100 %
    sale('2025-02-01', ids[0], 5, 2000)
    sale('2025-02-02', ids[1], 3, 2000)
    sale('2025-02-03', ids[2], 1, 2000)
    sale('2025-02-04', ids[3], 1, 1600)
    sale('2025-02-05', ids[4], 1, 1400)
    const quieto = wine('Cabernet quieto', 24, 1500)
    wine('Sin stock', 0, 900)

    const r = await t.get(`/reports/products?from=${Q.from}&to=${Q.to}`)
    expect(r.status).toBe(200)
    const rows = r.body as any[]
    expect(rows.map((x) => [x.name, x.profit, x.abc])).toEqual([
      ['Uno', 5000, 'A'],
      ['Dos', 3000, 'A'],
      ['Tres', 1000, 'B'],
      ['Cuatro', 600, 'C'],
      ['Cinco', 400, 'C'],
      ['Cabernet quieto', 0, 'C'],
    ])
    expect(rows[0].share).toBeCloseTo(0.5, 6)
    expect(rows[1].cumulative_share).toBeCloseTo(0.8, 6)
    expect(rows[2].cumulative_share).toBeCloseTo(0.9, 6)
    expect(rows[4].cumulative_share).toBeCloseTo(1, 6)

    const q = rows.find((x) => x.product_id === quieto)
    expect(q).toMatchObject({ idle: true, bottles: 0, revenue: 0, abc: 'C', stock: 24, unit_cost: 1500, stock_value: 36000, days_of_stock: null, last_sale: null })
    // Los que se vendieron traen su stock y valor
    expect(rows[0]).toMatchObject({ idle: false, bottles: 5, revenue: 10000, cost: 5000, stock: 95, stock_value: 95000, last_sale: '2025-02-01' })
    expect(rows[0].margin).toBeCloseTo(0.5, 6)
    // Un vino sin stock y sin ventas no aparece
    expect(rows.find((x) => x.name === 'Sin stock')).toBeUndefined()
  })

  it('el vino que más deja siempre es A, aunque solo él pase el 80 %; los que pierden plata son C', () => {
    const rows = classifyAbc([
      { name: 'Estrella', profit: 9000, revenue: 20000 },
      { name: 'Chico', profit: 1000, revenue: 3000 },
      { name: 'Malo', profit: -500, revenue: 1000 },
    ])
    expect(rows.map((r) => [r.name, r.abc])).toEqual([
      ['Estrella', 'A'],
      ['Chico', 'C'],
      ['Malo', 'C'],
    ])
    expect(rows[2].share).toBeCloseTo(-0.05, 6)
    expect(rows[2].cumulative_share).toBeCloseTo(1, 6)
    // Sin ganancia positiva nadie es A
    expect(classifyAbc([{ profit: 0, revenue: 0 }]).map((r) => r.abc)).toEqual(['C'])
  })

  it('días de stock = stock ÷ ventas por día de los últimos 90 días', async () => {
    const id = wine('Rápido', 100, 1000)
    sale(today(), id, 9, 2000) // 9 en 90 días = 0,1 por día → 91 botellas alcanzan 910 días
    const r = await t.get(`/reports/products?from=${startOfMonth(today())}&to=${endOfMonth(today())}`)
    const row = (r.body as any[]).find((x) => x.product_id === id)
    expect(row.sold_90d).toBe(9)
    expect(row.days_of_stock).toBe(910)
  })
})

// ───────────────────────── Canales, medios de cobro y días ─────────────────────────

describe('GET /reports/channels', () => {
  it('canales con etiqueta, margen y ticket; medios de cobro con comisión real; días de la semana', async () => {
    const malbec = wine('Malbec', 200, 1000)
    // 2025-03-03 es lunes; 2025-03-08 es sábado.
    sale('2025-03-03', malbec, 2, 2000) // local, efectivo 4.000
    sale('2025-03-08', malbec, 5, 2000, { channel: 'online', payment_method: 'mercadopago' }) // 10.000, comisión 6,29 %
    sale('2025-03-08', malbec, 3, 2000, { channel: 'mayorista', payment_method: 'transferencia' }) // 6.000
    sale('2025-03-15', malbec, 1, 2000, { channel: 'online', payment_method: 'mercadopago', fee: 200 }) // comisión cargada a mano

    const r = await t.get('/reports/channels?from=2025-03-01&to=2025-03-31')
    expect(r.status).toBe(200)
    const d = r.body
    expect(d.total_sales).toBe(22000)
    expect(d.total_count).toBe(4)
    expect(d.channels.map((c: any) => c.channel)).toEqual(salesByChannel('2025-03-01', '2025-03-31').map((c) => c.channel))
    const online = d.channels.find((c: any) => c.channel === 'online')
    expect(online).toMatchObject({ label: 'Online / Redes', sales: 12000, count: 2, bottles: 6, cost: 6000, avg_ticket: 6000 })
    expect(online.fees).toBeCloseTo(629 + 200, 2)
    expect(online.profit).toBeCloseTo(12000 - 6000 - 829, 2)
    expect(online.margin).toBeCloseTo(online.profit / 12000, 6)
    expect(online.share).toBeCloseTo(12000 / 22000, 6)
    expect(d.channels.find((c: any) => c.channel === 'mayorista').label).toBe('Mayorista')

    const mp = d.payment_methods.find((m: any) => m.method === 'mercadopago')
    expect(mp).toMatchObject({ label: 'Mercado Pago / QR', total: 12000, count: 2 })
    expect(mp.fees).toBeCloseTo(829, 2)
    expect(mp.fee_pct_effective).toBeCloseTo(829 / 12000, 6)
    expect(mp.fee_pct_configured).toBeCloseTo(0.0629, 6)
    const cash = d.payment_methods.find((m: any) => m.method === 'efectivo')
    expect(cash).toMatchObject({ total: 4000, fees: 0, fee_pct_effective: 0 })

    expect(d.weekdays.map((w: any) => w.label)).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'])
    const sat = d.weekdays.find((w: any) => w.dow === 6)
    expect(sat).toMatchObject({ total: 18000, count: 3, days: 5 }) // marzo 2025 tuvo 5 sábados
    expect(sat.avg_per_day).toBe(3600)
    const mon = d.weekdays.find((w: any) => w.dow === 1)
    expect(mon).toMatchObject({ total: 4000, count: 1, days: 5 })
    expect(d.weekdays.reduce((s: number, w: any) => s + w.total, 0)).toBe(22000)
  })

  it('cuenta bien los días de la semana de un período', () => {
    // Marzo 2025: arranca sábado, 31 días → sábado, domingo y lunes tienen 5; el resto, 4.
    expect(weekdayCounts('2025-03-01', '2025-03-31')).toEqual([5, 5, 4, 4, 4, 4, 5])
    expect(weekdayCounts('2025-03-03', '2025-03-03')).toEqual([0, 1, 0, 0, 0, 0, 0])
    expect(weekdayCounts('2025-03-05', '2025-03-01')).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('sin ventas devuelve listas vacías y los 7 días en cero', async () => {
    const r = await t.get('/reports/channels?from=2025-03-01&to=2025-03-31')
    expect(r.body.channels).toEqual([])
    expect(r.body.payment_methods).toEqual([])
    expect(r.body.weekdays).toHaveLength(7)
    expect(r.body.weekdays.every((w: any) => w.total === 0 && w.avg_per_day === 0)).toBe(true)
  })
})

// ───────────────────────── Clientes ─────────────────────────

describe('GET /reports/clients', () => {
  it('ranking de clientes + parte de las ventas sin cliente (consumidor final)', async () => {
    const malbec = wine('Malbec', 300, 1000)
    const bistro = client('Bistró La Esquina')
    const vinoteca = client('Vinoteca Central', 'vinoteca')
    sale('2025-03-02', malbec, 10, 1800, { client_id: bistro, channel: 'mayorista' }) // 18.000
    sale('2025-03-20', malbec, 5, 1800, { client_id: bistro, channel: 'mayorista' }) // 9.000
    sale('2025-03-10', malbec, 6, 2000, { client_id: vinoteca, payment_method: 'mercadopago' }) // 12.000
    sale('2025-03-11', malbec, 2, 2000) // sin cliente 4.000
    sale('2025-03-12', malbec, 3, 2000) // sin cliente 6.000
    sale('2025-05-01', malbec, 1, 2000, { client_id: vinoteca }) // fuera del período: solo cuenta para "última compra"

    const r = await t.get('/reports/clients?from=2025-03-01&to=2025-03-31')
    expect(r.status).toBe(200)
    const d = r.body
    expect(d.clients.map((c: any) => [c.name, c.total, c.count, c.bottles])).toEqual([
      ['Bistró La Esquina', 27000, 2, 15],
      ['Vinoteca Central', 12000, 1, 6],
    ])
    expect(d.clients[0]).toMatchObject({ client_id: bistro, kind: 'restaurante', kind_label: 'Restaurante / Bar', profit: 27000 - 15000, avg_ticket: 13500, last_purchase: '2025-03-20' })
    expect(d.clients[1].last_purchase).toBe('2025-05-01')
    expect(d.clients[1].profit).toBeCloseTo(12000 - 6000 - 754.8, 2)
    expect(d.walk_in).toMatchObject({ total: 10000, count: 2, bottles: 5, profit: 5000 })
    expect(d.walk_in.share).toBeCloseTo(10000 / 49000, 6)
    expect(d.totals).toMatchObject({ sales: 49000, count: 5, clients: 2 })
    expect(d.totals.top5_share).toBeCloseTo(39000 / 49000, 6)
    expect(d.clients[0].share + d.clients[1].share + d.walk_in.share).toBeCloseTo(1, 6)
  })
})

// ───────────────────────── Gastos ─────────────────────────

describe('GET /reports/expenses', () => {
  it('fijos y variables por mes, promedio de fijos, % de variables sobre ventas y punto de equilibrio', async () => {
    loadQuarter()
    const r = await t.get(`/reports/expenses?from=${Q.from}&to=${Q.to}`)
    expect(r.status).toBe(200)
    const d = r.body
    expect(d.by_month.map((m: any) => [m.month, m.fixed, m.variable, m.total])).toEqual([
      ['2025-01', 3000, 0, 3000],
      ['2025-02', 3000, 700, 3700],
      ['2025-03', 3000, 300, 3300],
    ])
    expect(d.by_month[0].pct_of_sales).toBeCloseTo(3000 / 20000, 6)
    expect(d.totals).toEqual({ total: 10000, fixed: 9000, variable: 1000, sales: 38000 })
    expect(d.fixed_avg).toBe(3000)
    expect(d.months_for_avg).toBe(3)
    expect(d.variable_pct_of_sales).toBeCloseTo(1000 / 38000, 6)
    const s = periodSummary(Q.from, Q.to)
    const cm = (s.sales - s.cogs - s.fees - s.shrinkage - s.expenses_variable) / s.sales
    expect(d.contribution_margin).toBeCloseTo(cm, 6)
    expect(d.break_even_monthly).toBeCloseTo(3000 / cm, 1)
    expect(d.by_category[0]).toMatchObject({ category: 'Alquiler', nature: 'fijo', total: 9000, count: 3, monthly_avg: 3000 })
    expect(d.by_category[0].share).toBeCloseTo(0.9, 6)
  })

  it('si no queda margen para cubrir los fijos, el punto de equilibrio es null', async () => {
    const m = wine('Caro', 10, 3000)
    sale('2025-03-02', m, 1, 2000) // vendido abajo del costo
    expense('2025-03-05', 1000, 'fijo')
    const r = await t.get('/reports/expenses?from=2025-03-01&to=2025-03-31')
    expect(r.body.contribution_margin).toBeLessThan(0)
    expect(r.body.break_even_monthly).toBeNull()
  })
})

// ───────────────────────── Inflación ─────────────────────────

describe('GET /reports/inflation — pesos de hoy', () => {
  it('dos meses al 10 % → el primer mes se multiplica por 1,21', async () => {
    const m = wine('Malbec', 300, 500)
    sale('2025-01-10', m, 10, 1000) // 10.000
    sale('2025-02-10', m, 11, 1000) // 11.000
    sale('2025-03-10', m, 12, 1100) // 13.200
    await t.put('/inflation/2025-02', { rate: 10 })
    await t.put('/inflation/2025-03', { rate: 10 })

    const r = await t.get('/reports/inflation?from=2025-01-01&to=2025-03-31')
    expect(r.status).toBe(200)
    const [jan, feb, mar] = r.body.months
    expect(jan).toMatchObject({ month: '2025-01', sales: 10000, rate: null, index: 100, factor: 1.21, sales_today_pesos: 12100 })
    expect(feb).toMatchObject({ rate: 10, index: 110, factor: 1.1, sales_today_pesos: 12100 })
    expect(mar).toMatchObject({ rate: 10, index: 121, factor: 1, sales_today_pesos: 13200 })
    // Feb vendió 10 % más en pesos con 10 % de inflación → crecimiento real 0.
    expect(feb.nominal_growth_vs_prev).toBeCloseTo(0.1, 6)
    expect(feb.real_growth_vs_prev).toBeCloseTo(0, 6)
    // Mar: +20 % en pesos con 10 % de inflación → (1,2 / 1,1) − 1 ≈ 9,09 % real.
    expect(mar.real_growth_vs_prev).toBeCloseTo(1.2 / 1.1 - 1, 6)
    expect(jan.real_growth_vs_prev).toBeNull()
    expect(r.body.missing_months).toEqual([])
    expect(r.body.inflation_accum).toBeCloseTo(0.21, 6)
    expect(r.body.base_month).toBe('2025-03')
    expect(r.body.totals).toEqual({ sales: 34200, sales_today_pesos: 37400 })
    expect(r.body.explanation).toMatch(/1,21/)
  })

  it('los meses sin inflación cargada se avisan y se toman como 0 %', async () => {
    const m = wine('Malbec', 300, 500)
    sale('2025-01-10', m, 10, 1000)
    sale('2025-03-10', m, 10, 1000)
    await t.put('/inflation/2025-03', { rate: 5 })
    const r = await t.get('/reports/inflation?from=2025-01-01&to=2025-03-31')
    expect(r.body.missing_months).toEqual(['2025-02'])
    expect(r.body.months[0].factor).toBeCloseTo(1.05, 6)
    expect(r.body.months[1].sales).toBe(0)
    expect(r.body.months[2].real_growth_vs_prev).toBeNull() // el mes anterior no vendió
    expect(r.body.explanation).toMatch(/Faltan cargar 1 mes/)
  })
})

describe('Carga de inflación (GET/PUT/DELETE /inflation)', () => {
  it('guarda, actualiza, lista ordenado y borra', async () => {
    const a = await t.put('/inflation/2025-03', { rate: 3.7 })
    expect(a.status).toBe(200)
    expect(a.body).toEqual({ month: '2025-03', rate: 3.7 })
    await t.put('/inflation/2025-01', { rate: 2.256 })
    const up = await t.put('/inflation/2025-03', { rate: 3.1 })
    expect(up.body).toEqual({ month: '2025-03', rate: 3.1 })
    const list = await t.get('/inflation')
    expect(list.body).toEqual([
      { month: '2025-01', rate: 2.26 },
      { month: '2025-03', rate: 3.1 },
    ])
    const del = await t.del('/inflation/2025-01')
    expect(del).toEqual({ status: 200, body: { ok: true } })
    expect((await t.get('/inflation')).body).toHaveLength(1)
  })

  it('acepta inflación negativa (deflación) y 0', async () => {
    expect((await t.put('/inflation/2025-04', { rate: -0.4 })).body.rate).toBe(-0.4)
    expect((await t.put('/inflation/2025-05', { rate: 0 })).body.rate).toBe(0)
  })

  it('valida con mensajes en castellano', async () => {
    const noRate = await t.put('/inflation/2025-03', {})
    expect(noRate.status).toBe(400)
    expect(noRate.body.error).toMatch(/Inflación: es obligatorio/)
    const text = await t.put('/inflation/2025-03', { rate: 'mucha' })
    expect(text.status).toBe(400)
    expect(text.body.error).toMatch(/Inflación: tiene que ser un número/)
    const huge = await t.put('/inflation/2025-03', { rate: 900 })
    expect(huge.status).toBe(400)
    expect(huge.body.error).toMatch(/menor o igual a 500/)
    const badMonth = await t.put('/inflation/2025-13', { rate: 2 })
    expect(badMonth.status).toBe(400)
    expect(badMonth.body.error).toMatch(/Mes/)
    const badFormat = await t.put('/inflation/marzo', { rate: 2 })
    expect(badFormat.status).toBe(400)
    expect((await t.get('/inflation')).body).toEqual([])
  })

  it('borrar un mes que no está cargado da 404 con mensaje claro', async () => {
    const r = await t.del('/inflation/2025-03')
    expect(r.status).toBe(404)
    expect(r.body.error).toMatch(/No encontramos la inflación de ese mes/)
  })
})

// ───────────────────────── Excel ─────────────────────────

describe('Exportar a Excel', () => {
  const qs = `?from=${Q.from}&to=${Q.to}`

  it('estado de resultados: filas de conceptos, columnas de meses + total, fórmulas y formatos', async () => {
    loadQuarter()
    run('INSERT INTO inflation (month, rate) VALUES (?, ?)', ['2025-02', 2.5])
    const wb = await workbook(`/reports/pnl/export${qs}`)
    expect(sheetNames(wb)).toEqual(['Estado de resultados', 'Gastos por categoría y mes'])
    const ws = wb.getWorksheet('Estado de resultados')!
    expect(ws.getCell('A4').value).toBe('Concepto')
    expect(ws.getCell('B4').value).toBe('ene 25')
    expect(ws.getCell('E4').value).toBe('Total del período')
    const concepts = Array.from({ length: 10 }, (_, i) => ws.getCell(5 + i, 1).value)
    expect(concepts).toEqual([
      'Ventas',
      '(−) Costo de lo vendido',
      '= Ganancia bruta',
      'Margen bruto %',
      '(−) Comisiones de cobro',
      '(−) Mermas, degustaciones y regalos',
      '(−) Gastos fijos',
      '(−) Gastos variables',
      '= Resultado (ganancia o pérdida)',
      'Margen neto %',
    ])
    const s = periodSummary(Q.from, Q.to)
    expect(ws.getCell('B5').value).toBe(20000)
    const total = ws.getCell('E5').value as ExcelJS.CellFormulaValue
    expect(total.formula).toBe('SUM(B5:D5)')
    expect(total.result).toBe(s.sales)
    const gross = ws.getCell('E7').value as ExcelJS.CellFormulaValue
    expect(gross.formula).toBe('E5-E6')
    expect(gross.result).toBe(s.gross_profit)
    const net = ws.getCell('E13').value as ExcelJS.CellFormulaValue
    expect(net.formula).toBe('E7-E9-E10-E11-E12')
    expect(net.result).toBeCloseTo(s.net_result, 2)
    expect(ws.getCell('E8').numFmt).toBe('0.0%')
    expect(ws.getCell('B5').numFmt).toContain('$')
    const cat = wb.getWorksheet('Gastos por categoría y mes')!
    expect(cat.getCell('A5').value).toBe('Alquiler')
  })

  it('cada reporte baja un Excel válido con sus hojas', async () => {
    loadQuarter()
    expect(sheetNames(await workbook(`/reports/products/export${qs}`))).toEqual(['Rentabilidad por vino', 'Resumen ABC'])
    expect(sheetNames(await workbook(`/reports/channels/export${qs}`))).toEqual(['Canales de venta', 'Medios de cobro', 'Días de la semana'])
    expect(sheetNames(await workbook(`/reports/clients/export${qs}`))).toEqual(['Clientes'])
    expect(sheetNames(await workbook(`/reports/expenses/export${qs}`))).toEqual(['Gastos por categoría', 'Gastos fijos y variables'])
    expect(sheetNames(await workbook(`/reports/inflation/export${qs}`))).toEqual(['Inflación'])
  })

  it('el reporte completo tiene un Índice primero y todas las hojas, con links', async () => {
    loadQuarter()
    const wb = await workbook(`/reports/full/export${qs}`)
    const names = sheetNames(wb)
    expect(names[0]).toBe('Índice')
    expect(names.slice(1)).toEqual(FULL_EXPORT_SHEETS.map((s) => s.name))
    const idx = wb.getWorksheet('Índice')!
    const link = idx.getCell('A5').value as ExcelJS.CellFormulaValue
    expect(link.formula).toBe(`HYPERLINK("#'Estado de resultados'!A1","Estado de resultados")`)
    expect(idx.getCell('B5').value).toMatch(/Mes a mes/)
  })

  it('con la base vacía también baja (con el aviso de "No hay datos")', async () => {
    const wb = await workbook('/reports/full/export?from=2025-01-01&to=2025-03-31')
    expect(wb.worksheets.length).toBe(FULL_EXPORT_SHEETS.length + 1)
    expect(wb.getWorksheet('Clientes')!.getCell('A5').value).toBe('No hay datos para este período.')
  })

  it('las compras de vino no son gasto: no cambian el estado de resultados', async () => {
    const id = wine('Malbec', 10, 1000)
    sale('2025-02-10', id, 2, 2000)
    const before = (await t.get(`/reports/pnl${qs}`)).body.total
    createPurchase(purchaseInput.parse({ date: '2025-02-12', items: [{ product_id: id, qty: 24, unit_cost: 1100 }] }))
    const after = (await t.get(`/reports/pnl${qs}`)).body.total
    expect(after.net_result).toBe(before.net_result)
    expect(after.purchases).toBe(26400)
  })
})
