// Tests de la API de Eventos: alta/edición/borrado, cuentas del evento (entradas, vino, costo,
// comisiones, gastos y botellas abiertas), botellas abiertas (alta/baja con stock), listado y Excel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { get, run } from '../db'
import { addMovement } from '../services/stock'
import { addDays, today } from '../../shared/dates'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

/** Vino con stock y costo, directo en la base (no depende del módulo Vinos). */
function wine(name: string, stock = 20, cost = 1000, retail = 2000) {
  const id = run('INSERT INTO products (name, price_retail, price_wholesale) VALUES (?, ?, ?)', [name, retail, retail * 0.8]).lastInsertRowid
  addMovement({ product_id: id, date: '2026-01-01', kind: 'inicial', qty: stock, unit_cost: cost })
  return id
}
const stockOf = (id: number) => get<{ stock: number }>('SELECT stock FROM products WHERE id = ?', [id])!.stock

async function newEvent(over: Record<string, unknown> = {}) {
  const r = await t.post('/events', { name: 'Degustación de Malbecs', date: '2026-03-14', kind: 'degustacion', attendees: 20, ticket_price: 5000, budget: 50000, ...over })
  expect(r.status).toBe(201)
  return r.body
}

/** Venta sin comisión (efectivo) asociada al evento. */
async function sale(eventId: number, items: unknown[], extra: Record<string, unknown> = {}) {
  const r = await t.post('/sales', { date: '2026-03-14', payment_method: 'efectivo', event_id: eventId, items, ...extra })
  expect(r.status).toBe(201)
  return r.body
}

async function expense(eventId: number, amount: number, description = 'Copas y hielo') {
  const r = await t.post('/expenses', { date: '2026-03-14', category: 'Eventos y degustaciones', description, amount, event_id: eventId })
  expect(r.status).toBe(201)
  return r.body
}

describe('POST/PUT /events', () => {
  it('crea un evento y lo devuelve con id y las cuentas en cero', async () => {
    const ev = await newEvent({ location: 'En el local', notes: 'Con quesos' })
    expect(ev.id).toBeGreaterThan(0)
    expect(ev).toMatchObject({ name: 'Degustación de Malbecs', date: '2026-03-14', kind: 'degustacion', location: 'En el local', attendees: 20, ticket_price: 5000, budget: 50000 })
    expect(ev.summary).toMatchObject({ revenue: 0, result: 0, per_attendee: 0, roi: null, budget_used: 0, sales_count: 0 })
  })

  it('valida los datos con mensajes claros', async () => {
    const r = await t.post('/events', { name: '', date: 'mañana' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/Revisá estos datos/)
    expect(r.body.error).toMatch(/Nombre/)
    expect(r.body.error).toMatch(/Fecha/)
    const r2 = await t.post('/events', { name: 'Feria', date: '2026-05-01', kind: 'fiesta' })
    expect(r2.status).toBe(400)
    const r3 = await t.post('/events', { name: 'Feria', date: '2026-05-01', attendees: -3 })
    expect(r3.status).toBe(400)
  })

  it('campos opcionales vacíos quedan en null', async () => {
    const r = await t.post('/events', { name: '  Feria de barrio  ', date: '2026-05-01', location: '  ', attendees: null, ticket_price: null })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ name: 'Feria de barrio', kind: 'degustacion', location: null, attendees: null, ticket_price: null, budget: null })
    expect(r.body.summary.per_attendee).toBeNull()
    expect(r.body.summary.budget_used).toBeNull()
  })

  it('edita un evento y devuelve el registro actualizado', async () => {
    const ev = await newEvent()
    const r = await t.put(`/events/${ev.id}`, { name: 'Cena maridaje', date: '2026-03-20', kind: 'maridaje', attendees: 30, budget: 90000 })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: ev.id, name: 'Cena maridaje', date: '2026-03-20', kind: 'maridaje', attendees: 30, ticket_price: null, budget: 90000 })
    expect(r.body.summary).toBeDefined()
  })

  it('editar o ver un evento que no existe da 404', async () => {
    expect((await t.put('/events/999', { name: 'X', date: '2026-01-01' })).status).toBe(404)
    const r = await t.get('/events/999')
    expect(r.status).toBe(404)
    expect(r.body.error).toMatch(/No encontramos ese evento/)
    expect((await t.get('/events/abc')).status).toBe(404)
  })
})

