// Tipos de las respuestas de la API de Vinos y stock (server/routes/products.ts).
import type { Product, StockMovement } from '@shared/types'

/** Vino como lo devuelve GET /products (con números calculados). */
export interface ProductRow extends Product {
  /** Botellas vendidas en los últimos 90 días. */
  sold_90d: number
  /** Para cuántos días alcanza el stock al ritmo de venta actual (null si no se vendió en 90 días). */
  days_of_stock: number | null
  /** Margen sobre el precio minorista (0..1). */
  margin_retail: number
  margin_wholesale: number
  /** Botellas × costo promedio. */
  stock_value: number
  /** Día del alta (stock inicial). Lo de antes ya está incluido en ese stock. */
  alta_date: string | null
  /** Primer movimiento de stock. */
  first_date: string | null
  /** Días con los que se mide el ritmo de venta (90, o los que lleva si es más nuevo). */
  rate_days: number
  /** Está hace menos de 90 días en el sistema. */
  is_new: boolean
}

export interface MovementRow extends StockMovement {
  kind_label: string
  product_name: string
  product_winery: string | null
  saldo: number
  value: number
  reference: string | null
  sale_id: number | null
  purchase_id: number | null
  event_id: number | null
  unit_price: number | null
  manual: boolean
}

export interface ProductStats {
  sold_total: number
  revenue_total: number
  cost_total: number
  profit_total: number
  sold_90d: number
  days_of_stock: number | null
  last_sale_date: string | null
  last_purchase_date: string | null
  last_purchase_cost: number | null
  last_purchase_supplier: string | null
  shrinkage_bottles: number
  shrinkage_cost: number
  reorder_suggestion: number
  /** Fecha del primer movimiento: no se aceptan ajustes ni cambios de costo anteriores. */
  first_movement_date: string | null
}

export interface ProductDetail {
  product: ProductRow
  movements: MovementRow[]
  stats: ProductStats
  monthly: { month: string; label: string; bottles: number; revenue: number; profit: number }[]
}

export interface BulkPriceChange {
  id: number
  name: string
  winery: string | null
  unit_cost: number
  before: number
  after: number
  before_retail: number
  after_retail: number
  before_wholesale: number
  after_wholesale: number
  margin_before: number
  margin_after: number
}

export interface BulkPriceResult {
  updated: number
  matched: number
  preview: boolean
  examples: BulkPriceChange[]
}

export interface ImportResult {
  created: number
  updated: number
  total: number
  errors: { row: number; message: string }[]
  notes: { row: number; message: string }[]
}
