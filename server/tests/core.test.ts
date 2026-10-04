// Tests del núcleo contable: stock con costo promedio, ventas, compras, gastos, caja y resultado.
import { beforeEach, describe, expect, it } from 'vitest'
import { resetInMemoryDatabase, run, get } from '../db'
import { ensureBaseData } from '../services/setup'
import { createSale, deleteSale, getSaleDetail, updateSale } from '../services/sales'
import { createPurchase, deletePurchase, getPurchaseDetail, updatePurchase } from '../services/purchases'
import { createExpense, generateRecurringForMonth, listExpenses } from '../services/expenses'
import { accountBalances, addSettlement, addTransfer, deletePayment } from '../services/payments'
import { addMovement } from '../services/stock'
import { monthlySeries, periodSummary, receivables, stockValue } from '../services/finance'
import { saleInput, purchaseInput, expenseInput } from '../../shared/schemas'
import { updateSettings, getSettings } from '../services/settings'

function product(name: string, initialStock = 0, cost = 0) {
  const id = run('INSERT INTO products (name, price_retail, price_wholesale) VALUES (?, 2000, 1600)', [name]).lastInsertRowid
  addMovement({ product_id: id, date: '2026-01-01', kind: 'inicial', qty: initialStock, unit_cost: cost })
  return id
}
const prod = (id: number) => get<{ stock: number; unit_cost: number }>('SELECT stock, unit_cost FROM products WHERE id = ?', [id])!
const balance = (name: string) => accountBalances().find((a) => a.name.startsWith(name))!.balance

beforeEach(() => {
  resetInMemoryDatabase()
  ensureBaseData()
})

describe('stock y costo promedio ponderado', () => {
  it('promedia el costo con cada compra y valoriza la venta al costo del momento', () => {
    const malbec = product('Malbec', 10, 1000)
    createPurchase(purchaseInput.parse({ date: '2026-01-10', items: [{ product_id: malbec, qty: 10, unit_cost: 1400 }], paid: false }))
    expect(prod(malbec)).toEqual({ stock: 20, unit_cost: 1200 })

    const saleId = createSale(saleInput.parse({ date: '2026-01-15', items: [{ product_id: malbec, qty: 5, unit_price: 2000 }] }))
    expect(prod(malbec).stock).toBe(15)
    expect(getSaleDetail(saleId).cost).toBe(6000)
  })

  it('reparte el flete en el costo de cada botella', () => {
    const a = product('A')
    const b = product('B')
    const id = createPurchase(
      purchaseInput.parse({
        date: '2026-01-05',
        items: [
          { product_id: a, qty: 10, unit_cost: 1000 }, // 10.000
          { product_id: b, qty: 10, unit_cost: 3000 }, // 30.000
        ],
        shipping: 4000, // 10 % del subtotal
        paid: false,
      }),
    )
    const d = getPurchaseDetail(id)
    expect(d.total).toBe(44000)
    expect(d.items.map((i) => i.landed_unit_cost)).toEqual([1100, 3300])
    expect(prod(a).unit_cost).toBe(1100)
  })

  it('una compra cargada con fecha vieja recalcula el costo de ventas posteriores', () => {
    const p = product('Cabernet', 10, 1000)
    const saleId = createSale(saleInput.parse({ date: '2026-02-01', items: [{ product_id: p, qty: 10, unit_price: 2000 }] }))
    expect(getSaleDetail(saleId).cost).toBe(10000)
    // Compra anterior a la venta: el costo promedio al momento de vender cambia.
    createPurchase(purchaseInput.parse({ date: '2026-01-20', items: [{ product_id: p, qty: 10, unit_cost: 2000 }], paid: false }))
    expect(getSaleDetail(saleId).cost).toBe(15000)
    expect(prod(p)).toEqual({ stock: 10, unit_cost: 1500 })
  })

  it('borrar una compra devuelve el stock y el costo', () => {
    const p = product('Torrontés', 6, 800)
    const id = createPurchase(purchaseInput.parse({ date: '2026-01-10', items: [{ product_id: p, qty: 6, unit_cost: 1200 }], paid: true }))
    expect(prod(p)).toEqual({ stock: 12, unit_cost: 1000 })
    deletePurchase(id)
    expect(prod(p)).toEqual({ stock: 6, unit_cost: 800 })
  })
})

