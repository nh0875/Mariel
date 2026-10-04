// Piezas chicas compartidas por Compras y Proveedores, armadas con el kit.
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { GlossaryKey } from '@/lib/glossary'
import { money, moneyCompact } from '@/lib/format'
import { TONE_VAR, type Tone } from '@/lib/nav'
import { InfoTip } from '@/components/ui'

/**
 * Evita que un monto o una fecha se corte en dos renglones ("$" en una línea y el número en la otra).
 * money() y dateShort() devuelven espacios comunes; acá los pasamos a espacios "duros".
 */
export const nb = (s: string) => s.replace(/ /g, '\u00a0')

/** Plata para las tarjetas: completa hasta $ 10 M, abreviada arriba de eso (el valor exacto queda en el title). */
export const tileMoney = (n: number) => (Math.abs(n) >= 10_000_000 ? moneyCompact(n) : money(n, { decimals: 0 }))

/**
 * Tarjeta con un número importante. Como StatTile del kit, pero el "?" puede ser del glosario (term)
 * o una explicación propia de esta pantalla (info).
 */
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
}: {
  label: string
  value: ReactNode
  term?: GlossaryKey
  info?: { title: string; text: ReactNode }
  hint?: ReactNode
  tone?: Tone
  /** Valor exacto al pasar el mouse (cuando el número está abreviado). */
  title?: string
  className?: string
  valueClassName?: string
}) {
  return (
    <div className={clsx('vh-card flex min-w-0 flex-col gap-1.5 p-4 sm:p-5', className)}>
      <div className="flex items-center gap-1.5">
        {tone && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE_VAR[tone] }} aria-hidden />}
        <span className="min-w-0 text-[13.5px] leading-tight font-bold text-ink-soft">{label}</span>
        {term && <InfoTip term={term} />}
        {info && <InfoTip title={info.title} text={info.text} />}
      </div>
      <div
        className={clsx(
          'truncate leading-none font-extrabold tracking-tight text-ink',
          typeof value === 'string' && value.length > 11 ? 'text-[1.35rem]' : 'text-[1.6rem]',
          valueClassName,
        )}
        title={title}
      >
        {value}
      </div>
      {hint && <div className="text-[12.5px] leading-snug text-muted">{hint}</div>}
    </div>
  )
}

/** Título numerado de cada paso del formulario. */
export function SectionTitle({ n, children, right }: { n: number; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-[16.5px] font-extrabold text-ink">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-coral-soft text-[13px] font-extrabold text-coral-deep" aria-hidden>
          {n}
        </span>
        {children}
      </h3>
      {right}
    </div>
  )
}

/** Renglón "concepto ……… $ monto" para resúmenes. */
export function SummaryLine({ label, value, strong, muted, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3 py-1 text-[14.5px]', strong ? 'font-extrabold text-ink' : muted ? 'text-ink-soft' : 'text-ink')}>
      <span className="flex min-w-0 items-center gap-1">{label}</span>
      <span
        className={clsx('vh-num shrink-0 whitespace-nowrap', tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : strong && 'text-ink')}
      >
        {value}
      </span>
    </div>
  )
}

/** Barra horizontal simple con etiqueta y monto (para comparar dos o tres números). */
export function CompareBar({ label, value, max, color, note }: { label: ReactNode; value: number; max: number; color: string; note?: ReactNode }) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[14px]">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          <span className="truncate">{label}</span>
        </span>
        <span className="vh-num shrink-0 font-extrabold text-ink">{money(value, { decimals: 0 })}</span>
      </div>
      <div className="h-2.5 rounded-full bg-cream-deep">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${width}%`, background: color }} />
      </div>
      {note && <p className="mt-1 text-[12.5px] text-muted">{note}</p>}
    </div>
  )
}
