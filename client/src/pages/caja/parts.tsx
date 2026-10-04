// Piezas chicas de Caja y Clientes, armadas con el kit (tarjetas de números, montos con signo,
// íconos de cuentas, menú de acciones, links a los comprobantes y a WhatsApp).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Banknote, CircleDollarSign, EllipsisVertical, Landmark, Smartphone, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import type { AccountKind, PaymentRefType } from '@shared/constants'
import type { GlossaryKey } from '@/lib/glossary'
import { money, moneyCompact } from '@/lib/format'
import { TONE_VAR, type Tone } from '@/lib/nav'
import { InfoTip } from '@/components/ui'

/**
 * Para <Button> de solo ícono: el kit le pone px-3 y px-0 a la vez y gana px-3, así que el ícono queda
 * aplastado (8 px de ancho en un botón de 32). px-0! lo corrige hasta que se arregle en el Button del kit.
 */
export const ICON_ONLY = 'px-0!'

/** Evita que un monto o una fecha se corte en dos renglones. */
export const nb = (s: string) => s.replace(/ /g, ' ')

/** Plata para las tarjetas: completa hasta $ 10 M, abreviada arriba de eso (el valor exacto queda en el title). */
export const tileMoney = (n: number) => (Math.abs(n) >= 10_000_000 ? moneyCompact(n) : money(n, { decimals: 0 }))

export const ACCOUNT_ICON: Record<AccountKind, LucideIcon> = {
  efectivo: Banknote,
  banco: Landmark,
  billetera: Smartphone,
  otro: CircleDollarSign,
}

/** Tarjeta con un número importante + su "?" (del glosario o una explicación propia). */
export function Kpi({
  label,
  value,
  term,
  info,
  hint,
  tone,
  title,
  className,
  valueClassName,
  onClick,
}: {
  label: string
  value: ReactNode
  term?: GlossaryKey
  info?: { title: string; text: ReactNode }
  hint?: ReactNode
  tone?: Tone
  title?: string
  className?: string
  valueClassName?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        {tone && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE_VAR[tone] }} aria-hidden />}
        <span className="min-w-0 text-[13.5px] leading-tight font-bold text-ink-soft">{label}</span>
        {term && <InfoTip term={term} />}
        {info && <InfoTip title={info.title} text={info.text} />}
      </div>
      <div
        className={clsx('truncate leading-none font-extrabold tracking-tight text-ink', typeof value === 'string' && value.length > 11 ? 'text-[1.35rem]' : 'text-[1.6rem]', valueClassName)}
        title={title}
      >
        {value}
      </div>
      {hint && <div className="text-[12.5px] leading-snug text-muted">{hint}</div>}
    </>
  )
  const cls = clsx('vh-card flex min-w-0 flex-col gap-1.5 p-4 text-left sm:p-5', className)
  if (onClick) {
    return (
      <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()} className={clsx(cls, 'cursor-pointer transition-colors hover:border-line-strong')}>
        {body}
      </div>
    )
  }
  return <div className={cls}>{body}</div>
}

/** Monto con signo: verde si entra (+), rojo si sale (−). */
export function SignedMoney({ value, className, strong = true }: { value: number; className?: string; strong?: boolean }) {
  const s = money(Math.abs(value))
  return (
    <span className={clsx('vh-num whitespace-nowrap', strong && 'font-bold', value > 0.004 ? 'text-good' : value < -0.004 ? 'text-bad' : 'text-ink-soft', className)}>
      {value > 0.004 ? '+' : value < -0.004 ? '−' : ''}
      {nb(s)}
    </span>
  )
}

/** Renglón "concepto ……… $ monto" para resúmenes y cuentas. */
export function SummaryLine({ label, value, strong, muted, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3 py-1 text-[14.5px]', strong ? 'font-extrabold text-ink' : muted ? 'text-ink-soft' : 'text-ink')}>
      <span className="flex min-w-0 items-center gap-1">{label}</span>
      <span className={clsx('vh-num shrink-0 whitespace-nowrap', tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : undefined)}>{value}</span>
    </div>
  )
}

/** Link a la pantalla del comprobante de un movimiento (venta, compra o gasto). */
export function docLink(refType: PaymentRefType, refId: number | null): string | null {
  if (!refId) return null
  if (refType === 'sale' || refType === 'sale_fee') return `/ventas?ver=${refId}`
  if (refType === 'purchase') return `/compras?ver=${refId}`
  if (refType === 'expense') return `/gastos?ver=${refId}`
  return null
}

/**
 * Link de WhatsApp para un teléfono argentino escrito "como sea" ("11 5555-1234", "0351 15 444-5555", "+54 9 11…").
 * Devuelve null si no parece un teléfono.
 */
export function waLink(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null
  let d = phone.replace(/\D/g, '')
  if (d.length < 8) return null
  if (d.startsWith('00')) d = d.slice(2)
  if (!d.startsWith('54')) {
    if (d.startsWith('0')) d = d.slice(1)
    // Celulares con el "15" después de la característica (ej: 351 15 4445555): se saca el 15.
    const m = /^(\d{2,4})15(\d{6,8})$/.exec(d)
    if (m && m[1].length + m[2].length === 10) d = m[1] + m[2]
    d = `549${d}`
  } else if (!d.startsWith('549')) {
    d = `549${d.slice(2)}`
  }
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

export const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onClick: () => void
  danger?: boolean
  hidden?: boolean
}

/** Botón "⋮" con un menú de acciones (ver movimientos, editar, arqueo…). Se cierra con Esc o tocando afuera. */
export function ActionMenu({ items, label = 'Más acciones' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const visible = items.filter((i) => !i.hidden)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="grid h-9 w-9 place-items-center rounded-full text-ink-soft hover:bg-cream-deep hover:text-ink"
      >
        <EllipsisVertical size={19} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="vh-anim-pop absolute top-full right-0 z-30 mt-1 w-56 overflow-hidden rounded-2xl border border-line bg-paper py-1.5 shadow-[var(--shadow-pop)]">
          {visible.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                it.onClick()
              }}
              className={clsx(
                'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[14.5px] font-semibold',
                it.danger ? 'text-bad hover:bg-bad-soft' : 'text-ink hover:bg-cream',
              )}
            >
              {it.icon && <it.icon size={17} className={it.danger ? 'text-bad' : 'text-ink-soft'} aria-hidden />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
