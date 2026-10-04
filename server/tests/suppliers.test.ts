// Tests de la API de Proveedores: alta (solo con nombre, como desde el formulario de compra),
// validaciones y repetidos, listado con saldo y total comprado, ficha con estadísticas,
// edición (completa o parcial), borrado (409 si tiene historial) y Excel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { run } from '../db'
import { createExpense } from '../services/expenses'
import { expenseInput } from '../../shared/schemas'
import { addDays, addMonths, monthKey, today } from '../../shared/dates'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

const wine = (name: string) => run('INSERT INTO products (name) VALUES (?)', [name]).lastInsertRowid
const expense = (supplierId: number, amount: number, extra: Record<string, unknown> = {}) =>
  createExpense(expenseInput.parse({ date: '2026-02-05', category: 'Envíos y logística', description: 'Envíos del mes', amount, supplier_id: supplierId, ...extra }))

describe('POST /suppliers', () => {
  it('crea un proveedor solo con el nombre (como al agregarlo desde una compra), con valores por defecto', async () => {
    const r = await t.post('/suppliers', { name: '  Bodega Los Cerros  ' })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ id: expect.any(Number), name: 'Bodega Los Cerros', kind: 'bodega', active: true, phone: null, email: null })
  })

  it('guarda todos los datos de contacto', async () => {
    const r = await t.post('/suppliers', {
      name: 'Envíos Rayo',
      kind: 'logistica',
      contact_name: 'Mesa de ayuda',
      phone: '11 5555-1234',
      email: 'hola@rayo.com',
      tax_id: '30-12345678-9',
      address: 'Av. Siempreviva 742',
      notes: 'Retiran martes y jueves',
    })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ kind: 'logistica', contact_name: 'Mesa de ayuda', phone: '11 5555-1234', tax_id: '30-12345678-9', notes: 'Retiran martes y jueves' })
  })

  it('valida con mensajes claros y no deja repetir nombres', async () => {
    const empty = await t.post('/suppliers', { name: '   ' })
    expect(empty.status).toBe(400)
    expect(empty.body.error).toMatch(/Nombre/)
    const badKind = await t.post('/suppliers', { name: 'X', kind: 'marciano' })
    expect(badKind.status).toBe(400)
    expect(badKind.body.error).toMatch(/Tipo: no es una opción válida/)

    await t.post('/suppliers', { name: 'Finca La Escondida' })
    const dup = await t.post('/suppliers', { name: 'finca la escondída' })
    expect(dup.status).toBe(409)
    expect(dup.body.error).toMatch(/Ya tenés un proveedor llamado «Finca La Escondida»/)

    const inactive = await t.post('/suppliers', { name: 'Viejo Proveedor', active: false })
    const dupInactive = await t.post('/suppliers', { name: 'Viejo proveedor' })
    expect(dupInactive.status).toBe(409)
    expect(dupInactive.body.error).toMatch(/desactivado/)
    expect(inactive.body.active).toBe(false)
  })
})

describe('GET /suppliers', () => {
  it('lista ordenado por nombre, con total comprado, saldo a pagar (compras + gastos) y última compra', async () => {
    const zeta = (await t.post('/suppliers', { name: 'Zeta Vinos' })).body.id
    const alfa = (await t.post('/suppliers', { name: 'Álamo Bodega' })).body.id
    const envios = (await t.post('/suppliers', { name: 'envíos Rayo', kind: 'logistica' })).body.id
    const m = wine('Malbec')

    await t.post('/purchases', { date: '2026-02-01', supplier_id: zeta, items: [{ product_id: m, qty: 12, unit_cost: 1000 }], shipping: 600 })
    await t.post('/purchases', {
      date: '2026-03-01',
      supplier_id: zeta,
      paid: false,
      due_date: addDays(today(), -2),
      items: [{ product_id: m, qty: 6, unit_cost: 1100 }],
    })
    expense(envios, 5000, { paid: false })
    expense(envios, 3000)

    const r = await t.get('/suppliers')
    expect(r.status).toBe(200)
    expect(r.body.map((s: any) => s.name)).toEqual(['Álamo Bodega', 'envíos Rayo', 'Zeta Vinos'])
    const z = r.body.find((s: any) => s.id === zeta)
    expect(z).toMatchObject({
      total_bought: 12600 + 6600,
      bottles: 18,
      purchases_count: 2,
      last_purchase: '2026-03-01',
      balance: 6600,
      overdue: 6600,
      purchases_balance: 6600,
      expenses_balance: 0,
      active: true,
    })
    const e = r.body.find((s: any) => s.id === envios)
    expect(e).toMatchObject({ total_bought: 0, purchases_count: 0, last_purchase: null, expenses_total: 8000, expenses_count: 2, balance: 5000, expenses_balance: 5000 })
    const a = r.body.find((s: any) => s.id === alfa)
    expect(a).toMatchObject({ balance: 0, total_bought: 0, bottles: 0 })
  })
})

