// Respuestas de la API de Reportes (ver server/routes/reports.ts).
import type { MonthlyPoint, PeriodSummary } from '@shared/types'

export interface ReportPeriod {
  from: string
  to: string
  requested: { from: string; to: string }
  /** true si se recortaron meses vacíos (antes del primer movimiento o meses que no llegaron). */
  trimmed: boolean
}

export interface ExpenseCategoryByMonth {
  category: string
  nature: 'fijo' | 'variable'
  total: number
  count: number
  months: Record<string, number>
}

/** Mes del estado de resultados. `partial_note`: "15 al 28" / "en curso" si el mes está incompleto. */
export type PnlMonth = MonthlyPoint & { partial: boolean; partial_note: string }

export interface PnlReport {
  period: ReportPeriod
  months: PnlMonth[]
  total: PeriodSummary
  expenses_by_category: ExpenseCategoryByMonth[]
}

export type AbcClass = 'A' | 'B' | 'C'

export interface ProductReportRow {
  product_id: number
  name: string
  winery: string | null
  wine_type: string
  bottles: number
  revenue: number
  cost: number
  profit: number
  margin: number
  active: boolean
  stock: number
  unit_cost: number
  price_retail: number
  stock_value: number
  sold_90d: number
  days_of_stock: number | null
  share: number
  cumulative_share: number
  abc: AbcClass
  idle: boolean
  /** Está en el sistema hace menos de 90 días: si no se vendió, no es «quieto» todavía. */
  is_new: boolean
  last_sale: string | null
}

export interface ChannelRow {
  channel: string
  label: string
  sales: number
  count: number
  cost: number
  fees: number
  profit: number
  bottles: number
  margin: number
  avg_ticket: number
  share: number
}

export interface PaymentMethodRow {
  method: string
  label: string
  total: number
  count: number
  fees: number
  fee_pct_effective: number
  fee_pct_configured: number | null
  share: number
}

export interface WeekdayRow {
  dow: number
  label: string
  short: string
  total: number
  count: number
  days: number
  avg_per_day: number
  share: number
}

export interface ChannelsReport {
  period: ReportPeriod
  total_sales: number
  total_count: number
  channels: ChannelRow[]
  payment_methods: PaymentMethodRow[]
  weekdays: WeekdayRow[]
}

export interface ClientReportRow {
  client_id: number
  name: string
  kind: string
  kind_label: string
  total: number
  count: number
  bottles: number
  profit: number
  avg_ticket: number
  share: number
  last_purchase: string | null
}

export interface ClientsReport {
  period: ReportPeriod
  clients: ClientReportRow[]
  walk_in: { total: number; count: number; bottles: number; profit: number; share: number }
  totals: { sales: number; count: number; clients: number; top5_share: number; top15_share: number }
}

export interface ExpensesReport {
  period: ReportPeriod
  by_category: { category: string; nature: string; total: number; count: number; share: number; monthly_avg: number }[]
  by_month: { month: string; label: string; fixed: number; variable: number; total: number; sales: number; pct_of_sales: number | null; partial: boolean; partial_note: string }[]
  totals: { total: number; fixed: number; variable: number; sales: number }
  /** Promedios y equilibrio: con los meses completos (avg_months). */
  fixed_avg: number
  months_for_avg: number
  avg_months: string[]
  /** 'last_3': el período no tiene meses completos → últimos 3 meses completos (como Calculadora y Metas). */
  avg_basis: 'period' | 'last_3'
  avg_sales: number
  variable_pct_of_sales: number
  contribution_margin: number
  break_even_monthly: number | null
}

export interface InflationMonthRow {
  month: string
  label: string
  sales: number
  rate: number | null
  index: number
  factor: number
  sales_today_pesos: number
  real_growth_vs_prev: number | null
  nominal_growth_vs_prev: number | null
  partial: boolean
  partial_note: string
}

export interface InflationReport {
  period: ReportPeriod
  months: InflationMonthRow[]
  missing_months: string[]
  inflation_accum: number
  totals: { sales: number; sales_today_pesos: number }
  base_month: string | null
  explanation: string
}