describe('Cuentas del evento', () => {
  it('separa entradas y vino, y descuenta costo, comisiones, gastos y botellas abiertas', async () => {
    const malbec = wine('Malbec', 30, 1000, 2500)
    const torrontes = wine('Torrontés', 10, 800, 2000)
    const ev = await newEvent()

    // Entradas: 20 × $5.000 = $100.000 (no mueve stock)
    await sale(ev.id, [{ product_id: null, description: 'Entrada degustación', qty: 20, unit_price: 5000 }])
    // Venta mixta: 4 Malbec × $2.500 + 1 entrada extra de $5.000 → $15.000, costo $4.000
    await sale(ev.id, [
      { product_id: malbec, qty: 4, unit_price: 2500 },
      { product_id: null, description: 'Entrada', qty: 1, unit_price: 5000 },
    ])
    // Venta con Mercado Pago y comisión explícita: 2 Torrontés × $2.000 = $4.000, comisión $250, costo $1.600
    await sale(ev.id, [{ product_id: torrontes, qty: 2, unit_price: 2000 }], { payment_method: 'mercadopago', fee: 250 })
    // Gastos del evento: $30.000
    await expense(ev.id, 18000)
    await expense(ev.id, 12000, 'Quesos')
    // Botellas abiertas: 3 Malbec ($3.000) + 2 Torrontés ($1.600)
    const ob = await t.post(`/events/${ev.id}/open-bottles`, {
      items: [
        { product_id: malbec, qty: 3 },
        { product_id: torrontes, qty: 2 },
      ],
    })
    expect(ob.status).toBe(201)

    // Una venta y un gasto de OTRO evento / sin evento no suman.
    const other = await newEvent({ name: 'Otro' })
    await sale(other.id, [{ product_id: malbec, qty: 1, unit_price: 2500 }])
    await t.post('/sales', { date: '2026-03-14', items: [{ product_id: malbec, qty: 1, unit_price: 2500 }] })
    await t.post('/expenses', { date: '2026-03-14', category: 'Otros', description: 'Sin evento', amount: 999 })

    const r = await t.get(`/events/${ev.id}`)
    expect(r.status).toBe(200)
    const s = r.body.summary
    expect(s).toMatchObject({
      revenue: 119000, // 100.000 + 15.000 + 4.000
      tickets: 105000,
      tickets_qty: 21,
      wine_sales: 14000,
      cogs: 5600, // 4 × 1.000 + 2 × 800
      fees: 250,
      expenses: 30000,
      bottles_opened: 5,
      bottles_opened_cost: 4600,
      bottles_sold: 6,
      investment: 34600,
      sales_count: 3,
      expenses_count: 2,
      opened_count: 2,
    })
    // Resultado = 119.000 − 5.600 − 250 − 30.000 − 4.600 = 78.550
    expect(s.result).toBe(78550)
    expect(s.costs).toBe(5600 + 250 + 30000 + 4600)
    expect(s.per_attendee).toBe(3927.5) // 78.550 ÷ 20
    expect(s.roi).toBeCloseTo(78550 / 34600, 6)
    expect(s.budget_used).toBeCloseTo(34600 / 50000, 6)
    expect(r.body.budget_used).toBeCloseTo(0.692, 6)

    // Detalle: ventas, gastos y botellas abiertas del evento
    expect(r.body.sales).toHaveLength(3)
    expect(r.body.sales.map((x: any) => x.items_label)).toContain('Entrada degustación ×20')
    expect(r.body.sales.find((x: any) => x.items_label.startsWith('Malbec')).items_label).toBe('Malbec ×4 +1')
    expect(r.body.expenses).toHaveLength(2)
    expect(r.body.opened).toHaveLength(2)
    expect(r.body.opened.find((o: any) => o.product_id === malbec)).toMatchObject({ product_name: 'Malbec', bottles: 3, unit_cost: 1000, cost: 3000, kind: 'degustacion' })
  })

  it('reparte el descuento de una venta entre entradas y vino (entradas + vino = total)', async () => {
    const malbec = wine('Malbec', 10, 1000, 3000)
    const ev = await newEvent()
    // Subtotal 10.000 (6.000 entradas + 4.000 vino), descuento 1.000 → total 9.000
    await sale(ev.id, [
      { product_id: null, description: 'Entrada', qty: 2, unit_price: 3000 },
      { product_id: malbec, qty: 2, unit_price: 2000 },
    ], { discount: 1000 })
    const s = (await t.get(`/events/${ev.id}`)).body.summary
    expect(s.revenue).toBe(9000)
    expect(s.tickets).toBe(5400) // 6.000 × 9.000 / 10.000
    expect(s.wine_sales).toBe(3600)
    expect(s.tickets + s.wine_sales).toBe(s.revenue)
  })

  it('resultado negativo, sin personas ni presupuesto: por persona y presupuesto quedan en null', async () => {
    const ev = await newEvent({ attendees: null, budget: null })
    await expense(ev.id, 40000)
    const s = (await t.get(`/events/${ev.id}`)).body.summary
    expect(s.result).toBe(-40000)
    expect(s.per_attendee).toBeNull()
    expect(s.budget_used).toBeNull()
    expect(s.roi).toBe(-1)
  })

  it('cuenta las botellas que salieron para el evento desde «Ajustar stock» (cualquier motivo)', async () => {
    const malbec = wine('Malbec', 10, 1500)
    const ev = await newEvent()
    addMovement({ product_id: malbec, date: '2026-03-14', kind: 'regalo', qty: -2, ref_type: 'event', ref_id: ev.id, notes: 'Sorteo' })
    const r = await t.get(`/events/${ev.id}`)
    expect(r.body.summary).toMatchObject({ bottles_opened: 2, bottles_opened_cost: 3000, result: -3000 })
    expect(r.body.opened[0]).toMatchObject({ kind: 'regalo', bottles: 2, notes: 'Sorteo' })
  })

  it('después del evento: cuenta lo que volvieron a comprar sus clientes en 30 días', async () => {
    const malbec = wine('Malbec', 50, 1000, 2000)
    const ana = run("INSERT INTO clients (name) VALUES ('Ana')").lastInsertRowid
    const beto = run("INSERT INTO clients (name) VALUES ('Beto')").lastInsertRowid
    const ev = await newEvent({ date: '2026-03-14' })
    await sale(ev.id, [{ product_id: malbec, qty: 1, unit_price: 2000 }], { client_id: ana })
    await sale(ev.id, [{ product_id: malbec, qty: 1, unit_price: 2000 }], { client_id: beto })
    // Ana vuelve a los 10 días (cuenta) y a los 45 (no cuenta). Beto no vuelve.
    await t.post('/sales', { date: '2026-03-24', client_id: ana, items: [{ product_id: malbec, qty: 3, unit_price: 2000 }] })
    await t.post('/sales', { date: '2026-04-28', client_id: ana, items: [{ product_id: malbec, qty: 1, unit_price: 2000 }] })
    const after = (await t.get(`/events/${ev.id}`)).body.after
    expect(after).toMatchObject({ days: 30, clients: 2, returning_clients: 1, sales_count: 1, revenue: 6000, complete: true })
  })
})

