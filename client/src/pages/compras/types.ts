// Tipos de las respuestas de la API de Compras (server/routes/purchases.ts) y fórmulas
// que la pantalla necesita para mostrar en vivo cómo queda el costo de cada vino.
import { CHART_COLORS } from '@shared/constants'
import type { Payment, PurchaseDetail, PurchaseWithStatus } from '@shared/types'

/**
 * Color fijo de "compras de vino" en todos los gráficos de Compras y Proveedores.
 * No es venta (azul) ni gasto (coral): es plata que se transforma en stock.
 */
export const PURCHASE_COLOR = CHART_COLORS.extra

export interface PurchaseItemPreview {
  name: string
  qty: number
}

/** GET /purchases/last-prices: último precio de factura de cada vino (sugerencia para "Nueva compra"). */
export interface LastPrice {
  product_id: number
  unit_cost: number
  date: string
  supplier_id: number | null
  supplier_name: string | null
  same_supplier: boolean
}

/** Fila del listado GET /purchases. */
export type PurchaseListRow = PurchaseWithStatus & { items_preview: PurchaseItemPreview[] }

export type PurchaseDetailItem = PurchaseDetail['items'][number] & {
  winery: string | null
  units_per_box: number
  line_total: number
  freight_per_bottle: number
  landed_total: number
}

/** GET /purchases/:id */
export type PurchaseDetailOut = Omit<PurchaseDetail, 'items' | 'payments'> & {
  items: PurchaseDetailItem[]
  payments: (Payment & { account_name: string | null })[]
}

/** GET /purchases/summary */
export interface PurchasesSummary {
  from: string
  to: string
  count: number
  total: number
  subtotal: number
  shipping: number
  bottles: number
  avg_cost_per_bottle: number
  avg_invoice_cost: number
  shipping_share: number
  pending: number
  pending_count: number
  payables: { total: number; count: number; overdue: number; overdue_count: number; next_due: string | null }
  by_supplier: { supplier_id: number | null; name: string; total: number; bottles: number; count: number }[]
  cogs: number
  shrinkage: number
  stock_value: { value: number; bottles: number; products: number }
  monthly: { month: string; label: string; purchases: number; cogs: number }[]
  monthly_mode: 'period' | 'last6'
  first_purchase_date: string | null
}

export type StatusFilter = '' | 'pagado' | 'por_pagar' | 'vencida'
export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: 'por_pagar', label: 'Por pagar' },
  { value: 'vencida', label: 'Vencidas' },
  { value: 'pagado', label: 'Pagadas' },
]

/** "Malbec Clásico ×12 +2" */
export function itemsSummary(items: PurchaseItemPreview[]): string {
  if (!items.length) return '—'
  const first = `${items[0].name} ×${items[0].qty}`
  return items.length > 1 ? `${first} +${items.length - 1}` : first
}

export const statusText = (p: { status: string; overdue: boolean }) =>
  p.status === 'pagado' ? 'Pagada' : p.overdue ? 'Vencida' : p.status === 'parcial' ? 'Pago parcial' : 'Por pagar'

/**
 * Costo real por botella = precio de factura + parte del flete (proporcional al precio).
 * Es la MISMA fórmula que usa el servidor (services/purchases.ts → landedCosts); acá solo
 * se usa para mostrar el número en vivo mientras cargás. Lo que se guarda lo calcula el servidor.
 */
export function landedCosts(items: { qty: number; unit_cost: number }[], shipping: number): number[] {
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_cost, 0)
  const bottles = items.reduce((s, i) => s + i.qty, 0)
  return items.map((i) => {
    if (!shipping || i.qty <= 0) return i.unit_cost
    // Si todo vino bonificado (subtotal 0), el flete se reparte por botella.
    const share = subtotal > 0 ? (shipping * (i.qty * i.unit_cost)) / subtotal : (shipping * i.qty) / Math.max(bottles, 1)
    return Math.round((i.unit_cost + share / i.qty) * 10000) / 10000
  })
}

/**
 * Costo promedio ponderado después de la compra (misma regla que services/stock.ts):
 * (botellas que tenías × costo actual + botellas nuevas × costo real) ÷ total de botellas.
 * Si no tenías stock (o era negativo), el promedio pasa a ser el costo de la compra.
 */
export function newAverageCost(stock: number, avg: number, qty: number, landed: number): number {
  // Sin un costo conocido (vino cargado sin costo), las botellas previas toman el costo de esta compra.
  const base = avg > 0 ? Math.max(stock, 0) : 0
  if (base + qty <= 0) return avg
  return (base * avg + qty * landed) / (base + qty)
}
