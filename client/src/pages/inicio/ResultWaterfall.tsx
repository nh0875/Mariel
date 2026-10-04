// "Así se armó tu resultado": de las ventas al resultado, paso a paso.
// Cada renglón resta algo (el vino, las comisiones, las mermas, los gastos) y la barra arranca
// donde terminó la anterior, así se ve "cuánto se comió" cada cosa de lo que vendiste.
import clsx from 'clsx'
import { Receipt } from 'lucide-react'
import { CHART_COLORS } from '@shared/constants'
import type { PeriodSummary } from '@shared/types'
import type { GlossaryKey } from '@/lib/glossary'
import { int } from '@/lib/format'
import { money0 } from './fmt'
import { Card, EmptyState, InfoTip } from '@/components/ui'

type StepKind = 'start' | 'minus' | 'subtotal' | 'total'

interface Step {
  key: string
  label: string
  /** Bajada chiquita debajo del nombre. */
  note?: string
  term: GlossaryKey
  /** Siempre positivo para start/minus; con signo para subtotal/total. */
  amount: number
  kind: StepKind
  color: string
  /** Dónde arranca y termina la barra (en pesos). */
  from: number
  to: number
}

function buildSteps(s: PeriodSummary): Step[] {
  const steps: Step[] = []
  let running = s.sales
  steps.push({
    key: 'sales',
    label: 'Ventas',
    note: `${int(s.sales_count)} ${s.sales_count === 1 ? 'venta' : 'ventas'} · ${int(s.bottles_sold)} ${s.bottles_sold === 1 ? 'botella' : 'botellas'}`,
    term: 'ventas',
    amount: s.sales,
    kind: 'start',
    color: CHART_COLORS.ventas,
    from: 0,
    to: s.sales,
  })
  const minus = (key: string, label: string, term: GlossaryKey, amount: number, color: string, note?: string, always = false) => {
    if (!always && Math.abs(amount) < 0.005) return
    const before = running
    running = before - amount
    steps.push({ key, label, term, amount, kind: 'minus', color, from: running, to: before, note })
  }
  minus('cogs', 'Costo del vino vendido', 'cmv', s.cogs, CHART_COLORS.costo, 'Lo que te habían costado esas botellas', true)
  steps.push({
    key: 'gross',
    label: 'Ganancia bruta',
    note: 'Lo que te queda para pagar los gastos',
    term: 'ganancia_bruta',
    amount: s.gross_profit,
    kind: 'subtotal',
    color: CHART_COLORS.ganancia,
    from: Math.min(0, s.gross_profit),
    to: Math.max(0, s.gross_profit),
  })
  minus('fees', 'Comisiones de cobro', 'comisiones', s.fees, CHART_COLORS.gastos, 'Mercado Pago, tarjetas, posnet', true)
  minus('shrinkage', 'Mermas', 'mermas', s.shrinkage, CHART_COLORS.gastos, 'Botellas rotas, abiertas para degustar o regaladas', true)
  minus('fixed', 'Gastos fijos', 'gastos_fijos', s.expenses_fixed, CHART_COLORS.gastos, 'Alquiler, sueldos, servicios…', true)
  minus('variable', 'Gastos variables', 'gastos_variables', s.expenses_variable, CHART_COLORS.gastos, 'Envíos, packaging, publicidad…', true)
  const net = s.net_result
  steps.push({
    key: 'net',
    label: net >= 0 ? 'Resultado: ganaste' : 'Resultado: perdiste',
    note: net >= 0 ? 'Lo que te quedó limpio' : 'Lo que faltó para cubrir todo',
    term: 'resultado',
    amount: net,
    kind: 'total',
    color: net >= 0 ? CHART_COLORS.ganancia : CHART_COLORS.gastos,
    from: Math.min(0, net),
    to: Math.max(0, net),
  })
  return steps
}

/** "$ 61" de cada $ 100 vendidos. */
const per100 = (amount: number, sales: number) => (sales > 0 ? Math.round((Math.abs(amount) / sales) * 100) : null)

