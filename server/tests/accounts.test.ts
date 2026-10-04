// Tests de la API de Caja y bancos: cuentas (alta, edición, borrado y desactivación con sus 409),
// movimientos sueltos (dirección según el tipo), transferencias (borrar una pata borra las dos),
// arqueo, movimientos con saldo corrido, por cobrar / por pagar (coinciden con finance) y flujo de caja.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { get, run } from '../db'
import { addMovement } from '../services/stock'
import { accountBalances, addSettlement, totalCash } from '../services/payments'
import { createSale } from '../services/sales'
import { createPurchase } from '../services/purchases'
import { createExpense } from '../services/expenses'
import { monthlySeries, payables, receivables } from '../services/finance'
import { getSettings } from '../services/settings'
import { expenseInput, purchaseInput, saleInput } from '../../shared/schemas'
import { addDays, addMonths, endOfMonth, monthKey, startOfMonth, today } from '../../shared/dates'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer

beforeEach(async () => {
  t = await startTestServer()
})
afterEach(() => t.close())

const T = today()
const acc = (prefix: string) => accountBalances().find((a) => a.name.startsWith(prefix))!
function wine(name = 'Malbec', stock = 50, cost = 1000) {
  const id = run('INSERT INTO products (name, price_retail) VALUES (?, 2000)', [name]).lastInsertRowid
  addMovement({ product_id: id, date: '2025-01-01', kind: 'inicial', qty: stock, unit_cost: cost })
  return id
}
const sale = (extra: Record<string, unknown> = {}) =>
  createSale(saleInput.parse({ date: T, payment_method: 'efectivo', items: [{ product_id: wine(`Vino ${Math.random()}`), qty: 1, unit_price: 5000 }], ...extra }))
const purchase = (extra: Record<string, unknown> = {}) =>
  createPurchase(purchaseInput.parse({ date: T, items: [{ product_id: wine(`Compra ${Math.random()}`, 0), qty: 6, unit_cost: 1000 }], ...extra }))
const expense = (extra: Record<string, unknown> = {}) =>
  createExpense(expenseInput.parse({ date: T, category: 'Alquiler', description: 'Alquiler del local', amount: 30000, ...extra }))

