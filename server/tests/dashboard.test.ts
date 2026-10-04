// Tests de Inicio (GET /dashboard): que los números sean exactamente los del motor de finanzas,
// la comparación justa con el período anterior, las alertas, las frases, la meta del mes y el Excel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { run } from '../db'
import { addMovement } from '../services/stock'
import { createSale } from '../services/sales'
import { createExpense } from '../services/expenses'
import { createPurchase } from '../services/purchases'
import { accountBalances, totalCash } from '../services/payments'
import { updateSettings } from '../services/settings'
import { lowStock, monthlySeries, payables, periodSummary, receivables, salesByChannel, salesByProduct, stockValue } from '../services/finance'
import { expenseInput, purchaseInput, saleInput } from '../../shared/schemas'
import { addDays, addMonths, endOfMonth, monthKey, previousPeriod, startOfMonth, today } from '../../shared/dates'
import { comparisonPeriods, rangeInWords } from '../routes/dashboard'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

// ── Ayudas para cargar datos directo con los servicios (no dependen de otros módulos) ──

function wine(name: string, stock = 50, cost = 1000, minStock = 6) {
  const id = run('INSERT INTO products (name, price_retail, price_wholesale, min_stock) VALUES (?, ?, ?, ?)', [name, 2000, 1600, minStock]).lastInsertRowid
  addMovement({ product_id: id, date: '2024-01-01', kind: 'inicial', qty: stock, unit_cost: cost })
  return id
}
function sale(date: string, productId: number, qty: number, price: number, extra: Record<string, unknown> = {}) {
  return createSale(saleInput.parse({ date, payment_method: 'efectivo', items: [{ product_id: productId, qty, unit_price: price }], ...extra }))
}
function expense(date: string, amount: number, nature: 'fijo' | 'variable' = 'fijo', extra: Record<string, unknown> = {}) {
  return createExpense(expenseInput.parse({ date, category: nature === 'fijo' ? 'Alquiler' : 'Envíos y logística', description: `Gasto ${nature}`, amount, nature, ...extra }))
}
const caja = () => accountBalances().find((a) => a.kind === 'efectivo')!.id

/** Un mes completo que ya terminó (hace 2 meses), para no depender del día de hoy. */
const pastMonth = () => {
  const from = startOfMonth(addMonths(today(), -2))
  return { from, to: endOfMonth(from) }
}

describe('GET /dashboard — base vacía', () => {
  it('responde con todo en cero, sin alertas ni frases, y con el conteo para la bienvenida', async () => {
    const r = await t.get('/dashboard')
    expect(r.status).toBe(200)
    expect(r.body.period).toEqual({ from: startOfMonth(today()), to: endOfMonth(today()) })
    expect(r.body.summary).toMatchObject({ sales: 0, cogs: 0, expenses: 0, net_result: 0, gross_margin: 0 })
    expect(r.body.series).toHaveLength(12)
    expect(r.body.series[11].month).toBe(monthKey(today()))
    expect(r.body.goal).toBeNull()
    expect(r.body.alerts).toEqual([])
    expect(r.body.insights).toEqual([])
    expect(r.body.top_products).toEqual([])
    expect(r.body.by_channel).toEqual([])
    expect(r.body.setup).toEqual({ products: 0, sales: 0, purchases: 0, expenses: 0, recurring: 0, goals: 0 })
    // Las 3 cuentas base existen desde el primer minuto.
    expect(r.body.cash.accounts).toHaveLength(3)
    expect(r.body.cash.total).toBe(0)
  })
})

