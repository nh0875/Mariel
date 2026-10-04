// Lo que devuelven GET /api/goals y GET /api/goals/suggest (server/routes/goals.ts).
import type { Goal } from '@shared/types'

export interface GoalMonth extends Goal {
  /** 'enero 2026' */
  label: string
  /** 'ene 26' */
  short_label: string
  has_goal: boolean
  /** past = ya terminó · current = mes en curso · future = todavía no empezó */
  status: 'past' | 'current' | 'future'
  actual: { sales: number; bottles: number; expenses: number; net_result: number; gross_margin: number }
  progress: number | null
  bottles_progress: number | null
  expense_progress: number | null
  expected_progress: number
}

export interface GoalSuggestion {
  month: string
  label: string
  fixed_expenses_avg: number | null
  contribution_margin: number | null
  break_even_sales: number | null
  last_year_same_month: number | null
  inflation_factor: number
  inflation_assumed_months: number
  last_year_plus_inflation: number | null
  avg_last_3_months: number | null
  suggestion: number | null
  basis: 'break_even' | 'last_year' | 'average' | null
  suggested_bottles: number | null
  suggested_expense_budget: number | null
  explanation: string
  steps: string[]
}
