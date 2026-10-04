// Piezas de la pantalla de Inicio: tareas rápidas, alertas, frases y primeros pasos.
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowRight,
  Calculator,
  Check,
  CircleCheck,
  Clock,
  HandCoins,
  Info,
  Lightbulb,
  PartyPopper,
  Receipt,
  ShoppingBasket,
  Sparkles,
  Store,
  Target,
  TriangleAlert,
  Wine,
  type LucideIcon,
} from 'lucide-react'
import { TONE_DEEP, TONE_SOFT, type Tone } from '@/lib/nav'
import { compact, money0 } from './fmt'
import { Badge, Button, Card } from '@/components/ui'
import type { AlertTone, DashboardAlert, DashboardResponse } from './types'

// ───────────────────────── Títulos de sección ─────────────────────────

/** Título de bloque con la letra de la marca. */
export function SectionTitle({ title, children, right, className }: { title: ReactNode; children?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx('mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1', className)}>
      <div className="min-w-0">
        <h2 className="font-display text-[1.75rem] leading-none text-ink">{title}</h2>
        {children && <div className="mt-1.5 text-[14px] text-ink-soft">{children}</div>}
      </div>
      {right}
    </div>
  )
}

/** Plata: abreviada en celulares (para que no se corte), completa desde tablet. */
export function Amount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={clsx('vh-num whitespace-nowrap', className)}>
      <span className="sm:hidden">{compact(value)}</span>
      <span className="hidden sm:inline">{money0(value)}</span>
    </span>
  )
}

/** Texto con un "?" al final que nunca queda solo en otra línea (se pega a la última palabra). */
export function TextWithTip({ text, tip }: { text: string; tip: ReactNode }) {
  const i = text.trimEnd().lastIndexOf(' ')
  const head = i > 0 ? text.slice(0, i + 1) : ''
  const last = i > 0 ? text.slice(i + 1) : text
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {last} <span className="inline-block align-[-3px]">{tip}</span>
      </span>
    </>
  )
}

// ───────────────────────── ¿Qué querés hacer? ─────────────────────────

interface Task {
  title: string
  text: string
  to: string
  icon: LucideIcon
  tone: Tone
  primary?: boolean
}

const TASKS: Task[] = [
  { title: 'Vendí vino', text: 'Cargá una venta en segundos', to: '/ventas?nuevo=1', icon: Store, tone: 'sky', primary: true },
  { title: 'Compré vino', text: 'Lo que le compraste a una bodega', to: '/compras?nuevo=1', icon: ShoppingBasket, tone: 'coral' },
  { title: 'Pagué algo', text: 'Alquiler, sueldos, envíos…', to: '/gastos?nuevo=1', icon: Receipt, tone: 'coral' },
  { title: 'Me pagaron una deuda', text: 'Anotá un cobro pendiente', to: '/caja?tab=pendientes', icon: HandCoins, tone: 'sky' },
  { title: '¿A cuánto lo vendo?', text: 'Calculá el precio justo', to: '/calculadora', icon: Calculator, tone: 'brown' },
]

