// Tests de la API de Vinos y stock: catálogo, ajustes, costo, precios masivos, importación y Excel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { startTestServer, type TestServer } from './helpers'
import { all, get, run } from '../db'
import { createSale } from '../services/sales'
import { createPurchase } from '../services/purchases'
import { purchaseInput, saleInput } from '../../shared/schemas'
import { addDays, today } from '../../shared/dates'

let s: TestServer
beforeEach(async () => {
  s = await startTestServer()
})
afterEach(async () => {
  await s.close()
})

const base = { name: 'Malbec Clásico', winery: 'Bodega Los Cerros', varietal: 'Malbec', wine_type: 'tinto', vintage: 2023, price_retail: 12500, price_wholesale: 10300 }

async function newWine(extra: Record<string, unknown> = {}) {
  const r = await s.post('/products', { ...base, unit_cost: 7200, initial_stock: 24, ...extra })
  expect(r.status).toBe(201)
  return r.body
}

async function xlsxBuffer(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Vinos')
  for (const r of rows) ws.addRow(r)
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer)
}

async function upload(buf: Buffer) {
  const res = await s.raw('/products/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(buf) })
  return { status: res.status, body: await res.json() }
}

async function readXlsx(path: string) {
  const res = await s.raw(path)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('spreadsheetml')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await res.arrayBuffer())
  return wb
}

const rowTexts = (ws: ExcelJS.Worksheet, n: number) => {
  const out: string[] = []
  ws.getRow(n).eachCell((c) => out.push(String(c.text)))
  return out
}

