import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import clsx from 'clsx'
import type { GlossaryKey } from '@/lib/glossary'
import { pctDelta } from '@/lib/format'
import { TONE_VAR, type Tone } from '@/lib/nav'
import { InfoTip } from './InfoTip'

export interface StatTileProps {
  label: string
  value: ReactNode
  /** Concepto del glosario para el "?" */
  term?: GlossaryKey
  /** Variación vs. el período anterior (0.12 = +12 %). */
  delta?: number | null
  /** ¿Subir es bueno? (ventas: sí; gastos: no). Define el color de la variación. */
  upIsGood?: boolean
  /** Texto del período de comparación ("vs. mes pasado"). */
  deltaLabel?: string
  /** Línea chica debajo del número. */
  hint?: ReactNode
  tone?: Tone
  className?: string
  /** Destacar (número más grande). */
  hero?: boolean
}

/** Tarjeta con un número importante, su explicación y cómo viene respecto del período anterior. */
export function StatTile({ label, value, term, delta, upIsGood = true, deltaLabel = 'vs. período anterior', hint, tone, className, hero }: StatTileProps) {
  const hasDelta = delta != null && Number.isFinite(delta)
  const flat = hasDelta && Math.abs(delta!) < 0.005
  const good = hasDelta && !flat && (delta! > 0) === upIsGood
  const DeltaIcon = !hasDelta || flat ? Minus : delta! > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <div className={clsx('vh-card flex min-w-0 flex-col gap-1.5 p-4 sm:p-5', className)}>
      <div className="flex items-center gap-1.5">
        {tone && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE_VAR[tone] }} aria-hidden />}
        <span className="line-clamp-2 text-[13.5px] leading-snug font-bold text-ink-soft">{label}</span>
        {term && <InfoTip term={term} />}
      </div>
      <div className={clsx('leading-none font-extrabold tracking-tight text-ink', hero ? 'text-[2.4rem]' : 'text-[1.7rem]')}>{value}</div>
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
          <span className="text-muted">{deltaLabel}</span>
        </div>
      )}
      {hint && <div className="text-[12.5px] text-muted">{hint}</div>}
    </div>
  )
}
