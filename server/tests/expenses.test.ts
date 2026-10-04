// Tests de la API de Gastos: alta (pagado / sin pagar / con "repetir todos los meses"), validaciones,
// filtros, detalle, edición (pagos que se conservan o se rehacen), borrado, pagos parciales,
// resumen del período (fijos/variables/categorías/período anterior/gastos sobre ventas),
// plantillas de gastos fijos (CRUD, generar idempotente, estado del mes) y Excel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { get, run } from '../db'
import { accountBalances } from '../services/payments'
import { addDays, addMonths, endOfMonth, monthKey, startOfMonth, today } from '../../shared/dates'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

const account = (prefix: string) => accountBalances().find((a) => a.name.startsWith(prefix))!
const supplier = (name: string) => run('INSERT INTO suppliers (name, kind) VALUES (?, ?)', [name, 'servicios']).lastInsertRowid
const event = (name: string) => run("INSERT INTO events (name, date) VALUES (?, '2026-02-10')", [name]).lastInsertRowid
/** Venta directa en la base (no depende del módulo Ventas): solo importa el total para "gastos sobre ventas". */
const sale = (date: string, total: number) => run('INSERT INTO sales (date, subtotal, total) VALUES (?, ?, ?)', [date, total, total]).lastInsertRowid
const paymentsOf = (id: number) => get<{ n: number; total: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM payments WHERE ref_type = 'expense' AND ref_id = ?", [id])!

const base = (over: Record<string, unknown> = {}) => ({
  date: '2026-03-05',
  category: 'Alquiler',
  description: 'Alquiler del local',
  amount: 720000,
  nature: 'fijo',
  paid: true,
  ...over,
})

describe('POST /expenses', () => {
  it('crea un gasto pagado: sale la plata de la cuenta elegida y queda "pagado"', async () => {
    const banco = account('Banco')
    const r = await t.post('/expenses', base({ account_id: banco.id }))
    expect(r.status).toBe(201)
    expect(r.body.id).toBeGreaterThan(0)
    expect(r.body).toMatchObject({ amount: 720000, nature: 'fijo', paid: 720000, balance: 0, status: 'pagado', overdue: false, recurring: null })
    expect(r.body.payments).toHaveLength(1)
    expect(r.body.payments[0]).toMatchObject({ account_id: banco.id, account_name: 'Banco', amount: 720000, direction: 'out', date: '2026-03-05' })
    expect(account('Banco').balance).toBe(banco.balance - 720000)
  })

  it('crea un gasto sin pagar: queda "por pagar", vencido si pasó la fecha, y no toca la caja', async () => {
    const caja = account('Caja').balance
    const due = addDays(today(), -3)
    const r = await t.post('/expenses', base({ date: addDays(today(), -15), paid: false, due_date: due, category: 'Contador y honorarios', description: 'Honorarios', amount: 135000 }))
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ paid: 0, balance: 135000, status: 'pendiente', due_date: due, overdue: true })
    expect(r.body.payments).toHaveLength(0)
    expect(account('Caja').balance).toBe(caja)
  })

  it('si no mandan fijo/variable, usa el de la categoría configurada', async () => {
    const fijo = await t.post('/expenses', { date: '2026-03-01', category: 'Alquiler', description: 'Alquiler', amount: 1000 })
    const variable = await t.post('/expenses', { date: '2026-03-01', category: 'Envíos y logística', description: 'Cadete', amount: 500 })
    const otra = await t.post('/expenses', { date: '2026-03-01', category: 'Una categoría vieja', description: 'Algo', amount: 500 })
    expect(fijo.body.nature).toBe('fijo')
    expect(variable.body.nature).toBe('variable')
    // Categorías que no están en la lista se aceptan (puede haber viejas), con el default del esquema.
    expect(otra.status).toBe(201)
    expect(otra.body).toMatchObject({ category: 'Una categoría vieja', nature: 'variable' })
  })

  it('valida con mensajes claros', async () => {
    const sinDesc = await t.post('/expenses', base({ description: '' }))
    expect(sinDesc.status).toBe(400)
    expect(sinDesc.body.error).toMatch(/Descripción/)
    const cero = await t.post('/expenses', base({ amount: 0 }))
    expect(cero.status).toBe(400)
    expect(cero.body.error).toMatch(/Monto: tiene que ser mayor a 0/)
    const sinCat = await t.post('/expenses', base({ category: '   ' }))
    expect(sinCat.status).toBe(400)
    expect(sinCat.body.error).toMatch(/Categoría/)
    const malaFecha = await t.post('/expenses', base({ date: '05/03/2026' }))
    expect(malaFecha.status).toBe(400)
    const tipo = await t.post('/expenses', base({ nature: 'mensual' }))
    expect(tipo.status).toBe(400)
    const prov = await t.post('/expenses', base({ supplier_id: 999 }))
    expect(prov.status).toBe(400)
    expect(prov.body.error).toMatch(/proveedor/)
    const cuenta = await t.post('/expenses', base({ account_id: 999 }))
    expect(cuenta.status).toBe(400)
    expect(cuenta.body.error).toMatch(/cuenta/i)
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM expenses')!.n).toBe(0)
  })

  it('"Repetir todos los meses" crea la plantilla (día máx. 28) y la vincula: generar ese mes no lo duplica', async () => {
    const banco = account('Banco')
    const r = await t.post('/expenses', { ...base({ date: '2026-03-30', account_id: banco.id }), repeat_monthly: true, repeat_auto_paid: true })
    expect(r.status).toBe(201)
    expect(r.body.recurring).toMatchObject({ description: 'Alquiler del local', active: true })
    const tpl = (await t.get('/recurring-expenses')).body
    expect(tpl).toHaveLength(1)
    expect(tpl[0]).toMatchObject({ day_of_month: 28, amount: 720000, nature: 'fijo', account_id: banco.id, auto_paid: true, generated_count: 1, last_generated_month: '2026-03' })
    const gen = await t.post('/recurring-expenses/generate', { month: '2026-03' })
    expect(gen.body).toMatchObject({ created: 0, skipped: 1 })
    const gen2 = await t.post('/recurring-expenses/generate', { month: '2026-04' })
    expect(gen2.body).toMatchObject({ created: 1, skipped: 0 })
    const april = (await t.get('/expenses?from=2026-04-01&to=2026-04-30')).body
    expect(april).toHaveLength(1)
    expect(april[0]).toMatchObject({ date: '2026-04-28', status: 'pagado', amount: 720000 })
  })
})

