// Tests de la API de Ventas: alta (cobrada / sin cobrar / ítems sueltos / descuento y envío / comisión),
// filtros, resumen, cobros parciales, edición y borrado (con stock), Excel y comprobante.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { get, run } from '../db'
import { addMovement } from '../services/stock'
import { accountBalances } from '../services/payments'
import { addDays, endOfMonth, startOfMonth, today } from '../../shared/dates'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

/** Crea un vino con stock inicial y costo, directo en la base (no depende del módulo Vinos). */
function wine(name: string, stock = 20, cost = 1000, retail = 2000, wholesale = 1600) {
  const id = run('INSERT INTO products (name, price_retail, price_wholesale) VALUES (?, ?, ?)', [name, retail, wholesale]).lastInsertRowid
  addMovement({ product_id: id, date: '2026-01-01', kind: 'inicial', qty: stock, unit_cost: cost })
  return id
}
const stockOf = (id: number) => get<{ stock: number }>('SELECT stock FROM products WHERE id = ?', [id])!.stock
const client = (name: string) => run('INSERT INTO clients (name, kind) VALUES (?, ?)', [name, 'restaurante']).lastInsertRowid
const event = (name: string) => run("INSERT INTO events (name, date) VALUES (?, '2026-02-10')", [name]).lastInsertRowid
const account = (prefix: string) => accountBalances().find((a) => a.name.startsWith(prefix))!
const feePayments = (saleId: number) =>
  get<{ total: number }>("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE ref_type = 'sale_fee' AND ref_id = ?", [saleId])!.total

