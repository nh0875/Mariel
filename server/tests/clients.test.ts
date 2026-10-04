// Tests de la API de Clientes: alta (solo con nombre, como desde el selector de ventas), validaciones
// y repetidos, listado con saldo y total comprado, ficha con estadísticas (vinos favoritos, meses,
// frecuencia), edición completa o parcial, borrado (409 si tiene ventas) y Excel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { run } from '../db'
import { addMovement } from '../services/stock'
import { accountBalances, addSettlement } from '../services/payments'
import { createSale } from '../services/sales'
import { receivables } from '../services/finance'
import { saleInput } from '../../shared/schemas'
import { addDays, monthKey, today } from '../../shared/dates'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

const T = today()
function wine(name: string, cost = 1000) {
  const id = run('INSERT INTO products (name, price_retail) VALUES (?, 3000)', [name]).lastInsertRowid
  addMovement({ product_id: id, date: '2025-01-01', kind: 'inicial', qty: 200, unit_cost: cost })
  return id
}
const sale = (clientId: number | null, items: { product_id: number; qty: number; unit_price: number }[], extra: Record<string, unknown> = {}) =>
  createSale(saleInput.parse({ date: T, client_id: clientId, payment_method: 'efectivo', items, ...extra }))

describe('POST /clients', () => {
  it('crea un cliente solo con el nombre (como desde el selector de Ventas), con valores por defecto', async () => {
    const r = await t.post('/clients', { name: '  Bistró La Esquina ' })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ id: expect.any(Number), name: 'Bistró La Esquina', kind: 'consumidor', active: true, phone: null, email: null, city: null })
  })

  it('guarda los datos de contacto', async () => {
    const r = await t.post('/clients', {
      name: 'Vinoteca Baco',
      kind: 'vinoteca',
      phone: '11 5555-1234',
      email: 'compras@baco.com',
      tax_id: '30-71234567-8',
      address: 'Av. Corrientes 1234',
      city: 'CABA',
      notes: 'Paga a 30 días',
    })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ kind: 'vinoteca', phone: '11 5555-1234', city: 'CABA', notes: 'Paga a 30 días' })
  })

  it('valida con mensajes claros y no deja repetir nombres', async () => {
    const empty = await t.post('/clients', { name: '  ' })
    expect(empty.status).toBe(400)
    expect(empty.body.error).toMatch(/Nombre: es obligatorio/)
    const badKind = await t.post('/clients', { name: 'X', kind: 'marciano' })
    expect(badKind.status).toBe(400)
    expect(badKind.body.error).toMatch(/Tipo: no es una opción válida/)

    await t.post('/clients', { name: 'Bistró La Esquina' })
    const dup = await t.post('/clients', { name: 'bistro la  esquina' })
    expect(dup.status).toBe(409)
    expect(dup.body.error).toMatch(/Ya tenés un cliente llamado «Bistró La Esquina»/)

    await t.post('/clients', { name: 'Cliente Viejo', active: false })
    const dupInactive = await t.post('/clients', { name: 'cliente viejo' })
    expect(dupInactive.status).toBe(409)
    expect(dupInactive.body.error).toMatch(/desactivado/)
  })
})

describe('GET /clients', () => {
  it('lista por nombre con total comprado, compras, última compra, saldo y vencido', async () => {
    const zeta = (await t.post('/clients', { name: 'Zeta Restó', kind: 'restaurante' })).body.id
    const ana = (await t.post('/clients', { name: 'Ana Pérez' })).body.id
    const sinCompras = (await t.post('/clients', { name: 'Martín Sosa' })).body.id
    const m = wine('Malbec')
    sale(zeta, [{ product_id: m, qty: 6, unit_price: 2500 }], { date: addDays(T, -30) })
    sale(zeta, [{ product_id: m, qty: 2, unit_price: 2500 }], { date: addDays(T, -5), paid: false, due_date: addDays(T, -1) })
    sale(ana, [{ product_id: m, qty: 1, unit_price: 3000 }], { paid: false })
    sale(null, [{ product_id: m, qty: 1, unit_price: 3000 }], { paid: false }) // sin cliente: no suma a nadie

    const r = await t.get('/clients')
    expect(r.status).toBe(200)
    expect(r.body.map((c: any) => c.name)).toEqual(['Ana Pérez', 'Martín Sosa', 'Zeta Restó'])
    const z = r.body.find((c: any) => c.id === zeta)
    expect(z).toMatchObject({ total_bought: 20000, bottles: 8, purchases_count: 2, last_purchase: addDays(T, -5), first_purchase: addDays(T, -30), balance: 5000, overdue: 5000, pending_count: 1 })
    expect(r.body.find((c: any) => c.id === ana)).toMatchObject({ total_bought: 3000, balance: 3000, overdue: 0 })
    expect(r.body.find((c: any) => c.id === sinCompras)).toMatchObject({ total_bought: 0, purchases_count: 0, last_purchase: null, balance: 0 })
    // Los saldos de clientes + ventas sin cliente = total por cobrar del tablero
    const sumClients = r.body.reduce((s: number, c: any) => s + c.balance, 0)
    expect(sumClients + 3000).toBe(receivables().total)
  })

  it('el saldo baja con los cobros parciales', async () => {
    const id = (await t.post('/clients', { name: 'Ana' })).body.id
    const s = sale(id, [{ product_id: wine('Torrontés'), qty: 4, unit_price: 2500 }], { paid: false })
    addSettlement('sale', s, { date: T, amount: 4000, account_id: accountBalances()[0].id })
    const c = (await t.get('/clients')).body.find((x: any) => x.id === id)
    expect(c).toMatchObject({ total_bought: 10000, balance: 6000 })
  })
})

