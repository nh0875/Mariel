// Tests de la API de Compras: alta (pagada / a plazo) con flete repartido y costo promedio,
// filtros, resumen del período (con CMV), edición y borrado (recalculan stock y costo),
// pagos parciales, borrado de pagos, validaciones y Excel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { get, run } from '../db'
import { addMovement } from '../services/stock'
import { accountBalances } from '../services/payments'
import { createSale } from '../services/sales'
import { saleInput } from '../../shared/schemas'
import { addDays, today } from '../../shared/dates'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

/** Vino con stock inicial y costo, directo en la base (no depende del módulo Vinos). */
function wine(name: string, stock = 0, cost = 0) {
  const id = run('INSERT INTO products (name, winery, price_retail, price_wholesale) VALUES (?, ?, ?, ?)', [name, 'Bodega Test', 3000, 2500]).lastInsertRowid
  if (stock > 0) addMovement({ product_id: id, date: '2026-01-01', kind: 'inicial', qty: stock, unit_cost: cost })
  return id
}
const product = (id: number) => get<{ stock: number; unit_cost: number }>('SELECT stock, unit_cost FROM products WHERE id = ?', [id])!
const supplier = (name: string) => run('INSERT INTO suppliers (name, kind) VALUES (?, ?)', [name, 'bodega']).lastInsertRowid
const account = (prefix: string) => accountBalances().find((a) => a.name.startsWith(prefix))!

/** Compra típica: 10 Malbec a $1.200 + 6 Torrontés a $800 + $1.680 de flete (10 % del subtotal). */
function basePurchase(malbec: number, torrontes: number, extra: Record<string, unknown> = {}) {
  return {
    date: '2026-02-10',
    invoice_number: 'A-0001-00001234',
    items: [
      { product_id: malbec, qty: 10, unit_cost: 1200 },
      { product_id: torrontes, qty: 6, unit_cost: 800 },
    ],
    shipping: 1680,
    ...extra,
  }
}