describe('catálogo', () => {
  it('crea el vino con su movimiento inicial (stock y costo)', async () => {
    const p = await newWine()
    expect(p).toMatchObject({ name: 'Malbec Clásico', stock: 24, unit_cost: 7200, active: true, sold_90d: 0, days_of_stock: null, stock_value: 172800 })
    expect(p.margin_retail).toBeCloseTo(0.424, 3)
    const d = await s.get(`/products/${p.id}`)
    expect(d.body.movements).toHaveLength(1)
    expect(d.body.movements[0]).toMatchObject({ kind: 'inicial', qty: 24, unit_cost: 7200, saldo: 24, manual: false, date: today() })
  })

  it('aunque no tenga botellas, el vino arranca con su costo', async () => {
    const p = await newWine({ initial_stock: 0, unit_cost: 9000 })
    expect(p).toMatchObject({ stock: 0, unit_cost: 9000, stock_value: 0 })
    expect(get('SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ?', [p.id])).toEqual({ n: 1 })
  })

  it('valida los datos con mensajes claros', async () => {
    const r = await s.post('/products', { name: '  ', price_retail: -5 })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('Nombre')
    expect(r.body.error).toContain('Precio minorista')
  })

  it('no deja repetir el código (SKU)', async () => {
    await newWine({ sku: 'VH-1' })
    const r = await s.post('/products', { name: 'Otro', sku: 'vh-1' })
    expect(r.status).toBe(409)
    expect(r.body.error).toContain('VH-1')
  })

  it('lista ordenada por nombre, con filtro de activos y los extras', async () => {
    await newWine({ name: 'Torrontés' })
    await newWine({ name: 'Bonarda', active: false })
    const a = await newWine({ name: 'Ábalos Malbec' })
    const allP = await s.get('/products')
    expect(allP.body.map((p: { name: string }) => p.name)).toEqual(['Ábalos Malbec', 'Bonarda', 'Torrontés'])
    const active = await s.get('/products?active=1')
    expect(active.body.map((p: { name: string }) => p.name)).toEqual(['Ábalos Malbec', 'Torrontés'])
    const first = active.body[0]
    for (const k of [
      'id',
      'name',
      'winery',
      'unit_cost',
      'price_retail',
      'price_wholesale',
      'stock',
      'min_stock',
      'units_per_box',
      'active',
      'sold_90d',
      'days_of_stock',
      'margin_retail',
      'margin_wholesale',
      'stock_value',
    ]) {
      expect(first).toHaveProperty(k)
    }
    expect(first.id).toBe(a.id)
  })

  it('calcula vendidas en 90 días y días de stock', async () => {
    const p = await newWine({ initial_stock: 100 })
    createSale(saleInput.parse({ date: addDays(today(), -10), items: [{ product_id: p.id, qty: 30, unit_price: 12500 }] }))
    createSale(saleInput.parse({ date: addDays(today(), -120), items: [{ product_id: p.id, qty: 5, unit_price: 12500 }] }))
    const [row] = (await s.get('/products')).body
    expect(row.sold_90d).toBe(30)
    expect(row.stock).toBe(65)
    // 65 botellas ÷ (30 / 90 por día) = 195 días
    expect(row.days_of_stock).toBe(195)
  })

  it('editar no toca el costo ni el stock', async () => {
    const p = await newWine()
    const r = await s.put(`/products/${p.id}`, { ...base, name: 'Malbec Clásico 2024', price_retail: 13000, unit_cost: 1, initial_stock: 999, min_stock: 10 })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ name: 'Malbec Clásico 2024', price_retail: 13000, unit_cost: 7200, stock: 24, min_stock: 10 })
    expect((await s.put('/products/9999', base)).status).toBe(404)
    expect((await s.get('/products/9999')).status).toBe(404)
    expect((await s.get('/products/abc')).status).toBe(404)
  })

  it('borra un vino sin historia, pero protege uno con ventas o compras (409)', async () => {
    const libre = await newWine({ name: 'Sin historia' })
    await s.post(`/products/${libre.id}/cost`, { date: today(), unit_cost: 8000 })
    expect((await s.del(`/products/${libre.id}`)).body).toEqual({ ok: true })
    expect((await s.get(`/products/${libre.id}`)).status).toBe(404)
    expect(all('SELECT * FROM stock_movements WHERE product_id = ?', [libre.id])).toHaveLength(0)

    const vendido = await newWine({ name: 'Vendido' })
    createSale(saleInput.parse({ date: today(), items: [{ product_id: vendido.id, qty: 1, unit_price: 12500 }] }))
    const r = await s.del(`/products/${vendido.id}`)
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('Este vino tiene ventas o compras. Desactivalo en vez de borrarlo (así no se pierde la historia).')

    const comprado = await newWine({ name: 'Comprado' })
    createPurchase(purchaseInput.parse({ date: today(), items: [{ product_id: comprado.id, qty: 6, unit_cost: 7000 }], paid: false }))
    expect((await s.del(`/products/${comprado.id}`)).status).toBe(409)

    const roto = await newWine({ name: 'Con rotura' })
    await s.post(`/products/${roto.id}/adjust`, { date: today(), kind: 'rotura', qty: 1 })
    const r2 = await s.del(`/products/${roto.id}`)
    expect(r2.status).toBe(409)
    expect(r2.body.error).toContain('movimientos de stock')
    expect((await s.del('/products/9999')).status).toBe(404)
  })
})

