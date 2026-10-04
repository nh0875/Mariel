// Piezas chicas de la pantalla de Gastos, armadas con el kit.
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, CircleCheck, CircleDot, Clock, Minus, PencilLine } from 'lucide-react'
import clsx from 'clsx'
import { addMonths, monthKey } from '@shared/dates'
import type { ExpenseCategorySetting } from '@shared/types'
import type { GlossaryKey } from '@/lib/glossary'
import { monthName, pctDelta } from '@/lib/format'
import { TONE_VAR, type Tone } from '@/lib/nav'
import { Badge, InfoTip } from '@/components/ui'
import type { PaymentStatus } from '@shared/constants'
import { categoryIcon, splitCategory } from './types'

/**
 * Tarjeta con un número importante. Igual que StatTile del kit, pero el "?" puede ser del
 * glosario (term) o una explicación propia de esta pantalla (info), como "Gastos sobre ventas".
 */
export function KpiTile({
  label,
  value,
  term,
  info,
  delta,
  upIsGood = true,
  deltaLabel,
  hint,
  tone,
  title,
  className,
  valueClassName,
}: {
  label: string
  value: ReactNode
  term?: GlossaryKey
  info?: { title: string; text: ReactNode }
  delta?: number | null
  upIsGood?: boolean
  deltaLabel?: string
  hint?: ReactNode
  tone?: Tone
  /** Valor exacto al pasar el mouse (cuando el número está abreviado). */
  title?: string
  className?: string
  valueClassName?: string
}) {
  const hasDelta = delta != null && Number.isFinite(delta)
  const flat = hasDelta && Math.abs(delta!) < 0.005
  const good = hasDelta && !flat && (delta! > 0) === upIsGood
  const DeltaIcon = !hasDelta || flat ? Minus : delta! > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <div className={clsx('vh-card flex min-w-0 flex-col gap-1.5 p-4 sm:p-5', className)}>
      <div className="flex items-center gap-1.5">
        {tone && <span className="h-2.5 w-2.5 shrink-0 self-start rounded-full mt-[3px]" style={{ background: TONE_VAR[tone] }} aria-hidden />}
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
      {hasDelta && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span
            className={clsx(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-extrabold',
              flat ? 'bg-cream-deep text-ink-soft' : good ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad',
            )}
          >
            <DeltaIcon size={13} strokeWidth={2.8} aria-hidden />
            {pctDelta(delta)}
          </span>
          {deltaLabel && <span className="text-muted">{deltaLabel}</span>}
        </div>
      )}
      {hint && <div className="text-[12.5px] leading-snug text-muted">{hint}</div>}
    </div>
  )
}

/**
 * Elegir categoría con botones grandes (más fácil que un desplegable de 15 opciones).
 * Cada categoría trae su "fijo/variable" de Configuración. "Otra…" deja escribir una nueva.
 */
export function CategoryPicker({
  categories,
  value,
  other,
  onPick,
  onOther,
  invalid,
}: {
  categories: ExpenseCategorySetting[]
  /** Categoría elegida (si es una de la lista). */
  value: string | null
  /** true = está elegida "Otra…". */
  other: boolean
  onPick: (c: ExpenseCategorySetting) => void
  onOther: () => void
  invalid?: boolean
}) {
  return (
    <div role="radiogroup" aria-label="Categoría" className={clsx('grid grid-cols-2 gap-1.5 sm:grid-cols-3', invalid && 'rounded-xl ring-2 ring-bad/50 ring-offset-2 ring-offset-cream')}>
      {categories.map((c) => {
        const active = !other && value === c.name
        const Icon = categoryIcon(c.name)
        const { main, detail } = splitCategory(c.name)
        return (
          <button
            key={c.name}
            type="button"
            role="radio"
            aria-checked={active}
            title={c.name}
            onClick={() => onPick(c)}
            className={clsx(
              'flex min-h-[3.25rem] min-w-0 items-center gap-2 rounded-xl border-2 px-2 py-1.5 text-left transition-colors sm:px-2.5',
              active ? 'border-brown bg-paper shadow-[0_2px_0_0_var(--color-brown)]' : 'border-line bg-paper/70 hover:border-line-strong',
            )}
          >
            <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full', active ? 'bg-coral/45 text-ink' : 'bg-cream-deep text-ink-soft')} aria-hidden>
              <Icon size={15} strokeWidth={2.3} />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="line-clamp-2 text-[13px] font-extrabold break-words text-ink sm:text-[13.5px]">{main}</span>
              {detail && <span className="block truncate text-[11.5px] text-muted">{detail}</span>}
            </span>
          </button>
        )
      })}
      <button
        type="button"
        role="radio"
        aria-checked={other}
        onClick={onOther}
        className={clsx(
          'flex min-h-[3.25rem] items-center gap-2 rounded-xl border-2 border-dashed px-2.5 py-1.5 text-left transition-colors',
          other ? 'border-brown bg-paper' : 'border-line-strong bg-transparent hover:border-ink/40',
        )}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cream-deep text-ink-soft" aria-hidden>
          <PencilLine size={15} strokeWidth={2.3} />
        </span>
        <span className="text-[13.5px] font-extrabold text-ink">Otra…</span>
      </button>
    </div>
  )
}

