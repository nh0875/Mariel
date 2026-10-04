// Pestaña "Inflación": las ventas de cada mes llevadas a "pesos de hoy" para saber si creciste
// de verdad, y la tabla para cargar la inflación de cada mes (se guarda renglón por renglón).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Check, Store, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { CHART_COLORS } from '@shared/constants'
import type { Period } from '@shared/dates'
import { api } from '@/lib/api'
import { useApiMutation } from '@/lib/queries'
import { num, pct } from '@/lib/format'
import { Button, DataTable, EmptyState, ExportButton, InfoTip, NumberInput, StatTile, useConfirm, type Column } from '@/components/ui'
import { ChartCard, Legend } from '@/components/charts'
import { LineTrend } from './charts'
import { Amount, BlockTitle, Growth, Insights, money0, monthTitle, ReportGuard, TabIntro, useReport, type Insight } from './parts'
import type { InflationMonthRow, InflationReport } from './types'

const fmtRate = (r: number) => `${num(r, 2)}\u00A0%`
/** "enero 2026, febrero 2026 y 3 más (marcados con «Falta» en la tabla)" */
const listMonths = (ms: string[]) => {
  const names = ms.map((m) => monthTitle(m).toLowerCase())
  return names.length <= 4 ? names.join(', ') : `${names.slice(0, 3).join(', ')} y ${names.length - 3} más (están marcados con «Falta» en la tabla)`
}

/**
 * Crecimiento real "resumen", sin que lo engañe la estacionalidad (diciembre siempre vende más):
 * 1) si hay datos, el último mes completo contra el mismo mes del año anterior;
 * 2) si no, los últimos 3 meses completos contra los 3 anteriores;
 * 3) si no, el último mes completo contra el anterior.
 */
function realSummary(d: InflationReport): { value: number | null; label: string } {
  const complete = d.months.filter((m) => !m.partial)
  const last = complete.at(-1)
  if (last) {
    const [y, mm] = last.month.split('-')
    const yearAgo = d.months.find((m) => m.month === `${Number(y) - 1}-${mm}`)
    if (yearAgo && !yearAgo.partial && yearAgo.sales_today_pesos > 0) {
      return { value: last.sales_today_pesos / yearAgo.sales_today_pesos - 1, label: `${last.label} vs. ${yearAgo.label} · mismo mes del año anterior` }
    }
  }
  if (complete.length >= 6) {
    const sum = (xs: InflationMonthRow[]) => xs.reduce((s, m) => s + m.sales_today_pesos, 0)
    const recent = complete.slice(-3)
    const before = complete.slice(-6, -3)
    const b = sum(before)
    if (b <= 0) return { value: null, label: 'Hace falta tener ventas para comparar.' }
    return { value: sum(recent) / b - 1, label: `${recent[0].label}–${recent[2].label} vs. ${before[0].label}–${before[2].label} · últimos 3 meses vs. los 3 anteriores` }
  }
  if (complete.length >= 2) {
    return { value: last!.real_growth_vs_prev, label: `${last!.label} vs. ${complete.at(-2)!.label}` }
  }
  return { value: null, label: 'Hace falta más de un mes completo para comparar.' }
}

function inflationInsights(d: InflationReport): Insight[] {
  const out: Insight[] = []
  if (d.totals.sales > 0 && d.months.length >= 2 && d.base_month) {
    out.push({
      tone: 'info',
      text: (
        <>
          En el período vendiste <b>{money0(d.totals.sales)}</b> sumando los pesos de cada mes, pero llevados a pesos de {monthTitle(d.base_month).toLowerCase()} son{' '}
          <b>{money0(d.totals.sales_today_pesos)}</b>. La diferencia ({money0(d.totals.sales_today_pesos - d.totals.sales)}) es lo que «se comió» la inflación.
        </>
      ),
    })
  }
  const r = realSummary(d)
  if (r.value != null) {
    out.push(
      r.value >= 0.005
        ? {
            tone: 'good',
            text: (
              <>
                Sacando la inflación, <b>creciste {pct(r.value, 1)}</b> ({r.label}): vendés más de verdad, no solo más pesos.
              </>
            ),
          }
        : r.value <= -0.005
          ? {
              tone: 'bad',
              text: (
                <>
                  Sacando la inflación, <b>vendiste {pct(-r.value, 1)} menos</b> ({r.label}). Aunque los pesos suban, en cantidad de cosas el negocio se achicó.
                </>
              ),
            }
          : { tone: 'info', text: <>Sacando la inflación, vendiste prácticamente lo mismo ({r.label}): los pesos suben solo porque suben los precios.</> },
    )
  }
  return out
}

