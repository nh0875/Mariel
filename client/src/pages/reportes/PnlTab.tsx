// Pestaña "Estado de resultados": la cuenta completa de si el negocio gana o pierde, mes a mes.
import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronDown, Receipt, Store } from 'lucide-react'
import { CHART_COLORS } from '@shared/constants'
import { monthKey, today, type Period } from '@shared/dates'
import type { MonthlyPoint } from '@shared/types'
import type { GlossaryKey } from '@/lib/glossary'
import { int, pct } from '@/lib/format'
import { Button, EmptyState, ExportButton, InfoTip, StatTile, Switch } from '@/components/ui'
import { ChartCard, ColumnChart, Legend, ResultChart } from '@/components/charts'
import { LineTrend } from './charts'
import { Amount, BlockTitle, compact, Insights, monthTitle, money0, pesos, plural, ReportGuard, TabIntro, useReport, type Insight } from './parts'
import type { PnlReport } from './types'

type LineKey = 'sales' | 'cogs' | 'gross_profit' | 'gross_margin' | 'fees' | 'shrinkage' | 'expenses_fixed' | 'expenses_variable' | 'net_result' | 'net_margin'

interface Line {
  key: LineKey
  label: string
  term: GlossaryKey
  /** "−" resta, "=" es un subtotal. */
  sign?: '−' | '='
  pct?: boolean
  strong?: boolean
  /** Se pinta en rojo si es negativo. */
  signed?: boolean
  /** Filas de detalle por categoría de gasto. */
  nature?: 'fijo' | 'variable'
}

const LINES: Line[] = [
  { key: 'sales', label: 'Ventas', term: 'ventas', strong: true },
  { key: 'cogs', label: 'Costo de lo vendido', term: 'cmv', sign: '−' },
  {
    key: 'gross_profit',
    label: 'Ganancia bruta',
    term: 'ganancia_bruta',
    sign: '=',
    strong: true,
    signed: true,
  },
  {
    key: 'gross_margin',
    label: 'Margen bruto',
    term: 'margen_bruto',
    pct: true,
    signed: true,
  },
  { key: 'fees', label: 'Comisiones de cobro', term: 'comisiones', sign: '−' },
  {
    key: 'shrinkage',
    label: 'Mermas y degustaciones',
    term: 'mermas',
    sign: '−',
  },
  {
    key: 'expenses_fixed',
    label: 'Gastos fijos',
    term: 'gastos_fijos',
    sign: '−',
    nature: 'fijo',
  },
  {
    key: 'expenses_variable',
    label: 'Gastos variables',
    term: 'gastos_variables',
    sign: '−',
    nature: 'variable',
  },
  {
    key: 'net_result',
    label: 'Resultado',
    term: 'resultado',
    sign: '=',
    strong: true,
    signed: true,
  },
  {
    key: 'net_margin',
    label: 'Margen neto',
    term: 'margen_neto',
    pct: true,
    signed: true,
  },
]

const totalOut = (m: Pick<MonthlyPoint, 'cogs' | 'fees' | 'shrinkage' | 'expenses'>) => m.cogs + m.fees + m.shrinkage + m.expenses

// ───────────────────────── Frases ─────────────────────────

