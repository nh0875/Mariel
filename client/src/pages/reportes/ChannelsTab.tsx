// Pestaña "Canales y cobros": dónde vendés, cuánto te deja cada canal, cuánto te cobra cada medio
// de pago y qué días de la semana vendés más.
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Store } from 'lucide-react'
import { CHART_COLORS } from '@shared/constants'
import type { Period } from '@shared/dates'
import { int, pct } from '@/lib/format'
import { Button, Card, DataTable, EmptyState, ExportButton, InfoTip, type Column } from '@/components/ui'
import { ChartCard, ColumnChart, DonutChart } from '@/components/charts'
import { BlockTitle, Insights, money0, ReportGuard, TabIntro, useReport, type Insight } from './parts'
import type { ChannelRow, ChannelsReport, PaymentMethodRow } from './types'

function channelInsights(d: ChannelsReport): Insight[] {
  const out: Insight[] = []
  const ch = d.channels.filter((c) => c.sales > 0)
  if (ch.length) {
    const main = ch[0]
    out.push({
      tone: 'info',
      text: (
        <>
          El <b>{pct(main.share, 0)}</b> de tus ventas vino de <b>{main.label}</b>
          {ch.length > 1 ? `, seguido por ${ch[1].label} (${pct(ch[1].share, 0)})` : ''}.
        </>
      ),
    })
  }
  if (ch.length >= 2) {
    const best = ch.reduce((a, b) => (b.margin > a.margin ? b : a))
    const worst = ch.reduce((a, b) => (b.margin < a.margin ? b : a))
    if (best.channel !== worst.channel && best.margin - worst.margin > 0.03) {
      out.push({
        tone: 'info',
        text: (
          <>
            Por cada $ 100 vendidos, <b>{best.label}</b> te deja $ {Math.round(best.margin * 100)} y <b>{worst.label}</b> $ {Math.round(worst.margin * 100)} (después del vino y las comisiones).{' '}
            {worst.share > 0.2 ? 'Como vendés mucho por ahí, revisá sus precios o descuentos.' : 'Tenelo en cuenta antes de hacer promos en ese canal.'}
          </>
        ),
      })
    }
  }
  const fees = d.payment_methods.reduce((s, m) => s + m.fees, 0)
  if (fees > 0) {
    const priciest = d.payment_methods.filter((m) => m.fees > 0).reduce((a, b) => (b.fee_pct_effective > a.fee_pct_effective ? b : a))
    out.push({
      tone: 'warn',
      text: (
        <>
          En comisiones de cobro se fueron <b>{money0(fees)}</b> ({pct(fees / d.total_sales, 1)} de lo vendido). La más cara: <b>{priciest.label}</b>, que se queda con el{' '}
          {pct(priciest.fee_pct_effective, 1)} de cada venta. Un descuento chico por pagar en efectivo o transferencia puede convenirte.
        </>
      ),
    })
  }
  const days = d.weekdays.filter((w) => w.days > 0)
  if (d.total_count >= 10 && days.length >= 2) {
    const best = days.reduce((a, b) => (b.avg_per_day > a.avg_per_day ? b : a))
    const worst = days.reduce((a, b) => (b.avg_per_day < a.avg_per_day ? b : a))
    if (best.avg_per_day > 0) {
      out.push({
        tone: 'info',
        text: (
          <>
            Tu mejor día es el <b>{best.label.toLowerCase()}</b>: uno típico vendés {money0(best.avg_per_day)}
            {worst.avg_per_day > 0
              ? `, ${(best.avg_per_day / worst.avg_per_day).toFixed(1).replace('.', ',')} veces más que un ${worst.label.toLowerCase()}`
              : `; los ${worst.label.toLowerCase()} casi no vendés`}
            . Usalo para organizar horarios, personal y promociones.
          </>
        ),
      })
    }
  }
  return out
}

