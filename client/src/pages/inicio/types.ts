// Lo que devuelve GET /api/dashboard (server/routes/dashboard.ts).
import type { AccountWithBalance, MonthlyPoint, PeriodSummary } from '@shared/types'

export type AlertTone = 'good' | 'warn' | 'bad' | 'info'

export interface DashboardAlert {
  tone: AlertTone
  title: string
  text: string
  link?: string
  link_label?: string
}

export interface DashboardGoal {
  month: string
  label: string
  sales_target: number | null
  bottles_target: number | null
  expense_budget: number | null
  notes: string | null
  sales: number
  bottles: number
  expenses: number
  net_result: number
  progress: number | null
  bottles_progress: number | null
  expense_progress: number | null
  expected_progress: number
  days_elapsed: number
  days_total: number
  pace: number | null
  expected_sales: number | null
  projection: number
}

export interface ProductSales {
  product_id: number
  name: string
  winery: string | null
  wine_type: string
  bottles: number
  revenue: number
  cost: number
  profit: number
  margin: number
}

export interface ChannelSales {
  channel: string
  label: string
  sales: number
  count: number
  cost: number
  fees: number
  profit: number
}

export interface DashboardResponse {
  period: { from: string; to: string }
  today: string
  period_label: string
  /** "en octubre 2026", "en el año 2026", "del 1 de agosto al 31 de octubre", "desde el 1 de septiembre de 2025". */
  period_phrase: string
  summary: PeriodSummary
  previous: PeriodSummary
  same_days_previous: PeriodSummary | null
  comparison: {
    mode: 'same_days' | 'previous'
    label: string
    detail: string
    current: PeriodSummary
    previous: PeriodSummary
    /** El período anterior está cargado a medias (los registros empiezan después): no se muestran variaciones. */
    partial: boolean
    data_since: string | null
    /** Lo cargado con fecha posterior a hoy (suma en el período, no en la comparación). */
    after_today: { sales: number; expenses: number; net_result: number } | null
  }
  series: MonthlyPoint[]
  /** scheduled: pagos/cobros ya cargados con fecha posterior a hoy (el saldo ya los descuenta). */
  cash: { total: number; accounts: AccountWithBalance[]; scheduled: { out: number; in: number } }
  stock: { value: number; bottles: number; products: number }
  receivables: { total: number; count: number; overdue: number }
  payables: { total: number; count: number; overdue: number; purchases: number; expenses: number }
  low_stock: { id: number; name: string; stock: number; min_stock: number; winery: string | null }[]
  top_products: ProductSales[]
  by_channel: ChannelSales[]
  goal_month: string
  goal: DashboardGoal | null
  alerts: DashboardAlert[]
  insights: string[]
  setup: { products: number; sales: number; purchases: number; expenses: number; recurring: number; goals: number }
}
