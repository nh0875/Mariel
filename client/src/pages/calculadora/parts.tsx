// Piezas de la Calculadora: el "ticket" de resultados, campos con barrita (slider), selector de
// medio de pago, redondeo, semáforo del margen y valores de base (con ejemplo si no hay datos).
import { useId, type ReactNode } from 'react'
import { AlertTriangle, CircleCheck, CircleDot, Info, RotateCcw, TrendingDown, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import type { CalculatorContext, MarginLevel, MarginVerdict } from '@shared/pricing'
import { MARGIN_FAIR, MARGIN_HEALTHY } from '@shared/pricing'
import { Badge, Button, Field, NumberInput, Select } from '@/components/ui'
import type { GlossaryKey } from '@/lib/glossary'
import { money as moneyBase, moneyCompact as moneyCompactBase, monthName, pct } from '@/lib/format'

// ───────────────────────── Formatos ─────────────────────────

/**
 * Igual que money() de lib/format, pero con espacio que no se corta: así nunca queda el "$"
 * al final de un renglón y el número en el siguiente.
 */
export function money(n: number | null | undefined, opts?: Parameters<typeof moneyBase>[1]): string {
  return moneyBase(n, opts).replace(/ /g, '\u00a0')
}
export function moneyCompact(n: number | null | undefined): string {
  return moneyCompactBase(n).replace(/ /g, '\u00a0')
}

// ───────────────────────── Valores de base ─────────────────────────

/** Números de ejemplo para cuando todavía no hay ventas cargadas. */
export const EXAMPLE = { cost: 6000, price: 10000, bottles: 400, fixed: 1_200_000, variable_pct: 10 }

export interface BaseNumbers {
  /** true = no hay ventas en los últimos 3 meses completos: los números son de ejemplo. */
  isExample: boolean
  bottles: number
  price: number
  cost: number
  fixed: number
  variable_pct: number
}

/** Promedios del negocio para precargar (o un ejemplo razonable si no hay datos). */
export function baseNumbers(ctx: CalculatorContext): BaseNumbers {
  const real = ctx.has_data
  return {
    isExample: !real,
    bottles: real ? ctx.avg_bottles : EXAMPLE.bottles,
    price: real ? Math.round(ctx.avg_price_per_bottle) : EXAMPLE.price,
    cost: real ? Math.round(ctx.avg_cost_per_bottle) : EXAMPLE.cost,
    fixed: ctx.avg_fixed_expenses > 0 ? Math.round(ctx.avg_fixed_expenses) : real ? 0 : EXAMPLE.fixed,
    variable_pct: real ? ctx.variable_pct_of_sales : EXAMPLE.variable_pct,
  }
}

/** ['2026-07','2026-08','2026-09'] → "julio, agosto y septiembre de 2026". */
export function monthsText(months: string[]): string {
  if (!months.length) return ''
  const sameYear = months.every((m) => m.slice(0, 4) === months[0].slice(0, 4))
  const names = months.map((m) => (sameYear ? monthName(m).split(' ')[0] : monthName(m)))
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
  return sameYear ? `${list} de ${months[0].slice(0, 4)}` : list
}

// ───────────────────────── Medio de pago y comisión ─────────────────────────

/** Clave especial: la comisión promedio que pagaste en tus ventas de los últimos meses. */
export const AVG_FEE_KEY = 'promedio'

export function feeFor(ctx: CalculatorContext, key: string): number {
  if (key === AVG_FEE_KEY) return ctx.avg_fee_pct
  return ctx.payment_methods.find((m) => m.key === key)?.fee_pct ?? 0
}

/** Medio de pago por defecto: el promedio real si hay ventas con comisión; si no, efectivo. */
export function defaultFeeKey(ctx: CalculatorContext): string {
  return ctx.has_data && ctx.avg_fee_pct > 0 ? AVG_FEE_KEY : 'efectivo'
}

const nf = (v: number, d = 2) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: d }).format(v)

export function PaymentMethodField({ ctx, value, onChange, label = 'Medio de pago' }: { ctx: CalculatorContext; value: string; onChange: (key: string) => void; label?: string }) {
  const id = useId()
  const options = [
    ...(ctx.has_data && ctx.avg_fee_pct > 0 ? [{ value: AVG_FEE_KEY, label: `Tu promedio (${nf(ctx.avg_fee_pct)} %)` }] : []),
    ...ctx.payment_methods.map((m) => ({ value: m.key, label: m.fee_pct > 0 ? `${m.label} (${nf(m.fee_pct)} %)` : `${m.label} (sin comisión)` })),
  ]
  const fee = feeFor(ctx, value)
  return (
    <Field
      label={label}
      htmlFor={id}
      info="comisiones"
      hint={
        value === AVG_FEE_KEY
          ? `Mezcla de cómo te pagaron en ${monthsText(ctx.months_used)}: de cada $ 100 vendidos, $ ${nf(fee)} se fueron en comisiones.`
          : fee > 0
            ? `Se queda el ${nf(fee)} % de cada cobro. Lo cambiás en Configuración → Medios de pago.`
            : 'Sin comisión: te llega el precio entero.'
      }
    >
      <Select id={id} value={value} onChange={onChange} options={options} />
    </Field>
  )
}