export function ChannelsTab({ period }: { period: Period }) {
  const q = useReport<ChannelsReport>('/reports/channels', period)
  const navigate = useNavigate()
  return (
    <ReportGuard q={q}>
      {(d) => {
        const intro = (
          <TabIntro title="Canales y cobros" period={d.period} actions={<ExportButton path="/reports/channels/export" params={{ from: period.from, to: period.to }} />}>
            No es lo mismo vender en el local que a un restó o por Mercado Pago: cada canal tiene <b>otro precio, otro costo y otras comisiones</b>. Acá ves cuánto te deja de verdad cada uno, cuánto
            te cobra cada medio de pago y qué días de la semana se vende más.
          </TabIntro>
        )
        if (!d.total_count) {
          return (
            <>
              {intro}
              <EmptyState
                icon={Store}
                title="No hay ventas en este período"
                action={
                  <Button icon={Store} onClick={() => navigate('/ventas?nuevo=1')}>
                    Cargar una venta
                  </Button>
                }
              >
                Cuando cargues ventas (con su canal y su medio de pago), acá vas a ver cuál te conviene más.
              </EmptyState>
            </>
          )
        }
        const totalFees = d.payment_methods.reduce((s, m) => s + m.fees, 0)
        const totalProfit = d.channels.reduce((s, c) => s + c.profit, 0)

        const chCols: Column<ChannelRow>[] = [
          { key: 'label', header: 'Canal', cell: (c) => <span className="font-bold text-ink">{c.label}</span> },
          { key: 'sales', header: 'Ventas', align: 'right', cell: (c) => money0(c.sales), footer: money0(d.total_sales) },
          { key: 'count', header: 'Cant.', align: 'right', hideBelow: 'lg', cell: (c) => int(c.count), footer: int(d.total_count) },
          {
            key: 'avg_ticket',
            header: 'Ticket prom.',
            align: 'right',
            hideBelow: 'md',
            cell: (c) => money0(c.avg_ticket),
            footer: money0(d.total_count ? d.total_sales / d.total_count : 0),
          },
          { key: 'fees', header: 'Comisiones', align: 'right', hideBelow: 'lg', cell: (c) => money0(c.fees), footer: money0(totalFees) },
          { key: 'profit', header: 'Te dejó', align: 'right', hideBelow: 'sm', cell: (c) => <b className={c.profit < 0 ? 'text-bad' : undefined}>{money0(c.profit)}</b>, footer: money0(totalProfit) },
          {
            key: 'margin',
            header: 'Margen',
            align: 'right',
            cell: (c) => <span className={c.margin < 0 ? 'text-bad' : undefined}>{pct(c.margin, 0)}</span>,
            footer: pct(d.total_sales ? totalProfit / d.total_sales : 0, 0),
          },
        ]
        const pmCols: Column<PaymentMethodRow>[] = [
          { key: 'label', header: 'Medio de cobro', cell: (m) => <span className="font-bold text-ink">{m.label}</span> },
          { key: 'total', header: 'Vendido', align: 'right', cell: (m) => money0(m.total), footer: money0(d.total_sales) },
          { key: 'share', header: '% ventas', align: 'right', hideBelow: 'md', cell: (m) => pct(m.share, 0) },
          { key: 'count', header: 'Cant.', align: 'right', hideBelow: 'lg', cell: (m) => int(m.count), footer: int(d.total_count) },
          { key: 'fees', header: 'Comisiones', align: 'right', hideBelow: 'sm', cell: (m) => money0(m.fees), footer: money0(totalFees) },
          {
            key: 'fee_pct_effective',
            header: 'Comisión real',
            align: 'right',
            cell: (m) => (
              <span className="inline-flex flex-col items-end leading-tight">
                <b className={clsx(m.fee_pct_effective >= 0.04 && 'text-bad')}>{pct(m.fee_pct_effective, 1)}</b>
                {m.fee_pct_configured != null && Math.abs(m.fee_pct_configured - m.fee_pct_effective) > 0.001 && (
                  <span className="text-[11.5px] font-normal text-muted">configurada {pct(m.fee_pct_configured, 2)}</span>
                )}
              </span>
            ),
            footer: pct(d.total_sales ? totalFees / d.total_sales : 0, 1),
          },
        ]
        const weekRows = d.weekdays.map((w) => ({ ...w, dia: w.short.charAt(0).toUpperCase() + w.short.slice(1), promedio: w.avg_per_day }))
        return (
          <>
            {intro}
            <Insights items={channelInsights(d)} />

            <div className="mt-6 grid gap-4 xl:grid-cols-5">
              <section className="min-w-0 xl:col-span-3" aria-label="Canales de venta">
                <BlockTitle
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      ¿Cuánto te deja cada canal?
                      <InfoTip
                        title="Lo que te dejó cada canal"
                        text="Ventas − costo del vino vendido − comisiones de cobro de ese canal. Es antes de los gastos generales (alquiler, sueldos…), que son de todo el negocio. Margen = lo que te dejó ÷ ventas."
                      />
                    </span>
                  }
                >
                  «Te dejó» = ventas − costo del vino − comisiones (antes de los gastos generales).
                </BlockTitle>
                <DataTable rows={d.channels} columns={chCols} rowKey={(c) => c.channel} searchable={false} dense />
              </section>
              <ChartCard
                className="xl:col-span-2"
                title="¿De dónde vienen las ventas?"
                subtitle="Parte de las ventas de cada canal."
                table={{
                  columns: [
                    { key: 'label', header: 'Canal' },
                    { key: 'sales', header: 'Ventas', align: 'right', format: (v) => money0(Number(v)) },
                    { key: 'share', header: '%', align: 'right', format: (v) => pct(Number(v), 0) },
                  ],
                  rows: d.channels as unknown as Record<string, unknown>[],
                }}
              >
                <DonutChart data={d.channels.map((c) => ({ label: c.label, value: c.sales }))} />
              </ChartCard>
            </div>

            <section className="mt-6" aria-label="Medios de cobro">
              <BlockTitle
                title={
                  <span className="inline-flex items-center gap-1.5">
                    ¿Cuánto te cobra cada medio de pago?
                    <InfoTip term="comisiones" />
                  </span>
                }
              >
                Comisión real = comisiones ÷ lo vendido con ese medio. Si difiere de la de Configuración es porque en alguna venta la cargaste a mano.
              </BlockTitle>
              <DataTable rows={d.payment_methods} columns={pmCols} rowKey={(m) => m.method} searchable={false} dense />
            </section>

            <ChartCard
              className="mt-6"
              title="¿Qué días vendés más?"
              subtitle="Venta promedio de cada día de la semana: ventas de ese día ÷ cuántos hubo en el período. Así no influye que un mes tenga 5 sábados y otro 4."
              table={{
                columns: [
                  { key: 'label', header: 'Día' },
                  { key: 'total', header: 'Ventas', align: 'right', format: (v) => money0(Number(v)) },
                  { key: 'count', header: 'Cant.', align: 'right', format: (v) => int(Number(v)) },
                  { key: 'days', header: 'Días', align: 'right', format: (v) => int(Number(v)) },
                  { key: 'promedio', header: 'Promedio', align: 'right', format: (v) => money0(Number(v)) },
                ],
                rows: weekRows as unknown as Record<string, unknown>[],
              }}
            >
              <ColumnChart
                data={weekRows as unknown as Record<string, unknown>[]}
                xKey="dia"
                height={240}
                series={[{ key: 'promedio', label: 'Venta promedio del día', color: CHART_COLORS.ventas }]}
              />
            </ChartCard>
            <Card className="mt-4" title="¿Cómo usar esto?">
              <ul className="list-disc space-y-1.5 pl-5 text-[14px] text-ink-soft">
                <li>Si un canal vende mucho pero deja poco margen (por ejemplo, mayorista), está bien que así sea, pero cuidá que el precio cubra el costo y los envíos.</li>
                <li>Si un medio de pago te cobra mucha comisión, podés ofrecer un precio especial en efectivo o transferencia (la diferencia la pagaba la comisión).</li>
                <li>Los días flojos son buenos para degustaciones o promos; los días fuertes, para tener más gente atendiendo.</li>
              </ul>
            </Card>
          </>
        )
      }}
    </ReportGuard>
  )
}
