// Piezas chicas de la pantalla de Ventas, armadas con el kit.
import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import clsx from 'clsx'
import type { GlossaryKey } from '@/lib/glossary'
import { pctDelta } from '@/lib/format'
import { TONE_VAR, type Tone } from '@/lib/nav'
import { InfoTip } from '@/components/ui'

/**
 * Igual que StatTile del kit, pero el "?" puede ser del glosario (term) o una explicación
 * propia de esta pantalla (info), como "Ganancia de las ventas".
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
        {tone && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE_VAR[tone] }} aria-hidden />}
        <span className="truncate text-[13.5px] font-bold text-ink-soft">{label}</span>
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

/** Interruptor de dos o tres opciones chiquitas ($ / %, minorista / mayorista). */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = 'md',
}: {
  options: { value: V; label: ReactNode; title?: string }[]
  value: V
  onChange: (v: V) => void
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('inline-flex shrink-0 rounded-full border border-line-strong bg-cream-deep p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={clsx(
              'rounded-full font-bold whitespace-nowrap transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-[13px]' : 'px-3.5 py-1.5 text-[14px]',
              active ? 'bg-paper text-ink shadow-[0_1px_2px_rgb(59_36_20/0.18)]' : 'text-ink-soft hover:text-ink',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
