// Formulario para poner (o cambiar) la meta de un mes, con el botón "Sugerir meta":
// el sistema calcula el punto de equilibrio y lo que vendiste el año pasado + inflación,
// y te explica de dónde sale cada número antes de que lo uses.
import { useState, type FormEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronDown, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { monthLabelLong } from '@shared/dates'
import { api } from '@/lib/api'
import { useApi, useApiMutation } from '@/lib/queries'
import { int, pct } from '@/lib/format'
import { money0 } from '../inicio/fmt'
import { Badge, Button, Field, InfoTip, IntInput, Loading, ErrorState, Modal, MoneyInput, TextInput, useConfirm } from '@/components/ui'
import type { GoalMonth, GoalSuggestion } from './types'

interface FormState {
  sales_target: number | null
  bottles_target: number | null
  expense_budget: number | null
  notes: string
}

const fromGoal = (g?: GoalMonth): FormState => ({
  sales_target: g?.sales_target ?? null,
  bottles_target: g?.bottles_target ?? null,
  expense_budget: g?.expense_budget ?? null,
  notes: g?.notes ?? '',
})

const daysIn = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
const monthOnly = (month: string) => monthLabelLong(month).split(' ')[0]

// ───────────────────────── Panel de sugerencia ─────────────────────────

function SuggestionCard({
  label,
  value,
  sub,
  chosen,
  info,
}: {
  label: string
  value: number | null
  sub?: string
  chosen?: boolean
  info?: ReactNode
}) {
  return (
    <div className={clsx('min-w-0 rounded-xl border p-3', chosen ? 'border-good/50 bg-good-soft/50' : 'border-line bg-paper')}>
      <div className="flex items-center gap-1 text-[12.5px] font-bold text-ink-soft">
        <span className="min-w-0">{label}</span>
        {info}
      </div>
      <p className={clsx('vh-num mt-1 text-[17px] leading-tight font-extrabold', value == null ? 'text-muted' : 'text-ink')}>{value == null ? 'Sin datos' : money0(value)}</p>
      {sub && <p className="mt-0.5 text-[12px] leading-snug text-muted">{sub}</p>}
      {chosen && (
        <Badge tone="good" className="mt-1.5">
          La que usamos
        </Badge>
      )}
    </div>
  )
}

function SuggestionPanel({ month, onUse }: { month: string; onUse: (s: GoalSuggestion) => void }) {
  const q = useApi<GoalSuggestion>('/goals/suggest', { month })
  const [showSteps, setShowSteps] = useState(false)
  if (q.isLoading) return <Loading label="Haciendo las cuentas con tus números…" className="py-6" />
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const s = q.data
  const breakEvenPlus = s.break_even_sales != null ? s.break_even_sales * 1.15 : null
  return (
    <div className="vh-anim-fade rounded-2xl border border-orange/40 bg-orange-soft/50 p-4" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-ink">
            <Sparkles size={16} className="text-orange-deep" aria-hidden /> Nuestra sugerencia para {monthOnly(month)}
          </p>
          {s.suggestion != null ? (
            <p className="vh-num mt-1 text-[1.75rem] leading-none font-extrabold text-ink">{money0(s.suggestion)}</p>
          ) : (
            <p className="mt-1 text-[14.5px] font-semibold text-ink">Todavía no hay datos suficientes para sugerirte una meta.</p>
          )}
          {s.suggestion != null && (
            <p className="mt-1 text-[13px] text-ink-soft">
              {s.suggested_bottles != null && <>Unas {int(s.suggested_bottles)} botellas</>}
              {s.suggested_bottles != null && s.suggested_expense_budget != null && ' · '}
              {s.suggested_expense_budget != null && <>presupuesto de gastos {money0(s.suggested_expense_budget)}</>}
            </p>
          )}
        </div>
        {s.suggestion != null && (
          <Button variant="secondary" icon={Wand2} onClick={() => onUse(s)}>
            Usar esta sugerencia
          </Button>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <SuggestionCard
          label="Piso: punto de equilibrio"
          info={<InfoTip term="punto_equilibrio" size={13} />}
          value={s.break_even_sales}
          sub={breakEvenPlus != null ? `Para no perder. Con 15 % de colchón: ${money0(breakEvenPlus)}` : 'Hacen falta gastos fijos y ventas de los últimos 3 meses.'}
          chosen={s.basis === 'break_even'}
        />
        <SuggestionCard
          label="Año pasado + inflación"
          info={<InfoTip term="inflacion" size={13} />}
          value={s.last_year_plus_inflation}
          sub={
            s.last_year_same_month != null
              ? `Vendiste ${money0(s.last_year_same_month)} + ${pct(s.inflation_factor, 1)} de inflación${s.inflation_assumed_months ? ' (supuesta en parte)' : ''}`
              : 'No hay ventas del mismo mes del año pasado.'
          }
          chosen={s.basis === 'last_year'}
        />
        <SuggestionCard
          label="Promedio últimos 3 meses"
          value={s.avg_last_3_months}
          sub="Solo como referencia de tu ritmo actual."
          chosen={s.basis === 'average'}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowSteps((v) => !v)}
        aria-expanded={showSteps}
        className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-bold text-sky-deep hover:underline"
      >
        ¿Cómo lo calculamos? <ChevronDown size={15} className={clsx('transition-transform', showSteps && 'rotate-180')} aria-hidden />
      </button>
      {showSteps && (
        <ol className="mt-2 space-y-2 text-[13.5px] leading-snug text-ink-soft">
          {s.steps.map((t, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-orange/30 text-[11.5px] font-extrabold text-ink" aria-hidden>
                {i + 1}
              </span>
              <span className="min-w-0">{t}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ───────────────────────── Formulario ─────────────────────────

// Se monta de nuevo para cada mes (key={month}), así siempre arranca con lo que ya estaba cargado.
export function GoalFormModal({ month, goal, onClose }: { month: string | null; goal?: GoalMonth; onClose: () => void }) {
  const confirm = useConfirm()
  const [form, setForm] = useState<FormState>(() => fromGoal(goal))
  const [error, setError] = useState<string | null>(null)
  const [suggest, setSuggest] = useState(false)
  const [filled, setFilled] = useState(false)

  const save = useApiMutation((body: FormState) => api.put(`/goals/${month}`, { ...body, month, notes: body.notes.trim() || null }), {
    success: () => `Listo, guardamos la meta de ${month ? monthOnly(month) : 'ese mes'}.`,
    onSuccess: onClose,
  })
  const remove = useApiMutation(() => api.del(`/goals/${month}`), {
    success: () => `Borramos la meta de ${month ? monthOnly(month) : 'ese mes'}.`,
    onSuccess: onClose,
  })

  if (!month) return null
  const name = monthOnly(month)
  const days = daysIn(month)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setError(null)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Enter dos veces seguidas no manda dos veces.
    if (save.isPending || remove.isPending) return
    if (form.sales_target == null && form.bottles_target == null && form.expense_budget == null) {
      setError('Completá al menos una meta: de ventas, de botellas o un presupuesto de gastos.')
      return
    }
    for (const [k, label] of [
      ['sales_target', 'La meta de ventas'],
      ['bottles_target', 'La meta de botellas'],
      ['expense_budget', 'El presupuesto de gastos'],
    ] as const) {
      const v = form[k]
      if (v != null && v <= 0) {
        setError(`${label} tiene que ser mayor a cero (o dejala vacía).`)
        return
      }
    }
    save.mutate(form)
  }

  const applySuggestion = (s: GoalSuggestion) => {
    setForm((f) => ({
      ...f,
      sales_target: s.suggestion ?? f.sales_target,
      bottles_target: s.suggested_bottles ?? f.bottles_target,
      expense_budget: s.suggested_expense_budget ?? f.expense_budget,
    }))
    setError(null)
    setFilled(true)
    // Cerramos el panel y llevamos la vista a los campos ya completados, para que se vea qué se cargó.
    setSuggest(false)
    window.setTimeout(() => document.getElementById('goal-sales')?.focus(), 60)
  }

  const askDelete = async () => {
    const ok = await confirm({
      title: `¿Borrar la meta de ${name}?`,
      message: 'Se borran la meta de ventas, de botellas y el presupuesto de ese mes. Tus ventas y gastos no se tocan.',
      confirmText: 'Sí, borrar la meta',
      danger: true,
    })
    if (ok) remove.mutate()
  }

  // Lo real del mes (si ya empezó y hay algo cargado), para tenerlo a mano al decidir la meta.
  const actual = goal && goal.status !== 'future' && (goal.actual.sales > 0 || goal.actual.expenses > 0) ? goal.actual : null

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={goal?.has_goal ? `Meta de ${name}` : `Poné la meta de ${name}`}
      subtitle={
        actual ? (
          <>
            En {name} {goal?.status === 'current' ? 'llevás vendidos' : 'vendiste'} <b className="text-ink">{money0(actual.sales)}</b> ({int(actual.bottles)}{' '}
            {actual.bottles === 1 ? 'botella' : 'botellas'}) y {goal?.status === 'current' ? 'van' : 'fueron'} {money0(actual.expenses)} de gastos.
          </>
        ) : (
          `Cuánto querés vender en ${monthLabelLong(month)} y cuánto pensás gastar.`
        )
      }
      footer={
        <>
          {goal?.has_goal && (
            <Button variant="ghost" icon={Trash2} className="mr-auto text-bad hover:text-bad" onClick={askDelete} loading={remove.isPending}>
              Borrar meta
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="goal-form" loading={save.isPending}>
            Guardar meta
          </Button>
        </>
      }
    >
      <form id="goal-form" onSubmit={submit} noValidate className="space-y-5">
        <div className="rounded-2xl border border-line bg-paper p-4">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-[14px] text-ink-soft">
              <b className="text-ink">¿No sabés qué número poner?</b> Te ayudamos a calcularlo con tus gastos fijos y lo que vendiste el año pasado.
            </p>
            <Button variant="soft" icon={Sparkles} onClick={() => setSuggest((v) => !v)} aria-expanded={suggest}>
              {suggest ? 'Ocultar sugerencia' : 'Sugerir meta'}
            </Button>
          </div>
          {suggest && (
            <div className="mt-3">
              <SuggestionPanel month={month} onUse={applySuggestion} />
            </div>
          )}
          {filled && !suggest && (
            <p className="mt-2 text-[13px] font-semibold text-good">
              Completamos los campos de abajo con la sugerencia. Ajustalos si querés y guardá.{' '}
              <button type="button" className="font-bold text-sky-deep hover:underline" onClick={() => setSuggest(true)}>
                Ver de dónde sale
              </button>
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Meta de ventas"
            htmlFor="goal-sales"
            info="presupuesto"
            hint={form.sales_target ? `Son ${money0(form.sales_target / days)} por día (${days} días).` : 'Lo que querés facturar en el mes, con descuentos y envíos.'}
          >
            <MoneyInput id="goal-sales" value={form.sales_target} onChange={(v) => set('sales_target', v)} placeholder="Ej: 9.000.000" />
          </Field>
          <Field
            label="Meta de botellas"
            htmlFor="goal-bottles"
            hint={form.bottles_target ? `Unas ${int(Math.ceil(form.bottles_target / days))} botellas por día.` : 'Opcional. Sirve para no depender solo de los precios.'}
          >
            <IntInput id="goal-bottles" value={form.bottles_target} onChange={(v) => set('bottles_target', v)} placeholder="Ej: 500" />
          </Field>
          <Field
            label="Presupuesto de gastos"
            htmlFor="goal-budget"
            hint="El tope de gastos del mes (fijos + variables). Las compras de vino no cuentan: son stock."
            className="sm:col-span-2"
          >
            <MoneyInput id="goal-budget" value={form.expense_budget} onChange={(v) => set('expense_budget', v)} placeholder="Ej: 3.000.000" className="sm:max-w-[calc(50%-0.5rem)]" />
          </Field>
          <Field label="Notas" htmlFor="goal-notes" hint="Opcional. Ej: «Día del Padre», «se suma el restó nuevo»." className="sm:col-span-2">
            <TextInput id="goal-notes" value={form.notes} maxLength={500} onChange={(e) => set('notes', e.target.value)} placeholder="¿Por qué esta meta?" />
          </Field>
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-[14px] font-semibold text-bad">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