describe('Revisión: consistencia, mensajes y cambios de fecha', () => {
  it('el costo y las entradas del evento coinciden con la suma de sus ventas (redondeo venta por venta)', async () => {
    // Costo con fracciones de centavo: cada venta redondea su costo a 1.000,33 y la suma tiene que dar 3.000,99.
    const malbec = wine('Malbec', 10, 1000.333, 2000)
    const ev = await newEvent()
    for (let i = 0; i < 3; i++) {
      await sale(ev.id, [
        { product_id: malbec, qty: 1, unit_price: 2000 },
        { product_id: null, description: 'Entrada', qty: 1, unit_price: 1000 },
      ], { discount: 1 })
    }
    const d = (await t.get(`/events/${ev.id}`)).body
    const sum = (k: string) => Math.round(d.sales.reduce((a: number, x: any) => a + x[k], 0) * 100) / 100
    expect(d.summary.cogs).toBe(sum('cost'))
    expect(d.summary.cogs).toBe(3000.99)
    expect(d.summary.tickets).toBe(sum('tickets'))
    expect(d.summary.revenue).toBe(sum('total'))
    expect(Math.round((d.summary.tickets + d.summary.wine_sales) * 100) / 100).toBe(d.summary.revenue)
  })

  it('los errores nombran los campos en castellano (nada de «attendees» ni «ticket_price»)', async () => {
    const r = await t.post('/events', { name: 'Feria', date: '2026-05-01', attendees: -3, ticket_price: -1, budget: 'mucho' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/Personas/)
    expect(r.body.error).toMatch(/Precio de la entrada/)
    expect(r.body.error).toMatch(/Presupuesto/)
    expect(r.body.error).not.toMatch(/attendees|ticket_price|budget/)
    const ev = await newEvent()
    const r2 = await t.put(`/events/${ev.id}`, { name: 'X', date: '2026-05-01', attendees: 1.5 })
    expect(r2.status).toBe(400)
    expect(r2.body.error).toMatch(/Personas/)
    const r3 = await t.post(`/events/${ev.id}/open-bottles`, { items: [] })
    expect(r3.body.error).toMatch(/elegí al menos un vino/)
    const r4 = await t.post(`/events/${ev.id}/open-bottles`, { items: [{ product_id: 1, qty: 0 }] })
    expect(r4.body.error).toMatch(/renglón 1/)
    expect(r4.body.error).toMatch(/1 o más/)
  })

  it('si cambia la fecha del evento, las botellas abiertas de ese día se mueven con él (las de otro día no)', async () => {
    const malbec = wine('Malbec', 20, 1000)
    const ev = await newEvent({ date: '2026-03-14' })
    await t.post(`/events/${ev.id}/open-bottles`, { items: [{ product_id: malbec, qty: 2 }] }) // día del evento
    await t.post(`/events/${ev.id}/open-bottles`, { date: '2026-03-10', items: [{ product_id: malbec, qty: 1 }] }) // otro día, a propósito
    const r = await t.put(`/events/${ev.id}`, { name: 'Degustación de Malbecs', date: '2026-04-18', attendees: 20 })
    expect(r.status).toBe(200)
    const opened = (await t.get(`/events/${ev.id}`)).body.opened
    expect(opened.map((o: any) => `${o.date}:${o.bottles}`).sort()).toEqual(['2026-03-10:1', '2026-04-18:2'])
    expect(stockOf(malbec)).toBe(17)
    // La merma pasa al mes nuevo (marzo queda solo con la botella del 10/03).
    const qtyIn = (from: string, to: string) =>
      get<{ q: number }>("SELECT COALESCE(SUM(qty), 0) AS q FROM stock_movements WHERE kind = 'degustacion' AND date BETWEEN ? AND ?", [from, to])!.q
    expect(qtyIn('2026-03-01', '2026-03-31')).toBe(-1)
    expect(qtyIn('2026-04-01', '2026-04-30')).toBe(-2)
    // Sin cambio de fecha no se toca nada.
    await t.put(`/events/${ev.id}`, { name: 'Otro nombre', date: '2026-04-18' })
    expect((await t.get(`/events/${ev.id}`)).body.opened.map((o: any) => o.date).sort()).toEqual(['2026-03-10', '2026-04-18'])
  })
})

describe('Botellas abiertas', () => {
  it('descuenta del stock al costo promedio y se pueden quitar (vuelven al stock)', async () => {
    const malbec = wine('Malbec', 12, 1200)
    const ev = await newEvent()
    const r = await t.post(`/events/${ev.id}/open-bottles`, { date: '2026-03-15', items: [{ product_id: malbec, qty: 4 }], notes: 'Para la cata' })
    expect(r.status).toBe(201)
    expect(stockOf(malbec)).toBe(8)
    expect(r.body.created).toHaveLength(1)
    const mov = r.body.created[0]
    expect(mov).toMatchObject({ date: '2026-03-15', product_id: malbec, bottles: 4, unit_cost: 1200, cost: 4800, notes: 'Para la cata', kind: 'degustacion' })
    expect(r.body.summary).toMatchObject({ bottles_opened: 4, bottles_opened_cost: 4800 })
    const row = get<{ kind: string; qty: number; ref_type: string; ref_id: number }>('SELECT kind, qty, ref_type, ref_id FROM stock_movements WHERE id = ?', [mov.id])
    expect(row).toMatchObject({ kind: 'degustacion', qty: -4, ref_type: 'event', ref_id: ev.id })

    const d = await t.del(`/events/${ev.id}/open-bottles/${mov.id}`)
    expect(d.status).toBe(200)
    expect(d.body).toEqual({ ok: true })
    expect(stockOf(malbec)).toBe(12)
    expect((await t.get(`/events/${ev.id}`)).body.summary.bottles_opened).toBe(0)
  })

  it('sin fecha usa la del evento y junta renglones del mismo vino', async () => {
    const malbec = wine('Malbec', 12, 1000)
    const ev = await newEvent({ date: '2026-03-14' })
    const r = await t.post(`/events/${ev.id}/open-bottles`, {
      items: [
        { product_id: malbec, qty: 2 },
        { product_id: malbec, qty: 1 },
      ],
    })
    expect(r.status).toBe(201)
    expect(r.body.created).toHaveLength(1)
    expect(r.body.created[0]).toMatchObject({ date: '2026-03-14', bottles: 3, notes: 'Degustación: Degustación de Malbecs' })
    expect(stockOf(malbec)).toBe(9)
  })

  it('no deja abrir más botellas de las que hay, ni vinos inexistentes, ni cantidades inválidas', async () => {
    const malbec = wine('Malbec', 2, 1000)
    const ev = await newEvent()
    const r = await t.post(`/events/${ev.id}/open-bottles`, { items: [{ product_id: malbec, qty: 3 }] })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/quedan 2/)
    expect(stockOf(malbec)).toBe(2)
    expect((await t.post(`/events/${ev.id}/open-bottles`, { items: [{ product_id: 999, qty: 1 }] })).status).toBe(400)
    expect((await t.post(`/events/${ev.id}/open-bottles`, { items: [{ product_id: malbec, qty: 0 }] })).status).toBe(400)
    expect((await t.post(`/events/${ev.id}/open-bottles`, { items: [] })).status).toBe(400)
    expect((await t.post(`/events/${ev.id}/open-bottles`, { date: '14/03', items: [{ product_id: malbec, qty: 1 }] })).status).toBe(400)
    // Nada quedó a medias
    expect((await t.get(`/events/${ev.id}`)).body.opened).toHaveLength(0)
  })

  it('404 si el evento o el registro no existen (o es de otro evento)', async () => {
    const malbec = wine('Malbec', 10, 1000)
    const ev = await newEvent()
    const other = await newEvent({ name: 'Otro' })
    expect((await t.post('/events/999/open-bottles', { items: [{ product_id: malbec, qty: 1 }] })).status).toBe(404)
    const r = await t.post(`/events/${ev.id}/open-bottles`, { items: [{ product_id: malbec, qty: 1 }] })
    const movId = r.body.created[0].id
    expect((await t.del(`/events/${other.id}/open-bottles/${movId}`)).status).toBe(404)
    expect((await t.del(`/events/${ev.id}/open-bottles/99999`)).status).toBe(404)
    // Un movimiento de venta no se puede borrar por acá
    const s = await sale(ev.id, [{ product_id: malbec, qty: 1, unit_price: 2000 }])
    const saleMov = get<{ id: number }>("SELECT id FROM stock_movements WHERE ref_type = 'sale_item' AND ref_id = ?", [s.items[0].id])!.id
    expect((await t.del(`/events/${ev.id}/open-bottles/${saleMov}`)).status).toBe(404)
  })
})

