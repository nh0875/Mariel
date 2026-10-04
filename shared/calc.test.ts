import { describe, expect, it } from 'vitest'
import { reorderSuggestion } from './calc'

describe('reorderSuggestion (cuánto conviene pedir)', () => {
  it('cubre ~45 días de venta o el doble del mínimo, en cajas cerradas', () => {
    // 90 vendidas en 90 días → 45 para 45 días; tiene 5 → faltan 40 → 7 cajas de 6 = 42
    expect(reorderSuggestion({ sold_90d: 90, min_stock: 6, stock: 5, units_per_box: 6 })).toBe(42)
    // Vende poco: manda el doble del mínimo (12); tiene 0 → 12 = 2 cajas
    expect(reorderSuggestion({ sold_90d: 3, min_stock: 6, stock: 0, units_per_box: 6 })).toBe(12)
  })
  it('si alcanza no sugiere nada; el stock negativo cuenta como 0', () => {
    expect(reorderSuggestion({ sold_90d: 10, min_stock: 6, stock: 40, units_per_box: 6 })).toBe(0)
    expect(reorderSuggestion({ sold_90d: 0, min_stock: 3, stock: -2, units_per_box: 1 })).toBe(6)
  })
})
