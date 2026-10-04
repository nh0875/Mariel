// Metas: cuánto querés vender y cuánto pensás gastar cada mes, y cómo vas.
// Lo real de cada mes sale del mismo motor que Inicio y Reportes (GET /api/goals),
// y la sugerencia de meta se explica paso a paso (GET /api/goals/suggest).
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData } from '@tanstack/react-query'
import { CalendarDays, Pencil, Target, Trash2 } from 'lucide-react'
import { CHART_COLORS } from '@shared/constants'
import { safeDiv } from '@shared/calc'
import { monthKey, today } from '@shared/dates'
import { api } from '@/lib/api'
import { useApi, useApiMutation } from '@/lib/queries'
import { int, pct } from '@/lib/format'
import { budgetPct, compact, money0, progressPct } from '../inicio/fmt'
import { GoalBar, PaceBar } from '../inicio/GoalCard'
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  ExportButton,
  HelpBox,
  InfoTip,
  Loading,
  Money,
  PageHeader,
  Select,
  StatTile,
  Tabs,
  useConfirm,
  type Column,
} from '@/components/ui'
import { ChartCard, ColumnChart, Legend } from '@/components/charts'
import { GoalFormModal } from './GoalFormModal'
import type { GoalMonth } from './types'

/** Las metas van en un color neutro (son una referencia); lo real con el color de su concepto. */
const META_COLOR = '#B8A089'
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const monthOnly = (label: string) => label.split(' ')[0]

// ───────────────────────── Cómo vas este mes ─────────────────────────

function CurrentMonthCard({ m, onEdit }: { m: GoalMonth; onEdit: () => void }) {
  const name = monthOnly(m.label)
  const dayNow = Number(today().slice(8, 10))
  const daysTotal = Math.round(dayNow / (m.expected_progress || 1))
  if (!m.has_goal) {
    return (
      <Card className="h-full" title={`Cómo vas en ${name}`}>
        <div className="flex h-full flex-col items-start gap-3">
          <p className="text-[14.5px] text-ink-soft">
            {m.actual.sales > 0 ? (
              <>
                Todavía no pusiste una meta para {name}. Llevás vendidos <b className="text-ink">{money0(m.actual.sales)}</b>, pero sin meta no hay forma de saber si eso es mucho o
                poco.
              </>
            ) : (
              <>Todavía no pusiste una meta para {name}. Ponela ahora y vas a saber desde el primer día si el mes viene bien o mal.</>
            )}
          </p>
          <Button variant="soft" icon={Target} onClick={onEdit}>
            Poné la meta de {name}
          </Button>
        </div>
      </Card>
    )
  }
  const expectedSales = m.sales_target ? m.sales_target * m.expected_progress : null
  const pace = expectedSales ? m.actual.sales / expectedSales - 1 : null
  const ahead = pace != null && pace >= 0
  return (
    <Card
      className="h-full"
      title={`Cómo vas en ${name}`}
      subtitle={`Ya pasó el ${pct(m.expected_progress, 0)} del mes (día ${dayNow} de ${daysTotal}).`}
      actions={
        <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>
          Cambiar
        </Button>
      }
    >
      <div className="space-y-4">
        {m.sales_target != null && m.progress != null && (
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]">
              <span className="font-bold text-ink">Ventas</span>
              <span className="text-ink-soft">
                <b className="vh-num text-[16px] font-extrabold text-ink">{money0(m.actual.sales)}</b> de {money0(m.sales_target)}
              </span>
            </div>
            <PaceBar progress={m.progress} expected={m.expected_progress} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="vh-num text-[20px] leading-none font-extrabold text-ink">{progressPct(m.progress)}</span>
              {pace != null && (
                <Badge tone={ahead ? 'good' : 'warn'}>
                  {Math.abs(pace) < 0.02 ? 'Justo al ritmo' : `Vas ${pct(Math.abs(pace), 0)} ${ahead ? 'adelantado' : 'atrasado'} respecto del ritmo esperado`}
                </Badge>
              )}
            </div>
            {expectedSales != null && (
              <p className="mt-1.5 text-[13px] leading-snug text-ink-soft">
                La rayita negra marca lo que tendrías que llevar hoy para llegar justo: {money0(expectedSales)}.
              </p>
            )}
          </div>
        )}
        {m.bottles_target != null && (
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]">
              <span className="font-bold text-ink">Botellas</span>
              <span className="text-ink-soft">
                <b className="vh-num text-ink">{int(m.actual.bottles)}</b> de {int(m.bottles_target)}
              </span>
            </div>
            <GoalBar value={m.actual.bottles} max={m.bottles_target} />
          </div>
        )}
        {m.expense_budget != null && (
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]">
              <span className="font-bold text-ink">Gastos</span>
              <span className="text-ink-soft">
                <b className="vh-num text-ink">{money0(m.actual.expenses)}</b> de {money0(m.expense_budget)}
              </span>
            </div>
            <GoalBar value={m.actual.expenses} max={m.expense_budget} mode="budget" />
            {m.actual.expenses > m.expense_budget && <p className="mt-1.5 text-[13px] font-semibold text-bad">Te pasaste {money0(m.actual.expenses - m.expense_budget)} del presupuesto.</p>}
          </div>
        )}
      </div>
    </Card>
  )
}