/** ‹ octubre 2026 › — para moverse de a un mes. */
export function MonthStepper({ month, onChange, className }: { month: string; onChange: (m: string) => void; className?: string }) {
  const go = (n: number) => onChange(monthKey(addMonths(`${month}-01`, n)))
  return (
    <div className={clsx('inline-flex items-center rounded-full border border-line-strong bg-paper', className)}>
      <button type="button" onClick={() => go(-1)} className="grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-cream-deep hover:text-ink" aria-label="Mes anterior">
        <ChevronLeft size={18} />
      </button>
      <span className="min-w-[9.5rem] px-1 text-center font-extrabold text-ink capitalize" aria-live="polite">
        {monthName(month)}
      </span>
      <button type="button" onClick={() => go(1)} className="grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-cream-deep hover:text-ink" aria-label="Mes siguiente">
        <ChevronRight size={18} />
      </button>
    </div>
  )
}

/** Aviso destacado (ej: "Te faltan generar 3 gastos fijos de octubre"). */
export function Callout({
  tone = 'coral',
  icon,
  title,
  children,
  actions,
  className,
}: {
  tone?: 'coral' | 'mustard' | 'sky' | 'good'
  icon?: ReactNode
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const tones = {
    coral: 'border-coral/45 bg-coral-soft/70',
    mustard: 'border-mustard/55 bg-mustard-soft/70',
    sky: 'border-sky/45 bg-sky-soft/70',
    good: 'border-good/25 bg-good-soft/70',
  }
  return (
    <div className={clsx('flex flex-col gap-3 rounded-2xl border px-4 py-3.5 sm:flex-row sm:items-center', tones[tone], className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {icon && <span className="mt-0.5 shrink-0 text-ink">{icon}</span>}
        <div className="min-w-0 text-[14.5px] text-ink-soft">
          <p className="font-extrabold text-ink">{title}</p>
          {children && <div className="mt-0.5 leading-snug">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  )
}

/**
 * Estado de pago de un gasto. Como StatusBadge del kit, pero en masculino ("el gasto está pagado / vencido"):
 * el del kit dice "Pagada / Vencida" porque está pensado para ventas y compras.
 */
export function ExpenseStatusBadge({ status, overdue }: { status: PaymentStatus; overdue?: boolean }) {
  if (status === 'pagado') {
    return (
      <Badge tone="good" icon={<CircleCheck size={13} strokeWidth={2.6} aria-hidden />}>
        Pagado
      </Badge>
    )
  }
  if (overdue) {
    return (
      <Badge tone="bad" icon={<AlertTriangle size={13} strokeWidth={2.6} aria-hidden />}>
        Vencido
      </Badge>
    )
  }
  if (status === 'parcial') {
    return (
      <Badge tone="warn" icon={<CircleDot size={13} strokeWidth={2.6} aria-hidden />}>
        Pago parcial
      </Badge>
    )
  }
  return (
    <Badge tone="warn" icon={<Clock size={13} strokeWidth={2.6} aria-hidden />}>
      Por pagar
    </Badge>
  )
}

/**
 * true si la ventana mide al menos `px` de ancho (se actualiza al cambiar el tamaño).
 * Sirve para mostrar columnas extra en la tabla solo cuando entran sin cortar las demás.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true)
  const [ok, setOk] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setOk(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return ok
}