describe('GET /expenses (filtros) y GET /expenses/:id', () => {
  it('filtra por período, categoría, tipo, estado, proveedor y evento', async () => {
    const correo = supplier('Correo Rápido')
    const feria = event('Feria')
    await t.post('/expenses', base({ date: '2026-03-02' }))
    await t.post('/expenses', base({ date: '2026-03-10', category: 'Envíos y logística', nature: 'variable', description: 'Envío', amount: 4000, supplier_id: correo }))
    await t.post('/expenses', base({ date: '2026-03-12', category: 'Eventos y degustaciones', nature: 'variable', description: 'Copas', amount: 30000, event_id: feria, paid: false, due_date: '2020-01-01' }))
    await t.post('/expenses', base({ date: '2026-04-01', description: 'Alquiler abril' }))

    expect((await t.get('/expenses')).body).toHaveLength(4)
    const marzo = (await t.get('/expenses?from=2026-03-01&to=2026-03-31')).body
    expect(marzo.map((e: any) => e.date)).toEqual(['2026-03-12', '2026-03-10', '2026-03-02'])
    expect((await t.get('/expenses?category=Alquiler')).body).toHaveLength(2)
    expect((await t.get('/expenses?nature=variable')).body).toHaveLength(2)
    expect((await t.get('/expenses?status=pagado')).body).toHaveLength(3)
    expect((await t.get('/expenses?status=por_pagar')).body).toHaveLength(1)
    expect((await t.get('/expenses?status=vencido')).body).toHaveLength(1)
    const bySupplier = (await t.get(`/expenses?supplier_id=${correo}`)).body
    expect(bySupplier).toHaveLength(1)
    expect(bySupplier[0].supplier_name).toBe('Correo Rápido')
    const byEvent = (await t.get(`/expenses?event_id=${feria}`)).body
    expect(byEvent).toHaveLength(1)
    expect(byEvent[0]).toMatchObject({ event_name: 'Feria', overdue: true })
  })

  it('rechaza filtros inválidos con un mensaje entendible', async () => {
    const st = await t.get('/expenses?status=cualquiera')
    expect(st.status).toBe(400)
    expect(st.body.error).toMatch(/estado/)
    const nat = await t.get('/expenses?nature=raro')
    expect(nat.status).toBe(400)
  })

  it('el detalle trae los pagos; 404 si no existe', async () => {
    const r = await t.post('/expenses', base())
    const d = await t.get(`/expenses/${r.body.id}`)
    expect(d.status).toBe(200)
    expect(d.body.payments).toHaveLength(1)
    const nf = await t.get('/expenses/9999')
    expect(nf.status).toBe(404)
    expect(nf.body.error).toMatch(/No encontramos ese gasto/)
    expect((await t.get('/expenses/abc')).status).toBe(404)
  })
})

