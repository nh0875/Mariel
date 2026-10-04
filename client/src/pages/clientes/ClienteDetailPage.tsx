// Ficha de un cliente: cómo contactarlo (teléfono, WhatsApp, email), cuánto te compró,
// cada cuánto compra, qué vinos prefiere, lo que te debe (con "Registrar cobro" en cada venta)
// y todas sus ventas. Todos los números salen de GET /api/clients/:id (mismas fórmulas que Ventas).
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, HandCoins, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Power, Receipt, StickyNote, Trash2, TriangleAlert, Users, Wine } from 'lucide-react'
import { CHART_COLORS, SALE_CHANNEL_LABELS, type SaleChannel } from '@shared/constants'
import type { SaleWithStatus } from '@shared/types'
import { ApiError, api } from '@/lib/api'
import { bottles as fmtBottles, date as fmtDate, dateShort, int, money, pct, relativeDays } from '@/lib/format'
import { useApi, useApiMutation, useSettings } from '@/lib/queries'
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, HelpBox, InfoTip, Loading, PageHeader, StatusBadge, useConfirm, type Column } from '@/components/ui'
import { ChartCard, ColumnChart, RankBars } from '@/components/charts'
import { SettlementModal } from '@/components/forms/SettlementModal'
import { ICON_ONLY, Kpi, nb, telLink, tileMoney, waLink } from '../caja/parts'
import type { ClientDetail } from '../caja/types'
import { ClientFormModal } from './ClientFormModal'
import { BalanceBadge, KIND_SHORT, KIND_TONE } from './ClientesPage'

function ContactRow({ icon: Icon, children }: { icon: typeof Phone; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5 text-[14.5px]">
      <Icon size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  )
}

function BackLink() {
  return (
    <Link to="/clientes" className="vh-no-print mb-3 inline-flex items-center gap-1 text-[14px] font-bold text-ink-soft hover:text-ink">
      <ArrowLeft size={16} aria-hidden /> Clientes
    </Link>
  )
}