// ───────────────────────── Campos ─────────────────────────

/** Porcentaje con barrita + número (la barrita para probar rápido, el número para el valor exacto). */
export function SliderField({
  label,
  hint,
  info,
  value,
  onChange,
  min,
  max,
  step = 1,
  signed,
  ticks,
}: {
  label: ReactNode
  hint?: ReactNode
  info?: GlossaryKey
  value: number | null
  onChange: (v: number | null) => void
  min: number
  max: number
  step?: number
  /** Muestra el signo (+10 %) y una marca en el 0. */
  signed?: boolean
  /** Rótulos debajo de la barrita. */
  ticks?: string[]
}) {
  const id = useId()
  const v = value ?? 0
  return (
    <Field label={label} hint={hint} info={info} htmlFor={id}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Math.min(max, Math.max(min, v))}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={typeof label === 'string' ? label : undefined}
            aria-valuetext={`${signed && v > 0 ? '+' : ''}${nf(v, 1)} %`}
            className="h-2 w-full cursor-pointer accent-brown"
          />
          {ticks && (
            <div className="mt-0.5 flex justify-between text-[11.5px] font-semibold text-muted" aria-hidden>
              {ticks.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          )}
        </div>
        <NumberInput id={id} value={value} onChange={onChange} decimals={1} suffix="%" className="w-[6.5rem] shrink-0" inputClassName={signed && v > 0 ? 'text-good' : signed && v < 0 ? 'text-bad' : undefined} />
      </div>
    </Field>
  )
}

/** Porcentaje simple (IIBB, descuento…). */
export function PercentField({ label, hint, info, value, onChange, max = 100 }: { label: ReactNode; hint?: ReactNode; info?: GlossaryKey; value: number | null; onChange: (v: number | null) => void; max?: number }) {
  const id = useId()
  const invalid = value != null && (value < 0 || value > max)
  return (
    <Field label={label} hint={hint} info={info} htmlFor={id} error={invalid ? `Tiene que estar entre 0 % y ${max} %.` : undefined}>
      <NumberInput id={id} value={value} onChange={onChange} decimals={2} suffix="%" aria-invalid={invalid || undefined} />
    </Field>
  )
}

