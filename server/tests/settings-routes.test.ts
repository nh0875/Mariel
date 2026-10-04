// Tests de Configuración: guardado parcial, uso de categorías, Excel completo, info del sistema,
// datos de ejemplo / borrar todo y copias de seguridad (que en memoria no se pueden hacer).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'
import { startTestServer, type TestServer } from './helpers'
import { PROJECT_ROOT, run, scalar } from '../db'
import { addMovement } from '../services/stock'
import { createSale } from '../services/sales'
import { createPurchase } from '../services/purchases'
import { createExpense } from '../services/expenses'
import { expenseInput, purchaseInput, saleInput } from '../../shared/schemas'
import { today } from '../../shared/dates'
import { FULL_EXPORT_SHEETS } from '../routes/settings'

let s: TestServer
beforeEach(async () => {
  s = await startTestServer()
})
afterEach(async () => {
  await s.close()
})

/** Carga un poquito de todo: 1 vino, 1 compra con flete, 1 venta a cuenta, 1 gasto, 1 cliente, 1 proveedor. */
function seedLittle() {
  const d = today()
  const productId = run("INSERT INTO products (name, winery, varietal, price_retail, price_wholesale) VALUES ('Malbec Clásico', 'Bodega Los Cerros', 'Malbec', 12000, 10000)").lastInsertRowid
  addMovement({ product_id: productId, date: d, kind: 'inicial', qty: 12, unit_cost: 6000 })
  const clientId = run("INSERT INTO clients (name, kind) VALUES ('Resto Don Julio', 'restaurante')").lastInsertRowid
  const supplierId = run("INSERT INTO suppliers (name, kind) VALUES ('Bodega Los Cerros', 'bodega')").lastInsertRowid
  createPurchase(purchaseInput.parse({ date: d, supplier_id: supplierId, items: [{ product_id: productId, qty: 6, unit_cost: 6000 }], shipping: 3600, paid: false }))
  const saleId = createSale(saleInput.parse({ date: d, client_id: clientId, channel: 'mayorista', items: [{ product_id: productId, qty: 3, unit_price: 12000 }], paid: false }))
  createExpense(expenseInput.parse({ date: d, category: 'Alquiler', description: 'Alquiler del local', amount: 250000, nature: 'fijo', paid: true }))
  run("INSERT INTO goals (month, sales_target) VALUES (?, 500000)", [d.slice(0, 7)])
  run("INSERT INTO inflation (month, rate) VALUES (?, 2.5)", [d.slice(0, 7)])
  return { productId, clientId, supplierId, saleId }
}

async function readWorkbook(p: string) {
  const res = await s.raw(p)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('spreadsheetml')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer)
  return { wb, disposition: res.headers.get('content-disposition') ?? '' }
}

describe('PUT /settings (guardar por secciones)', () => {
  it('guarda solo lo que viene y mezcla los objetos con lo que ya había', async () => {
    const before = (await s.get('/settings')).body
    const r = await s.put('/settings', { business: { name: 'La Vinoteca de Mariel', owner: 'Mariel' } })
    expect(r.status).toBe(200)
    expect(r.body.business.name).toBe('La Vinoteca de Mariel')
    expect(r.body.business.owner).toBe('Mariel')
    // Lo que no vino queda igual
    expect(r.body.business.tagline).toBe(before.business.tagline)
    expect(r.body.business.fiscal_condition).toBe(before.business.fiscal_condition)
    expect(r.body.payment_methods).toEqual(before.payment_methods)

    const p = await s.put('/settings', { pricing: { iibb_pct: 4 } })
    expect(p.body.pricing.iibb_pct).toBe(4)
    expect(p.body.pricing.target_margin_pct).toBe(before.pricing.target_margin_pct)
    expect(p.body.business.name).toBe('La Vinoteca de Mariel')

    const usd = await s.put('/settings', { usd_rate: 1450, usd_rate_date: '2026-10-01' })
    expect(usd.body.usd_rate).toBe(1450)
    expect(usd.body.usd_rate_date).toBe('2026-10-01')
    // Persistido
    expect((await s.get('/settings')).body.pricing.iibb_pct).toBe(4)
  })

  it('guarda medios de pago y categorías completos', async () => {
    const cur = (await s.get('/settings')).body
    const methods = cur.payment_methods.map((m: any) => (m.key === 'mercadopago' ? { ...m, fee_pct: 5.5, label: 'MP Point' } : m))
    const r = await s.put('/settings', { payment_methods: methods })
    expect(r.status).toBe(200)
    expect(r.body.payment_methods.find((m: any) => m.key === 'mercadopago')).toMatchObject({ fee_pct: 5.5, label: 'MP Point' })

    const cats = await s.put('/settings', { expense_categories: [{ name: 'Alquiler', nature: 'fijo' }, { name: 'Fletes', nature: 'variable' }] })
    expect(cats.status).toBe(200)
    expect(cats.body.expense_categories).toHaveLength(2)
  })

  it('rechaza datos inválidos con mensajes claros', async () => {
    const dup = await s.put('/settings', { expense_categories: [{ name: 'Envíos', nature: 'variable' }, { name: 'envios ', nature: 'fijo' }] })
    expect(dup.status).toBe(400)
    expect(dup.body.error).toMatch(/repetida/)

    const none = await s.put('/settings', { expense_categories: [] })
    expect(none.status).toBe(400)
    expect(none.body.error).toMatch(/Revisá/)

    const fee = await s.put('/settings', { payment_methods: [{ key: 'credito', label: 'Crédito', fee_pct: 80, account_id: null }] })
    expect(fee.status).toBe(400)

    const fiscal = await s.put('/settings', { business: { fiscal_condition: 'cualquiera' } })
    expect(fiscal.status).toBe(400)
    expect(fiscal.body.error).toMatch(/opción válida/)
  })
})

