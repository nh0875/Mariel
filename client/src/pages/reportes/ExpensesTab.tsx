// Pestaña "Gastos": en qué se va la plata, fijos vs. variables mes a mes y el punto de equilibrio
// (cuánto hay que vender por mes para no perder).
import { useNavigate } from 'react-router-dom'
import { Receipt } from 'lucide-react'
import { CHART_COLORS } from '@shared/constants'
import { monthLabel, type Period } from '@shared/dates'
import { int, pct } from '@/lib/format'
import { Badge, Button, Card, DataTable, EmptyState, ExportButton, StatTile, type Column } from '@/components/ui'
import { ChartCard, ColumnChart, Legend, RankBars } from '@/components/charts'
import { Amount, BlockTitle, compact, Insights, money0, pesos, plural, ReportGuard, TabIntro, useReport, type Insight } from './parts'
import type { ExpensesReport } from './types'

type Cat = ExpensesReport['by_category'][number]

/** "promedio de jul 26 a sep 26" — los meses completos que se usaron. */
function avgWindow(d: ExpensesReport): string {
  if (!d.avg_months.length) return 'sin meses completos'
  const first = monthLabel(d.avg_months[0])
  const last = monthLabel(d.avg_months[d.avg_months.length - 1])
  const range = d.avg_months.length === 1 ? first : `${first} a ${last}`
  return d.avg_basis === 'last_3' ? `últimos meses completos: ${range}` : `${plural(d.months_for_avg, 'mes completo', 'meses completos')}: ${range}`
}

function expenseInsights(d: ExpensesReport): Insight[] {
  const out: Insight[] = []
  const t = d.totals
  if (t.total <= 0) return out
  const top = d.by_category[0]
  if (top) {
    out.push({
      tone: 'info',
      text: (
        <>
          Tu gasto más grande es <b>{top.category}</b>: {pct(top.share, 0)} de todo lo que gastaste ({money0(top.total)}, unos {money0(top.monthly_avg)} por mes).
        </>
      ),
    })
  }
  if (t.sales > 0) {
    out.push({
      tone: t.total / t.sales > 0.45 ? 'warn' : 'info',
      text: (
        <>
          De cada $ 100 que vendiste, <b>{pesos(Math.round((t.total / t.sales) * 100))}</b> se fueron en gastos ({pesos(Math.round((t.fixed / t.sales) * 100))} fijos y{' '}
          {pesos(Math.round((t.variable / t.sales) * 100))} variables).
        </>
      ),
    })
  }
  if (d.break_even_monthly != null && d.months_for_avg > 0) {
    // Ventas promedio de los MISMOS meses completos con que se calculó el equilibrio.
    const avgSales = d.avg_sales
    const gap = avgSales - d.break_even_monthly
    const window = avgWindow(d)
    out.push({
      tone: gap >= 0 ? 'good' : 'bad',
      text:
        gap >= 0 ? (
          <>
            Para cubrir tus gastos fijos necesitás vender unos <b>{money0(d.break_even_monthly)}</b> por mes. Venís vendiendo {money0(avgSales)} en promedio ({window}): estás{' '}
            <b>{money0(gap)} por encima</b> del punto de equilibrio.
          </>
        ) : (
          <>
            Para cubrir tus gastos fijos necesitás vender unos <b>{money0(d.break_even_monthly)}</b> por mes, y venís vendiendo {money0(avgSales)} ({window}): te faltan <b>{money0(-gap)} por mes</b>.
            Opciones: vender más, subir el margen o bajar fijos.
          </>
        ),
    })
  } else if (d.break_even_monthly == null && t.sales > 0 && d.contribution_margin <= 0 && d.months_for_avg > 0) {
    out.push({
      tone: 'bad',
      text: <>Con los márgenes de este período, lo que te deja cada venta no alcanza ni para los gastos variables: no hay volumen de ventas que cubra los fijos. Revisá precios y costos.</>,
    })
  }
  return out
}