/** highlight=false cuando hay otra acción principal en pantalla (ej: los primeros pasos con la base vacía). */
export function QuickTasks({ highlight = true }: { highlight?: boolean }) {
  return (
    <section aria-labelledby="que-hacer" className="vh-no-print">
      <SectionTitle title={<span id="que-hacer">¿Qué querés hacer?</span>} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {TASKS.map((t, i) => {
          const Icon = t.icon
          const primary = highlight && t.primary
          return (
            <Link
              key={t.title}
              to={t.to}
              className={clsx(
                'group flex min-h-[112px] flex-col justify-between gap-3 rounded-[1.25rem] border p-4 transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5',
                primary
                  ? 'border-brown bg-brown text-white shadow-[0_3px_0_0_var(--color-brown-deep)] hover:bg-brown-deep'
                  : 'border-line bg-paper text-ink shadow-[var(--shadow-card)] hover:border-line-strong',
                i === TASKS.length - 1 && 'col-span-2 sm:col-span-1',
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[40%]"
                  style={primary ? { background: 'rgb(255 255 255 / 0.18)' } : { background: TONE_SOFT[t.tone], color: TONE_DEEP[t.tone] }}
                  aria-hidden
                >
                  <Icon size={21} strokeWidth={2.3} />
                </span>
                <ArrowRight size={18} className={clsx('mt-1 shrink-0 transition-transform group-hover:translate-x-0.5', primary ? 'text-white/80' : 'text-muted')} aria-hidden />
              </span>
              <span>
                <span className="block text-[16px] leading-tight font-extrabold">{t.title}</span>
                <span className={clsx('mt-0.5 block text-[13px] leading-snug', primary ? 'text-white/85' : 'text-ink-soft')}>{t.text}</span>
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

// ───────────────────────── Alertas ─────────────────────────

const ALERT_STYLE: Record<AlertTone, { icon: LucideIcon; bg: string; fg: string; label: string }> = {
  bad: { icon: TriangleAlert, bg: 'bg-bad-soft', fg: 'text-bad', label: 'Urgente' },
  warn: { icon: Clock, bg: 'bg-warn-soft', fg: 'text-warn', label: 'Atención' },
  info: { icon: Info, bg: 'bg-sky-soft', fg: 'text-sky-deep', label: 'Para saber' },
  good: { icon: PartyPopper, bg: 'bg-good-soft', fg: 'text-good', label: 'Buena noticia' },
}

export function AlertsPanel({ alerts, className }: { alerts: DashboardAlert[]; className?: string }) {
  const [all, setAll] = useState(false)
  const LIMIT = 4
  const shown = all ? alerts : alerts.slice(0, LIMIT)
  const urgent = alerts.filter((a) => a.tone === 'bad').length
  return (
    <Card
      className={className}
      title="Para tener en cuenta"
      subtitle="Lo que conviene mirar hoy. Se calcula solo con tus datos."
      actions={urgent > 0 ? <Badge tone="bad">{urgent === 1 ? '1 urgente' : `${urgent} urgentes`}</Badge> : alerts.length ? <Badge tone="warn">{alerts.length}</Badge> : null}
    >
      {alerts.length === 0 ? (
        <div className="flex items-start gap-3 rounded-xl bg-good-soft/60 px-4 py-3">
          <CircleCheck size={22} className="mt-0.5 shrink-0 text-good" aria-hidden />
          <p className="text-[14.5px] text-ink">
            <b>Todo en orden.</b> No hay cobros ni pagos vencidos, la caja alcanza y ningún vino está por agotarse.
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {shown.map((a, i) => {
              const st = ALERT_STYLE[a.tone]
              const Icon = st.icon
              return (
                <li key={`${a.title}-${i}`} className="flex gap-3 rounded-xl border border-line/80 bg-cream/40 p-3">
                  <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-full', st.bg, st.fg)} title={st.label}>
                    <Icon size={18} strokeWidth={2.4} aria-hidden />
                    <span className="sr-only">{st.label}:</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] leading-snug font-extrabold text-ink">{a.title}</p>
                    <p className="mt-0.5 text-[13.5px] leading-snug text-ink-soft">{a.text}</p>
                    {a.link && (
                      <Link to={a.link} className="mt-1 inline-flex items-center gap-1 text-[13.5px] font-bold text-sky-deep hover:underline">
                        {a.link_label ?? 'Ver'} <ArrowRight size={14} aria-hidden />
                      </Link>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {alerts.length > LIMIT && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 text-[13.5px] font-bold text-sky-deep hover:underline">
              {all ? 'Ver menos' : `Ver ${alerts.length - LIMIT} más`}
            </button>
          )}
        </>
      )}
    </Card>
  )
}

// ───────────────────────── Frases ─────────────────────────

export function InsightsCard({ insights, className }: { insights: string[]; className?: string }) {
  if (!insights.length) return null
  return (
    <section className={clsx('relative overflow-hidden rounded-[1.25rem] border border-orange/40 bg-orange-soft/60 p-5', className)} aria-labelledby="lo-que-vemos">
      <span className="pointer-events-none absolute -top-12 -right-8 h-24 w-24 rotate-12 rounded-[40%] bg-orange/25 mix-blend-multiply" aria-hidden />
      <span className="pointer-events-none absolute -top-6 right-12 h-11 w-11 -rotate-6 rounded-[45%] bg-mustard/40 mix-blend-multiply" aria-hidden />
      <div className="relative mb-3 flex items-center gap-2">
        <Sparkles size={19} className="text-orange-deep" aria-hidden />
        <h3 id="lo-que-vemos" className="text-[17px] font-extrabold text-ink">
          Lo que vemos en tus números
        </h3>
      </div>
      <ul className="relative grid gap-x-6 gap-y-2.5 md:grid-cols-2 lg:grid-cols-1">
        {insights.map((t) => (
          <li key={t} className="flex gap-2.5 text-[14.5px] leading-snug text-ink">
            <Lightbulb size={16} className="mt-0.5 shrink-0 text-orange-deep" aria-hidden />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ───────────────────────── Primeros pasos (base vacía) ─────────────────────────

interface FirstStep {
  title: string
  text: string
  to: string
  cta: string
  done: boolean
  icon: LucideIcon
}

export function FirstSteps({ setup }: { setup: DashboardResponse['setup'] }) {
  const navigate = useNavigate()
  const steps: FirstStep[] = [
    {
      title: 'Cargá tus vinos',
      text: 'Nombre, cuánto te cuesta cada botella, a cuánto la vendés y cuántas tenés. Es la base de todo: sin el costo no se puede calcular la ganancia.',
      to: '/vinos?nuevo=1',
      cta: 'Cargar mis vinos',
      done: setup.products > 0,
      icon: Wine,
    },
    {
      title: 'Anotá tus gastos fijos',
      text: 'Alquiler, sueldos, servicios, el contador. Se cargan una vez y se generan solos cada mes.',
      to: '/gastos?tab=fijos',
      cta: 'Cargar gastos fijos',
      done: setup.recurring > 0 || setup.expenses > 0,
      icon: Receipt,
    },
    {
      title: 'Cargá tu primera venta',
      text: 'Elegís el vino, la cantidad y cómo te pagaron. El sistema descuenta el stock y calcula cuánto ganaste.',
      to: '/ventas?nuevo=1',
      cta: 'Cargar una venta',
      done: setup.sales > 0,
      icon: Store,
    },
    {
      title: 'Ponete una meta para el mes',
      text: 'Te ayudamos a calcularla: cuánto tenés que vender para cubrir los gastos y ganar.',
      to: '/metas',
      cta: 'Poner una meta',
      done: setup.goals > 0,
      icon: Target,
    },
  ]
  const next = steps.find((s) => !s.done)
  const doneCount = steps.filter((s) => s.done).length
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="vh-eyebrow mb-3">Primeros pasos</p>
          <h2 className="font-display text-[2.1rem] leading-[1.05] text-ink">
            {setup.products === 0 ? 'Todavía no cargaste ventas. Empezá por cargar tus vinos.' : 'Ya tenés tus vinos. ¡Ahora cargá tu primera venta!'}
          </h2>
          <p className="mt-3 text-[15px] text-ink-soft">
            En cuanto cargues ventas y gastos, esta pantalla se llena sola: cuánto ganaste, en qué se fue la plata, tus vinos estrella y alertas de lo que hay que mirar. Son 4 pasos y
            podés hacerlos de a uno.
          </p>
          <p className="mt-3 text-[13.5px] font-bold text-ink-soft">
            {doneCount} de {steps.length} pasos listos
          </p>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-cream-deep">
            <div className="h-full rounded-full bg-good transition-[width]" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          {next && (
            <Button variant="primary" size="lg" className="mt-5" iconRight={ArrowRight} onClick={() => navigate(next.to)}>
              {next.cta}
            </Button>
          )}
          <p className="mt-4 text-[13px] text-muted">
            ¿Querés ver cómo queda con datos? En <Link to="/configuracion#datos" className="font-bold text-sky-deep hover:underline">Configuración</Link> podés cargar datos de ejemplo
            y borrarlos cuando quieras.
          </p>
        </div>
        <ol className="space-y-3">
          {steps.map((s, i) => {
            const Icon = s.icon
            return (
              <li key={s.title} className={clsx('flex gap-3.5 rounded-2xl border p-4', s.done ? 'border-good/30 bg-good-soft/50' : s === next ? 'border-brown/40 bg-paper' : 'border-line bg-cream/50')}>
                <span
                  className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-full font-extrabold', s.done ? 'bg-good text-white' : 'bg-cream-deep text-ink')}
                  aria-hidden
                >
                  {s.done ? <Check size={20} strokeWidth={3} /> : <Icon size={19} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-ink">
                    <span className="mr-1 text-muted">{i + 1}.</span> {s.title}
                    {s.done && <span className="sr-only"> (listo)</span>}
                  </p>
                  <p className="mt-0.5 text-[13.5px] leading-snug text-ink-soft">{s.text}</p>
                  {!s.done && (
                    <Link to={s.to} className="mt-1.5 inline-flex items-center gap-1 text-[13.5px] font-bold text-sky-deep hover:underline">
                      {s.cta} <ArrowRight size={14} aria-hidden />
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </Card>
  )
}