describe('POST /sales', () => {
  it('crea una venta cobrada: descuenta stock, congela el costo y entra la plata en la cuenta del medio de pago', async () => {
    const malbec = wine('Malbec', 20, 1000)
    const cajaAntes = account('Caja').balance
    const r = await t.post('/sales', {
      date: '2026-02-03',
      payment_method: 'efectivo',
      items: [{ product_id: malbec, qty: 3, unit_price: 2000 }],
    })
    expect(r.status).toBe(201)
    expect(r.body.id).toBeGreaterThan(0)
    expect(r.body).toMatchObject({ subtotal: 6000, total: 6000, fee: 0, cost: 3000, profit: 3000, paid: 6000, balance: 0, status: 'pagado', bottles: 3 })
    expect(r.body.items).toHaveLength(1)
    expect(r.body.items[0]).toMatchObject({ product_name: 'Malbec', unit_cost: 1000 })
    expect(r.body.payments).toHaveLength(1)
    expect(stockOf(malbec)).toBe(17)
    expect(account('Caja').balance).toBe(cajaAntes + 6000)
  })

  it('crea una venta sin cobrar: queda por cobrar, con vencimiento y sin movimientos de caja', async () => {
    const p = wine('Cabernet')
    const due = addDays(today(), -2)
    const r = await t.post('/sales', {
      date: addDays(today(), -10),
      items: [{ product_id: p, qty: 2, unit_price: 2500 }],
      paid: false,
      due_date: due,
    })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ total: 5000, paid: 0, balance: 5000, status: 'pendiente', due_date: due, overdue: true })
    expect(r.body.payments).toHaveLength(0)
    expect(stockOf(p)).toBe(18)
  })

  it('acepta ítems que no son vino: no mueven stock ni suman botellas ni costo', async () => {
    const p = wine('Torrontés', 10, 800)
    const r = await t.post('/sales', {
      date: '2026-02-05',
      items: [
        { product_id: p, qty: 2, unit_price: 1500 },
        { product_id: null, description: 'Entrada degustación', qty: 3, unit_price: 4000 },
      ],
    })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ subtotal: 15000, total: 15000, bottles: 2, cost: 1600, items_count: 2 })
    const free = r.body.items.find((i: any) => i.product_id == null)
    expect(free).toMatchObject({ description: 'Entrada degustación', unit_cost: 0, product_name: null })
    expect(stockOf(p)).toBe(8)
  })

  it('calcula total con descuento y envío, y rechaza un descuento mayor que la venta', async () => {
    const p = wine('Blend')
    const ok = await t.post('/sales', { date: '2026-02-06', items: [{ product_id: p, qty: 4, unit_price: 2000 }], discount: 800, shipping: 1500 })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ subtotal: 8000, discount: 800, shipping: 1500, total: 8700 })

    const bad = await t.post('/sales', { date: '2026-02-06', items: [{ product_id: p, qty: 1, unit_price: 1000 }], discount: 5000 })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/descuento/i)
    expect(stockOf(p)).toBe(16) // la venta rechazada no tocó el stock
  })

  it('calcula la comisión sola con el % del medio de pago (o respeta la que mandás)', async () => {
    const p = wine('Rosado', 20, 1000)
    const auto = await t.post('/sales', { date: '2026-02-07', payment_method: 'mercadopago', items: [{ product_id: p, qty: 5, unit_price: 4000 }] })
    expect(auto.status).toBe(201)
    expect(auto.body.fee).toBe(1258) // 20.000 × 6,29 %
    expect(auto.body.profit).toBe(20000 - 1258 - 5000)
    expect(feePayments(auto.body.id)).toBe(1258)
    // el cobro entra a Mercado Pago y la comisión sale de la misma cuenta
    expect(account('Mercado Pago').balance).toBe(20000 - 1258)

    const manual = await t.post('/sales', { date: '2026-02-07', payment_method: 'credito', fee: 500, items: [{ product_id: p, qty: 1, unit_price: 10000 }] })
    expect(manual.body.fee).toBe(500)
  })

  it('valida con mensajes claros', async () => {
    const p = wine('Syrah')
    const noItems = await t.post('/sales', { date: '2026-02-01', items: [] })
    expect(noItems.status).toBe(400)
    expect(noItems.body.error).toMatch(/Revisá/)

    const emptyLine = await t.post('/sales', { date: '2026-02-01', items: [{ product_id: null, qty: 1, unit_price: 100 }] })
    expect(emptyLine.status).toBe(400)
    expect(emptyLine.body.error).toMatch(/elegí un vino o escribí una descripción/)

    const zeroQty = await t.post('/sales', { date: '2026-02-01', items: [{ product_id: p, qty: 0, unit_price: 100 }] })
    expect(zeroQty.status).toBe(400)
    expect(zeroQty.body.error).toMatch(/Cantidad/)

    const badDate = await t.post('/sales', { date: '03/02/2026', items: [{ product_id: p, qty: 1, unit_price: 100 }] })
    expect(badDate.status).toBe(400)
    expect(badDate.body.error).toMatch(/Fecha/)

    const ghostProduct = await t.post('/sales', { date: '2026-02-01', items: [{ product_id: 9999, qty: 1, unit_price: 100 }] })
    expect(ghostProduct.status).toBe(400)
    expect(ghostProduct.body.error).toMatch(/vinos elegidos no existe/)

    const ghostClient = await t.post('/sales', { date: '2026-02-01', client_id: 9999, items: [{ product_id: p, qty: 1, unit_price: 100 }] })
    expect(ghostClient.status).toBe(400)
    expect(ghostClient.body.error).toMatch(/cliente/)

    const ghostAccount = await t.post('/sales', { date: '2026-02-01', account_id: 9999, items: [{ product_id: p, qty: 1, unit_price: 100 }] })
    expect(ghostAccount.status).toBe(400)
    expect(ghostAccount.body.error).toMatch(/cuenta/)

    expect(stockOf(p)).toBe(20)
  })

  it('permite vender más de lo que hay (queda stock negativo para corregir después)', async () => {
    const p = wine('Petit Verdot', 2)
    const r = await t.post('/sales', { date: '2026-02-01', items: [{ product_id: p, qty: 5, unit_price: 100 }] })
    expect(r.status).toBe(201)
    expect(stockOf(p)).toBe(-3)
  })
})