export function ExpensesTab({ period }: { period: Period }) {
  const q = useReport<ExpensesReport>('/reports/expenses', period)
  const navigate = useNavigate()
  return (
    <ReportGuard q={q}>
      {(d) => {
        const intro = (
          <TabIntro title="Gastos" period={d.period} actions={<ExportButton path="/reports/expenses/export" params={{ from: period.from, to: period.to }} />}>
            ¿En qué se va la plata? Los <b>gastos fijos</b> los pagás vendas o no (alquiler, sueldos); los <b>variables</b> suben y bajan con las ventas (envíos, packaging, publicidad). Con los fijos
            calculamos tu <b>punto de equilibrio</b>: lo mínimo que tenés que vender por mes para no perder plata.
          </TabIntro>
        )
        if (d.totals.total <= 0) {
          return (
            <>
              {intro}
              <EmptyState
                icon={Receipt}
                title="No hay gastos cargados en este período"
                action={
                  <Button icon={Receipt} onClick={() => navigate('/gastos?nuevo=1')}>
                    Cargar un gasto
                  </Button>
                }
              >
                Cargá el alquiler, los sueldos, los envíos… Sin los gastos, el resultado te va a dar mejor de lo que es en realidad.
              </EmptyState>
            </>
          )
        }
        const rows = d.by_month.map((m) => ({ label: m.partial ? `${m.label}*` : m.label, fijos: m.fixed, variables: m.variable, total: m.total, ventas: m.sales }))
        const partials = d.by_month.filter((m) => m.partial)
        const t = d.totals
        const cols: Column<Cat>[] = [
          { key: 'category', header: 'Categoría', cell: (c) => <span className="font-bold text-ink">{c.category}</span> },
          {
            key: 'nature',
            header: 'Tipo',
            hideBelow: 'sm',
            cell: (c) => <Badge tone={c.nature === 'fijo' ? 'coral' : 'neutral'}>{c.nature === 'fijo' ? 'Fijo' : 'Variable'}</Badge>,
          },
          { key: 'total', header: 'Total', align: 'right', cell: (c) => <b>{money0(c.total)}</b>, footer: money0(t.total) },
          { key: 'share', header: '% del total', align: 'right', hideBelow: 'md', cell: (c) => pct(c.share, 1), footer: '100 %' },
          {
            key: 'monthly_avg',
            header: 'Por mes',
            align: 'right',
            hideBelow: 'sm',
            cell: (c) =>
              c.monthly_avg === 0 && c.total > 0 ? (
                <span className="text-muted" title="No hubo gastos de esta categoría en los meses completos que se usan para el promedio.">
                  —
                </span>
              ) : (
                money0(c.monthly_avg)
              ),
            footer: money0(d.by_category.reduce((s, c) => s + c.monthly_avg, 0)),
          },
          { key: 'count', header: 'Cant.', align: 'right', hideBelow: 'lg', cell: (c) => int(c.count) },
        ]
        return (
          <>
            {intro}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              <StatTile label="Gastos" term="gastos" tone="coral" value={<Amount value={t.total} />} hint={`En el período. Fijos ${compact(t.fixed)} · variables ${compact(t.variable)}.`} />
              <StatTile
                label="Fijos por mes"
                term="gastos_fijos"
                value={<Amount value={d.fixed_avg} />}
                hint={
                  d.months_for_avg
                    ? `Promedio (${avgWindow(d)}).${d.avg_basis === 'last_3' ? ' El período elegido no tiene meses completos.' : ''}`
                    : 'Todavía no hay meses completos para promediar.'
                }
              />
              <StatTile
                label="Variables"
                term="gastos_variables"
                value={t.sales > 0 ? pct(d.variable_pct_of_sales) : '—'}
                hint={t.sales > 0 ? `Sobre las ventas: de cada ${pesos(100)} vendidos, ${pesos(Math.round(d.variable_pct_of_sales * 100))} son gastos variables.` : 'Se calcula cuando hay ventas.'}
              />
              <StatTile
                label="Equilibrio"
                term="punto_equilibrio"
                tone="orange"
                value={d.break_even_monthly != null ? <Amount value={d.break_even_monthly} /> : '—'}
                hint={
                  d.break_even_monthly != null
                    ? `Lo que tenés que vender por mes para no perder: fijos por mes ÷ margen de contribución (${pct(d.contribution_margin, 1)}), los dos con los mismos meses (${avgWindow(d)}). Mismo cálculo que la Calculadora y Metas.`
                    : !d.months_for_avg
                      ? 'Se calcula con meses completos: todavía no hay.'
                      : d.fixed_avg <= 0
                        ? 'No hay gastos fijos cargados en esos meses.'
                        : d.contribution_margin <= 0
                          ? 'No se puede calcular: el margen de contribución no es positivo.'
                          : 'Se calcula cuando hay ventas.'
                }
              />
            </div>

            <Insights className="mt-5" items={expenseInsights(d)} />

            <ChartCard
              className="mt-6"
              title="Gastos fijos y variables, mes a mes"
              subtitle="Los fijos deberían ser parejos; si los variables se disparan un mes, fijate si vendiste más (está bien) o si se escapó algo."
              term="gastos"
              legend={
                <Legend
                  items={[
                    { label: 'Fijos', color: CHART_COLORS.gastos },
                    { label: 'Variables', color: CHART_COLORS.extra },
                  ]}
                />
              }
              table={{
                columns: [
                  { key: 'label', header: 'Mes' },
                  { key: 'fijos', header: 'Fijos', align: 'right', format: (v) => money0(Number(v)) },
                  { key: 'variables', header: 'Variables', align: 'right', format: (v) => money0(Number(v)) },
                  { key: 'total', header: 'Total', align: 'right', format: (v) => money0(Number(v)) },
                  { key: 'ventas', header: 'Ventas', align: 'right', format: (v) => money0(Number(v)) },
                ],
                rows,
              }}
            >
              <ColumnChart
                data={rows}
                stacked
                height={260}
                series={[
                  { key: 'fijos', label: 'Fijos', color: CHART_COLORS.gastos },
                  { key: 'variables', label: 'Variables', color: CHART_COLORS.extra },
                ]}
              />
              {partials.length > 0 && (
                <p className="px-2 pt-1 text-[12.5px] text-muted">
                  * Mes incompleto ({partials.map((m) => `${m.label}: ${m.partial_note}`).join('; ')}): no es un mes entero, por eso no entra en los promedios.
                </p>
              )}
            </ChartCard>

            <div className="mt-6 grid gap-4 xl:grid-cols-5">
              <Card className="self-start xl:col-span-2" title="Ranking de gastos" subtitle="Las categorías que más pesan en el período">
                <RankBars items={d.by_category.map((c) => ({ label: c.category, value: Math.round(c.total) }))} color={CHART_COLORS.gastos} max={8} />
              </Card>
              <section className="min-w-0 xl:col-span-3" aria-label="Gastos por categoría">
                <BlockTitle title="Por categoría">
                  «Por mes» = promedio de {d.months_for_avg ? avgWindow(d) : 'los meses completos (todavía no hay)'}, igual que «Fijos por mes». Comprar vino no es gasto: es stock.
                </BlockTitle>
                <DataTable rows={d.by_category} columns={cols} rowKey={(c) => c.category} searchable={d.by_category.length > 8} searchPlaceholder="Buscar categoría…" dense />
              </section>
            </div>
          </>
        )
      }}
    </ReportGuard>
  )
}