describe('GET /clients/:id', () => {
  it('devuelve la ficha: ventas, estadísticas, vinos favoritos y los últimos 12 meses', async () => {
    const id = (await t.post('/clients', { name: 'Vinoteca Baco', kind: 'vinoteca' })).body.id
    const malbec = wine('Malbec', 1000)
    const torrontes = wine('Torrontés', 800)
    sale(id, [{ product_id: malbec, qty: 6, unit_price: 2000 }], { date: addDays(T, -20) })
    sale(id, [{ product_id: malbec, qty: 6, unit_price: 2000 }, { product_id: torrontes, qty: 2, unit_price: 1500 }], { date: addDays(T, -10) })
    sale(id, [{ product_id: torrontes, qty: 1, unit_price: 1500 }], { paid: false, due_date: addDays(T, -2) })

    const r = await t.get(`/clients/${id}`)
    expect(r.status).toBe(200)
    expect(r.body.client).toMatchObject({ id, name: 'Vinoteca Baco', active: true })
    expect(r.body.sales).toHaveLength(3)
    expect(r.body.sales[0].date).toBe(T) // la más nueva primero
    expect(r.body.stats).toMatchObject({
      total_bought: 28500,
      bottles: 15,
      purchases_count: 3,
      avg_ticket: 9500,
      last_purchase: T,
      first_purchase: addDays(T, -20),
      days_since_last: 0,
      frequency_days: 10,
      balance: 1500,
      overdue: 1500,
      pending_count: 1,
    })
    // Ganancia = ventas − costo (12 × 1000 + 3 × 800) − comisiones (0 en efectivo)
    expect(r.body.stats.profit).toBe(28500 - 12000 - 2400)
    expect(r.body.stats.margin).toBeCloseTo(14100 / 28500, 5)
    expect(r.body.stats.favorite_wines).toEqual([
      { product_id: malbec, name: 'Malbec', bottles: 12, total: 24000 },
      { product_id: torrontes, name: 'Torrontés', bottles: 3, total: 4500 },
    ])
    expect(r.body.monthly).toHaveLength(12)
    expect(r.body.monthly[11].month).toBe(monthKey(T))
    expect(r.body.monthly.reduce((s: number, m: any) => s + m.total, 0)).toBe(28500)
  })

  it('la frecuencia cuenta días distintos: dos ventas el mismo día son una sola visita (nunca "compra cada 0 días")', async () => {
    const id = (await t.post('/clients', { name: 'Ana Pérez' })).body.id
    const malbec = wine('Malbec')
    const item = [{ product_id: malbec, qty: 1, unit_price: 2000 }]
    sale(id, item, { date: addDays(T, -60) })
    sale(id, item, { date: addDays(T, -60) })
    expect((await t.get(`/clients/${id}`)).body.stats).toMatchObject({ purchases_count: 2, frequency_days: null, days_since_last: 60 })

    sale(id, item, { date: addDays(T, -30) })
    sale(id, item, { date: T })
    // 3 días distintos en 60 días → cada 30 días (no 60 / 3 = 20 por las dos ventas del mismo día)
    expect((await t.get(`/clients/${id}`)).body.stats).toMatchObject({ purchases_count: 4, frequency_days: 30 })
  })

  it('cliente sin compras: estadísticas en cero y sin frecuencia', async () => {
    const id = (await t.post('/clients', { name: 'Nuevo' })).body.id
    const r = await t.get(`/clients/${id}`)
    expect(r.body.stats).toMatchObject({ total_bought: 0, purchases_count: 0, avg_ticket: 0, last_purchase: null, frequency_days: null, days_since_last: null, favorite_wines: [] })
    expect(r.body.sales).toEqual([])
  })

  it('404 si no existe', async () => {
    const r = await t.get('/clients/999')
    expect(r.status).toBe(404)
    expect(r.body.error).toMatch(/No encontramos ese cliente/)
    expect((await t.get('/clients/abc')).status).toBe(404)
  })
})