/** Mes incompleto (en curso o tomado solo en parte): no se compara con el anterior (sus ventas están incompletas). */
function InProgress({ note }: { note: string }) {
  return (
    <span className="text-[12.5px] text-muted" title="El mes está incompleto: compararlo con un mes entero daría una caída que no es real.">
      {note || 'incompleto'}
    </span>
  )
}

function RateEditor({
  row,
  draft,
  setDraft,
  onSave,
  onDelete,
  saving,
}: {
  row: InflationMonthRow
  draft: number | null | undefined
  setDraft: (v: number | null | undefined) => void
  onSave: (rate: number) => void
  onDelete: () => void
  saving: boolean
}) {
  const value = draft !== undefined ? draft : row.rate
  const dirty = draft !== undefined && draft !== row.rate
  const invalid = dirty && draft != null && (draft < -50 || draft > 500)
  const canSave = dirty && draft != null && !invalid && !saving
  return (
    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      <NumberInput
        aria-label={`Inflación de ${monthTitle(row.month)}`}
        className="w-[112px]"
        inputClassName={clsx('h-9 !pr-9', invalid && 'border-bad')}
        value={value}
        decimals={2}
        suffix="%"
        placeholder={row.rate == null ? 'Falta' : undefined}
        onChange={(v) => setDraft(v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSave) {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
            onSave(draft!)
          }
          if (e.key === 'Escape' && dirty) {
            e.preventDefault()
            e.stopPropagation()
            // Primero se suelta el campo (al soltarlo confirma lo escrito) y después se descarta el cambio.
            ;(e.target as HTMLInputElement).blur()
            setDraft(undefined)
          }
        }}
      />
      <span className="flex w-[76px] items-center gap-1">
        {dirty ? (
          <>
            <Button
              size="sm"
              variant="soft"
              icon={Check}
              className="!px-0"
              loading={saving}
              disabled={!canSave}
              onClick={() => canSave && onSave(draft!)}
              title="Guardar (Enter)"
              aria-label={`Guardar inflación de ${monthTitle(row.month)}`}
            />
            <Button size="sm" variant="ghost" icon={Undo2} className="!px-0" onClick={() => setDraft(undefined)} title="Deshacer (Esc)" aria-label="Deshacer el cambio" />
          </>
        ) : row.rate != null ? (
          <Button size="sm" variant="ghost" icon={Trash2} className="!px-0" onClick={onDelete} title="Borrar el dato de este mes" aria-label={`Borrar inflación de ${monthTitle(row.month)}`} />
        ) : null}
      </span>
    </div>
  )
}

