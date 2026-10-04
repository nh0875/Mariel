// Ficha de un proveedor: sus datos de contacto, cuánto le compraste, cuánto le debés,
// qué vinos le comprás (y cómo te fue aumentando cada uno) y el historial de compras y gastos.
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, Mail, MapPin, Pencil, Phone, Plus, Power, Receipt, ShoppingBasket, StickyNote, Trash2, UserRound } from 'lucide-react'
import clsx from 'clsx'
import { CHART_COLORS, SUPPLIER_KIND_LABELS } from '@shared/constants'
import type { ExpenseWithStatus, PurchaseWithStatus } from '@shared/types'
import { ApiError, api } from '@/lib/api'
import { boxes, date as fmtDate, dateShort, int, money, pct, relativeDays } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/queries'
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, HelpBox, InfoTip, Loading, PageHeader, StatusBadge, Tabs, useConfirm, type Column } from '@/components/ui'
import { ChartCard, ColumnChart, Legend, RankBars } from '@/components/charts'
import { Kpi, nb, tileMoney } from '../compras/parts'
import { PURCHASE_COLOR, statusText } from '../compras/types'
import { SupplierFormModal } from './SupplierFormModal'
import type { SupplierDetail, SupplierWine } from './types'

function ContactRow({ icon: Icon, children }: { icon: typeof Phone; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5 text-[14.5px]">
      <Icon size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  )
}