describe('POST /purchases', () => {
  it('crea una compra pagada: reparte el flete, actualiza stock y costo promedio, y sale la plata de la cuenta', async () => {
    const malbec = wine('Malbec', 10, 1000)
    const torrontes = wine('Torrontés')
    const cerros = supplier('Bodega Los Cerros')
    const banco = account('Banco')

    const r = await t.post('/purchases', basePurchase(malbec, torrontes, { supplier_id: cerros, paid: true, account_id: banco.id }))
    expect(r.status).toBe(201)
    expect(r.body.id).toBeGreaterThan(0)
    expect(r.body).toMatchObject({
      supplier_id: cerros,
      supplier_name: 'Bodega Los Cerros',
      subtotal: 16800,
      shipping: 1680,
      total: 18480,
      bottles: 16,
      items_count: 2,
      paid: 18480,
      balance: 0,
      status: 'pagado',
      overdue: false,
    })

    // Flete repartido según el precio: cada vino absorbe el 10 % de su precio.
    const m = r.body.items.find((i: any) => i.product_id === malbec)
    const tt = r.body.items.find((i: any) => i.product_id === torrontes)
    expect(m).toMatchObject({ product_name: 'Malbec', qty: 10, unit_cost: 1200, landed_unit_cost: 1320, freight_per_bottle: 120, line_total: 12000, landed_total: 13200 })
    expect(tt).toMatchObject({ unit_cost: 800, landed_unit_cost: 880, freight_per_bottle: 80, landed_total: 5280 })
    expect(m.landed_total + tt.landed_total).toBe(r.body.total)

    // Costo promedio ponderado: (10 × 1.000 + 10 × 1.320) ÷ 20 = 1.160
    expect(product(malbec)).toEqual({ stock: 20, unit_cost: 1160 })
    expect(product(torrontes)).toEqual({ stock: 6, unit_cost: 880 })

    // El pago sale del banco y queda con el nombre de la cuenta.
    expect(r.body.payments).toHaveLength(1)
    expect(r.body.payments[0]).toMatchObject({ amount: 18480, direction: 'out', account_id: banco.id, account_name: 'Banco' })
    expect(account('Banco').balance).toBe(banco.balance - 18480)
  })

  it('crea una compra a plazo: queda por pagar (vencida si pasó la fecha), sin tocar la caja, pero el stock entra igual', async () => {
    const malbec = wine('Malbec', 0, 0)
    const torrontes = wine('Torrontés')
    const before = accountBalances().reduce((s, a) => s + a.balance, 0)
    const due = addDays(today(), -3)
    const r = await t.post('/purchases', basePurchase(malbec, torrontes, { date: addDays(today(), -33), paid: false, due_date: due, shipping: 0 }))
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ total: 16800, paid: 0, balance: 16800, status: 'pendiente', due_date: due, overdue: true })
    expect(r.body.payments).toHaveLength(0)
    expect(accountBalances().reduce((s, a) => s + a.balance, 0)).toBe(before)
    expect(product(malbec)).toEqual({ stock: 10, unit_cost: 1200 })
  })

  it('sin cuenta elegida, el pago sale de la cuenta configurada para transferencias (Banco)', async () => {
    const p = wine('Bonarda')
    const banco = account('Banco')
    const r = await t.post('/purchases', { date: '2026-03-01', items: [{ product_id: p, qty: 6, unit_cost: 500 }] })
    expect(r.status).toBe(201)
    expect(r.body.payments[0].account_id).toBe(banco.id)
  })

  it('si todo vino bonificado (precio 0), el flete se reparte por botella', async () => {
    const a = wine('Muestra A')
    const b = wine('Muestra B')
    const r = await t.post('/purchases', {
      date: '2026-03-02',
      items: [
        { product_id: a, qty: 2, unit_cost: 0 },
        { product_id: b, qty: 6, unit_cost: 0 },
      ],
      shipping: 800,
    })
    expect(r.status).toBe(201)
    expect(r.body.items.map((i: any) => i.landed_unit_cost)).toEqual([100, 100])
    expect(r.body.total).toBe(800)
  })

  it('valida con mensajes claros', async () => {
    const p = wine('Syrah')
    const noItems = await t.post('/purchases', { date: '2026-02-01', items: [] })
    expect(noItems.status).toBe(400)
    expect(noItems.body.error).toMatch(/Revisá/)

    const zeroQty = await t.post('/purchases', { date: '2026-02-01', items: [{ product_id: p, qty: 0, unit_cost: 100 }] })
    expect(zeroQty.status).toBe(400)
    expect(zeroQty.body.error).toMatch(/Cantidad \(renglón 1\)/)

    const negative = await t.post('/purchases', { date: '2026-02-01', items: [{ product_id: p, qty: 1, unit_cost: -5 }] })
    expect(negative.status).toBe(400)
    expect(negative.body.error).toMatch(/Costo/)

    const noDate = await t.post('/purchases', { items: [{ product_id: p, qty: 1, unit_cost: 100 }] })
    expect(noDate.status).toBe(400)
    expect(noDate.body.error).toMatch(/Fecha/)

    const ghostWine = await t.post('/purchases', { date: '2026-02-01', items: [{ product_id: 9999, qty: 1, unit_cost: 100 }] })
    expect(ghostWine.status).toBe(400)
    expect(ghostWine.body.error).toMatch(/no existe/)

    const ghostSupplier = await t.post('/purchases', { date: '2026-02-01', supplier_id: 777, items: [{ product_id: p, qty: 1, unit_cost: 100 }] })
    expect(ghostSupplier.status).toBe(400)
    expect(ghostSupplier.body.error).toMatch(/proveedor/)

    const badDue = await t.post('/purchases', { date: '2026-02-10', due_date: '2026-02-01', paid: false, items: [{ product_id: p, qty: 1, unit_cost: 100 }] })
    expect(badDue.status).toBe(400)
    expect(badDue.body.error).toMatch(/vencimiento/)

    const ghostAccount = await t.post('/purchases', { date: '2026-02-01', account_id: 555, items: [{ product_id: p, qty: 1, unit_cost: 100 }] })
    expect(ghostAccount.status).toBe(400)
    expect(ghostAccount.body.error).toMatch(/cuenta/)

    // Ninguna de las rechazadas tocó el stock.
    expect(product(p).stock).toBe(0)
    const list = await t.get('/purchases')
    expect(list.body).toHaveLength(0)
  })
})

