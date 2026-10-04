// La meta del mes en Inicio: cuánto llevás vendido contra la meta, y si vas al ritmo esperado
// según los días que ya pasaron (la rayita negra marca "a esta altura del mes tendrías que ir por acá").
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowRight, StickyNote, Target, TrendingDown, TrendingUp } from 'lucide-react'
import { int, pct } from '@/lib/format'
import { money0 } from './fmt'
import { Badge, Button, Card, EmptyState, InfoTip, ProgressBar } from '@/components/ui'
import type { DashboardGoal } from './types'

/** Barra de avance con la marca del avance esperado. */
export function PaceBar({ progress, expected, className }: { progress: number; expected: number | null; className?: string }) {
  return (
    <div className={clsx('relative', className)}>
      <ProgressBar value={progress} max={1} showLabel={false} />
      {expected != null && expected > 0 && expected < 1 && (
        <span className="pointer-events-none absolute -top-1 -bottom-1 w-[3px] -translate-x-1/2 rounded-full bg-ink" style={{ left: `${expected * 100}%` }} aria-hidden />
      )}
    </div>
  )
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function GoalCard({ goal, month, monthLabel, className }: { goal: DashboardGoal | null; month: string; monthLabel: string; className?: string }) {
  const navigate = useNavigate()
  const monthOnly = monthLabel.split(' ')[0]
  if (!goal) {
    return (
      <Card className={className} title={`Meta de ${monthOnly}`} actions={<InfoTip term="presupuesto" />}>
        <EmptyState
          compact
          icon={Target}
          title={`Sin meta para ${monthOnly}`}
          action={
            <Button variant="soft" icon={Target} onClick={() => navigate(`/metas?mes=${month}`)}>
              Poné una meta
            </Button>
          }
        >
          Con una meta sabés si el mes viene bien o mal. Te ayudamos a calcularla con tu punto de equilibrio y lo que vendiste el año pasado.
        </EmptyState>
      </Card>
    )
  }
  const g = goal
  const running = g.days_elapsed > 0 && g.days_elapsed < g.days_total
  const finished = g.days_elapsed >= g.days_total
  const ahead = g.pace != null && g.pace >= 0
  return (
    <Card
      className={className}
      title={`Meta de ${monthOnly}`}
      subtitle={running ? `Día ${g.days_elapsed} de ${g.days_total}: ya pasó el ${pct(g.expected_progress, 0)} del mes.` : finished ? 'El mes ya terminó.' : 'El mes todavía no empezó.'}
      actions={
        <Link to="/metas" className="inline-flex items-center gap-1 text-[13.5px] font-bold text-sky-deep hover:underline">
          Ver metas <ArrowRight size={14} aria-hidden />
        </Link>
      }
    >
      <div className="space-y-5">
        {g.sales_target != null && g.progress != null && (
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[14px] font-bold text-ink">Ventas</span>
              <span className="text-[13.5px] text-ink-soft">
                <b className="vh-num text-[17px] font-extrabold text-ink">{money0(g.sales)}</b> de {money0(g.sales_target)}
              </span>
            </div>
            <PaceBar progress={g.progress} expected={running ? g.expected_progress : null} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="vh-num text-[22px] leading-none font-extrabold text-ink">{pct(g.progress, 0)}</span>
              {running && g.pace != null && (
                <Badge tone={ahead ? 'good' : 'warn'} icon={ahead ? <TrendingUp size={13} aria-hidden /> : <TrendingDown size={13} aria-hidden />}>
                  {Math.abs(g.pace) < 0.02 ? 'Justo al ritmo' : `${pct(Math.abs(g.pace), 0)} ${ahead ? 'adelante' : 'atrás'} del ritmo`}
                </Badge>
              )}
              {finished && <Badge tone={g.progress >= 1 ? 'good' : 'warn'}>{g.progress >= 1 ? '¡Meta cumplida!' : 'No se llegó'}</Badge>}
            </div>
            <p className="mt-2 text-[13.5px] leading-snug text-ink-soft">
              {running && g.expected_sales != null ? (
                <>
                  A esta altura tendrías que llevar {money0(g.expected_sales)} (la rayita negra) y llevás {money0(g.sales)}. Si seguís a este ritmo, cerrás {monthOnly} en{' '}
                  <b className="text-ink">{money0(g.projection)}</b>.
                </>
              ) : finished ? (
                g.progress >= 1 ? (
                  `Superaste la meta por ${money0(g.sales - g.sales_target)}. ¡Bien ahí!`
                ) : (
                  `Faltaron ${money0(g.sales_target - g.sales)} para llegar. Revisá en Metas si la meta era realista.`
                )
              ) : (
                `Cuando empiece ${monthOnly} vas a ver acá cómo venís.`
              )}
            </p>
          </div>
        )}
        {g.bottles_target != null && g.bottles_progress != null && (
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]">
              <span className="font-bold text-ink">Botellas</span>
              <span className="whitespace-nowrap text-ink-soft">
                <b className="vh-num text-ink">{int(g.bottles)}</b> de {int(g.bottles_target)}
              </span>
            </div>
            <ProgressBar value={g.bottles} max={g.bottles_target} />
          </div>
        )}
        {g.expense_budget != null && g.expense_progress != null && (
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]">
              <span className="inline-flex items-center gap-1 font-bold whitespace-nowrap text-ink">
                Presupuesto de gastos <InfoTip term="presupuesto" size={14} />
              </span>
              <span className="whitespace-nowrap text-ink-soft">
                <b className="vh-num text-ink">{money0(g.expenses)}</b> de {money0(g.expense_budget)}
              </span>
            </div>
            <ProgressBar value={g.expenses} max={g.expense_budget} mode="budget" />
            {g.expense_progress > 1 && <p className="mt-1.5 text-[13px] font-semibold text-bad">Te pasaste {money0(g.expenses - g.expense_budget)} del presupuesto.</p>}
          </div>
        )}
        {g.notes && (
          <p className="flex items-start gap-2 rounded-xl bg-cream px-3 py-2 text-[13px] text-ink-soft">
            <StickyNote size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden /> {capital(g.notes)}
          </p>
        )}
      </div>
    </Card>
  )
}
