// Tipos de las respuestas de /api/events (espejo de server/routes/events.ts).
import type { ExpenseWithStatus, SaleWithStatus, WineEvent } from '@shared/types'
import type { StockMovementKind } from '@shared/constants'

/** Las cuentas de un evento: lo que entró menos lo que costó hacerlo. */
export interface EventSummary {
  revenue: number
  tickets: number
  tickets_qty: number
  wine_sales: number
  cogs: number
  fees: number
  expenses: number
  bottles_opened: number
  bottles_opened_cost: number
  bottles_sold: number
  costs: number
  investment: number
  result: number
  per_attendee: number | null
  roi: number | null
  budget_used: number | null
  sales_count: number
  expenses_count: number
  opened_count: number
}

export type EventWithSummary = WineEvent & { summary: EventSummary }

export interface OpenedBottle {
  id: number
  date: string
  kind: StockMovementKind
  kind_label: string
  product_id: number
  product_name: string
  product_winery: string | null
  bottles: number
  unit_cost: number
  cost: number
  notes: string | null
}

export type EventSale = SaleWithStatus & { items_label: string; tickets: number }

export interface EventDetail {
  event: WineEvent
  summary: EventSummary
  sales: EventSale[]
  expenses: ExpenseWithStatus[]
  opened: OpenedBottle[]
  after: {
    days: number
    clients: number
    returning_clients: number
    sales_count: number
    revenue: number
    complete: boolean
  }
  budget_used: number | null
}