function pnlInsights(d: PnlReport): Insight[] {
  const s = d.total
  const out: Insight[] = []
  if (s.sales > 0) {
    out.push(
      s.net_result >= 0
        ? {
            tone: 'good',
            text: (
              <>
                En el período vendiste <b>{money0(s.sales)}</b> y te quedaron <b>{money0(s.net_result)}</b> limpios: de cada $ 100 que vendiste, ganaste {pesos(Math.round(s.net_margin * 100))}.
              </>
            ),
          }
        : {
            tone: 'bad',
            text: (
              <>
                En el período vendiste <b>{money0(s.sales)}</b> pero perdiste <b>{money0(-s.net_result)}</b>: lo que costó el vino más los gastos superó lo que entró por ventas.
              </>
            ),
          },
    )
    const per = (v: number) => pesos(Math.round((v / s.sales) * 100))
    out.push({
      tone: 'info',
      text: (
        <>
          De cada $ 100 que vendiste, <b>{per(s.cogs)}</b> fueron para pagar el vino, <b>{per(s.expenses_fixed)}</b> para gastos fijos, <b>{per(s.expenses_variable)}</b> para gastos variables y{' '}
          <b>{per(s.fees + s.shrinkage)}</b> se fueron en comisiones y mermas.
        </>
      ),
    })
  }
  const current = d.months.find((m) => m.partial && m.month === monthKey(today()))
  const day = Number(today().slice(8, 10))
  if (current && day <= 10 && current.net_result < 0 && current.expenses_fixed > 0) {
    out.push({
      tone: 'info',
      text: (
        <>
          Tranqui con {monthTitle(current.month).toLowerCase()}: recién empieza, los gastos fijos ({money0(current.expenses_fixed)}) ya están cargados y las ventas recién arrancan. El resultado del
          mes mejora a medida que vendés.
        </>
      ),
    })
  }
  const complete = d.months.filter((m) => !m.partial && (m.sales > 0 || m.expenses > 0))
  if (complete.length >= 2) {
    const best = complete.reduce((a, b) => (b.net_result > a.net_result ? b : a))
    const worst = complete.reduce((a, b) => (b.net_result < a.net_result ? b : a))
    const said = (v: number) => (v >= 0 ? `ganaste ${money0(v)}` : `perdiste ${money0(-v)}`)
    out.push({
      tone: 'info',
      text: (
        <>
          Tu mejor mes fue <b>{monthTitle(best.month)}</b> ({said(best.net_result)}) y el más flojo, <b>{monthTitle(worst.month)}</b> ({said(worst.net_result)}).
        </>
      ),
    })
    const losses = complete.filter((m) => m.net_result < 0)
    out.push(
      losses.length
        ? {
            tone: 'warn',
            text: (
              <>
                Perdiste plata en <b>{plural(losses.length, 'mes', 'meses')}</b> de {complete.length}: {losses.map((m) => m.label).join(', ')}. Mirá en la tabla qué línea se disparó esos meses.
              </>
            ),
          }
        : {
            tone: 'good',
            text: <>Ganaste plata en todos los meses completos del período. ¡Bien ahí!</>,
          },
    )
  }
  const withSales = complete.filter((m) => m.sales > 0)
  if (withSales.length >= 6) {
    const gm = (xs: MonthlyPoint[]) => xs.reduce((a, m) => a + m.gross_profit, 0) / xs.reduce((a, m) => a + m.sales, 0)
    const a = gm(withSales.slice(0, 3))
    const b = gm(withSales.slice(-3))
    const diff = (b - a) * 100
    out.push(
      diff <= -2
        ? {
            tone: 'warn',
            text: (
              <>
                Tu margen bruto bajó de <b>{pct(a)}</b> a <b>{pct(b)}</b> (primeros 3 meses contra los últimos 3). Suele pasar cuando sube el costo del vino y no actualizás los precios: revisá tu
                lista.
              </>
            ),
          }
        : diff >= 2
          ? {
              tone: 'good',
              text: (
                <>
                  Tu margen bruto subió de <b>{pct(a)}</b> a <b>{pct(b)}</b> (primeros 3 meses contra los últimos 3): cada botella te deja más.
                </>
              ),
            }
          : {
              tone: 'info',
              text: (
                <>
                  Tu margen bruto se mantuvo estable, alrededor del <b>{pct(b)}</b>: los precios acompañaron a los costos.
                </>
              ),
            },
    )
  }
  return out
}

// ───────────────────────── Tabla ─────────────────────────