describe('GET /dashboard — los números son los del motor de finanzas', () => {
  it('summary, previous, serie, canales, vinos, caja, stock y deudas coinciden con services/finance', async () => {
    const malbec = wine('Malbec Clásico', 100, 1000)
    const torrontes = wine('Torrontés', 40, 800)
    const p = pastMonth()
    const prev = previousPeriod(p)
    sale(addDays(p.from, 2), malbec, 5, 2000)
    sale(addDays(p.from, 5), torrontes, 3, 1500, { channel: 'online', payment_method: 'mercadopago' })
    sale(addDays(p.from, 9), malbec, 2, 2100, { channel: 'mayorista', paid: false, due_date: addDays(p.from, 20) })
    sale(addDays(prev.from, 3), malbec, 4, 1900)
    expense(addDays(p.from, 4), 3000, 'fijo')
    expense(addDays(p.from, 6), 700, 'variable')
    addMovement({ product_id: torrontes, date: addDays(p.from, 7), kind: 'rotura', qty: -1 })

    const r = await t.get(`/dashboard?from=${p.from}&to=${p.to}`)
    expect(r.status).toBe(200)
    const d = r.body
    expect(d.summary).toEqual(periodSummary(p.from, p.to))
    expect(d.previous).toEqual(periodSummary(prev.from, prev.to))
    // Un mes que ya terminó se compara contra el mes anterior completo.
    expect(d.same_days_previous).toBeNull()
    expect(d.comparison.mode).toBe('previous')
    expect(d.comparison.label).toBe('vs. mes anterior')
    expect(d.comparison.current).toEqual(d.summary)
    expect(d.comparison.previous).toEqual(d.previous)

    expect(d.series).toEqual(monthlySeries(addMonths(p.from, -11), p.to))
    expect(d.series[11].month).toBe(monthKey(p.from))
    expect(d.top_products).toEqual(salesByProduct(p.from, p.to).slice(0, 6))
    expect(d.top_products[0]).toMatchObject({ name: 'Malbec Clásico', bottles: 7 })
    expect(d.by_channel.map((c: any) => c.channel)).toEqual(salesByChannel(p.from, p.to).map((c) => c.channel))
    expect(d.by_channel.find((c: any) => c.channel === 'mayorista').label).toBe('Mayorista')
    expect(d.by_channel.find((c: any) => c.channel === 'local').label).toBe('Local / Tienda')

    expect(d.cash.total).toBe(totalCash())
    expect(d.stock).toEqual(stockValue())
    expect(d.receivables).toEqual(receivables())
    expect(d.payables).toEqual(payables())
    expect(d.low_stock).toEqual(lowStock())
    expect(d.setup).toMatchObject({ products: 2, sales: 4, expenses: 2 })

    // Cuentas del resultado: ventas − CMV − comisiones − mermas − gastos.
    const s = d.summary
    expect(s.sales).toBe(10000 + 4500 + 4200)
    expect(s.cogs).toBe(7000 + 2400)
    expect(s.shrinkage).toBe(800)
    expect(s.expenses).toBe(3700)
    expect(s.net_result).toBeCloseTo(s.sales - s.cogs - s.fees - s.shrinkage - s.expenses, 2)
    expect(d.period_label).toMatch(/^[a-z]+ \d{4}$/)
  })

  it('con un período sin ventas devuelve ceros pero igual la serie de 12 meses y la foto de hoy', async () => {
    wine('Malbec', 30, 1000)
    const r = await t.get('/dashboard?from=2020-01-01&to=2020-01-31')
    expect(r.status).toBe(200)
    expect(r.body.summary.sales).toBe(0)
    expect(r.body.series).toHaveLength(12)
    expect(r.body.series[11].month).toBe('2020-01')
    expect(r.body.stock.bottles).toBe(30)
  })

  it('si las fechas vienen al revés las acomoda, y si "to" está en el futuro la serie termina en el mes actual', async () => {
    const r = await t.get('/dashboard?from=2026-03-31&to=2026-03-01')
    expect(r.body.period).toEqual({ from: '2026-03-01', to: '2026-03-31' })
    const y = Number(today().slice(0, 4)) + 1
    const r2 = await t.get(`/dashboard?from=${y}-01-01&to=${y}-12-31`)
    expect(r2.body.series[11].month).toBe(monthKey(today()))
  })
})