describe('GET /purchases', () => {
  it('filtra por fecha, proveedor, vino y estado (por pagar / vencidas), con el resumen de vinos', async () => {
    const malbec = wine('Malbec')
    const torrontes = wine('Torrontés')
    const s1 = supplier('Bodega Uno')
    const s2 = supplier('Bodega Dos')
    const paid = await t.post('/purchases', { date: '2026-02-03', supplier_id: s1, items: [{ product_id: malbec, qty: 12, unit_cost: 1000 }] })
    const owed = await t.post('/purchases', {
      date: '2026-02-20',
      supplier_id: s2,
      paid: false,
      due_date: addDays(today(), 10),
      items: [
        { product_id: torrontes, qty: 6, unit_cost: 700 },
        { product_id: malbec, qty: 6, unit_cost: 1100 },
      ],
    })
    const late = await t.post('/purchases', {
      date: '2026-03-05',
      supplier_id: s2,
      paid: false,
      due_date: addDays(today(), -1),
      items: [{ product_id: torrontes, qty: 6, unit_cost: 700 }],
    })

    const feb = await t.get('/purchases?from=2026-02-01&to=2026-02-28')
    expect(feb.body.map((p: any) => p.id)).toEqual([owed.body.id, paid.body.id]) // más nuevas primero
    expect(feb.body[0].items_preview).toEqual([
      { name: 'Torrontés', qty: 6 },
      { name: 'Malbec', qty: 6 },
    ])

    const bySupplier = await t.get(`/purchases?supplier_id=${s2}`)
    expect(bySupplier.body.map((p: any) => p.id)).toEqual([late.body.id, owed.body.id])

    const byWine = await t.get(`/purchases?product_id=${malbec}`)
    expect(byWine.body.map((p: any) => p.id).sort()).toEqual([paid.body.id, owed.body.id].sort())

    const porPagar = await t.get('/purchases?status=por_pagar')
    expect(porPagar.body.map((p: any) => p.id).sort()).toEqual([owed.body.id, late.body.id].sort())

    const vencidas = await t.get('/purchases?status=vencida')
    expect(vencidas.body.map((p: any) => p.id)).toEqual([late.body.id])

    const pagadas = await t.get('/purchases?status=pagado')
    expect(pagadas.body.map((p: any) => p.id)).toEqual([paid.body.id])

    const bad = await t.get('/purchases?status=cualquiera')
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/estado/)
  })
})

describe('GET /purchases/summary', () => {
  it('suma lo comprado, botellas, costo real por botella, por proveedor, lo que falta pagar y el CMV del período', async () => {
    const malbec = wine('Malbec', 10, 1000)
    const torrontes = wine('Torrontés')
    const s1 = supplier('Bodega Los Cerros')
    const s2 = supplier('Cava del Valle')
    await t.post('/purchases', basePurchase(malbec, torrontes, { supplier_id: s1 })) // 18.480, 16 botellas
    await t.post('/purchases', {
      date: '2026-02-15',
      supplier_id: s2,
      paid: false,
      due_date: addDays(today(), -5),
      items: [{ product_id: torrontes, qty: 12, unit_cost: 900 }],
      shipping: 600,
    }) // 11.400, 12 botellas
    await t.post('/purchases', { date: '2026-02-16', items: [{ product_id: malbec, qty: 2, unit_cost: 1000 }] }) // sin proveedor, 2.000
    await t.post('/purchases', { date: '2026-03-01', supplier_id: s1, items: [{ product_id: malbec, qty: 6, unit_cost: 1000 }] }) // otro mes

    // Una venta en febrero: 5 Malbec. El CMV sale del costo promedio de ese momento.
    createSale(saleInput.parse({ date: '2026-02-20', items: [{ product_id: malbec, qty: 5, unit_price: 3000 }] }))

    const r = await t.get('/purchases/summary?from=2026-02-01&to=2026-02-28')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
      count: 3,
      total: 31880,
      subtotal: 29600,
      shipping: 2280,
      bottles: 30,
      pending: 11400,
      pending_count: 1,
    })
    expect(r.body.avg_cost_per_bottle).toBeCloseTo(31880 / 30, 2)
    expect(r.body.avg_invoice_cost).toBeCloseTo(29600 / 30, 2)
    expect(r.body.payables).toMatchObject({ total: 11400, count: 1, overdue: 11400, overdue_count: 1 })
    expect(r.body.by_supplier).toEqual([
      { supplier_id: s1, name: 'Bodega Los Cerros', total: 18480, bottles: 16, count: 1 },
      { supplier_id: s2, name: 'Cava del Valle', total: 11400, bottles: 12, count: 1 },
      { supplier_id: null, name: 'Sin proveedor', total: 2000, bottles: 2, count: 1 },
    ])
    // Malbec: 10 a 1.000 + 10 a 1.320 = 1.160; +2 a 1.000 → (20 × 1.160 + 2 × 1.000) ÷ 22 ≈ 1.145,45. 5 vendidas.
    expect(r.body.cogs).toBeCloseTo(5 * ((20 * 1160 + 2 * 1000) / 22), 1)
    expect(r.body.monthly_mode).toBe('last6')
    expect(r.body.monthly).toHaveLength(6)
    const febPoint = r.body.monthly.find((m: any) => m.month === '2026-02')
    expect(febPoint.purchases).toBe(31880)
    expect(r.body.stock_value.bottles).toBe(10 + 16 + 12 + 2 + 6 - 5)
    expect(r.body.first_purchase_date).toBe('2026-02-10')
  })

  it('con un período largo arma la serie por mes de ese período', async () => {
    const p = wine('Malbec')
    await t.post('/purchases', { date: '2026-01-10', items: [{ product_id: p, qty: 6, unit_cost: 1000 }] })
    await t.post('/purchases', { date: '2026-03-10', items: [{ product_id: p, qty: 6, unit_cost: 1000 }] })
    const r = await t.get('/purchases/summary?from=2026-01-01&to=2026-03-31')
    expect(r.body.monthly_mode).toBe('period')
    expect(r.body.monthly.map((m: any) => [m.month, m.purchases])).toEqual([
      ['2026-01', 6000],
      ['2026-02', 0],
      ['2026-03', 6000],
    ])
  })

  it('sin compras devuelve todo en cero (sin dividir por cero)', async () => {
    const r = await t.get('/purchases/summary?from=2026-02-01&to=2026-02-28')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ count: 0, total: 0, bottles: 0, avg_cost_per_bottle: 0, shipping_share: 0, by_supplier: [], first_purchase_date: null })
  })
})

