// Pestaña "Por categoría": en qué se va la plata, qué creció, qué bajó
// y cómo vienen los fijos y los variables mes a mes.
import { useMemo, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Lightbulb, Minus, PieChart, Plus } from 'lucide-react'
import clsx from 'clsx'
import { CHART_COLORS } from '@shared/constants'
import { monthKey, today } from '@shared/dates'
import { dateShort, money, pct, pctDelta } from '@/lib/format'
import { usePeriod } from '@/lib/period'
import { useApi } from '@/lib/queries'
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, InfoTip, Loading, PeriodPicker, type Column } from '@/components/ui'
import { ChartCard, ColumnChart, DonutChart, Legend, RankBars } from '@/components/charts'
import { categoryIcon, categoryShort, NATURE_SHORT, type ExpensesSummary } from './types'

type CatRow = ExpensesSummary['by_category'][number]

const FIXED_COLOR = CHART_COLORS.gastos
const VARIABLE_COLOR = CHART_COLORS.extra

/** Variación de un gasto: subir es malo (rojo), bajar es bueno (verde). */
function ChangeBadge({ change }: { change: number | null }) {
  if (change == null) return <span className="text-[13px] text-muted">nuevo</span>
  const flat = Math.abs(change) < 0.005
  const Icon = flat ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12.5px] font-extrabold',
        flat ? 'bg-cream-deep text-ink-soft' : change > 0 ? 'bg-bad-soft text-bad' : 'bg-good-soft text-good',
      )}
    >
      <Icon size={13} strokeWidth={2.8} aria-hidden />
      {pctDelta(change)}
    </span>
  )
}