export function ResultWaterfall({ summary, periodLabel, className }: { summary: PeriodSummary; periodLabel: string; className?: string }) {
  const s = summary
  const hasData = s.sales > 0 || s.expenses > 0 || s.shrinkage > 0
  const steps = buildSteps(s)
  const lo = Math.min(0, ...steps.map((x) => x.from))
  const hi = Math.max(0, ...steps.map((x) => x.to))
  const span = hi - lo || 1
  const pos = (v: number) => ((v - lo) / span) * 100
  const zeroAt = pos(0)
  const lost = s.net_result < 0

  return (
    <Card
      className={className}
      title={
        <span className="inline-flex items-center gap-1.5">
          Así se armó tu resultado <InfoTip term="resultado" />
        </span>
      }
      subtitle={`De todo lo que vendiste en ${periodLabel}, qué se llevó cada cosa y qué te quedó.`}
    >
      {!hasData ? (
        <EmptyState compact icon={Receipt} title="Sin movimientos en este período">
          Cuando cargues ventas y gastos, acá vas a ver paso a paso cómo se forma tu ganancia.
        </EmptyState>
      ) : (
        <>
          <div className="mb-2 hidden grid-cols-[minmax(170px,230px)_1fr_150px] gap-x-4 sm:grid">
            <span className="vh-label">Concepto</span>
            <span className="vh-label">Lo que va quedando</span>
            <span className="vh-label min-w-[118px] text-right">Monto</span>
          </div>
          <ol className="relative">
            {steps.map((st, i) => {
              const strong = st.kind !== 'minus'
              const left = pos(st.from)
              const width = Math.max(pos(st.to) - pos(st.from), Math.abs(st.amount) > 0 ? 0.6 : 0)
              const p100 = per100(st.amount, s.sales)
              const sign = st.kind === 'minus' ? '−' : st.kind === 'start' ? '' : '='
              return (
                <li
                  key={st.key}
                  className={clsx(
                    'grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(150px,205px)_1fr_auto]',
                    i > 0 && st.kind !== 'minus' && 'mt-1 border-t border-line pt-3.5',
                    st.kind === 'total' && (lost ? 'rounded-b-xl bg-coral-soft/40' : 'rounded-b-xl bg-good-soft/40'),
                    st.kind === 'total' && '-mx-3 px-3',
                  )}
                >
                  {/* Concepto */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={clsx('w-3 shrink-0 text-center font-extrabold', st.kind === 'minus' ? 'text-coral-deep' : 'text-ink-soft')} aria-hidden>
                        {sign}
                      </span>
                      <span className={clsx('min-w-0 truncate text-[14.5px] text-ink', strong ? 'font-extrabold' : 'font-semibold')}>{st.label}</span>
                      <InfoTip term={st.term} size={14} />
                    </div>
                    {st.note && <p className="ml-[1.125rem] text-[12.5px] leading-snug text-muted">{st.note}</p>}
                  </div>

                  {/* Monto (en pantallas chicas va arriba a la derecha) */}
                  <div className="min-w-[118px] text-right sm:order-last">
                    <span
                      className={clsx(
                        'vh-num block whitespace-nowrap text-ink',
                        st.kind === 'total' ? 'text-[19px] font-extrabold' : strong ? 'text-[15.5px] font-extrabold' : 'text-[15px] font-bold',
                        st.kind === 'total' && (lost ? 'text-bad' : 'text-good'),
                      )}
                    >
                      {st.kind === 'minus' ? `− ${money0(st.amount)}` : money0(st.amount)}
                    </span>
                    {p100 != null && (
                      <span className="vh-num block text-[12px] text-muted">{st.kind === 'start' ? 'base: $ 100' : `$ ${p100} de cada $ 100`}</span>
                    )}
                  </div>

                  {/* Barra flotante */}
                  <div className="col-span-2 sm:col-span-1">
                    <div className="relative h-4 rounded-full bg-cream-deep/70" title={`${st.label}: ${st.kind === 'minus' ? '−' : ''}${money0(st.amount)}`}>
                      {lo < 0 && <span className="absolute inset-y-[-3px] w-px bg-ink-soft/50" style={{ left: `${zeroAt}%` }} aria-hidden />}
                      {width > 0 && (
                        <span
                          className="absolute inset-y-0 rounded-[4px]"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            background: st.color,
                            opacity: st.kind === 'subtotal' ? 0.75 : 1,
                          }}
                        />
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          <p className="mt-4 rounded-xl bg-cream px-4 py-3 text-[14.5px] leading-relaxed text-ink-soft">
            <b className="text-ink">En criollo:</b> vendiste <b className="text-ink">{money0(s.sales)}</b>. Esas botellas te habían costado {money0(s.cogs)}, así que te quedaron{' '}
            {money0(s.gross_profit)} de ganancia bruta
            {s.sales > 0 && ` (${per100(s.gross_profit, s.sales)} de cada $ 100)`}. De ahí se fueron {money0(s.fees + s.shrinkage)} en comisiones y mermas y {money0(s.expenses)} en gastos.{' '}
            {lost ? (
              <>
                No alcanzó: <b className="text-bad">perdiste {money0(-s.net_result)}</b>.
              </>
            ) : (
              <>
                Resultado: <b className="text-good">ganaste {money0(s.net_result)}</b>
                {s.sales > 0 && `, o sea $ ${Math.round(s.net_margin * 100)} limpios de cada $ 100 que vendiste`}.
              </>
            )}{' '}
            Ojo: comprar vino no es un gasto; se vuelve costo recién cuando vendés la botella.
          </p>
        </>
      )}
    </Card>
  )
}