describe('ajustes de stock y costo', () => {
  it('pone el signo según el tipo de movimiento', async () => {
    const p = await newWine({ initial_stock: 20 })
    const cases: [string, number, number][] = [
      ['rotura', 2, 18],
      ['degustacion', 1, 17],
      ['regalo', 3, 14],
      ['consumo', 1, 13],
      ['devolucion', 2, 15],
      ['ajuste', -4, 11],
      ['ajuste', 1, 12],
    ]
    for (const [kind, qty, expected] of cases) {
      const r = await s.post(`/products/${p.id}/adjust`, { date: today(), kind, qty })
      expect(r.status, kind).toBe(200)
      expect(r.body.stock, kind).toBe(expected)
    }
    const qtys = all<{ kind: string; qty: number }>("SELECT kind, qty FROM stock_movements WHERE product_id = ? AND kind <> 'inicial' ORDER BY id", [p.id])
    expect(qtys.map((m) => m.qty)).toEqual([-2, -1, -3, -1, 2, -4, 1])
    // Aunque el usuario mande negativo en una rotura, sale igual (no suma).
    const neg = await s.post(`/products/${p.id}/adjust`, { date: today(), kind: 'rotura', qty: -1 })
    expect(neg.body.stock).toBe(11)
  })

  it('conteo: la diferencia (contadas − sistema) deja el stock en lo contado', async () => {
    const p = await newWine({ initial_stock: 27 })
    const contadas = 25
    const r = await s.post(`/products/${p.id}/adjust`, { date: today(), kind: 'ajuste', qty: contadas - p.stock, notes: 'Inventario' })
    expect(r.body.stock).toBe(25)
    const d = await s.get(`/products/${p.id}`)
    expect(d.body.movements[0]).toMatchObject({ kind: 'ajuste', kind_label: 'Ajuste de inventario', qty: -2, saldo: 25, unit_cost: 7200, value: -14400, manual: true, notes: 'Inventario' })
  })

  it('rechaza cantidad cero, kinds no manuales, eventos inexistentes y dejar stock negativo', async () => {
    const p = await newWine({ initial_stock: 2 })
    expect((await s.post(`/products/${p.id}/adjust`, { date: today(), kind: 'rotura', qty: 0 })).status).toBe(400)
    expect((await s.post(`/products/${p.id}/adjust`, { date: today(), kind: 'venta', qty: 1 })).status).toBe(400)
    expect((await s.post(`/products/${p.id}/adjust`, { date: today(), kind: 'regalo', qty: 1, event_id: 99 })).body.error).toContain('evento')
    const tooMany = await s.post(`/products/${p.id}/adjust`, { date: today(), kind: 'rotura', qty: 3 })
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.error).toContain('quedan 2')
    expect((await s.post(`/products/${p.id}/adjust`, { date: today(), kind: 'ajuste', qty: -3 })).status).toBe(400)
    expect((await s.post('/products/999/adjust', { date: today(), kind: 'rotura', qty: 1 })).status).toBe(404)
  })

  it('una degustación puede quedar asociada a un evento', async () => {
    const p = await newWine()
    const ev = run("INSERT INTO events (name, date) VALUES ('Feria del Malbec', ?)", [today()]).lastInsertRowid
    await s.post(`/products/${p.id}/adjust`, { date: today(), kind: 'degustacion', qty: 2, event_id: ev })
    const m = get<{ ref_type: string; ref_id: number }>("SELECT ref_type, ref_id FROM stock_movements WHERE kind = 'degustacion'")
    expect(m).toEqual({ ref_type: 'event', ref_id: ev })
    const d = await s.get(`/products/${p.id}`)
    expect(d.body.movements[0]).toMatchObject({ event_id: ev, reference: 'Evento: Feria del Malbec' })
  })

  it('cambio de costo: movimiento "revaluo" que se puede borrar', async () => {
    const p = await newWine()
    const r = await s.post(`/products/${p.id}/cost`, { date: today(), unit_cost: 8000, notes: 'Bonificación' })
    expect(r.body).toMatchObject({ unit_cost: 8000, stock: 24, stock_value: 192000 })
    const d = await s.get(`/products/${p.id}`)
    const rev = d.body.movements.find((m: { kind: string }) => m.kind === 'revaluo')
    expect(rev).toMatchObject({ qty: 0, unit_cost: 8000, kind_label: 'Cambio de costo', manual: true })
    expect((await s.del(`/stock/movements/${rev.id}`)).body).toEqual({ ok: true })
    expect((await s.get(`/products/${p.id}`)).body.product.unit_cost).toBe(7200)
    expect((await s.post(`/products/${p.id}/cost`, { date: today(), unit_cost: -1 })).status).toBe(400)
  })

  it('solo se borran movimientos manuales; ventas y compras explican qué hacer', async () => {
    const p = await newWine()
    const saleId = createSale(saleInput.parse({ date: today(), items: [{ product_id: p.id, qty: 2, unit_price: 12500 }] }))
    const purchaseId = createPurchase(purchaseInput.parse({ date: today(), items: [{ product_id: p.id, qty: 6, unit_cost: 7000 }], paid: false }))
    const venta = get<{ id: number }>("SELECT id FROM stock_movements WHERE kind = 'venta'")!
    const compra = get<{ id: number }>("SELECT id FROM stock_movements WHERE kind = 'compra'")!
    const inicial = get<{ id: number }>("SELECT id FROM stock_movements WHERE kind = 'inicial'")!
    const r1 = await s.del(`/stock/movements/${venta.id}`)
    expect(r1.status).toBe(400)
    expect(r1.body.error).toContain(`#${saleId}`)
    const r2 = await s.del(`/stock/movements/${compra.id}`)
    expect(r2.status).toBe(400)
    expect(r2.body.error).toContain(`#${purchaseId}`)
    expect((await s.del(`/stock/movements/${inicial.id}`)).status).toBe(400)
    expect((await s.del('/stock/movements/99999')).status).toBe(404)

    const adj = await s.post(`/products/${p.id}/adjust`, { date: today(), kind: 'rotura', qty: 1 })
    expect(adj.body.stock).toBe(27)
    const rot = get<{ id: number }>("SELECT id FROM stock_movements WHERE kind = 'rotura'")!
    await s.del(`/stock/movements/${rot.id}`)
    expect((await s.get(`/products/${p.id}`)).body.product.stock).toBe(28)
  })
})