describe('PUT /expenses/:id', () => {
  it('edita datos y rehace el pago con el nuevo monto, fecha y cuenta', async () => {
    const banco = account('Banco')
    const mp = account('Mercado')
    const r = await t.post('/expenses', base({ account_id: banco.id }))
    const u = await t.put(`/expenses/${r.body.id}`, base({ date: '2026-03-06', amount: 750000, description: 'Alquiler (con ajuste)', account_id: mp.id }))
    expect(u.status).toBe(200)
    expect(u.body).toMatchObject({ amount: 750000, description: 'Alquiler (con ajuste)', status: 'pagado', paid: 750000 })
    expect(u.body.payments).toHaveLength(1)
    expect(u.body.payments[0]).toMatchObject({ account_id: mp.id, amount: 750000, date: '2026-03-06' })
    expect(account('Banco').balance).toBe(banco.balance)
    expect(account('Mercado').balance).toBe(mp.balance - 750000)
  })

  it('pasar de pagado a "todavía no" borra el pago; y al revés lo registra', async () => {
    const r = await t.post('/expenses', base())
    const u = await t.put(`/expenses/${r.body.id}`, base({ paid: false, due_date: '2030-01-01' }))
    expect(u.body).toMatchObject({ status: 'pendiente', paid: 0, due_date: '2030-01-01' })
    expect(paymentsOf(r.body.id).n).toBe(0)
    const back = await t.put(`/expenses/${r.body.id}`, base({ paid: true }))
    expect(back.body).toMatchObject({ status: 'pagado', paid: 720000 })
  })

  it('conserva los pagos en partes si solo cambia la descripción', async () => {
    const banco = account('Banco')
    const r = await t.post('/expenses', base({ paid: false }))
    await t.post(`/expenses/${r.body.id}/payments`, { date: '2026-03-10', amount: 300000, account_id: banco.id })
    await t.post(`/expenses/${r.body.id}/payments`, { date: '2026-03-20', amount: 420000, account_id: banco.id })
    const u = await t.put(`/expenses/${r.body.id}`, base({ description: 'Alquiler marzo', paid: true }))
    expect(u.body.description).toBe('Alquiler marzo')
    expect(u.body.payments.map((p: any) => [p.date, p.amount])).toEqual([
      ['2026-03-10', 300000],
      ['2026-03-20', 420000],
    ])
  })

  it('con pagos parciales y "todavía no", mantiene los pagos y no deja bajar el monto por debajo de lo pagado', async () => {
    const banco = account('Banco')
    const r = await t.post('/expenses', base({ paid: false, amount: 100000 }))
    await t.post(`/expenses/${r.body.id}/payments`, { date: '2026-03-10', amount: 60000, account_id: banco.id })
    const ok = await t.put(`/expenses/${r.body.id}`, base({ paid: false, amount: 90000, description: 'Otro texto' }))
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ status: 'parcial', paid: 60000, balance: 30000 })
    const bad = await t.put(`/expenses/${r.body.id}`, base({ paid: false, amount: 50000 }))
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/Ya pagaste/)
    expect(get<{ amount: number }>('SELECT amount FROM expenses WHERE id = ?', [r.body.id])!.amount).toBe(90000)
  })

  it('404 y validación', async () => {
    expect((await t.put('/expenses/9999', base())).status).toBe(404)
    const r = await t.post('/expenses', base())
    expect((await t.put(`/expenses/${r.body.id}`, base({ amount: -5 }))).status).toBe(400)
  })
})