export default function ProveedorDetailPage() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [gone, setGone] = useState(false)
  const q = useApi<SupplierDetail>(`/suppliers/${id}`, undefined, { enabled: id > 0 && !gone, retry: false })
  const [editOpen, setEditOpen] = useState(false)
  const [tab, setTab] = useState<'compras' | 'gastos'>('compras')

  const toggleActive = useApiMutation((active: boolean) => api.put(`/suppliers/${id}`, { active }), {
    success: (_r, active) => (active ? 'Proveedor reactivado: vuelve a aparecer al cargar compras y gastos.' : 'Proveedor desactivado. Su historial se conserva.'),
  })
  const remove = useApiMutation(
    async () => {
      // Dejamos de pedir la ficha antes de borrar (si no, se refresca y da "no encontrado").
      setGone(true)
      await api.del(`/suppliers/${id}`)
    },
    {
      success: 'Proveedor borrado',
      onSuccess: () => navigate('/proveedores', { replace: true }),
      onError: () => setGone(false),
    },
  )

  if (!(id > 0) || (q.error instanceof ApiError && q.error.status === 404)) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={ShoppingBasket}
          title="No encontramos ese proveedor"
          action={
            <Button icon={ArrowLeft} onClick={() => navigate('/proveedores')}>
              Ver todos los proveedores
            </Button>
          }
        >
          Puede que se haya borrado. Buscalo en la lista de proveedores.
        </EmptyState>
      </>
    )
  }
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Loading />

  const { supplier: s, stats, purchases, expenses, wines, monthly } = q.data
  const hasHistory = stats.purchases_count > 0 || stats.expenses_count > 0
  const hasExpensesInChart = monthly.some((m) => m.expenses > 0)

  const askDeactivate = async () => {
    const ok = await confirm({
      title: `¿Desactivar a ${s.name}?`,
      message: 'Deja de aparecer al cargar compras y gastos. Sus compras, pagos y números se conservan, y lo podés reactivar cuando quieras.',
      confirmText: 'Sí, desactivar',
    })
    if (ok) toggleActive.mutate(false)
  }
  const askDelete = async () => {
    const ok = await confirm({
      title: `¿Borrar a ${s.name}?`,
      message: 'No tiene compras ni gastos cargados, así que se puede borrar sin perder nada. No se puede deshacer.',
      confirmText: 'Sí, borrar',
      danger: true,
    })
    if (ok) remove.mutate()
  }

  const purchaseCols: Column<PurchaseWithStatus>[] = [
    { key: 'date', header: 'Fecha', cell: (p) => <span className="whitespace-nowrap">{dateShort(p.date)}</span>, className: 'w-[1%]' },
    {
      key: 'invoice_number',
      header: 'Factura nº',
      cell: (p) => (p.invoice_number ? <span className="whitespace-nowrap text-ink-soft">{p.invoice_number}</span> : <span className="text-muted">—</span>),
      hideBelow: 'md',
    },
    { key: 'bottles', header: 'Botellas', align: 'right', cell: (p) => int(p.bottles), hideBelow: 'sm' },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (p) => (
        <>
          <span className="font-bold">{money(p.total)}</span>
          <span className="mt-1 block sm:hidden">
            <StatusBadge status={p.status} overdue={p.overdue} />
          </span>
        </>
      ),
      footer: money(purchases.reduce((a, p) => a + p.total, 0)),
    },
    { key: 'status', header: 'Estado', value: statusText, cell: (p) => <StatusBadge status={p.status} overdue={p.overdue} />, hideBelow: 'sm', className: 'w-[1%]' },
    {
      key: 'balance',
      header: 'Falta pagar',
      align: 'right',
      cell: (p) => (p.balance > 0.01 ? <span className={p.overdue ? 'font-bold text-bad' : 'text-ink'}>{money(p.balance)}</span> : <span className="text-muted">—</span>),
      hideBelow: 'md',
      footer: money(stats.purchases_balance),
    },
  ]

  const expenseCols: Column<ExpenseWithStatus>[] = [
    { key: 'date', header: 'Fecha', cell: (e) => <span className="whitespace-nowrap">{dateShort(e.date)}</span>, className: 'w-[1%]' },
    {
      key: 'description',
      header: 'Gasto',
      value: (e) => `${e.description} ${e.category}`,
      cell: (e) => (
        <div className="min-w-0">
          <span className="font-semibold text-ink">{e.description}</span>
          <span className="block text-[12.5px] text-muted">{e.category}</span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Monto',
      align: 'right',
      cell: (e) => <span className="font-bold">{money(e.amount)}</span>,
      footer: money(stats.expenses_total),
    },
    {
      key: 'status',
      header: 'Estado',
      value: (e) => statusText(e),
      cell: (e) => <StatusBadge status={e.status} overdue={e.overdue} />,
      hideBelow: 'sm',
      className: 'w-[1%]',
    },
  ]

  const wineTable = {
    columns: [
      { key: 'name', header: 'Vino' },
      { key: 'bottles', header: 'Botellas', align: 'right' as const, format: (v: unknown) => int(Number(v)) },
      { key: 'total', header: 'Total (con flete)', align: 'right' as const, format: (v: unknown) => money(Number(v), { decimals: 0 }) },
    ],
    rows: wines as unknown as Record<string, unknown>[],
  }
  const wineCols: Column<SupplierWine>[] = [
    {
      key: 'name',
      header: 'Vino',
      cell: (w) => (
        <div className="min-w-0">
          <span className="font-semibold text-ink">{w.name}</span>
          <span className="block text-[12.5px] text-muted">
            {int(w.bottles)} botellas en {int(w.purchases)} {w.purchases === 1 ? 'compra' : 'compras'}
          </span>
          <span className="block text-[12.5px] text-ink-soft sm:hidden">
            Último precio <b className="vh-num text-ink">{money(w.last_unit_cost, { decimals: 0 })}</b> ({dateShort(w.last_date)})
          </span>
        </div>
      ),
    },
    {
      key: 'first_unit_cost',
      header: 'Primer precio',
      align: 'right',
      cell: (w) => (
        <span>
          {money(w.first_unit_cost, { decimals: 0 })}
          <span className="block text-[12px] text-muted">{dateShort(w.first_date)}</span>
        </span>
      ),
      hideBelow: 'md',
    },
    {
      key: 'last_unit_cost',
      header: 'Último precio',
      align: 'right',
      cell: (w) => (
        <span>
          <b>{money(w.last_unit_cost, { decimals: 0 })}</b>
          <span className="block text-[12px] text-muted">{dateShort(w.last_date)}</span>
        </span>
      ),
      hideBelow: 'sm',
    },
    {
      key: 'price_change',
      header: 'Aumento',
      align: 'right',
      value: (w) => w.price_change,
      cell: (w) =>
        w.price_change == null ? (
          <span className="text-[12.5px] text-muted">Una sola compra</span>
        ) : Math.abs(w.price_change) < 0.005 ? (
          <Badge>Sin cambios</Badge>
        ) : w.price_change > 0 ? (
          <Badge tone="warn">+{pct(w.price_change)}</Badge>
        ) : (
          <Badge tone="good">−{pct(-w.price_change)}</Badge>
        ),
      className: 'w-[1%]',
    },
  ]
  const biggestRaise = wines.filter((w) => w.price_change != null).sort((a, b) => (b.price_change ?? 0) - (a.price_change ?? 0))[0]

  return (
    <>
      <BackLink />
      <PageHeader
        title={s.name}
        description={
          <>
            {SUPPLIER_KIND_LABELS[s.kind]}
            {stats.first_purchase ? ` · le comprás desde ${fmtDate(stats.first_purchase)}` : ''}
            {!s.active && ' · desactivado'}
          </>
        }
        actions={
          <>
            <Button icon={Pencil} onClick={() => setEditOpen(true)}>
              Editar
            </Button>
            {hasHistory ? (
              s.active && (
                <Button variant="ghost" icon={Power} onClick={askDeactivate} loading={toggleActive.isPending}>
                  Desactivar
                </Button>
              )
            ) : (
              <Button variant="ghost" icon={Trash2} className="text-bad hover:bg-bad-soft hover:text-bad" onClick={askDelete} loading={remove.isPending}>
                Borrar
              </Button>
            )}
            {s.active && (
              <Button variant="primary" icon={Plus} onClick={() => navigate(`/compras?nuevo=1&proveedor=${s.id}`)}>
                Nueva compra
              </Button>
            )}
          </>
        }
      />

      {!s.active && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line-strong bg-cream-deep px-4 py-3 text-[14.5px] text-ink">
          <Power size={18} className="text-muted" aria-hidden />
          <span className="min-w-0 flex-1">
            <b>Este proveedor está desactivado:</b> no aparece al cargar compras ni gastos. Su historial se conserva.
          </span>
          <Button variant="primary" size="sm" onClick={() => toggleActive.mutate(true)} loading={toggleActive.isPending}>
            Reactivarlo
          </Button>
        </div>
      )}

      <HelpBox id="proveedor-ficha" title="¿Qué ves en esta ficha?">
        <p>
          Todo lo que tiene que ver con <b>{s.name}</b>: cuánto le compraste, cuánto le debés, qué vinos le comprás y a cuánto te los vende ahora. Las compras de vino suman al
          stock (no son gasto); si además le pagás servicios (flete, packaging), aparecen en la pestaña «Gastos».
        </p>
        <p>
          <b>Tip:</b> la columna «Aumento» compara el precio de factura de la primera y la última compra de cada vino. Si te aumentó más que tus precios de venta, tu margen se
          achicó: revisalo en «Vinos y stock».
        </p>
      </HelpBox>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* Datos de contacto */}
        <Card
          title="Datos de contacto"
          actions={
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditOpen(true)} aria-label="Editar datos de contacto">
              Cambiar
            </Button>
          }
        >
          {s.contact_name || s.phone || s.email || s.address || s.tax_id || s.notes ? (
            <ul className="space-y-2.5">
              {s.contact_name && <ContactRow icon={UserRound}>{s.contact_name}</ContactRow>}
              {s.phone && (
                <ContactRow icon={Phone}>
                  <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="font-semibold text-sky-deep hover:underline">
                    {s.phone}
                  </a>
                </ContactRow>
              )}
              {s.email && (
                <ContactRow icon={Mail}>
                  <a href={`mailto:${s.email}`} className="font-semibold break-all text-sky-deep hover:underline">
                    {s.email}
                  </a>
                </ContactRow>
              )}
              {s.address && <ContactRow icon={MapPin}>{s.address}</ContactRow>}
              {s.tax_id && <ContactRow icon={FileText}>CUIT {s.tax_id}</ContactRow>}
              {s.notes && (
                <ContactRow icon={StickyNote}>
                  <span className="whitespace-pre-line text-ink-soft">{s.notes}</span>
                </ContactRow>
              )}
            </ul>
          ) : (
            <p className="text-[14px] text-ink-soft">
              Todavía no cargaste teléfono ni email.{' '}
              <button type="button" className="font-bold text-sky-deep hover:underline" onClick={() => setEditOpen(true)}>
                Agregalos
              </button>{' '}
              para tenerlos a mano cuando hagas un pedido.
            </p>
          )}
        </Card>

        {/* Números */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Kpi
            label="Total comprado"
            tone="coral"
            info={{ title: 'Total comprado', text: 'Todas las compras de vino a este proveedor, con el flete incluido. No es un gasto: es lo que invertiste en botellas.' }}
            value={tileMoney(stats.total_bought)}
            title={money(stats.total_bought)}
            hint={stats.purchases_count ? `${int(stats.purchases_count)} ${stats.purchases_count === 1 ? 'compra' : 'compras'}` : 'Sin compras de vino'}
          />
          <Kpi
            label="Botellas"
            info={{
              title: 'Botellas y costo real',
              text: `Todas las botellas que le compraste. El costo real promedio (con flete) fue ${money(stats.avg_cost_per_bottle)} por botella.`,
            }}
            value={int(stats.bottles)}
            hint={stats.bottles ? `${stats.bottles >= 6 ? `≈ ${nb(boxes(stats.bottles))} · ` : ''}${nb(`${money(stats.avg_cost_per_bottle, { decimals: 0 })} c/u`)}` : '—'}
          />
          <Kpi
            label="Le debés"
            term="por_pagar"
            tone="mustard"
            value={tileMoney(stats.balance)}
            title={money(stats.balance)}
            valueClassName={stats.overdue > 0.01 ? 'text-bad' : undefined}
            hint={
              stats.balance <= 0.01 ? (
                'Estás al día.'
              ) : stats.overdue > 0.01 ? (
                <b className="text-bad">{nb(`${money(stats.overdue, { decimals: 0 })} ya vencido`)}</b>
              ) : (
                [
                  stats.purchases_balance > 0.01 && `compras ${nb(money(stats.purchases_balance, { decimals: 0 }))}`,
                  stats.expenses_balance > 0.01 && `gastos ${nb(money(stats.expenses_balance, { decimals: 0 }))}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              )
            }
          />
          <Kpi
            label="Última compra"
            info={{ title: 'Última compra', text: 'La fecha de la compra de vino más reciente a este proveedor.' }}
            value={stats.last_purchase ? dateShort(stats.last_purchase) : '—'}
            hint={stats.last_purchase ? relativeDays(stats.last_purchase) : 'Todavía no le compraste'}
          />
        </div>
      </div>

      {/* Gráficos (solo si ya hay historial; si no, abajo se invita a cargar la primera compra) */}
      {hasHistory && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ChartCard
            title="Lo que le compraste, mes a mes"
            subtitle={hasExpensesInChart ? 'Últimos 12 meses: compras de vino (stock) y gastos (servicios).' : 'Últimos 12 meses, con el flete incluido.'}
            legend={
              hasExpensesInChart ? (
                <Legend
                  items={[
                    { label: 'Compras de vino', color: PURCHASE_COLOR },
                    { label: 'Gastos', color: CHART_COLORS.gastos },
                  ]}
                />
              ) : undefined
            }
            table={{
              columns: [
                { key: 'label', header: 'Mes' },
                { key: 'bottles', header: 'Botellas', align: 'right', format: (v) => int(Number(v)) },
                { key: 'purchases', header: 'Compras', align: 'right', format: (v) => money(Number(v)) },
                ...(hasExpensesInChart ? [{ key: 'expenses', header: 'Gastos', align: 'right' as const, format: (v: unknown) => money(Number(v)) }] : []),
              ],
              rows: [...monthly].reverse(),
            }}
          >
            {monthly.some((m) => m.purchases > 0 || m.expenses > 0) ? (
              <ColumnChart
                data={monthly}
                height={230}
                series={[
                  { key: 'purchases', label: 'Compras de vino', color: PURCHASE_COLOR },
                  ...(hasExpensesInChart ? [{ key: 'expenses', label: 'Gastos', color: CHART_COLORS.gastos }] : []),
                ]}
              />
            ) : (
              <p className="py-12 text-center text-sm text-muted">No hubo compras ni gastos con este proveedor en los últimos 12 meses.</p>
            )}
          </ChartCard>

          <ChartCard title="Vinos que más le comprás" subtitle="Por plata invertida, con el flete incluido." table={wineTable}>
            <RankBars
              items={wines.map((w) => ({ label: w.name, value: Math.round(w.total), sublabel: `${int(w.bottles)} bot.` }))}
              color={PURCHASE_COLOR}
              max={6}
              emptyText="Todavía no le compraste vinos."
            />
            {biggestRaise && (biggestRaise.price_change ?? 0) > 0.005 && (
              <p className="mt-3 flex items-start gap-1 text-[13px] text-ink-soft">
                <span>
                  El que más aumentó: <b className="text-ink">{biggestRaise.name}</b>, de{' '}
                  <span className="whitespace-nowrap">{money(biggestRaise.first_unit_cost, { decimals: 0 })}</span> a{' '}
                  <span className="whitespace-nowrap">{money(biggestRaise.last_unit_cost, { decimals: 0 })}</span> (+{pct(biggestRaise.price_change)}) entre{' '}
                  {dateShort(biggestRaise.first_date)} y {dateShort(biggestRaise.last_date)}.
                </span>
                <InfoTip term="inflacion" />
              </p>
            )}
          </ChartCard>
        </div>
      )}

      {/* Precios: cómo te fue aumentando cada vino */}
      {wines.length > 0 && (
        <Card
          className="mt-4"
          flush
          title={
            <span className="inline-flex items-center gap-1.5">
              Cómo te fue aumentando cada vino
              <InfoTip
                title="Aumento del precio de factura"
                text="Compara el precio por botella de la factura (sin flete) entre la primera y la última vez que le compraste ese vino. Si sube más que tu precio de venta, tu margen se achica: revisá el precio en «Vinos y stock» o usá la Calculadora."
              />
            </span>
          }
          subtitle="Precio por botella de la factura, sin flete. Tocá un vino para ver su ficha."
        >
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <DataTable
              rows={wines}
              columns={wineCols}
              rowKey={(w) => w.product_id}
              onRowClick={(w) => navigate(`/vinos/${w.product_id}`)}
              searchable={wines.length > 8}
              searchPlaceholder="Buscar vino…"
              pageSize={8}
              dense
            />
          </div>
        </Card>
      )}

      {/* Historial */}
      <Card className="mt-4" flush>
        <div className="px-4 pt-4 sm:px-5 sm:pt-5">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: 'compras', label: 'Compras de vino', icon: ShoppingBasket, count: purchases.length },
              { key: 'gastos', label: 'Gastos', icon: Receipt, count: expenses.length },
            ]}
          />
          <p className="mt-2 text-[13.5px] text-ink-soft">
            {tab === 'compras'
              ? 'Tocá una compra para ver el detalle, registrar un pago o editarla.'
              : 'Servicios o insumos que le pagaste (flete, packaging, honorarios…). Se cargan en «Gastos» eligiendo este proveedor.'}
          </p>
        </div>
        <div className={clsx('px-4 pt-3 pb-4 sm:px-5 sm:pb-5')}>
          {tab === 'compras' ? (
            <DataTable
              rows={purchases}
              columns={purchaseCols}
              rowKey={(p) => p.id}
              onRowClick={(p) => navigate(`/compras?ver=${p.id}`)}
              searchable={purchases.length > 0}
              searchPlaceholder="Buscar por factura o fecha…"
              initialSort={{ key: 'date', dir: 'desc' }}
              pageSize={10}
              rowClassName={(p) => (p.overdue ? 'bg-bad-soft/25' : undefined)}
              empty={
                <EmptyState
                  compact
                  icon={ShoppingBasket}
                  title="Todavía no le compraste vino"
                  action={
                    s.active ? (
                      <Button icon={Plus} onClick={() => navigate(`/compras?nuevo=1&proveedor=${s.id}`)}>
                        Cargar una compra
                      </Button>
                    ) : undefined
                  }
                >
                  Cuando te llegue vino de {s.name}, cargá la factura y va a aparecer acá.
                </EmptyState>
              }
            />
          ) : (
            <DataTable
              rows={expenses}
              columns={expenseCols}
              rowKey={(e) => e.id}
              onRowClick={(e) => navigate(`/gastos?ver=${e.id}`)}
              searchable={expenses.length > 0}
              searchPlaceholder="Buscar gasto…"
              initialSort={{ key: 'date', dir: 'desc' }}
              pageSize={10}
              rowClassName={(e) => (e.overdue ? 'bg-bad-soft/25' : undefined)}
              empty={
                <EmptyState compact icon={Receipt} title="No hay gastos con este proveedor" action={<Button onClick={() => navigate('/gastos?nuevo=1')}>Cargar un gasto</Button>}>
                  Si le pagás un servicio (flete, packaging, honorarios), cargalo en «Gastos» y elegí a {s.name} como proveedor.
                </EmptyState>
              }
            />
          )}
        </div>
      </Card>

      <SupplierFormModal open={editOpen} supplier={s} onClose={() => setEditOpen(false)} />
    </>
  )
}

function BackLink() {
  return (
    <Link to="/proveedores" className="vh-no-print mb-3 inline-flex items-center gap-1 text-[14px] font-bold text-ink-soft hover:text-ink">
      <ArrowLeft size={16} aria-hidden /> Proveedores
    </Link>
  )
}
