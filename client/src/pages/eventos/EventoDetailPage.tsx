// Ficha de un evento: sus cuentas (entradas + vino − costos = resultado), el presupuesto,
// y las ventas, gastos y botellas abiertas que lo componen. Desde acá se carga todo lo del evento.
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarClock, CalendarHeart, MapPin, Pencil, Receipt, Store, Ticket, Trash2, Users, Wine } from 'lucide-react'
import clsx from 'clsx'
import { CHART_COLORS } from '@shared/constants'
import { today } from '@shared/dates'
import type { ExpenseWithStatus } from '@shared/types'
import { ApiError, api } from '@/lib/api'
import { bottles as fmtBottles, dateLong, dateShort, int, money, num, pct, relativeDays } from '@/lib/format'
import type { GlossaryKey } from '@/lib/glossary'
import { useApi, useApiMutation } from '@/lib/queries'
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  ExportButton,
  HelpBox,
  InfoTip,
  Loading,
  Modal,
  PageHeader,
  ProgressBar,
  StatusBadge,
  Tabs,
  useConfirm,
  type Column,
} from '@/components/ui'
import { EventFormModal } from './EventFormModal'
import { OpenBottlesModal } from './OpenBottlesModal'
import { EXPLAIN, KindBadge, Kpi, nb, resultClass, resultPhrase } from './parts'
import type { EventDetail, EventSale, EventSummary, OpenedBottle } from './types'

type TabKey = 'ventas' | 'gastos' | 'botellas'