export function CategoriesTab({ onPickCategory, onNew }: { onPickCategory: (category: string) => void; onNew: () => void }) {
  const { period, preset, label: periodLabel } = usePeriod()
  const summary = useApi<ExpensesSummary>('/expenses/summary', { from: period.from, to: period.to })
  const s = summary.data
  const canCompare = !!s?.comparison.comparable && preset !== 'todo'
  const cmpText = s?.comparison.mode === 'same_days' ? `vs. ${dateShort(s.comparison.previous.from)} – ${dateShort(s.comparison.previous.to)}` : 'vs. período anterior'

  // Frases que explican los números ("insights"), en criollo.
  const insights = useMemo(() => {
    if (!s || s.total <= 0) return []
    const out: { key: string; text: ReactNode }[] = []
    const top = s.by_category[0]
    if (top) {
      out.push({
        key: 'top',
        text: (
          <>
            Tu gasto más grande es <b>{categoryShort(top.category)}</b>: {pct(top.pct, 0)} de todo lo que gastaste ({money(top.amount, { decimals: 0 })}).
          </>
        ),
      })
    }
    if (canCompare) {
      // Para no hacer ruido con categorías chiquitas, solo cuentan las que mueven al menos el 2 % del total.
      const material = s.by_category.filter((c) => c.change != null && Math.max(c.compare_current, c.compare_previous) >= s.comparison.current.total * 0.02)
      const up = [...material].sort((a, b) => (b.change ?? 0) - (a.change ?? 0))[0]
      const down = [...material].sort((a, b) => (a.change ?? 0) - (b.change ?? 0))[0]
      if (up && (up.change ?? 0) > 0.02) {
        out.push({
          key: 'up',
          text: (
            <>
              Lo que más creció: <b>{categoryShort(up.category)}</b> ({pctDelta(up.change)} {cmpText}: de {money(up.compare_previous, { decimals: 0 })} a{' '}
              {money(up.compare_current, { decimals: 0 })}).
            </>
          ),
        })
      }
      if (down && (down.change ?? 0) < -0.02) {
        out.push({
          key: 'down',
          text: (
            <>
              Lo que más bajó: <b>{categoryShort(down.category)}</b> ({pctDelta(down.change)}, de {money(down.compare_previous, { decimals: 0 })} a{' '}
              {money(down.compare_current, { decimals: 0 })}).
            </>
          ),
        })
      }
      const fresh = s.by_category.filter((c) => c.change == null && c.compare_current > 0)
      if (fresh.length) {
        out.push({
          key: 'new',
          text: (
            <>
              {fresh.length === 1 ? 'Gasto nuevo' : 'Gastos nuevos'}: <b>{fresh.map((c) => categoryShort(c.category)).join(', ')}</b> (en el período anterior no {fresh.length === 1 ? 'tenía' : 'tenían'} nada).
            </>
          ),
        })
      }
      if (s.gone_categories.length) {
        out.push({
          key: 'gone',
          text: (
            <>
              Esta vez no gastaste en <b>{s.gone_categories.map((c) => categoryShort(c.category)).join(', ')}</b>.
            </>
          ),
        })
      }
    }
    const fixedShare = s.fixed / s.total
    out.push({
      key: 'fixed',
      text: (
        <>
          Los gastos <b>fijos</b> son el {pct(fixedShare, 0)} del total.{' '}
          {fixedShare >= 0.6
            ? 'Tu estructura es pesada en fijos: en un mes flojo de ventas se siente mucho, porque igual hay que pagarlos.'
            : fixedShare <= 0.35
              ? 'La mayoría de tus gastos acompañan a las ventas: si un mes vendés menos, también gastás menos.'
              : 'Hay un equilibrio entre lo que pagás sí o sí y lo que acompaña a las ventas.'}
        </>
      ),
    })
    if (s.vs_sales != null) {
      out.push({
        key: 'sales',
        text: (
          <>
            De cada $ 100 que vendiste, <b>$ {Math.round(s.vs_sales * 100)}</b> se fueron en gastos ({pct(s.vs_sales)} de las ventas).
          </>
        ),
      })
    }
    return out
  }, [s, canCompare, cmpText])

  const columns: Column<CatRow>[] = [
    {
      key: 'category',
      header: 'Categoría',
      cell: (r) => {
        const Icon = categoryIcon(r.category)
        return (
          <span className="inline-flex min-w-0 items-center gap-2" title={r.category}>
            <Icon size={16} className="shrink-0 text-muted" aria-hidden />
            <span className="truncate font-semibold text-ink">{categoryShort(r.category)}</span>
          </span>
        )
      },
    },
    { key: 'nature', header: 'Tipo', hideBelow: 'md', value: (r) => NATURE_SHORT[r.nature as 'fijo'], cell: (r) => <Badge tone={r.nature === 'fijo' ? 'coral' : 'mustard'}>{NATURE_SHORT[r.nature as 'fijo'] ?? r.nature}</Badge> },
    { key: 'count', header: 'Gastos', align: 'right', hideBelow: 'sm', cell: (r) => r.count },
    { key: 'amount', header: 'Monto', align: 'right', cell: (r) => <span className="font-bold">{money(r.amount, { decimals: 0 })}</span>, footer: s ? money(s.total, { decimals: 0 }) : undefined },
    { key: 'pct', header: '% del total', align: 'right', hideBelow: 'sm', cell: (r) => pct(r.pct), footer: '100 %' },
    ...(canCompare ? [{ key: 'change', header: 'Variación', align: 'right' as const, hideBelow: 'md' as const, value: (r: CatRow) => r.change ?? 999, cell: (r: CatRow) => <ChangeBadge change={r.change} /> }] : []),
  ]

  if (summary.error) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker />
        {s && s.total > 0 && <p className="text-[13.5px] text-ink-soft">{money(s.total, { decimals: 0 })} en gastos en {periodLabel.toLowerCase()}</p>}
      </div>
      {!s ? (
        <Loading />
      ) : s.total <= 0 ? (
        <Card>
          <EmptyState
            icon={PieChart}
            title="No hay gastos en este período"
            action={
              <Button icon={Plus} onClick={onNew}>
                Cargar un gasto
              </Button>
            }
          >
            Elegí otro período arriba o cargá tus gastos: acá vas a ver en qué se va la plata y qué categoría crece más.
          </EmptyState>
        </Card>
      ) : (
        <>
          {insights.length > 0 && (
            <Card
              className="mb-4"
              title={
                <span className="flex items-center gap-2">
                  <Lightbulb size={18} className="text-mustard-deep" aria-hidden /> Lo que dicen tus números
                </span>
              }
              subtitle={canCompare ? `Comparando ${periodLabel.toLowerCase()} ${cmpText}.` : 'Para comparar con el período anterior hace falta tener cargados los gastos de ese período.'}
            >
              <ul className="space-y-2 text-[14.5px] leading-snug text-ink-soft [&_b]:text-ink">
                {insights.map((i) => (
                  <li key={i.key} className="flex gap-2.5">
                    <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-coral-deep" aria-hidden />
                    <span>{i.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="¿En qué se va la plata?"
              subtitle="Cada porción es una categoría (las más chicas se juntan en «Otros»)."
              term="gastos"
              table={{
                columns: [
                  { key: 'category', header: 'Categoría' },
                  { key: 'amount', header: 'Monto', align: 'right', format: (v) => money(Number(v)) },
                  { key: 'pct', header: '%', align: 'right', format: (v) => pct(Number(v)) },
                ],
                rows: s.by_category,
              }}
            >
              <DonutChart data={s.by_category.map((c) => ({ label: categoryShort(c.category), value: Math.round(c.amount) }))} />
            </ChartCard>
            <Card
              title="Ranking de categorías"
              subtitle={s.by_category.length > 6 ? `Las 6 más grandes (de ${s.by_category.length}). El resto, en la tabla de abajo.` : 'De mayor a menor.'}
            >
              <RankBars
                color={CHART_COLORS.gastos}
                max={6}
                items={s.by_category.map((c) => ({
                  label: categoryShort(c.category),
                  value: Math.round(c.amount),
                  sublabel: `${NATURE_SHORT[c.nature as 'fijo'] ?? c.nature} · ${pct(c.pct, 0)}`,
                }))}
              />
            </Card>
          </div>

          <ChartCard
            className="mt-4"
            title="Fijos y variables, mes a mes"
            subtitle={
              <>
                Últimos 12 meses. Si la parte fija crece sin que crezcan las ventas, el punto de equilibrio se te aleja.
                {s.monthly.length > 0 && s.monthly[s.monthly.length - 1].month === monthKey(today()) && (
                  <> Ojo: {s.monthly[s.monthly.length - 1].label} todavía no terminó (va hasta hoy).</>
                )}
              </>
            }
            term="gastos_fijos"
            legend={
              <Legend
                items={[
                  { label: 'Fijos', color: FIXED_COLOR },
                  { label: 'Variables', color: VARIABLE_COLOR },
                ]}
              />
            }
            table={{
              columns: [
                { key: 'label', header: 'Mes' },
                { key: 'fixed', header: 'Fijos', align: 'right', format: (v) => money(Number(v), { decimals: 0 }) },
                { key: 'variable', header: 'Variables', align: 'right', format: (v) => money(Number(v), { decimals: 0 }) },
                { key: 'total', header: 'Total', align: 'right', format: (v) => money(Number(v), { decimals: 0 }) },
                { key: 'vs_sales', header: 'Sobre ventas', align: 'right', format: (v) => (v == null ? '—' : pct(Number(v), 0)) },
              ],
              rows: [...s.monthly].reverse(),
            }}
          >
            <ColumnChart
              data={s.monthly}
              stacked
              height={270}
              series={[
                { key: 'fixed', label: 'Fijos', color: FIXED_COLOR },
                { key: 'variable', label: 'Variables', color: VARIABLE_COLOR },
              ]}
            />
          </ChartCard>

          <Card
            className="mt-4"
            title={
              <span className="flex items-center gap-1.5">
                Detalle por categoría
                {canCompare && <InfoTip title="Variación" text={`Cuánto cambió lo gastado en cada categoría ${cmpText}. En rojo si subió (gastaste más), en verde si bajó.`} />}
              </span>
            }
            subtitle="Tocá una categoría para ver sus gastos uno por uno."
            flush
          >
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <DataTable rows={s.by_category} columns={columns} rowKey={(r) => r.category} onRowClick={(r) => onPickCategory(r.category)} searchable={false} initialSort={{ key: 'amount', dir: 'desc' }} />
            </div>
          </Card>
        </>
      )}
    </>
  )
}
