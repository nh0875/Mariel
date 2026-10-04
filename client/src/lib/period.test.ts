// Período guardado en el navegador: si está roto, la app no se rompe (arranca en «Este mes»).
import { describe, expect, it } from 'vitest'
import { parseStoredPeriod } from './period'

describe('parseStoredPeriod', () => {
  it('acepta lo que guarda la app', () => {
    expect(parseStoredPeriod('{"preset":"mes_pasado"}')).toEqual({ preset: 'mes_pasado' })
    expect(parseStoredPeriod('{"preset":"personalizado","custom":{"from":"2026-02-15","to":"2026-05-20"}}')).toEqual({
      preset: 'personalizado',
      custom: { from: '2026-02-15', to: '2026-05-20' },
    })
  })

  it('con algo roto vuelve a «Este mes» en vez de romper todas las pantallas', () => {
    for (const raw of [null, '', 'null', '"este_mes"', '{}', '{"preset":"cualquiera"}', '{"preset":"personalizado"}', '{"preset":"personalizado","custom":{"from":"ayer"}}', '{roto']) {
      expect(parseStoredPeriod(raw)).toEqual({ preset: 'este_mes' })
    }
  })
})