export default function EventoDetailPage() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [gone, setGone] = useState(false)
  const q = useApi<EventDetail>(`/events/${id}`, undefined, { enabled: id > 0 && !gone, retry: false })
  const [editOpen, setEditOpen] = useState(false)
  const [bottlesOpen, setBottlesOpen] = useState(false)
  const [cantDelete, setCantDelete] = useState(false)
  const [tab, setTab] = useState<TabKey>('ventas')

  const remove = useApiMutation(
    async () => {
      // Dejamos de pedir la ficha antes de borrar (si no, se refresca y da "no encontrado").
      setGone(true)
      await api.del(`/events/${id}`)
    },
    {
      success: 'Evento borrado',
      onSuccess: () => navigate('/eventos', { replace: true }),
      onError: () => setGone(false),
    },
  )
  const removeOpened = useApiMutation((movementId: number) => api.del(`/events/${id}/open-bottles/${movementId}`), {
    success: 'Listo: las botellas volvieron al stock',
  })

  if (!(id > 0) || (q.error instanceof ApiError && q.error.status === 404)) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={CalendarHeart}
          title="No encontramos ese evento"
          action={
            <Button icon={ArrowLeft} onClick={() => navigate('/eventos')}>
              Ver todos los eventos
            </Button>
          }
        >
          Puede que se haya borrado. Buscalo en la lista de eventos.
        </EmptyState>
      </>
    )
  }
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Loading />

  const { event: ev, summary: s, sales, expenses, opened, after } = q.data
  const isUpcoming = ev.date > today()
  const isToday = ev.date === today()
  const isPast = !isUpcoming && !isToday
  const hasData = s.sales_count + s.expenses_count + s.opened_count > 0

  const askDelete = async () => {
    if (hasData) {
      setCantDelete(true)
      return
    }
    const ok = await confirm({
      title: `¿Borrar «${ev.name}»?`,
      message: 'No tiene ventas, gastos ni botellas abiertas, así que se puede borrar sin perder nada. No se puede deshacer.',
      confirmText: 'Sí, borrar',
      danger: true,
    })
    if (ok) remove.mutate()
  }
  const askRemoveOpened = async (o: OpenedBottle) => {
    const ok = await confirm({
      title: '¿Quitar estas botellas abiertas?',
      message: (
        <>
          {o.bottles === 1 ? 'La botella' : `Las ${o.bottles} botellas`} de <b className="text-ink">{o.product_name}</b> {o.bottles === 1 ? 'vuelve' : 'vuelven'} al stock y {o.bottles === 1 ? 'deja' : 'dejan'} de contar como
          costo del evento ({money(o.cost, { decimals: 0 })}). Hacelo solo si en realidad no se abrieron.
        </>
      ),
      confirmText: 'Sí, quitar',
      danger: true,
    })
    if (ok) removeOpened.mutate(o.id)
  }

  const goSale = () => navigate(`/ventas?nuevo=1&evento=${ev.id}`)
  // «Vender entradas»: la venta arranca con el renglón «Entrada» (precio de la entrada × personas).
  const goTickets = () => navigate(`/ventas?nuevo=1&evento=${ev.id}&entrada=1`)
  const goExpense = () => navigate(`/gastos?nuevo=1&evento=${ev.id}`)

  // ─────────── Tablas ───────────
  const saleCols: Column<EventSale>[] = [
    { key: 'date', header: 'Fecha', cell: (x) => <span className="whitespace-nowrap">{dateShort(x.date)}</span>, className: 'w-[1%]', hideBelow: 'sm' },
    {
      key: 'items_label',
      header: 'Qué se vendió',
      value: (x) => `${x.items_label} ${x.client_name ?? ''}`,
      cell: (x) => (
        <div className="min-w-0">
          <span className="font-semibold text-ink">{x.items_label}</span>
          <span className="block text-[12.5px] text-muted">
            <MobileDate date={x.date} />
            {x.client_name || 'Consumidor final'}
          </span>
        </div>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (x) => (
        <>
          <span className="font-bold">{money(x.total, { decimals: 0 })}</span>
          <span className="mt-1 block md:hidden">
            <StatusBadge status={x.status} overdue={x.overdue} kind="sale" />
          </span>
        </>
      ),
      footer: money(s.revenue, { decimals: 0 }),
    },
    {
      key: 'profit',
      header: 'Te quedó',
      align: 'right',
      cell: (x) => <span className={resultClass(x.profit)}>{money(x.profit, { decimals: 0 })}</span>,
      hideBelow: 'sm',
      footer: money(sales.reduce((a, x) => a + x.profit, 0), { decimals: 0 }),
    },
    { key: 'status', header: 'Cobro', value: (x) => x.status, cell: (x) => <StatusBadge status={x.status} overdue={x.overdue} kind="sale" />, hideBelow: 'md', className: 'w-[1%]' },
  ]
  const expenseCols: Column<ExpenseWithStatus>[] = [
    { key: 'date', header: 'Fecha', cell: (x) => <span className="whitespace-nowrap">{dateShort(x.date)}</span>, className: 'w-[1%]', hideBelow: 'sm' },
    {
      key: 'description',
      header: 'Gasto',
      value: (x) => `${x.description} ${x.category}`,
      cell: (x) => (
        <div className="min-w-0">
          <span className="font-semibold text-ink">{x.description}</span>
          <span className="block text-[12.5px] text-muted">
            <MobileDate date={x.date} />
            {x.category}
          </span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Monto',
      align: 'right',
      cell: (x) => (
        <>
          <span className="font-bold">{money(x.amount, { decimals: 0 })}</span>
          <span className="mt-1 block sm:hidden">
            <StatusBadge status={x.status} overdue={x.overdue} />
          </span>
        </>
      ),
      footer: money(s.expenses, { decimals: 0 }),
    },
    { key: 'status', header: 'Pago', value: (x) => x.status, cell: (x) => <StatusBadge status={x.status} overdue={x.overdue} />, hideBelow: 'sm', className: 'w-[1%]' },
  ]
  const openedCols: Column<OpenedBottle>[] = [
    { key: 'date', header: 'Fecha', cell: (x) => <span className="whitespace-nowrap">{dateShort(x.date)}</span>, className: 'w-[1%]', hideBelow: 'sm' },
    {
      key: 'product_name',
      header: 'Vino',
      value: (x) => `${x.product_name} ${x.product_winery ?? ''}`,
      cell: (x) => (
        <div className="min-w-0">
          <Link to={`/vinos/${x.product_id}`} className="font-semibold text-ink hover:underline">
            {x.product_name}
          </Link>
          <span className="block text-[12.5px] text-muted">
            <MobileDate date={x.date} />
            {[x.product_winery, x.kind !== 'degustacion' ? x.kind_label : null, x.notes].filter(Boolean).join(' · ') || 'Degustación'}
          </span>
        </div>
      ),
    },
    { key: 'bottles', header: 'Botellas', align: 'right', cell: (x) => int(x.bottles), footer: int(s.bottles_opened) },
    { key: 'unit_cost', header: 'Costo c/u', align: 'right', cell: (x) => money(x.unit_cost, { decimals: 0 }), hideBelow: 'sm' },
    { key: 'cost', header: 'Costo', align: 'right', cell: (x) => <b>{money(x.cost, { decimals: 0 })}</b>, footer: money(s.bottles_opened_cost, { decimals: 0 }) },
    {
      key: 'actions',
      header: '',
      sortable: false,
      className: 'w-[1%]',
      cell: (x) => (
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          aria-label={`Quitar ${x.product_name}`}
          title="Quitar (las botellas vuelven al stock)"
          className="!px-0 text-ink-soft hover:bg-bad-soft hover:text-bad"
          onClick={(e) => {
            e.stopPropagation()
            askRemoveOpened(x)
          }}
        />
      ),
    },
  ]

  const ticketHint = ev.ticket_price ? ` a ${money(ev.ticket_price, { decimals: 0 })}` : ''

  return (
    <>
      <BackLink />
      <PageHeader
        title={ev.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <KindBadge kind={ev.kind} />
            <span className="inline-flex items-center gap-1 first-letter:uppercase">
              <CalendarHeart size={15} className="text-muted" aria-hidden />
              {dateLong(ev.date)}
            </span>
            {ev.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={15} className="text-muted" aria-hidden />
                {ev.location}
              </span>
            )}
            {ev.attendees ? (
              <span className="inline-flex items-center gap-1">
                <Users size={15} className="text-muted" aria-hidden />
                {int(ev.attendees)} {ev.attendees === 1 ? 'persona' : 'personas'}
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <ExportButton path={`/events/${ev.id}/export`} />
            <Button icon={Pencil} onClick={() => setEditOpen(true)}>
              Editar
            </Button>
            <Button variant="ghost" icon={Trash2} className="text-bad hover:bg-bad-soft hover:text-bad" onClick={askDelete} loading={remove.isPending}>
              Borrar
            </Button>
          </>
        }
      />

      {(isUpcoming || isToday) && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-sky/70 bg-sky-soft/60 px-4 py-3 text-[14.5px] text-ink">
          <CalendarClock size={19} className="mt-0.5 shrink-0 text-sky-deep" aria-hidden />
          <span className="min-w-0">
            <b>{isToday ? '¡El evento es hoy!' : `El evento es ${relativeDays(ev.date)}.`}</b> Por ahora ves lo que llevás puesto. Cargá los gastos a medida que salen y, cuando
            termine, las ventas y las botellas que abriste: ahí vas a ver si te convino.
          </span>
        </div>
      )}

      <HelpBox id="eventos-ficha" title="¿Qué ves en esta ficha?">
        <p>
          Las <b>cuentas de este evento</b>, de arriba hacia abajo: lo que entró (entradas + vino vendido) menos lo que costó hacerlo (el vino vendido, las comisiones, los gastos
          y las botellas que abriste para degustar). Lo que queda es el <b>resultado</b>.
        </p>
        <p>
          Para que los números sean completos, cargá todo <b>eligiendo este evento</b>: las ventas (también las entradas), los gastos (copas, picada, difusión) y las botellas
          abiertas. Con los botones de abajo ya van con el evento elegido.
        </p>
      </HelpBox>

      {/* Acciones: todo lo que se carga de un evento */}
      <Card className="mt-5" title="Cargá lo del evento" subtitle="Todo lo que cargues desde acá queda asociado a este evento.">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={Store} onClick={goSale}>
            Cargar venta del evento
          </Button>
          <Button icon={Ticket} onClick={goTickets}>
            Vender entradas
          </Button>
          <Button icon={Receipt} onClick={goExpense}>
            Cargar gasto del evento
          </Button>
          <Button icon={Wine} onClick={() => setBottlesOpen(true)}>
            Registrar botellas abiertas
          </Button>
        </div>
        <p className="mt-3 flex items-start gap-2 text-[13.5px] leading-snug text-ink-soft">
          <Ticket size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <span>
            <b className="text-ink">Entradas:</b> «Vender entradas» arma la venta con un renglón «Entrada»{ticketHint}
            {ev.attendees ? ` × ${int(ev.attendees)} ${ev.attendees === 1 ? 'persona' : 'personas'}` : ''}: revisá cuántas fueron y el precio antes de guardar. No es vino: no
            toca el stock y se ve separado de las botellas.
            {s.tickets_qty > 0 && (
              <b className="text-ink">
                {' '}
                Ojo: sus ventas ya tienen {int(s.tickets_qty)} {s.tickets_qty === 1 ? 'entrada u otro ítem' : 'entradas u otros ítems'} que no son vino; fijate de no cargarlas dos veces.
              </b>
            )}
          </span>
        </p>
        {isPast && (
          <p className="mt-2 flex items-start gap-2 text-[13.5px] leading-snug text-ink-soft">
            <CalendarHeart size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <span>
              <b className="text-ink">Fecha:</b> el evento fue el {dateLong(ev.date)}. La venta y el gasto que cargues desde acá arrancan con esa fecha, así cuentan en el mes
              que corresponde. Si fueron otro día, cambiala en el formulario.
            </span>
          </p>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Breakdown s={s} />

        <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Kpi
              label="Por persona"
              info={EXPLAIN.por_persona}
              value={hasData && s.per_attendee != null ? money(s.per_attendee, { decimals: 0 }) : '—'}
              valueClassName={hasData && s.per_attendee != null ? resultClass(s.per_attendee) : undefined}
              hint={
                ev.attendees ? (
                  `${int(ev.attendees)} ${ev.attendees === 1 ? 'persona' : 'personas'}${hasData ? '' : ' · falta cargar ventas y gastos'}`
                ) : (
                  <button type="button" onClick={() => setEditOpen(true)} className="font-bold text-sky-deep hover:underline">
                    Cargá cuántos fueron
                  </button>
                )
              }
            />
            <Kpi
              label="Retorno"
              info={EXPLAIN.retorno}
              value={s.roi != null ? pct(s.roi, 0) : '—'}
              valueClassName={s.roi != null ? resultClass(s.roi) : undefined}
              hint={
                s.roi != null
                  ? s.roi >= 0
                    ? `Por cada $\u00a0100 que pusiste volvieron $\u00a0${int(Math.round(100 + s.roi * 100))}`
                    : `De cada $\u00a0100 que pusiste recuperaste $\u00a0${int(Math.max(0, Math.round(100 + s.roi * 100)))}`
                  : 'Sin gastos ni botellas abiertas'
              }
            />
            <Kpi
              label="Vendidas por abierta"
              info={{
                title: 'Botellas vendidas por cada abierta',
                text: 'Cuántas botellas vendiste por cada una que abriste para degustar. Mide si la degustación «convierte»: si abrís mucho y vendés poco, probá con menos vinos o con un precio especial del día.',
              }}
              value={s.bottles_opened > 0 ? num(s.bottles_sold / s.bottles_opened, 1) : '—'}
              hint={`${fmtBottles(s.bottles_sold)} vendidas · ${int(s.bottles_opened)} ${s.bottles_opened === 1 ? 'abierta' : 'abiertas'}`}
            />
            <Kpi
              label="Presupuesto"
              info={EXPLAIN.presupuesto}
              value={ev.budget ? pct(s.investment / ev.budget, 0) : '—'}
              valueClassName={ev.budget && s.investment > ev.budget ? 'text-bad' : undefined}
              hint={
                ev.budget ? (
                  <>
                    <ProgressBar className="my-1" value={s.investment} max={ev.budget} mode="budget" showLabel={false} />
                    {nb(money(s.investment, { decimals: 0 }))} de {nb(money(ev.budget, { decimals: 0 }))}
                    {s.investment > ev.budget ? <b className="text-bad"> · te pasaste</b> : null}
                  </>
                ) : (
                  <button type="button" onClick={() => setEditOpen(true)} className="font-bold text-sky-deep hover:underline">
                    Ponele un tope
                  </button>
                )
              }
            />
          </div>

          <Card
            title={
              <span className="inline-flex items-center gap-1.5">
                ¿Volvieron a comprar?
                <InfoTip
                  title="Ventas después del evento"
                  text={`Miramos a los clientes que compraron en el evento (los que cargaste con nombre) y sumamos lo que te compraron en los ${after.days} días siguientes, fuera del evento. Es plata que el evento trajo aunque no se vea ese día. No se suma al resultado del evento: es un dato aparte.`}
                />
              </span>
            }
          >
            {after.clients === 0 ? (
              <p className="text-[14px] leading-snug text-ink-soft">
                {s.sales_count ? 'Ninguna venta del evento tiene cliente cargado.' : 'Todavía no hay ventas del evento.'} Si cargás el nombre del cliente en cada venta, acá vas a
                ver si después volvió a comprarte.
              </p>
            ) : (
              <p className="text-[14px] leading-snug text-ink-soft">
                De <b className="text-ink">{int(after.clients)}</b> {after.clients === 1 ? 'cliente que compró' : 'clientes que compraron'} en el evento,{' '}
                <b className="text-ink">{int(after.returning_clients)}</b> {after.returning_clients === 1 ? 'volvió' : 'volvieron'} a comprarte en los {after.days} días siguientes
                {after.sales_count > 0 ? (
                  <>
                    : {after.sales_count === 1 ? '1 venta' : `${int(after.sales_count)} ventas`} por <b className="vh-num text-ink">{nb(money(after.revenue, { decimals: 0 }))}</b>.
                  </>
                ) : (
                  '.'
                )}
                {!after.complete && <span className="block pt-1 text-[12.5px] text-muted">Todavía no pasaron los {after.days} días: el número puede crecer.</span>}
              </p>
            )}
          </Card>
        </div>
      </div>

      {/* Ventas, gastos y botellas del evento */}
      <Card className="mt-4" flush>
        <div className="px-4 pt-4 sm:px-5 sm:pt-5">
          <Tabs<TabKey>
            value={tab}
            onChange={setTab}
            items={[
              { key: 'ventas', label: 'Ventas', icon: Store, count: sales.length },
              { key: 'gastos', label: 'Gastos', icon: Receipt, count: expenses.length },
              { key: 'botellas', label: 'Botellas abiertas', icon: Wine, count: opened.length },
            ]}
          />
          <p className="mt-2 text-[13.5px] text-ink-soft">
            {tab === 'ventas'
              ? 'Las ventas cargadas con este evento (entradas y vino). Tocá una para ver el detalle, registrar el cobro o editarla.'
              : tab === 'gastos'
                ? 'Los gastos cargados con este evento. Tocá uno para ver el detalle, registrar el pago o editarlo.'
                : 'Las botellas que salieron del stock para degustar. Si cargaste una de más, quitala con el tachito: vuelve al stock.'}
          </p>
        </div>
        <div className="px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
          {tab === 'ventas' ? (
            <DataTable
              rows={sales}
              columns={saleCols}
              rowKey={(x) => x.id}
              onRowClick={(x) => navigate(`/ventas?ver=${x.id}`)}
              searchable={sales.length > 8}
              searchPlaceholder="Buscar venta…"
              pageSize={10}
              rowClassName={(x) => (x.overdue ? 'bg-bad-soft/25' : undefined)}
              empty={
                <EmptyState
                  compact
                  icon={Store}
                  title="Todavía no hay ventas del evento"
                  action={
                    <Button icon={Store} onClick={goSale}>
                      Cargar venta del evento
                    </Button>
                  }
                >
                  Cargá lo que vendiste ahí (vino y entradas) eligiendo este evento, así entra en sus cuentas.
                </EmptyState>
              }
            />
          ) : tab === 'gastos' ? (
            <DataTable
              rows={expenses}
              columns={expenseCols}
              rowKey={(x) => x.id}
              onRowClick={(x) => navigate(`/gastos?ver=${x.id}`)}
              searchable={expenses.length > 8}
              searchPlaceholder="Buscar gasto…"
              pageSize={10}
              rowClassName={(x) => (x.overdue ? 'bg-bad-soft/25' : undefined)}
              empty={
                <EmptyState
                  compact
                  icon={Receipt}
                  title="Todavía no hay gastos del evento"
                  action={
                    <Button icon={Receipt} onClick={goExpense}>
                      Cargar gasto del evento
                    </Button>
                  }
                >
                  Copas, hielo, picada, difusión, alquiler del lugar… Cargalos eligiendo este evento para saber cuánto te costó de verdad.
                </EmptyState>
              }
            />
          ) : (
            <DataTable
              rows={opened}
              columns={openedCols}
              rowKey={(x) => x.id}
              searchable={opened.length > 8}
              searchPlaceholder="Buscar vino…"
              pageSize={10}
              empty={
                <EmptyState
                  compact
                  icon={Wine}
                  title="No registraste botellas abiertas"
                  action={
                    <Button icon={Wine} onClick={() => setBottlesOpen(true)}>
                      Registrar botellas abiertas
                    </Button>
                  }
                >
                  Si abriste botellas para que la gente pruebe, registralas: salen del stock y cuentan como costo del evento.
                </EmptyState>
              }
            />
          )}
        </div>
      </Card>

      <EventFormModal
        open={editOpen}
        event={ev}
        linked={{ sales: s.sales_count, expenses: s.expenses_count, openedOnDate: opened.filter((o) => o.date === ev.date).length }}
        onClose={() => setEditOpen(false)}
      />
      <OpenBottlesModal open={bottlesOpen} event={ev} onClose={() => setBottlesOpen(false)} />
      <Modal
        open={cantDelete}
        onClose={() => setCantDelete(false)}
        size="sm"
        title="Mejor no borrarlo"
        footer={
          <Button variant="primary" onClick={() => setCantDelete(false)} data-autofocus>
            Entendido
          </Button>
        }
      >
        <div className="space-y-2 text-[15px] text-ink-soft">
          <p>
            «{ev.name}» tiene{' '}
            {joinParts([
              s.sales_count ? `${int(s.sales_count)} ${s.sales_count === 1 ? 'venta' : 'ventas'}` : '',
              s.expenses_count ? `${int(s.expenses_count)} ${s.expenses_count === 1 ? 'gasto' : 'gastos'}` : '',
              s.opened_count ? `botellas abiertas cargadas` : '',
            ])}
            . Si lo borrás, perdés la cuenta de cuánto te costó y cuánto te dejó.
          </p>
          <p>Si igual querés borrarlo: {joinParts(unlinkSteps(s))}. Después vas a poder borrarlo.</p>
        </div>
      </Modal>
    </>
  )
}

/** Qué hay que hacer para poder borrar el evento, según lo que tenga cargado. */
function unlinkSteps(s: EventSummary): string[] {
  const steps: string[] = []
  if (s.sales_count && s.expenses_count) steps.push('sacale el evento a esas ventas y gastos (o borralos) desde Ventas y Gastos')
  else if (s.sales_count) steps.push(s.sales_count === 1 ? 'sacale el evento a esa venta (o borrala) desde Ventas' : 'sacale el evento a esas ventas (o borralas) desde Ventas')
  else if (s.expenses_count) steps.push(s.expenses_count === 1 ? 'sacale el evento a ese gasto (o borralo) desde Gastos' : 'sacale el evento a esos gastos (o borralos) desde Gastos')
  if (s.opened_count) steps.push('quitá las botellas abiertas desde la pestaña de abajo (vuelven al stock)')
  return steps
}

function joinParts(parts: string[]): string {
  const p = parts.filter(Boolean)
  if (p.length <= 1) return p.join('')
  return `${p.slice(0, -1).join(', ')} y ${p[p.length - 1]}`
}

/** En celular la columna «Fecha» se esconde: la fecha va en la línea chica de abajo. */
function MobileDate({ date }: { date: string }) {
  return <span className="whitespace-nowrap sm:hidden">{nb(dateShort(date))} · </span>
}

function BackLink() {
  return (
    <Link to="/eventos" className="vh-no-print mb-3 inline-flex items-center gap-1 text-[14px] font-bold text-ink-soft hover:text-ink">
      <ArrowLeft size={16} aria-hidden /> Eventos
    </Link>
  )
}

/** Un renglón de las cuentas del evento: signo, concepto (con su "?"), barrita proporcional y monto. */
function Line({
  sign,
  label,
  sub,
  value,
  color,
  scale,
  term,
  info,
}: {
  sign: '+' | '−'
  label: string
  sub?: ReactNode
  value: number
  color: string
  scale: number
  term?: GlossaryKey
  info?: { title: string; text: string }
}) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-2 py-2.5">
      <span className={clsx('pt-px text-center text-[17px] leading-none font-extrabold', sign === '+' ? 'text-sky-deep' : 'text-coral-deep')} aria-hidden>
        {sign}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-ink">{label}</span>
          {term && <InfoTip term={term} />}
          {info && <InfoTip title={info.title} text={info.text} />}
        </div>
        {sub && <p className="text-[12.5px] text-muted">{sub}</p>}
      </div>
      <span className="vh-num pt-px text-right font-bold whitespace-nowrap text-ink">
        {sign === '−' && value > 0 ? '−' : ''}
        {money(value, { decimals: 0 })}
      </span>
      {/* La barrita ocupa todo el ancho (debajo del concepto y del monto): así todas miden lo mismo y la escala es la misma. */}
      <span className="col-span-2 col-start-2 mt-1.5 block h-1.5 rounded-full bg-cream-deep" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${value > 0 && scale > 0 ? Math.max(1.5, Math.min(100, (value / scale) * 100)) : 0}%`, background: color }} />
      </span>
    </li>
  )
}

/** Las cuentas del evento, de arriba hacia abajo, como un estado de resultados chiquito. */
function Breakdown({ s }: { s: EventSummary }) {
  const scale = Math.max(s.revenue, s.costs, 1)
  return (
    <Card
      title="Las cuentas del evento"
      subtitle="Lo que entró menos lo que costó hacerlo. Las barritas están en la misma escala, para comparar de un vistazo."
    >
      <ul className="divide-y divide-line/80">
        <Line
          sign="+"
          label="Entradas"
          info={EXPLAIN.entradas}
          sub={s.tickets_qty ? `${int(s.tickets_qty)} ${s.tickets_qty === 1 ? 'entrada' : 'entradas'} u otros ítems` : 'Sin entradas cobradas'}
          value={s.tickets}
          color={CHART_COLORS.ventas}
          scale={scale}
        />
        <Line
          sign="+"
          label="Ventas de vino"
          info={EXPLAIN.ventas_vino}
          sub={s.sales_count ? `${fmtBottles(s.bottles_sold)} en ${s.sales_count === 1 ? '1 venta' : `${int(s.sales_count)} ventas`}` : 'Sin ventas cargadas'}
          value={s.wine_sales}
          color={CHART_COLORS.ventas}
          scale={scale}
        />
      </ul>
      <div className="flex items-center justify-between gap-3 border-y-2 border-line-strong py-2.5 pl-[1.75rem]">
        <span className="inline-flex items-center gap-1.5 font-extrabold text-ink">
          Ingresos del evento <InfoTip title={EXPLAIN.ingresos.title} text={EXPLAIN.ingresos.text} />
        </span>
        <span className="vh-num font-extrabold whitespace-nowrap text-ink">{money(s.revenue, { decimals: 0 })}</span>
      </div>
      <ul className="divide-y divide-line/80">
        <Line sign="−" label="Costo del vino vendido" term="cmv" sub="Lo que te costaron las botellas vendidas" value={s.cogs} color={CHART_COLORS.costo} scale={scale} />
        <Line sign="−" label="Comisiones de cobro" term="comisiones" sub="Mercado Pago, tarjetas, posnet" value={s.fees} color={CHART_COLORS.gastos} scale={scale} />
        <Line
          sign="−"
          label="Gastos del evento"
          info={EXPLAIN.gastos_evento}
          sub={s.expenses_count ? `${int(s.expenses_count)} ${s.expenses_count === 1 ? 'gasto' : 'gastos'}` : 'Sin gastos cargados'}
          value={s.expenses}
          color={CHART_COLORS.gastos}
          scale={scale}
        />
        <Line
          sign="−"
          label="Botellas abiertas"
          info={EXPLAIN.botellas_abiertas}
          sub={s.bottles_opened ? `${fmtBottles(s.bottles_opened)}, a su costo` : 'Ninguna registrada'}
          value={s.bottles_opened_cost}
          color={CHART_COLORS.costo}
          scale={scale}
        />
      </ul>
      <div className={clsx('mt-1 flex items-center justify-between gap-3 rounded-xl px-3 py-3', s.result > 0.004 ? 'bg-good-soft/70' : s.result < -0.004 ? 'bg-bad-soft/70' : 'bg-cream-deep')}>
        <span className="inline-flex items-center gap-1.5 text-[16px] font-extrabold text-ink">
          = Resultado <InfoTip title={EXPLAIN.resultado.title} text={EXPLAIN.resultado.text} />
        </span>
        <span className={clsx('vh-num text-[1.5rem] leading-none font-extrabold whitespace-nowrap', resultClass(s.result))}>{money(s.result, { decimals: 0 })}</span>
      </div>
      <p className="mt-3 text-[14px] leading-snug text-ink-soft">
        {s.revenue === 0 && s.costs === 0 ? (
          'Todavía no hay nada cargado para este evento. Usá los botones de arriba: cada venta, gasto y botella abierta que cargues va sumando acá.'
        ) : (
          <>
            <b className="text-ink">{resultPhrase(s.result)}.</b>{' '}
            {s.result >= -0.004
              ? s.investment > 0
                ? s.result > 0.004
                  ? `Lo que pusiste (${nb(money(s.investment, { decimals: 0 }))} entre gastos y botellas abiertas) volvió y sobró.`
                  : `Lo que entró alcanzó justo para cubrir lo que pusiste (${nb(money(s.investment, { decimals: 0 }))} entre gastos y botellas abiertas).`
                : 'No tuvo gastos ni botellas abiertas cargadas: si los hubo, cargalos para ver el resultado real.'
              : s.revenue > 0
                ? `Lo que entró no alcanzó a cubrir lo que costó. Mirá qué gasto se puede achicar o si conviene cobrar entrada.`
                : 'Por ahora solo hay costos cargados: faltan las ventas del evento.'}
          </>
        )}
      </p>
    </Card>
  )
}
