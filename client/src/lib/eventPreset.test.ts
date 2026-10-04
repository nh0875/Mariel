import { describe, expect, it } from 'vitest'
import { eventStartDate, ticketLine } from './eventPreset'

describe('eventStartDate (venta/gasto abiertos desde un evento)', () => {
  const today = '2026-10-04'
  it('evento que ya pasó → arranca con la fecha del evento', () => {
    expect(eventStartDate({ date: '2026-09-12' }, today)).toBe('2026-09-12')
  })
  it('evento de hoy o futuro → arranca hoy', () => {
    expect(eventStartDate({ date: today }, today)).toBe(today)
    expect(eventStartDate({ date: '2026-11-20' }, today)).toBe(today)
  })
  it('sin evento → hoy', () => {
    expect(eventStartDate(null, today)).toBe(today)
    expect(eventStartDate(undefined, today)).toBe(today)
  })
})

describe('ticketLine («Vender entradas»)', () => {
  it('precio de la entrada × personas', () => {
    expect(ticketLine({ ticket_price: 8000, attendees: 25 })).toEqual({ description: 'Entrada', qty: 25, price: 8000 })
  })
  it('sin personas → 1; sin precio (o gratis) → precio vacío para completar', () => {
    expect(ticketLine({ ticket_price: null, attendees: null })).toEqual({ description: 'Entrada', qty: 1, price: null })
    expect(ticketLine({ ticket_price: 0, attendees: 0 })).toEqual({ description: 'Entrada', qty: 1, price: null })
  })
})