/** Botones tipo "píldora" para elegir una opción (ej: redondeo). */
export function Segmented<V extends string | number>({ options, value, onChange, label }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-2xl border border-line-strong bg-paper p-1">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              'h-9 flex-1 rounded-xl px-3 text-[14px] font-bold whitespace-nowrap transition-colors',
              active ? 'bg-ink text-cream' : 'text-ink-soft hover:bg-cream-deep hover:text-ink',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export const ROUNDING_OPTIONS = [
  { value: 0, label: 'Sin redondeo' },
  { value: 100, label: '$ 100' },
  { value: 500, label: '$ 500' },
  { value: 1000, label: '$ 1.000' },
]

// ───────────────────────── Tarjeta de datos (izquierda) ─────────────────────────

export function InputsCard({ title = 'Tus números', subtitle, onReset, children, note }: { title?: string; subtitle?: ReactNode; onReset?: () => void; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="vh-card min-w-0">
      <header className="flex items-start gap-2 px-5 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] leading-tight font-extrabold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
        </div>
        {onReset && (
          <Button variant="ghost" size="sm" icon={RotateCcw} onClick={onReset} title="Volver a los valores del principio" className="-mt-1 -mr-2">
            <span className="hidden sm:inline">Empezar de nuevo</span>
            <span className="sm:hidden">Reiniciar</span>
          </Button>
        )}
      </header>
      <div className="space-y-4 p-5">
        {note}
        {children}
      </div>
    </section>
  )
}

/** Aviso de que los números son de ejemplo. */
export function ExampleNote({ base, children }: { base: BaseNumbers; children?: ReactNode }) {
  if (!base.isExample) return null
  return (
    <Note tone="info" title="Estos números son de ejemplo">
      {children ?? 'Todavía no hay ventas cargadas en los últimos 3 meses completos. Cuando cargues ventas y gastos, la calculadora se completa sola con tus promedios.'}
    </Note>
  )
}

// ───────────────────────── El ticket (derecha) ─────────────────────────

/**
 * Resultado con forma de ticket: arriba el número grande, una línea "troquelada" y abajo
 * el paso a paso ("Así llegamos a este número").
 */
export function Ticket({ hero, title = 'Así llegamos a este número', children, footer, id, className }: { hero: ReactNode; title?: string; children: ReactNode; footer?: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={clsx('vh-card relative min-w-0 overflow-hidden scroll-mt-24', className)} aria-live="polite">
      <div className="bg-cream-deep/60 px-5 pt-5 pb-5 sm:px-6">{hero}</div>
      <div className="relative" aria-hidden>
        <div className="mx-4 border-t-2 border-dashed border-line-strong" />
        <span className="absolute top-1/2 -left-3 h-6 w-6 -translate-y-1/2 rounded-full border border-line bg-cream" />
        <span className="absolute top-1/2 -right-3 h-6 w-6 -translate-y-1/2 rounded-full border border-line bg-cream" />
      </div>
      <div className="px-5 pt-4 pb-5 sm:px-6">
        <p className="vh-label mb-1.5">{title}</p>
        {children}
      </div>
      {footer && <div className="border-t border-line bg-paper px-5 py-4 sm:px-6">{footer}</div>}
    </section>
  )
}

export function TicketHero({ label, value, sub, badge, info }: { label: ReactNode; value: ReactNode; sub?: ReactNode; badge?: ReactNode; info?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-bold text-ink-soft">
        {label}
        {info}
      </p>
      <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-2">
        <p className="vh-num text-[2.5rem] leading-none font-extrabold tracking-tight text-ink sm:text-[2.9rem]">{value}</p>
        {badge && <div className="pb-1">{badge}</div>}
      </div>
      {sub && <div className="mt-2.5 text-[14.5px] leading-snug text-ink-soft">{sub}</div>}
    </div>
  )
}

type Op = '+' | '−' | '=' | '÷' | '×'

/** Un renglón del ticket: operación, concepto (con su "?") y monto. */
export function TicketRow({ op, label, info, value, sub, total, muted }: { op?: Op; label: ReactNode; info?: ReactNode; value: ReactNode; sub?: ReactNode; total?: boolean; muted?: boolean }) {
  return (
    <div className={clsx('flex items-baseline gap-2.5 py-[7px]', total ? 'mt-1 border-t-[1.5px] border-ink/70 pt-2.5' : 'border-b border-dashed border-line last:border-0')}>
      <span className={clsx('vh-num w-4 shrink-0 text-center text-[15px] font-extrabold', op === '=' ? 'text-ink' : 'text-muted')} aria-hidden>
        {op}
      </span>
      <div className="min-w-0 flex-1">
        <span className={clsx('inline-flex flex-wrap items-center gap-1 text-[14.5px]', total ? 'font-extrabold text-ink' : muted ? 'text-muted' : 'text-ink-soft')}>
          {label}
          {info}
        </span>
        {sub && <span className="block text-[12.5px] leading-snug text-muted">{sub}</span>}
      </div>
      <span className={clsx('vh-num shrink-0 text-right whitespace-nowrap', total ? 'text-[17px] font-extrabold text-ink' : 'font-bold text-ink')}>{value}</span>
    </div>
  )
}

/** Número chico destacado dentro del ticket. */
export function MiniStat({ label, value, sub, info, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; info?: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0 rounded-xl bg-cream px-3.5 py-3', className)}>
      <p className="flex items-center gap-1 text-[12.5px] leading-tight font-bold text-ink-soft">
        <span className="min-w-0">{label}</span>
        {info}
      </p>
      <p className="vh-num mt-1 text-[1.3rem] leading-none font-extrabold text-ink">{value}</p>
      {sub && <p className="mt-1 text-[12.5px] leading-snug text-muted">{sub}</p>}
    </div>
  )
}

// ───────────────────────── Avisos ─────────────────────────

const NOTE_TONES = {
  info: { box: 'border-sky/40 bg-sky-soft/70', icon: Info, iconClass: 'text-sky-deep' },
  good: { box: 'border-good/25 bg-good-soft/70', icon: CircleCheck, iconClass: 'text-good' },
  warn: { box: 'border-warn/30 bg-warn-soft', icon: AlertTriangle, iconClass: 'text-warn' },
  bad: { box: 'border-bad/25 bg-bad-soft/70', icon: AlertTriangle, iconClass: 'text-bad' },
} as const

export function Note({ tone = 'info', title, children, icon, className }: { tone?: keyof typeof NOTE_TONES; title?: ReactNode; children?: ReactNode; icon?: LucideIcon; className?: string }) {
  const t = NOTE_TONES[tone]
  const Icon = icon ?? t.icon
  return (
    <div className={clsx('flex gap-2.5 rounded-xl border px-3.5 py-3 text-[14px] leading-snug text-ink-soft', t.box, className)}>
      <Icon size={18} className={clsx('mt-0.5 shrink-0', t.iconClass)} aria-hidden />
      <div className="min-w-0 [&_b]:text-ink">
        {title && <p className="font-extrabold text-ink">{title}</p>}
        {children}
      </div>
    </div>
  )
}

// ───────────────────────── Semáforo del margen ─────────────────────────

const VERDICT_STYLE: Record<MarginLevel, { tone: 'good' | 'warn' | 'bad'; icon: LucideIcon }> = {
  sano: { tone: 'good', icon: CircleCheck },
  justo: { tone: 'warn', icon: CircleDot },
  bajo: { tone: 'bad', icon: AlertTriangle },
  perdida: { tone: 'bad', icon: TrendingDown },
}

export function VerdictBadge({ verdict, large }: { verdict: MarginVerdict; large?: boolean }) {
  const s = VERDICT_STYLE[verdict.level]
  const Icon = s.icon
  return (
    <Badge tone={s.tone} className={large ? '!px-3 !py-1 !text-[14px]' : undefined} icon={<Icon size={large ? 15 : 13} strokeWidth={2.6} aria-hidden />}>
      {verdict.label}
    </Badge>
  )
}

/**
 * Barra del semáforo: rojo hasta 25 %, amarillo hasta 35 %, verde desde 35 %,
 * con una marca donde está tu margen.
 */
export function MarginMeter({ margin, max = 0.6 }: { margin: number; max?: number }) {
  const clamp = (v: number) => Math.max(0, Math.min(1, v / max)) * 100
  const pos = clamp(Number.isFinite(margin) ? margin : 0)
  return (
    <div className="pt-1" role="img" aria-label={`Tu margen: ${pct(margin)}. Bajo hasta 25 %, justo de 25 % a 35 %, sano desde 35 %.`}>
      <div className="relative">
        <div className="flex h-3 overflow-hidden rounded-full">
          <span className="h-full bg-bad/70" style={{ width: `${clamp(MARGIN_FAIR)}%` }} />
          <span className="h-full bg-mustard" style={{ width: `${clamp(MARGIN_HEALTHY) - clamp(MARGIN_FAIR)}%` }} />
          <span className="h-full flex-1 bg-good/70" />
        </div>
        <span className="absolute -top-1.5 h-6 w-[5px] -translate-x-1/2 rounded-full border-2 border-paper bg-ink shadow" style={{ left: `${pos}%` }} aria-hidden />
      </div>
      <div className="relative mt-1.5 h-4 text-[11.5px] font-bold text-muted" aria-hidden>
        <span className="absolute left-0">0 %</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${clamp(MARGIN_FAIR)}%` }}>
          25 %
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${clamp(MARGIN_HEALTHY)}%` }}>
          35 %
        </span>
        <span className="absolute right-0">{Math.round(max * 100)} %+</span>
      </div>
    </div>
  )
}