describe('GET /sales (filtros)', () => {
  it('filtra por fechas, canal, cliente, evento, vino y estado de cobro, con resumen de renglones', async () => {
    const a = wine('Malbec')
    const b = wine('Chardonnay')
    const bistro = client('Bistró La Esquina')
    const feria = event('Feria de otoño')
    await t.post('/sales', { date: '2026-01-15', channel: 'local', items: [{ product_id: a, qty: 1, unit_price: 2000 }] })
    await t.post('/sales', {
      date: '2026-02-10',
      channel: 'mayorista',
      client_id: bistro,
      price_list: 'mayorista',
      paid: false,
      due_date: '2026-02-20',
      items: [
        { product_id: a, qty: 6, unit_price: 1600 },
        { product_id: b, qty: 6, unit_price: 1600 },
      ],
    })
    await t.post('/sales', { date: '2026-02-10', channel: 'eventos', event_id: feria, items: [{ product_id: b, qty: 2, unit_price: 2000 }, { description: 'Copa grabada', qty: 2, unit_price: 500 }] })

    const all = await t.get('/sales')
    expect(all.status).toBe(200)
    expect(all.body).toHaveLength(3)
    // más nuevas primero
    expect(all.body[0].date >= all.body[2].date).toBe(true)

    const feb = await t.get('/sales?from=2026-02-01&to=2026-02-28')
    expect(feb.body).toHaveLength(2)
    expect((await t.get('/sales?channel=mayorista')).body).toHaveLength(1)
    expect((await t.get(`/sales?client_id=${bistro}`)).body[0].client_name).toBe('Bistró La Esquina')
    const ev = (await t.get(`/sales?event_id=${feria}`)).body
    expect(ev).toHaveLength(1)
    expect(ev[0].event_name).toBe('Feria de otoño')
    expect(ev[0].items_preview).toEqual([
      { name: 'Chardonnay', qty: 2, is_wine: true },
      { name: 'Copa grabada', qty: 2, is_wine: false },
    ])
    expect((await t.get(`/sales?product_id=${b}`)).body).toHaveLength(2)
    expect((await t.get('/sales?status=pagado')).body).toHaveLength(2)
    expect((await t.get('/sales?status=pendiente')).body).toHaveLength(1)
    expect((await t.get('/sales?status=por_cobrar')).body).toHaveLength(1)
    // venció el 20/02/2026 (antes de hoy)
    expect((await t.get('/sales?status=vencida')).body).toHaveLength(1)
  })

  it('rechaza filtros que no existen', async () => {
    expect((await t.get('/sales?status=regalada')).status).toBe(400)
    expect((await t.get('/sales?channel=teletransporte')).status).toBe(400)
  })
})

describe('GET /sales/summary', () => {
  it('suma ventas, botellas, costo, comisiones, ganancia y lo pendiente del período', async () => {
    const p = wine('Malbec', 50, 1000)
    const from = startOfMonth(today())
    const to = endOfMonth(today())
    const d = today()
    await t.post('/sales', { date: d, channel: 'local', payment_method: 'efectivo', items: [{ product_id: p, qty: 2, unit_price: 2000 }] }) // 4.000, costo 2.000
    await t.post('/sales', { date: d, channel: 'online', payment_method: 'mercadopago', items: [{ product_id: p, qty: 5, unit_price: 2000 }] }) // 10.000, fee 629, costo 5.000
    await t.post('/sales', {
      date: d,
      channel: 'local',
      payment_method: 'transferencia',
      paid: false,
      items: [{ product_id: p, qty: 3, unit_price: 2000 }, { description: 'Caja de regalo', qty: 1, unit_price: 1000 }],
    }) // 7.000, costo 3.000, por cobrar
    // fuera del período: no cuenta
    await t.post('/sales', { date: addDays(from, -1), items: [{ product_id: p, qty: 1, unit_price: 99999 }] })

    const r = await t.get(`/sales/summary?from=${from}&to=${to}`)
    expect(r.status).toBe(200)
    const s = r.body
    expect(s).toMatchObject({ count: 3, total: 21000, bottles: 10, cost: 10000, fees: 629, profit: 21000 - 629 - 10000, pending: 7000, pending_count: 1 })
    expect(s.avg_ticket).toBe(7000)
    expect(s.margin).toBeCloseTo((21000 - 629 - 10000) / 21000, 6)
    expect(s.by_channel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'local', label: 'Local / Tienda', total: 11000, count: 2 }),
        expect.objectContaining({ channel: 'online', label: 'Online / Redes', total: 10000, count: 1 }),
      ]),
    )
    const mp = s.by_payment_method.find((m: any) => m.method === 'mercadopago')
    expect(mp).toMatchObject({ label: 'Mercado Pago / QR', total: 10000, count: 1, fees: 629 })
    expect(s.by_day).toEqual([{ date: d, total: 21000, count: 3 }])
    // lo que te deben en total incluye todas las fechas
    expect(s.receivables.total).toBe(7000)
    // primera venta cargada (para no comparar contra períodos sin datos)
    expect(s.first_sale_date).toBe(addDays(from, -1))
  })

  it('con un período sin ventas devuelve todo en cero', async () => {
    const r = await t.get('/sales/summary?from=2020-01-01&to=2020-01-31')
    expect(r.body).toMatchObject({ count: 0, total: 0, bottles: 0, profit: 0, avg_ticket: 0, pending: 0, by_channel: [], by_day: [] })
  })
})

