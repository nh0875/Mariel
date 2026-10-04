// Tipos de las respuestas de la API de Proveedores (server/routes/suppliers.ts).
import type { ExpenseWithStatus, PurchaseWithStatus, Supplier } from '@shared/types'

/** Fila de GET /suppliers. */
export type SupplierListRow = Supplier & {
  balance: number
  overdue: number
  purchases_balance: number
  expenses_balance: number
  total_bought: number
  bottles: number
  purchases_count: number
  last_purchase: string | null
  expenses_total: number
  expenses_count: number
}

export interface SupplierWine {
  product_id: number
  name: string
  winery: string | null
  bottles: number
  total: number
  purchases: number
  first_date: string
  last_date: string
  first_unit_cost: number
  last_unit_cost: number
  price_change: number | null
}

/** GET /suppliers/:id */
export interface SupplierDetail {
  supplier: Supplier
  purchases: PurchaseWithStatus[]
  expenses: ExpenseWithStatus[]
  stats: {
    total_bought: number
    bottles: number
    shipping: number
    avg_cost_per_bottle: number
    balance: number
    purchases_balance: number
    expenses_balance: number
    overdue: number
    last_purchase: string | null
    first_purchase: string | null
    purchases_count: number
    expenses_total: number
    expenses_count: number
    top_wines: { product_id: number; name: string; bottles: number; total: number }[]
  }
  wines: SupplierWine[]
  monthly: { month: string; label: string; purchases: number; expenses: number; bottles: number }[]
}

/** Proveedores de vino (los que aparecen en Compras) vs. de servicios (los que aparecen en Gastos). */
export const WINE_KINDS = ['bodega', 'distribuidor'] as const