describe('DELETE /events/:id', () => {
  it('borra un evento sin movimientos', async () => {
    const ev = await newEvent()
    const r = await t.del(`/events/${ev.id}`)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    expect((await t.get(`/events/${ev.id}`)).status).toBe(404)
    expect((await t.del(`/events/${ev.id}`)).status).toBe(404)
  })

  it('no borra un evento con ventas, gastos o botellas abiertas (409 con explicación)', async () => {
    const malbec = wine('Malbec', 10, 1000)
    const ev = await newEvent()
    await sale(ev.id, [{ product_id: malbec, qty: 1, unit_price: 2000 }])
    await expense(ev.id, 5000)
    await t.post(`/events/${ev.id}/open-bottles`, { items: [{ product_id: malbec, qty: 1 }] })
    const r = await t.del(`/events/${ev.id}`)
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/1 venta, 1 gasto y 1 registro de botellas abiertas/)
    expect(r.body.error).toMatch(/sacale el evento a esas ventas y gastos \(o borralos\) y quitá las botellas abiertas/)
    expect((await t.get(`/events/${ev.id}`)).status).toBe(200)

    // Solo con botellas abiertas también se protege
    const ev2 = await newEvent({ name: 'Cata' })
    const ob = await t.post(`/events/${ev2.id}/open-bottles`, { items: [{ product_id: malbec, qty: 1 }] })
    const r2 = await t.del(`/events/${ev2.id}`)
    expect(r2.status).toBe(409)
    // Solo pide lo que hace falta: no habla de ventas ni gastos que no tiene.
    expect(r2.body.error).toMatch(/primero quitá las botellas abiertas/)
    expect(r2.body.error).not.toMatch(/ventas|gastos/)
    await t.del(`/events/${ev2.id}/open-bottles/${ob.body.created[0].id}`)
    expect((await t.del(`/events/${ev2.id}`)).status).toBe(200)
  })
})