describe('DELETE /expenses/:id', () => {
  it('borra el gasto y sus pagos (la plata vuelve a la cuenta)', async () => {
    const banco = account('Banco')
    const r = await t.post('/expenses', base({ account_id: banco.id }))
    const d = await t.del(`/expenses/${r.body.id}`)
    expect(d.status).toBe(200)
    expect(d.body).toEqual({ ok: true })
    expect(paymentsOf(r.body.id).n).toBe(0)
    expect(account('Banco').balance).toBe(banco.balance)
    expect((await t.get(`/expenses/${r.body.id}`)).status).toBe(404)
    expect((await t.del(`/expenses/${r.body.id}`)).status).toBe(404)
  })

  it('borrar un gasto generado desde una plantilla no borra la plantilla (y se puede volver a generar)', async () => {
    const tpl = await t.post('/recurring-expenses', { description: 'Internet', category: 'Servicios (luz, gas, agua, internet)', amount: 38000, day_of_month: 12 })
    await t.post('/recurring-expenses/generate', { month: '2026-03' })
    const [e] = (await t.get('/expenses')).body
    expect(e.recurring_id).toBe(tpl.body.id)
    await t.del(`/expenses/${e.id}`)
    expect((await t.get('/recurring-expenses')).body).toHaveLength(1)
    const again = await t.post('/recurring-expenses/generate', { month: '2026-03' })
    expect(again.body.created).toBe(1)
  })
})

describe('Pagos de un gasto', () => {
  it('registra pagos parciales hasta saldarlo; no deja pagar de más', async () => {
    const banco = account('Banco')
    const r = await t.post('/expenses', base({ paid: false, amount: 100000 }))
    const p1 = await t.post(`/expenses/${r.body.id}/payments`, { date: '2026-03-10', amount: 40000, account_id: banco.id, description: 'Primera cuota' })
    expect(p1.status).toBe(201)
    expect(p1.body).toMatchObject({ status: 'parcial', paid: 40000, balance: 60000 })
    expect(p1.body.payments[0]).toMatchObject({ description: 'Primera cuota', account_name: 'Banco' })
    const tooMuch = await t.post(`/expenses/${r.body.id}/payments`, { date: '2026-03-11', amount: 70000, account_id: banco.id })
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body.error).toMatch(/no puede superar/)
    const p2 = await t.post(`/expenses/${r.body.id}/payments`, { date: '2026-03-12', amount: 60000, account_id: banco.id })
    expect(p2.body).toMatchObject({ status: 'pagado', balance: 0 })
    const again = await t.post(`/expenses/${r.body.id}/payments`, { date: '2026-03-12', amount: 1, account_id: banco.id })
    expect(again.status).toBe(400)
    expect(again.body.error).toMatch(/ya está saldad/)
    expect(account('Banco').balance).toBe(banco.balance - 100000)
  })

  it('valida el pago y responde 404 si el gasto no existe', async () => {
    const r = await t.post('/expenses', base({ paid: false }))
    expect((await t.post(`/expenses/${r.body.id}/payments`, { date: '2026-03-10', amount: 0, account_id: 1 })).status).toBe(400)
    expect((await t.post(`/expenses/${r.body.id}/payments`, { date: '2026-03-10', amount: 10 })).status).toBe(400)
    expect((await t.post('/expenses/9999/payments', { date: '2026-03-10', amount: 10, account_id: 1 })).status).toBe(404)
  })

  it('borra un pago de ese gasto (y solo de ese gasto)', async () => {
    const banco = account('Banco')
    const a = await t.post('/expenses', base({ account_id: banco.id }))
    const b = await t.post('/expenses', base({ description: 'Otro' }))
    const pid = a.body.payments[0].id
    expect((await t.del(`/expenses/${b.body.id}/payments/${pid}`)).status).toBe(404)
    const d = await t.del(`/expenses/${a.body.id}/payments/${pid}`)
    expect(d.status).toBe(200)
    expect(d.body).toMatchObject({ status: 'pendiente', paid: 0, balance: 720000 })
    expect(account('Banco').balance).toBe(banco.balance)
  })
})