describe('GET /settings/category-usage', () => {
  it('cuenta los gastos por categoría y muestra las que ya no están en la lista', async () => {
    seedLittle()
    createExpense(expenseInput.parse({ date: today(), category: 'Categoría vieja', description: 'Algo', amount: 1000, paid: true }))
    run("INSERT INTO recurring_expenses (description, category, amount) VALUES ('Alquiler', 'Alquiler', 250000)")
    const r = await s.get('/settings/category-usage')
    expect(r.status).toBe(200)
    const alquiler = r.body.categories.find((c: any) => c.name === 'Alquiler')
    expect(alquiler).toMatchObject({ expenses: 1, recurring: 1, amount: 250000, nature: 'fijo' })
    expect(r.body.categories.find((c: any) => c.name === 'Otros').expenses).toBe(0)
    expect(r.body.others).toEqual([expect.objectContaining({ name: 'Categoría vieja', expenses: 1 })])
  })
})

describe('GET /export/all', () => {
  it('arma un Excel con todas las hojas en castellano, empezando por «Léeme»', async () => {
    const { saleId } = seedLittle()
    const { wb, disposition } = await readWorkbook('/export/all')
    expect(disposition).toMatch(/vinoh-todos-los-datos-\d{4}-\d{2}-\d{2}\.xlsx/)
    const names = wb.worksheets.map((w) => w.name)
    expect(names).toEqual([
      'Léeme',
      'Vinos',
      'Movimientos de stock',
      'Ventas',
      'Detalle de ventas',
      'Compras',
      'Detalle de compras',
      'Gastos',
      'Gastos fijos',
      'Cuentas',
      'Movimientos de caja',
      'Clientes',
      'Proveedores',
      'Eventos',
      'Metas',
      'Inflación',
    ])
    expect(names).toEqual(FULL_EXPORT_SHEETS)

    // Léeme: una fila por hoja con su cantidad de filas
    const readme = wb.getWorksheet('Léeme')!
    expect(readme.getCell(4, 1).value).toBe('Hoja')
    expect(readme.getCell(5, 1).value).toBe('Vinos')
    expect(readme.getCell(5, 3).value).toBe(1)

    // Ventas: encabezados amigables y estado calculado igual que en la pantalla
    const ventas = wb.getWorksheet('Ventas')!
    const headers = (ventas.getRow(4).values as unknown[]).slice(1)
    expect(headers).toContain('Falta cobrar')
    expect(headers).toContain('Costo del vino (CMV)')
    expect(ventas.getCell(5, 1).value).toBe(saleId)
    const col = (h: string) => headers.indexOf(h) + 1
    expect(ventas.getCell(5, col('Total')).value).toBe(36000)
    expect(ventas.getCell(5, col('Estado')).value).toBe('Por cobrar')
    expect(ventas.getCell(5, col('Canal')).value).toBe('Mayorista (restós, vinotecas)')

    // Clientes: lo que debe sale de las mismas ventas
    const clientes = wb.getWorksheet('Clientes')!
    const ch = (clientes.getRow(4).values as unknown[]).slice(1)
    expect(clientes.getCell(5, ch.indexOf('Te debe') + 1).value).toBe(36000)

    // Detalle de compras: el flete se reparte en el costo real ($3.600 / 6 = $600 por botella)
    const dc = wb.getWorksheet('Detalle de compras')!
    const dh = (dc.getRow(4).values as unknown[]).slice(1)
    expect(dc.getCell(5, dh.indexOf('Costo real por botella (con flete)') + 1).value).toBe(6600)

    // Movimientos de caja: incluye el pago del gasto
    const caja = wb.getWorksheet('Movimientos de caja')!
    const cajaText = JSON.stringify(caja.getSheetValues())
    expect(cajaText).toContain('Pago de gasto')

    // Todas las hojas traen la explicación
    for (const w of wb.worksheets) {
      expect(JSON.stringify(w.getSheetValues())).toContain('¿Cómo leer esta planilla?')
    }
  })

  it('funciona aunque no haya datos (hojas vacías con aviso)', async () => {
    const { wb } = await readWorkbook('/export/all')
    expect(wb.worksheets).toHaveLength(16)
    expect(wb.getWorksheet('Ventas')!.getCell(5, 1).value).toBe('No hay datos para este período.')
  })
})