/** "¿A dónde va cada peso del precio?": barra apilada con el vino, impuestos, comisión y lo que te queda. */
export function SplitBar({ parts, total }: { parts: { label: string; value: number; color: string }[]; total: number }) {
  const shown = parts.filter((p) => p.value > 0)
  if (total <= 0 || !shown.length) return null
  const sum = shown.reduce((s, p) => s + p.value, 0)
  const scale = Math.max(total, sum)
  return (
    <div>
      <div className="flex h-3.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={shown.map((p) => `${p.label}: ${pct(p.value / total, 0)}`).join(', ')}>
        {shown.map((p) => (
          <span key={p.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / scale) * 100}%`, background: p.color }} />
        ))}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] text-ink-soft">
        {shown.map((p) => (
          <li key={p.label} className="flex min-w-0 items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
            <span className="min-w-0 truncate">{p.label}</span>
            <b className="vh-num ml-auto text-ink">{pct(p.value / total, 0)}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Barra fija abajo en el celular con el resultado principal (así ves el número mientras escribís). */
export function MobileResult({ label, value, targetId }: { label: string; value: ReactNode; targetId: string }) {
  return (
    <button
      type="button"
      onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      className="vh-no-print fixed inset-x-3 bottom-3 z-30 flex items-center gap-3 rounded-2xl border border-line-strong bg-ink px-4 py-2.5 text-left text-cream shadow-[var(--shadow-pop)] lg:hidden"
    >
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-cream/80">{label}</span>
      <span className="vh-num shrink-0 text-[17px] font-extrabold">{value}</span>
      <span className="shrink-0 text-[12.5px] font-bold text-mustard">Ver detalle ↓</span>
    </button>
  )
}