describe('ficha del vino y movimientos', () => {
  it('devuelve kardex con saldo, referencias, estadísticas y 12 meses', async () => {
    const p = await newWine({ initial_stock: 10, unit_cost: 1000 })
    const client = run("INSERT INTO clients (name) VALUES ('Bistró La Esquina')").lastInsertRowid
    const supplier = run("INSERT INTO suppliers (name) VALUES ('Bodega Y')").lastInsertRowid
    const purchaseId = createPurchase(purchaseInput.parse({ date: today(), supplier_id: supplier, invoice_number: 'A-12', items: [{ product_id: p.id, qty: 10, unit_cost: 1400 }], paid: false }))
    const saleId = createSale(saleInput.parse({ date: today(), client_id: client, items: [{ product_id: p.id, qty: 5, unit_price: 2000 }] }))
    const d = (await s.get(`/products/${p.id}`)).body
    expect(d.product).toMatchObject({ stock: 15, unit_cost: 1200 })
    expect(d.movements.map((m: { kind: string; saldo: number }) => [m.kind, m.saldo])).toEqual([
      ['venta', 15],
      ['compra', 20],
      ['inicial', 10],
    ])
    expect(d.movements[0]).toMatchObject({ sale_id: saleId, reference: `Venta #${saleId} · Bistró La Esquina`, unit_price: 2000, qty: -5, unit_cost: 1200 })
    expect(d.movements[1]).toMatchObject({ purchase_id: purchaseId, reference: `Compra #${purchaseId} · Bodega Y · Fact. A-12` })
    expect(d.stats).toMatchObject({
      sold_total: 5,
      revenue_total: 10000,
      profit_total: 4000,
      sold_90d: 5,
      last_sale_date: today(),
      last_purchase_date: today(),
      last_purchase_cost: 1400,
    })
    expect(d.monthly).toHaveLength(12)
    expect(d.monthly[11]).toMatchObject({ month: today().slice(0, 7), bottles: 5, revenue: 10000, profit: 4000 })
  })

  it('lista movimientos por período, vino y tipo', async () => {
    const a = await newWine({ name: 'A' })
    const b = await newWine({ name: 'B' })
    await s.post(`/products/${a.id}/adjust`, { date: today(), kind: 'rotura', qty: 1 })
    await s.post(`/products/${b.id}/adjust`, { date: addDays(today(), -400), kind: 'regalo', qty: 1 })
    const from = addDays(today(), -5)
    const r = await s.get(`/stock/movements?from=${from}&to=${today()}`)
    expect(r.body.map((m: { product_name: string; kind: string }) => `${m.product_name}:${m.kind}`).sort()).toEqual(['A:inicial', 'A:rotura', 'B:inicial'])
    const onlyA = await s.get(`/stock/movements?from=${from}&to=${today()}&product_id=${a.id}&kind=rotura`)
    expect(onlyA.body).toHaveLength(1)
    expect(onlyA.body[0]).toMatchObject({ product_name: 'A', saldo: 23 })
  })
})

