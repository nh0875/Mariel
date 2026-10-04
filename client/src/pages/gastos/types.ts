// Tipos y ayudas propias de la pantalla de Gastos (lo que devuelve server/routes/expenses.ts).
import type { LucideIcon } from 'lucide-react'
import {
  Banknote,
  CalendarHeart,
  Calculator,
  Car,
  Ellipsis,
  House,
  Landmark,
  Laptop,
  Megaphone,
  Package,
  Receipt,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'
import type { ExpenseNature } from '@shared/constants'
import type { ExpenseWithStatus, Payment, RecurringExpense } from '@shared/types'
import type { GlossaryKey } from '@/lib/glossary'

export type ExpensePaymentRow = Payment & { account_name: string | null }

/** GET /expenses/:id */
export interface ExpenseDetail extends ExpenseWithStatus {
  payments: ExpensePaymentRow[]
  recurring: { id: number; description: string; active: boolean } | null
}

/** GET /recurring-expenses */
export interface RecurringRow extends RecurringExpense {
  account_name: string | null
  last_generated_month: string | null
  generated_count: number
}

/** GET /recurring-expenses/status?month= */
export interface RecurringStatus {
  month: string
  label: string
  templates: number
  generated: number
  missing: number
  missing_amount: number
  monthly_total: number
  items: {
    id: number
    description: string
    category: string
    amount: number
    day_of_month: number
    auto_paid: boolean
    expense_id: number | null
    expense_amount: number | null
    expense_status: 'pagado' | 'parcial' | 'pendiente' | null
    expense_overdue: boolean
  }[]
}

interface Totals {
  total: number
  fixed: number
  variable: number
  sales: number
  vs_sales: number | null
}

/** GET /expenses/summary */
export interface ExpensesSummary {
  from: string
  to: string
  total: number
  fixed: number
  variable: number
  count: number
  pending: number
  pending_count: number
  overdue: number
  overdue_count: number
  payables_total: number
  sales: number
  vs_sales: number | null
  by_category: {
    category: string
    nature: string
    amount: number
    count: number
    pct: number
    compare_current: number
    compare_previous: number
    change: number | null
  }[]
  gone_categories: { category: string; previous: number }[]
  previous: Totals & { from: string; to: string }
  comparison: {
    mode: 'full' | 'same_days'
    comparable: boolean
    current: Totals & { from: string; to: string }
    previous: Totals & { from: string; to: string }
  }
  monthly: { month: string; label: string; fixed: number; variable: number; total: number; sales: number; vs_sales: number | null }[]
  first_expense_date: string | null
}

/** Filtros de estado que entiende GET /expenses?status= */
export type StatusFilter = '' | 'pagado' | 'por_pagar' | 'vencido'

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: '', label: 'Pagados o no' },
  { value: 'pagado', label: 'Solo pagados' },
  { value: 'por_pagar', label: 'Solo por pagar' },
  { value: 'vencido', label: 'Solo vencidos' },
]

export const NATURE_FILTER_OPTIONS: { value: '' | ExpenseNature; label: string }[] = [
  { value: '', label: 'Fijos y variables' },
  { value: 'fijo', label: 'Solo fijos' },
  { value: 'variable', label: 'Solo variables' },
]

export const NATURE_SHORT: Record<ExpenseNature, string> = { fijo: 'Fijo', variable: 'Variable' }
export const NATURE_TERM: Record<ExpenseNature, GlossaryKey> = { fijo: 'gastos_fijos', variable: 'gastos_variables' }

/**
 * "Servicios (luz, gas, agua, internet)" → { main: "Servicios", detail: "luz, gas, agua, internet" }.
 * Sirve para mostrar nombres largos en chips, badges y gráficos sin cortar.
 */
export function splitCategory(name: string): { main: string; detail: string | null } {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(name)
  return m ? { main: m[1], detail: m[2] } : { main: name, detail: null }
}
export const categoryShort = (name: string) => splitCategory(name).main

const ICONS: [RegExp, LucideIcon][] = [
  [/alquiler|local|expensas/i, House],
  [/sueldo|cargas|personal|emplead/i, Users],
  [/servicio|luz|gas|agua|internet|tel[eé]fono/i, Zap],
  [/impuesto|tasa|arca|afip|iibb|ingresos brutos/i, Landmark],
  [/contador|honorario|abogad|legal/i, Calculator],
  [/marketing|redes|publicidad|instagram|difusi/i, Megaphone],
  [/env[ií]o|log[ií]stica|flete|cadete|correo/i, Truck],
  [/packaging|caja|bolsa|etiqueta/i, Package],
  [/software|suscrip|sistema|app|tienda online/i, Laptop],
  [/banco|comisi/i, Banknote],
  [/seguro/i, ShieldCheck],
  [/mantenimiento|limpieza|arreglo/i, Wrench],
  [/evento|degustaci|feria/i, CalendarHeart],
  [/vi[aá]tico|movilidad|nafta|combustible|auto|uber/i, Car],
  [/^otros?$/i, Ellipsis],
]

/** Ícono para una categoría (por palabras clave; si no reconoce ninguna, un recibo). */
export function categoryIcon(name: string): LucideIcon {
  for (const [re, icon] of ICONS) if (re.test(name)) return icon
  return Receipt
}

/** Ejemplo de descripción según la categoría (placeholder del formulario). */
export function descriptionExample(category: string | null | undefined): string {
  const c = category ?? ''
  if (/alquiler/i.test(c)) return 'Ej: Alquiler del local de octubre'
  if (/sueldo|cargas/i.test(c)) return 'Ej: Sueldo de la encargada'
  if (/servicio/i.test(c)) return 'Ej: Factura de luz'
  if (/impuesto/i.test(c)) return 'Ej: Ingresos Brutos de septiembre'
  if (/contador/i.test(c)) return 'Ej: Honorarios del contador'
  if (/marketing/i.test(c)) return 'Ej: Publicidad en Instagram'
  if (/env[ií]o/i.test(c)) return 'Ej: Cadete pedido de Palermo'
  if (/packaging/i.test(c)) return 'Ej: 50 cajas x6 y bolsas de papel'
  if (/software/i.test(c)) return 'Ej: Abono de la tienda online'
  if (/banco/i.test(c)) return 'Ej: Mantenimiento de cuenta'
  if (/seguro/i.test(c)) return 'Ej: Seguro integral del comercio'
  if (/mantenimiento/i.test(c)) return 'Ej: Arreglo de la heladera de vinos'
  if (/evento/i.test(c)) return 'Ej: Quesos y copas para la degustación'
  if (/vi[aá]tico/i.test(c)) return 'Ej: Nafta para el reparto'
  return 'Ej: ¿En qué se fue la plata?'
}
