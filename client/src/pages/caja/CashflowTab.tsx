// Pestaña "Flujo de caja": cuánta plata entró y salió cada mes, cómo fue cambiando lo que tenés,
// de dónde vino y a dónde fue la plata, y por qué el resultado del negocio no coincide con la caja.
import clsx from 'clsx'
import { CHART_COLORS } from '@shared/constants'
import { addMonths, endOfMonth, startOfMonth, today } from '@shared/dates'
import { Plus, TrendingUp } from 'lucide-react'
import { money, moneyCompact, pct } from '@/lib/format'
import { useApi } from '@/lib/queries'
import { Button, Card, EmptyState, ErrorState, InfoTip, Loading, Select } from '@/components/ui'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'
import { ChartCard, ColumnChart, Legend, RankBars } from '@/components/charts'
import { Kpi, SignedMoney, nb, tileMoney } from './parts'
import type { CashflowResult } from './types'

export type FlowRange = '6' | '12' | '24' | 'anio' | 'anio_pasado'

export const FLOW_RANGES: { value: FlowRange; label: string }[] = [
  { value: '6', label: 'Últimos 6 meses' },
  { value: '12', label: 'Últimos 12 meses' },
  { value: '24', label: 'Últimos 24 meses' },
  { value: 'anio', label: 'Este año' },
  { value: 'anio_pasado', label: 'Año pasado' },
]

/** Rango de meses del flujo (siempre meses completos y nunca meses futuros). */
export function flowPeriod(r: FlowRange): { from: string; to: string } {
  const t = today()
  const end = endOfMonth(t)
  if (r === 'anio') return { from: `${t.slice(0, 4)}-01-01`, to: end }
  if (r === 'anio_pasado') {
    const y = Number(t.slice(0, 4)) - 1
    return { from: `${y}-01-01`, to: `${y}-12-31` }
  }
  return { from: addMonths(startOfMonth(t), -(Number(r) - 1)), to: end }
}

/** Para frases: "No entró ni salió plata en los últimos 12 meses". */
const RANGE_PHRASE: Record<FlowRange, string> = {
  '6': 'los últimos 6 meses',
  '12': 'los últimos 12 meses',
  '24': 'los últimos 24 meses',
  anio: 'lo que va del año',
  anio_pasado: 'el año pasado',
}

const moneyFmt = (v: unknown) => money(Number(v), { decimals: 0 })

/**
 * Evolución de la plata disponible (área). Mismo estilo que TrendChart del kit, pero con los ejes
 * como hijos directos del gráfico: el TrendChart del kit los envuelve en un Fragment y, con React 19,
 * Recharts 2 no los encuentra (el gráfico sale sin ejes ni grilla).
 */