function PnlTable({ d, full, detail }: { d: PnlReport; full: boolean; detail: boolean }) {
  const months = d.months
  const fmt = (v: number) => (full ? money0(v) : compact(v))
  const value = (line: Line, v: number, sales: number) => (line.pct ? (sales > 0 ? pct(v, 1) : '—') : fmt(v))
  const tone = (line: Line, v: number) => (line.signed && v < -0.004 ? 'text-bad' : line.key === 'net_result' && v > 0.004 ? 'text-good' : line.pct ? 'text-ink-soft' : 'text-ink')
  const anyPartial = months.some((m) => m.partial)
  const showTotal = months.length > 1
  // Arranca mostrando los meses más recientes (a la derecha); se desliza para ver los anteriores.
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = useState(false)
  // Sombra en el borde de las columnas fijas cuando hay meses "escondidos" debajo: así se entiende
  // que la tabla se desliza (y no que los números están cortados).
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = () => {
    const el = scroller.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdges((e) => {
      const next = { left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 }
      return next.left === e.left && next.right === e.right ? e : next
    })
  }
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
    setScrollable(el.scrollWidth > el.clientWidth + 4)
    measure()
  }, [months.length, full, detail])
  const leftShadow = edges.left && 'shadow-[7px_0_8px_-6px_rgba(59,36,20,0.22)]'
  const rightShadow = edges.right && 'sm:shadow-[-7px_0_8px_-6px_rgba(59,36,20,0.22)]'
  const totalTh = clsx('border-l border-line bg-cream-deep sm:sticky sm:right-0 sm:z-[2]', rightShadow)
  const totalTd = clsx('border-l border-line bg-cream-deep sm:sticky sm:right-0 sm:z-[1]', rightShadow)

  // Con pocos meses la tabla no se estira a todo el ancho (si no, el número queda lejísimo de su concepto).
  const narrow = months.length <= 4

  return (
    <>
      <div ref={scroller} onScroll={measure} className={clsx('vh-scroll vh-pnl-scroll overflow-x-auto rounded-2xl border border-line bg-paper', narrow && 'w-fit max-w-full')}>
        <table className="vh-pnl w-full border-separate border-spacing-0 text-[13px] sm:text-[14px]">
          <caption className="sr-only">Estado de resultados mes a mes</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className={clsx(
                  'sticky left-0 z-[2] border-b border-line bg-cream px-2.5 py-2.5 text-left text-[12px] sm:px-3.5 sm:text-[12.5px] font-extrabold tracking-wide text-ink-soft uppercase',
                  leftShadow,
                )}
              >
                Concepto
              </th>
              {months.map((m) => (
                <th
                  key={m.month}
                  scope="col"
                  className={clsx(
                    'border-b border-line bg-cream px-2 py-2.5 text-right text-[12px] font-extrabold tracking-wide whitespace-nowrap text-ink-soft uppercase sm:px-2.5 sm:text-[12.5px]',
                    narrow && 'sm:min-w-[8.5rem]',
                  )}
                >
                  {m.label}
                  {m.partial && (
                    <span className="block text-[11px] font-bold tracking-normal text-muted normal-case" title="Mes incompleto: no es un mes entero">
                      {m.partial_note}
                    </span>
                  )}
                </th>
              ))}
              {showTotal && (
                <th scope="col" className={clsx(totalTh, 'border-b px-3.5 py-2.5 text-right text-[12.5px] font-extrabold tracking-wide whitespace-nowrap text-ink uppercase')}>
                  Total
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {LINES.map((line) => {
              const rowBg = line.strong ? 'bg-cream' : 'bg-paper'
              const border = line.key === 'net_result' ? 'border-t-2 border-line-strong' : 'border-t border-line/70'
              const cats = line.nature && detail ? d.expenses_by_category.filter((c) => c.nature === line.nature) : []
              return (
                <Fragment key={line.key}>
                  <tr>
                    <th
                      scope="row"
                      className={clsx(
                        'sticky left-0 z-[1] min-w-[132px] px-2.5 py-2.5 text-left align-middle sm:min-w-[215px] sm:px-3',
                        rowBg,
                        border,
                        leftShadow,
                        line.strong ? 'font-extrabold text-ink' : line.pct ? 'font-semibold text-ink-soft italic' : 'font-semibold text-ink',
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5 sm:whitespace-nowrap">
                        {line.sign && (
                          <span className="w-3 shrink-0 text-center text-muted" aria-hidden>
                            {line.sign}
                          </span>
                        )}
                        {!line.sign && !line.pct && <span className="w-3 shrink-0" aria-hidden />}
                        {line.pct && <span className="w-3 shrink-0" aria-hidden />}
                        <span>{line.label}</span>
                        <InfoTip term={line.term} />
                      </span>
                    </th>
                    {months.map((m) => (
                      <td
                        key={m.month}
                        className={clsx('vh-num px-2 py-2.5 text-right whitespace-nowrap sm:px-2.5', rowBg, border, line.strong && 'font-extrabold', tone(line, m[line.key]))}
                        title={line.pct ? undefined : money0(m[line.key])}
                      >
                        {value(line, m[line.key], m.sales)}
                      </td>
                    ))}
                    {showTotal && (
                      <td
                        className={clsx(totalTd, 'vh-num px-3.5 py-2.5 text-right font-extrabold whitespace-nowrap', border, tone(line, d.total[line.key]))}
                        title={line.pct ? undefined : money0(d.total[line.key])}
                      >
                        {value(line, d.total[line.key], d.total.sales)}
                      </td>
                    )}
                  </tr>
                  {cats.map((c) => (
                    <tr key={`${line.key}-${c.category}`}>
                      <th scope="row" className={clsx('sticky left-0 z-[1] border-t border-line/40 bg-paper py-1.5 pr-3 pl-10 text-left text-[13px] font-normal text-ink-soft', leftShadow)}>
                        {c.category}
                      </th>
                      {months.map((m) => (
                        <td key={m.month} className="vh-num border-t border-line/40 bg-paper px-2.5 py-1.5 text-right text-[13px] whitespace-nowrap text-ink-soft">
                          {c.months[m.month] ? fmt(c.months[m.month]) : '—'}
                        </td>
                      ))}
                      {showTotal && <td className={clsx(totalTd, 'vh-num border-t border-t-line/40 px-3.5 py-1.5 text-right text-[13px] whitespace-nowrap text-ink-soft')}>{fmt(c.total)}</td>}
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12.5px] text-muted">
        {full ? 'Montos en pesos, sin centavos.' : 'Montos abreviados ("mil" = miles, "M" = millones).'}
        {!full && <span className="print:hidden"> Prendé «Montos completos» para verlos enteros.</span>} Los que te restan van sin signo en su columna.
        {scrollable && <span className="print:hidden"> Deslizá la tabla hacia los costados para ver los demás meses (arranca en los más recientes).</span>}
        {anyPartial &&
          ' Los meses con una aclaración debajo están incompletos: «en curso» todavía no terminó (sus números van a seguir cambiando) y «15 al 28», por ejemplo, es que el período toma solo esos días. No los compares con un mes entero.'}
      </p>
    </>
  )
}

// ───────────────────────── Pestaña ─────────────────────────

export function PnlTab({ period }: { period: Period }) {
  const q = useReport<PnlReport>('/reports/pnl', period)
  const navigate = useNavigate()
  const [fullPref, setFull] = useState<boolean | null>(null)
  const [detail, setDetail] = useState(false)

  return (
    <ReportGuard q={q}>
      {(d) => {
        const s = d.total
        // Con pocos meses entran los montos completos; con muchos, abreviados (se puede cambiar).
        const full = fullPref ?? d.months.length <= 4
        const intro = (
          <TabIntro title="Estado de resultados" period={d.period} actions={<ExportButton path="/reports/pnl/export" params={{ from: period.from, to: period.to }} />}>
            Es la cuenta que haría tu contador para saber si el negocio <b>gana o pierde plata</b>: arranca en lo que vendiste y le va restando, en orden, lo que te costó el vino, las comisiones, las
            mermas y los gastos. Lo que queda abajo es tu <b>resultado</b>. Cuenta lo vendido y lo gastado en cada mes, aunque lo cobres o pagues después; por eso no coincide con la caja.
          </TabIntro>
        )
        const empty = s.sales === 0 && s.expenses === 0 && s.cogs === 0 && s.shrinkage === 0
        if (empty) {
          return (
            <>
              {intro}
              <EmptyState
                icon={Store}
                title="Todavía no hay números en este período"
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button icon={Store} onClick={() => navigate('/ventas?nuevo=1')}>
                      Cargar una venta
                    </Button>
                    <Button icon={Receipt} variant="ghost" onClick={() => navigate('/gastos?nuevo=1')}>
                      Cargar un gasto
                    </Button>
                  </div>
                }
              >
                Cuando cargues ventas y gastos, acá vas a ver mes a mes cuánto ganaste y por qué. Si ya cargaste cosas, probá con otro período (por ejemplo, «Desde siempre»).
              </EmptyState>
            </>
          )
        }
        const rows = d.months.map((m) => ({
          label: m.partial ? `${m.label}*` : m.label,
          resultado: m.net_result,
          ventas: m.sales,
          salio: Math.round(totalOut(m)),
          margen_bruto: m.sales > 0 ? m.gross_margin : null,
          margen_neto: m.sales > 0 ? m.net_margin : null,
        }))
        const moneyFmt = (v: unknown) => money0(Number(v))
        const pctFmt = (v: unknown) => (v == null ? '—' : pct(Number(v)))
        return (
          <>
            {intro}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              <StatTile
                label="Ventas"
                term="ventas"
                tone="sky"
                value={<Amount value={s.sales} />}
                hint={`${plural(s.sales_count, 'venta', 'ventas')} · ${plural(s.bottles_sold, 'botella', 'botellas')}`}
              />
              <StatTile
                label="Ganancia bruta"
                term="ganancia_bruta"
                tone="mustard"
                value={<Amount value={s.gross_profit} className={s.gross_profit < 0 ? 'text-bad' : undefined} />}
                hint={s.sales > 0 ? `Margen bruto ${pct(s.gross_margin)}: de cada $ 100, quedan ${pesos(Math.round(s.gross_margin * 100))} después del vino.` : 'Se calcula cuando hay ventas.'}
              />
              <StatTile label="Gastos" term="gastos" tone="coral" value={<Amount value={s.expenses} />} hint={`Fijos ${compact(s.expenses_fixed)} · variables ${compact(s.expenses_variable)}`} />
              <StatTile
                label="Resultado"
                term="resultado"
                value={<Amount value={s.net_result} className={s.net_result < -0.004 ? 'text-bad' : s.net_result > 0.004 ? 'text-good' : undefined} />}
                hint={s.sales > 0 ? `Margen neto ${pct(s.net_margin)}. ${s.net_result >= 0 ? 'Ganaste plata.' : 'Perdiste plata.'}` : s.net_result < 0 ? 'Hubo gastos sin ventas.' : undefined}
              />
            </div>

            <Insights className="mt-5" items={pnlInsights(d)} />

            <section className="mt-6" aria-label="Estado de resultados mes a mes">
              <BlockTitle
                title="Mes a mes"
                right={
                  <div className="vh-no-print flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Switch checked={full} onChange={setFull} label="Montos completos" />
                    <Button size="sm" variant="ghost" iconRight={ChevronDown} onClick={() => setDetail((x) => !x)} aria-expanded={detail} className={detail ? '[&>svg]:rotate-180' : undefined}>
                      {detail ? 'Ocultar gastos por categoría' : 'Ver gastos por categoría'}
                    </Button>
                  </div>
                }
              >
                Leelo de arriba hacia abajo: cada línea con «−» se resta y las que tienen «=» son el subtotal hasta ahí.
              </BlockTitle>
              <PnlTable d={d} full={full} detail={detail} />
            </section>

            {d.months.length < 2 ? (
              <p className="mt-6 rounded-2xl bg-cream-deep/70 px-4 py-3 text-[14px] text-ink-soft">
                Los gráficos de evolución aparecen cuando el período tiene más de un mes. Probá con <b className="text-ink">Últimos 12 meses</b> para ver cómo vienen tus resultados y tus márgenes.
              </p>
            ) : (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <ChartCard
                  title="Resultado de cada mes"
                  subtitle="Verde: ese mes ganaste plata. Coral: perdiste."
                  term="resultado"
                  table={{
                    columns: [
                      { key: 'label', header: 'Mes' },
                      {
                        key: 'resultado',
                        header: 'Resultado',
                        align: 'right',
                        format: moneyFmt,
                      },
                    ],
                    rows,
                  }}
                >
                  <ResultChart data={rows} valueKey="resultado" />
                </ChartCard>
                <ChartCard
                  title="Ventas vs. todo lo que salió"
                  subtitle="Si la barra coral supera a la azul, ese mes perdiste plata."
                  legend={
                    <Legend
                      items={[
                        { label: 'Ventas', color: CHART_COLORS.ventas },
                        {
                          label: 'Todo lo que salió (vino vendido + comisiones + mermas + gastos)',
                          color: CHART_COLORS.gastos,
                        },
                      ]}
                    />
                  }
                  table={{
                    columns: [
                      { key: 'label', header: 'Mes' },
                      {
                        key: 'ventas',
                        header: 'Ventas',
                        align: 'right',
                        format: moneyFmt,
                      },
                      {
                        key: 'salio',
                        header: 'Todo lo que salió',
                        align: 'right',
                        format: moneyFmt,
                      },
                    ],
                    rows,
                  }}
                >
                  <ColumnChart
                    data={rows}
                    height={240}
                    series={[
                      {
                        key: 'ventas',
                        label: 'Ventas',
                        color: CHART_COLORS.ventas,
                      },
                      {
                        key: 'salio',
                        label: 'Todo lo que salió',
                        color: CHART_COLORS.gastos,
                      },
                    ]}
                  />
                </ChartCard>
                <ChartCard
                  className="lg:col-span-2"
                  title="¿Cómo vienen tus márgenes?"
                  subtitle="Margen bruto: lo que queda de cada $ 100 después de pagar el vino. Margen neto: lo que queda después de todo. Si el bruto baja mes a mes, revisá precios."
                  legend={
                    <Legend
                      items={[
                        { label: 'Margen bruto', color: CHART_COLORS.ganancia },
                        { label: 'Margen neto', color: CHART_COLORS.extra },
                      ]}
                    />
                  }
                  table={{
                    columns: [
                      { key: 'label', header: 'Mes' },
                      {
                        key: 'margen_bruto',
                        header: 'Margen bruto',
                        align: 'right',
                        format: pctFmt,
                      },
                      {
                        key: 'margen_neto',
                        header: 'Margen neto',
                        align: 'right',
                        format: pctFmt,
                      },
                    ],
                    rows,
                  }}
                >
                  <LineTrend
                    data={rows}
                    height={230}
                    format="percent"
                    zeroLine
                    series={[
                      {
                        key: 'margen_bruto',
                        label: 'Margen bruto',
                        color: CHART_COLORS.ganancia,
                      },
                      {
                        key: 'margen_neto',
                        label: 'Margen neto',
                        color: CHART_COLORS.extra,
                      },
                    ]}
                  />
                </ChartCard>
              </div>
            )}
            <p className="mt-3 text-[12.5px] text-muted">
              {int(d.months.length)} {d.months.length === 1 ? 'mes' : 'meses'}
              {d.months.length > 1 && d.months.some((m) => m.partial) && ` (* mes incompleto: ${d.months.filter((m) => m.partial).map((m) => `${m.label}, ${m.partial_note}`).join('; ')}. Es normal que dé más bajo)`} · Comprar vino no es gasto: se vuelve costo recién
              cuando vendés la botella. Por eso las compras no aparecen acá.
            </p>
          </>
        )
      }}
    </ReportGuard>
  )
}