/** "Mayorista (restós, vinotecas)" → "Mayorista"; "Local / Tienda" → "Local". */
const channelShort = (ch: string) => (SALE_CHANNEL_LABELS[ch as SaleChannel] ?? ch).split(/ [(/]/)[0]

const saleStatusText = (s: SaleWithStatus) => (s.status === 'pagado' ? 'Cobrada' : s.overdue ? 'Vencida' : s.status === 'parcial' ? 'Cobro parcial' : 'Por cobrar')

/** Primer nombre para saludar por WhatsApp ("Ana Pérez" → "Ana"; un restó se saluda entero). */
const greetName = (name: string, kind: string) => (kind === 'consumidor' ? name.split(/\s+/)[0] : name)

type Settle = { id: number; balance: number; description: string; account: number | null }

export default function ClienteDetailPage() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [gone, setGone] = useState(false)
  const q = useApi<ClientDetail>(`/clients/${id}`, undefined, { enabled: id > 0 && !gone, retry: false })
  const { data: settings } = useSettings()
  const [editOpen, setEditOpen] = useState(false)
  const [settle, setSettle] = useState<Settle | null>(null)

  const toggleActive = useApiMutation((active: boolean) => api.put(`/clients/${id}`, { active }), {
    success: (_r, active) => (active ? 'Cliente reactivado: vuelve a aparecer al cargar ventas.' : 'Cliente desactivado. Su historial se conserva.'),
  })
  const remove = useApiMutation(
    async () => {
      // Dejamos de pedir la ficha antes de borrar (si no, se refresca y da "no encontrado").
      setGone(true)
      await api.del(`/clients/${id}`)
    },
    {
      success: 'Cliente borrado',
      onSuccess: () => navigate('/clientes', { replace: true }),
      onError: () => setGone(false),
    },
  )

  if (!(id > 0) || (q.error instanceof ApiError && q.error.status === 404)) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={Users}
          title="No encontramos ese cliente"
          action={
            <Button icon={ArrowLeft} onClick={() => navigate('/clientes')}>
              Ver todos los clientes
            </Button>
          }
        >
          Puede que se haya borrado. Buscalo en la lista de clientes.
        </EmptyState>
      </>
    )
  }
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Loading />

  const { client: c, sales, stats, monthly } = q.data
  const hasSales = stats.purchases_count > 0
  const pending = sales.filter((s) => s.balance > 0.01).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const business = settings?.business.name || 'VINOH!'
  const hello = `¡Hola, ${greetName(c.name, c.kind)}! `
  const wa = waLink(c.phone, hello)
  const waDebt = stats.balance > 0.01 ? waLink(c.phone, `${hello}¿Cómo andás? Te escribo de ${business} por el saldo pendiente de ${money(stats.balance)}. Avisame cuando puedas. ¡Gracias!`) : null
  const accountFor = (method: string) => settings?.payment_methods.find((m) => m.key === method)?.account_id ?? null
  const newSaleUrl = `/ventas?nuevo=1&cliente=${c.id}`
  // "Hace rato que no compra": pasaron más del doble de días que su frecuencia habitual (y al menos 45).
  const late = stats.frequency_days != null && stats.days_since_last != null && stats.days_since_last > Math.max(45, stats.frequency_days * 2)
  const months12 = monthly.reduce((s, m) => s + m.total, 0)

  const askDeactivate = async () => {
    const ok = await confirm({
      title: `¿Desactivar a ${c.name}?`,
      message: 'Deja de aparecer al cargar ventas. Sus ventas, cobros y números se conservan, y lo podés reactivar cuando quieras.',
      confirmText: 'Sí, desactivar',
    })
    if (ok) toggleActive.mutate(false)
  }
  const askDelete = async () => {
    const ok = await confirm({
      title: `¿Borrar a ${c.name}?`,
      message: 'No tiene ventas cargadas, así que se puede borrar sin perder nada. No se puede deshacer.',
      confirmText: 'Sí, borrar',
      danger: true,
    })
    if (ok) remove.mutate()
  }
  const openSettle = (s: SaleWithStatus) => setSettle({ id: s.id, balance: s.balance, description: `Venta #${s.id} · ${c.name}`, account: accountFor(s.payment_method) })

  const saleCols: Column<SaleWithStatus>[] = [
    {
      key: 'date',
      header: 'Fecha',
      cell: (s) => <span className="whitespace-nowrap">{nb(dateShort(s.date))}</span>,
      className: 'w-[1%]',
      hideBelow: 'sm',
      footer: 'Total',
    },
    {
      key: 'id',
      header: 'Venta',
      value: (s) => `#${s.id} ${channelShort(s.channel)}`,
      cell: (s) => (
        <div className="min-w-0">
          <span className="font-semibold text-ink">Venta #{s.id}</span>
          <span className="block text-[12.5px] text-muted">
            <span className="sm:hidden">{nb(dateShort(s.date))} · </span>
            {channelShort(s.channel)}
            <span className="sm:hidden"> · {fmtBottles(s.bottles)}</span>
          </span>
        </div>
      ),
      footer: <span className="sm:hidden">Total</span>,
    },
    { key: 'bottles', header: 'Botellas', align: 'right', hideBelow: 'sm', cell: (s) => int(s.bottles), footer: int(stats.bottles) },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (s) => (
        <>
          <span className="font-bold">{nb(money(s.total))}</span>
          <span className="mt-1 block md:hidden">
            <StatusBadge status={s.status} overdue={s.overdue} kind="sale" />
          </span>
        </>
      ),
      footer: nb(money(stats.total_bought)),
    },
    { key: 'status', header: 'Estado', value: saleStatusText, hideBelow: 'md', className: 'w-[1%]', cell: (s) => <StatusBadge status={s.status} overdue={s.overdue} kind="sale" /> },
    {
      key: 'balance',
      header: 'Falta cobrar',
      align: 'right',
      hideBelow: 'lg',
      cell: (s) => (s.balance > 0.01 ? <span className={s.overdue ? 'font-bold text-bad' : 'text-ink'}>{nb(money(s.balance))}</span> : <span className="text-muted">—</span>),
      footer: stats.balance > 0.01 ? nb(money(stats.balance)) : '—',
    },
  ]

  const favTable = {
    columns: [
      { key: 'name', header: 'Vino' },
      { key: 'bottles', header: 'Botellas', align: 'right' as const, format: (v: unknown) => int(Number(v)) },
      { key: 'total', header: 'Lo que pagó', align: 'right' as const, format: (v: unknown) => money(Number(v), { decimals: 0 }) },
    ],
    rows: stats.favorite_wines as unknown as Record<string, unknown>[],
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={c.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={KIND_TONE[c.kind]}>{KIND_SHORT[c.kind]}</Badge>
            <span>{stats.first_purchase ? `Te compra desde el ${fmtDate(stats.first_purchase)}` : 'Todavía no te compró'}</span>
            {!c.active && <Badge>Desactivado</Badge>}
          </span>
        }
        actions={
          <>
            <Button icon={Pencil} onClick={() => setEditOpen(true)}>
              Editar
            </Button>
            {hasSales ? (
              c.active && (
                <Button variant="ghost" icon={Power} onClick={askDeactivate} loading={toggleActive.isPending}>
                  Desactivar
                </Button>
              )
            ) : (
              <Button variant="ghost" icon={Trash2} className="text-bad hover:bg-bad-soft hover:text-bad" onClick={askDelete} loading={remove.isPending}>
                Borrar
              </Button>
            )}
            {c.active && (
              <Button variant="primary" icon={Plus} onClick={() => navigate(newSaleUrl)}>
                Nueva venta a este cliente
              </Button>
            )}
          </>
        }
      />

      {!c.active && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line-strong bg-cream-deep px-4 py-3 text-[14.5px] text-ink">
          <Power size={18} className="text-muted" aria-hidden />
          <span className="min-w-0 flex-1">
            <b>Este cliente está desactivado:</b> no aparece al cargar ventas. Su historial y lo que te debe se conservan.
          </span>
          <Button variant="primary" size="sm" onClick={() => toggleActive.mutate(true)} loading={toggleActive.isPending}>
            Reactivarlo
          </Button>
        </div>
      )}

      <HelpBox id="cliente-ficha" title="¿Qué ves en esta ficha?">
        <p>
          Todo lo de <b>{c.name}</b>: cómo contactarlo, cuánto te compró, cada cuánto vuelve, qué vinos le gustan y si te debe algo. Por ejemplo: si te compró 4 veces por un total de $ 288.000,
          su ticket promedio es $ 72.000; si su última compra fue hace 3 meses y suele comprar cada mes, es momento de escribirle.
        </p>
        <p>
          <b>¿Por qué importa?</b> Venderle de nuevo a alguien que ya te conoce es mucho más fácil (y barato) que conseguir un cliente nuevo. Con sus vinos favoritos sabés qué ofrecerle cuando
          llega algo parecido.
        </p>
      </HelpBox>

      {late && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[14.5px] text-ink">
          <TriangleAlert size={18} className="shrink-0 text-warn" aria-hidden />
          <span className="min-w-0 flex-1">
            <b>Hace rato que no te compra:</b> suele comprar cada {int(stats.frequency_days)} días y ya pasaron {int(stats.days_since_last)}. Escribile con alguna novedad o un vino parecido a los que le
            gustan.
          </span>
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-paper px-3 text-[13px] font-bold text-ink shadow-sm hover:bg-cream">
              <MessageCircle size={15} aria-hidden /> Escribirle
            </a>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* Datos de contacto */}
        <Card title="Datos de contacto" actions={<Button size="sm" variant="ghost" icon={Pencil} className={ICON_ONLY} onClick={() => setEditOpen(true)} aria-label="Editar datos de contacto" title="Editar datos de contacto" />}>
          {c.phone || c.email || c.address || c.city || c.tax_id || c.notes ? (
            <>
              <ul className="space-y-2.5">
                {c.phone && (
                  <ContactRow icon={Phone}>
                    <a href={telLink(c.phone)} className="font-semibold text-sky-deep hover:underline">
                      {c.phone}
                    </a>
                  </ContactRow>
                )}
                {c.email && (
                  <ContactRow icon={Mail}>
                    <a href={`mailto:${c.email}`} className="font-semibold break-all text-sky-deep hover:underline">
                      {c.email}
                    </a>
                  </ContactRow>
                )}
                {(c.address || c.city) && <ContactRow icon={MapPin}>{[c.address, c.city].filter(Boolean).join(', ')}</ContactRow>}
                {c.tax_id && <ContactRow icon={FileText}>CUIT / DNI {c.tax_id}</ContactRow>}
                {c.notes && (
                  <ContactRow icon={StickyNote}>
                    <span className="whitespace-pre-line text-ink-soft">{c.notes}</span>
                  </ContactRow>
                )}
              </ul>
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-paper px-3.5 text-[13.5px] font-bold text-ink hover:border-good/60 hover:bg-good-soft"
                >
                  <MessageCircle size={16} className="text-good" aria-hidden /> Mandarle un WhatsApp
                </a>
              )}
            </>
          ) : (
            <p className="text-[14px] text-ink-soft">
              Todavía no cargaste teléfono ni email.{' '}
              <button type="button" className="font-bold text-sky-deep hover:underline" onClick={() => setEditOpen(true)}>
                Agregalos
              </button>{' '}
              para escribirle por WhatsApp con un toque.
            </p>
          )}
        </Card>

        {/* Números */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Kpi
            label="Total comprado"
            tone="sky"
            info={{
              title: 'Total comprado',
              text: `La suma de todas sus ventas (con descuentos y envíos), cobradas o no. De eso, después de pagar las botellas y las comisiones, te quedaron ${money(stats.profit, { decimals: 0 })} (${pct(stats.margin)}): es lo que te deja este cliente antes de los gastos fijos.`,
            }}
            value={tileMoney(stats.total_bought)}
            title={money(stats.total_bought)}
            hint={hasSales ? `${int(stats.purchases_count)} ${stats.purchases_count === 1 ? 'compra' : 'compras'} · ${fmtBottles(stats.bottles)}` : 'Todavía no compró'}
          />
          <Kpi
            label="Ticket promedio"
            term="ticket_promedio"
            value={hasSales ? tileMoney(stats.avg_ticket) : '—'}
            title={money(stats.avg_ticket)}
            hint={hasSales ? 'Lo que gasta cada vez que te compra' : 'Todavía no compró'}
          />
          <Kpi
            label="Te debe"
            term="por_cobrar"
            tone="mustard"
            value={tileMoney(stats.balance)}
            title={money(stats.balance)}
            valueClassName={stats.overdue > 0.01 ? 'text-bad' : undefined}
            hint={
              stats.balance <= 0.01 ? (
                'Está al día.'
              ) : stats.overdue > 0.01 ? (
                <b className="text-bad">{stats.overdue >= stats.balance - 0.01 ? 'Todo vencido' : `${nb(money(stats.overdue, { decimals: 0 }))} ya vencido`}</b>
              ) : (
                `${int(stats.pending_count)} ${stats.pending_count === 1 ? 'venta sin cobrar' : 'ventas sin cobrar'}, nada vencido`
              )
            }
          />
          <Kpi
            label="Última compra"
            info={{
              title: 'Última compra y frecuencia',
              text: 'La fecha de su venta más reciente. "Compra cada N días" es el promedio de días entre su primera y su última compra: sirve para darte cuenta cuándo hace rato que no vuelve.',
            }}
            value={stats.last_purchase ? nb(dateShort(stats.last_purchase)) : '—'}
            hint={
              stats.last_purchase
                ? `${relativeDays(stats.last_purchase)}${stats.frequency_days != null ? ` · compra cada ~${int(stats.frequency_days)} días` : ' · compró una sola vez'}`
                : 'Todavía no compró'
            }
          />
        </div>
      </div>

      {/* Lo que te debe, con cobro rápido */}
      {pending.length > 0 && (
        <Card
          className="mt-4"
          title={
            <span className="inline-flex items-center gap-1.5">
              Lo que te debe <InfoTip term="por_cobrar" />
            </span>
          }
          subtitle="Ventas que todavía no te pagó (o te pagó una parte), de la más vieja a la más nueva."
          actions={
            waDebt ? (
              <a
                href={waDebt}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-paper px-3 text-[13px] font-bold text-ink hover:border-good/60 hover:bg-good-soft"
              >
                <MessageCircle size={15} className="text-good" aria-hidden /> Recordarle por WhatsApp
              </a>
            ) : undefined
          }
        >
          <ul className="divide-y divide-line">
            {pending.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-[14rem] flex-1">
                  <Link to={`/ventas?ver=${s.id}`} className="font-semibold text-ink hover:text-sky-deep hover:underline">
                    Venta #{s.id}
                  </Link>
                  <span className="text-[13px] text-muted">
                    {' '}
                    · {nb(dateShort(s.date))} · total {nb(money(s.total, { decimals: 0 }))}
                    {s.paid > 0.01 && ` · ya pagó ${nb(money(s.paid, { decimals: 0 }))}`}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={s.status} overdue={s.overdue} kind="sale" />
                    {s.due_date && <span className="text-[12.5px] text-muted">{s.overdue ? `Venció el ${fmtDate(s.due_date)}` : `Vence el ${fmtDate(s.due_date)}`}</span>}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  <span className={`vh-num text-[1.05rem] font-extrabold ${s.overdue ? 'text-bad' : 'text-ink'}`}>{nb(money(s.balance))}</span>
                  <Button size="sm" variant="soft" icon={HandCoins} onClick={() => openSettle(s)}>
                    Registrar cobro
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {pending.length > 1 && (
            <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-[14.5px] font-extrabold text-ink">
              <span>Total que te debe</span>
              <span className="vh-num">{nb(money(stats.balance))}</span>
            </p>
          )}
        </Card>
      )}

      {/* Gráficos */}
      {hasSales && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ChartCard
            title="Lo que te compró, mes a mes"
            subtitle={months12 > 0 ? `Últimos 12 meses: ${money(months12, { decimals: 0 })} en total.` : 'Últimos 12 meses.'}
            table={{
              columns: [
                { key: 'label', header: 'Mes' },
                { key: 'count', header: 'Compras', align: 'right', format: (v) => int(Number(v)) },
                { key: 'bottles', header: 'Botellas', align: 'right', format: (v) => int(Number(v)) },
                { key: 'total', header: 'Total', align: 'right', format: (v) => money(Number(v), { decimals: 0 }) },
              ],
              rows: [...monthly].reverse() as unknown as Record<string, unknown>[],
            }}
          >
            {months12 > 0 ? (
              <ColumnChart data={monthly as unknown as Record<string, unknown>[]} height={270} series={[{ key: 'total', label: 'Compró', color: CHART_COLORS.ventas }]} />
            ) : (
              <p className="py-12 text-center text-sm text-muted">No te compró nada en los últimos 12 meses. Su última compra fue el {fmtDate(stats.last_purchase)}.</p>
            )}
          </ChartCard>

          <ChartCard title="Sus vinos favoritos" subtitle="Botellas que te compró de cada vino (y lo que pagó). Ofrecele algo parecido cuando te llegue." table={favTable}>
            <RankBars
              items={stats.favorite_wines.map((w) => ({ label: w.name, value: w.bottles, sublabel: money(w.total, { decimals: 0 }) }))}
              color={CHART_COLORS.ventas}
              format="number"
              max={6}
              emptyText="Sus compras no tienen vinos del stock (son otros productos)."
            />
          </ChartCard>
        </div>
      )}

      {/* Historial de ventas */}
      <Card
        className="mt-4"
        flush
        title={
          <span className="inline-flex items-center gap-1.5">
            <Receipt size={18} className="text-ink-soft" aria-hidden /> Todas sus compras
          </span>
        }
        subtitle="Tocá una venta para ver el detalle, registrar un cobro o editarla."
      >
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <DataTable
            rows={sales}
            columns={saleCols}
            rowKey={(s) => s.id}
            onRowClick={(s) => navigate(`/ventas?ver=${s.id}`)}
            searchable={sales.length > 8}
            searchPlaceholder="Buscar por nº o canal…"
            initialSort={{ key: 'date', dir: 'desc' }}
            pageSize={10}
            dense
            rowClassName={(s) => (s.overdue ? 'bg-bad-soft/25' : undefined)}
            empty={
              <EmptyState
                compact
                icon={Wine}
                title="Todavía no le vendiste nada"
                action={
                  c.active ? (
                    <Button icon={Plus} onClick={() => navigate(newSaleUrl)}>
                      Cargar una venta
                    </Button>
                  ) : undefined
                }
              >
                Cuando le vendas, elegí a {c.name} como cliente en la venta y acá vas a ver todo su historial.
              </EmptyState>
            }
          />
        </div>
      </Card>

      <ClientFormModal open={editOpen} client={c} onClose={() => setEditOpen(false)} />
      {settle && (
        <SettlementModal
          open
          kind="sale"
          id={settle.id}
          balance={settle.balance}
          description={settle.description}
          defaultAccountId={settle.account}
          onClose={() => setSettle(null)}
        />
      )}
    </>
  )
}