describe('GET /purchases/last-prices', () => {
  it('devuelve el último precio de factura (sin flete) de cada vino, prefiriendo el del proveedor elegido', async () => {
    const malbec = wine('Malbec', 10, 1000)
    const torrontes = wine('Torrontés')
    const s1 = supplier('Bodega Uno')
    const s2 = supplier('Distribuidora Dos')
    await t.post('/purchases', { date: '2026-01-10', supplier_id: s1, shipping: 3000, items: [{ product_id: malbec, qty: 10, unit_cost: 1100 }] })
    await t.post('/purchases', { date: '2026-02-10', supplier_id: s2, items: [{ product_id: malbec, qty: 10, unit_cost: 1300 }, { product_id: torrontes, qty: 6, unit_cost: 800 }] })

    const any = await t.get('/purchases/last-prices')
    expect(any.status).toBe(200)
    const byId = new Map(any.body.map((r: { product_id: number }) => [r.product_id, r]))
    // El último precio es el de factura (1.300), no el costo promedio (que incluye el flete de la primera compra).
    expect(byId.get(malbec)).toMatchObject({ unit_cost: 1300, date: '2026-02-10', supplier_name: 'Distribuidora Dos', same_supplier: false })
    expect(byId.get(torrontes)).toMatchObject({ unit_cost: 800 })
    expect(product(malbec).unit_cost).toBeCloseTo(1233.3333, 3) // promedio con flete: no sirve como precio de factura

    const fromS1 = await t.get(`/purchases/last-prices?supplier_id=${s1}`)
    const m1 = fromS1.body.find((r: { product_id: number }) => r.product_id === malbec)
    expect(m1).toMatchObject({ unit_cost: 1100, date: '2026-01-10', same_supplier: true })
    // Un vino que nunca le compraste a ese proveedor: se sugiere el último de cualquier proveedor.
    expect(fromS1.body.find((r: { product_id: number }) => r.product_id === torrontes)).toMatchObject({ unit_cost: 800, same_supplier: false })
  })
})

describe('GET /purchases/:id', () => {
  it('devuelve 404 si no existe o el id no es válido', async () => {
    const r = await t.get('/purchases/999')
    expect(r.status).toBe(404)
    expect(r.body.error).toMatch(/No encontramos/)
    const bad = await t.get('/purchases/abc')
    expect(bad.status).toBe(404)
  })
})

