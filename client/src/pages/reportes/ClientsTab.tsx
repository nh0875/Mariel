// Pestaña "Clientes": quién te compra, cuánto te deja cada uno, cuánto dependés de pocos
// y qué parte de las ventas no tiene cliente cargado ("consumidor final").
import { useNavigate } from 'react-router-dom'
import { Store, UserRound, Users } from 'lucide-react'
import { addDays, today, type Period } from '@shared/dates'
import { dateShort, int, pct, relativeDays } from '@/lib/format'
import { Button, Card, DataTable, EmptyState, ExportButton, InfoTip, StatTile, type Column } from '@/components/ui'
import { RankBars } from '@/components/charts'
import { Amount, BlockTitle, Insights, money0, plural, ReportGuard, TabIntro, useReport, type Insight } from './parts'
import type { ClientReportRow, ClientsReport } from './types'

const TOP = 15

function clientInsights(d: ClientsReport): Insight[] {
  const out: Insight[] = []
  const c = d.clients
  if (c.length >= 5 && d.totals.top5_share >= 0.5) {
    out.push({
      tone: 'warn',
      text: (
        <>
          Tus 5 mejores clientes son el <b>{pct(d.totals.top5_share, 0)}</b> de tus ventas. Está bueno tenerlos, pero dependés mucho de ellos: si uno deja de comprar, se nota. Cuidalos y buscá sumar
          más.
        </>
      ),
    })
  } else if (c.length >= 5) {
    out.push({ tone: 'good', text: <>Tus ventas están repartidas: los 5 mejores clientes son el {pct(d.totals.top5_share, 0)} del total. No dependés de unos pocos.</> })
  }
  // Clientes que compraban y hace más de 60 días que no vuelven.
  const lim = addDays(today(), -60)
  const asleep = c.filter((x) => x.count >= 2 && x.last_purchase && x.last_purchase < lim)
  if (asleep.length) {
    out.push({
      tone: 'info',
      text: (
        <>
          {asleep.length === 1 ? 'Un cliente que compraba seguido' : `${asleep.length} clientes que compraban seguido`} no vuelve{asleep.length === 1 ? '' : 'n'} hace más de 2 meses:{' '}
          <b>
            {asleep
              .slice(0, 3)
              .map((x) => x.name)
              .join(', ')}
          </b>
          {asleep.length > 3 ? ' y otros' : ''}. Un mensaje con una novedad puede traerlos de vuelta.
        </>
      ),
    })
  }
  if (d.walk_in.share >= 0.4) {
    out.push({
      tone: 'info',
      text: (
        <>
          El <b>{pct(d.walk_in.share, 0)}</b> de tus ventas no tiene cliente cargado. Si anotás aunque sea el nombre, vas a saber quién vuelve, quién dejó de venir y a quién avisarle de un vino nuevo.
        </>
      ),
    })
  }
  return out
}