describe('GET /expenses/summary', () => {
  it('suma fijos, variables, por categoría, pendientes y gastos sobre ventas', async () => {
    await t.post('/expenses', base({ date: '2026-03-05', amount: 600000 }))
    await t.post('/expenses', base({ date: '2026-03-10', category: 'Envíos y logística', nature: 'variable', description: 'Envíos', amount: 100000 }))
    await t.post('/expenses', base({ date: '2026-03-15', category: 'Envíos y logística', nature: 'variable', description: 'Envíos 2', amount: 100000, paid: false, due_date: '2020-01-01' }))
    await t.post('/expenses', base({ date: '2026-03-20', category: 'Marketing y redes', nature: 'variable', description: 'Instagram', amount: 200000, paid: false }))
    // Período anterior (febrero): solo alquiler y envíos
    await t.post('/expenses', base({ date: '2026-02-01', amount: 500000 }))
    await t.post('/expenses', base({ date: '2026-02-10', category: 'Envíos y logística', nature: 'variable', description: 'Envíos', amount: 50000 }))
    sale('2026-03-08', 4000000)

    const r = await t.get('/expenses/summary?from=2026-03-01&to=2026-03-31')
    expect(r.status).toBe(200)
    const s = r.body
    expect(s).toMatchObject({ total: 1000000, fixed: 600000, variable: 400000, count: 4, pending: 300000, pending_count: 2, overdue: 100000, overdue_count: 1, sales: 4000000 })
    expect(s.vs_sales).toBeCloseTo(0.25)
    expect(s.payables_total).toBe(300000)
    expect(s.previous).toMatchObject({ from: '2026-02-01', to: '2026-02-28', total: 550000, fixed: 500000, variable: 50000, sales: 0, vs_sales: null })
    // Comparable: ya había gastos cargados desde el primer día del período anterior.
    expect(s.comparison).toMatchObject({ mode: 'full', comparable: true })
    const byCat = Object.fromEntries(s.by_category.map((c: any) => [c.category, c]))
    expect(s.by_category[0].category).toBe('Alquiler')
    expect(byCat['Alquiler']).toMatchObject({ amount: 600000, count: 1, nature: 'fijo', compare_previous: 500000 })
    expect(byCat['Alquiler'].pct).toBeCloseTo(0.6)
    expect(byCat['Alquiler'].change).toBeCloseTo(0.2)
    expect(byCat['Envíos y logística']).toMatchObject({ amount: 200000, count: 2, compare_previous: 50000 })
    expect(byCat['Envíos y logística'].change).toBeCloseTo(3)
    expect(byCat['Marketing y redes'].change).toBeNull()
    expect(s.monthly).toHaveLength(12)
    const mar = s.monthly.find((m: any) => m.month === '2026-03')
    expect(mar).toMatchObject({ fixed: 600000, variable: 400000, total: 1000000, sales: 4000000 })
    expect(mar.vs_sales).toBeCloseTo(0.25)
    expect(s.monthly[11].month).toBe('2026-03')
    expect(s.first_expense_date).toBe('2026-02-01')
  })

  it('en un período en curso compara contra los mismos días del período anterior', async () => {
    const t0 = today()
    const from = startOfMonth(t0)
    const prevFrom = addMonths(from, -1)
    await t.post('/expenses', base({ date: t0, amount: 1000 }))
    await t.post('/expenses', base({ date: prevFrom, amount: 800 }))
    await t.post('/expenses', base({ date: endOfMonth(prevFrom), amount: 5000 }))
    const s = (await t.get(`/expenses/summary?from=${from}&to=${endOfMonth(t0)}`)).body
    if (t0 === endOfMonth(t0)) {
      expect(s.comparison.mode).toBe('full')
    } else {
      expect(s.comparison.mode).toBe('same_days')
      expect(s.comparison.current).toMatchObject({ from, to: t0, total: 1000 })
      // Del mes anterior solo cuentan los mismos días (el gasto del último día queda afuera, salvo que hoy sea fin de mes).
      expect(s.comparison.previous.from).toBe(prevFrom)
      expect(s.comparison.previous.total).toBe(s.comparison.previous.to >= endOfMonth(prevFrom) ? 5800 : 800)
    }
    // "previous" siempre es el período anterior completo.
    expect(s.previous.total).toBe(5800)
    expect(s.monthly[11].month).toBe(monthKey(t0))
  })

  it('sin datos devuelve ceros y sin comparación', async () => {
    const s = (await t.get('/expenses/summary?from=2026-03-01&to=2026-03-31')).body
    expect(s).toMatchObject({ total: 0, fixed: 0, variable: 0, count: 0, pending: 0, vs_sales: null, by_category: [], first_expense_date: null })
    expect(s.comparison.comparable).toBe(false)
  })
})