// ───────────────────────── Resumen del año ─────────────────────────

function YearSummary({ rows, year, thisYear }: { rows: GoalMonth[]; year: number; thisYear: number }) {
  const done = rows.filter((r) => r.status === 'past')
  const withSales = done.filter((r) => r.sales_target)
  const hit = withSales.filter((r) => (r.progress ?? 0) >= 1).length
  const salesReal = withSales.reduce((a, r) => a + r.actual.sales, 0)
  const salesGoal = withSales.reduce((a, r) => a + (r.sales_target ?? 0), 0)
  const withBudget = done.filter((r) => r.expense_budget)
  const spent = withBudget.reduce((a, r) => a + r.actual.expenses, 0)
  const budget = withBudget.reduce((a, r) => a + (r.expense_budget ?? 0), 0)
  const over = withBudget.filter((r) => (r.expense_progress ?? 0) > 1).length
  const ytd = rows.filter((r) => r.status !== 'future')
  const net = ytd.reduce((a, r) => a + r.actual.net_result, 0)
  const anyData = ytd.some((r) => r.actual.sales > 0 || r.actual.expenses > 0)
  const budgetRatio = safeDiv(spent, budget)
  return (
    <div className="grid grid-cols-1 gap-3 min-[440px]:grid-cols-2 sm:gap-4">
      <StatTile
        label="Metas cumplidas"
        tone="orange"
        value={withSales.length ? `${hit} de ${withSales.length}` : '—'}
        hint={withSales.length ? 'Meses terminados en los que llegaste a la meta de ventas.' : 'Cuando termine un mes con meta, lo vas a ver acá.'}
      />
      <StatTile
        label="Ventas vs. metas"
        term="presupuesto"
        tone="sky"
        value={salesGoal ? progressPct(salesReal / salesGoal) : '—'}
        hint={salesGoal ? `Vendiste ${compact(salesReal)} contra ${compact(salesGoal)} de metas (meses terminados).` : 'Se calcula con los meses que ya terminaron.'}
      />
      <StatTile
        label="Gastos vs. presupuesto"
        tone="coral"
        value={budget ? <span className={budgetRatio > 1 ? 'text-bad' : undefined}>{budgetPct(budgetRatio)}</span> : '—'}
        hint={
          budget
            ? over
              ? `Gastaste ${compact(spent)} de ${compact(budget)}. Te pasaste en ${over} de ${withBudget.length} ${withBudget.length === 1 ? 'mes' : 'meses'}.`
              : `Gastaste ${compact(spent)} de ${compact(budget)}. ¡Nunca te pasaste!`
            : 'Poné un presupuesto de gastos para ver si te pasás.'
        }
      />
      <StatTile
        label={year === thisYear ? 'Resultado en lo que va del año' : `Resultado ${year}`}
        term="resultado"
        tone="mustard"
        value={ytd.length && anyData ? <Money decimals={0} value={net} tone="auto" /> : '—'}
        hint={
          !ytd.length
            ? 'El año todavía no empezó.'
            : !anyData
              ? `Todavía no hay ventas ni gastos cargados en ${year}.`
              : `${net >= 0 ? 'Ganancia' : 'Pérdida'} sumando todos los meses${year === thisYear ? ' hasta hoy' : ''}: ventas − costo del vino − comisiones − mermas − gastos.`
        }
      />
    </div>
  )
}

// ───────────────────────── Gráfico meta vs. real ─────────────────────────