export function InflationTab({ period }: { period: Period }) {
  const q = useReport<InflationReport>('/reports/inflation', period)
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [drafts, setDrafts] = useState<Record<string, number | null | undefined>>({})
  const setDraft = (month: string, v: number | null | undefined) => setDrafts((d) => ({ ...d, [month]: v }))

  const save = useApiMutation((v: { month: string; rate: number }) => api.put<{ month: string; rate: number }>(`/inflation/${v.month}`, { rate: v.rate }), {
    success: (r) => `Listo: inflación de ${monthTitle(r.month).toLowerCase()} guardada (${fmtRate(r.rate)}). Los montos ya se recalcularon.`,
    onSuccess: (r) => setDraft(r.month, undefined),
  })
  const remove = useApiMutation((month: string) => api.del(`/inflation/${month}`), {
    success: (_r, month) => `Borramos la inflación de ${monthTitle(month).toLowerCase()}: ese mes cuenta como 0 % hasta que la cargues.`,
  })

  return (
    <ReportGuard q={q}>
      {(d) => {
        const intro = (
          <TabIntro title="Inflación" period={d.period} actions={<ExportButton path="/reports/inflation/export" params={{ from: period.from, to: period.to }} />}>
            Con inflación, comparar pesos de meses distintos engaña: si en marzo vendiste $ 1.000.000 y en abril $ 1.050.000 pero los precios subieron 4 %, en realidad creciste apenas 1 %. Acá
            llevamos las ventas de cada mes a <b>pesos de hoy</b> para que veas si vendés más de verdad <InfoTip term="inflacion" />.
          </TabIntro>
        )
        if (!d.months.length) {
          return (
            <>
              {intro}
              <EmptyState icon={Store} title="No hay meses para mostrar">
                Elegí un período con ventas.
              </EmptyState>
            </>
          )
        }
        const hasSales = d.totals.sales > 0
        const real = realSummary(d)
        const chartRows = d.months.map((m) => ({ label: m.partial ? `${m.label}*` : m.label, nominal: m.sales, hoy: m.sales_today_pesos }))
        const base = d.base_month ? monthTitle(d.base_month).toLowerCase() : 'hoy'
        const isRunning = (month: string) => !!d.months.find((x) => x.month === month)?.partial_note.includes('en curso')
        const missingPast = d.missing_months.filter((m) => !isRunning(m))
        const missingCurrent = d.missing_months.filter((m) => isRunning(m))

        const cols: Column<InflationMonthRow>[] = [
          {
            key: 'month',
            header: 'Mes',
            sortable: false,
            cell: (m) => (
              <span className="block min-w-[92px]">
                <span className="font-bold text-ink">{monthTitle(m.month)}</span>
                {m.partial && <span className="block text-[12px] text-muted">{m.partial_note.includes('en curso') ? 'Mes en curso' : `Solo del ${m.partial_note}`}</span>}
                {d.months[0].month === m.month && d.months.length > 1 && <span className="block text-[12px] text-muted">Base del índice</span>}
              </span>
            ),
          },
          { key: 'sales', header: 'Ventas (pesos de ese mes)', align: 'right', hideBelow: 'md', sortable: false, cell: (m) => money0(m.sales) },
          {
            key: 'rate',
            header: 'Inflación del mes',
            align: 'right',
            sortable: false,
            cell: (m) => (
              <RateEditor
                row={m}
                draft={drafts[m.month]}
                setDraft={(v) => setDraft(m.month, v)}
                saving={save.isPending && save.variables?.month === m.month}
                onSave={(rate) => save.mutate({ month: m.month, rate })}
                onDelete={async () => {
                  const ok = await confirm({
                    title: `¿Borrar la inflación de ${monthTitle(m.month).toLowerCase()}?`,
                    message: `Hoy dice ${fmtRate(m.rate ?? 0)}. Si la borrás, ese mes cuenta como 0 % y los montos en pesos de hoy se recalculan. La podés volver a cargar cuando quieras.`,
                    confirmText: 'Sí, borrarla',
                    danger: true,
                  })
                  if (ok) remove.mutate(m.month)
                }}
              />
            ),
          },
          { key: 'sales_today_pesos', header: `En pesos de ${base}`, align: 'right', hideBelow: 'sm', sortable: false, cell: (m) => <b>{money0(m.sales_today_pesos)}</b> },
          { key: 'nominal', header: 'En pesos', align: 'right', hideBelow: 'lg', sortable: false, cell: (m) => (m.partial ? <InProgress note={m.partial_note} /> : <Growth value={m.nominal_growth_vs_prev} />) },
          { key: 'real', header: 'Real', align: 'right', hideBelow: 'sm', sortable: false, cell: (m) => (m.partial ? <InProgress note={m.partial_note} /> : <Growth value={m.real_growth_vs_prev} />) },
        ]

        return (
          <>
            {intro}
            {!hasSales && (
              <div className="vh-card mb-6">
                <EmptyState
                  compact
                  icon={Store}
                  title="No hay ventas en este período"
                  action={
                    <Button icon={Store} onClick={() => navigate('/ventas?nuevo=1')}>
                      Cargar una venta
                    </Button>
                  }
                >
                  Cuando haya ventas, acá vas a ver si crecieron de verdad o solo subieron los precios. Mientras tanto podés ir cargando la inflación de cada mes en la tabla de abajo: los montos se
                  ajustan solos.
                </EmptyState>
              </div>
            )}
            {hasSales && d.missing_months.length > 0 && (
              <div className="mb-5 flex gap-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[14px] text-ink" role="status">
                <TriangleAlert size={19} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                <div className="min-w-0">
                  {missingPast.length > 0 && (
                    <p>
                      <b>Falta cargar la inflación de {missingPast.length === 1 ? 'un mes' : `${missingPast.length} meses`}:</b> {listMonths(missingPast)}. Mientras tanto los tomamos como 0 %, así que
                      los montos ajustados quedan un poco bajos.
                    </p>
                  )}
                  {missingCurrent.length > 0 && (
                    <p className={missingPast.length ? 'mt-1 text-ink-soft' : undefined}>
                      {missingPast.length ? 'Y el' : 'El'} mes en curso ({monthTitle(missingCurrent[0]).toLowerCase()}) todavía no tiene dato: es normal, el INDEC lo publica a mediados del mes que
                      viene.
                    </p>
                  )}
                </div>
              </div>
            )}

            {hasSales && (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                <StatTile
                  label="Inflación"
                  term="inflacion"
                  tone="orange"
                  value={pct(d.inflation_accum, 1)}
                  hint={`Acumulada de ${d.months[0].label} a ${d.months.at(-1)!.label}, con los datos cargados.`}
                />
                <StatTile label="Ventas" tone="sky" value={<Amount value={d.totals.sales} />} hint="Como se registraron: sumando los pesos de cada mes, tal cual." />
                <StatTile label="Ventas ajustadas" value={<Amount value={d.totals.sales_today_pesos} />} hint={`En pesos de ${base}: cada mes llevado a los precios de ese mes.`} />
                <StatTile
                  label="Crecimiento real"
                  value={
                    real.value == null ? (
                      '—'
                    ) : (
                      <span
                        className={real.value <= -0.005 ? 'text-bad' : real.value >= 0.005 ? 'text-good' : undefined}
                      >{`${real.value > 0 ? '+' : real.value < 0 ? '−' : ''}${pct(Math.abs(real.value), 1)}`}</span>
                    )
                  }
                  hint={real.label}
                />
              </div>
            )}

            <Insights className="mt-5" items={inflationInsights(d)} />

            {hasSales && (
              <ChartCard
                className="mt-6"
                title="Tus ventas, con y sin inflación"
                subtitle={`La línea azul lleva cada mes a pesos de ${base}. Si la azul está plana o baja mientras la otra sube, no creciste: subieron los precios.`}
                legend={
                  <Legend
                    items={[
                      { label: `En pesos de ${base}`, color: CHART_COLORS.ventas },
                      { label: 'Como se registraron', color: CHART_COLORS.extra },
                    ]}
                  />
                }
                table={{
                  columns: [
                    { key: 'label', header: 'Mes' },
                    { key: 'nominal', header: 'Como se registraron', align: 'right', format: (v) => money0(Number(v)) },
                    { key: 'hoy', header: `En pesos de ${base}`, align: 'right', format: (v) => money0(Number(v)) },
                  ],
                  rows: chartRows,
                }}
              >
                <LineTrend
                  data={chartRows}
                  height={250}
                  series={[
                    { key: 'hoy', label: `En pesos de ${base}`, color: CHART_COLORS.ventas },
                    { key: 'nominal', label: 'Como se registraron', color: CHART_COLORS.extra },
                  ]}
                />
                {d.months.some((m) => m.partial) && d.months.length > 1 && <p className="px-2 pt-1 text-[12.5px] text-muted">* Mes incompleto (en curso, o el período toma solo algunos días): por eso da más bajo.</p>}
              </ChartCard>
            )}

            <section className={hasSales ? 'mt-6' : undefined} aria-label="Inflación de cada mes">
              <BlockTitle title="Inflación de cada mes">
                Cargá el % de cada mes (por ejemplo <b className="text-ink">2,7</b>) y tocá <Check size={14} className="inline align-[-2px]" aria-label="guardar" /> o Enter. El dato oficial es el IPC
                del INDEC, que sale a mediados del mes siguiente.
              </BlockTitle>
              <DataTable rows={d.months} columns={cols} rowKey={(m) => m.month} searchable={false} pageSize={60} dense />
              <div className="mt-3 rounded-2xl bg-cream-deep/70 px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft">
                <p className="font-bold text-ink">¿Cómo se calcula?</p>
                <p className="mt-1">{d.explanation.replace(/(\d) %/g, '$1\u00A0%')}</p>
                <p className="mt-1">
                  «En pesos» compara los pesos de cada mes con los del mes anterior, tal cual. «Real» saca la inflación: si vendiste 10 % más en pesos con 10 % de inflación, el real es 0 %.
                </p>
              </div>
            </section>
          </>
        )
      }}
    </ReportGuard>
  )
}