describe('Cuentas', () => {
  it('GET /accounts devuelve las 3 cuentas base con saldo, entradas/salidas del mes y cantidad de movimientos', async () => {
    const r = await t.get('/accounts')
    expect(r.status).toBe(200)
    expect(r.body.map((a: any) => a.name)).toEqual(['Caja (efectivo)', 'Banco', 'Mercado Pago'])
    expect(r.body[0]).toMatchObject({ balance: 0, total_in: 0, total_out: 0, month_in: 0, month_out: 0, movements_count: 0, active: true, kind: 'efectivo' })
  })

  it('crea, edita (completa o parcial) y valida con mensajes claros', async () => {
    const c = await t.post('/accounts', { name: '  Banco Galicia ', kind: 'banco', initial_balance: 150000, notes: 'Cuenta corriente' })
    expect(c.status).toBe(201)
    expect(c.body).toMatchObject({ id: expect.any(Number), name: 'Banco Galicia', kind: 'banco', initial_balance: 150000, balance: 150000, active: true })

    const e = await t.put(`/accounts/${c.body.id}`, { name: 'Galicia', kind: 'banco', initial_balance: 100000, active: true, notes: null })
    expect(e.status).toBe(200)
    expect(e.body).toMatchObject({ name: 'Galicia', initial_balance: 100000, balance: 100000, notes: null })

    const partial = await t.put(`/accounts/${c.body.id}`, { notes: 'Solo cambia la nota' })
    expect(partial.body).toMatchObject({ name: 'Galicia', initial_balance: 100000, notes: 'Solo cambia la nota' })

    const bad = await t.post('/accounts', { name: '', kind: 'cofre' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/Nombre: es obligatorio/)
    expect(bad.body.error).toMatch(/Tipo: no es una opción válida/)

    const dup = await t.post('/accounts', { name: 'galicia' })
    expect(dup.status).toBe(409)
    expect(dup.body.error).toMatch(/Ya tenés una cuenta llamada «Galicia»/)

    expect((await t.put('/accounts/9999', { name: 'X' })).status).toBe(404)
  })

  it('GET /accounts?as_of= devuelve los saldos a esa fecha', async () => {
    const caja = acc('Caja').id
    await t.post('/movements', { date: '2026-01-10', kind: 'aporte', amount: 1000, account_id: caja })
    await t.post('/movements', { date: '2026-03-10', kind: 'aporte', amount: 500, account_id: caja })
    const feb = (await t.get('/accounts?as_of=2026-02-01')).body.find((a: any) => a.id === caja)
    expect(feb.balance).toBe(1000)
    const now = (await t.get('/accounts')).body.find((a: any) => a.id === caja)
    expect(now.balance).toBe(1500)
    expect(now.movements_count).toBe(2)
    expect(now.last_movement).toBe('2026-03-10')
  })

  it('no deja borrar una cuenta con movimientos (409 sugiere desactivar) y sí una sin movimientos', async () => {
    const caja = acc('Caja').id
    await t.post('/movements', { date: T, kind: 'aporte', amount: 1000, account_id: caja })
    const r = await t.del(`/accounts/${caja}`)
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/1 movimiento/)
    expect(r.body.error).toMatch(/Desactivala/)

    const nueva = (await t.post('/accounts', { name: 'Caja chica', kind: 'efectivo' })).body
    expect((await t.del(`/accounts/${nueva.id}`)).body).toEqual({ ok: true })
    expect((await t.get('/accounts')).body.some((a: any) => a.id === nueva.id)).toBe(false)
    expect((await t.del(`/accounts/${nueva.id}`)).status).toBe(404)
  })

  it('no deja desactivar ni borrar la última cuenta activa; al desactivar, los medios de pago se reasignan', async () => {
    const [caja, banco, mp] = ['Caja', 'Banco', 'Mercado'].map((p) => acc(p).id)
    expect(getSettings().payment_methods.find((m) => m.key === 'efectivo')!.account_id).toBe(caja)

    const off = await t.put(`/accounts/${caja}`, { active: false })
    expect(off.status).toBe(200)
    expect(off.body.active).toBe(false)
    // efectivo ya no apunta a una cuenta desactivada
    expect(getSettings().payment_methods.find((m) => m.key === 'efectivo')!.account_id).not.toBe(caja)

    expect((await t.put(`/accounts/${banco}`, { active: false })).status).toBe(200)
    const last = await t.put(`/accounts/${mp}`, { active: false })
    expect(last.status).toBe(409)
    expect(last.body.error).toMatch(/al menos una cuenta activa/)
    const delLast = await t.del(`/accounts/${mp}`)
    expect(delLast.status).toBe(409)
    expect(delLast.body.error).toMatch(/al menos una cuenta activa/)
    // Una desactivada sin movimientos sí se puede borrar
    expect((await t.del(`/accounts/${banco}`)).status).toBe(200)
    // Reactivar
    expect((await t.put(`/accounts/${caja}`, { active: true })).body.active).toBe(true)
  })
})