function GoalChart({ rows }: { rows: GoalMonth[] }) {
  const [tab, setTab] = useState<'ventas' | 'gastos'>('ventas')
  const data = rows.map((r) => ({
    label: r.short_label,
    meta: r.sales_target ?? 0,
    ventas: r.status === 'future' ? 0 : r.actual.sales,
    presupuesto: r.expense_budget ?? 0,
    gastos: r.status === 'future' ? 0 : r.actual.expenses,
  }))
  const isSales = tab === 'ventas'
  return (
    <ChartCard
      title="Meta vs. real, mes por mes"
      subtitle={isSales ? 'Barra marrón clara: la meta. Barra azul: lo que vendiste.' : 'Barra marrón clara: el presupuesto. Barra coral: lo que gastaste.'}
      legend={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: 'ventas', label: 'Ventas vs. meta' },
              { key: 'gastos', label: 'Gastos vs. presupuesto' },
            ]}
          />
          <Legend
            items={
              isSales
                ? [
                    { label: 'Meta de ventas', color: META_COLOR },
                    { label: 'Ventas reales', color: CHART_COLORS.ventas },
                  ]
                : [
                    { label: 'Presupuesto', color: META_COLOR },
                    { label: 'Gastos reales', color: CHART_COLORS.gastos },
                  ]
            }
          />
        </div>
      }
      table={{
        columns: [
          { key: 'label', header: 'Mes' },
          { key: 'sales_target', header: 'Meta de ventas', align: 'right', format: (v) => (v == null ? '—' : money0(Number(v))) },
          { key: 'sales', header: 'Vendiste', align: 'right', format: (v) => (v == null ? '—' : money0(Number(v))) },
          { key: 'progress', header: 'Avance', align: 'right', format: (v) => (v == null ? '—' : progressPct(Number(v))) },
          { key: 'expense_budget', header: 'Presupuesto', align: 'right', format: (v) => (v == null ? '—' : money0(Number(v))) },
          { key: 'expenses', header: 'Gastaste', align: 'right', format: (v) => (v == null ? '—' : money0(Number(v))) },
        ],
        // Los meses que todavía no empezaron no tienen "real": van con guion, no con $ 0.
        rows: rows.map((r) => {
          const future = r.status === 'future'
          return { ...r, label: capital(r.label), sales: future ? null : r.actual.sales, expenses: future ? null : r.actual.expenses, progress: future ? null : r.progress }
        }),
      }}
    >
      <ColumnChart
        data={data}
        height={250}
        series={
          isSales
            ? [
                { key: 'meta', label: 'Meta de ventas', color: META_COLOR },
                { key: 'ventas', label: 'Ventas reales', color: CHART_COLORS.ventas },
              ]
            : [
                { key: 'presupuesto', label: 'Presupuesto', color: META_COLOR },
                { key: 'gastos', label: 'Gastos reales', color: CHART_COLORS.gastos },
              ]
        }
      />
    </ChartCard>
  )
}

// ───────────────────────── Pantalla ─────────────────────────

