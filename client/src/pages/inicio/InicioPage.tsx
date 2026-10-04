// Inicio — "¿Cómo venimos?": lo primero que ve el dueño cada día.
// Arriba: qué querés hacer (atajos). Después: cómo te fue en el período (resultado explicado),
// lo que conviene mirar (alertas y frases), la meta del mes, tu plata hoy y los gráficos.
// Todos los números vienen de GET /api/dashboard, que usa el mismo motor que Reportes y Metas.
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { CHART_COLORS } from '@shared/constants'
import { pctChange, safeDiv } from '@shared/calc'
import { monthLabelLong, today } from '@shared/dates'
import { useApi, useSettings } from '@/lib/queries'
import { usePeriod } from '@/lib/period'
import { dateLong, int, pct } from '@/lib/format'
import { compact, money0, per100Map } from './fmt'
import { ErrorState, ExportButton, HelpBox, InfoTip, Loading, Money, PageHeader, PeriodPicker, StatTile } from '@/components/ui'
import { ChartCard, ColumnChart, DonutChart, Legend, RankBars, ResultChart } from '@/components/charts'
import { ResultWaterfall } from './ResultWaterfall'
import { GoalCard } from './GoalCard'
import { AlertsPanel, Amount, FirstSteps, InsightsCard, QuickTasks, SectionTitle, TextWithTip } from './parts'
import type { DashboardResponse } from './types'

const capitalize = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
/** "vs. mismos días del mes pasado" → "con los mismos días del mes pasado"; "vs. mes anterior" → "con el mes anterior". */
const compareWith = (label: string) => {
  const rest = label.replace(/^vs\. /, '')
  return `${rest.startsWith('mismos') ? 'con los' : 'con el'} ${rest}`
}

// ───────────────────────── "De cada $100" ─────────────────────────

