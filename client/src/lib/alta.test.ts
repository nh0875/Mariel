// Aviso de fecha anterior al alta de un vino (compras, ventas y botellas abiertas).
import { describe, expect, it } from 'vitest'
import { beforeAltaText, winesBeforeAlta, type ProductWithAlta } from './alta'

const wine = (id: number, name: string, alta: string | null): ProductWithAlta =>
  ({ id, name, alta_date: alta, winery: null, varietal: null, wine_type: 'tinto', vintage: null, region: null, size_ml: 750, sku: null, unit_cost: 0, price_retail: 0, price_wholesale: 0, stock: 0, min_stock: 0, units_per_box: 6, active: true, notes: null, created_at: '', updated_at: null }) as ProductWithAlta

describe('winesBeforeAlta / beforeAltaText', () => {
  const products = [wine(1, 'Malbec', '2026-10-04'), wine(2, 'Torrontés', '2026-01-10'), wine(3, 'Sin alta', null)]

  it('avisa solo por los vinos cuya alta es posterior a la fecha (sin repetir)', () => {
    expect(winesBeforeAlta(products, [1, 1, 2, 3, null], '2026-09-30')).toEqual([{ name: 'Malbec', alta: '2026-10-04' }])
    expect(winesBeforeAlta(products, [1, 2], '2026-10-04')).toEqual([]) // el mismo día del alta está bien
    expect(winesBeforeAlta(products, [1], '')).toEqual([])
  })

  it('explica qué pasa en cada caso, sin bloquear', () => {
    const list = winesBeforeAlta(products, [1], '2026-09-01')
    expect(beforeAltaText(list, 'compra')).toContain('las sumaría dos veces')
    expect(beforeAltaText(list, 'venta')).toContain('la descontaría de nuevo')
    expect(beforeAltaText(list, 'compra')).toContain('«Malbec» lo diste de alta el 04/10/2026')
    expect(beforeAltaText([], 'venta')).toBeNull()
  })
})