export default function MetasPage() {
  const thisYear = Number(today().slice(0, 4))
  const curMonth = monthKey(today())
  const [params, setParams] = useSearchParams()
  const [year, setYear] = useState(thisYear)
  const [editing, setEditing] = useState<string | null>(null)
  const confirm = useConfirm()

  // /metas?mes=2026-11 abre directo el formulario de ese mes (lo usa Inicio en "Poné una meta").
  useEffect(() => {
    const m = params.get('mes')
    if (m && MONTH_RE.test(m)) {
      setYear(Number(m.slice(0, 4)))
      setEditing(m)
      const next = new URLSearchParams(params)
      next.delete('mes')
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  const q = useApi<GoalMonth[]>('/goals', { year }, { placeholderData: keepPreviousData })
  const rows = q.data
  const remove = useApiMutation((month: string) => api.del(`/goals/${month}`), { success: 'Listo, borramos la meta.' })

  const years = useMemo(() => {
    const out: number[] = []
    for (let y = thisYear + 1; y >= thisYear - 4; y--) out.push(y)
    if (!out.includes(year)) out.push(year)
    return out.sort((a, b) => b - a)
  }, [thisYear, year])

  // El botón principal propone el próximo mes sin meta (desde el mes actual), así cargar el año es ir haciendo clic.
  const nextMonth = useMemo(() => {
    if (!rows) return null
    const from = year === thisYear ? curMonth : year > thisYear ? `${year}-01` : `${year}-12`
    const candidates = rows.filter((r) => r.month >= from || year < thisYear)
    return candidates.find((r) => !r.has_goal) ?? rows.find((r) => r.month === from) ?? rows[rows.length - 1]
  }, [rows, year, thisYear, curMonth])

  const askDelete = async (r: GoalMonth) => {
    const ok = await confirm({
      title: `¿Borrar la meta de ${monthOnly(r.label)}?`,
      message: 'Se borran la meta de ventas, de botellas y el presupuesto de ese mes. Tus ventas y gastos no se tocan.',
      confirmText: 'Sí, borrar la meta',
      danger: true,
    })
    if (ok) remove.mutate(r.month)
  }

  const goalCount = rows?.filter((r) => r.has_goal).length ?? 0
  const current = rows?.find((r) => r.status === 'current')
  const editingRow = editing ? rows?.find((r) => r.month === editing) : undefined

  const totals = useMemo(() => {
    const r = rows ?? []
    const sum = (f: (x: GoalMonth) => number) => r.reduce((a, x) => a + f(x), 0)
    return {
      salesTarget: sum((x) => x.sales_target ?? 0),
      sales: sum((x) => x.actual.sales),
      bottlesTarget: sum((x) => x.bottles_target ?? 0),
      bottles: sum((x) => x.actual.bottles),
      budget: sum((x) => x.expense_budget ?? 0),
      expenses: sum((x) => x.actual.expenses),
      net: sum((x) => x.actual.net_result),
    }
  }, [rows])

  const columns: Column<GoalMonth>[] = [
    {
      key: 'month',
      header: 'Mes',
      sortable: false,
      cell: (r) => (
        <div className="min-w-[96px]">
          <span className="font-extrabold text-ink">{capital(monthOnly(r.label))}</span>
          {r.status === 'current' && (
            <Badge tone="orange" className="ml-1.5 align-middle">
              En curso
            </Badge>
          )}
          {r.notes && <p className="max-w-[180px] truncate text-[12.5px] text-muted" title={r.notes}>{r.notes}</p>}
        </div>
      ),
      footer: `Total ${year}`,
    },
    {
      key: 'sales',
      header: 'Ventas vs. meta',
      sortable: false,
      cell: (r) =>
        r.sales_target ? (
          <div className="min-w-[190px]">
            <p className="mb-1 text-[13.5px] whitespace-nowrap text-ink-soft">
              {r.status === 'future' ? (
                <>
                  Meta <b className="vh-num text-ink">{money0(r.sales_target)}</b>
                </>
              ) : (
                <>
                  <b className="vh-num text-ink">{money0(r.actual.sales)}</b> de <span className="vh-num">{money0(r.sales_target)}</span>
                </>
              )}
            </p>
            {r.status === 'current' ? (
              <div className="flex items-center gap-3">
                <PaceBar className="flex-1" progress={r.progress ?? 0} expected={r.expected_progress} />
                <span className="vh-num w-14 text-right text-sm font-extrabold text-ink">{progressPct(r.progress)}</span>
              </div>
            ) : r.status === 'future' ? (
              <p className="text-[12.5px] text-muted">Todavía no empezó</p>
            ) : (
              <GoalBar value={r.actual.sales} max={r.sales_target} />
            )}
          </div>
        ) : (
          <div className="min-w-[190px]">
            <p className="text-[13.5px] text-ink-soft">
              {r.status === 'future' ? '—' : <b className="vh-num text-ink">{money0(r.actual.sales)}</b>}
              <span className="ml-1.5 text-[12.5px] text-muted">sin meta</span>
            </p>
          </div>
        ),
      footer: (
        <span className="text-[13.5px]">
          {money0(totals.sales)} {totals.salesTarget > 0 && <span className="font-semibold text-ink-soft">de {money0(totals.salesTarget)}</span>}
        </span>
      ),
    },
    {
      key: 'bottles',
      header: 'Botellas',
      align: 'right',
      sortable: false,
      hideBelow: 'lg',
      cell: (r) =>
        r.status === 'future' && !r.bottles_target ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="text-[13.5px] text-ink-soft">
            {r.status === 'future' ? (
              <>
                Meta <b className="text-ink">{int(r.bottles_target)}</b>
              </>
            ) : (
              <>
                <b className="text-ink">{int(r.actual.bottles)}</b>
                {r.bottles_target ? ` de ${int(r.bottles_target)}` : ''}
              </>
            )}
            {r.bottles_progress != null && r.status !== 'future' && <span className="block text-[12.5px] text-muted">{progressPct(r.bottles_progress)}</span>}
          </span>
        ),
      footer: (
        <span className="text-[13.5px]">
          {int(totals.bottles)}
          {totals.bottlesTarget ? <span className="font-semibold text-ink-soft"> de {int(totals.bottlesTarget)}</span> : null}
        </span>
      ),
    },
    {
      key: 'expenses',
      header: 'Gastos vs. presupuesto',
      sortable: false,
      hideBelow: 'md',
      cell: (r) =>
        r.expense_budget ? (
          <div className="min-w-[180px]">
            <p className="mb-1 text-[13.5px] whitespace-nowrap text-ink-soft">
              {r.status === 'future' ? (
                <>
                  Tope <b className="vh-num text-ink">{money0(r.expense_budget)}</b>
                </>
              ) : (
                <>
                  <b className="vh-num text-ink">{money0(r.actual.expenses)}</b> de <span className="vh-num">{money0(r.expense_budget)}</span>
                </>
              )}
            </p>
            {r.status === 'future' ? <p className="text-[12.5px] text-muted">Todavía no empezó</p> : <GoalBar value={r.actual.expenses} max={r.expense_budget} mode="budget" />}
          </div>
        ) : (
          <p className="text-[13.5px] text-ink-soft">
            {r.status === 'future' ? '—' : <b className="vh-num text-ink">{money0(r.actual.expenses)}</b>}
            <span className="ml-1.5 text-[12.5px] text-muted">sin presupuesto</span>
          </p>
        ),
      footer: (
        <span className="text-[13.5px]">
          {money0(totals.expenses)} {totals.budget > 0 && <span className="font-semibold text-ink-soft">de {money0(totals.budget)}</span>}
        </span>
      ),
    },
    {
      key: 'net',
      header: 'Resultado',
      align: 'right',
      sortable: false,
      hideBelow: 'sm',
      cell: (r) => (r.status === 'future' ? <span className="text-muted">—</span> : <Money decimals={0} value={r.actual.net_result} tone="auto" className="font-bold" />),
      footer: <Money decimals={0} value={totals.net} tone="auto" />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Acciones</span>,
      sortable: false,
      align: 'right',
      hideBelow: 'sm',
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" icon={r.has_goal ? Pencil : Target} onClick={() => setEditing(r.month)} aria-label={r.has_goal ? `Editar la meta de ${r.label}` : `Poner meta en ${r.label}`}>
            {r.has_goal ? 'Editar' : 'Poner'}
          </Button>
          {r.has_goal && <Button variant="ghost" size="sm" icon={Trash2} className="!px-0 text-muted hover:text-bad" onClick={() => askDelete(r)} aria-label={`Borrar la meta de ${r.label}`} />}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Metas"
        description="Cuánto querés vender y gastar cada mes, y cómo vas."
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-ink-soft">
              <CalendarDays size={16} aria-hidden /> Año
            </span>
            <Select aria-label="Año" className="w-[110px]" value={year} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: y, label: String(y) }))} />
            <ExportButton path="/goals/export" params={{ year }} label="Descargar Excel" />
            {nextMonth && (
              <Button variant="primary" icon={nextMonth.has_goal ? Pencil : Target} onClick={() => setEditing(nextMonth.month)}>
                {nextMonth.has_goal ? `Editar meta de ${monthOnly(nextMonth.label)}` : `Poner meta de ${monthOnly(nextMonth.label)}`}
              </Button>
            )}
          </>
        }
      />

      <HelpBox id="metas" className="mb-6">
        <p>
          Acá ponés <b>cuánto querés vender cada mes</b> (en pesos y en botellas) y <b>cuánto pensás gastar</b>, y ves mes a mes si llegaste. ¿Por qué? Porque sin meta no hay forma de
          saber si un mes fue bueno: vender $&nbsp;8.000.000 puede ser buenísimo o un desastre, según tus gastos.
        </p>
        <ul>
          <li>
            <span className="inline-flex items-center gap-1">
              <b>El piso es el punto de equilibrio</b> <InfoTip term="punto_equilibrio" size={14} />
            </span>
            : si tus gastos fijos son $&nbsp;900.000 por mes y de cada $&nbsp;100 que vendés te quedan $&nbsp;30 después de pagar el vino, las comisiones y los gastos variables, necesitás vender $&nbsp;900.000 ÷ 0,30 = $&nbsp;3.000.000 para no perder. Sumale un 15 % y tenés una meta que deja ganancia: $&nbsp;3.450.000.
          </li>
          <li>
            <b>Mirá el mismo mes del año pasado + inflación.</b> Si en noviembre pasado vendiste $&nbsp;8.000.000 y la inflación del año fue 28 %, vender $&nbsp;9.000.000 ahora en realidad es
            vender menos (equivale a $&nbsp;10.240.000).
          </li>
          <li>
            <b>El botón «Sugerir meta»</b> hace esas dos cuentas con tus números, te sugiere la mayor y te explica de dónde sale. Vos decidís si la usás o la ajustás.
          </li>
          <li>
            <span className="inline-flex items-center gap-1">
              <b>Presupuesto de gastos</b> <InfoTip term="presupuesto" size={14} />
            </span>
            : un tope para no gastar de más. La barra se pone naranja cuando usaste el 85 % y roja si te pasaste.
          </li>
        </ul>
      </HelpBox>

      {q.isLoading && !rows ? (
        <Loading label="Buscando tus metas…" />
      ) : q.error && !rows ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows ? (
        <div className={q.isPlaceholderData ? 'space-y-6 opacity-60 transition-opacity' : 'space-y-6 transition-opacity'}>
          {goalCount === 0 && (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-orange/40 bg-orange-soft/60 p-5 sm:flex-row sm:items-center">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[40%] bg-orange/30 text-ink" aria-hidden>
                <Target size={24} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[1.6rem] leading-tight text-ink">Todavía no pusiste metas para {year}</p>
                <p className="mt-1 text-[14.5px] text-ink-soft">
                  Empezá por {nextMonth ? monthOnly(nextMonth.label) : 'este mes'}: tocá «Poner meta» y después «Sugerir meta». Si ya cargaste ventas y gastos, te calculamos un número con
                  tu punto de equilibrio y lo que vendiste el año pasado; si no, poné uno que te parezca alcanzable y en unos meses lo afinamos.
                </p>
              </div>
            </div>
          )}

          <div className="grid items-stretch gap-4 sm:gap-5 lg:grid-cols-12">
            {current && year === thisYear && (
              <div className="lg:col-span-5">
                <CurrentMonthCard m={current} onEdit={() => setEditing(current.month)} />
              </div>
            )}
            <div className={current && year === thisYear ? 'lg:col-span-7' : 'lg:col-span-12'}>
              <YearSummary rows={rows} year={year} thisYear={thisYear} />
            </div>
          </div>

          {rows.some((r) => r.has_goal || r.actual.sales > 0 || r.actual.expenses > 0) && <GoalChart rows={rows} />}

          <section aria-labelledby="mes-a-mes">
            <div className="mb-3">
              <h2 id="mes-a-mes" className="font-display text-[1.75rem] leading-none text-ink">
                Mes a mes
              </h2>
              <p className="mt-1.5 text-[14px] text-ink-soft">
                Tocá un mes para poner o cambiar su meta. <span className="hidden sm:inline">En el mes en curso, la rayita negra marca dónde tendrías que estar hoy.</span>
              </p>
            </div>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.month}
              onRowClick={(r) => setEditing(r.month)}
              searchable={false}
              pageSize={12}
              rowClassName={(r) => (r.status === 'current' ? 'bg-orange-soft/40' : r.status === 'future' ? 'bg-cream/30' : undefined)}
            />
            <p className="mt-2 text-[13px] text-muted">
              Las ventas y los gastos cuentan en su fecha, aunque se cobren o paguen después (igual que en Inicio y Reportes). Resultado = ventas − costo del vino − comisiones − mermas −
              gastos.
            </p>
          </section>
        </div>
      ) : null}

      {/* Esperamos los datos del año del mes elegido (no los del año anterior que quedan mientras carga): si no, el formulario arrancaría vacío. */}
      {editing && rows && !q.isPlaceholderData && <GoalFormModal key={editing} month={editing} goal={editingRow} onClose={() => setEditing(null)} />}
    </>
  )
}
