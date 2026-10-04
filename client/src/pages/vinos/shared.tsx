// Piezas chicas que comparten las pantallas de Vinos y stock.
import { AlertTriangle, CircleSlash } from 'lucide-react'
import { CHART_COLORS, type StockMovementKind } from '@shared/constants'
import { Badge } from '@/components/ui'
import { int, money, pct } from '@/lib/format'
import type { ProductRow } from './types'

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'sky' | 'coral' | 'mustard' | 'orange'

/** "Bodega Los Cerros · Malbec · 2021" */
export function wineSubtitle(p: { winery: string | null; varietal: string | null; vintage: number | null }): string {
  return [p.winery, p.varietal, p.vintage].filter(Boolean).join(' · ')
}

export type StockLevel = 'out' | 'low' | 'ok'
export function stockLevel(p: { stock: number; min_stock: number }): StockLevel {
  if (p.stock <= 0) return 'out'
  if (p.stock <= p.min_stock) return 'low'
  return 'ok'
}

/** Número de botellas: rojo si no hay, amarillo si llegó al mínimo (siempre con ícono + texto, no solo color). */
export function StockBadge({ product }: { product: Pick<ProductRow, 'stock' | 'min_stock'> }) {
  const level = stockLevel(product)
  if (level === 'out')
    return (
      <Badge tone="bad" icon={<CircleSlash size={13} strokeWidth={2.6} aria-hidden />}>
        {product.stock < 0 ? int(product.stock) : 'Sin stock'}
      </Badge>
    )
  if (level === 'low')
    return (
      <Badge tone="warn" icon={<AlertTriangle size={13} strokeWidth={2.6} aria-hidden />}>
        {int(product.stock)}
      </Badge>
    )
  return <span className="vh-num font-bold text-ink">{int(product.stock)}</span>
}

/** "≈ 37 días" o una explicación cuando no se puede calcular. */
export function daysOfStockText(days: number | null, stock: number): string {
  if (stock <= 0) return 'reponé'
  if (days == null) return 'sin ventas en 90 días'
  if (days > 365) return 'más de un año'
  if (days < 1) return 'menos de 1 día'
  return `≈ ${int(days)} ${days === 1 ? 'día' : 'días'}`
}

/** Qué significa la cobertura, en palabras. */
export function daysOfStockVerdict(days: number | null, stock: number): { text: string; tone: Tone } {
  if (stock <= 0) return { text: 'Sin botellas: reponé si lo seguís vendiendo.', tone: 'bad' }
  if (days == null) return { text: 'No se vendió en los últimos 90 días: está parado.', tone: 'neutral' }
  if (days < 15) return { text: 'Te alcanza para menos de 2 semanas: reponé pronto.', tone: 'bad' }
  if (days <= 60) return { text: 'Cobertura sana.', tone: 'good' }
  if (days <= 180) return { text: 'Tenés para varios meses: no hace falta comprar.', tone: 'sky' }
  return { text: 'Hay stock para más de 6 meses: plata parada. Pensá en una promo.', tone: 'warn' }
}

/** Color del margen: verde si llega al objetivo, amarillo entre 25 % y el objetivo, rojo debajo de 25 %. */
export function marginTone(margin: number, target: number): Tone {
  if (margin >= target - 0.005) return 'good'
  if (margin >= Math.min(0.25, target)) return 'warn'
  return 'bad'
}

export function MarginChip({ margin, price, target }: { margin: number; price: number; target: number }) {
  if (!price) return <Badge tone="neutral">Sin precio</Badge>
  return <Badge tone={marginTone(margin, target)}>{pct(margin, 0)}</Badge>
}

/**
 * Cuánto conviene pedir: lo necesario para cubrir ~45 días de venta (al ritmo de los últimos 90 días)
 * o el doble del stock mínimo, lo que sea mayor, redondeado a cajas cerradas. (Igual que en el Excel.)
 */
export function reorderSuggestion(p: Pick<ProductRow, 'sold_90d' | 'min_stock' | 'stock' | 'units_per_box'>): number {
  const target = Math.max(p.min_stock * 2, Math.ceil((p.sold_90d / 90) * 45))
  const need = target - Math.max(p.stock, 0)
  if (need <= 0) return 0
  const box = Math.max(1, p.units_per_box)
  return Math.ceil(need / box) * box
}

export const REORDER_HELP =
  'Lo necesario para cubrir unos 45 días de venta (al ritmo de los últimos 90 días) o el doble de tu stock mínimo, lo que sea mayor, redondeado a cajas cerradas. Es una sugerencia: ajustala según la plata que tengas y si la bodega aumentó.'

/** Color de cada tipo de movimiento en el historial. */
export const KIND_TONE: Record<StockMovementKind, Tone> = {
  inicial: 'neutral',
  compra: 'good',
  venta: 'sky',
  ajuste: 'mustard',
  rotura: 'coral',
  degustacion: 'orange',
  regalo: 'orange',
  consumo: 'coral',
  devolucion: 'good',
  revaluo: 'neutral',
}

/** Barra "cómo se reparte el precio": lo que es vino (costo) y lo que te queda. */
export function PriceSplit({ label, price, cost }: { label: string; price: number; cost: number }) {
  if (!price) {
    return (
      <div>
        <p className="text-[14px] font-bold text-ink">{label}</p>
        <p className="text-[13.5px] text-muted">Todavía no tiene precio cargado.</p>
      </div>
    )
  }
  const gain = price - cost
  const costShare = Math.max(0, Math.min(1, cost / price))
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-[14px] font-bold text-ink">{label}</p>
        <p className="vh-num text-[15px] font-extrabold text-ink">{money(price)}</p>
      </div>
      <div className="flex h-4 overflow-hidden rounded-full bg-cream-deep" role="img" aria-label={`${pct(costShare, 0)} es costo del vino, ${pct(1 - costShare, 0)} te queda`}>
        <div className="h-full" style={{ width: `${costShare * 100}%`, background: CHART_COLORS.costo }} />
        {gain > 0 && <div className="h-full" style={{ width: `${(1 - costShare) * 100}%`, background: CHART_COLORS.ganancia }} />}
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[13px] text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS.costo }} aria-hidden />
          Vino (costo): <b className="vh-num text-ink">{money(cost)}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: gain >= 0 ? CHART_COLORS.ganancia : CHART_COLORS.gastos }} aria-hidden />
          {gain >= 0 ? 'Te queda' : 'Perdés'}: <b className="vh-num text-ink">{money(Math.abs(gain))}</b>
        </span>
      </div>
    </div>
  )
}
