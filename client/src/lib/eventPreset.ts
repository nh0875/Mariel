// Cómo arrancan la venta y el gasto nuevos cuando los abrís desde la ficha de un evento
// (/ventas?nuevo=1&evento=ID[&entrada=1] y /gastos?nuevo=1&evento=ID).
import { today as todayFn } from '@shared/dates'
import type { WineEvent } from '@shared/types'

/**
 * Fecha con la que arranca el formulario: si el evento ya pasó, la del evento (así la venta o el
 * gasto cuentan en el mes en que pasó); si es hoy o todavía no llegó, la de hoy (ej: entradas
 * vendidas por adelantado, copas compradas antes).
 */
export function eventStartDate(ev: Pick<WineEvent, 'date'> | null | undefined, today: string = todayFn()): string {
  return ev && ev.date < today ? ev.date : today
}

/**
 * Renglón «Entrada» para «Vender entradas»: no es un vino del stock, va al precio de la entrada
 * del evento y con tantas unidades como personas se anotaron. Si el evento no tiene precio de
 * entrada, el precio queda vacío para que lo escribas.
 */
export function ticketLine(ev: Pick<WineEvent, 'ticket_price' | 'attendees'>): { description: string; qty: number; price: number | null } {
  return {
    description: 'Entrada',
    qty: ev.attendees && ev.attendees > 0 ? ev.attendees : 1,
    price: ev.ticket_price && ev.ticket_price > 0 ? ev.ticket_price : null,
  }
}
