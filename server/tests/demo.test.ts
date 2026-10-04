import { describe, expect, it } from 'vitest'
import { resetInMemoryDatabase, all } from '../db'
import { loadDemoData } from '../seed/demo'
import { monthlySeries, stockValue } from '../services/finance'
import { accountBalances } from '../services/payments'

describe('datos de ejemplo', () => {
  it('genera 14 meses coherentes (sin stock negativo, con ventas todos los meses)', () => {
    resetInMemoryDatabase()
    const counts = loadDemoData('2026-10-04')
    expect(counts.sales).toBeGreaterThan(1000)
    const series = monthlySeries('2025-09-01', '2026-09-30')
    expect(series).toHaveLength(13)
    for (const m of series) {
      expect(m.sales).toBeGreaterThan(0)
      expect(m.gross_margin).toBeGreaterThan(0.25)
      expect(m.gross_margin).toBeLessThan(0.55)
    }
    expect(all('SELECT id FROM products WHERE stock < 0')).toHaveLength(0)
    expect(stockValue().value).toBeGreaterThan(0)
    expect(accountBalances().length).toBe(3)
  }, 60_000)
})
