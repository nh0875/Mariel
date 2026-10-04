// Formas de las respuestas de la API de Caja y Clientes (ver server/routes/accounts.ts y clients.ts).
import type { AccountKind, ManualCashKind, PaymentRefType } from '@shared/constants'
import type { AccountWithBalance, Client, Payment, SaleWithStatus } from '@shared/types'

export type AccountRow = AccountWithBalance & {
  month_in: number
  month_out: number
  movements_count: number
  last_movement: string | null
}

export interface MovementRow extends Payment {
  account_name: string
  account_kind: AccountKind
  label: string
  counterpart: string | null
  document: string
  signed_amount: number
  running_balance: number | null
  manual: boolean
  other_account_id: number | null
  ref_exists: boolean
}

export interface MovementsResult {
  from: string
  to: string
  account_id: number | null
  rows: MovementRow[]
  summary: {
    total_in: number
    total_out: number
    net: number
    count: number
    opening_balance: number
    closing_balance: number
    transfers: number
  }
}

export type ReceivableRow = SaleWithStatus & { days_overdue: number; age_days: number }

export interface PayableRow {
  type: 'purchase' | 'expense'
  id: number
  date: string
  due_date: string | null
  name: string
  detail: string
  supplier_id: number | null
  total: number
  paid: number
  balance: number
  overdue: boolean
  days_overdue: number
}

export interface Projection {
  days: number
  from: string
  until: string
  cash_now: number
  next_30_days_in: number
  next_30_days_out: number
  expected_balance: number
  in_breakdown: { overdue: number; upcoming: number; no_date: number; later: number }
  out_breakdown: { overdue: number; upcoming: number; no_date: number; later: number; fixed: number }
  fixed_items: { id: number; description: string; category: string; amount: number; date: string }[]
}

export interface PendingResult {
  receivables: ReceivableRow[]
  payables: PayableRow[]
  totals: {
    receivables: number
    receivables_overdue: number
    receivables_count: number
    payables: number
    payables_overdue: number
    payables_count: number
    payables_purchases: number
    payables_expenses: number
  }
  projection: Projection
}

export interface CashflowMonth {
  month: string
  label: string
  from: string
  to: string
  cash_in: number
  cash_out: number
  net: number
  balance_end: number
  result: number
}

export interface CashflowResult {
  from: string
  to: string
  months: CashflowMonth[]
  by_kind: { ref_type: PaymentRefType; label: string; in: number; out: number }[]
  totals: {
    cash_in: number
    cash_out: number
    net: number
    balance_start: number
    balance_end: number
    result: number
    sales: number
    purchases: number
    contributions: number
    withdrawals: number
  }
  projection: Projection
}

export interface ReconcileResult {
  account_id: number
  date: string
  counted: number
  system_balance: number
  difference: number
  direction?: 'in' | 'out'
  payment_id: number | null
}

// ───────────── Clientes ─────────────

export type ClientListRow = Client & {
  total_bought: number
  bottles: number
  purchases_count: number
  last_purchase: string | null
  first_purchase: string | null
  balance: number
  overdue: number
  pending_count: number
  year_total: number
  profit: number
}

export interface ClientDetail {
  client: Client
  sales: SaleWithStatus[]
  stats: {
    total_bought: number
    bottles: number
    purchases_count: number
    avg_ticket: number
    first_purchase: string | null
    last_purchase: string | null
    days_since_last: number | null
    frequency_days: number | null
    balance: number
    overdue: number
    pending_count: number
    year_total: number
    profit: number
    margin: number
    favorite_wines: { product_id: number; name: string; bottles: number; total: number }[]
  }
  monthly: { month: string; label: string; total: number; bottles: number; count: number }[]
}

export type { ManualCashKind }