function BalanceChart({ data, color }: { data: { label: string; balance_end: number }[]; color: string }) {
  const axis = { fontSize: 12, fill: '#948172' }
  const Tip = ({ active, payload, label }: TooltipProps<number, string>) =>
    active && payload?.length ? (
      <div className="rounded-xl border border-line bg-paper px-3 py-2 text-[13px] shadow-[var(--shadow-pop)]">
        <p className="mb-1 font-extrabold text-ink">{label}</p>
        <p className="flex items-center gap-2 text-ink-soft">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
          Plata disponible <b className="vh-num text-ink">{money(Number(payload[0].value), { decimals: 0 })}</b>
        </p>
      </div>
    ) : null
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke="#efe6db" />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#dccdbd' }} tick={axis} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} tick={axis} tickFormatter={(v) => moneyCompact(v)} width={80} />
        <Tooltip content={<Tip />} cursor={{ stroke: '#c3b3a2', strokeWidth: 1 }} />
        {data.some((d) => d.balance_end < 0) && <ReferenceLine y={0} stroke="#b9a693" />}
        <Area type="monotone" dataKey="balance_end" name="Plata disponible" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.1} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function CashflowTab({ range, setRange, onNew }: { range: FlowRange; setRange: (r: FlowRange) => void; onNew?: () => void }) {
  const { from, to } = flowPeriod(range)
  const q = useApi<CashflowResult>('/cashflow', { from, to })

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Meses a mostrar" className="w-[200px]" value={range} onChange={(v) => setRange(v as FlowRange)} options={FLOW_RANGES} />
      <p className="text-[13.5px] text-ink-soft">Mirá varios meses juntos: la tendencia dice más que un mes suelto.</p>
    </div>
  )
  if (q.error)
    return (
      <div className="space-y-4">
        {header}
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    )
  if (!q.data)
    return (
      <div className="space-y-4">
        {header}
        <Loading />
      </div>
    )

  const { months, by_kind, totals } = q.data
  const rangeLabel = RANGE_PHRASE[range] ?? 'estos meses'

  // Sin ningún movimiento de plata en el rango: los gráficos saldrían vacíos (ejes de $ 0 a $ 4), mejor explicar qué va a aparecer.
  if (by_kind.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <div className="vh-card">
          <EmptyState
            icon={TrendingUp}
            title={`No entró ni salió plata en ${rangeLabel}`}
            action={
              onNew ? (
                <Button icon={Plus} onClick={onNew}>
                  Cargar un movimiento
                </Button>
              ) : undefined
            }
          >
            Cuando cobres ventas o pagues compras y gastos, acá vas a ver mes a mes cuánto entró, cuánto salió y cuánta plata te quedó.
            {Math.abs(totals.balance_end) > 0.004 && ` Por ahora tenés ${money(totals.balance_end, { decimals: 0 })} en tus cuentas.`} Si buscás meses anteriores, elegí otro rango arriba.
          </EmptyState>
        </div>
      </div>
    )
  }
  const negMonths = months.filter((m) => m.net < 0).length
  const lastThree = months.slice(-3)
  const threeNegative = lastThree.length === 3 && lastThree.every((m) => m.net < 0)
  const ins = by_kind.filter((k) => k.in > 0).sort((a, b) => b.in - a.in)
  const outs = by_kind.filter((k) => k.out > 0).sort((a, b) => b.out - a.out)
  const topN = <T,>(xs: T[], value: (x: T) => number, label: (x: T) => string) => {
    const top = xs.slice(0, 5).map((x) => ({ label: label(x), value: Math.round(value(x)) }))
    const rest = xs.slice(5).reduce((s, x) => s + value(x), 0)
    return rest > 0 ? [...top, { label: 'Otros', value: Math.round(rest) }] : top
  }
  const cashDelta = totals.balance_end - totals.balance_start
  const gap = totals.result - totals.net
  const salesIn = ins.find((k) => k.ref_type === 'sale')?.in ?? 0
  const salesShare = totals.cash_in > 0 ? salesIn / totals.cash_in : 0
  const untilToday = to >= today()

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi label="Entró" tone="sky" value={tileMoney(totals.cash_in)} title={money(totals.cash_in)} info={{ title: 'Lo que entró', text: 'Cobros de ventas, aportes, préstamos recibidos y otros ingresos. No cuenta las transferencias entre tus cuentas.' }} hint={`${months.length} ${months.length === 1 ? 'mes' : 'meses'}${untilToday ? ' (el último, hasta hoy)' : ''}`} />
        <Kpi label="Salió" tone="coral" value={tileMoney(totals.cash_out)} title={money(totals.cash_out)} info={{ title: 'Lo que salió', text: 'Pagos de compras de vino y de gastos, comisiones, retiros de los dueños y cuotas de préstamos.' }} hint={negMonths ? `${negMonths} ${negMonths === 1 ? 'mes' : 'meses'} con más salidas que entradas` : 'Ningún mes salió más de lo que entró'} />
        <Kpi
          label="Flujo neto"
          term="flujo_caja"
          value={
            Math.abs(totals.net) >= 1_000_000 ? (
              <>
                {/* En el celular, abreviado (el valor exacto queda al pasar el mouse y en la tabla). */}
                <span className={clsx('sm:hidden', totals.net < 0 ? 'text-bad' : 'text-good')}>
                  {totals.net < 0 ? '−' : '+'}
                  {moneyCompact(Math.abs(totals.net))}
                </span>
                <SignedMoney value={totals.net} strong={false} decimals={0} className="hidden sm:inline" />
              </>
            ) : (
              <SignedMoney value={totals.net} strong={false} decimals={0} />
            )
          }
          title={money(totals.net)}
          hint={totals.net > 0.004 ? 'Entró más de lo que salió' : totals.net < -0.004 ? 'Salió más de lo que entró' : 'Entró lo mismo que salió'}
        />
        <Kpi
          label="Plata al final"
          term="caja"
          value={tileMoney(totals.balance_end)}
          title={money(totals.balance_end)}
          hint={
            <>
              Arrancó en {nb(money(totals.balance_start, { decimals: 0 }))} ({cashDelta >= 0 ? '+' : '−'}
              {nb(money(Math.abs(cashDelta), { decimals: 0 }))})
            </>
          }
        />
      </div>

      {threeNegative && (
        <p className="rounded-2xl border border-bad/25 bg-bad-soft/70 px-4 py-3 text-[14.5px] text-ink">
          <b>Atención:</b> en los últimos 3 meses salió más plata de la que entró. Si sigue así, la caja se va a vaciar aunque el negocio gane. Mirá abajo a dónde se va la plata.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Entradas y salidas por mes"
          subtitle="Plata que efectivamente entró y salió de tus cuentas."
          term="flujo_caja"
          legend={
            <Legend
              items={[
                { label: 'Entró', color: CHART_COLORS.ventas },
                { label: 'Salió', color: CHART_COLORS.gastos },
              ]}
            />
          }
          table={{
            columns: [
              { key: 'label', header: 'Mes' },
              { key: 'cash_in', header: 'Entró', align: 'right', format: moneyFmt },
              { key: 'cash_out', header: 'Salió', align: 'right', format: moneyFmt },
              { key: 'net', header: 'Neto', align: 'right', format: (v) => <SignedMoney value={Number(v)} strong={false} /> },
            ],
            rows: months as unknown as Record<string, unknown>[],
          }}
        >
          <ColumnChart
            data={months as unknown as Record<string, unknown>[]}
            series={[
              { key: 'cash_in', label: 'Entró', color: CHART_COLORS.ventas },
              { key: 'cash_out', label: 'Salió', color: CHART_COLORS.gastos },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Plata disponible a fin de cada mes"
          subtitle="La suma de todas tus cuentas el último día de cada mes."
          term="caja"
          legend={<Legend items={[{ label: 'Plata en todas las cuentas', color: CHART_COLORS.ganancia }]} />}
          table={{
            columns: [
              { key: 'label', header: 'Mes' },
              { key: 'balance_end', header: 'Plata a fin de mes', align: 'right', format: moneyFmt },
            ],
            rows: months as unknown as Record<string, unknown>[],
          }}
        >
          <BalanceChart data={months} color={CHART_COLORS.ganancia} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="¿De dónde vino la plata?" subtitle="Todo lo que entró en el período, por tipo.">
          <RankBars items={topN(ins, (k) => k.in, (k) => k.label)} color={CHART_COLORS.ventas} max={6} emptyText="No entró plata en este período." />
          <p className="mt-4 text-[13px] text-muted">
            {salesShare >= 0.995
              ? 'Toda la plata que entró vino de cobrar lo que vendiste. '
              : salesShare < 0.005
                ? 'Nada de esto vino de cobrar ventas. Al arrancar es normal, pero a la larga el negocio tiene que generar su propia plata vendiendo. '
                : `El ${pct(salesShare, 0)} vino de cobrar ventas; lo ideal es que sea casi todo, porque aportes y préstamos no son plata que genera el negocio. `}
            Si ponés plata de tu bolsillo o pedís un préstamo, cargalo con «Nuevo movimiento» así queda claro de dónde salió.
          </p>
        </Card>
        <Card title="¿A dónde fue?" subtitle="Todo lo que salió en el período, por tipo.">
          <RankBars items={topN(outs, (k) => k.out, (k) => k.label)} color={CHART_COLORS.gastos} max={6} emptyText="No salió plata en este período." />
        </Card>
      </div>

      <Card
        title={
          <span className="inline-flex items-center gap-1.5">
            ¿Por qué la ganancia no es igual a la caja? <InfoTip term="devengado_percibido" />
          </span>
        }
      >
        <div className="space-y-2 text-[14.5px] text-ink-soft">
          <p>
            En estos meses el negocio {totals.result >= 0 ? 'ganó' : 'perdió'} <b className="vh-num text-ink">{money(Math.abs(totals.result), { decimals: 0 })}</b> (resultado) y la caja{' '}
            {totals.net >= 0 ? 'sumó' : 'perdió'} <b className="vh-num text-ink">{money(Math.abs(totals.net), { decimals: 0 })}</b> (flujo neto)
            {Math.abs(gap) > 1 ? (
              <>
                : una diferencia de <b className="vh-num text-ink">{money(Math.abs(gap), { decimals: 0 })}</b>. Es normal, y se explica así:
              </>
            ) : (
              '.'
            )}
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li>
              <b>El resultado cuenta lo que vendiste y gastaste</b>, aunque todavía no lo hayas cobrado o pagado. <b>La caja cuenta solo la plata que se movió.</b>
            </li>
            {totals.purchases > 0 && (
              <li>
                Compraste vino por <b className="vh-num">{money(totals.purchases, { decimals: 0 })}</b>: sale de la caja, pero no es gasto (queda como stock). Recién cuenta como costo cuando
                vendés esas botellas.
              </li>
            )}
            {totals.withdrawals > 0 && (
              <li>
                Los dueños retiraron <b className="vh-num">{money(totals.withdrawals, { decimals: 0 })}</b>: sale de la caja pero no es un gasto del negocio (es la ganancia que se llevan).
              </li>
            )}
            {totals.contributions > 0 && (
              <li>
                Hubo aportes por <b className="vh-num">{money(totals.contributions, { decimals: 0 })}</b>: entran a la caja pero no son ventas.
              </li>
            )}
            <li>Las ventas a cuenta suben el resultado hoy y la caja cuando te pagan; las deudas con proveedores, al revés.</li>
          </ul>
          <p>Mirá las dos cosas: el resultado dice si el negocio es bueno; la caja, si podés pagar las cuentas este mes.</p>
        </div>
      </Card>
    </div>
  )
}