describe('cobros de una venta', () => {
  it('registra un cobro parcial, no deja cobrar de más y prorratea la comisión', async () => {
    const p = wine('Malbec', 20, 1000)
    const sale = (await t.post('/sales', { date: '2026-02-01', payment_method: 'mercadopago', paid: false, items: [{ product_id: p, qty: 5, unit_price: 2000 }] })).body
    expect(sale.fee).toBe(629)
    expect(feePayments(sale.id)).toBe(0) // sin cobro todavía, no se descontó comisión

    const mp = account('Mercado Pago')
    const partial = await t.post(`/sales/${sale.id}/payments`, { date: '2026-02-05', amount: 4000, account_id: mp.id })
    expect(partial.status).toBe(201)
    expect(partial.body).toMatchObject({ paid: 4000, balance: 6000, status: 'parcial' })
    expect(partial.body.payments).toHaveLength(1)
    expect(feePayments(sale.id)).toBe(251.6) // 629 × 4.000 / 10.000

    const over = await t.post(`/sales/${sale.id}/payments`, { date: '2026-02-06', amount: 6001, account_id: mp.id })
    expect(over.status).toBe(400)
    expect(over.body.error).toMatch(/no puede superar/)

    const rest = await t.post(`/sales/${sale.id}/payments`, { date: '2026-02-06', amount: 6000, account_id: mp.id })
    expect(rest.body).toMatchObject({ paid: 10000, balance: 0, status: 'pagado' })
    expect(feePayments(sale.id)).toBeCloseTo(629, 2)

    const again = await t.post(`/sales/${sale.id}/payments`, { date: '2026-02-07', amount: 1, account_id: mp.id })
    expect(again.status).toBe(400)
    expect(again.body.error).toMatch(/ya está saldada/)
  })

  it('valida el cobro y responde 404 si la venta no existe', async () => {
    const p = wine('Malbec')
    const sale = (await t.post('/sales', { date: '2026-02-01', paid: false, items: [{ product_id: p, qty: 1, unit_price: 1000 }] })).body
    const noAccount = await t.post(`/sales/${sale.id}/payments`, { date: '2026-02-05', amount: 100 })
    expect(noAccount.status).toBe(400)
    expect(noAccount.body.error).toMatch(/Cuenta/)
    const zero = await t.post(`/sales/${sale.id}/payments`, { date: '2026-02-05', amount: 0, account_id: 1 })
    expect(zero.status).toBe(400)
    expect((await t.post('/sales/9999/payments', { date: '2026-02-05', amount: 100, account_id: 1 })).status).toBe(404)
  })
})

describe('editar y borrar', () => {
  it('editar cambia renglones y devuelve el stock que corresponde', async () => {
    const a = wine('Malbec', 20)
    const b = wine('Merlot', 10)
    const sale = (await t.post('/sales', { date: '2026-02-01', items: [{ product_id: a, qty: 5, unit_price: 2000 }] })).body
    expect(stockOf(a)).toBe(15)

    const r = await t.put(`/sales/${sale.id}`, { date: '2026-02-01', items: [{ product_id: a, qty: 2, unit_price: 2000 }, { product_id: b, qty: 1, unit_price: 3000 }] })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: sale.id, total: 7000, paid: 7000, status: 'pagado', bottles: 3 })
    expect(r.body.payments).toHaveLength(1)
    expect(stockOf(a)).toBe(18)
    expect(stockOf(b)).toBe(9)
  })

  it('pasar una venta cobrada a "sin cobrar" borra sus cobros; con cobros parciales no deja bajar el total por debajo de lo cobrado', async () => {
    const p = wine('Malbec', 20)
    const sale = (await t.post('/sales', { date: '2026-02-01', items: [{ product_id: p, qty: 2, unit_price: 2000 }] })).body
    const unpaid = await t.put(`/sales/${sale.id}`, { date: '2026-02-01', paid: false, items: [{ product_id: p, qty: 2, unit_price: 2000 }] })
    expect(unpaid.body).toMatchObject({ paid: 0, status: 'pendiente' })
    expect(unpaid.body.payments).toHaveLength(0)

    await t.post(`/sales/${sale.id}/payments`, { date: '2026-02-03', amount: 3000, account_id: account('Caja').id })
    const tooLow = await t.put(`/sales/${sale.id}`, { date: '2026-02-01', paid: false, items: [{ product_id: p, qty: 1, unit_price: 2000 }] })
    expect(tooLow.status).toBe(400)
    expect(tooLow.body.error).toMatch(/Ya cobraste/)

    const keep = await t.put(`/sales/${sale.id}`, { date: '2026-02-01', paid: false, items: [{ product_id: p, qty: 3, unit_price: 2000 }] })
    expect(keep.body).toMatchObject({ total: 6000, paid: 3000, balance: 3000, status: 'parcial' })
  })

  it('borrar devuelve las botellas al stock y saca la plata de la caja', async () => {
    const p = wine('Malbec', 20)
    const cajaAntes = account('Caja').balance
    const sale = (await t.post('/sales', { date: '2026-02-01', items: [{ product_id: p, qty: 4, unit_price: 2500 }] })).body
    expect(stockOf(p)).toBe(16)
    expect(account('Caja').balance).toBe(cajaAntes + 10000)

    const del = await t.del(`/sales/${sale.id}`)
    expect(del.status).toBe(200)
    expect(del.body).toEqual({ ok: true })
    expect(stockOf(p)).toBe(20)
    expect(account('Caja').balance).toBe(cajaAntes)
    expect(get("SELECT COUNT(*) AS n FROM payments WHERE ref_id = ? AND ref_type IN ('sale','sale_fee')", [sale.id])).toEqual({ n: 0 })
    expect((await t.get(`/sales/${sale.id}`)).status).toBe(404)
  })

  it('responde 404 amable cuando la venta no existe', async () => {
    const p = wine('Malbec')
    for (const r of [
      await t.get('/sales/9999'),
      await t.get('/sales/abc'),
      await t.put('/sales/9999', { date: '2026-02-01', items: [{ product_id: p, qty: 1, unit_price: 1 }] }),
      await t.del('/sales/9999'),
      await t.get('/sales/9999/receipt'),
    ]) {
      expect(r.status).toBe(404)
      expect(r.body.error).toMatch(/No encontramos/)
    }
  })
})