describe('aumento de precios masivo', () => {
  it('previsualiza sin guardar y después aplica con redondeo hacia arriba', async () => {
    const a = await newWine({ name: 'A', price_retail: 10000, price_wholesale: 8000 })
    await newWine({ name: 'B', winery: 'Otra bodega', price_retail: 12345, price_wholesale: 0 })
    const prev = await s.post('/products/bulk-price?preview=1', { percent: 10, apply_to: 'both', round_to: 100 })
    expect(prev.status).toBe(200)
    expect(prev.body.updated).toBe(2)
    expect(prev.body.examples[0]).toMatchObject({ name: 'A', before: 10000, after: 11000, after_wholesale: 8800 })
    // 12.345 × 1,10 = 13.579,50 → redondeado para arriba a $100 = 13.600. El mayorista en 0 queda en 0.
    expect(prev.body.examples[1]).toMatchObject({ name: 'B', after_retail: 13600, after_wholesale: 0 })
    expect((await s.get(`/products/${a.id}`)).body.product.price_retail).toBe(10000)

    const done = await s.post('/products/bulk-price', { percent: 10, apply_to: 'both', round_to: 100 })
    expect(done.body.updated).toBe(2)
    const list = (await s.get('/products')).body
    expect(list.map((p: { price_retail: number }) => p.price_retail)).toEqual([11000, 13600])
  })

  it('filtra por bodega, tipo, ids y aplica solo a un precio', async () => {
    const a = await newWine({ name: 'A', price_retail: 1000, price_wholesale: 800 })
    await newWine({ name: 'B', winery: 'Otra', price_retail: 1000, price_wholesale: 800 })
    await newWine({ name: 'C', wine_type: 'blanco', price_retail: 1000, price_wholesale: 800 })
    const byWinery = await s.post('/products/bulk-price', { percent: 5, apply_to: 'wholesale', winery: 'otra' })
    expect(byWinery.body.examples).toEqual([expect.objectContaining({ name: 'B', before: 800, after: 840, after_retail: 1000 })])
    const byType = await s.post('/products/bulk-price?preview=1', { percent: -10, apply_to: 'retail', wine_type: 'blanco' })
    expect(byType.body.examples).toEqual([expect.objectContaining({ name: 'C', before: 1000, after: 900 })])
    const byIds = await s.post('/products/bulk-price?preview=1', { percent: 50, product_ids: [a.id] })
    expect(byIds.body.updated).toBe(1)
    const none = await s.post('/products/bulk-price', { percent: 5, winery: 'No existe' })
    expect(none.status).toBe(400)
    expect((await s.post('/products/bulk-price', { percent: 5000 })).status).toBe(400)
  })
})

