// Pestaña "Rentabilidad por vino": análisis ABC por ganancia + vinos quietos + frases para decidir
// qué reponer, a qué subirle el precio y qué dejar de comprar.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { PackageX, Sparkles, TrendingDown, Wine } from 'lucide-react'
import type { Period } from '@shared/dates'
import { dateShort, int, pct } from '@/lib/format'
import { Badge, Button, DataTable, EmptyState, ExportButton, InfoTip, type Column } from '@/components/ui'
import { ABC_INFO, AbcBadge, Amount, BlockTitle, compact, Insights, money0, plural, ReportGuard, TabIntro, useReport, type Insight } from './parts'
import type { AbcClass, ProductReportRow } from './types'

type Filter = 'todos' | AbcClass | 'Q'

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Diferencia mínima de margen (1,5 puntos) para decir que un vino deja "poco" o "buen" margen. */
const GAP = 0.015

/** Las tres listas de "para pensar", calculadas con medianas de botellas y margen de los vinos vendidos. */
function quadrants(rows: ProductReportRow[]) {
  const sold = rows.filter((r) => !r.idle && r.bottles > 0)
  const mb = median(sold.map((r) => r.bottles))
  const mm = median(sold.map((r) => r.margin))
  const enough = sold.length >= 4
  return {
    enough,
    medianBottles: mb,
    medianMargin: mm,
    volumeLowMargin: enough ? sold.filter((r) => r.bottles >= mb && r.margin <= mm - GAP).sort((a, b) => b.bottles - a.bottles) : [],
    marginLowVolume: enough ? sold.filter((r) => r.bottles < mb && r.margin >= mm + GAP).sort((a, b) => b.margin - a.margin) : [],
    idle: rows.filter((r) => r.idle).sort((a, b) => b.stock_value - a.stock_value),
  }
}

