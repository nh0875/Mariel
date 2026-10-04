// Piezas compartidas por las pestañas de Reportes: formatos, encabezado de pestaña,
// "Lo que vemos en tus números", estados de carga y la etiqueta de clase ABC.
import type { ReactNode } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, Info, Lightbulb, Minus, TriangleAlert } from 'lucide-react'
import { monthLabelLong } from '@shared/dates'
import { useApi } from '@/lib/queries'
import { date, money, moneyCompact, pctDelta } from '@/lib/format'
import { Badge, ErrorState, Loading } from '@/components/ui'
import type { AbcClass, ReportPeriod } from './types'

// ───────────────────────── Formatos ─────────────────────────

const NBSP = ' '
const glue = (s: string) => s.replace(/ /g, NBSP)

/** Pesos sin centavos (en un reporte los centavos solo molestan), sin corte de línea. */
export const money0 = (v: number | null | undefined, opts: { sign?: boolean } = {}) => glue(money(v == null ? v : Math.round(v), { ...opts, decimals: 0 }))
/** "$ 1,2 M", "$ 350 mil". */
export const compact = (v: number | null | undefined) => glue(moneyCompact(v))
/** "$ 61" (de cada $ 100). */
export const pesos = (n: number) => `$${NBSP}${n}`
/** 'YYYY-MM' → 'Octubre 2026' */
export const monthTitle = (m: string) => {
  const s = monthLabelLong(m)
  return s.charAt(0).toUpperCase() + s.slice(1)
}
export const plural = (n: number, one: string, many: string) => `${new Intl.NumberFormat('es-AR').format(n)} ${n === 1 ? one : many}`

/** Plata abreviada en celulares (para que no se corte) y completa desde tablet. */
export function Amount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={clsx('vh-num whitespace-nowrap', className)}>
      <span className="sm:hidden">{compact(value)}</span>
      <span className="hidden sm:inline">{money0(value)}</span>
    </span>
  )
}

/** Variación con flecha y color: verde si es buena, roja si es mala. */
export function Growth({ value, upIsGood = true, className }: { value: number | null | undefined; upIsGood?: boolean; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={clsx('text-muted', className)}>—</span>
  const flat = Math.abs(value) < 0.005
  const good = !flat && value > 0 === upIsGood
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={clsx(
        'vh-num inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12.5px] font-extrabold whitespace-nowrap',
        flat ? 'bg-cream-deep text-ink-soft' : good ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad',
        className,
      )}
    >
      <Icon size={13} strokeWidth={2.8} aria-hidden />
      {pctDelta(value)}
    </span>
  )
}

// ───────────────────────── Datos ─────────────────────────

/** GET de un reporte con el período elegido. Mantiene los datos anteriores mientras carga el nuevo período. */
export function useReport<T>(path: string, period: { from: string; to: string }) {
  return useApi<T>(path, { from: period.from, to: period.to }, { placeholderData: keepPreviousData })
}

/** Muestra "Cargando…" o el error con "Reintentar"; si hay datos, los pasa a children. */
export function ReportGuard<T>({ q, children }: { q: { data?: T; isLoading: boolean; error: unknown; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  if (q.isLoading && !q.data) return <Loading label="Armando el reporte…" />
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return null
  return <>{children(q.data)}</>
}

// ───────────────────────── Encabezado de cada pestaña ─────────────────────────

export function TabIntro({ title, children, actions, period }: { title: string; children: ReactNode; actions?: ReactNode; period?: ReportPeriod }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="max-w-3xl min-w-0 flex-1 basis-[420px]">
        <h2 className="font-display text-[1.9rem] leading-none text-ink">{title}</h2>
        <div className="mt-2 text-[14.5px] leading-relaxed text-ink-soft [&_b]:text-ink">{children}</div>
        {period?.trimmed && (
          <p className="mt-2 inline-flex items-start gap-1.5 rounded-lg bg-sky-soft px-2.5 py-1 text-[13px] text-ink-soft">
            <Info size={15} className="mt-0.5 shrink-0 text-sky-deep" aria-hidden />
            <span>
              Mostramos del {date(period.from)} al {date(period.to)}: {period.requested.from < period.from ? 'antes no había movimientos' : 'son los meses que ya pasaron'}
              {period.requested.from < period.from && period.requested.to > period.to ? ' y los meses que vienen todavía no llegaron' : ''}.
            </span>
          </p>
        )}
      </div>
      {actions && <div className="vh-no-print flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Título de bloque dentro de una pestaña. */
export function BlockTitle({ title, children, right, className }: { title: ReactNode; children?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx('mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1', className)}>
      <div className="min-w-0">
        <h3 className="text-[17px] leading-tight font-extrabold text-ink">{title}</h3>
        {children && <div className="mt-0.5 text-[13.5px] text-ink-soft">{children}</div>}
      </div>
      {right}
    </div>
  )
}

// ───────────────────────── "Lo que vemos en tus números" ─────────────────────────

export type InsightTone = 'good' | 'warn' | 'bad' | 'info'
export interface Insight {
  tone: InsightTone
  text: ReactNode
}

const INSIGHT_ICON = { good: CircleCheck, warn: TriangleAlert, bad: CircleAlert, info: Lightbulb }
const INSIGHT_COLOR = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', info: 'text-brown' }

/** Frases en castellano que explican lo que dicen los números (se calculan con los mismos datos de la pantalla). */
export function Insights({ items, title = 'Lo que vemos en tus números', className }: { items: Insight[]; title?: string; className?: string }) {
  if (!items.length) return null
  return (
    <section className={clsx('vh-card p-5', className)} aria-label={title}>
      <p className="vh-label mb-3 !text-brown">{title}</p>
      <ul className="space-y-2.5">
        {items.map((it, i) => {
          const Icon = INSIGHT_ICON[it.tone]
          return (
            <li key={i} className="flex gap-2.5 text-[14.5px] leading-snug text-ink [&_b]:font-extrabold">
              <Icon size={18} strokeWidth={2.3} className={clsx('mt-0.5 shrink-0', INSIGHT_COLOR[it.tone])} aria-hidden />
              <span className="min-w-0">{it.text}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ───────────────────────── Clase ABC ─────────────────────────

export const ABC_INFO: Record<AbcClass | 'Q', { label: string; tone: 'good' | 'mustard' | 'neutral' | 'coral'; short: string }> = {
  A: { label: 'A', tone: 'good', short: 'Los que más dejan' },
  B: { label: 'B', tone: 'mustard', short: 'Aportan' },
  C: { label: 'C', tone: 'neutral', short: 'Aportan poco' },
  Q: { label: 'Quieto', tone: 'coral', short: 'No se vendió' },
}

export function AbcBadge({ abc, idle }: { abc: AbcClass; idle?: boolean }) {
  const k = idle ? 'Q' : abc
  const info = ABC_INFO[k]
  return (
    <Badge tone={info.tone} className="min-w-[2rem] justify-center">
      <span title={info.short}>{info.label}</span>
    </Badge>
  )
}