describe('GET /suppliers/:id', () => {
  it('devuelve la ficha con compras, gastos, estadísticas, vinos (con variación de precio) y 12 meses', async () => {
    const s = (await t.post('/suppliers', { name: 'Bodega Los Cerros', phone: '261 444-5555' })).body.id
    const other = (await t.post('/suppliers', { name: 'Otra Bodega' })).body.id
    const malbec = wine('Malbec Clásico')
    const reserva = wine('Malbec Reserva')
    const thisMonth = monthKey(today())
    const d1 = addMonths(today(), -2)
    const d2 = addMonths(today(), -1)

    await t.post('/purchases', {
      date: d1,
      supplier_id: s,
      items: [
        { product_id: malbec, qty: 12, unit_cost: 1000 },
        { product_id: reserva, qty: 6, unit_cost: 3000 },
      ],
      shipping: 1800,
    })
    await t.post('/purchases', { date: d2, supplier_id: s, paid: false, items: [{ product_id: malbec, qty: 24, unit_cost: 1200 }] })
    await t.post('/purchases', { date: d2, supplier_id: other, items: [{ product_id: malbec, qty: 6, unit_cost: 999 }] })
    expense(s, 2500, { date: today(), category: 'Envíos y logística', description: 'Flete aparte' })

    const r = await t.get(`/suppliers/${s}`)
    expect(r.status).toBe(200)
    expect(r.body.supplier).toMatchObject({ id: s, name: 'Bodega Los Cerros', phone: '261 444-5555', active: true })
    expect(r.body.purchases).toHaveLength(2)
    expect(r.body.purchases[0].date).toBe(d2) // más nuevas primero
    expect(r.body.expenses).toHaveLength(1)
    expect(r.body.expenses[0]).toMatchObject({ amount: 2500, status: 'pagado' })

    // 1ª compra: 12.000 + 18.000 + 1.800 de flete = 31.800; 2ª: 28.800 (sin pagar)
    expect(r.body.stats).toMatchObject({
      total_bought: 60600,
      bottles: 42,
      shipping: 1800,
      balance: 28800,
      purchases_balance: 28800,
      expenses_balance: 0,
      overdue: 0,
      last_purchase: d2,
      first_purchase: d1,
      purchases_count: 2,
      expenses_total: 2500,
      expenses_count: 1,
    })
    expect(r.body.stats.avg_cost_per_bottle).toBeCloseTo(60600 / 42, 2)

    // Top vinos por total real (con flete): Malbec Clásico 12 × 1.060 + 24 × 1.200 = 41.520; Reserva 6 × 3.180 = 19.080
    expect(r.body.stats.top_wines).toEqual([
      { product_id: malbec, name: 'Malbec Clásico', bottles: 36, total: 41520 },
      { product_id: reserva, name: 'Malbec Reserva', bottles: 6, total: 19080 },
    ])
    const mw = r.body.wines.find((w: any) => w.product_id === malbec)
    expect(mw).toMatchObject({ first_unit_cost: 1000, last_unit_cost: 1200, purchases: 2 })
    expect(mw.price_change).toBeCloseTo(0.2, 5)
    expect(r.body.wines.find((w: any) => w.product_id === reserva).price_change).toBeNull()

    expect(r.body.monthly).toHaveLength(12)
    expect(r.body.monthly[11].month).toBe(thisMonth)
    expect(r.body.monthly[11].expenses).toBe(2500)
    expect(r.body.monthly.find((m: any) => m.month === monthKey(d2))).toMatchObject({ purchases: 28800, bottles: 24 })
  })

  it('404 si no existe', async () => {
    const r = await t.get('/suppliers/999')
    expect(r.status).toBe(404)
    expect(r.body.error).toMatch(/No encontramos ese proveedor/)
  })
})