function ListCard({
  icon: Icon,
  title,
  why,
  items,
  render,
  empty,
  tone,
}: {
  icon: typeof Wine
  title: string
  why: string
  items: ProductReportRow[]
  render: (r: ProductReportRow) => string
  empty: string
  tone: string
}) {
  const navigate = useNavigate()
  const shown = items.slice(0, 5)
  return (
    <section className="vh-card flex min-w-0 flex-col p-5">
      <div className="flex items-start gap-2.5">
        <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full', tone)} aria-hidden>
          <Icon size={17} strokeWidth={2.3} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[16px] leading-tight font-extrabold text-ink">{title}</h3>
          <p className="mt-1 text-[13.5px] leading-snug text-ink-soft">{why}</p>
        </div>
      </div>
      {shown.length ? (
        <ul className="mt-3 divide-y divide-line/70">
          {shown.map((r) => (
            <li key={r.product_id}>
              <button type="button" onClick={() => navigate(`/vinos/${r.product_id}`)} className="flex w-full items-baseline gap-2 py-2 text-left hover:text-brown">
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">{r.name}</span>
                <span className="vh-num shrink-0 text-[13px] text-ink-soft">{render(r)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl bg-cream px-3 py-2.5 text-[13.5px] text-ink-soft">{empty}</p>
      )}
      {items.length > shown.length && <p className="mt-1 text-[12.5px] text-muted">y {plural(items.length - shown.length, 'vino más', 'vinos más')} (están en la tabla).</p>}
    </section>
  )
}

export function ProductsTab({ period }: { period: Period }) {
  const q = useReport<ProductReportRow[]>('/reports/products', period)
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('todos')

  return (
    <ReportGuard q={q}>
      {(rows) => <ProductsContent rows={rows} period={period} filter={filter} setFilter={setFilter} onOpen={(id) => navigate(`/vinos/${id}`)} onNewSale={() => navigate('/ventas?nuevo=1')} />}
    </ReportGuard>
  )
}

function ProductsContent({
  rows,
  period,
  filter,
  setFilter,
  onOpen,
  onNewSale,
}: {
  rows: ProductReportRow[]
  period: Period
  filter: Filter
  setFilter: (f: Filter) => void
  onOpen: (id: number) => void
  onNewSale: () => void
}) {
  const sold = rows.filter((r) => !r.idle)
  const filtered = filter === 'todos' ? rows : rows.filter((r) => (filter === 'Q' ? r.idle : !r.idle && r.abc === filter))
  // Los totales de abajo de la tabla son de lo que se está viendo (si filtrás la clase A, suman la clase A).
  const totals = useMemo(() => {
    const xs = filtered.filter((r) => !r.idle)
    const revenue = xs.reduce((s, r) => s + r.revenue, 0)
    const cost = xs.reduce((s, r) => s + r.cost, 0)
    const profit = xs.reduce((s, r) => s + r.profit, 0)
    return {
      bottles: xs.reduce((s, r) => s + r.bottles, 0),
      revenue,
      cost,
      profit,
      margin: revenue > 0 ? profit / revenue : null,
      share: xs.reduce((s, r) => s + r.share, 0),
      any: xs.length > 0,
    }
  }, [filtered])
  const classes = (['A', 'B', 'C', 'Q'] as const).map((k) => {
    const rs = rows.filter((r) => (k === 'Q' ? r.idle : !r.idle && r.abc === k))
    return {
      k,
      count: rs.length,
      share: rs.reduce((s, r) => s + (r.idle ? 0 : r.share), 0),
      profit: rs.reduce((s, r) => s + r.profit, 0),
      stock_value: rs.reduce((s, r) => s + r.stock_value, 0),
    }
  })
  const quad = quadrants(rows)

  const intro = (
    <TabIntro title="Rentabilidad por vino" actions={<ExportButton path="/reports/products/export" params={{ from: period.from, to: period.to }} />}>
      No todos los vinos te hacen ganar lo mismo. Acá los ordenamos por <b>cuánta ganancia te dejaron</b> en el período (ventas − lo que te costaron) y los separamos en clases A, B y C. Te sirve para
      decidir <b>qué reponer primero</b>, a qué vino subirle el precio y cuál dejar de comprar.
    </TabIntro>
  )

  if (!rows.length) {
    return (
      <>
        {intro}
        <EmptyState
          icon={Wine}
          title="No hay ventas de vinos en este período"
          action={
            <Button icon={Wine} onClick={onNewSale}>
              Cargar una venta
            </Button>
          }
        >
          Cuando vendas vinos, acá vas a ver cuáles te dejan más plata. Si ya cargaste ventas, probá con otro período.
        </EmptyState>
      </>
    )
  }

  const insights: Insight[] = []
  const a = classes[0]
  if (a.count > 0 && sold.length > 1) {
    insights.push({
      tone: 'info',
      text: (
        <>
          <b>{plural(a.count, 'vino', 'vinos')}</b> de {sold.length} ({pct(a.count / sold.length, 0)}) dejaron el <b>{pct(a.share, 0)}</b> de la ganancia. Esos no pueden faltar nunca: reponelos a
          tiempo y revisá su precio seguido.
        </>
      ),
    })
  }
  const runningOut = sold.filter((r) => r.active && (r.abc === 'A' || r.abc === 'B') && (r.stock <= 0 || (r.days_of_stock != null && r.days_of_stock < 15)))
  if (runningOut.length) {
    const out = runningOut.filter((r) => r.stock <= 0)
    insights.push({
      tone: 'bad',
      text: (
        <>
          {runningOut.length === 1 ? 'Un vino de los que más dejan' : `${runningOut.length} vinos de los que más dejan`}{' '}
          {out.length === runningOut.length ? (runningOut.length === 1 ? 'se quedó' : 'se quedaron') : 'se quedaron o están por quedarse'} sin stock:{' '}
          <b>
            {runningOut
              .slice(0, 4)
              .map((r) => (r.stock <= 0 ? `${r.name} (sin stock)` : `${r.name} (${r.days_of_stock} días)`))
              .join(', ')}
          </b>
          {runningOut.length > 4 ? ' y otros' : ''}. Cada día sin ese vino es ganancia que se pierde: reponelo.
        </>
      ),
    })
  }
  const losing = sold.filter((r) => r.profit < 0)
  if (losing.length) {
    insights.push({
      tone: 'bad',
      text: (
        <>
          {losing.length === 1 ? 'Un vino se vendió' : `${losing.length} vinos se vendieron`} <b>por debajo de lo que te costó</b>:{' '}
          {losing
            .slice(0, 3)
            .map((r) => r.name)
            .join(', ')}
          . Revisá el precio o los descuentos.
        </>
      ),
    })
  }
  const q = classes[3]
  if (q.count > 0) {
    insights.push({
      tone: 'warn',
      text: (
        <>
          Tenés <b>{money0(q.stock_value)}</b> parados en {plural(q.count, 'vino que no se vendió', 'vinos que no se vendieron')} en el período (valorizados al costo). Es plata del negocio que no está
          en la caja.
        </>
      ),
    })
  }

  const columns: Column<ProductReportRow>[] = [
    {
      key: 'name',
      header: 'Vino',
      cell: (r) => (
        <span className="block min-w-[110px] sm:min-w-[150px]">
          <span className="font-bold text-ink">{r.name}</span>
          {!r.active && (
            <Badge className="ml-1.5" tone="neutral">
              Desactivado
            </Badge>
          )}
          {r.winery && <span className="block text-[12.5px] text-muted">{r.winery}</span>}
        </span>
      ),
      value: (r) => `${r.name} ${r.winery ?? ''}`,
    },
    { key: 'bottles', header: 'Botellas', align: 'right', hideBelow: 'sm', cell: (r) => int(r.bottles), footer: int(totals.bottles) },
    { key: 'revenue', header: 'Ventas', align: 'right', hideBelow: 'md', cell: (r) => (r.idle ? '—' : money0(r.revenue)), footer: totals.any ? money0(totals.revenue) : '—' },
    { key: 'cost', header: 'Costo', align: 'right', hideBelow: 'lg', cell: (r) => (r.idle ? '—' : money0(r.cost)), footer: totals.any ? money0(totals.cost) : '—' },
    {
      key: 'profit',
      header: 'Ganancia',
      align: 'right',
      cell: (r) => (r.idle ? <span className="text-muted">—</span> : <Amount value={r.profit} className={clsx('font-bold', r.profit < 0 && 'text-bad')} />),
      footer: totals.any ? <Amount value={totals.profit} className={totals.profit < 0 ? 'text-bad' : undefined} /> : '—',
    },
    {
      key: 'margin',
      header: 'Margen',
      align: 'right',
      hideBelow: 'sm',
      cell: (r) => (r.idle ? '—' : <span className={r.margin < 0 ? 'text-bad' : undefined}>{pct(r.margin, 0)}</span>),
      value: (r) => (r.idle ? null : r.margin),
      footer: totals.margin == null ? '—' : pct(totals.margin, 0),
    },
    {
      key: 'share',
      header: '% de la ganancia',
      align: 'right',
      hideBelow: 'lg',
      cell: (r) => (r.idle ? '—' : pct(r.share, 1)),
      value: (r) => (r.idle ? null : r.share),
      footer: totals.any ? pct(totals.share, 0) : '—',
    },
    { key: 'abc', header: 'Clase', align: 'center', cell: (r) => <AbcBadge abc={r.abc} idle={r.idle} />, value: (r) => (r.idle ? 'D' : r.abc) },
    {
      key: 'days_of_stock',
      header: 'Días de stock',
      align: 'right',
      hideBelow: 'md',
      cell: (r) =>
        r.stock <= 0 ? (
          <span className="text-bad">Sin stock</span>
        ) : r.days_of_stock == null ? (
          <span className="text-muted" title={r.last_sale ? `Última venta: ${dateShort(r.last_sale)}` : 'Nunca se vendió'}>
            Sin ventas
          </span>
        ) : (
          <span className={r.days_of_stock > 180 ? 'font-bold text-warn' : r.days_of_stock < 15 ? 'font-bold text-bad' : undefined}>{int(r.days_of_stock)}</span>
        ),
      value: (r) => (r.stock <= 0 ? -1 : (r.days_of_stock ?? 99999)),
    },
  ]

  return (
    <>
      {intro}
      <section className="vh-card p-5" aria-label="Análisis ABC">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <div className="min-w-0 text-[14.5px] leading-relaxed text-ink-soft [&_b]:text-ink">
            <p className="flex items-center gap-1.5 text-[17px] font-extrabold text-ink">
              ¿Qué es el análisis ABC? <InfoTip term="abc" />
            </p>
            <p className="mt-1.5">
              Ordenamos los vinos de mayor a menor ganancia y vamos sumando. Los primeros que juntos llegan al <b>80 % de la ganancia</b> son <b>A</b>; los que siguen hasta el <b>95 %</b> son <b>B</b>
              ; el resto son <b>C</b>. <b>Quietos</b> son los que tenés en stock pero no se vendieron en el período.
            </p>
            <p className="mt-1.5">Casi siempre pasa lo mismo: pocos vinos dejan la mayor parte de la plata. Conocerlos te ayuda a no quedarte sin ellos y a no llenarte de los que no rotan.</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
            {classes.map((c) => {
              const info = ABC_INFO[c.k]
              const active = filter === c.k
              return (
                <button
                  key={c.k}
                  type="button"
                  onClick={() => setFilter(active ? 'todos' : c.k)}
                  aria-pressed={active}
                  className={clsx(
                    'flex min-w-0 flex-col items-start gap-1 rounded-2xl border-2 px-3.5 py-3 text-left transition-colors',
                    active ? 'border-brown bg-cream' : 'border-line bg-paper hover:border-line-strong',
                  )}
                >
                  <AbcBadge abc={c.k === 'Q' ? 'C' : c.k} idle={c.k === 'Q'} />
                  <span className="text-[1.45rem] leading-none font-extrabold text-ink">{plural(c.count, 'vino', 'vinos')}</span>
                  <span className="text-[12.5px] leading-snug text-ink-soft">
                    {c.k === 'Q' ? (c.count ? `${compact(c.stock_value)} parados en stock` : 'Todos se vendieron') : `${info.short} · ${pct(c.share, 0)} de la ganancia`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <Insights className="mt-5" items={insights} />

      <section className="mt-6" aria-label="Vinos">
        <BlockTitle title="Vino por vino">Tocá un vino para ver su ficha completa. Tocá una clase de arriba para filtrar.</BlockTitle>
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(r) => r.product_id}
          onRowClick={(r) => onOpen(r.product_id)}
          searchPlaceholder="Buscar vino o bodega…"
          pageSize={30}
          initialSort={undefined}
          empty={
            <div className="vh-card">
              <EmptyState
                compact
                icon={filter === 'Q' ? PackageX : Wine}
                title={filter === 'Q' ? 'No hay vinos quietos' : `No hay vinos en la clase ${filter}`}
                action={
                  <Button size="sm" onClick={() => setFilter('todos')}>
                    Ver todos los vinos
                  </Button>
                }
              >
                {filter === 'Q'
                  ? 'Todos los vinos que tenés en stock se vendieron al menos una vez en el período. ¡Bien!'
                  : 'Con las ventas de este período ningún vino quedó en esta clase. Mirá la lista completa.'}
              </EmptyState>
            </div>
          }
          toolbar={
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por clase">
              {(['todos', 'A', 'B', 'C', 'Q'] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={clsx(
                    'h-9 rounded-full border px-3 text-[13.5px] font-bold transition-colors',
                    filter === f ? 'border-ink bg-ink text-cream' : 'border-line-strong bg-paper text-ink-soft hover:border-ink/40 hover:text-ink',
                  )}
                >
                  {f === 'todos' ? 'Todos' : f === 'Q' ? 'Quietos' : `Clase ${f}`}
                </button>
              ))}
            </div>
          }
        />
        <p className="mt-2 text-[12.5px] text-muted">
          Ventas = cantidad × precio de cada renglón (sin repartir descuentos ni envíos). Días de stock: para cuántos días te alcanza al ritmo de los últimos 90 días{' '}
          <InfoTip term="rotacion" size={13} />. Stock y días de stock son de hoy.
        </p>
      </section>

      <section className="mt-6" aria-label="Para pensar">
        <BlockTitle title="Para pensar">
          Comparamos cada vino con el «vino del medio» de la tabla: el que vende {int(Math.round(quad.medianBottles))} botellas y el que deja {pct(quad.medianMargin, 1)} de margen. «Poco» o «buen»
          margen es al menos 1,5 puntos por debajo o por encima de ese {pct(quad.medianMargin, 1)}.
        </BlockTitle>
        <div className="grid gap-4 lg:grid-cols-3">
          <ListCard
            icon={TrendingDown}
            tone="bg-mustard-soft text-mustard-deep"
            title="Se venden mucho pero dejan poco margen"
            why="Son tus caballitos de batalla, pero cada botella deja poco. Probá subirles un poco el precio: como se venden igual, el impacto en la ganancia es grande."
            items={quad.volumeLowMargin}
            render={(r) => `${int(r.bottles)} bot. · ${pct(r.margin, 1)}`}
            empty={quad.enough ? 'Ninguno: tus vinos más vendidos también dejan buen margen. ¡Bien!' : 'Hacen falta al menos 4 vinos vendidos para comparar.'}
          />
          <ListCard
            icon={Sparkles}
            tone="bg-good-soft text-good"
            title="Dejan buen margen pero se venden poco"
            why="Cada botella deja buena plata. Recomendalos más: exhibilos mejor, ofrecelos en degustaciones o armá un combo."
            items={quad.marginLowVolume}
            render={(r) => `${pct(r.margin, 1)} · ${int(r.bottles)} bot.`}
            empty={quad.enough ? 'Ninguno por ahora.' : 'Hacen falta al menos 4 vinos vendidos para comparar.'}
          />
          <ListCard
            icon={PackageX}
            tone="bg-coral-soft text-coral-deep"
            title="Quietos: no se vendieron en el período"
            why="Tienen stock pero nadie se los llevó. Es plata parada: pensá en una promo, un combo o no volver a comprarlos."
            items={quad.idle}
            render={(r) => `${int(r.stock)} bot. · ${money0(r.stock_value)}`}
            empty="¡Ninguno! Todos los vinos con stock se vendieron en el período."
          />
        </div>
      </section>
    </>
  )
}