describe('GET /system', () => {
  it('informa versión, dónde están los datos y cuántos registros hay', async () => {
    seedLittle()
    const r = await s.get('/system')
    expect(r.status).toBe(200)
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
    expect(r.body.version).toBe(pkg.version)
    expect(r.body.node).toBe(process.version)
    expect(r.body.in_memory).toBe(true)
    expect(r.body.db_path).toBe(':memory:')
    expect(r.body.last_backup).toBeNull()
    const count = (t: string) => r.body.counts.find((c: any) => c.table === t)
    expect(count('products')).toMatchObject({ label: 'Vinos', count: 1 })
    expect(count('sales').count).toBe(1)
    expect(count('accounts').count).toBe(3)
    expect(r.body.counts).toHaveLength(15)
  })
})

describe('Datos de ejemplo y borrar todo', () => {
  it('carga los datos de ejemplo, los marca y después borra todo dejando las cuentas base', async () => {
    const r = await s.post('/demo/load')
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.sales).toBeGreaterThan(500)
    expect(scalar<number>('SELECT COUNT(*) FROM products')).toBeGreaterThan(10)
    const st = (await s.get('/settings')).body
    expect(st.onboarding).toEqual({ completed: true, demo_loaded: true })

    const sys = (await s.get('/system')).body
    expect(sys.counts.find((c: any) => c.table === 'sales').count).toBe(r.body.sales)

    // Le cambio el nombre al negocio: borrar todo NO toca la configuración
    await s.put('/settings', { business: { name: 'Mi vinoteca' } })
    const reset = await s.post('/data/reset')
    expect(reset.status).toBe(200)
    for (const t of ['products', 'sales', 'purchases', 'expenses', 'payments', 'stock_movements', 'clients', 'suppliers', 'events', 'goals']) {
      expect(scalar<number>(`SELECT COUNT(*) FROM ${t}`)).toBe(0)
    }
    expect(scalar<number>('SELECT COUNT(*) FROM accounts')).toBe(3)
    const after = (await s.get('/settings')).body
    expect(after.business.name).toBe('Mi vinoteca')
    expect(after.onboarding).toEqual({ completed: true, demo_loaded: false })
    // Los medios de pago quedan apuntando a las cuentas nuevas
    const accounts = (await s.get('/system')).body.counts.find((c: any) => c.table === 'accounts').count
    expect(accounts).toBe(3)
    expect(after.payment_methods.every((m: any) => m.account_id != null)).toBe(true)
  }, 120_000)

  it('con restart_onboarding vuelve a mostrar la bienvenida', async () => {
    seedLittle()
    const r = await s.post('/data/reset', { restart_onboarding: true })
    expect(r.status).toBe(200)
    expect((await s.get('/settings')).body.onboarding.completed).toBe(false)
    expect(scalar<number>('SELECT COUNT(*) FROM sales')).toBe(0)
  })
})

describe('Copias de seguridad en modo memoria', () => {
  it('lista vacía con aviso, y 400 claro para hacer, bajar o restaurar', async () => {
    const list = await s.get('/backups')
    expect(list.status).toBe(200)
    expect(list.body.available).toBe(false)
    expect(list.body.backups).toEqual([])
    expect(list.body.message).toMatch(/sin guardar en disco/)

    const make = await s.post('/backups')
    expect(make.status).toBe(400)
    expect(make.body.error).toMatch(/copias de seguridad/)

    const dl = await s.get('/backups/vinoh-manual-2026-01-01-10-00-00.db/download')
    expect(dl.status).toBe(400)

    const restore = await s.post('/backups/vinoh-manual-2026-01-01-10-00-00.db/restore')
    expect(restore.status).toBe(400)

    const upload = await s.raw('/backups/restore-upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([1, 2, 3]) })
    expect(upload.status).toBe(400)
    expect((await upload.json()).error).toMatch(/copias de seguridad/)
  })
})