describe('Gastos fijos del mes (plantillas)', () => {
  const tpl = (over: Record<string, unknown> = {}) => ({
    description: 'Alquiler del local',
    category: 'Alquiler',
    amount: 720000,
    day_of_month: 5,
    ...over,
  })

  it('crea, lista, edita y borra plantillas', async () => {
    const banco = account('Banco')
    const c = await t.post('/recurring-expenses', tpl({ account_id: banco.id }))
    expect(c.status).toBe(201)
    expect(c.body).toMatchObject({ id: expect.any(Number), nature: 'fijo', auto_paid: false, active: true, account_name: 'Banco', last_generated_month: null, generated_count: 0 })
    const u = await t.put(`/recurring-expenses/${c.body.id}`, tpl({ amount: 800000, auto_paid: true, account_id: banco.id, day_of_month: 10 }))
    expect(u.status).toBe(200)
    expect(u.body).toMatchObject({ amount: 800000, auto_paid: true, day_of_month: 10 })
    expect((await t.get('/recurring-expenses')).body).toHaveLength(1)
    const d = await t.del(`/recurring-expenses/${c.body.id}`)
    expect(d.body).toEqual({ ok: true })
    expect((await t.get('/recurring-expenses')).body).toHaveLength(0)
    expect((await t.del(`/recurring-expenses/${c.body.id}`)).status).toBe(404)
    expect((await t.put(`/recurring-expenses/${c.body.id}`, tpl())).status).toBe(404)
  })

  it('valida día del mes (1 a 28), monto y cuenta', async () => {
    const dia = await t.post('/recurring-expenses', tpl({ day_of_month: 31 }))
    expect(dia.status).toBe(400)
    expect(dia.body.error).toMatch(/Día del mes/)
    expect((await t.post('/recurring-expenses', tpl({ amount: 0 }))).status).toBe(400)
    expect((await t.post('/recurring-expenses', tpl({ description: '' }))).status).toBe(400)
    expect((await t.post('/recurring-expenses', tpl({ account_id: 999 }))).status).toBe(400)
  })

  it('generar crea los gastos del mes, es idempotente, respeta "se paga solo" y salta las pausadas', async () => {
    const banco = account('Banco')
    await t.post('/recurring-expenses', tpl({ account_id: banco.id, auto_paid: true }))
    await t.post('/recurring-expenses', tpl({ description: 'Contador', category: 'Contador y honorarios', amount: 135000, day_of_month: 28 }))
    await t.post('/recurring-expenses', tpl({ description: 'Pausado', amount: 1, active: false }))

    const g1 = await t.post('/recurring-expenses/generate', { month: '2026-02' })
    expect(g1.status).toBe(200)
    expect(g1.body).toMatchObject({ month: '2026-02', created: 2, skipped: 0 })
    expect(g1.body.status).toMatchObject({ templates: 2, generated: 2, missing: 0 })
    const g2 = await t.post('/recurring-expenses/generate', { month: '2026-02' })
    expect(g2.body).toMatchObject({ created: 0, skipped: 2 })

    const feb = (await t.get('/expenses?from=2026-02-01&to=2026-02-28')).body
    expect(feb).toHaveLength(2)
    const alquiler = feb.find((e: any) => e.description === 'Alquiler del local')
    const contador = feb.find((e: any) => e.description === 'Contador')
    expect(alquiler).toMatchObject({ date: '2026-02-05', status: 'pagado', nature: 'fijo' })
    expect(contador).toMatchObject({ date: '2026-02-28', due_date: '2026-02-28', status: 'pendiente' })
    expect(account('Banco').balance).toBe(banco.balance - 720000)

    const list = (await t.get('/recurring-expenses')).body
    expect(list.find((r: any) => r.description === 'Alquiler del local')).toMatchObject({ last_generated_month: '2026-02', generated_count: 1 })
  })

  it('valida el mes a generar', async () => {
    for (const month of ['2026-13', '2026-1', 'febrero', '']) {
      const r = await t.post('/recurring-expenses/generate', { month })
      expect(r.status).toBe(400)
      expect(r.body.error).toMatch(/Mes/)
    }
    expect((await t.post('/recurring-expenses/generate', {})).status).toBe(400)
  })

  it('estado del mes: cuántas plantillas hay, cuántas ya se generaron y cuánto falta', async () => {
    await t.post('/recurring-expenses', tpl())
    await t.post('/recurring-expenses', tpl({ description: 'Internet', category: 'Servicios (luz, gas, agua, internet)', amount: 38000, day_of_month: 12 }))
    const before = (await t.get('/recurring-expenses/status?month=2026-05')).body
    expect(before).toMatchObject({ month: '2026-05', label: 'mayo 2026', templates: 2, generated: 0, missing: 2, missing_amount: 758000, monthly_total: 758000 })
    const [first] = (await t.get('/recurring-expenses')).body
    await t.post('/recurring-expenses/generate', { month: '2026-05' })
    const after = (await t.get('/recurring-expenses/status?month=2026-05')).body
    expect(after).toMatchObject({ generated: 2, missing: 0, missing_amount: 0 })
    const item = after.items.find((i: any) => i.id === first.id)
    expect(item).toMatchObject({ expense_status: 'pendiente', expense_id: expect.any(Number) })
    // Sin ?month usa el mes actual
    expect((await t.get('/recurring-expenses/status')).body.month).toBe(monthKey(today()))
    expect((await t.get('/recurring-expenses/status?month=2026-5')).status).toBe(400)
  })

  it('borrar una plantilla deja los gastos ya generados (son gastos reales)', async () => {
    const c = await t.post('/recurring-expenses', tpl())
    await t.post('/recurring-expenses/generate', { month: '2026-01' })
    await t.del(`/recurring-expenses/${c.body.id}`)
    const list = (await t.get('/expenses')).body
    expect(list).toHaveLength(1)
    expect(list[0].recurring_id).toBeNull()
  })
})

