// Ficha de un vino: números clave, ventas mes a mes, cómo se reparte el precio y el historial de botellas.
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardCheck, Pencil, Power, Tag, Trash2, Wine } from 'lucide-react'
import { CHART_COLORS, WINE_TYPE_LABELS } from '@shared/constants'
import { markupOnCost } from '@shared/calc'
import { addDays, today } from '@shared/dates'
import { ApiError, api } from '@/lib/api'
import { boxes, date, dateShort, int, money, pct } from '@/lib/format'
import { useApi, useApiMutation, useSettings } from '@/lib/queries'
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, ExportButton, HelpBox, InfoTip, Loading, PageHeader, StatTile, Tabs, useConfirm, type Column } from '@/components/ui'
import { ChartCard, ColumnChart, Legend } from '@/components/charts'
import type { MovementRow, ProductDetail, ProductRow } from './types'
import { KIND_TONE, PriceSplit, daysOfStockVerdict, marginTone, stockLevel } from './shared'
import { ProductFormModal } from './ProductFormModal'
import { AdjustStockModal } from './AdjustStockModal'
import { CostChangeModal } from './CostChangeModal'

/** Body completo para PUT /products/:id (para activar/desactivar sin tocar nada más). */
function productBody(p: ProductRow, patch: Partial<ProductRow> = {}) {
  const x = { ...p, ...patch }
  return {
    name: x.name,
    winery: x.winery,
    varietal: x.varietal,
    wine_type: x.wine_type,
    vintage: x.vintage,
    region: x.region,
    size_ml: x.size_ml,
    sku: x.sku,
    price_retail: x.price_retail,
    price_wholesale: x.price_wholesale,
    min_stock: x.min_stock,
    units_per_box: x.units_per_box,
    active: x.active,
    notes: x.notes,
  }
}

function BackLink() {
  return (
    <Link to="/vinos" className="vh-no-print mb-3 inline-flex items-center gap-1.5 text-[14px] font-bold text-ink-soft hover:text-ink">
      <ArrowLeft size={16} aria-hidden /> Vinos y stock
    </Link>
  )
}

function Reference({ m, compact }: { m: MovementRow; compact?: boolean }) {
  const link = m.sale_id ? `/ventas?ver=${m.sale_id}` : m.purchase_id ? `/compras?ver=${m.purchase_id}` : m.event_id ? `/eventos/${m.event_id}` : null
  if (compact && !m.reference && !m.notes) return null
  return (
    <span className={compact ? 'mt-1 block text-[13px] leading-snug' : 'block max-w-[340px] min-w-[170px]'}>
      {m.reference ? (
        link ? (
          <Link to={link} onClick={(e) => e.stopPropagation()} className="font-semibold text-sky-deep hover:underline">
            {m.reference}
          </Link>
        ) : (
          <span className="font-semibold text-ink">{m.reference}</span>
        )
      ) : null}
      {m.sale_id && m.unit_price != null ? <span className="text-[12.5px] text-muted"> · a {money(m.unit_price)} c/u</span> : null}
      {m.notes && <span className={m.reference ? 'block text-[12.5px] text-muted' : 'text-ink-soft'}>{m.notes}</span>}
      {!m.reference && !m.notes && <span className="text-muted">—</span>}
    </span>
  )
}