describe('ventas, cobros y comisiones', () => {
  it('cobra la venta en la cuenta del medio de pago y descuenta la comisión', () => {
    const p = product('Malbec', 10, 1000)
    updateSettings({
      payment_methods: getSettings().payment_methods.map((m) => (m.key === 'mercadopago' ? { ...m, fee_pct: 5 } : m)),
    })
    createSale(saleInput.parse({ date: '2026-01-15', payment_method: 'mercadopago', items: [{ product_id: p, qty: 2, unit_price: 5000 }] }))
    // $10.000 − 5 % = $9.500 en Mercado Pago
    expect(balance('Mercado Pago')).toBe(9500)
  })

  it('una venta pendiente se puede cobrar en partes y no deja cobrar de más', () => {
    const p = product('Malbec', 10, 1000)
    const id = createSale(saleInput.parse({ date: '2026-01-15', paid: false, items: [{ product_id: p, qty: 3, unit_price: 1000 }] }))
    expect(getSaleDetail(id).status).toBe('pendiente')
    expect(receivables().total).toBe(3000)
    const caja = accountBalances()[0].id
    addSettlement('sale', id, { date: '2026-01-20', amount: 1000, account_id: caja })
    expect(getSaleDetail(id).status).toBe('parcial')
    expect(() => addSettlement('sale', id, { date: '2026-01-21', amount: 5000, account_id: caja })).toThrow(/no puede superar/)
    addSettlement('sale', id, { date: '2026-01-21', amount: 2000, account_id: caja })
    expect(getSaleDetail(id).status).toBe('pagado')
    expect(receivables().total).toBe(0)
  })

  it('editar y borrar una venta corrige stock y caja', () => {
    const p = product('Malbec', 10, 1000)
    const input = { date: '2026-01-15', items: [{ product_id: p, qty: 2, unit_price: 1500 }] }
    const id = createSale(saleInput.parse(input))
    expect(balance('Caja')).toBe(3000)
    updateSale(id, saleInput.parse({ ...input, items: [{ product_id: p, qty: 4, unit_price: 1500 }] }))
    expect(prod(p).stock).toBe(6)
    expect(balance('Caja')).toBe(6000)
    updateSale(id, saleInput.parse({ ...input, paid: false }))
    expect(balance('Caja')).toBe(0)
    deleteSale(id)
    expect(prod(p).stock).toBe(10)
  })

  it('acepta ítems que no son vinos (entradas, servicios) sin tocar el stock', () => {
    const id = createSale(saleInput.parse({ date: '2026-01-15', items: [{ description: 'Entrada degustación', qty: 10, unit_price: 3000 }] }))
    const d = getSaleDetail(id)
    expect(d.total).toBe(30000)
    expect(d.cost).toBe(0)
    expect(d.bottles).toBe(0)
  })
})

describe('caja', () => {
  it('las transferencias entre cuentas no cambian el total y se borran juntas', () => {
    const [caja, banco] = accountBalances()
    addTransfer({ date: '2026-01-02', from_account_id: caja.id, to_account_id: banco.id, amount: 500 })
    const after = accountBalances()
    expect(after[0].balance).toBe(-500)
    expect(after[1].balance).toBe(500)
    const pay = get<{ id: number }>("SELECT id FROM payments WHERE ref_type = 'transfer' LIMIT 1")!
    deletePayment(pay.id)
    expect(accountBalances().every((a) => a.balance === 0)).toBe(true)
  })
})

describe('resultado del período', () => {
  it('calcula ventas, CMV, mermas, gastos y resultado', () => {
    const p = product('Malbec', 20, 1000)
    createSale(saleInput.parse({ date: '2026-03-05', items: [{ product_id: p, qty: 10, unit_price: 2500 }], discount: 1000 })) // 24.000
    addMovement({ product_id: p, date: '2026-03-10', kind: 'rotura', qty: -2 }) // merma 2.000
    createExpense(expenseInput.parse({ date: '2026-03-01', category: 'Alquiler', description: 'Alquiler marzo', amount: 5000, nature: 'fijo' }))
    createExpense(expenseInput.parse({ date: '2026-03-12', category: 'Envíos y logística', description: 'Moto', amount: 1000, nature: 'variable', paid: false }))
    // Fuera del período: no cuenta
    createExpense(expenseInput.parse({ date: '2026-04-01', category: 'Alquiler', description: 'Alquiler abril', amount: 5000, nature: 'fijo' }))

    const s = periodSummary('2026-03-01', '2026-03-31')
    expect(s.sales).toBe(24000)
    expect(s.cogs).toBe(10000)
    expect(s.gross_profit).toBe(14000)
    expect(s.shrinkage).toBe(2000)
    expect(s.expenses).toBe(6000)
    expect(s.expenses_fixed).toBe(5000)
    expect(s.net_result).toBe(6000)
    expect(s.bottles_sold).toBe(10)
    expect(s.cash_in).toBe(24000)
    expect(s.cash_out).toBe(5000)
    expect(stockValue()).toEqual({ value: 8000, bottles: 8, products: 1 })

    const series = monthlySeries('2026-02-01', '2026-04-30')
    expect(series.map((m) => m.month)).toEqual(['2026-02', '2026-03', '2026-04'])
    expect(series[1].net_result).toBe(6000)
    expect(series[2].expenses).toBe(5000)
  })
})

