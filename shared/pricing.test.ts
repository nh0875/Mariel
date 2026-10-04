// Tests de las fórmulas de la Calculadora (shared/pricing.ts).
import { describe, expect, it } from 'vitest'
import {
  MARGIN_FAIR,
  MARGIN_HEALTHY,
  analyzePrice,
  arsToUsd,
  boxDeal,
  breakEven,
  marginVerdict,
  markupTrap,
  priceChangeToKeepResult,
  roundPrice,
  simulate,
  suggestPrice,
  usdToArs,
  variableCostPerBottle,
  wholesaleFromRetail,
} from './pricing'

describe('suggestPrice', () => {
  it('aplica precio = costo ÷ (1 − margen − IIBB − comisión)', () => {
    const r = suggestPrice({ cost: 6000, target_margin: 0.4, iibb_pct: 3.5, fee_pct: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.raw_price).toBeCloseTo(6000 / 0.565, 2)
    expect(r.price).toBe(10619.47)
    expect(r.breakdown).toEqual({ cost_total: 6000, iibb: 371.68, fee: 0, profit: 4247.79 })
    // Lo que queda es exactamente el margen pedido sobre el precio final.
    expect(r.margin).toBeCloseTo(0.4, 4)
    // Los pedazos suman el precio.
    expect(r.breakdown.cost_total + r.breakdown.iibb + r.breakdown.fee + r.breakdown.profit).toBeCloseTo(r.price, 2)
    // Markup equivalente: casi 77 % (no 40 %).
    expect(r.markup).toBeCloseTo(10619.47 / 6000 - 1, 4)
    expect(r.multiplier).toBeCloseTo(1.7699, 3)
    expect(r.gross_margin).toBeCloseTo(0.435, 3)
  })

  it('suma el flete al costo y descuenta la comisión del medio de pago', () => {
    const r = suggestPrice({ cost: 5000, freight_per_bottle: 500, target_margin: 0.35, iibb_pct: 3.5, fee_pct: 6.29 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const expected = 5500 / (1 - 0.35 - 0.035 - 0.0629)
    expect(r.raw_price).toBeCloseTo(expected, 2)
    expect(r.breakdown.cost_total).toBe(5500)
    expect(r.breakdown.fee).toBeCloseTo(r.price * 0.0629, 2)
    expect(r.margin).toBeCloseTo(0.35, 3)
  })

  it('redondea hacia arriba y el margen nunca queda por debajo del pedido', () => {
    for (const round_to of [100, 500, 1000]) {
      const r = suggestPrice({ cost: 6000, target_margin: 0.4, iibb_pct: 3.5, fee_pct: 0, round_to })
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.price % round_to).toBe(0)
      expect(r.price).toBeGreaterThanOrEqual(r.raw_price)
      expect(r.rounding).toBeCloseTo(r.price - r.raw_price, 2)
      expect(r.margin).toBeGreaterThanOrEqual(0.4 - 1e-9)
    }
    const r = suggestPrice({ cost: 6000, target_margin: 0.4, iibb_pct: 3.5, round_to: 100 })
    expect(r.ok && r.price).toBe(10700)
  })

  it('rechaza combinaciones imposibles con un mensaje claro', () => {
    const r = suggestPrice({ cost: 6000, target_margin: 0.9, iibb_pct: 5, fee_pct: 6 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('suman 101 %')
    expect(r.error).toContain('Bajá el margen')
    // Exactamente 100 % también es imposible.
    expect(suggestPrice({ cost: 6000, target_margin: 0.9, iibb_pct: 4, fee_pct: 6 }).ok).toBe(false)
  })

  it('pide los datos que faltan y no acepta negativos', () => {
    const noCost = suggestPrice({ cost: 0, target_margin: 0.4 })
    expect(noCost.ok).toBe(false)
    expect(!noCost.ok && noCost.error).toContain('Cargá el costo')
    expect(suggestPrice({ cost: -1, target_margin: 0.4 }).ok).toBe(false)
    expect(suggestPrice({ cost: 1000, target_margin: -0.1 }).ok).toBe(false)
    expect(suggestPrice({ cost: 1000, target_margin: 1 }).ok).toBe(false)
    expect(suggestPrice({ cost: 1000, target_margin: 0.3, iibb_pct: -2 }).ok).toBe(false)
    // NaN cuenta como 0 (campo vacío).
    expect(suggestPrice({ cost: 1000, target_margin: 0.3, iibb_pct: NaN }).ok).toBe(true)
  })

  it('margen 0 = vender al costo más impuestos', () => {
    const r = suggestPrice({ cost: 1000, target_margin: 0, iibb_pct: 0, fee_pct: 0 })
    expect(r.ok && r.price).toBe(1000)
    expect(r.ok && r.markup).toBe(0)
  })
})

describe('mayorista, redondeo y la trampa del markup', () => {
  it('wholesaleFromRetail aplica el descuento y redondea', () => {
    expect(wholesaleFromRetail(10700, 20)).toBe(8560)
    expect(wholesaleFromRetail(10700, 20, 500)).toBe(9000)
    expect(wholesaleFromRetail(0, 20)).toBe(0)
    expect(wholesaleFromRetail(10000, 150)).toBe(0)
  })

  it('roundPrice redondea hacia arriba al múltiplo', () => {
    expect(roundPrice(12340, 100)).toBe(12400)
    expect(roundPrice(12400, 100)).toBe(12400)
    expect(roundPrice(12340.555, 0)).toBe(12340.56)
    expect(roundPrice(10001, 1000)).toBe(11000)
  })

  it('sumar el margen como recargo deja mucho menos margen', () => {
    const t = markupTrap({ cost: 6000, target_margin: 0.4 })
    expect(t.naive_price).toBe(8400)
    expect(t.naive_gross_margin).toBeCloseTo(0.2857, 3)
    expect(t.naive_margin).toBeCloseTo(0.2857, 3)
    const withTax = markupTrap({ cost: 6000, target_margin: 0.4, iibb_pct: 3.5 })
    expect(withTax.naive_margin).toBeCloseTo(0.2857 - 0.035, 3)
    expect(withTax.naive_profit).toBe(8400 - 6000 - 294)
  })
})

describe('analyzePrice y semáforo', () => {
  it('calcula ganancia, margen, markup y caja', () => {
    const a = analyzePrice({ price: 10000, cost: 6000, iibb_pct: 3.5, fee_pct: 0 })
    expect(a.iibb).toBe(350)
    expect(a.fee).toBe(0)
    expect(a.profit_per_bottle).toBe(3650)
    expect(a.margin).toBeCloseTo(0.365, 6)
    expect(a.gross_margin).toBeCloseTo(0.4, 6)
    expect(a.markup).toBeCloseTo(2 / 3, 6)
    expect(a.units_per_box).toBe(6)
    expect(a.profit_per_box).toBe(21900)
    expect(a.verdict.level).toBe('sano')
  })

  it('usa las botellas por caja que le pases y la comisión', () => {
    const a = analyzePrice({ price: 10000, cost: 7000, iibb_pct: 3.5, fee_pct: 6.29, units_per_box: 12 })
    expect(a.fee).toBe(629)
    expect(a.profit_per_bottle).toBe(10000 - 7000 - 350 - 629)
    expect(a.profit_per_box).toBe(a.profit_per_bottle * 12)
    expect(a.verdict.level).toBe('bajo')
  })

  it('precio por debajo del costo = pérdida', () => {
    const a = analyzePrice({ price: 5000, cost: 6000 })
    expect(a.profit_per_bottle).toBe(-1000)
    expect(a.margin).toBeLessThan(0)
    expect(a.verdict.level).toBe('perdida')
    const sinPrecio = analyzePrice({ price: 0, cost: 6000 })
    expect(sinPrecio.verdict.level).toBe('perdida')
    expect(analyzePrice({ price: 1000, cost: 0 }).markup).toBe(0)
  })

  it('umbrales: sano ≥ 35 %, justo 25–35 %, bajo < 25 %', () => {
    expect(MARGIN_HEALTHY).toBe(0.35)
    expect(MARGIN_FAIR).toBe(0.25)
    expect(marginVerdict(0.35).level).toBe('sano')
    expect(marginVerdict(0.3499).level).toBe('justo')
    expect(marginVerdict(0.25).level).toBe('justo')
    expect(marginVerdict(0.2499).level).toBe('bajo')
    expect(marginVerdict(0).level).toBe('bajo')
    expect(marginVerdict(-0.01).level).toBe('perdida')
    expect(marginVerdict(NaN).level).toBe('perdida')
    expect(marginVerdict(0.5).label).toBe('Margen sano')
  })
})

describe('breakEven', () => {
  it('botellas = fijos ÷ (precio − costo variable)', () => {
    const r = breakEven({ fixed_costs: 900000, avg_price: 10000, avg_variable_cost_per_bottle: 7000 })
    expect(r.ok).toBe(true)
    expect(r.contribution_per_bottle).toBe(3000)
    expect(r.contribution_margin).toBeCloseTo(0.3, 6)
    expect(r.bottles).toBe(300)
    expect(r.sales).toBe(3000000)
    expect(r.bottles_per_day).toBe(12)
  })

  it('redondea las botellas hacia arriba', () => {
    const r = breakEven({ fixed_costs: 1000000, avg_price: 10000, avg_variable_cost_per_bottle: 7000 })
    expect(r.bottles_exact).toBeCloseTo(333.33, 2)
    expect(r.bottles).toBe(334)
    expect(r.sales).toBeCloseTo(3333333.33, 1)
  })

  it('sin gastos fijos, el equilibrio es 0', () => {
    const r = breakEven({ fixed_costs: 0, avg_price: 10000, avg_variable_cost_per_bottle: 7000 })
    expect(r.ok).toBe(true)
    expect(r.bottles).toBe(0)
    expect(r.sales).toBe(0)
  })

  it('si cada botella no deja nada, no hay equilibrio posible (Infinity)', () => {
    for (const variable of [10000, 12000]) {
      const r = breakEven({ fixed_costs: 500000, avg_price: 10000, avg_variable_cost_per_bottle: variable })
      expect(r.ok).toBe(false)
      expect(r.bottles).toBe(Infinity)
      expect(r.sales).toBe(Infinity)
      expect(r.error).toContain('no hay cantidad de ventas')
    }
  })

  it('datos inválidos devuelven un error y NaN', () => {
    const noPrice = breakEven({ fixed_costs: 500000, avg_price: 0, avg_variable_cost_per_bottle: 0 })
    expect(noPrice.ok).toBe(false)
    expect(noPrice.error).toContain('precio promedio')
    expect(Number.isNaN(noPrice.bottles)).toBe(true)
    expect(breakEven({ fixed_costs: -1, avg_price: 100, avg_variable_cost_per_bottle: 10 }).ok).toBe(false)
  })

  it('variableCostPerBottle = costo + precio × % variables', () => {
    expect(variableCostPerBottle(10000, 6000, 10)).toBe(7000)
    expect(variableCostPerBottle(10000, 6000, 0)).toBe(6000)
  })
})

describe('simulate', () => {
  const base = { bottles: 500, avg_price: 10000, avg_cost: 6000, fixed: 1200000, variable_pct: 10 }

  it('sin cambios, antes = después y el resultado sigue la fórmula', () => {
    const r = simulate({ base })
    // 500 × (10.000 − 6.000) − 10.000 × 500 × 10 % − 1.200.000 = 300.000
    expect(r.before.result).toBe(300000)
    expect(r.before.sales).toBe(5000000)
    expect(r.before.cogs).toBe(3000000)
    expect(r.before.variable).toBe(500000)
    expect(r.before.contribution).toBe(1500000)
    expect(r.before.margin).toBeCloseTo(0.06, 6)
    expect(r.after).toEqual(r.before)
    expect(r.delta.result).toBe(0)
    expect(r.delta.result_pct).toBe(0)
  })

  it('subir precios 10 % y vender 5 % menos', () => {
    const r = simulate({ base, price_change: 0.1, volume_change: -0.05 })
    // 475 × (11.000 − 6.000) − 11.000 × 475 × 10 % − 1.200.000 = 652.500
    expect(r.after.bottles).toBe(475)
    expect(r.after.avg_price).toBe(11000)
    expect(r.after.result).toBe(652500)
    expect(r.delta.result).toBe(352500)
    expect(r.delta.result_pct).toBeCloseTo(1.175, 6)
  })

  it('aumento de la bodega y de los fijos', () => {
    const r = simulate({ base, cost_change: 0.15, fixed_change: 0.1 })
    // 500 × (10.000 − 6.900) − 500.000 − 1.320.000 = −270.000
    expect(r.after.result).toBe(-270000)
    expect(r.delta.result).toBe(-570000)
  })

  it('priceChangeToKeepResult encuentra la suba que compensa', () => {
    const p = priceChangeToKeepResult(base, { cost_change: 0.15 })
    expect(p).not.toBeNull()
    const r = simulate({ base, cost_change: 0.15, price_change: p! })
    expect(r.after.result).toBeCloseTo(r.before.result, 0)
    // Sin cambios no hace falta tocar el precio.
    expect(priceChangeToKeepResult(base, {})).toBeCloseTo(0, 9)
    // Si no vendés botellas no hay precio que alcance.
    expect(priceChangeToKeepResult(base, { volume_change: -1 })).toBeNull()
    expect(priceChangeToKeepResult({ ...base, variable_pct: 100 }, {})).toBeNull()
  })

  it('resultado anterior en 0: la variación % no se puede calcular', () => {
    const r = simulate({ base: { ...base, fixed: 1500000 }, price_change: 0.05 })
    expect(r.before.result).toBe(0)
    expect(r.delta.result_pct).toBeNull()
  })
})

describe('boxDeal', () => {
  it('caja de 6 con 10 % de descuento', () => {
    const r = boxDeal({ price: 10000, cost: 6000, units: 6, discount_pct: 10, iibb_pct: 3.5 })
    expect(r.ok).toBe(true)
    expect(r.list_price).toBe(60000)
    expect(r.box_price).toBe(54000)
    expect(r.discount_amount).toBe(6000)
    expect(r.box_cost).toBe(36000)
    expect(r.iibb).toBe(1890)
    expect(r.profit).toBe(16110)
    expect(r.profit_per_bottle).toBe(2685)
    expect(r.margin).toBeCloseTo(16110 / 54000, 6)
    expect(r.margin_without_discount).toBeCloseTo(0.365, 6)
    expect(r.profit_lost).toBe(21900 - 16110)
    expect(r.verdict.level).toBe('justo')
  })

  it('umbrales de descuento: conservar el margen mínimo y no perder plata', () => {
    const r = boxDeal({ price: 10000, cost: 6000, units: 6, discount_pct: 0, iibb_pct: 3.5 })
    // Perdés plata cuando 60.000 × (1 − d) × 0,965 < 36.000 → d > 37,82 %
    expect(r.break_even_discount_pct).toBeCloseTo(37.82, 2)
    // Margen mínimo 25 %: 60.000 × (1 − d) × (0,965 − 0,25) ≥ 36.000 → d ≤ 16,08 %
    expect(r.max_discount_pct).toBeCloseTo(16.08, 2)
    const atLimit = boxDeal({ price: 10000, cost: 6000, units: 6, discount_pct: r.max_discount_pct, iibb_pct: 3.5 })
    expect(atLimit.margin).toBeCloseTo(0.25, 3)
    const atZero = boxDeal({ price: 10000, cost: 6000, units: 6, discount_pct: r.break_even_discount_pct, iibb_pct: 3.5 })
    expect(Math.abs(atZero.profit)).toBeLessThan(5)
  })

  it('si ni sin descuento llegás al margen mínimo, el descuento máximo es 0', () => {
    const r = boxDeal({ price: 7000, cost: 6000, units: 6, discount_pct: 5, min_margin: 0.25 })
    expect(r.max_discount_pct).toBe(0)
    expect(r.break_even_discount_pct).toBeCloseTo((1 - 6000 / 7000) * 100, 2)
  })

  it('valida los datos', () => {
    expect(boxDeal({ price: 0, cost: 100, units: 6, discount_pct: 0 }).ok).toBe(false)
    expect(boxDeal({ price: 100, cost: 50, units: 0, discount_pct: 0 }).error).toContain('al menos 1 botella')
    expect(boxDeal({ price: 100, cost: 50, units: 6, discount_pct: 100 }).ok).toBe(false)
  })
})

describe('dólar', () => {
  it('convierte en los dos sentidos', () => {
    expect(usdToArs(10, 1250)).toBe(12500)
    expect(arsToUsd(12500, 1250)).toBe(10)
    expect(arsToUsd(1000, 3)).toBe(333.33)
  })
  it('sin cotización devuelve null', () => {
    expect(usdToArs(10, 0)).toBeNull()
    expect(arsToUsd(10, -5)).toBeNull()
    expect(arsToUsd(NaN, 1000)).toBeNull()
  })
})