export default function VinoDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const confirm = useConfirm()
  // Mientras se borra el vino no se vuelve a pedir su ficha (si no, pediría un vino que ya no existe).
  const [deleting, setDeleting] = useState(false)
  const { data, isLoading, error, refetch } = useApi<ProductDetail>(`/products/${id}`, undefined, {
    enabled: !deleting,
    // Si el vino no existe, no tiene sentido reintentar.
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  })
  const { data: settings } = useSettings()
  const target = (settings?.pricing.target_margin_pct ?? 40) / 100
  const [editOpen, setEditOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [costOpen, setCostOpen] = useState(false)
  const [chart, setChart] = useState<'bottles' | 'money'>('bottles')

  const setActive = useApiMutation((active: boolean) => api.put<ProductRow>(`/products/${id}`, productBody(data!.product, { active })), {
    success: (r) => (r.active ? `«${r.name}» está activo otra vez` : `«${r.name}» quedó desactivado (su historia sigue guardada)`),
  })
  const remove = useApiMutation(() => api.del(`/products/${id}`), {
    success: 'Vino borrado',
    onSuccess: () => navigate('/vinos', { replace: true }),
    onError: () => setDeleting(false),
  })
  const removeMovement = useApiMutation((movId: number) => api.del(`/stock/movements/${movId}`), {
    success: 'Movimiento borrado: el stock y el costo se recalcularon solos',
  })

  if (isLoading) return <Loading label="Cargando la ficha del vino…" />
  if (error || !data) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <>
        <BackLink />
        {missing ? (
          <Card>
            <EmptyState
              icon={Wine}
              title="No encontramos ese vino"
              action={
                <Button icon={ArrowLeft} onClick={() => navigate('/vinos')}>
                  Volver al catálogo
                </Button>
              }
            >
              Puede que se haya borrado, o que el link esté mal. Buscalo en el catálogo de Vinos y stock.
            </EmptyState>
          </Card>
        ) : (
          <ErrorState error={error ?? 'No pudimos cargar este vino.'} onRetry={() => refetch()} />
        )}
      </>
    )
  }

  const { product: p, stats, monthly, movements } = data
  const level = stockLevel(p)
  const verdict = daysOfStockVerdict(p.days_of_stock, p.stock)
  const gain = p.price_retail - p.unit_cost
  const soldInYear = monthly.reduce((s, m) => s + m.bottles, 0)

  // Si ya tiene historia (ventas, compras, ajustes…) no se puede borrar: en vez de dejar que falle,
  // lo explicamos y ofrecemos desactivarlo, que es lo que el usuario realmente necesita.
  const hasHistory = movements.length >= 300 || movements.some((m) => m.kind !== 'inicial' && m.kind !== 'revaluo')
  const onDelete = async () => {
    if (hasHistory) {
      const ok = await confirm({
        title: `«${p.name}» no se puede borrar`,
        confirmText: p.active ? 'Desactivarlo' : 'Entendido',
        cancelText: p.active ? 'Dejarlo como está' : 'Cerrar',
        message: (
          <>
            <p>Ya tiene ventas, compras o movimientos de stock. Si lo borráramos se perdería esa historia y tus reportes dejarían de cerrar.</p>
            <p className="mt-2">
              {p.active ? (
                <>
                  Lo que podés hacer es <b className="text-ink">desactivarlo</b>: deja de aparecer al cargar ventas y compras y en la lista de precios, pero todo queda guardado (y lo podés
                  volver a activar).
                </>
              ) : (
                'Ya está desactivado: no aparece al cargar ventas ni compras, y su historia queda guardada.'
              )}
            </p>
          </>
        ),
      })
      if (ok && p.active) setActive.mutate(false)
      return
    }
    const ok = await confirm({
      title: `¿Borrar «${p.name}»?`,
      danger: true,
      confirmText: 'Sí, borrar',
      message: (
        <>
          <p>
            Se borra del catálogo{p.stock > 0 ? ` junto con sus ${p.stock === 1 ? 'una botella' : `${p.stock} botellas`} de stock inicial` : ''}. No tiene ventas, compras ni ajustes, así que no se
            pierde ninguna historia.
          </p>
          <p className="mt-2">Esto no se puede deshacer.</p>
        </>
      ),
    })
    if (ok) {
      setDeleting(true)
      remove.mutate()
    }
  }
  const onToggleActive = async () => {
    if (!p.active) return setActive.mutate(true)
    const ok = await confirm({
      title: `¿Desactivar «${p.name}»?`,
      confirmText: 'Sí, desactivar',
      message: `No va a aparecer al cargar ventas ni compras, ni en la lista de precios. Su historia queda guardada y lo podés volver a activar cuando quieras.${
        p.stock > 0 ? ` Ojo: todavía tenés ${p.stock === 1 ? '1 botella' : `${p.stock} botellas`}; siguen contando en el valor de tu stock hasta que las vendas o las ajustes.` : ''
      }`,
    })
    if (ok) setActive.mutate(false)
  }
  const onDeleteMovement = async (m: MovementRow) => {
    const ok = await confirm({
      title: '¿Borrar este movimiento?',
      danger: true,
      confirmText: 'Sí, borrar',
      message: `${m.kind_label} del ${date(m.date)}${m.qty ? ` (${m.qty > 0 ? '+' : '−'}${Math.abs(m.qty)} botellas)` : ''}. El stock y el costo del vino se recalculan solos.`,
    })
    if (ok) removeMovement.mutate(m.id)
  }

  const columns: Column<MovementRow>[] = [
    { key: 'date', header: 'Fecha', hideBelow: 'sm', value: (m) => `${m.date} ${String(m.id).padStart(9, '0')}`, cell: (m) => <span className="whitespace-nowrap">{date(m.date)}</span> },
    {
      key: 'kind',
      header: 'Movimiento',
      value: (m) => m.kind_label,
      cell: (m) => (
        <>
          <Badge tone={KIND_TONE[m.kind]}>{m.kind_label}</Badge>
          {/* En el celular: fecha y detalle debajo (no entran como columnas). */}
          <span className="sm:hidden">
            <span className="mt-1 block text-[12.5px] text-muted">{date(m.date)}</span>
            <Reference m={m} compact />
          </span>
        </>
      ),
    },
    {
      key: 'qty',
      header: 'Botellas',
      align: 'right',
      cell: (m) =>
        m.qty === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="inline-flex flex-col items-end">
            <b className={m.qty > 0 ? 'text-good' : 'text-ink'}>
              {m.qty > 0 ? '+' : '−'}
              {int(Math.abs(m.qty))}
            </b>
            <span className="text-[12px] whitespace-nowrap text-muted sm:hidden">quedan {int(m.saldo)}</span>
          </span>
        ),
    },
    { key: 'unit_cost', header: 'Costo c/u', align: 'right', hideBelow: 'md', cell: (m) => money(m.unit_cost) },
    { key: 'saldo', header: 'Saldo', align: 'right', hideBelow: 'sm', cell: (m) => <span className="font-bold">{int(m.saldo)}</span> },
    { key: 'reference', header: 'Detalle', hideBelow: 'sm', value: (m) => `${m.reference ?? ''} ${m.notes ?? ''}`, cell: (m) => <Reference m={m} /> },
    {
      key: 'actions',
      header: '',
      sortable: false,
      align: 'right',
      cell: (m) =>
        m.manual ? (
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            aria-label="Borrar movimiento"
            title="Borrar este movimiento"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteMovement(m)
            }}
          />
        ) : null,
    },
  ]

  const chartData = monthly.map((m) => ({ ...m }))

  return (
    <>
      <BackLink />
      <PageHeader
        title={p.name}
        description={
          <>
            {[p.winery, p.varietal, p.vintage ? `Cosecha ${p.vintage}` : null, WINE_TYPE_LABELS[p.wine_type], p.region, p.size_ml !== 750 ? `${p.size_ml} ml` : null].filter(Boolean).join(' · ')}
            {p.sku && <span className="text-muted"> · Código {p.sku}</span>}
          </>
        }
        actions={
          <>
            <Button icon={Pencil} onClick={() => setEditOpen(true)}>
              Editar
            </Button>
            <Button icon={Tag} onClick={() => setCostOpen(true)}>
              Cambiar costo
            </Button>
            <Button icon={Power} onClick={onToggleActive} loading={setActive.isPending}>
              {p.active ? 'Desactivar' : 'Activar'}
            </Button>
            <Button variant="ghost" icon={Trash2} onClick={onDelete} loading={remove.isPending}>
              Borrar
            </Button>
            <Button variant="primary" icon={ClipboardCheck} onClick={() => setAdjustOpen(true)}>
              Ajustar stock
            </Button>
          </>
        }
      />

      {!p.active && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-line-strong bg-cream-deep px-4 py-3 text-[14.5px] text-ink">
          <Power size={18} className="text-muted" aria-hidden />
          <span className="flex-1">
            <b>Este vino está desactivado:</b> no aparece al cargar ventas ni en la lista de precios. Su historia sigue acá.
          </span>
          <Button size="sm" onClick={() => setActive.mutate(true)} loading={setActive.isPending}>
            Activarlo
          </Button>
        </div>
      )}

      <HelpBox id="vinos-ficha" title="¿Qué ves en la ficha de un vino?">
        <p>
          Todo lo que pasó con <b>{p.name}</b>: cuántas botellas quedan, cuánto te cuesta cada una, cuánto ganás al venderla y cómo se vendió mes a mes.
        </p>
        <p>
          Abajo está el <b>historial de botellas</b>: cada fila es una entrada (+) o una salida (−). El <b>saldo</b> es cuántas quedaban después de ese movimiento. Ejemplo: tenías 24, vendiste 6 →
          saldo 18; se rompió 1 → saldo 17. Así siempre podés seguir el rastro de cada botella.
        </p>
        <p>
          <b>¿El depósito no coincide con el sistema?</b> Tocá «Ajustar stock» → «Conté y hay otra cantidad». Para roturas, degustaciones y regalos, también desde ahí: son costo aunque no sean ventas,
          y así aparecen en tus reportes.
        </p>
      </HelpBox>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        <StatTile
          label="Stock"
          term="stock_minimo"
          tone="mustard"
          value={
            <span className={level === 'out' ? 'text-bad' : level === 'low' ? 'text-warn' : undefined}>
              {int(p.stock)}
              <span className="ml-1 text-[15px] font-bold text-muted">{Math.abs(p.stock) === 1 ? 'botella' : 'botellas'}</span>
            </span>
          }
          hint={
            <>
              {p.units_per_box > 1 && p.stock >= p.units_per_box ? `${boxes(p.stock, p.units_per_box)} · ` : ''}mínimo {int(p.min_stock)}
              {level !== 'ok' && (
                <>
                  {' · '}
                  <Link to={`/compras?vino=${p.id}`} className="vh-no-print font-bold text-bad underline-offset-2 hover:underline" title="Cargar una compra de este vino">
                    reponer
                  </Link>
                </>
              )}
            </>
          }
        />
        <StatTile
          label="Costo promedio"
          term="costo_promedio"
          tone="orange"
          value={money(p.unit_cost)}
          hint={stats.last_purchase_date ? `última compra: ${money(stats.last_purchase_cost, { decimals: 0 })} el ${dateShort(stats.last_purchase_date)}` : 'sin compras todavía'}
        />
        <StatTile label="Precio minorista" tone="sky" value={p.price_retail ? money(p.price_retail) : '—'} hint={`mayorista: ${p.price_wholesale ? money(p.price_wholesale) : 'sin cargar'}`} />
        <StatTile
          label="Margen"
          term="margen_bruto"
          tone="sky"
          value={p.price_retail ? <span className={marginTone(p.margin_retail, target) === 'bad' ? 'text-bad' : undefined}>{pct(p.margin_retail, 0)}</span> : '—'}
          hint={p.price_retail ? (gain >= 0 ? `te quedan ${money(gain)} por botella` : `perdés ${money(-gain)} por botella`) : 'cargá el precio'}
        />
        <StatTile label="Vendidas (90 días)" tone="sky" value={int(p.sold_90d)} hint={p.sold_90d ? `≈ ${int(Math.round(p.sold_90d / 3))} por mes` : 'no se vendió en 90 días'} />
        <StatTile
          label="Días de stock"
          term="rotacion"
          tone="coral"
          value={p.stock <= 0 ? '0' : p.days_of_stock == null ? '—' : p.days_of_stock > 365 ? '+365' : int(p.days_of_stock)}
          hint={p.stock > 0 && p.days_of_stock != null && p.days_of_stock <= 365 ? `Alcanza hasta ≈ ${dateShort(addDays(today(), p.days_of_stock))}. ${verdict.text}` : verdict.text}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Ventas de este vino, mes a mes"
          subtitle={soldInYear ? `Últimos 12 meses: ${int(soldInYear)} botellas vendidas` : 'Últimos 12 meses'}
          actions={
            <Tabs
              value={chart}
              onChange={setChart}
              items={[
                { key: 'bottles', label: 'Botellas' },
                { key: 'money', label: 'Plata' },
              ]}
            />
          }
          legend={
            chart === 'money' && soldInYear ? (
              <Legend
                items={[
                  { label: 'Ventas', color: CHART_COLORS.ventas },
                  { label: 'Ganancia bruta', color: CHART_COLORS.ganancia },
                ]}
              />
            ) : undefined
          }
          table={{
            columns: [
              { key: 'label', header: 'Mes' },
              { key: 'bottles', header: 'Botellas', align: 'right', format: (v) => int(Number(v)) },
              { key: 'revenue', header: 'Ventas', align: 'right', format: (v) => money(Number(v)) },
              { key: 'profit', header: 'Ganancia bruta', align: 'right', format: (v) => money(Number(v)) },
            ],
            rows: chartData,
          }}
        >
          {soldInYear ? (
            chart === 'bottles' ? (
              <ColumnChart data={chartData} format="number" height={280} series={[{ key: 'bottles', label: 'Botellas vendidas', color: CHART_COLORS.ventas }]} />
            ) : (
              <ColumnChart
                data={chartData}
                height={280}
                series={[
                  { key: 'revenue', label: 'Ventas', color: CHART_COLORS.ventas },
                  { key: 'profit', label: 'Ganancia bruta', color: CHART_COLORS.ganancia },
                ]}
              />
            )
          ) : (
            <EmptyState compact icon={Wine} title="Sin ventas en el último año">
              Cuando cargues ventas de este vino en «Ventas», acá vas a ver cuántas botellas salen por mes.
            </EmptyState>
          )}
        </ChartCard>

        <Card
          title={
            <span className="inline-flex items-center gap-1.5">
              ¿Cómo se reparte el precio?
              <InfoTip term="margen_vs_markup" />
            </span>
          }
          subtitle="De cada botella que vendés: cuánto es el vino y cuánto te queda para gastos y ganancia."
        >
          <div className="space-y-4">
            <PriceSplit label="Precio minorista" price={p.price_retail} cost={p.unit_cost} />
            <PriceSplit label="Precio mayorista" price={p.price_wholesale} cost={p.unit_cost} />
            {p.price_retail > 0 && p.unit_cost > 0 && (
              <p className="text-[13px] text-muted">
                Markup minorista: {pct(markupOnCost(p.price_retail, p.unit_cost), 0)} (lo que le sumás al costo). Margen: {pct(p.margin_retail, 0)} (lo que te queda del precio).
              </p>
            )}
            {p.active && (
              <p className="vh-no-print text-[13px]">
                <Link to={`/calculadora?vino=${p.id}`} className="font-bold text-sky-deep hover:underline">
                  Calcular su precio en la Calculadora
                </Link>
                <span className="text-muted"> (con Ingresos Brutos y la comisión del cobro)</span>
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-5" title="Desde que lo cargaste" subtitle="La historia completa de este vino en tu negocio.">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px] md:grid-cols-4">
          <div>
            <dt className="text-ink-soft">Vendidas</dt>
            <dd className="vh-num text-[17px] font-extrabold text-ink">{int(stats.sold_total)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Facturado</dt>
            <dd className="vh-num text-[17px] font-extrabold text-ink">{money(stats.revenue_total, { decimals: 0 })}</dd>
          </div>
          <div>
            <dt className="inline-flex items-center gap-1 text-ink-soft">
              Ganancia bruta
              <InfoTip
                title="Ganancia bruta de este vino"
                text="Lo que facturaste con este vino menos lo que te costaron esas botellas. No descuenta descuentos generales de la venta, comisiones ni gastos."
              />
            </dt>
            <dd className="vh-num text-[17px] font-extrabold text-ink">{money(stats.profit_total, { decimals: 0 })}</dd>
          </div>
          <div>
            <dt className="inline-flex items-center gap-1 text-ink-soft">
              Mermas
              <InfoTip term="mermas" />
            </dt>
            <dd className="vh-num text-[17px] font-extrabold text-ink">
              {int(stats.shrinkage_bottles)} <span className="text-[13px] font-semibold text-muted">({money(stats.shrinkage_cost, { decimals: 0 })})</span>
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[13px] text-muted">
          Última venta: {stats.last_sale_date ? date(stats.last_sale_date) : 'nunca'} · Última compra:{' '}
          {stats.last_purchase_date ? `${date(stats.last_purchase_date)}${stats.last_purchase_supplier ? ` (${stats.last_purchase_supplier})` : ''}` : 'nunca'}
        </p>
      </Card>

      <Card
        className="mt-5"
        flush
        title="Historial de botellas"
        subtitle="Cada entrada (+) y salida (−), de la más nueva a la más vieja. El saldo es cuántas quedaban después de cada movimiento."
        actions={<ExportButton path="/stock/export" params={{ product_id: p.id }} label="Excel" size="sm" title="Toda la historia de este vino en Excel" />}
      >
        <div className="px-5 pb-5">
          <DataTable
            rows={movements}
            columns={columns}
            rowKey={(m) => m.id}
            initialSort={{ key: 'date', dir: 'desc' }}
            searchPlaceholder="Buscar (venta, cliente, rotura…)"
            pageSize={20}
            dense
            empty={
              <EmptyState compact title="Sin movimientos">
                Este vino todavía no tiene movimientos de stock.
              </EmptyState>
            }
          />
          <p className="mt-3 text-[13px] text-muted">
            Las ventas y compras se corrigen desde «Ventas» y «Compras de vino» (tocá el detalle para ir). Desde acá podés borrar ajustes, roturas, degustaciones, regalos y cambios de costo.
            {movements.length >= 300 && ' Mostramos los últimos 300 movimientos: el Excel tiene todos.'}
          </p>
        </div>
      </Card>

      <ProductFormModal open={editOpen} onClose={() => setEditOpen(false)} product={p} />
      <AdjustStockModal open={adjustOpen} onClose={() => setAdjustOpen(false)} product={p} minDate={stats.first_movement_date} />
      <CostChangeModal open={costOpen} onClose={() => setCostOpen(false)} product={p} minDate={stats.first_movement_date} />
    </>
  )
}
