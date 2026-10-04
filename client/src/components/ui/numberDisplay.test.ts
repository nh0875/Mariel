import { describe, expect, it } from 'vitest'
import { numberDisplay } from './Field'

describe('numberDisplay (lo que muestran NumberInput / MoneyInput)', () => {
  it('con padDecimals (plata) muestra los centavos completos solo si hay centavos', () => {
    expect(numberDisplay(18586.2, 2, true)).toBe('18.586,20')
    expect(numberDisplay(18586, 2, true)).toBe('18.586')
    expect(numberDisplay(0.5, 2, true)).toBe('0,50')
    expect(numberDisplay(1234.004, 2, true)).toBe('1.234')
  })
  it('sin padDecimals queda como antes', () => {
    expect(numberDisplay(18586.2, 2)).toBe('18.586,2')
    expect(numberDisplay(3.5, 1)).toBe('3,5')
    expect(numberDisplay(null, 2)).toBe('')
  })
})