describe('importar desde Excel', () => {
  it('crea vinos nuevos, actualiza existentes y reporta errores por fila', async () => {
    const existing = await newWine({ name: 'Torrontés Dulce', sku: 'VH-9', price_retail: 9000, unit_cost: 5000, initial_stock: 6 })
    const malbec = await newWine({ name: 'Malbec Reserva', price_retail: 20000, unit_cost: 12000 })
    const buf = await xlsxBuffer([
      ['Nombre', 'Bodega', 'Varietal', 'Tipo', 'Cosecha', 'Región', 'Costo', 'Precio minorista', 'Precio mayorista', 'Stock inicial', 'Stock mínimo', 'SKU'],
      ['Cabernet Franc', 'Finca X', 'Cabernet Franc', 'Tinto', 2021, 'Gualtallary', '$ 12.500,50', '$ 21.000', 18000, 12, 4, 'CF-1'],
      ['Rosé de Malbec', 'Finca X', 'Malbec', 'Rosé', '2024', null, 6000, 10500, null, null, null, null],
      ['Otro nombre', null, null, null, null, null, null, 9500, null, null, null, 'vh-9'],
      ['malbec reserva', null, null, null, null, null, 15000, '22.000', null, 50, null, null],
      [null, 'Sin nombre', null, null, null, null, null, 1000],
      ['Precio raro', null, null, 'Espumoso', null, null, null, 'mil pesos'],
      ['Extra Brut', null, null, 'Champaña', 'NV', null, 8000, 14000, null, 6],
      ['Raro', null, null, 'Fucsia', null, null, null, 1000],
    ])
    const r = await upload(buf)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ created: 4, updated: 2, total: 8 })
    expect(r.body.errors).toEqual([
      { row: 6, message: 'Falta el nombre del vino.' },
      { row: 7, message: expect.stringContaining('«mil pesos» no es un número') },
    ])
    expect(r.body.notes.map((n: { row: number }) => n.row)).toEqual([5, 9])

    const list = (await s.get('/products')).body as Record<string, any>[]
    const cf = list.find((p) => p.name === 'Cabernet Franc')!
    expect(cf).toMatchObject({
      winery: 'Finca X',
      wine_type: 'tinto',
      vintage: 2021,
      region: 'Gualtallary',
      unit_cost: 12500.5,
      price_retail: 21000,
      price_wholesale: 18000,
      stock: 12,
      min_stock: 4,
      sku: 'CF-1',
    })
    expect(list.find((p) => p.name === 'Rosé de Malbec')).toMatchObject({ wine_type: 'rosado', vintage: 2024, stock: 0, unit_cost: 6000, min_stock: 6 })
    expect(list.find((p) => p.name === 'Extra Brut')).toMatchObject({ wine_type: 'espumante', vintage: null, stock: 6 })
    expect(list.find((p) => p.name === 'Raro')).toMatchObject({ wine_type: 'otro' })
    // Coincide por SKU (sin importar mayúsculas): se actualiza nombre y precio, se mantiene el resto.
    expect(list.find((p) => p.id === existing.id)).toMatchObject({ name: 'Otro nombre', price_retail: 9000 + 500, unit_cost: 5000, stock: 6, winery: 'Bodega Los Cerros' })
    // Coincide por nombre (sin importar mayúsculas/tildes): precio nuevo, costo y stock NO cambian.
    expect(list.find((p) => p.id === malbec.id)).toMatchObject({ price_retail: 22000, unit_cost: 12000, stock: 24 })

    // Subirlo de nuevo no duplica nada.
    const again = await upload(buf)
    expect(again.body).toMatchObject({ created: 0, updated: 6 })
    expect((await s.get('/products')).body).toHaveLength(list.length)
  })

  it('explica cuando el archivo no sirve', async () => {
    expect((await upload(Buffer.from('hola, no soy un excel'))).status).toBe(400)
    const noHeader = await upload(
      await xlsxBuffer([
        ['Bodega', 'Precio'],
        ['x', 1],
      ]),
    )
    expect(noHeader.status).toBe(400)
    expect(noHeader.body.error).toContain('Nombre')
    const empty = await upload(await xlsxBuffer([['Nombre', 'Precio']]))
    expect(empty.status).toBe(400)
  })
})