describe('Movimientos sueltos', () => {
  it('registra aportes y retiros con su dirección natural (aunque no la manden)', async () => {
    const caja = acc('Caja').id
    const a = await t.post('/movements', { date: T, kind: 'aporte', amount: 200000, account_id: caja, description: 'Capital inicial' })
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ id: expect.any(Number), ref_type: 'aporte', direction: 'in', amount: 200000, description: 'Capital inicial', ref_id: null })
    const r = await t.post('/movements', { date: T, kind: 'retiro', direction: 'out', amount: 50000, account_id: caja })
    expect(r.body.direction).toBe('out')
    expect(acc('Caja').balance).toBe(150000)
  })

  it('rechaza la dirección equivocada y sugiere el tipo correcto; el ajuste va para los dos lados', async () => {
    const caja = acc('Caja').id
    const bad = await t.post('/movements', { date: T, kind: 'retiro', direction: 'in', amount: 100, account_id: caja })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/siempre es plata que sale/)
    expect(bad.body.error).toMatch(/Aporte de socios/)
    const bad2 = await t.post('/movements', { date: T, kind: 'prestamo_recibido', direction: 'out', amount: 100, account_id: caja })
    expect(bad2.status).toBe(400)
    expect(bad2.body.error).toMatch(/Pago de préstamo/)

    expect((await t.post('/movements', { date: T, kind: 'ajuste', direction: 'in', amount: 300, account_id: caja })).status).toBe(201)
    expect((await t.post('/movements', { date: T, kind: 'ajuste', direction: 'out', amount: 100, account_id: caja })).status).toBe(201)
    const noDir = await t.post('/movements', { date: T, kind: 'ajuste', amount: 100, account_id: caja })
    expect(noDir.status).toBe(400)
    expect(acc('Caja').balance).toBe(200)
  })

  it('valida monto, fecha, tipo y cuenta', async () => {
    const caja = acc('Caja').id
    const r = await t.post('/movements', { date: 'ayer', kind: 'aporte', amount: 0, account_id: caja })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/Fecha/)
    expect(r.body.error).toMatch(/Monto: tiene que ser mayor a 0/)
    expect((await t.post('/movements', { date: T, kind: 'venta', direction: 'in', amount: 10, account_id: caja })).status).toBe(400)
    const noAcc = await t.post('/movements', { date: T, kind: 'aporte', amount: 10, account_id: 999 })
    expect(noAcc.status).toBe(400)
    expect(noAcc.body.error).toMatch(/no existe/)
  })

  it('edita un movimiento suelto pero no un cobro de venta', async () => {
    const caja = acc('Caja').id
    const banco = acc('Banco').id
    const m = (await t.post('/movements', { date: T, kind: 'aporte', amount: 1000, account_id: caja })).body
    const e = await t.put(`/movements/${m.id}`, { amount: 1500, account_id: banco, description: 'Aporte de Mariel' })
    expect(e.status).toBe(200)
    expect(e.body).toMatchObject({ amount: 1500, account_id: banco, direction: 'in', description: 'Aporte de Mariel' })
    // Cambiar el tipo toma su dirección natural
    expect((await t.put(`/movements/${m.id}`, { kind: 'retiro' })).body.direction).toBe('out')

    const saleId = sale()
    const pay = get<{ id: number }>("SELECT id FROM payments WHERE ref_type = 'sale' AND ref_id = ?", [saleId])!
    const r = await t.put(`/movements/${pay.id}`, { amount: 1 })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/Editalo desde ahí/)
  })

  it('DELETE /payments/:id borra un movimiento; las comisiones no se borran a mano', async () => {
    const caja = acc('Caja').id
    const m = (await t.post('/movements', { date: T, kind: 'otro_ingreso', amount: 700, account_id: caja })).body
    expect((await t.del(`/payments/${m.id}`)).body).toEqual({ ok: true })
    expect((await t.del(`/payments/${m.id}`)).status).toBe(404)

    const saleId = sale({ payment_method: 'mercadopago' })
    const fee = get<{ id: number }>("SELECT id FROM payments WHERE ref_type = 'sale_fee' AND ref_id = ?", [saleId])!
    const r = await t.del(`/payments/${fee.id}`)
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/comisiones/)
    // Borrar el cobro de la venta borra también su comisión y la venta queda por cobrar
    const pay = get<{ id: number }>("SELECT id FROM payments WHERE ref_type = 'sale' AND ref_id = ?", [saleId])!
    expect((await t.del(`/payments/${pay.id}`)).status).toBe(200)
    expect(get("SELECT id FROM payments WHERE ref_type = 'sale_fee' AND ref_id = ?", [saleId])).toBeUndefined()
  })
})