export function ClientsTab({ period }: { period: Period }) {
  const q = useReport<ClientsReport>('/reports/clients', period)
  const navigate = useNavigate()
  return (
    <ReportGuard q={q}>
      {(d) => {
        const intro = (
          <TabIntro title="Clientes" period={d.period} actions={<ExportButton path="/reports/clients/export" params={{ from: period.from, to: period.to }} />}>
            ¿Quién te compra y cuánto te deja cada uno? Los clientes que más compran merecen un trato especial; los que dejaron de venir, un mensaje. Y si muchas ventas no tienen cliente cargado, te
            estás perdiendo esa información.
          </TabIntro>
        )
        if (!d.totals.count) {
          return (
            <>
              {intro}
              <EmptyState
                icon={Users}
                title="No hay ventas en este período"
                action={
                  <Button icon={Store} onClick={() => navigate('/ventas?nuevo=1')}>
                    Cargar una venta
                  </Button>
                }
              >
                Cuando cargues ventas con su cliente, acá vas a ver quién te compra más.
              </EmptyState>
            </>
          )
        }
        const top = d.clients.slice(0, TOP)
        const cols: Column<ClientReportRow>[] = [
          { key: 'rank', header: '#', align: 'right', sortable: false, cell: (r) => <span className="font-extrabold text-muted">{d.clients.indexOf(r) + 1}</span>, width: '2.5rem' },
          {
            key: 'name',
            header: 'Cliente',
            cell: (r) => (
              <span className="block min-w-[140px]">
                <span className="font-bold text-ink">{r.name}</span>
                <span className="block text-[12.5px] text-muted">{r.kind_label}</span>
              </span>
            ),
          },
          { key: 'total', header: 'Compró', align: 'right', cell: (r) => <b>{money0(r.total)}</b> },
          { key: 'share', header: '% de tus ventas', align: 'right', hideBelow: 'sm', cell: (r) => pct(r.share, 1) },
          { key: 'count', header: 'Compras', align: 'right', hideBelow: 'md', cell: (r) => int(r.count) },
          { key: 'bottles', header: 'Botellas', align: 'right', hideBelow: 'lg', cell: (r) => int(r.bottles) },
          { key: 'profit', header: 'Te quedó', align: 'right', hideBelow: 'lg', cell: (r) => <span className={r.profit < 0 ? 'text-bad' : undefined}>{money0(r.profit)}</span> },
          {
            key: 'last_purchase',
            header: 'Última compra',
            align: 'right',
            hideBelow: 'md',
            cell: (r) => (
              <span title={r.last_purchase ? dateShort(r.last_purchase) : undefined} className="text-ink-soft">
                {relativeDays(r.last_purchase)}
              </span>
            ),
          },
        ]
        return (
          <>
            {intro}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              <StatTile
                label="Clientes"
                value={int(d.totals.clients)}
                tone="sky"
                hint={`Te compraron en el período (${plural(d.totals.count - d.walk_in.count, 'venta', 'ventas')} con cliente cargado).`}
              />
              <StatTile label="Tus 5 mejores" value={d.clients.length ? pct(d.totals.top5_share, 0) : '—'} hint="Lo que pesan en todas tus ventas del período. Más de la mitad = dependés de pocos." />
              <StatTile
                label="Sin cliente"
                value={pct(d.walk_in.share, 0)}
                tone="mustard"
                hint={
                  <>
                    {plural(d.walk_in.count, 'venta', 'ventas')} por <Amount value={d.walk_in.total} /> sin cliente cargado (las de mostrador).
                  </>
                }
              />
              <StatTile
                label="Ticket promedio"
                term="ticket_promedio"
                value={<Amount value={d.clients.length ? d.clients.reduce((s, c) => s + c.total, 0) / Math.max(1, d.totals.count - d.walk_in.count) : 0} />}
                hint="De las ventas con cliente cargado: lo que gasta en promedio cada uno por compra."
              />
            </div>

            <Insights className="mt-5" items={clientInsights(d)} />

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <Card
                title={
                  <span className="inline-flex items-center gap-1.5">
                    Ventas sin cliente
                    <InfoTip
                      title="Ventas sin cliente"
                      text="Son las ventas donde no elegiste ningún cliente (típico del mostrador: en el ticket figura «consumidor final»). Se cuentan igual en tus ventas y en el resultado; lo único que se pierde es saber quién te compró."
                    />
                  </span>
                }
                subtitle="Las de mostrador, donde no elegiste a nadie"
              >
                <p className="text-[2.2rem] leading-none font-extrabold text-ink">{pct(d.walk_in.share, 0)}</p>
                <p className="mt-1 text-[13.5px] text-ink-soft">de tus ventas del período</p>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-sky-soft" role="img" aria-label={`Sin cliente ${pct(d.walk_in.share, 0)}, con cliente ${pct(1 - d.walk_in.share, 0)}`}>
                  <div className="h-full rounded-full bg-mustard" style={{ width: `${Math.max(0, Math.min(1, d.walk_in.share)) * 100}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[12.5px] text-muted">
                  <span>Sin cliente: {money0(d.walk_in.total)}</span>
                  <span>Con cliente: {money0(d.totals.sales - d.walk_in.total)}</span>
                </div>
                <p className="mt-3 text-[13.5px] leading-snug text-ink-soft">
                  Es normal en el mostrador. Pero si cargás el nombre de quien te compra seguido, vas a saber quién vuelve y a quién avisarle cuando entra un vino nuevo.
                </p>
              </Card>
              {d.clients.length > 0 && (
                <Card title="¿Quién te compra más?" subtitle="Top 6 por lo que compraron">
                  <RankBars items={d.clients.slice(0, 6).map((c) => ({ label: c.name, value: Math.round(c.total) }))} max={6} />
                </Card>
              )}
            </div>
            <section className="mt-6" aria-label="Mejores clientes">
              <BlockTitle title={d.clients.length > 1 ? `Tus ${Math.min(TOP, d.clients.length)} mejores clientes` : 'Tus mejores clientes'}>
                Ordenados por lo que compraron en el período. Tocá uno para ver su ficha.
                {d.clients.length > TOP && ` El Excel tiene a los ${d.clients.length}.`}
              </BlockTitle>
              <DataTable
                rows={top}
                columns={cols}
                rowKey={(r) => r.client_id}
                onRowClick={(r) => navigate(`/clientes/${r.client_id}`)}
                searchable={false}
                pageSize={TOP}
                empty={
                  <div className="vh-card">
                    <EmptyState
                      compact
                      icon={UserRound}
                      title="Todavía no cargaste clientes en tus ventas"
                      action={
                        <Button icon={Users} onClick={() => navigate('/clientes')}>
                          Ir a Clientes
                        </Button>
                      }
                    >
                      Todas las ventas del período son «consumidor final». Cargá tus clientes frecuentes (restós, vinotecas, amigos del club) y elegilos al vender.
                    </EmptyState>
                  </div>
                }
              />
              <p className="mt-2 text-[12.5px] text-muted">
                «Te quedó» = lo que compró − costo del vino − comisiones de cobro. «Última compra» es la más reciente de toda la historia, no solo del período.
              </p>
            </section>
          </>
        )
      }}
    </ReportGuard>
  )
}