describe('exportar a Excel', () => {
  it('catálogo con costos y márgenes, y hoja para reponer', async () => {
    await newWine({ min_stock: 30 })
    const wb = await readXlsx('/products/export')
    const ws = wb.getWorksheet('Catálogo')!
    expect(rowTexts(ws, 4)).toEqual(expect.arrayContaining(['Costo promedio', 'Margen minorista', 'Markup minorista', 'Stock valorizado', 'Días de stock']))
    expect(ws.getRow(5).getCell(1).text).toBe('Malbec Clásico')
    const reponer = wb.getWorksheet('Para reponer')!
    expect(reponer.getRow(5).getCell(1).text).toBe('Malbec Clásico')
  })

  it('lista de precios para clientes: agrupada por tipo y SIN costos', async () => {
    await newWine({ name: 'Malbec' })
    await newWine({ name: 'Torrontés', wine_type: 'blanco', price_retail: 9000, price_wholesale: 7500 })
    await newWine({ name: 'Inactivo', active: false })
    const wb = await readXlsx('/products/price-list?list=mayorista')
    const ws = wb.worksheets[0]
    const headers = rowTexts(ws, 4)
    expect(headers).toEqual(['Vino', 'Bodega', 'Varietal', 'Cosecha', 'Precio', 'Disponible'])
    expect(headers.join(' ')).not.toMatch(/costo|margen/i)
    const names = [5, 6, 7, 8].map((n) => ws.getRow(n).getCell(1).text)
    expect(names).toEqual(['TINTOS', 'Malbec', 'BLANCOS', 'Torrontés'])
    expect(ws.getRow(8).getCell(5).value).toBe(7500)
    const minorista = await readXlsx('/products/price-list?list=minorista')
    expect(minorista.worksheets[0].getRow(8).getCell(5).value).toBe(9000)
  })

  it('plantilla de importación con instrucciones (y con mis vinos para editar)', async () => {
    const wb = await readXlsx('/products/import-template')
    expect(rowTexts(wb.worksheets[0], 1)).toEqual([
      'Nombre',
      'Bodega',
      'Varietal',
      'Tipo',
      'Cosecha',
      'Región',
      'Costo',
      'Precio minorista',
      'Precio mayorista',
      'Stock inicial',
      'Stock mínimo',
      'SKU',
    ])
    expect(wb.getWorksheet('Instrucciones')).toBeTruthy()
    await newWine()
    const mine = await readXlsx('/products/import-template?con_vinos=1')
    expect(mine.worksheets[0].getRow(2).getCell(1).text).toBe('Malbec Clásico')
    // La plantilla con mis vinos se puede volver a subir tal cual: actualiza, no duplica.
    const res = await s.raw('/products/import-template?con_vinos=1')
    const r = await upload(Buffer.from(await res.arrayBuffer()))
    expect(r.body).toMatchObject({ created: 0, updated: 1, errors: [] })
  })

  it('movimientos de stock con resumen por vino', async () => {
    const p = await newWine({ initial_stock: 10 })
    await s.post(`/products/${p.id}/adjust`, { date: today(), kind: 'rotura', qty: 2 })
    const wb = await readXlsx(`/stock/export?from=${addDays(today(), -30)}&to=${today()}`)
    const mov = wb.getWorksheet('Movimientos')!
    expect(mov.getRow(5).getCell(4).text).toBe('Stock inicial')
    expect(mov.getRow(6).getCell(5).value).toBe(-2)
    const res = wb.getWorksheet('Resumen por vino')!
    // Vino, Bodega, inicio, entradas, vendidas, mermas, ajustes, final
    expect([3, 4, 5, 6, 7, 8].map((c) => res.getRow(5).getCell(c).value)).toEqual([0, 10, 0, 2, 0, 8])
  })
})