describe('GET /events', () => {
  it('lista todos los eventos del más nuevo al más viejo, con sus cuentas', async () => {
    const a = await newEvent({ name: 'A', date: '2026-01-10' })
    const b = await newEvent({ name: 'B', date: '2026-03-10' })
    const c = await newEvent({ name: 'C', date: '2026-02-10' })
    await expense(c.id, 7000)
    const r = await t.get('/events')
    expect(r.status).toBe(200)
    expect(r.body.map((e: any) => e.id)).toEqual([b.id, c.id, a.id])
    const ec = r.body.find((e: any) => e.id === c.id)
    expect(ec).toMatchObject({ name: 'C', kind: 'degustacion', attendees: 20 })
    expect(ec.summary).toMatchObject({ expenses: 7000, result: -7000 })
    expect(r.body.find((e: any) => e.id === a.id).summary.result).toBe(0)
  })

  it('filtra por período si vienen from/to', async () => {
    await newEvent({ name: 'Enero', date: '2026-01-10' })
    await newEvent({ name: 'Marzo', date: '2026-03-10' })
    const r = await t.get('/events?from=2026-03-01&to=2026-03-31')
    expect(r.body.map((e: any) => e.name)).toEqual(['Marzo'])
  })

  it('lista vacía si no hay eventos', async () => {
    const r = await t.get('/events')
    expect(r.status).toBe(200)
    expect(r.body).toEqual([])
  })

  it('un evento futuro se lista igual (para «Próximos»)', async () => {
    const future = addDays(today(), 10)
    await newEvent({ name: 'Próxima feria', date: future })
    const r = await t.get('/events')
    expect(r.body[0]).toMatchObject({ name: 'Próxima feria', date: future })
  })
})

