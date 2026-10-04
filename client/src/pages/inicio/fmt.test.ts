// Las cuentas "de cada $ 100" y los % de metas que muestran Inicio y Metas.
// Tienen que cerrar entre sí: si arriba dice "se fueron $ 221", la suma de los renglones da 221.
import { describe, expect, it } from 'vitest'
import type { PeriodSummary } from '@shared/types'
import { budgetPct, money0, per100Map, per100Parts, progressPct } from './fmt'

const summary = (p: Partial<PeriodSummary>): PeriodSummary => {
  const base: PeriodSummary = {
    from: '2026-10-01',
    to: '2026-10-31',
    sales: 0,
    sales_count: 0,
    bottles_sold: 0,
    cogs: 0,
    gross_profit: 0,
    gross_margin: 0,
    fees: 0,
    shrinkage: 0,
    expenses: 0,
    expenses_fixed: 0,
    expenses_variable: 0,
    net_result: 0,
    net_margin: 0,
    avg_ticket: 0,
    cash_in: 0,
    cash_out: 0,
    purchases: 0,
  }
  const s = { ...base, ...p }
  s.gross_profit = s.sales - s.cogs
  s.gross_margin = s.sales ? s.gross_profit / s.sales : 0
  s.expenses = s.expenses_fixed + s.expenses_variable
  s.net_result = s.gross_profit - s.fees - s.shrinkage - s.expenses
  s.net_margin = s.sales ? s.net_result / s.sales : 0
  return s
}

describe('per100Map', () => {
  it('con pérdida: los costos suman 100 + lo que faltó, y el vino/la ganancia bruta van con redondeo común', () => {
    // Los números de octubre de los datos de ejemplo (con los gastos fijos ya generados).
    const s = summary({ sales: 1520450, cogs: 934733.16, fees: 36806.73, expenses_fixed: 2354000, expenses_variable: 29400 })
    const p = per100Map(s)!
    expect(p.cogs).toBe(61) // 61,48
    expect(p.gross).toBe(39) // igual que "Margen bruto 38,5 % → quedan $ 39"
    expect(p.net).toBe(121) // pérdida 120,65
    expect(p.fees).toBe(2) // 2,42: el ajuste de redondeo no cae en los renglones chicos
    expect(p.variable).toBe(2)
    expect(p.cogs + p.fees + p.shrinkage + p.fixed + p.variable).toBe(100 + p.net)
  })

  it('con ganancia: costos + lo que quedó suman exactamente 100', () => {
    const s = summary({ sales: 1000, cogs: 604.9, fees: 24.9, shrinkage: 4.9, expenses_fixed: 250.4, expenses_variable: 14.9 })
    const p = per100Map(s)!
    expect(p.cogs + p.fees + p.shrinkage + p.fixed + p.variable + p.net).toBe(100)
    expect(p.gross).toBe(100 - p.cogs)
    expect(p.net).toBe(Math.round(s.net_margin * 100))
  })

  it('sin ventas no hay "de cada $ 100"', () => {
    expect(per100Map(summary({ expenses_fixed: 5000 }))).toBeNull()
  })

  it('per100Parts sin objetivo es redondeo común; con objetivo, la diferencia la absorbe la parte más grande', () => {
    expect(per100Parts([614.8, 24.2], 1000)).toEqual([61, 2])
    expect(per100Parts([24.2, 1548.2, 19.3], 1000, 160)).toEqual([2, 156, 2])
  })
})

describe('% de metas y presupuestos', () => {
  it('una meta al 99,9 % no dice "100 %"', () => {
    expect(progressPct(0.9992)).toBe('99 %')
    expect(progressPct(0.158)).toBe('16 %')
    expect(progressPct(1)).toBe('100 %')
    expect(progressPct(1.25)).toBe('125 %')
    expect(progressPct(null)).toBe('—')
  })

  it('un presupuesto pasado por poco no dice "100 %"', () => {
    expect(budgetPct(1.003)).toBe('101 %')
    expect(budgetPct(0.996)).toBe('100 %')
    expect(budgetPct(0.34)).toBe('34 %')
    expect(budgetPct(undefined)).toBe('—')
  })

  it('la plata va sin centavos y con espacio que no se corta', () => {
    expect(money0(1520450.4)).toBe('$ 1.520.450')
  })
})