describe('GET /expenses/export', () => {
  it('arma el Excel con las hojas Gastos, Por categoría y Por mes', async () => {
    await t.post('/expenses', base({ date: '2026-02-05' }))
    await t.post('/expenses', base({ date: '2026-03-05', category: 'Envíos y logística', nature: 'variable', description: 'Envío', amount: 4000, paid: false }))
    const res = await t.raw('/expenses/export?from=2026-02-01&to=2026-03-31')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/spreadsheetml/)
    expect(res.headers.get('content-disposition')).toMatch(/vinoh-gastos-/)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Gastos', 'Por categoría', 'Por mes'])
    const ws = wb.getWorksheet('Gastos')!
    expect(String(ws.getCell(2, 1).value)).toMatch(/Período: 01\/02\/2026 al 31\/03\/2026/)
    expect(ws.getRow(4).getCell(1).value).toBe('Fecha')
    expect(ws.getRow(5).getCell(2).value).toBe('Alquiler del local')
    expect(ws.getRow(6).getCell(10).value).toBe('Por pagar')
    expect(ws.getRow(7).getCell(1).value).toBe('TOTAL')
    const notes: string[] = []
    ws.eachRow((row) => {
      const v = row.getCell(1).value
      if (typeof v === 'string' && v.startsWith('•')) notes.push(v)
    })
    expect(notes.some((n) => /Fijo = lo pagás igual/.test(n))).toBe(true)
    const cat = wb.getWorksheet('Por categoría')!
    expect(cat.getRow(5).getCell(1).value).toBe('Alquiler')
  })

  it('respeta los filtros (y lo aclara en el subtítulo)', async () => {
    await t.post('/expenses', base({ date: '2026-03-05' }))
    await t.post('/expenses', base({ date: '2026-03-06', category: 'Envíos y logística', nature: 'variable', description: 'Envío', amount: 4000 }))
    const res = await t.raw('/expenses/export?from=2026-03-01&to=2026-03-31&nature=variable')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.getWorksheet('Gastos')!
    expect(String(ws.getCell(2, 1).value)).toMatch(/solo variables/)
    expect(ws.getRow(5).getCell(2).value).toBe('Envío')
    expect(ws.getRow(6).getCell(1).value).toBe('TOTAL')
    // Un solo mes: no hace falta la hoja "Por mes"
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Gastos', 'Por categoría'])
  })
})