describe('PUT /clients/:id', () => {
  it('edita completo o parcial (desactivar) y no deja duplicar nombres', async () => {
    const id = (await t.post('/clients', { name: 'Ana', phone: '111' })).body.id
    await t.post('/clients', { name: 'Beto' })
    const r = await t.put(`/clients/${id}`, { name: 'Ana Pérez', kind: 'empresa', phone: '222', email: null, tax_id: null, address: null, city: 'Rosario', notes: null, active: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ name: 'Ana Pérez', kind: 'empresa', phone: '222', city: 'Rosario' })
    const off = await t.put(`/clients/${id}`, { active: false })
    expect(off.body).toMatchObject({ name: 'Ana Pérez', phone: '222', active: false })
    const dup = await t.put(`/clients/${id}`, { name: 'beto' })
    expect(dup.status).toBe(409)
    // Cambiar mayúsculas del propio nombre no es duplicado
    expect((await t.put(`/clients/${id}`, { name: 'ANA PÉREZ' })).status).toBe(200)
    expect((await t.put('/clients/999', { name: 'X' })).status).toBe(404)
  })
})

describe('DELETE /clients/:id', () => {
  it('borra un cliente sin ventas y no deja borrar uno con ventas (409 sugiere desactivar)', async () => {
    const sinVentas = (await t.post('/clients', { name: 'Sin ventas' })).body.id
    expect((await t.del(`/clients/${sinVentas}`)).body).toEqual({ ok: true })
    expect((await t.get(`/clients/${sinVentas}`)).status).toBe(404)

    const conVentas = (await t.post('/clients', { name: 'Con ventas' })).body.id
    sale(conVentas, [{ product_id: wine('Malbec'), qty: 1, unit_price: 2000 }])
    const r = await t.del(`/clients/${conVentas}`)
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/1 venta cargada/)
    expect(r.body.error).toMatch(/Desactivalo/)
    expect((await t.del('/clients/999')).status).toBe(404)
  })
})

describe('GET /clients/export', () => {
  it('descarga el Excel de clientes con totales y saldos', async () => {
    const id = (await t.post('/clients', { name: 'Vinoteca Baco', kind: 'vinoteca', city: 'CABA' })).body.id
    sale(id, [{ product_id: wine('Malbec'), qty: 2, unit_price: 2000 }], { paid: false })
    const res = await t.raw('/clients/export')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/vinoh-clientes-/)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.getWorksheet('Clientes')!
    expect(ws.getRow(4).getCell(1).value).toBe('Cliente')
    expect(ws.getRow(5).getCell(1).value).toBe('Vinoteca Baco')
    expect(ws.getRow(5).getCell(2).value).toBe('Vinoteca')
    expect(ws.getRow(5).getCell(10).value).toBe(4000) // total comprado
    expect(ws.getRow(5).getCell(15).value).toBe(4000) // te debe
  })
})

describe('Consistencia con Caja e Inicio', () => {
  it('lo que te deben los clientes + las ventas de mostrador sin cobrar = el "por cobrar" del tablero', async () => {
    const a = (await t.post('/clients', { name: 'Ana' })).body.id
    const b = (await t.post('/clients', { name: 'Bistró' })).body.id
    const w = wine('Malbec')
    sale(a, [{ product_id: w, qty: 2, unit_price: 5000 }], { paid: false })
    const sb = sale(b, [{ product_id: w, qty: 6, unit_price: 4000 }], { paid: false, due_date: addDays(T, -3) })
    addSettlement('sale', sb, { date: T, amount: 4000, account_id: accountBalances()[0].id })
    sale(null, [{ product_id: w, qty: 1, unit_price: 3000 }], { paid: false }) // mostrador, sin cliente

    const clients: { balance: number; overdue: number }[] = (await t.get('/clients')).body
    const owed = clients.reduce((s, c) => s + c.balance, 0)
    expect(owed).toBe(10000 + 20000)
    expect(clients.reduce((s, c) => s + c.overdue, 0)).toBe(20000)
    expect(owed + 3000).toBe(receivables().total)
    expect((await t.get('/pending')).body.totals.receivables).toBe(receivables().total)
  })
})