describe('PUT /purchases/:id', () => {
  it('editar cantidades, precio y flete recalcula stock, costo real y costo promedio', async () => {
    const malbec = wine('Malbec', 10, 1000)
    const torrontes = wine('Torrontés')
    const r = await t.post('/purchases', basePurchase(malbec, torrontes))
    const up = await t.put(`/purchases/${r.body.id}`, {
      date: '2026-02-10',
      items: [{ product_id: malbec, qty: 20, unit_cost: 1300 }],
      shipping: 2600,
    })
    expect(up.status).toBe(200)
    expect(up.body).toMatchObject({ subtotal: 26000, shipping: 2600, total: 28600, bottles: 20, status: 'pagado', paid: 28600 })
    expect(up.body.items).toHaveLength(1)
    expect(up.body.items[0].landed_unit_cost).toBe(1430)
    // (10 × 1.000 + 20 × 1.430) ÷ 30 = 1.286,67
    expect(product(malbec).stock).toBe(30)
    expect(product(malbec).unit_cost).toBeCloseTo(1286.6667, 3)
    // El Torrontés salió de la compra: vuelve a 0.
    expect(product(torrontes).stock).toBe(0)
  })

  it('pasar de pagada a "sin pagar" borra el pago; con pagos parciales no deja bajar el total por debajo de lo pagado', async () => {
    const p = wine('Cabernet')
    const banco = account('Banco')
    const r = await t.post('/purchases', { date: '2026-02-01', items: [{ product_id: p, qty: 10, unit_cost: 1000 }], account_id: banco.id })
    const unpaid = await t.put(`/purchases/${r.body.id}`, { date: '2026-02-01', items: [{ product_id: p, qty: 10, unit_cost: 1000 }], paid: false })
    expect(unpaid.body).toMatchObject({ paid: 0, balance: 10000, status: 'pendiente' })
    expect(account('Banco').balance).toBe(banco.balance)

    await t.post(`/purchases/${r.body.id}/payments`, { date: '2026-02-05', amount: 6000, account_id: banco.id })
    const tooLow = await t.put(`/purchases/${r.body.id}`, { date: '2026-02-01', items: [{ product_id: p, qty: 5, unit_cost: 1000 }], paid: false })
    expect(tooLow.status).toBe(400)
    expect(tooLow.body.error).toMatch(/Ya le pagaste/)
    // La compra no cambió.
    expect(product(p).stock).toBe(10)

    // Marcarla pagada con un total menor a lo pagado: el pago parcial se recorta al nuevo total (y conserva su fecha).
    const full = await t.put(`/purchases/${r.body.id}`, { date: '2026-02-01', items: [{ product_id: p, qty: 5, unit_cost: 1000 }], paid: true })
    expect(full.status).toBe(200)
    expect(full.body).toMatchObject({ total: 5000, paid: 5000, status: 'pagado' })
    expect(full.body.payments).toHaveLength(1)
    expect(full.body.payments[0]).toMatchObject({ account_id: banco.id, date: '2026-02-05', amount: 5000 })
  })

  it('editar una compra que pagaste después (a 30 días) NO mueve el pago: conserva su fecha, su cuenta y el vencimiento', async () => {
    const p = wine('Malbec')
    const mp = account('Mercado Pago')
    const r = await t.post('/purchases', { date: '2026-02-01', paid: false, due_date: '2026-03-03', items: [{ product_id: p, qty: 10, unit_cost: 1000 }] })
    await t.post(`/purchases/${r.body.id}/payments`, { date: '2026-03-03', amount: 10000, account_id: mp.id })
    const before = account('Mercado Pago').balance

    // Solo corrijo el número de factura (como lo manda el formulario: pagada, con la cuenta del pago).
    const fix = await t.put(`/purchases/${r.body.id}`, {
      date: '2026-02-01',
      invoice_number: 'B-0002-00000099',
      due_date: '2026-03-03',
      items: [{ product_id: p, qty: 10, unit_cost: 1000 }],
      paid: true,
      account_id: mp.id,
    })
    expect(fix.status).toBe(200)
    expect(fix.body).toMatchObject({ invoice_number: 'B-0002-00000099', status: 'pagado', due_date: '2026-03-03' })
    expect(fix.body.payments).toHaveLength(1)
    expect(fix.body.payments[0]).toMatchObject({ date: '2026-03-03', account_id: mp.id, amount: 10000 })
    expect(account('Mercado Pago').balance).toBe(before)

    // Corrijo el precio: el pago se ajusta al nuevo total, pero sigue siendo del 3/3.
    const up = await t.put(`/purchases/${r.body.id}`, { date: '2026-02-01', items: [{ product_id: p, qty: 10, unit_cost: 1100 }], paid: true, account_id: mp.id })
    expect(up.body).toMatchObject({ total: 11000, paid: 11000, status: 'pagado' })
    expect(up.body.payments).toEqual([expect.objectContaining({ date: '2026-03-03', account_id: mp.id, amount: 11000 })])
    expect(account('Mercado Pago').balance).toBe(before - 1000)
  })

  it('pagada en dos partes: bajar el total recorta el último pago; elegir otra cuenta mueve los pagos a esa cuenta', async () => {
    const p = wine('Syrah')
    const banco = account('Banco')
    const caja = account('Caja')
    const r = await t.post('/purchases', { date: '2026-02-01', paid: false, items: [{ product_id: p, qty: 10, unit_cost: 1000 }] })
    await t.post(`/purchases/${r.body.id}/payments`, { date: '2026-02-10', amount: 4000, account_id: banco.id })
    await t.post(`/purchases/${r.body.id}/payments`, { date: '2026-02-20', amount: 6000, account_id: banco.id })

    const lower = await t.put(`/purchases/${r.body.id}`, { date: '2026-02-01', items: [{ product_id: p, qty: 8, unit_cost: 1000 }], paid: true, account_id: banco.id })
    expect(lower.body).toMatchObject({ total: 8000, paid: 8000, status: 'pagado' })
    expect(lower.body.payments.map((x: { date: string; amount: number }) => [x.date, x.amount])).toEqual([
      ['2026-02-10', 4000],
      ['2026-02-20', 4000],
    ])

    const moved = await t.put(`/purchases/${r.body.id}`, { date: '2026-02-01', items: [{ product_id: p, qty: 8, unit_cost: 1000 }], paid: true, account_id: caja.id })
    expect(moved.body.payments.map((x: { date: string; account_id: number }) => [x.date, x.account_id])).toEqual([
      ['2026-02-10', caja.id],
      ['2026-02-20', caja.id],
    ])
  })

  it('pagada en parte y la marcás pagada: se mantienen los pagos y se agrega uno por lo que faltaba', async () => {
    const p = wine('Bonarda')
    const banco = account('Banco')
    const caja = account('Caja')
    const r = await t.post('/purchases', { date: '2026-02-01', paid: false, items: [{ product_id: p, qty: 10, unit_cost: 1000 }] })
    await t.post(`/purchases/${r.body.id}/payments`, { date: '2026-02-15', amount: 3000, account_id: banco.id })
    const full = await t.put(`/purchases/${r.body.id}`, { date: '2026-02-01', items: [{ product_id: p, qty: 10, unit_cost: 1000 }], paid: true, account_id: caja.id })
    expect(full.body).toMatchObject({ total: 10000, paid: 10000, balance: 0, status: 'pagado' })
    expect(full.body.payments.map((x: { date: string; amount: number; account_id: number }) => [x.date, x.amount, x.account_id])).toEqual([
      ['2026-02-15', 3000, banco.id],
      ['2026-02-15', 7000, caja.id],
    ])
  })

  it('si el pago era del mismo día que la compra y cambiás la fecha, el pago acompaña', async () => {
    const p = wine('Petit Verdot')
    const r = await t.post('/purchases', { date: '2026-02-01', items: [{ product_id: p, qty: 2, unit_cost: 1000 }] })
    const up = await t.put(`/purchases/${r.body.id}`, { date: '2026-02-03', items: [{ product_id: p, qty: 2, unit_cost: 1000 }], paid: true })
    expect(up.body.payments).toEqual([expect.objectContaining({ date: '2026-02-03', amount: 2000 })])
  })

  it('404 si la compra no existe', async () => {
    const p = wine('Merlot')
    const r = await t.put('/purchases/4040', { date: '2026-02-01', items: [{ product_id: p, qty: 1, unit_cost: 100 }] })
    expect(r.status).toBe(404)
  })
})

