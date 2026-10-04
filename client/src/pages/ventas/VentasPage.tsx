// Ventas: la pantalla más usada. Cargar una venta tiene que ser rápido y entender
// cuánto vendiste, cuánto te quedó y cuánto te deben, de un vistazo.
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { FilterX, History, Plus, Search, SearchX, Store, X } from 'lucide-react'
import { CHART_COLORS, SALE_CHANNEL_LABELS, SALE_CHANNELS } from '@shared/constants'
import { addDays, daysBetween, monthLabel, monthsBetween, previousPeriod, today } from '@shared/dates'
import type { SaleDetail } from '@shared/types'
import { bottles as fmtBottles, boxes, date as fmtDate, dateShort, int, money, moneyCompact, pct } from '@/lib/format'
import { useNewParam } from '@/lib/hooks'
import { usePeriod } from '@/lib/period'
import { useApi, useClients } from '@/lib/queries'
import {
  Badge,
  Button,
  Card,
  Combobox,
  DataTable,
  EmptyState,
  ErrorState,
  ExportButton,
  HelpBox,
  Loading,
  Money,
  PageHeader,
  PeriodPicker,
  Select,
  StatusBadge,
  type Column,
} from '@/components/ui'
import { normalize } from '@/components/ui/Combobox'
import { ChartCard, ColumnChart, DonutChart } from '@/components/charts'
import { SaleFormModal } from './SaleFormModal'
import { SaleDetailModal } from './SaleDetailModal'
import { KpiTile } from './parts'
import { STATUS_FILTER_OPTIONS, channelShort, itemsSummary, type SaleListRow, type SalesSummary, type StatusFilter } from './types'

const minDate = (a: string, b: string) => (a < b ? a : b)

/** Estado de cobro en palabras (para buscar y ordenar la columna). */
const statusText = (r: SaleListRow) => (r.status === 'pagado' ? 'Cobrada' : r.overdue ? 'Vencida' : r.status === 'parcial' ? 'Cobro parcial' : 'Por cobrar')

/** Monto que no se corta entre el "$" y el número cuando el texto baja de renglón. */
const M = ({ n }: { n: number }) => <span className="whitespace-nowrap">{money(n, { decimals: 0 })}</span>

/** Plata para las tarjetas: completa hasta $ 10 M, abreviada arriba de eso (el valor exacto queda en el tooltip). */
const tileMoney = (n: number) => (Math.abs(n) >= 10_000_000 ? moneyCompact(n) : money(n, { decimals: 0 }))