describe('Transferencias', () => {
  it('mueve plata entre cuentas sin cambiar el total, y borrar una pata borra las dos', async () => {
    const caja = acc('Caja').id
    const banco = acc('Banco').id
    await t.post('/movements', { date: T, kind: 'aporte', amount: 100000, account_id: caja })
    const tr = await t.post('/transfers', { date: T, from_account_id: caja, to_account_id: banco, amount: 40000, description: 'Depósito' })
    expect(tr.status).toBe(201)
    expect(tr.body).toMatchObject({ id: expect.any(Number), transfer_id: expect.any(String), amount: 40000, from_account_id: caja, to_account_id: banco })
    expect(tr.body.payments).toHaveLength(2)
    expect(acc('Caja').balance).toBe(60000)
    expect(acc('Banco').balance).toBe(40000)
    expect(totalCash()).toBe(100000)

    // En movimientos: el texto dice a dónde fue y desde dónde vino
    const mv = (await t.get(`/movements?from=${T}&to=${T}`)).body
    const legs = mv.rows.filter((r: any) => r.ref_type === 'transfer')
    expect(legs.map((r: any) => r.document).sort()).toEqual(['Transferencia a Banco', 'Transferencia desde Caja (efectivo)'])
    expect(legs.every((r: any) => r.manual)).toBe(true)
    // Mirando todas las cuentas, la transferencia no cuenta como entrada ni salida
    expect(mv.summary).toMatchObject({ total_in: 100000, total_out: 0, transfers: 40000 })

    const inLeg = legs.find((r: any) => r.direction === 'in')
    expect((await t.del(`/payments/${inLeg.id}`)).status).toBe(200)
    expect(get('SELECT COUNT(*) AS n FROM payments WHERE transfer_id = ?', [tr.body.transfer_id])).toEqual({ n: 0 })
    expect(acc('Caja').balance).toBe(100000)
  })

  it('valida cuentas distintas y existentes', async () => {
    const caja = acc('Caja').id
    const same = await t.post('/transfers', { date: T, from_account_id: caja, to_account_id: caja, amount: 10 })
    expect(same.status).toBe(400)
    expect(same.body.error).toMatch(/dos cuentas distintas/)
    const missing = await t.post('/transfers', { date: T, from_account_id: caja, to_account_id: 999, amount: 10 })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toMatch(/cuenta de destino no existe/)
    expect(get('SELECT COUNT(*) AS n FROM payments')).toEqual({ n: 0 })
  })
})

describe('Arqueo', () => {
  it('si sobra plata registra un ajuste de entrada, si falta uno de salida, y si coincide no hace nada', async () => {
    const caja = acc('Caja').id
    await t.post('/movements', { date: '2026-01-05', kind: 'aporte', amount: 10000, account_id: caja })

    const over = await t.post(`/accounts/${caja}/reconcile`, { date: '2026-01-10', counted: 10500 })
    expect(over.status).toBe(201)
    expect(over.body).toMatchObject({ system_balance: 10000, counted: 10500, difference: 500, direction: 'in', payment_id: expect.any(Number) })
    const p = get<any>('SELECT * FROM payments WHERE id = ?', [over.body.payment_id])
    expect(p).toMatchObject({ ref_type: 'ajuste', direction: 'in', amount: 500, date: '2026-01-10' })
    expect(p.description).toMatch(/^Arqueo: contaste \$ 10\.500$/)

    const under = await t.post(`/accounts/${caja}/reconcile`, { date: '2026-01-11', counted: 9800.5 })
    expect(under.body).toMatchObject({ system_balance: 10500, difference: -699.5, direction: 'out' })
    expect(acc('Caja').balance).toBe(9800.5)

    const same = await t.post(`/accounts/${caja}/reconcile`, { date: '2026-01-12', counted: 9800.5 })
    expect(same.status).toBe(200)
    expect(same.body).toMatchObject({ difference: 0, payment_id: null })
    expect(get('SELECT COUNT(*) AS n FROM payments')).toEqual({ n: 3 })
  })

  it('compara contra el saldo a la fecha del arqueo (no el de hoy) y valida lo que contaste', async () => {
    const caja = acc('Caja').id
    await t.post('/movements', { date: '2026-01-05', kind: 'aporte', amount: 1000, account_id: caja })
    await t.post('/movements', { date: '2026-02-05', kind: 'aporte', amount: 5000, account_id: caja })
    const r = await t.post(`/accounts/${caja}/reconcile`, { date: '2026-01-31', counted: 900 })
    expect(r.body).toMatchObject({ system_balance: 1000, difference: -100 })

    const missing = await t.post(`/accounts/${caja}/reconcile`, { date: T })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toMatch(/cuánta plata contaste/)
    expect((await t.post('/accounts/999/reconcile', { date: T, counted: 1 })).status).toBe(404)
  })

  it('no acepta un arqueo con fecha futura (no se puede contar plata de mañana)', async () => {
    const caja = acc('Caja').id
    const r = await t.post(`/accounts/${caja}/reconcile`, { date: addDays(T, 1), counted: 500 })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/no puede ser futura/)
    expect(get('SELECT COUNT(*) AS n FROM payments')).toEqual({ n: 0 })
  })
})