describe('DELETE /purchases/:id', () => {
  it('saca las botellas del stock, recalcula el costo y devuelve la plata a la cuenta', async () => {
    const malbec = wine('Malbec', 10, 1000)
    const torrontes = wine('Torrontés')
    const banco = account('Banco')
    const r = await t.post('/purchases', basePurchase(malbec, torrontes, { account_id: banco.id }))
    expect(product(malbec).unit_cost).toBe(1160)

    const del = await t.del(`/purchases/${r.body.id}`)
    expect(del.status).toBe(200)
    expect(del.body).toEqual({ ok: true })
    expect(product(malbec)).toEqual({ stock: 10, unit_cost: 1000 })
    expect(product(torrontes).stock).toBe(0)
    expect(account('Banco').balance).toBe(banco.balance)
    expect((await t.get(`/purchases/${r.body.id}`)).status).toBe(404)
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE ref_type = 'purchase'")!.n).toBe(0)
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM stock_movements WHERE kind = 'compra'")!.n).toBe(0)

    const again = await t.del(`/purchases/${r.body.id}`)
    expect(again.status).toBe(404)
  })

  it('si ya se vendieron botellas de la compra, el costo de esas ventas se recalcula', async () => {
    const p = wine('Malbec', 10, 1000)
    const r = await t.post('/purchases', { date: '2026-02-01', items: [{ product_id: p, qty: 10, unit_cost: 2000 }] })
    const saleId = createSale(saleInput.parse({ date: '2026-02-10', items: [{ product_id: p, qty: 4, unit_price: 4000 }] }))
    expect(get<{ unit_cost: number }>('SELECT unit_cost FROM sale_items WHERE sale_id = ?', [saleId])!.unit_cost).toBe(1500)
    await t.del(`/purchases/${r.body.id}`)
    expect(get<{ unit_cost: number }>('SELECT unit_cost FROM sale_items WHERE sale_id = ?', [saleId])!.unit_cost).toBe(1000)
    expect(product(p).stock).toBe(6)
  })
})