export default function VentasPage() {
  const { period, preset, label: periodLabel, setPreset } = usePeriod()
  const [params, setParams] = useSearchParams()
  const [newOpen, openNew, closeNew] = useNewParam()
  const [presetEvent, setPresetEvent] = useState<number | null>(null)
  const [presetClient, setPresetClient] = useState<number | null>(null)
  const [editing, setEditing] = useState<SaleDetail | null>(null)

  // Filtros de la tabla
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [clientId, setClientId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const filtersOn = !!(channel || status || clientId)
  const clearFilters = () => {
    setChannel('')
    setStatus('')
    setClientId(null)
    setQuery('')
  }

  // ?evento=ID → abre "Nueva venta" con ese evento y el canal "Eventos" (desde la ficha del evento).
  // ?cliente=ID → abre "Nueva venta" con ese cliente elegido (desde la ficha del cliente).
  useEffect(() => {
    const ev = Number(params.get('evento'))
    const cl = Number(params.get('cliente'))
    if (!params.has('evento') && !params.has('cliente')) return
    if (ev > 0) setPresetEvent(ev)
    if (cl > 0) setPresetClient(cl)
    if (ev > 0 || cl > 0) openNew()
    const next = new URLSearchParams(params)
    next.delete('evento')
    next.delete('cliente')
    setParams(next, { replace: true })
  }, [params, setParams, openNew])

  // ?ver=ID → abre el detalle de esa venta (links desde otras pantallas).
  const viewId = Number(params.get('ver')) || null
  const openDetail = (id: number) => {
    const next = new URLSearchParams(params)
    next.set('ver', String(id))
    setParams(next, { replace: true })
  }
  const closeDetail = () => {
    const next = new URLSearchParams(params)
    next.delete('ver')
    setParams(next, { replace: true })
  }

  // Comparación justa: si el período todavía no terminó (ej. "este mes" al día 4),
  // se compara contra los mismos días del período anterior (1 al 4 del mes pasado).
  const t0 = today()
  const partial = period.from <= t0 && t0 < period.to
  const prevFull = previousPeriod(period)
  const cmpPrev = partial ? { from: prevFull.from, to: minDate(addDays(prevFull.from, daysBetween(period.from, t0)), prevFull.to) } : prevFull
  const showDelta = preset !== 'todo'
  const summary = useApi<SalesSummary>('/sales/summary', { from: period.from, to: period.to })
  const curCmp = useApi<SalesSummary>('/sales/summary', { from: period.from, to: t0 }, { enabled: showDelta && partial })
  const prevSummary = useApi<SalesSummary>('/sales/summary', { from: cmpPrev.from, to: cmpPrev.to }, { enabled: showDelta })
  const filters = { ...period, channel: channel || undefined, status: status || undefined, client_id: clientId ?? undefined }
  const list = useApi<SaleListRow[]>('/sales', filters)
  const { data: clients = [] } = useClients()

  const s = summary.data
  const p = showDelta ? prevSummary.data : undefined
  const base = partial ? curCmp.data : s
  // Solo comparamos si en el período anterior ya cargabas ventas (si no, el % no significa nada).
  const comparable = !!s?.first_sale_date && s.first_sale_date <= cmpPrev.from
  const delta = (pick: (x: SalesSummary) => number) =>
    comparable && base && p && pick(p) ? (pick(base) - pick(p)) / Math.abs(pick(p)) : null
  const deltaLabel = partial
    ? `vs. ${dateShort(cmpPrev.from)} – ${dateShort(cmpPrev.to)}`
    : preset === 'mes_pasado'
      ? 'vs. el mes anterior'
      : 'vs. período anterior'

  // Gráfico: por día si el período es corto, por mes si es largo.
  const chart = useMemo(() => {
    if (!s) return { mode: 'day' as const, rows: [] as { key: string; label: string; ventas: number; count: number }[] }
    const map = new Map(s.by_day.map((d) => [d.date, d]))
    const t = today()
    const end = period.to > t && period.from <= t ? t : period.to
    const first = s.by_day[0]?.date
    const start = first && first > period.from ? (daysBetween(period.from, end) > 62 ? first : period.from) : period.from
    if (daysBetween(start, end) <= 62) {
      const rows = []
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const x = map.get(d)
        rows.push({ key: d, label: dateShort(d), ventas: x?.total ?? 0, count: x?.count ?? 0 })
      }
      return { mode: 'day' as const, rows }
    }
    const byMonth = new Map<string, { total: number; count: number }>()
    for (const d of s.by_day) {
      const m = d.date.slice(0, 7)
      const acc = byMonth.get(m) ?? { total: 0, count: 0 }
      acc.total += d.total
      acc.count += d.count
      byMonth.set(m, acc)
    }
    return {
      mode: 'month' as const,
      rows: monthsBetween(start, end).map((m) => ({ key: m, label: monthLabel(m), ventas: byMonth.get(m)?.total ?? 0, count: byMonth.get(m)?.count ?? 0 })),
    }
  }, [s, period])

  const allRows = list.data
  // La búsqueda la hacemos acá (y no dentro de la tabla) para que los totales de abajo sumen solo lo que se ve.
  const rows = useMemo(() => {
    const data = allRows ?? []
    const q = normalize(query.trim())
    if (!q) return data
    const words = q.split(/\s+/)
    return data.filter((r) => {
      const hay = normalize(
        [
          `#${r.id}`,
          r.client_name || 'Consumidor final',
          r.event_name ?? '',
          r.items_preview.map((i) => i.name).join(' '),
          SALE_CHANNEL_LABELS[r.channel],
          statusText(r),
          fmtDate(r.date),
          dateShort(r.date),
          r.notes ?? '',
        ].join(' '),
      )
      return words.every((w) => hay.includes(w))
    })
  }, [allRows, query])
  const totals = useMemo(
    () => ({ total: rows.reduce((a, r) => a + r.total, 0), profit: rows.reduce((a, r) => a + r.profit, 0), balance: rows.reduce((a, r) => a + r.balance, 0) }),
    [rows],
  )
  const noSalesEver = !!s && !s.first_sale_date

  const columns: Column<SaleListRow>[] = [
    { key: 'date', header: 'Fecha', cell: (r) => <span className="whitespace-nowrap">{dateShort(r.date)}</span>, className: 'w-[1%]', hideBelow: 'sm' },
    { key: 'id', header: 'Nº', cell: (r) => <span className="text-muted">#{r.id}</span>, hideBelow: 'sm', className: 'w-[1%]' },
    {
      key: 'client',
      header: 'Cliente',
      value: (r) => `${r.client_name || 'Consumidor final'} ${r.items_preview.map((i) => i.name).join(' ')} ${r.event_name ?? ''}`,
      footer: (
        <span className="font-semibold text-ink-soft">
          {rows.length === 1 ? '1 venta' : `${int(rows.length)} ventas`}
          {query.trim() ? (rows.length === 1 ? ' encontrada' : ' encontradas') : ''}
        </span>
      ),
      cell: (r) => (
        <div className="min-w-0">
          <span className={clsx('block max-w-[44vw] truncate sm:max-w-[260px]', r.client_name ? 'font-semibold text-ink' : 'text-ink-soft')}>
            {r.client_name || 'Consumidor final'}
          </span>
          <span className="block max-w-[44vw] truncate text-[12.5px] text-muted sm:max-w-[34vw] md:hidden">
            <span className="sm:hidden">{dateShort(r.date)} · </span>
            {itemsSummary(r.items_preview)}
          </span>
        </div>
      ),
    },
    { key: 'channel', header: 'Canal', value: (r) => SALE_CHANNEL_LABELS[r.channel], cell: (r) => <Badge>{channelShort(r.channel)}</Badge>, hideBelow: 'lg' },
    {
      key: 'items',
      header: 'Vinos',
      value: (r) => itemsSummary(r.items_preview),
      cell: (r) => <span className="block max-w-[260px] truncate text-ink-soft" title={r.items_preview.map((i) => `${i.qty} × ${i.name}`).join('\n')}>{itemsSummary(r.items_preview)}</span>,
      hideBelow: 'md',
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (r) => (
        <>
          <span className="font-bold">{money(r.total)}</span>
          <span className="mt-1 block sm:hidden">
            <StatusBadge status={r.status} overdue={r.overdue} kind="sale" />
          </span>
        </>
      ),
      footer: money(totals.total),
    },
    {
      key: 'profit',
      header: 'Ganancia',
      align: 'right',
      hideBelow: 'md',
      cell: (r) => <Money value={r.profit} decimals={0} tone={r.profit < 0 ? 'auto' : 'none'} className="text-ink-soft" />,
      footer: money(totals.profit, { decimals: 0 }),
    },
    {
      key: 'status',
      header: 'Estado',
      value: statusText,
      cell: (r) => <StatusBadge status={r.status} overdue={r.overdue} kind="sale" />,
      hideBelow: 'sm',
      className: 'w-[1%]',
    },
  ]

  const formOpen = newOpen || !!editing
  const closeForm = () => {
    // Si venías del detalle (Editar), al cerrar volvés a ese detalle con los datos al día.
    if (editing) openDetail(editing.id)
    closeNew()
    setEditing(null)
    setPresetEvent(null)
    setPresetClient(null)
  }

  return (
    <>
      <PageHeader
        title="Ventas"
        description="Cargá lo que vendés en segundos y mirá cuánto te deja cada venta y cuánto te deben."
        actions={
          <>
            <ExportButton path="/sales/export" params={filters} />
            <Button variant="primary" icon={Plus} onClick={openNew}>
              Nueva venta
            </Button>
          </>
        }
      />

      <HelpBox id="ventas">
        <p>
          Acá cargás <b>cada venta</b> y ves cuánto vendiste, cuánto te quedó y quién te debe. Cuando guardás una venta pasan tres cosas solas:
        </p>
        <ul>
          <li>
            <b>Se descuentan las botellas del stock.</b> Si cargás algo que no es vino (una entrada a una degustación, una caja de regalo), no toca el stock.
          </li>
          <li>
            <b>Se congela el costo de cada botella</b> ese día. Si mañana el vino aumenta, esta venta conserva su ganancia real.
          </li>
          <li>
            <b>Si ya la cobraste, la plata entra en la cuenta</b> (Caja, Banco, Mercado Pago) y se descuenta sola la <b>comisión</b> del medio de pago. Si te pagan después,
            queda <b>por cobrar</b> y cuando te paguen tocás «Registrar cobro» (se puede cobrar en partes).
          </li>
        </ul>
        <p>
          <b>Ejemplo:</b> vendés 3 Malbec a $ 12.000 por Mercado Pago = $ 36.000. Si cada botella te costó $ 7.200 ($ 21.600) y Mercado Pago se queda el 6,29 % ($ 2.264),
          te quedan <b>$ 12.136</b>: un margen del 33,7 %.
        </p>
        <p>
          <b>¿Por qué importa?</b> Vender mucho no alcanza: importa cuánto te queda de cada venta. Y esa ganancia todavía tiene que pagar el alquiler, los sueldos y demás
          gastos: el resultado final lo ves en Reportes.
        </p>
      </HelpBox>

      <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker />
        {s && s.count > 0 && (
          <p className="text-[13.5px] text-ink-soft">
            {int(s.count)} {s.count === 1 ? 'venta' : 'ventas'} en el período
          </p>
        )}
      </div>

      {summary.error ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : !s ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-6 min-[87.5rem]:grid-cols-5">
            <KpiTile
              label="Ventas"
              className="md:col-span-2 min-[87.5rem]:col-span-1"
              term="ventas"
              tone="sky"
              value={tileMoney(s.total)}
              title={money(s.total)}
              delta={delta((x) => x.total)}
              deltaLabel={deltaLabel}
              hint={s.count ? `${int(s.count)} ${s.count === 1 ? 'venta' : 'ventas'}` : 'Sin ventas en el período'}
            />
            <KpiTile
              label="Ticket promedio"
              className="md:col-span-2 min-[87.5rem]:col-span-1"
              term="ticket_promedio"
              value={tileMoney(s.avg_ticket)}
              title={money(s.avg_ticket)}
              delta={delta((x) => x.avg_ticket)}
              deltaLabel={deltaLabel}
              hint={s.count ? `Lo que gasta cada cliente por compra` : '—'}
            />
            <KpiTile
              label="Botellas vendidas"
              className="md:col-span-2 min-[87.5rem]:col-span-1"
              info={{
                title: 'Botellas vendidas',
                text: 'Solo cuenta vinos del stock. Los ítems que no son vino (entradas, cajas de regalo) no suman botellas.',
              }}
              value={int(s.bottles)}
              delta={delta((x) => x.bottles)}
              deltaLabel={deltaLabel}
              hint={s.bottles >= 6 ? `≈ ${boxes(s.bottles)}` : s.count ? `${fmtBottles(s.bottles)}` : '—'}
            />
            <KpiTile
              label="Ganancia"
              className="md:col-span-3 min-[87.5rem]:col-span-1"
              tone="orange"
              info={{
                title: 'Ganancia de las ventas',
                text: (
                  <>
                    <p>Lo que te dejaron las ventas después de pagar el vino y las comisiones.</p>
                    <p className="mt-2 rounded-lg bg-cream-deep px-2.5 py-1.5 font-semibold text-ink">Ventas − costo de las botellas − comisiones</p>
                    <p className="mt-2">
                      Este período: {money(s.total)} − {money(s.cost)} − {money(s.fees)}. Todavía no descuenta los gastos fijos (alquiler, sueldos…): el resultado final está en
                      Reportes.
                    </p>
                  </>
                ),
              }}
              value={tileMoney(s.profit)}
              valueClassName={s.profit < 0 ? 'text-bad' : undefined}
              title={money(s.profit)}
              delta={delta((x) => x.profit)}
              deltaLabel={deltaLabel}
              hint={
                s.total ? (
                  <>
                    <span className="whitespace-nowrap">Margen {pct(s.margin)}</span> · comisiones <M n={s.fees} />
                  </>
                ) : (
                  '—'
                )
              }
            />
            <KpiTile
              label="Por cobrar"
              term="por_cobrar"
              tone="mustard"
              className="col-span-2 md:col-span-3 min-[87.5rem]:col-span-1"
              value={tileMoney(s.pending)}
              title={money(s.pending)}
              hint={
                <>
                  {s.count === 0 ? (
                    s.receivables.total > 0.01 ? (
                      <>De ventas anteriores te deben <M n={s.receivables.total} />.</>
                    ) : (
                      'Nada pendiente de cobro.'
                    )
                  ) : s.pending_count === 0 ? (
                    <>
                      ¡Todo cobrado en este período!
                      {s.receivables.total > 0.01 && <> De ventas anteriores te deben <M n={s.receivables.total} />.</>}
                    </>
                  ) : (
                    <>
                      {s.pending_count} {s.pending_count === 1 ? 'venta' : 'ventas'} de este período
                      {s.overdue_count > 0 && <b className="text-bad"> · {s.overdue_count} vencida{s.overdue_count === 1 ? '' : 's'}</b>}
                      {s.receivables.total > s.pending + 0.01 && <> · en total te deben <M n={s.receivables.total} /></>}
                    </>
                  )}
                  {s.receivables.total > 0.01 && (
                    <Link to="/caja?tab=pendientes" className="mt-0.5 block font-bold text-sky-deep hover:underline">
                      Ver quién te debe →
                    </Link>
                  )}
                </>
              }
            />
          </div>

          {s.count > 0 && (
            <div className="mt-4 grid gap-4 min-[87.5rem]:grid-cols-2">
              <ChartCard
                title={chart.mode === 'day' ? 'Ventas por día' : 'Ventas por mes'}
                subtitle={chart.mode === 'day' ? 'Cuánto vendiste cada día (cobrado o no).' : 'El período es largo: lo agrupamos por mes.'}
                term="ventas"
                table={{
                  columns: [
                    { key: 'label', header: chart.mode === 'day' ? 'Día' : 'Mes' },
                    { key: 'count', header: 'Ventas', align: 'right', format: (v) => int(Number(v)) },
                    { key: 'ventas', header: 'Total', align: 'right', format: (v) => money(Number(v)) },
                  ],
                  rows: chart.rows.filter((r) => r.count > 0).reverse(),
                }}
              >
                <ColumnChart data={chart.rows} series={[{ key: 'ventas', label: 'Ventas', color: CHART_COLORS.ventas }]} height={210} />
              </ChartCard>
              <ChartCard
                title="Por canal"
                subtitle="Por dónde entran tus ventas."
                table={{
                  columns: [
                    { key: 'label', header: 'Canal' },
                    { key: 'count', header: 'Ventas', align: 'right', format: (v) => int(Number(v)) },
                    { key: 'total', header: 'Total', align: 'right', format: (v) => money(Number(v)) },
                    { key: 'profit', header: 'Te dejó', align: 'right', format: (v) => money(Number(v)) },
                  ],
                  rows: s.by_channel,
                }}
              >
                <DonutChart data={s.by_channel.map((c) => ({ label: channelShort(c.channel), value: Math.round(c.total) }))} height={190} />
              </ChartCard>
            </div>
          )}
        </>
      )}

      <Card className="mt-4" title="Todas las ventas" subtitle="Tocá una venta para ver el detalle, cobrarla, editarla o imprimir el comprobante." flush>
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <Loading />
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={(r) => openDetail(r.id)}
              searchable={false}
              initialSort={{ key: 'date', dir: 'desc' }}
              rowClassName={(r) => (r.overdue ? 'bg-bad-soft/25' : undefined)}
              toolbar={
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                  <label className="relative col-span-2 min-w-[200px] sm:max-w-xs sm:flex-1">
                    <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), setQuery(''))}
                      placeholder="Buscar cliente, vino o nº…"
                      aria-label="Buscar cliente, vino o número de venta"
                      className="h-10 w-full rounded-full border border-line-strong bg-paper pr-9 pl-9 text-[14.5px] placeholder:text-muted/70 focus:border-brown focus:ring-[3px] focus:ring-brown/15 focus:outline-none"
                    />
                    {query && (
                      <button
                        type="button"
                        aria-label="Borrar la búsqueda"
                        onClick={() => setQuery('')}
                        className="absolute top-1/2 right-2.5 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-cream-deep hover:text-ink"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </label>
                  <Select
                    aria-label="Canal"
                    className="sm:w-[170px]"
                    value={channel}
                    onChange={setChannel}
                    placeholder="Cualquier canal"
                    options={SALE_CHANNELS.map((c) => ({ value: c, label: channelShort(c) }))}
                  />
                  <Select aria-label="Estado de cobro" className="sm:w-[205px]" value={status} onChange={(v) => setStatus(v as StatusFilter)} options={STATUS_FILTER_OPTIONS} />
                  <Combobox
                    className="col-span-2 sm:w-[210px]"
                    value={clientId}
                    onChange={setClientId}
                    allowClear
                    placeholder="Cualquier cliente"
                    searchPlaceholder="Buscar cliente…"
                    emptyText="No hay clientes con ese nombre."
                    options={clients.map((c) => ({ value: c.id, label: c.name }))}
                  />
                  {(filtersOn || query) && (
                    <Button size="sm" variant="ghost" icon={FilterX} onClick={clearFilters} className="col-span-2 justify-self-start">
                      Limpiar filtros
                    </Button>
                  )}
                </div>
              }
              empty={
                query.trim() && (allRows?.length ?? 0) > 0 ? (
                  <EmptyState compact icon={SearchX} title={`No encontramos «${query.trim()}»`} action={<Button onClick={() => setQuery('')}>Borrar la búsqueda</Button>}>
                    Probá con otra palabra: el nombre del cliente, un vino o el número de venta (ej: 1234).
                  </EmptyState>
                ) : (status === 'por_cobrar' || status === 'vencida') && preset !== 'todo' ? (
                  <EmptyState
                    compact
                    icon={FilterX}
                    title={`No hay ventas ${status === 'vencida' ? 'vencidas' : 'por cobrar'} en este período`}
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button icon={History} onClick={() => setPreset('todo')}>
                          Mirar desde siempre
                        </Button>
                        <Button variant="ghost" onClick={clearFilters}>
                          Limpiar filtros
                        </Button>
                      </div>
                    }
                  >
                    Los filtros miran solo el período elegido arriba ({periodLabel}). Lo que te deben de meses anteriores aparece si mirás «Desde siempre».
                  </EmptyState>
                ) : filtersOn ? (
                  <EmptyState compact icon={FilterX} title="No hay ventas con esos filtros" action={<Button onClick={clearFilters}>Limpiar filtros</Button>}>
                    Probá con otro canal, estado o cliente, o cambiá el período de arriba.
                  </EmptyState>
                ) : (
                  <EmptyState
                    icon={Store}
                    title={noSalesEver ? 'Todavía no cargaste ninguna venta' : 'No hay ventas en este período'}
                    action={
                      <Button icon={Plus} onClick={openNew}>
                        {noSalesEver ? 'Cargar mi primera venta' : 'Cargar una venta'}
                      </Button>
                    }
                  >
                    {noSalesEver
                      ? 'Elegís el vino, la cantidad y cómo te pagan; el stock, la caja y la ganancia se calculan solos. Si todavía no cargaste tus vinos, empezá por «Vinos y stock».'
                      : `No hay ventas cargadas en el período elegido (${periodLabel}). Si buscás ventas viejas, cambiá el período de arriba.`}
                  </EmptyState>
                )
              }
            />
          )}
          {rows.length > 0 && totals.balance > 0.01 && (
            <p className="mt-3 text-[13px] text-ink-soft">
              De estas ventas falta cobrar <b className="text-ink">{money(totals.balance)}</b>. Filtrá por «Solo por cobrar» para verlas juntas.
            </p>
          )}
        </div>
      </Card>

      <SaleFormModal open={formOpen} sale={editing} presetEventId={presetEvent} presetClientId={presetClient} onClose={closeForm} />
      <SaleDetailModal
        saleId={formOpen ? null : viewId}
        onClose={closeDetail}
        onEdit={(sale) => {
          setEditing(sale)
          closeDetail()
        }}
      />
    </>
  )
}
