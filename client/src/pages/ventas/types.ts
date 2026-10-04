// Tipos y ayudas propias de la pantalla de Ventas (lo que devuelve server/routes/sales.ts).
import type { SaleWithStatus } from '@shared/types'
import { SALE_CHANNEL_LABELS, type SaleChannel } from '@shared/constants'
import { apiUrl } from '@/lib/api'
import { bottles } from '@/lib/format'

export interface ItemPreview {
  name: string
  qty: number
  /** true = vino del stock; false = ítem suelto (entrada, caja de regalo…). */
  is_wine: boolean
}

/** Venta como viene en el listado: con estado de cobro y un resumen de sus renglones. */
export type SaleListRow = SaleWithStatus & { items_preview: ItemPreview[] }

/** GET /sales/summary */
export interface SalesSummary {
  from: string
  to: string
  count: number
  total: number
  bottles: number
  cost: number
  fees: number
  /** total − comisiones − costo de las botellas */
  profit: number
  margin: number
  avg_ticket: number
  pending: number
  pending_count: number
  overdue: number
  overdue_count: number
  receivables: { total: number; count: number; overdue: number }
  first_sale_date: string | null
  by_channel: { channel: string; label: string; total: number; count: number; profit: number }[]
  by_payment_method: { method: string; label: string; total: number; count: number; fees: number }[]
  by_day: { date: string; total: number; count: number }[]
}

/** Filtros de estado que entiende GET /sales?status= */
export type StatusFilter = '' | 'pagado' | 'por_cobrar' | 'vencida'

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: '', label: 'Cobradas o no' },
  { value: 'pagado', label: 'Solo cobradas' },
  { value: 'por_cobrar', label: 'Solo por cobrar' },
  { value: 'vencida', label: 'Solo vencidas' },
]

export const channelLabel = (c: string) => SALE_CHANNEL_LABELS[c as SaleChannel] ?? c

const CHANNEL_SHORT: Record<SaleChannel, string> = {
  local: 'Local',
  online: 'Online',
  mayorista: 'Mayorista',
  eventos: 'Eventos',
  club: 'Club de vinos',
  delivery: 'Delivery',
  otro: 'Otro',
}

/** Nombre corto del canal para badges, filtros y gráficos ("Mayorista (restós, vinotecas)" → "Mayorista"). */
export const channelShort = (c: string) => CHANNEL_SHORT[c as SaleChannel] ?? channelLabel(c)

/** "3 botellas · Malbec Reserva +1" — resumen de lo que se llevó el cliente. */
export function itemsSummary(items: ItemPreview[]): string {
  if (!items.length) return '—'
  const names = [...new Set(items.map((i) => i.name))]
  const more = names.length > 1 ? ` +${names.length - 1}` : ''
  const wineBottles = items.filter((i) => i.is_wine).reduce((s, i) => s + i.qty, 0)
  if (wineBottles > 0) return `${bottles(wineBottles)} · ${names[0]}${more}`
  const qty = items.reduce((s, i) => s + i.qty, 0)
  return `${qty} × ${names[0]}${more}`
}

/** Abre el comprobante imprimible en otra pestaña (con el diálogo de impresión). */
export function openReceipt(saleId: number) {
  window.open(apiUrl(`/sales/${saleId}/receipt`, { print: 1 }), '_blank', 'noopener')
}