describe('Pagos de compras', () => {
  it('registra pagos parciales hasta saldarla y no deja pagar de más', async () => {
    const p = wine('Malbec')
    const banco = account('Banco')
    const caja = account('Caja')
    const r = await t.post('/purchases', { date: '2026-02-01', paid: false, due_date: '2026-03-01', items: [{ product_id: p, qty: 10, unit_cost: 1000 }], shipping: 500 })
    const id = r.body.id

    const first = await t.post(`/purchases/${id}/payments`, { date: '2026-02-10', amount: 4000, account_id: banco.id, description: 'Primera parte' })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ paid: 4000, balance: 6500, status: 'parcial' })
    expect(first.body.payments[0]).toMatchObject({ description: 'Primera parte', account_name: 'Banco' })

    const tooMuch = await t.post(`/purchases/${id}/payments`, { date: '2026-02-11', amount: 7000, account_id: caja.id })
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body.error).toMatch(/falta pagar/)

    const rest = await t.post(`/purchases/${id}/payments`, { date: '2026-02-12', amount: 6500, account_id: caja.id })
    expect(rest.body).toMatchObject({ paid: 10500, balance: 0, status: 'pagado', overdue: false })
    expect(account('Banco').balance).toBe(banco.balance - 4000)
    expect(account('Caja').balance).toBe(caja.balance - 6500)

    const already = await t.post(`/purchases/${id}/payments`, { date: '2026-02-12', amount: 1, account_id: caja.id })
    expect(already.status).toBe(400)
    expect(already.body.error).toMatch(/saldada/)
  })

  it('valida el pago y responde 404 si la compra no existe', async () => {
    const p = wine('Malbec')
    const r = await t.post('/purchases', { date: '2026-02-01', paid: false, items: [{ product_id: p, qty: 1, unit_cost: 1000 }] })
    const zero = await t.post(`/purchases/${r.body.id}/payments`, { date: '2026-02-02', amount: 0, account_id: 1 })
    expect(zero.status).toBe(400)
    expect(zero.body.error).toMatch(/Monto/)
    const noAccount = await t.post(`/purchases/${r.body.id}/payments`, { date: '2026-02-02', amount: 10 })
    expect(noAccount.status).toBe(400)
    expect(noAccount.body.error).toMatch(/Cuenta/)
    const missing = await t.post('/purchases/999/payments', { date: '2026-02-02', amount: 10, account_id: 1 })
    expect(missing.status).toBe(404)
  })

  it('borra un pago: la compra vuelve a tener saldo y la plata vuelve a la cuenta', async () => {
    const p = wine('Malbec')
    const banco = account('Banco')
    const r = await t.post('/purchases', { date: '2026-02-01', paid: false, items: [{ product_id: p, qty: 10, unit_cost: 1000 }] })
    const other = await t.post('/purchases', { date: '2026-02-01', paid: false, items: [{ product_id: p, qty: 1, unit_cost: 1000 }] })
    const paid = await t.post(`/purchases/${r.body.id}/payments`, { date: '2026-02-03', amount: 2500, account_id: banco.id })
    const paymentId = paid.body.payments[0].id

    // Un pago de otra compra no se puede borrar desde acá.
    const wrong = await t.del(`/purchases/${other.body.id}/payments/${paymentId}`)
    expect(wrong.status).toBe(404)

    const del = await t.del(`/purchases/${r.body.id}/payments/${paymentId}`)
    expect(del.status).toBe(200)
    expect(del.body).toEqual({ ok: true })
    const after = await t.get(`/purchases/${r.body.id}`)
    expect(after.body).toMatchObject({ paid: 0, balance: 10000, status: 'pendiente' })
    expect(account('Banco').balance).toBe(banco.balance)

    const again = await t.del(`/purchases/${r.body.id}/payments/${paymentId}`)
    expect(again.status).toBe(404)
  })
})