describe('PUT /suppliers/:id', () => {
  it('edita todo o solo lo que cambia (ej: desactivar)', async () => {
    const id = (await t.post('/suppliers', { name: 'Cava del Valle', phone: '387 111' })).body.id
    const full = await t.put(`/suppliers/${id}`, { name: 'Cava del Valle SRL', kind: 'distribuidor', phone: '387 222', email: 'ventas@cava.com' })
    expect(full.status).toBe(200)
    expect(full.body).toMatchObject({ name: 'Cava del Valle SRL', kind: 'distribuidor', phone: '387 222', email: 'ventas@cava.com', active: true })

    const off = await t.put(`/suppliers/${id}`, { active: false })
    expect(off.status).toBe(200)
    expect(off.body).toMatchObject({ name: 'Cava del Valle SRL', phone: '387 222', active: false })

    const cleared = await t.put(`/suppliers/${id}`, { phone: '' })
    expect(cleared.body.phone).toBeNull()
  })

  it('valida, no deja repetir el nombre de otro y responde 404 si no existe', async () => {
    const a = (await t.post('/suppliers', { name: 'Bodega A' })).body.id
    await t.post('/suppliers', { name: 'Bodega B' })
    const empty = await t.put(`/suppliers/${a}`, { name: '' })
    expect(empty.status).toBe(400)
    const dup = await t.put(`/suppliers/${a}`, { name: 'bodega b' })
    expect(dup.status).toBe(409)
    const same = await t.put(`/suppliers/${a}`, { name: 'BODEGA A' }) // cambiar mayúsculas del propio nombre está bien
    expect(same.status).toBe(200)
    expect(same.body.name).toBe('BODEGA A')
    const missing = await t.put('/suppliers/999', { name: 'X' })
    expect(missing.status).toBe(404)
  })
})

describe('DELETE /suppliers/:id', () => {
  it('borra un proveedor sin historial', async () => {
    const id = (await t.post('/suppliers', { name: 'Proveedor nuevo' })).body.id
    const r = await t.del(`/suppliers/${id}`)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    expect((await t.get(`/suppliers/${id}`)).status).toBe(404)
    expect((await t.del(`/suppliers/${id}`)).status).toBe(404)
  })

  it('con compras o gastos responde 409 sugiriendo desactivarlo (y no borra nada)', async () => {
    const withPurchase = (await t.post('/suppliers', { name: 'Con compras' })).body.id
    const withExpense = (await t.post('/suppliers', { name: 'Con gastos' })).body.id
    const m = wine('Malbec')
    await t.post('/purchases', { date: '2026-02-01', supplier_id: withPurchase, items: [{ product_id: m, qty: 6, unit_cost: 1000 }] })
    await t.post('/purchases', { date: '2026-02-02', supplier_id: withPurchase, items: [{ product_id: m, qty: 6, unit_cost: 1000 }] })
    expense(withExpense, 1000)

    const r1 = await t.del(`/suppliers/${withPurchase}`)
    expect(r1.status).toBe(409)
    expect(r1.body.error).toMatch(/2 compras/)
    expect(r1.body.error).toMatch(/Desactivalo/)
    expect(r1.body.details).toEqual({ purchases: 2, expenses: 0 })

    const r2 = await t.del(`/suppliers/${withExpense}`)
    expect(r2.status).toBe(409)
    expect(r2.body.error).toMatch(/1 gasto/)

    const list = await t.get('/suppliers')
    expect(list.body).toHaveLength(2)
  })
})

describe('GET /suppliers/export', () => {
  it('arma el Excel de proveedores con totales y saldo', async () => {
    const s = (await t.post('/suppliers', { name: 'Bodega Los Cerros', contact_name: 'Martín' })).body.id
    await t.post('/suppliers', { name: 'Apagado', active: false })
    const m = wine('Malbec')
    await t.post('/purchases', { date: '2026-02-01', supplier_id: s, paid: false, items: [{ product_id: m, qty: 6, unit_cost: 1000 }] })

    const res = await t.raw('/suppliers/export')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/vinoh-proveedores-/)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer)
    const ws = wb.getWorksheet('Proveedores')!
    const headers = (ws.getRow(4).values as unknown[]).slice(1) as string[]
    expect(ws.getCell(5, 1).value).toBe('Apagado')
    expect(ws.getCell(5, headers.indexOf('Activo') + 1).value).toBe('No')
    expect(ws.getCell(6, 1).value).toBe('Bodega Los Cerros')
    expect(ws.getCell(6, headers.indexOf('Total comprado (vino + flete)') + 1).value).toBe(6000)
    expect(ws.getCell(6, headers.indexOf('Saldo a pagar') + 1).value).toBe(6000)
    expect(ws.getCell(7, 1).value).toBe('TOTAL')
  })
})