describe('gastos fijos recurrentes', () => {
  it('genera los gastos del mes una sola vez', () => {
    run("INSERT INTO recurring_expenses (description, category, amount, nature, day_of_month, auto_paid, account_id) VALUES ('Alquiler local', 'Alquiler', 300000, 'fijo', 31, 1, 1)")
    expect(generateRecurringForMonth('2026-02')).toEqual({ created: 1, skipped: 0 })
    expect(generateRecurringForMonth('2026-02')).toEqual({ created: 0, skipped: 1 })
    const [e] = listExpenses({ from: '2026-02-01', to: '2026-02-28' })
    expect(e.date).toBe('2026-02-28')
    expect(e.status).toBe('pagado')
  })
})

describe('orden de la historia del vino (auditoría)', () => {
  it('editar una compra (solo la factura) no cambia el costo de una venta del mismo día', () => {
    const p = product('Mismo día', 0, 0)
    const input = { date: '2026-10-04', invoice_number: 'A-1', items: [{ product_id: p, qty: 12, unit_cost: 1500 }], paid: false }
    const purchaseId = createPurchase(purchaseInput.parse(input))
    const saleId = createSale(saleInput.parse({ date: '2026-10-04', items: [{ product_id: p, qty: 2, unit_price: 3000 }] }))
    expect(getSaleDetail(saleId).cost).toBe(3000)
    updatePurchase(purchaseId, purchaseInput.parse({ ...input, invoice_number: 'A-1-corregida' }))
    expect(getSaleDetail(saleId).cost).toBe(3000)
  })

  it('editar una venta (solo la nota) no cambia su costo si ese día también hubo una compra', () => {
    const p = product('Con stock', 5, 1000)
    const saleInputData = { date: '2026-10-04', items: [{ product_id: p, qty: 2, unit_price: 3000 }] }
    const saleId = createSale(saleInput.parse(saleInputData))
    createPurchase(purchaseInput.parse({ date: '2026-10-04', items: [{ product_id: p, qty: 10, unit_cost: 2000 }], paid: false }))
    const before = getSaleDetail(saleId).cost
    updateSale(saleId, saleInput.parse({ ...saleInputData, notes: 'cambié la nota' }))
    expect(getSaleDetail(saleId).cost).toBe(before)
  })

  it('una compra con fecha anterior al alta del vino no queda en $0', () => {
    const p = run("INSERT INTO products (name, price_retail) VALUES ('Alta tardía', 3000)").lastInsertRowid
    addMovement({ product_id: p, date: '2026-10-04', kind: 'inicial', qty: 0, unit_cost: 0 })
    createPurchase(purchaseInput.parse({ date: '2026-10-01', items: [{ product_id: p, qty: 12, unit_cost: 1500 }], paid: false }))
    expect(prod(p)).toEqual({ stock: 12, unit_cost: 1500 })
    const saleId = createSale(saleInput.parse({ date: '2026-10-04', items: [{ product_id: p, qty: 2, unit_price: 3000 }] }))
    expect(getSaleDetail(saleId).cost).toBe(3000)
  })

  it('botellas iniciales sin costo toman el costo de la primera compra', () => {
    const p = product('Sin costo', 6, 0)
    createPurchase(purchaseInput.parse({ date: '2026-10-04', items: [{ product_id: p, qty: 6, unit_cost: 1000 }], paid: false }))
    expect(prod(p)).toEqual({ stock: 12, unit_cost: 1000 })
  })
})