describe('GET /purchases/export', () => {
  it('arma el Excel con las hojas "Compras" y "Detalle por vino" (con costo real con flete)', async () => {
    const malbec = wine('Malbec', 10, 1000)
    const torrontes = wine('Torrontés')
    const s1 = supplier('Bodega Los Cerros')
    await t.post('/purchases', basePurchase(malbec, torrontes, { supplier_id: s1 }))
    await t.post('/purchases', { date: '2026-05-01', items: [{ product_id: malbec, qty: 1, unit_cost: 1000 }] }) // fuera del período

    const res = await t.raw('/purchases/export?from=2026-02-01&to=2026-02-28')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/spreadsheetml/)
    expect(res.headers.get('content-disposition')).toMatch(/vinoh-compras-/)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Compras', 'Detalle por vino'])

    const compras = wb.getWorksheet('Compras')!
    expect(String(compras.getCell(2, 1).value)).toMatch(/01\/02\/2026 al 28\/02\/2026/)
    const headers = (compras.getRow(4).values as unknown[]).slice(1)
    expect(headers).toContain('Flete / envío')
    expect(compras.getCell(5, 3).value).toBe('Bodega Los Cerros')
    expect(compras.getCell(5, headers.indexOf('Total') + 1).value).toBe(18480)
    expect(compras.getCell(6, 1).value).toBe('TOTAL') // una sola compra en el período + fila de totales

    const detalle = wb.getWorksheet('Detalle por vino')!
    const dh = (detalle.getRow(4).values as unknown[]).slice(1)
    const landedCol = dh.indexOf('Costo real por botella') + 1
    expect(landedCol).toBeGreaterThan(0)
    expect(detalle.getCell(5, landedCol).value).toBe(1320)
    expect(detalle.getCell(6, landedCol).value).toBe(880)
    expect(detalle.getCell(5, dh.indexOf('Flete por botella') + 1).value).toBe(120)
  })

  it('respeta los filtros y lo aclara en el subtítulo', async () => {
    const p = wine('Malbec')
    const s1 = supplier('Bodega Uno')
    await t.post('/purchases', { date: '2026-02-01', supplier_id: s1, paid: false, items: [{ product_id: p, qty: 1, unit_cost: 1000 }] })
    await t.post('/purchases', { date: '2026-02-02', items: [{ product_id: p, qty: 1, unit_cost: 1000 }] })
    const res = await t.raw('/purchases/export?from=2026-02-01&to=2026-02-28&status=por_pagar')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer)
    const ws = wb.getWorksheet('Compras')!
    expect(String(ws.getCell(2, 1).value)).toMatch(/solo por pagar/)
    expect(ws.getCell(5, 3).value).toBe('Bodega Uno')
    expect(ws.getCell(6, 1).value).toBe('TOTAL')
  })

  it('"por pagar" sin fechas exporta todo lo que debés, de cualquier fecha (como la pantalla)', async () => {
    const p = wine('Malbec')
    await t.post('/purchases', { date: '2025-11-20', paid: false, items: [{ product_id: p, qty: 1, unit_cost: 1000 }] })
    await t.post('/purchases', { date: '2026-02-02', paid: false, items: [{ product_id: p, qty: 2, unit_cost: 1000 }] })
    await t.post('/purchases', { date: '2026-02-03', items: [{ product_id: p, qty: 3, unit_cost: 1000 }] }) // pagada
    const res = await t.raw('/purchases/export?status=por_pagar')
    expect(res.headers.get('content-disposition')).toMatch(/vinoh-compras-por-pagar-/)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer)
    const ws = wb.getWorksheet('Compras')!
    expect(String(ws.getCell(2, 1).value)).toMatch(/Todas las fechas/)
    expect(ws.getCell(7, 1).value).toBe('TOTAL') // las 2 por pagar + totales
    const detalle = wb.getWorksheet('Detalle por vino')!
    expect(detalle.getCell(7, 1).value).toBe('TOTAL')
  })
})