describe('GET /movements', () => {
  it('enriquece cada movimiento: tipo, cliente/proveedor, comprobante y monto con signo', async () => {
    const cliente = run("INSERT INTO clients (name) VALUES ('Bistró La Esquina')").lastInsertRowid
    const prov = run("INSERT INTO suppliers (name) VALUES ('Bodega Los Cerros')").lastInsertRowid
    const saleId = sale({ client_id: cliente, payment_method: 'mercadopago' })
    const purchaseId = purchase({ supplier_id: prov, invoice_number: 'A-0003-00001234' })
    expense({ description: 'Alquiler de octubre' })

    const r = await t.get(`/movements?from=${T}&to=${T}`)
    expect(r.status).toBe(200)
    const byType = (rt: string) => r.body.rows.find((m: any) => m.ref_type === rt)
    expect(byType('sale')).toMatchObject({ label: 'Cobro de venta', counterpart: 'Bistró La Esquina', document: `Venta #${saleId}`, signed_amount: 5000, manual: false, ref_exists: true })
    expect(byType('sale_fee')).toMatchObject({ label: 'Comisión de cobro', counterpart: 'Mercado Pago / QR', document: `Comisión de la venta #${saleId}` })
    expect(byType('sale_fee').signed_amount).toBeLessThan(0)
    expect(byType('purchase')).toMatchObject({ counterpart: 'Bodega Los Cerros', document: `Compra #${purchaseId} · factura A-0003-00001234`, signed_amount: -6000 })
    expect(byType('expense')).toMatchObject({ document: 'Gasto: Alquiler de octubre', label: 'Pago de gasto', signed_amount: -30000 })
    expect(byType('sale').account_name).toBe('Mercado Pago')
  })

  it('filtra por cuenta (con saldo corrido como un resumen de banco), dirección y tipo', async () => {
    const caja = acc('Caja').id
    const banco = acc('Banco').id
    run('UPDATE accounts SET initial_balance = 1000 WHERE id = ?', [caja])
    await t.post('/movements', { date: '2026-01-02', kind: 'aporte', amount: 500, account_id: caja })
    await t.post('/movements', { date: '2026-02-01', kind: 'aporte', amount: 100, account_id: caja })
    await t.post('/movements', { date: '2026-02-03', kind: 'retiro', amount: 300, account_id: caja })
    await t.post('/movements', { date: '2026-02-04', kind: 'aporte', amount: 999, account_id: banco })
    await t.post('/transfers', { date: '2026-02-05', from_account_id: caja, to_account_id: banco, amount: 200 })

    const r = (await t.get(`/movements?from=2026-02-01&to=2026-02-28&account_id=${caja}`)).body
    expect(r.rows.map((m: any) => [m.date, m.signed_amount, m.running_balance])).toEqual([
      ['2026-02-05', -200, 1100],
      ['2026-02-03', -300, 1300],
      ['2026-02-01', 100, 1600],
    ])
    expect(r.summary).toMatchObject({ opening_balance: 1500, closing_balance: 1100, total_in: 100, total_out: 500, net: -400, count: 3 })

    const outs = (await t.get(`/movements?from=2026-02-01&to=2026-02-28&account_id=${caja}&direction=out`)).body
    expect(outs.rows).toHaveLength(2)
    // El saldo corrido sigue siendo el real aunque se filtre
    expect(outs.rows[1].running_balance).toBe(1300)

    const owners = (await t.get('/movements?from=2026-01-01&to=2026-12-31&ref_type=aporte,retiro')).body
    expect(owners.rows).toHaveLength(4)
    expect(owners.rows.every((m: any) => m.running_balance === null)).toBe(true)
    const manual = (await t.get('/movements?from=2026-01-01&to=2026-12-31&ref_type=manual')).body
    expect(manual.rows).toHaveLength(4)
    expect((await t.get('/movements?from=2026-01-01&to=2026-12-31&ref_type=transfer')).body.rows).toHaveLength(2)
  })

  it('mirando todas las cuentas, las transferencias no son entrada ni salida (en pantalla y en el Excel); filtradas, sí se suman', async () => {
    const caja = acc('Caja').id
    const banco = acc('Banco').id
    await t.post('/movements', { date: T, kind: 'aporte', amount: 1000, account_id: caja })
    await t.post('/movements', { date: T, kind: 'retiro', amount: 300, account_id: banco })
    await t.post('/transfers', { date: T, from_account_id: caja, to_account_id: banco, amount: 700 })
    const q = `from=${startOfMonth(T)}&to=${endOfMonth(T)}`

    const all = (await t.get(`/movements?${q}`)).body
    expect(all.rows).toHaveLength(4)
    expect(all.summary).toMatchObject({ total_in: 1000, total_out: 300, transfers: 700 })

    // Pidiendo ver solo las transferencias, se muestran sus montos (si no, "entró/salió" daría 0 con renglones en la tabla).
    const onlyTransfers = (await t.get(`/movements?${q}&ref_type=transfer`)).body
    expect(onlyTransfers.summary).toMatchObject({ total_in: 700, total_out: 700, count: 2 })

    // El TOTAL del Excel coincide con la pantalla: las transferencias van en "Entre tus cuentas" (suma cero).
    const res = await t.raw(`/movements/export?${q}`)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.getWorksheet('Movimientos')!
    const headers = (ws.getRow(4).values as unknown[]).slice(1)
    expect(headers).toEqual(['Fecha', 'Cuenta', 'Tipo', 'Detalle', 'Cliente / proveedor', 'Nota', 'Entró', 'Salió', 'Entre tus cuentas'])
    const total = ws.getRow(5 + all.rows.length)
    expect(total.getCell(1).value).toBe('TOTAL')
    expect((total.getCell(7).value as any).result).toBe(1000)
    expect((total.getCell(8).value as any).result).toBe(300)
    // Suma cero (exceljs no guarda un resultado 0 en caché, así que se verifica la fórmula y los renglones).
    expect((total.getCell(9).value as any).formula).toBe(`SUM(I5:I${4 + all.rows.length})`)
    const legs = all.rows.map((_: unknown, i: number) => ws.getRow(5 + i).getCell(9).value).filter((v: unknown) => v != null)
    expect(legs.sort()).toEqual([-700, 700])

    // Con filtros, el subtítulo lo dice (así nadie confunde una planilla filtrada con el total).
    const filtered = await t.raw(`/movements/export?${q}&direction=out&ref_type=retiro`)
    const wb2 = new ExcelJS.Workbook()
    await wb2.xlsx.load(await filtered.arrayBuffer())
    expect(String(wb2.getWorksheet('Movimientos')!.getCell(2, 1).value)).toMatch(/Solo lo que salió · Retiro de socios \/ dueños/)
  })

  it('exporta los movimientos a Excel con la hoja de saldos por cuenta', async () => {
    const caja = acc('Caja').id
    await t.post('/movements', { date: T, kind: 'aporte', amount: 1234, account_id: caja })
    const res = await t.raw(`/movements/export?from=${startOfMonth(T)}&to=${endOfMonth(T)}&account_id=${caja}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/spreadsheetml/)
    expect(res.headers.get('content-disposition')).toMatch(/vinoh-movimientos-caja-efectivo/)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Movimientos', 'Saldos por cuenta'])
    const ws = wb.getWorksheet('Movimientos')!
    expect(ws.getRow(4).getCell(1).value).toBe('Fecha')
    expect(ws.getRow(5).getCell(3).value).toBe('Aporte de socios / dueños')
    expect(ws.getRow(5).getCell(7).value).toBe(1234)
    expect(ws.getRow(5).getCell(9).value).toBe(1234) // saldo de la cuenta
  })
})

describe('GET /pending', () => {
  it('lista lo por cobrar y por pagar con días vencidos, y los totales coinciden con finance', async () => {
    const cliente = run("INSERT INTO clients (name) VALUES ('Vinoteca Baco')").lastInsertRowid
    const prov = run("INSERT INTO suppliers (name) VALUES ('Distribuidora Andes')").lastInsertRowid
    const old = sale({ client_id: cliente, date: addDays(T, -40), paid: false, due_date: addDays(T, -10) })
    const recent = sale({ date: addDays(T, -2), paid: false })
    const partial = sale({ date: addDays(T, -5), paid: false, due_date: addDays(T, 20) })
    addSettlement('sale', partial, { date: T, amount: 2000, account_id: acc('Caja').id })
    sale() // cobrada: no aparece
    const pu = purchase({ supplier_id: prov, paid: false, due_date: addDays(T, -3), invoice_number: 'B-0001' })
    const ex = expense({ paid: false, due_date: addDays(T, 15), description: 'Contador' })
    expense() // pagado

    const r = await t.get('/pending')
    expect(r.status).toBe(200)
    expect(r.body.receivables.map((s: any) => s.id)).toEqual([old, partial, recent]) // más viejas primero
    expect(r.body.receivables[0]).toMatchObject({ client_name: 'Vinoteca Baco', overdue: true, days_overdue: 10, age_days: 40, balance: 5000 })
    expect(r.body.receivables[1]).toMatchObject({ balance: 3000, status: 'parcial', overdue: false, days_overdue: 0 })
    expect(r.body.payables.map((p: any) => [p.type, p.id])).toEqual([
      ['purchase', pu],
      ['expense', ex],
    ])
    expect(r.body.payables[0]).toMatchObject({ name: 'Distribuidora Andes', detail: `Compra #${pu} · factura B-0001`, overdue: true, days_overdue: 3, balance: 6000 })
    expect(r.body.payables[1]).toMatchObject({ name: 'Contador', detail: 'Alquiler', balance: 30000, overdue: false })

    const rec = receivables()
    const pay = payables()
    expect(r.body.totals).toMatchObject({
      receivables: rec.total,
      receivables_overdue: rec.overdue,
      payables: pay.total,
      payables_overdue: pay.overdue,
    })
    expect(r.body.totals.receivables).toBe(13000)
    expect(r.body.totals.receivables_overdue).toBe(5000)
    expect(r.body.totals.payables).toBe(36000)
    const sum = (xs: any[]) => Math.round(xs.reduce((s, x) => s + x.balance, 0) * 100) / 100
    expect(sum(r.body.receivables)).toBe(r.body.totals.receivables)
    expect(sum(r.body.payables)).toBe(r.body.totals.payables)
  })

  it('proyecta los próximos 30 días: cobros y pagos que vencen + gastos fijos que todavía no se generaron', async () => {
    const caja = acc('Caja').id
    await t.post('/movements', { date: T, kind: 'aporte', amount: 100000, account_id: caja })
    sale({ paid: false, due_date: addDays(T, 10) }) // entra
    sale({ paid: false, due_date: addDays(T, 60) }) // más adelante: no entra
    sale({ paid: false }) // sin fecha: entra
    purchase({ paid: false, due_date: addDays(T, -1) }) // vencida: sale
    // Plantilla de gasto fijo: cae en los próximos 30 días (o ya cayó este mes) y no se generó todavía.
    run("INSERT INTO recurring_expenses (description, category, amount, day_of_month) VALUES ('Alquiler', 'Alquiler', 80000, 28)")
    const r = (await t.get('/pending')).body.projection
    expect(r.cash_now).toBe(100000)
    expect(r.in_breakdown).toMatchObject({ upcoming: 5000, no_date: 5000, later: 5000, overdue: 0 })
    expect(r.next_30_days_in).toBe(10000)
    expect(r.out_breakdown.overdue).toBe(6000)
    // La plantilla cae al menos una vez en la ventana de 30 días (día 28 de este mes o del que viene).
    expect(r.fixed_items.length).toBeGreaterThanOrEqual(1)
    expect(r.out_breakdown.fixed).toBe(80000 * r.fixed_items.length)
    expect(r.next_30_days_out).toBe(6000 + r.out_breakdown.fixed)
    expect(r.expected_balance).toBe(100000 + 10000 - r.next_30_days_out)
  })

  it('exporta por cobrar, por pagar y la proyección a Excel', async () => {
    sale({ paid: false })
    const res = await t.raw('/pending/export')
    expect(res.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Por cobrar', 'Por pagar', 'Próximos 30 días'])
    expect(wb.getWorksheet('Por cobrar')!.getRow(5).getCell(8).value).toBe(5000)
  })
})

describe('GET /cashflow', () => {
  it('arma los meses con entradas, salidas, neto y plata a fin de mes (sin contar transferencias)', async () => {
    const caja = acc('Caja').id
    const banco = acc('Banco').id
    run('UPDATE accounts SET initial_balance = 1000 WHERE id = ?', [banco])
    await t.post('/movements', { date: '2026-01-10', kind: 'aporte', amount: 5000, account_id: caja })
    await t.post('/movements', { date: '2026-02-10', kind: 'retiro', amount: 2000, account_id: caja })
    await t.post('/transfers', { date: '2026-02-11', from_account_id: caja, to_account_id: banco, amount: 1000 })
    await t.post('/movements', { date: '2026-03-10', kind: 'prestamo_recibido', amount: 300, account_id: banco })

    const r = await t.get('/cashflow?from=2026-01-01&to=2026-03-31')
    expect(r.status).toBe(200)
    expect(r.body.months.map((m: any) => [m.month, m.cash_in, m.cash_out, m.net, m.balance_end])).toEqual([
      ['2026-01', 5000, 0, 5000, 6000],
      ['2026-02', 0, 2000, -2000, 4000],
      ['2026-03', 300, 0, 300, 4300],
    ])
    // Coincide con monthlySeries de finance
    const series = monthlySeries('2026-01-01', '2026-03-31')
    expect(r.body.months.map((m: any) => m.cash_in)).toEqual(series.map((s) => s.cash_in))
    expect(r.body.by_kind.map((k: any) => k.ref_type).sort()).toEqual(['aporte', 'prestamo_recibido', 'retiro'])
    expect(r.body.by_kind.find((k: any) => k.ref_type === 'retiro')).toMatchObject({ label: 'Retiro de socios / dueños', in: 0, out: 2000 })
    expect(r.body.totals).toMatchObject({ cash_in: 5300, cash_out: 2000, net: 3300, balance_start: 1000, balance_end: 4300, contributions: 5000, withdrawals: 2000 })
    expect(r.body.projection).toHaveProperty('next_30_days_in')
    expect(r.body.projection).toHaveProperty('next_30_days_out')
  })

  it('por defecto muestra los últimos 12 meses y exporta a Excel', async () => {
    const r = await t.get('/cashflow')
    expect(r.body.months).toHaveLength(12)
    expect(r.body.months[11].month).toBe(monthKey(T))
    expect(r.body.months[0].month).toBe(monthKey(addMonths(T, -11)))
    const res = await t.raw('/cashflow/export')
    expect(res.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Flujo de caja', 'Por tipo'])
  })
})

describe('Consistencia con Inicio', () => {
  it('la plata total (sumando cuentas desactivadas con saldo) es la misma que usa el tablero, y una desactivada con historia no se borra', async () => {
    const [caja, banco] = ['Caja', 'Banco'].map((p) => acc(p).id)
    await t.post('/movements', { date: T, kind: 'aporte', amount: 50000, account_id: banco })
    await t.post('/transfers', { date: T, from_account_id: banco, to_account_id: caja, amount: 12000 })
    expect((await t.put(`/accounts/${caja}`, { active: false })).status).toBe(200)

    const list: { balance: number; active: boolean }[] = (await t.get('/accounts')).body
    const sum = Math.round(list.reduce((s, a) => s + a.balance, 0) * 100) / 100
    expect(list.find((a) => !a.active)!.balance).toBe(12000)
    expect(sum).toBe(totalCash())
    expect(sum).toBe(50000)

    const del = await t.del(`/accounts/${caja}`)
    expect(del.status).toBe(409)
    expect(del.body.error).toMatch(/Desactivala/)
  })
})