describe('Excel', () => {
  async function loadXlsx(path: string) {
    const res = await t.raw(path)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/spreadsheetml/)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer)
    return { wb, disposition: res.headers.get('content-disposition') ?? '' }
  }

  it('exporta un evento por fila con sus cuentas', async () => {
    const ev = await newEvent({ name: 'Feria', date: '2026-03-10' })
    await expense(ev.id, 8000)
    await newEvent({ name: 'Fuera del período', date: '2025-12-10' })
    const { wb, disposition } = await loadXlsx('/events/export?from=2026-03-01&to=2026-03-31')
    expect(disposition).toMatch(/vinoh-eventos-/)
    const ws = wb.getWorksheet('Eventos')!
    expect(String(ws.getCell(2, 1).value)).toMatch(/01\/03\/2026 al 31\/03\/2026/)
    expect(ws.getCell(5, 2).value).toBe('Feria')
    const headers = (ws.getRow(4).values as unknown[]).map(String)
    const resultCol = headers.indexOf('Resultado')
    expect(ws.getCell(5, resultCol).value).toBe(-8000)
    expect(ws.getCell(6, 1).value).toBe('TOTAL')
    // El evento tiene datos: sin observación.
    const remarkCol = headers.indexOf('Observación')
    expect(remarkCol).toBeGreaterThan(0)
    expect(ws.getCell(5, remarkCol).value ?? null).toBeNull()
  })

  it('en el Excel, un evento pasado sin nada cargado lo aclara y no muestra un «por persona» de $ 0', async () => {
    await newEvent({ name: 'Vacío', date: '2026-03-10', attendees: 30 })
    const { wb } = await loadXlsx('/events/export?from=2026-03-01&to=2026-03-31')
    const ws = wb.getWorksheet('Eventos')!
    const headers = (ws.getRow(4).values as unknown[]).map(String)
    expect(String(ws.getCell(5, headers.indexOf('Observación')).value)).toMatch(/Sin ventas, gastos ni botellas/)
    expect(ws.getCell(5, headers.indexOf('Resultado por persona')).value ?? null).toBeNull()
  })

  it('en el Excel, los eventos de hoy y los futuros se aclaran (no son «todo en cero»)', async () => {
    await newEvent({ name: 'Hoy', date: today() })
    await newEvent({ name: 'Futuro', date: addDays(today(), 7) })
    const { wb } = await loadXlsx('/events/export')
    const ws = wb.getWorksheet('Eventos')!
    const headers = (ws.getRow(4).values as unknown[]).map(String)
    const remark = (name: string) => {
      for (let r = 5; r <= 7; r++) if (ws.getCell(r, 2).value === name) return String(ws.getCell(r, headers.indexOf('Observación')).value)
      return ''
    }
    expect(remark('Hoy')).toMatch(/Es hoy/)
    expect(remark('Futuro')).toMatch(/Todavía no se hizo/)
  })

  it('exporta la ficha de un evento con Resumen, Ventas, Gastos y Botellas abiertas', async () => {
    const malbec = wine('Malbec', 10, 1000)
    const ev = await newEvent()
    await sale(ev.id, [{ product_id: malbec, qty: 2, unit_price: 2500 }])
    await expense(ev.id, 1000)
    await t.post(`/events/${ev.id}/open-bottles`, { items: [{ product_id: malbec, qty: 1 }] })
    const { wb } = await loadXlsx(`/events/${ev.id}/export`)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumen', 'Ventas', 'Gastos', 'Botellas abiertas'])
    const res = wb.getWorksheet('Resumen')!
    const resultRow = [5, 6, 7, 8, 9, 10, 11, 12, 13].find((r) => String(res.getCell(r, 1).value).includes('RESULTADO'))!
    expect(res.getCell(resultRow, 2).value).toBe(5000 - 2000 - 1000 - 1000)
    // Los porcentajes del texto van con coma decimal (formato argentino).
    const roiRow = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].find((r) => res.getCell(r, 1).value === 'Retorno')!
    expect(String(res.getCell(roiRow, 3).value)).toMatch(/^50 % /) // 1.000 ÷ (1.000 + 1.000)
    const budgetRow = roiRow + 1
    expect(String(res.getCell(budgetRow, 3).value)).toMatch(/Usaste 4 % \(gastos \+ botellas abiertas = \$ 2\.000\)/)
    expect(wb.getWorksheet('Botellas abiertas')!.getCell(5, 2).value).toBe('Malbec')
    expect((await t.raw('/events/999/export')).status).toBe(404)
  })
})