/** Barra de 100: de cada $100 que vendiste, cuánto se llevó el vino, las comisiones, los gastos y cuánto te quedó. */
function Per100Bar({ d }: { d: DashboardResponse }) {
  const s = d.summary
  if (s.sales <= 0) return null
  const costs = s.cogs + s.fees + s.shrinkage + s.expenses
  const total = Math.max(s.sales, costs)
  // Los "$ X de cada $ 100" salen del mismo reparto que la frase de arriba y que «Así se armó tu resultado»: siempre cierran.
  const p = per100Map(s)!
  const segs = [
    { label: 'El vino', value: s.cogs, p100: p.cogs, color: CHART_COLORS.costo },
    { label: 'Comisiones y mermas', value: s.fees + s.shrinkage, p100: p.fees + p.shrinkage, color: CHART_COLORS.extra },
    { label: 'Gastos', value: s.expenses, p100: p.fixed + p.variable, color: CHART_COLORS.gastos },
    ...(s.net_result > 0 ? [{ label: 'Te quedó', value: s.net_result, p100: p.net, color: CHART_COLORS.ganancia }] : []),
  ].filter((x) => x.value > 0)
  return (
    <div className="mt-4 rounded-xl bg-cream/80 p-3.5">
      <p className="mb-2 text-[13px] font-bold text-ink">De cada $ 100 que vendiste…</p>
      <div className="relative">
        <div className="flex h-3.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={segs.map((x) => `${x.label}: $ ${x.p100}`).join(', ')}>
          {segs.map((x) => (
            <span key={x.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(x.value / total) * 100}%`, background: x.color }} title={`${x.label}: ${money0(x.value)}`} />
          ))}
        </div>
        {costs > s.sales && (
          <span className="absolute -top-1.5 -bottom-1.5 w-[3px] -translate-x-1/2 rounded-full bg-ink" style={{ left: `${(s.sales / total) * 100}%` }} aria-hidden />
        )}
      </div>
      <ul className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-1 text-[12.5px] text-ink-soft min-[420px]:grid-cols-2">
        {segs.map((x) => (
          <li key={x.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} aria-hidden />
            <span className="min-w-0 truncate">{x.label}</span>
            <b className="vh-num ml-auto text-ink">$&nbsp;{x.p100}</b>
          </li>
        ))}
      </ul>
      {costs > s.sales && (
        <p className="mt-2 text-[12.5px] text-ink-soft">
          La rayita negra es hasta donde llegó lo que vendiste: los costos se pasaron por <b className="text-bad">{money0(costs - s.sales)}</b>.
        </p>
      )}
    </div>
  )
}

// ───────────────────────── Números del período ─────────────────────────

function PointsDelta({ cur, prev, label }: { cur: number; prev: number; label: string }) {
  const diff = (cur - prev) * 100
  if (!Number.isFinite(diff)) return null
  const flat = Math.abs(diff) < 0.05
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={flat ? 'rounded-full bg-cream-deep px-1.5 py-0.5 font-extrabold text-ink-soft' : diff > 0 ? 'rounded-full bg-good-soft px-1.5 py-0.5 font-extrabold text-good' : 'rounded-full bg-bad-soft px-1.5 py-0.5 font-extrabold text-bad'}>
        {flat ? '=' : diff > 0 ? '+' : '−'}
        {new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Math.abs(diff))} pts
      </span>
      <span className="text-muted">{label}</span>
    </span>
  )
}

function PeriodNumbers({ d }: { d: DashboardResponse }) {
  const s = d.summary
  const c = d.comparison
  const net = s.net_result
  const prevNet = c.previous.net_result
  // Si el período anterior está cargado a medias, no mostramos variaciones (engañarían: "+900 %").
  const cmp = (v: number | null) => (c.partial ? null : v)
  // Lo cargado con fecha posterior a hoy suma en el número grande, pero la flecha compara solo hasta hoy.
  const after = c.after_today
  const afterExp = !c.partial && after && after.expenses > 0.5 ? after.expenses : 0
  const afterSales = !c.partial && after && after.sales > 0.5 ? after.sales : 0
  // Principio del mes en curso: los gastos fijos ya están y las ventas recién empiezan.
  const earlyMonth = c.mode === 'same_days' && d.period.from.slice(0, 7) === d.today.slice(0, 7) && Number(d.today.slice(8, 10)) <= 10 && s.expenses_fixed > 0
  // La variación % del resultado solo tiene sentido si los dos son del mismo signo.
  const netDelta = cmp(Math.sign(c.current.net_result) === Math.sign(prevNet) && prevNet !== 0 ? pctChange(c.current.net_result, prevNet) : null)
  const p100 = per100Map(s)
  const sentence =
    s.sales <= 0 || !p100
      ? net < 0
        ? `Todavía no hay ventas en este período y ya hay ${money0(s.expenses + s.fees + s.shrinkage)} de gastos.`
        : 'Todavía no hay ventas en este período.'
      : net >= 0
        ? `Ganaste ${money0(net)}: de cada $ 100 que vendiste te quedaron $ ${p100.net} limpios.`
        : `Perdiste ${money0(-net)}: por cada $ 100 que vendiste se fueron $ ${100 + p100.net} entre el vino y los gastos.`
  const uptoNote = (what: string, value: number, amount: number) => (
    <span className="mt-1 block">
      Incluye {money0(amount)} de {what} con fecha más adelante (ya cargados). La flecha compara solo hasta hoy: {money0(value)}.
    </span>
  )
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatTile
        hero
        className="col-span-2 xl:row-span-2"
        label="Resultado del período"
        term="resultado"
        value={<Money decimals={0} value={net} tone="auto" />}
        delta={netDelta}
        deltaLabel={c.label}
        hint={
          <>
            <p className="text-[14.5px] leading-snug text-ink">{sentence}</p>
            {earlyMonth && net < 0 && (
              <p className="mt-1.5 text-[13px] leading-snug text-ink-soft">
                Tranqui: es principio de mes, ya se cargaron los gastos fijos ({money0(s.expenses_fixed)}) y las ventas recién arrancan. El resultado mejora a medida que vendés.
              </p>
            )}
            {(afterExp > 0 || afterSales > 0) && (
              <p className="mt-1.5 text-[13px] leading-snug text-ink-soft">
                La flecha compara solo lo que va hasta hoy (<Money decimals={0} value={c.current.net_result} tone="auto" className="font-bold" />), porque hay
                {afterExp > 0 ? ` ${money0(afterExp)} de gastos` : ''}
                {afterExp > 0 && afterSales > 0 ? ' y' : ''}
                {afterSales > 0 ? ` ${money0(afterSales)} de ventas` : ''} cargados con fecha más adelante.
              </p>
            )}
            {!c.partial && netDelta == null && (c.current.sales > 0 || c.previous.sales > 0) && (
              <p className="mt-1">
                {capitalize(c.label.replace(/^vs\. /, ''))}:{' '}
                <Money decimals={0} value={prevNet} tone="auto" className="font-bold" />
              </p>
            )}
            <Per100Bar d={d} />
          </>
        }
      />
      <StatTile
        label="Ventas"
        term="ventas"
        value={<Amount value={s.sales} />}
        delta={cmp(pctChange(c.current.sales, c.previous.sales))}
        deltaLabel={c.label}
        hint={
          <>
            {`${int(s.sales_count)} ${s.sales_count === 1 ? 'venta' : 'ventas'} · ${int(s.bottles_sold)} ${s.bottles_sold === 1 ? 'botella' : 'botellas'}`}
            {afterSales > 0 && uptoNote('ventas', c.current.sales, afterSales)}
          </>
        }
      />
      <StatTile
        label="Gastos"
        term="gastos"
        value={<Amount value={s.expenses} />}
        delta={cmp(pctChange(c.current.expenses, c.previous.expenses))}
        upIsGood={false}
        deltaLabel={c.label}
        hint={
          <>
            {`Fijos ${compact(s.expenses_fixed)} · variables ${compact(s.expenses_variable)}`}
            {afterExp > 0 && uptoNote('gastos', c.current.expenses, afterExp)}
          </>
        }
      />
      <StatTile
        label="Margen bruto"
        term="margen_bruto"
        value={s.sales > 0 ? pct(s.gross_margin) : '—'}
        hint={
          s.sales > 0 ? (
            <>
              {!c.partial && c.current.sales > 0 && c.previous.sales > 0 && <PointsDelta cur={c.current.gross_margin} prev={c.previous.gross_margin} label={c.label} />}
              <span className="mt-1 block">De cada $&nbsp;100, quedan $&nbsp;{Math.round(s.gross_margin * 100)} después de pagar el vino.</span>
            </>
          ) : (
            'Se calcula cuando hay ventas.'
          )
        }
      />
      <StatTile
        label="Ticket promedio"
        term="ticket_promedio"
        value={s.sales_count > 0 ? <Amount value={s.avg_ticket} /> : '—'}
        delta={cmp(c.current.sales_count > 0 && c.previous.sales_count > 0 ? pctChange(c.current.avg_ticket, c.previous.avg_ticket) : null)}
        deltaLabel={c.label}
        hint={s.sales_count > 0 ? `Cada cliente gasta en promedio ${money0(s.avg_ticket)} por compra.` : 'Ventas ÷ cantidad de ventas.'}
      />
    </div>
  )
}

// ───────────────────────── Tu plata hoy ─────────────────────────

function MoneyToday({ d }: { d: DashboardResponse }) {
  const accounts = d.cash.accounts.filter((a) => a.active)
  return (
    <section aria-labelledby="plata-hoy">
      <SectionTitle
        title={<span id="plata-hoy">Tu plata hoy</span>}
        right={
          <Link to="/caja" className="inline-flex items-center gap-1 text-[13.5px] font-bold text-sky-deep hover:underline">
            Ver caja y bancos <ArrowRight size={14} aria-hidden />
          </Link>
        }
      >
        <TextWithTip
          text={`Una foto de hoy (${dateLong(d.today).replace(/ de \d{4}$/, '')}), sin importar el período elegido. ¿Por qué no coincide con el resultado?`}
          tip={<InfoTip term="devengado_percibido" />}
        />
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          label="Plata disponible"
          term="caja"
          tone="sky"
          value={<Amount value={d.cash.total} className={d.cash.total < 0 ? 'text-bad' : undefined} />}
          hint={
            <>
              {accounts.length ? accounts.map((a) => `${a.name.replace(/\s*\(.*\)$/, '')} ${compact(a.balance)}`).join(' · ') : 'Todavía no hay cuentas.'}
              {d.cash.scheduled.out > 0.5 && (
                <span className="mt-1 block">
                  Todavía no descuenta {money0(d.cash.scheduled.out)} de pagos cargados con fecha más adelante (por ejemplo, gastos fijos marcados como pagados): salen de la
                  cuenta el día de su fecha.
                </span>
              )}
            </>
          }
        />
        <StatTile
          label="Te deben"
          term="por_cobrar"
          tone="sky"
          value={<Amount value={d.receivables.total} />}
          hint={
            d.receivables.overdue > 0 ? (
              <span className="font-bold text-bad">
                <Amount value={d.receivables.overdue} /> ya vencido
              </span>
            ) : d.receivables.count ? (
              `${d.receivables.count} ${d.receivables.count === 1 ? 'venta' : 'ventas'} sin cobrar, nada vencido`
            ) : (
              'No te debe nadie.'
            )
          }
        />
        <StatTile
          label="Debés"
          term="por_pagar"
          tone="coral"
          value={<Amount value={d.payables.total} />}
          hint={
            d.payables.overdue > 0 ? (
              <span className="font-bold text-bad">
                <Amount value={d.payables.overdue} /> ya vencido
              </span>
            ) : d.payables.count ? (
              `${d.payables.count} ${d.payables.count === 1 ? 'cuenta' : 'cuentas'} por pagar, nada vencido`
            ) : (
              'No debés nada.'
            )
          }
        />
        <StatTile
          label="Stock a costo"
          term="stock_valorizado"
          tone="mustard"
          value={<Amount value={d.stock.value} />}
          hint={`${int(d.stock.bottles)} botellas de ${d.stock.products} ${d.stock.products === 1 ? 'vino' : 'vinos'}: lo que tenés invertido en vino.`}
        />
      </div>
    </section>
  )
}

// ───────────────────────── Gráficos ─────────────────────────

function Charts({ d }: { d: DashboardResponse }) {
  const months = d.series.map((m) => ({
    label: m.label,
    ventas: m.sales,
    costos: Math.round((m.cogs + m.fees + m.shrinkage + m.expenses) * 100) / 100,
    resultado: m.net_result,
  }))
  const last = d.series[d.series.length - 1]
  const lastIsCurrent = last && last.month === d.today.slice(0, 7)
  const lastName = last ? capitalize(monthLabelLong(last.month).split(' ')[0]) : ''
  const yearSales = d.series.reduce((a, m) => a + m.sales, 0)
  const yearNet = d.series.reduce((a, m) => a + m.net_result, 0)
  const channelTotal = d.by_channel.reduce((a, c) => a + c.sales, 0)
  const moneyFmt = (v: unknown) => money0(Number(v))
  return (
    <div className="space-y-4 sm:space-y-5">
      <ChartCard
        title="Ventas, gastos y resultado — últimos 12 meses"
        term="resultado"
        subtitle={
          <>
            En 12 meses vendiste <b className="text-ink">{money0(yearSales)}</b> y {yearNet >= 0 ? 'ganaste' : 'perdiste'}{' '}
            <b className={yearNet >= 0 ? 'text-good' : 'text-bad'}>{money0(Math.abs(yearNet))}</b>.{lastIsCurrent ? ` ${lastName} todavía no terminó: su barra es parcial.` : ''}
          </>
        }
        legend={
          <Legend
            items={[
              { label: 'Ventas', color: CHART_COLORS.ventas },
              { label: 'Lo que costó (vino vendido + gastos)', color: CHART_COLORS.gastos },
            ]}
          />
        }
        table={{
          columns: [
            { key: 'label', header: 'Mes' },
            { key: 'sales', header: 'Ventas', align: 'right', format: moneyFmt },
            { key: 'cogs', header: 'Costo del vino', align: 'right', format: moneyFmt },
            { key: 'other', header: 'Gastos, comisiones y mermas', align: 'right', format: moneyFmt },
            { key: 'net_result', header: 'Resultado', align: 'right', format: (v) => <Money decimals={0} value={Number(v)} tone="auto" /> },
            { key: 'gross_margin', header: 'Margen bruto', align: 'right', format: (v) => pct(Number(v)) },
          ],
          rows: d.series.map((m) => ({ ...m, other: m.fees + m.shrinkage + m.expenses })),
        }}
      >
        <ColumnChart
          data={months}
          height={240}
          series={[
            { key: 'ventas', label: 'Ventas', color: CHART_COLORS.ventas },
            { key: 'costos', label: 'Lo que costó', color: CHART_COLORS.gastos },
          ]}
        />
        <p className="mt-4 mb-1 px-1 text-[13.5px] font-bold text-ink">
          La diferencia: resultado de cada mes <span className="font-normal text-muted">(verde azulado si ganaste, coral si perdiste)</span>
        </p>
        <ResultChart data={months} valueKey="resultado" height={150} />
      </ChartCard>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <ChartCard
          title="¿De dónde vienen las ventas?"
          subtitle={`Ventas por canal ${d.period_phrase}.`}
          table={{
            columns: [
              { key: 'label', header: 'Canal' },
              { key: 'sales', header: 'Ventas', align: 'right', format: moneyFmt },
              { key: 'share', header: '% del total', align: 'right', format: (v) => pct(Number(v), 0) },
              { key: 'count', header: 'Cantidad', align: 'right' },
              { key: 'profit', header: 'Lo que te dejó', align: 'right', format: moneyFmt },
            ],
            rows: d.by_channel.map((c) => ({ ...c, share: safeDiv(c.sales, channelTotal) })),
          }}
        >
          <DonutChart data={d.by_channel.map((c) => ({ label: c.label, value: c.sales }))} />
          {d.by_channel.length > 0 && (
            <p className="mt-3 px-1 text-[13px] text-ink-soft">
              «Lo que te dejó» cada canal (ventas − vino − comisiones) está en <b>Ver tabla</b>. Un canal puede vender mucho y dejar poco.
            </p>
          )}
        </ChartCard>
        <ChartCard
          title="Tus vinos estrella"
          subtitle={`Los que más facturaron ${d.period_phrase}.`}
          table={{
            columns: [
              { key: 'name', header: 'Vino' },
              { key: 'bottles', header: 'Botellas', align: 'right' },
              { key: 'revenue', header: 'Facturado', align: 'right', format: moneyFmt },
              { key: 'profit', header: 'Ganancia bruta', align: 'right', format: moneyFmt },
              { key: 'margin', header: 'Margen', align: 'right', format: (v) => pct(Number(v)) },
            ],
            rows: d.top_products as unknown as Record<string, unknown>[],
          }}
          actions={
            <Link to="/reportes" className="hidden text-[12.5px] font-bold text-sky-deep hover:underline sm:inline">
              Todos los vinos →
            </Link>
          }
        >
          <div className="px-1 pt-1">
            <RankBars
              max={6}
              color={CHART_COLORS.ventas}
              emptyText="Todavía no hay ventas de vinos en este período."
              items={d.top_products.map((p) => ({ label: p.name, value: p.revenue, sublabel: `${int(p.bottles)} bot.` }))}
            />
          </div>
        </ChartCard>
      </div>
    </div>
  )
}

// ───────────────────────── Pantalla ─────────────────────────

/** "Cómo te fue en octubre 2026", "Cómo te fue en el año 2026", "Cómo te fue del 1 de agosto al 31 de octubre". */
const cuantoTeFueTitle = (phrase: string) => `Cómo te fue ${phrase}`

export default function InicioPage() {
  const { period } = usePeriod()
  const settings = useSettings()
  const q = useApi<DashboardResponse>('/dashboard', { from: period.from, to: period.to }, { placeholderData: keepPreviousData })
  const d = q.data
  const owner = settings.data?.business.owner?.trim()
  const biz = settings.data?.business.name?.trim() || 'VINOH!'

  useEffect(() => {
    document.title = 'Inicio · VINOH! Finanzas'
  }, [owner])

  const empty = d && d.setup.sales === 0
  // La meta que se muestra la elige el servidor: la del mes en que termina el período, la del mes actual si sigue, o la del primero si es futuro.
  const goalMonth = d?.goal_month ?? ''

  return (
    <>
      <PageHeader
        title={owner ? `¡Hola, ${owner}!` : '¿Cómo venimos?'}
        description={
          <>
            Así viene <b className="text-ink">{biz}</b> — hoy es {dateLong(today())}.
          </>
        }
        actions={
          <>
            <PeriodPicker />
            {!empty && <ExportButton path="/dashboard/export" params={{ from: period.from, to: period.to }} label="Descargar resumen" />}
          </>
        }
      />

      <HelpBox id="inicio" className="mb-6">
        <p>
          Esta es la pantalla para <b>saber cómo viene el negocio en un minuto</b>: cuánto ganaste, en qué se fue la plata, qué hay que cobrar o pagar y qué vinos se están por
          acabar. Elegí el período arriba a la derecha (por defecto, este mes).
        </p>
        <ul>
          <li>
            <b>El número más importante es el Resultado.</b> Si vendiste $&nbsp;1.000.000, el vino te costó $&nbsp;600.000 y los gastos fueron $&nbsp;300.000, ganaste $&nbsp;100.000: de cada $&nbsp;100
            que vendiste te quedaron $&nbsp;10. Abajo, en «Así se armó tu resultado», lo ves paso a paso.
          </li>
          <li>
            <b>Comparamos parejo.</b> Si hoy es 4 de octubre, comparamos del 1 al 4 de octubre con del 1 al 4 de septiembre (no contra el mes entero), así no parece que todo se
            vino abajo.
          </li>
          <li>
            <b>Resultado no es lo mismo que caja.</b> Una venta a cuenta suma al resultado hoy, pero a la caja recién cuando te pagan; comprar vino baja la caja pero no es gasto
            (es stock). Por eso mirá las dos cosas: el resultado dice si el negocio gana; «Tu plata hoy», si podés pagar las cuentas.
          </li>
          <li>Cada número tiene un <b>?</b> al lado: tocalo y te explica qué es y cómo se calcula.</li>
        </ul>
      </HelpBox>

      <div className="space-y-8">
        <QuickTasks highlight={!empty} />

        {q.isLoading && !d ? (
          <Loading label="Calculando cómo venimos…" />
        ) : q.error && !d ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : d && empty ? (
          <>
            <FirstSteps setup={d.setup} />
            {d.alerts.length > 0 && <AlertsPanel alerts={d.alerts} />}
          </>
        ) : d ? (
          <div className={q.isPlaceholderData ? 'space-y-8 opacity-60 transition-opacity' : 'space-y-8 transition-opacity'}>
            <section aria-labelledby="como-te-fue">
              <SectionTitle title={<span id="como-te-fue">{cuantoTeFueTitle(d.period_phrase)}</span>}>
                <TextWithTip
                  text={d.comparison.partial ? 'Esta vez no comparamos con el período anterior: está cargado a medias.' : `Las flechas comparan ${compareWith(d.comparison.label)}.`}
                  tip={<InfoTip title="¿Contra qué comparamos?" text={d.comparison.detail} />}
                />
              </SectionTitle>
              <PeriodNumbers d={d} />
            </section>

            <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-12">
              <div className="space-y-4 sm:space-y-5 lg:col-span-7">
                <InsightsCard insights={d.insights} />
                <ResultWaterfall summary={d.summary} periodPhrase={d.period_phrase} />
              </div>
              <div className="space-y-4 sm:space-y-5 lg:col-span-5">
                <GoalCard goal={d.goal} month={goalMonth} monthLabel={monthLabelLong(goalMonth)} />
                <AlertsPanel alerts={d.alerts} />
              </div>
            </div>

            <MoneyToday d={d} />

            <section aria-labelledby="graficos">
              <SectionTitle title={<span id="graficos">Cómo viene el año</span>}>Para ver tendencias: ¿los meses vienen mejor o peor? ¿Qué canal y qué vinos empujan las ventas?</SectionTitle>
              <Charts d={d} />
            </section>
          </div>
        ) : null}
      </div>
    </>
  )
}