describe('Comparación justa ("mismos días del mes pasado")', () => {
  it('a mitad de mes compara los mismos días del mes anterior', () => {
    const c = comparisonPeriods({ from: '2026-10-01', to: '2026-10-31' }, '2026-10-04')
    expect(c.mode).toBe('same_days')
    expect(c.current).toEqual({ from: '2026-10-01', to: '2026-10-04' })
    expect(c.previous).toEqual({ from: '2026-09-01', to: '2026-09-04' })
  })

  it('si el mes anterior es más corto, no se pasa de su último día', () => {
    const c = comparisonPeriods({ from: '2026-03-01', to: '2026-03-31' }, '2026-03-30')
    expect(c.previous).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('el último día del período (o un período pasado) compara contra el período anterior completo', () => {
    expect(comparisonPeriods({ from: '2026-10-01', to: '2026-10-31' }, '2026-10-31').mode).toBe('previous')
    const c = comparisonPeriods({ from: '2026-08-01', to: '2026-08-31' }, '2026-10-04')
    expect(c.mode).toBe('previous')
    expect(c.previous).toEqual({ from: '2026-07-01', to: '2026-07-31' })
  })

  it('las fechas se dicen en palabras', () => {
    const y = today().slice(0, 4)
    expect(rangeInWords(`${y}-10-01`, `${y}-10-04`)).toBe('1 al 4 de octubre')
    expect(rangeInWords(`${y}-09-28`, `${y}-10-04`)).toBe('28 de septiembre al 4 de octubre')
    expect(rangeInWords('2020-02-01', '2020-02-29')).toBe('1 al 29 de febrero de 2020')
  })

  it('en el mes actual la API devuelve same_days_previous y compara contra eso', async () => {
    const malbec = wine('Malbec', 200, 1000)
    const from = startOfMonth(today())
    const to = endOfMonth(today())
    sale(today(), malbec, 3, 2000)
    const prevFrom = addMonths(from, -1)
    sale(prevFrom, malbec, 2, 2000)
    const r = await t.get(`/dashboard?from=${from}&to=${to}`)
    expect(r.status).toBe(200)
    if (today() === to) {
      expect(r.body.same_days_previous).toBeNull()
      expect(r.body.comparison.mode).toBe('previous')
    } else {
      const c = comparisonPeriods({ from, to })
      expect(r.body.same_days_previous).toEqual(periodSummary(c.previous.from, c.previous.to))
      expect(r.body.comparison.mode).toBe('same_days')
      expect(r.body.comparison.label).toBe('vs. mismos días del mes pasado')
      expect(r.body.comparison.detail).toContain('mismos días contra mismos días')
      expect(r.body.comparison.current.sales).toBe(6000)
      expect(r.body.comparison.previous.sales).toBe(4000)
      expect(r.body.insights[0]).toContain('50 % más')
    }
    // "previous" sigue siendo el mes anterior completo.
    const prev = previousPeriod({ from, to })
    expect(r.body.previous).toEqual(periodSummary(prev.from, prev.to))
  })
})

describe('Alertas', () => {
  // Los montos usan espacio duro ("$\u00a012.000") para que no se corten; para comparar los normalizamos.
  const plain = (a: any) => ({ ...a, title: a.title.replace(/\u00a0/g, ' '), text: a.text.replace(/\u00a0/g, ' ') })
  const find = (alerts: any[], text: string) => alerts.map(plain).find((a) => a.title.includes(text) || a.text.includes(text))

  it('avisa lo vencido por cobrar, con el cliente más grande y link a lo pendiente', async () => {
    const malbec = wine('Malbec', 100, 1000)
    const cliente = run("INSERT INTO clients (name, kind) VALUES ('Restó La Vid', 'restaurante')").lastInsertRowid
    sale(addDays(today(), -40), malbec, 5, 2000, { paid: false, due_date: addDays(today(), -10), client_id: cliente })
    sale(addDays(today(), -30), malbec, 1, 2000, { paid: false, due_date: addDays(today(), -5) })
    const r = await t.get('/dashboard')
    const a = find(r.body.alerts, 'vencieron')
    expect(a).toMatchObject({ tone: 'bad', link: '/caja?tab=pendientes' })
    expect(a.title).toContain('$ 12.000')
    expect(a.text).toContain('2 ventas vencidas')
    expect(a.text).toContain('Restó La Vid')
    expect(r.body.alerts[0].tone).toBe('bad')
  })

  it('avisa stock bajo y sin stock', async () => {
    wine('Criolla', 0, 1000, 6)
    wine('Merlot', 3, 1000, 6)
    wine('Malbec con stock', 50, 1000, 6)
    const r = await t.get('/dashboard')
    const a = plain(r.body.alerts.find((x: any) => x.link === '/vinos'))
    expect(a.tone).toBe('bad')
    expect(a.title).toContain('sin stock')
    expect(a.text).toContain('Criolla (sin stock)')
    expect(a.text).toContain('Merlot (3 botellas)')
    expect(a.text).not.toContain('Malbec con stock')
  })

  it('avisa pagos vencidos, los que vencen esta semana y si la caja no alcanza', async () => {
    const malbec = wine('Malbec', 10, 1000)
    const sup = run("INSERT INTO suppliers (name) VALUES ('Bodega Norte')").lastInsertRowid
    createPurchase(purchaseInput.parse({ date: addDays(today(), -2), supplier_id: sup, items: [{ product_id: malbec, qty: 10, unit_cost: 1000 }], paid: false, due_date: addDays(today(), 3) }))
    expense(addDays(today(), -20), 500, 'fijo', { paid: false, due_date: addDays(today(), -1), description: 'Seguro' })
    const r = await t.get('/dashboard')
    expect(find(r.body.alerts, 'pagos vencidos')).toMatchObject({ tone: 'bad' })
    const week = find(r.body.alerts, 'Esta semana vencen')
    expect(week).toMatchObject({ tone: 'warn' })
    expect(week.text).toContain('Bodega Norte')
    // Caja en 0 y 10.500 por pagar → no alcanza.
    const cash = find(r.body.alerts, 'la caja no alcanza')
    expect(cash).toMatchObject({ tone: 'bad', link: '/caja' })
    expect(cash.text).toContain('$ 10.500')
  })

  it('no avisa de caja si la plata alcanza', async () => {
    run('UPDATE accounts SET initial_balance = 1000000 WHERE id = ?', [caja()])
    expense(addDays(today(), -1), 500, 'fijo', { paid: false, due_date: addDays(today(), 10) })
    const r = await t.get('/dashboard')
    expect(find(r.body.alerts, 'la caja no alcanza')).toBeUndefined()
  })

  it('avisa resultado negativo y la caída del margen bruto (> 3 puntos)', async () => {
    const malbec = wine('Malbec', 100, 1000)
    const p = pastMonth()
    const prev = previousPeriod(p)
    sale(addDays(prev.from, 2), malbec, 10, 2000) // margen 50 %
    sale(addDays(p.from, 2), malbec, 10, 1250) // margen 20 %
    expense(addDays(p.from, 3), 10000, 'fijo')
    const r = await t.get(`/dashboard?from=${p.from}&to=${p.to}`)
    const neg = find(r.body.alerts, 'perdiste')
    expect(neg).toMatchObject({ tone: 'bad', link: '/reportes' })
    const margin = find(r.body.alerts, 'margen bruto bajó')
    expect(margin).toMatchObject({ tone: 'warn' })
    expect(margin.title).toContain('30 puntos')
  })

  it('avisa los gastos fijos del mes que faltan generar', async () => {
    run("INSERT INTO recurring_expenses (description, category, amount, nature, day_of_month) VALUES ('Alquiler del local', 'Alquiler', 700000, 'fijo', 1)")
    run("INSERT INTO recurring_expenses (description, category, amount, nature, day_of_month, active) VALUES ('Viejo', 'Otros', 1, 'fijo', 1, 0)")
    const r = await t.get('/dashboard')
    const a = find(r.body.alerts, 'gasto fijo')
    expect(a).toMatchObject({ tone: 'warn', link: '/gastos?tab=fijos' })
    expect(a.title).toContain('1 gasto fijo')
    expect(a.text).toContain('Alquiler del local')
  })

  it('avisa si el dólar de referencia tiene más de 15 días', async () => {
    updateSettings({ usd_rate: 1400, usd_rate_date: addDays(today(), -20) })
    let r = await t.get('/dashboard')
    expect(find(r.body.alerts, 'dólar')).toMatchObject({ tone: 'info', link: '/configuracion' })
    updateSettings({ usd_rate_date: addDays(today(), -3) })
    r = await t.get('/dashboard')
    expect(find(r.body.alerts, 'dólar')).toBeUndefined()
  })

  it('las alertas vienen ordenadas: urgentes primero, buenas noticias al final', async () => {
    const malbec = wine('Malbec', 2, 1000)
    const p = pastMonth()
    run('INSERT INTO goals (month, sales_target) VALUES (?, ?)', [monthKey(p.from), 1000])
    sale(addDays(p.from, 1), malbec, 1, 5000)
    updateSettings({ usd_rate: 1400, usd_rate_date: '2020-01-01' })
    const r = await t.get(`/dashboard?from=${p.from}&to=${p.to}`)
    const tones = r.body.alerts.map((a: any) => a.tone)
    expect(tones[tones.length - 1]).toBe('good')
    const order = { bad: 0, warn: 1, info: 2, good: 3 } as Record<string, number>
    expect([...tones].sort((a, b) => order[a] - order[b])).toEqual(tones)
  })
})

describe('Meta del mes y frases', () => {
  it('trae la meta del mes con avance, ritmo esperado y proyección', async () => {
    const malbec = wine('Malbec', 100, 1000)
    const p = pastMonth()
    sale(addDays(p.from, 3), malbec, 10, 2000)
    run('INSERT INTO goals (month, sales_target, bottles_target, expense_budget) VALUES (?, ?, ?, ?)', [monthKey(p.from), 40000, 20, 10000])
    expense(addDays(p.from, 4), 2500, 'fijo')
    const r = await t.get(`/dashboard?from=${p.from}&to=${p.to}`)
    expect(r.body.goal).toMatchObject({
      month: monthKey(p.from),
      sales_target: 40000,
      sales: 20000,
      bottles: 10,
      expenses: 2500,
      progress: 0.5,
      bottles_progress: 0.5,
      expense_progress: 0.25,
      expected_progress: 1,
      projection: 20000,
    })
    expect(r.body.goal.pace).toBeCloseTo(-0.5, 5)
  })

  it('sin meta cargada, goal es null', async () => {
    const r = await t.get('/dashboard')
    expect(r.body.goal).toBeNull()
  })

  it('para el mes en curso calcula el avance esperado por días transcurridos', async () => {
    run('INSERT INTO goals (month, sales_target) VALUES (?, ?)', [monthKey(today()), 31000])
    const r = await t.get('/dashboard')
    const g = r.body.goal
    expect(g.days_elapsed).toBe(Number(today().slice(8, 10)))
    expect(g.expected_progress).toBeCloseTo(g.days_elapsed / g.days_total, 6)
  })

  it('arma entre 2 y 5 frases con los datos (vino estrella, comparación, canal…)', async () => {
    const malbec = wine('Malbec Clásico', 200, 1000)
    const blanco = wine('Torrontés', 200, 800)
    const p = pastMonth()
    const prev = previousPeriod(p)
    sale(addDays(prev.from, 1), malbec, 5, 2000)
    sale(addDays(p.from, 1), malbec, 8, 2000)
    sale(addDays(p.from, 2), blanco, 2, 1500, { channel: 'online' })
    const r = await t.get(`/dashboard?from=${p.from}&to=${p.to}`)
    const ins: string[] = r.body.insights.map((x: string) => x.replace(/\u00a0/g, ' '))
    expect(ins.length).toBeGreaterThanOrEqual(2)
    expect(ins.length).toBeLessThanOrEqual(5)
    expect(ins.some((x) => x.includes('Tu vino estrella: Malbec Clásico (8 botellas'))).toBe(true)
    expect(ins.some((x) => x.startsWith('Vendiste 90 % más que el mes anterior'))).toBe(true)
    expect(ins.some((x) => x.includes('de tus ventas vino de «Local / Tienda»'))).toBe(true)
  })
})

describe('GET /dashboard/export', () => {
  it('descarga un Excel con el resultado explicado, los 12 meses, vinos, canales y alertas', async () => {
    const malbec = wine('Malbec', 100, 1000)
    const p = pastMonth()
    sale(addDays(p.from, 1), malbec, 4, 2000)
    const res = await t.raw(`/dashboard/export?from=${p.from}&to=${p.to}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('spreadsheetml')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resultado', 'Tu plata hoy', 'Últimos 12 meses', 'Vinos estrella', 'Canales', 'Alertas'])
    const ws = wb.getWorksheet('Resultado')!
    expect(ws.getCell('A5').value).toBe('Ventas')
    expect(ws.getCell('B5').value).toBe(8000)
    expect(ws.getCell('A12').value).toBe('= RESULTADO')
    expect(ws.getCell('B12').value).toBe(4000)
  })
})