describe('Excel y comprobante', () => {
  it('exporta un Excel con las hojas "Ventas" y "Detalle por vino"', async () => {
    const p = wine('Malbec')
    await t.post('/sales', { date: '2026-02-01', items: [{ product_id: p, qty: 2, unit_price: 2000 }, { description: 'Caja de regalo', qty: 1, unit_price: 800 }] })
    await t.post('/sales', { date: '2026-02-02', paid: false, items: [{ product_id: p, qty: 1, unit_price: 2000 }] })
    await t.post('/sales', { date: '2026-03-02', items: [{ product_id: p, qty: 1, unit_price: 2000 }] })

    const res = await t.raw('/sales/export?from=2026-02-01&to=2026-02-28')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('spreadsheetml')
    expect(res.headers.get('content-disposition')).toMatch(/vinoh-ventas-.*\.xlsx/)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ventas = wb.getWorksheet('Ventas')!
    const detalle = wb.getWorksheet('Detalle por vino')!
    expect(ventas).toBeTruthy()
    expect(detalle).toBeTruthy()
    expect(ventas.getRow(4).getCell(1).value).toBe('Fecha')
    // 2 ventas de febrero (filas 5 y 6) + total en la 7
    expect(ventas.getRow(7).getCell(1).value).toBe('TOTAL')
    // 3 renglones de febrero + total
    expect(detalle.getRow(8).getCell(1).value).toBe('TOTAL')
    const text = JSON.stringify(ventas.getSheetValues())
    expect(text).toContain('Por cobrar')
    expect(text).toContain('¿Cómo leer esta planilla?')

    const pending = await t.raw('/sales/export?from=2026-02-01&to=2026-02-28&status=por_cobrar')
    const wb2 = new ExcelJS.Workbook()
    await wb2.xlsx.load(await pending.arrayBuffer())
    expect(wb2.getWorksheet('Ventas')!.getRow(6).getCell(1).value).toBe('TOTAL')
    expect(String(wb2.getWorksheet('Ventas')!.getRow(2).getCell(1).value)).toContain('Filtro: solo por cobrar')
  })

  it('arma un comprobante imprimible con los datos del negocio (y escapa lo que escribe el usuario)', async () => {
    const p = wine('Malbec <Reserva>')
    await t.put('/settings', { business: { name: 'VINOH! Test', address: 'Av. Siempre Viva 742' } })
    const c = client('Juan "el sommelier"')
    const sale = (
      await t.post('/sales', { date: '2026-02-01', client_id: c, notes: '<script>alert(1)</script>', items: [{ product_id: p, qty: 2, unit_price: 2000 }] })
    ).body
    const res = await t.raw(`/sales/${sale.id}/receipt`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('VINOH! Test')
    expect(html).toContain('Av. Siempre Viva 742')
    expect(html).toContain('no válido como factura')
    expect(html).toContain('Malbec &lt;Reserva&gt;')
    expect(html).toContain('Juan &quot;el sommelier&quot;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('window.print() }, 250)')
    expect(await (await t.raw(`/sales/${sale.id}/receipt?print=1`)).text()).toContain('window.print() }, 250)')
  })
})
