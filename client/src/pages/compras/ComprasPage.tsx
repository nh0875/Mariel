// Compras de vino: lo que le comprás a bodegas y distribuidores.
// La idea que esta pantalla repite (porque es la que más confunde): COMPRAR VINO NO ES UN GASTO.
// La plata se transforma en botellas; se vuelve costo recién cuando vendés cada botella.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FilterX, Plus, ShoppingBasket } from 'lucide-react'
import { CHART_COLORS } from '@shared/constants'
import type { Supplier } from '@shared/types'
import { safeDiv } from '@shared/calc'
import { boxes, bottles as fmtBottles, date as fmtDate, dateShort, int, money, pct, relativeDays } from '@/lib/format'
import { useNewParam } from '@/lib/hooks'
import { usePeriod } from '@/lib/period'
import { useApi, useSuppliers } from '@/lib/queries'
import {
  Button,
  Card,
  Combobox,
  DataTable,
  EmptyState,
  ErrorState,
  ExportButton,
  HelpBox,
  InfoTip,
  Loading,
  PageHeader,
  PeriodPicker,
  Select,
  StatusBadge,
  type Column,
} from '@/components/ui'
import { ChartCard, ColumnChart, Legend, RankBars } from '@/components/charts'
import { PurchaseFormModal } from './PurchaseFormModal'
import { PurchaseDetailModal } from './PurchaseDetailModal'
import { CompareBar, Kpi, dePhrase, nb, periodPhrase, tileMoney } from './parts'
import { PURCHASE_COLOR, STATUS_FILTER_OPTIONS, itemsSummary, statusText, type PurchaseDetailOut, type PurchaseListRow, type PurchasesSummary, type StatusFilter } from './types'

export default function ComprasPage() {
  const { period, label: periodLabel, preset } = usePeriod()
  const inPeriod = periodPhrase(preset, periodLabel)
  const [params, setParams] = useSearchParams()
  const [newOpen, openNew, closeNew] = useNewParam()
  const [presetSupplier, setPresetSupplier] = useState<number | null>(null)
  const [presetProduct, setPresetProduct] = useState<number | null>(null)
  const [editing, setEditing] = useState<PurchaseDetailOut | null>(null)

  // Filtros de la tabla
  const [status, setStatus] = useState<StatusFilter>('')
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const filtersOn = !!(status || supplierId)
  const clearFilters = () => {
    setStatus('')
    setSupplierId(null)
  }

  // ?proveedor=ID (desde la ficha del proveedor) y ?vino=ID (para reponer un vino) → preseleccionan en "Nueva compra".
  useEffect(() => {
    const sup = Number(params.get('proveedor'))
    const wine = Number(params.get('vino'))
    if (sup > 0 || wine > 0) {
      setPresetSupplier(sup > 0 ? sup : null)
      setPresetProduct(wine > 0 ? wine : null)
      openNew()
      const next = new URLSearchParams(params)
      next.delete('proveedor')
      next.delete('vino')
      next.delete('nuevo')
      setParams(next, { replace: true })
    }
  }, [params, setParams, openNew])

  // ?ver=ID → abre el detalle de esa compra (links desde otras pantallas).
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

  const summary = useApi<PurchasesSummary>('/purchases/summary', { from: period.from, to: period.to })
  // "Por pagar" y "Vencidas" muestran TODO lo que debés, de cualquier fecha (como la tarjeta «Les debés»):
  // una factura de hace dos meses que todavía no pagaste también es deuda de hoy.
  const allDates = status === 'por_pagar' || status === 'vencida'
  const filters = { ...(allDates ? {} : period), status: status || undefined, supplier_id: supplierId ?? undefined }
  const list = useApi<PurchaseListRow[]>('/purchases', filters)
  const { data: suppliers = [] } = useSuppliers()
  // En el filtro solo tienen sentido los proveedores de vino o los que ya tienen compras (no el contador ni la inmobiliaria).
  const supplierOptions = useMemo(
    () =>
      (suppliers as (Supplier & { purchases_count?: number })[])
        .filter((x) => (x.purchases_count ?? 0) > 0 || x.kind === 'bodega' || x.kind === 'distribuidor' || x.id === supplierId)
        .map((x) => ({ value: x.id, label: x.name, sublabel: x.active ? undefined : 'Desactivado' })),
    [suppliers, supplierId],
  )
  const showOwed = (which: 'por_pagar' | 'vencida') => {
    setStatus(which)
    window.setTimeout(() => document.getElementById('compras-tabla')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const s = summary.data
  const rows = list.data ?? []
  const totals = useMemo(
    () => ({ total: rows.reduce((a, r) => a + r.total, 0), bottles: rows.reduce((a, r) => a + r.bottles, 0), balance: rows.reduce((a, r) => a + r.balance, 0) }),
    [rows],
  )

  const columns: Column<PurchaseListRow>[] = [
    { key: 'date', header: 'Fecha', cell: (r) => <span className="whitespace-nowrap">{dateShort(r.date)}</span>, className: 'w-[1%]', hideBelow: 'sm' },
    {
      key: 'supplier',
      header: 'Proveedor',
      value: (r) => `${r.supplier_name || 'Sin proveedor'} ${r.items_preview.map((i) => i.name).join(' ')} ${r.invoice_number ?? ''}`,
      cell: (r) => (
        <div className="min-w-0">
          <span className={r.supplier_name ? 'font-semibold text-ink' : 'text-ink-soft'}>{r.supplier_name || 'Sin proveedor'}</span>
          <span className="block max-w-[46vw] truncate text-[12.5px] text-muted sm:max-w-[30vw] lg:max-w-[340px]">
            <span className="sm:hidden">{dateShort(r.date)} · </span>
            {itemsSummary(r.items_preview)}
          </span>
        </div>
      ),
    },
    {
      key: 'invoice_number',
      header: 'Factura nº',
      cell: (r) => (r.invoice_number ? <span className="whitespace-nowrap text-ink-soft">{r.invoice_number}</span> : <span className="text-muted">—</span>),
      hideBelow: 'lg',
    },
    {
      key: 'bottles',
      header: 'Botellas',
      align: 'right',
      cell: (r) => int(r.bottles),
      hideBelow: 'md',
      footer: int(totals.bottles),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (r) => (
        <>
          <span className="font-bold">{money(r.total)}</span>
          {r.status === 'parcial' && <span className="block text-[12px] whitespace-nowrap text-ink-soft">falta {money(r.balance)}</span>}
          <span className="mt-1 block sm:hidden">
            <StatusBadge status={r.status} overdue={r.overdue} />
          </span>
        </>
      ),
      footer: money(totals.total),
    },
    {
      key: 'status',
      header: 'Estado',
      value: (r) => statusText(r),
      cell: (r) => <StatusBadge status={r.status} overdue={r.overdue} />,
      hideBelow: 'sm',
      className: 'w-[1%]',
    },
    {
      key: 'due_date',
      header: 'Vence',
      value: (r) => (r.status === 'pagado' ? null : r.due_date),
      cell: (r) =>
        r.status === 'pagado' || !r.due_date ? (
          <span className="text-muted">—</span>
        ) : (
          <span className={r.overdue ? 'font-bold whitespace-nowrap text-bad' : 'whitespace-nowrap text-ink-soft'} title={fmtDate(r.due_date)}>
            {dateShort(r.due_date)}
            <span className="block text-[12px] font-normal">{relativeDays(r.due_date)}</span>
          </span>
        ),
      hideBelow: 'md',
    },
  ]

  const formOpen = newOpen || !!editing
  const closeForm = () => {
    closeNew()
    setEditing(null)
    setPresetSupplier(null)
    setPresetProduct(null)
  }

  // Comparación compras vs. costo de lo vendido (la explicación central de la pantalla).
  const stockChange = s ? s.total - s.cogs - s.shrinkage : 0
  const compareMax = s ? Math.max(s.total, s.cogs, s.shrinkage) : 0
  const topSupplier = s?.by_supplier[0]

  return (
    <>
      <PageHeader
        title="Compras de vino"
        description="Lo que le comprás a bodegas y distribuidores: cuánto, a qué costo real y cuánto les debés."
        actions={
          <>
            <ExportButton path="/purchases/export" params={filters} />
            <Button variant="primary" icon={Plus} onClick={openNew}>
              Nueva compra
            </Button>
          </>
        }
      />

      <HelpBox id="compras">
        <p>
          Acá cargás <b>cada factura de vino</b> que te llega. Cuando guardás una compra pasan tres cosas solas:
        </p>
        <ul>
          <li>
            <b>Entran las botellas al stock.</b> Comprar vino <b>no es un gasto</b>: la plata se transforma en botellas. Se vuelve costo (CMV) recién cuando vendés cada una, y ahí
            cuenta en tu ganancia.
          </li>
          <li>
            <b>El flete se reparte en el costo de cada botella</b>, según su precio. Así sabés lo que realmente te cuesta tener el vino en tu depósito.
          </li>
          <li>
            <b>Se actualiza el costo promedio</b> de cada vino: lo que tenías se promedia con lo que entra. Las ventas siguientes usan ese costo.
          </li>
        </ul>
        <p>
          <b>Ejemplo:</b> comprás 12 Malbec a $ 7.000 y 6 Torrontés a $ 6.000 ($ 120.000) y el flete sale $ 12.000 (10 %). Cada Malbec te cuesta de verdad $ 7.700 y cada Torrontés
          $ 6.600. Si tenías 12 Malbec a $ 7.200, tu costo promedio pasa a $ 7.450.
        </p>
        <p>
          <b>¿Y si pagás a 30 días?</b> Marcala como «la pago después»: el vino entra igual al stock y la deuda queda en «Por pagar» hasta que registres el pago (se puede pagar en
          partes). <b>¿Por qué importa?</b> Con el costo real bien cargado, los márgenes de cada vino no te mienten, y sabés cuánto le debés a cada proveedor.
        </p>
      </HelpBox>

      <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker />
        {s && s.count > 0 && (
          <p className="text-[13.5px] text-ink-soft">
            {int(s.count)} {s.count === 1 ? 'compra' : 'compras'} en {inPeriod}
          </p>
        )}
      </div>

      {summary.error ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : !s ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Kpi
              label="Comprado"
              tone="coral"
              info={{
                title: 'Comprado en el período',
                text: (
                  <>
                    <p>Lo que compraste de vino en el período: precio de los vinos más el flete.</p>
                    <p className="mt-2">
                      <b className="text-ink">Ojo: no es un gasto.</b> Es plata que se transformó en botellas (stock). En la ganancia cuenta el costo de lo que vendés, no lo que
                      comprás.
                    </p>
                  </>
                ),
              }}
              value={tileMoney(s.total)}
              title={money(s.total)}
              hint={
                s.count
                  ? `${int(s.count)} ${s.count === 1 ? 'compra' : 'compras'}${s.shipping > 0 ? ` · flete ${nb(money(s.shipping, { decimals: 0 }))}` : ''}`
                  : 'Sin compras en el período'
              }
            />
            <Kpi
              label="Botellas"
              info={{ title: 'Botellas que entraron', text: 'Todas las botellas de las compras del período. Ya están sumadas al stock de cada vino.' }}
              value={int(s.bottles)}
              hint={s.bottles >= 6 ? `≈ ${boxes(s.bottles)}` : s.bottles ? fmtBottles(s.bottles) : '—'}
            />
            <Kpi
              label="Costo por botella"
              info={{
                title: 'Costo real por botella (promedio)',
                text: (
                  <>
                    <p>Lo que te costó en promedio cada botella que compraste en el período, con el flete incluido.</p>
                    <p className="mt-2 rounded-lg bg-cream-deep px-2.5 py-1.5 font-semibold text-ink">Total comprado ÷ botellas</p>
                    {s.bottles > 0 && (
                      <p className="mt-2">
                        Este período: {money(s.total)} ÷ {int(s.bottles)} = {money(s.avg_cost_per_bottle)}. Precio de factura {money(s.avg_invoice_cost)} + flete{' '}
                        {money(s.avg_cost_per_bottle - s.avg_invoice_cost)}.
                      </p>
                    )}
                  </>
                ),
              }}
              value={s.bottles ? tileMoney(s.avg_cost_per_bottle) : '—'}
              title={money(s.avg_cost_per_bottle)}
              hint={s.bottles ? (s.shipping > 0 ? `El flete sumó un ${nb(pct(s.shipping_share))} al precio` : 'Sin flete en el período') : '—'}
            />
            <Kpi
              label="Les debés"
              term="por_pagar"
              tone="mustard"
              value={tileMoney(s.payables.total)}
              title={money(s.payables.total)}
              valueClassName={s.payables.overdue > 0.01 ? 'text-bad' : undefined}
              hint={
                s.payables.count === 0 ? (
                  'Estás al día con todas las compras.'
                ) : (
                  <>
                    {s.payables.count} {s.payables.count === 1 ? 'compra' : 'compras'} sin pagar (de cualquier fecha)
                    {s.payables.overdue_count > 0 ? (
                      <b className="text-bad"> · {nb(`${money(s.payables.overdue, { decimals: 0 })} vencido`)}</b>
                    ) : s.payables.next_due ? (
                      <> · próximo vencimiento {nb(dateShort(s.payables.next_due))}</>
                    ) : null}
                    {' · '}
                    <button
                      type="button"
                      className="font-bold whitespace-nowrap text-sky-deep hover:underline"
                      onClick={() => showOwed(s.payables.overdue_count > 0 ? 'vencida' : 'por_pagar')}
                    >
                      Ver cuáles
                    </button>
                  </>
                )
              }
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Compras por proveedor"
              subtitle={topSupplier ? `A quién le compraste más en ${inPeriod}.` : 'A quién le compraste en el período.'}
              table={{
                columns: [
                  { key: 'name', header: 'Proveedor' },
                  { key: 'count', header: 'Compras', align: 'right', format: (v) => int(Number(v)) },
                  { key: 'bottles', header: 'Botellas', align: 'right', format: (v) => int(Number(v)) },
                  { key: 'total', header: 'Total', align: 'right', format: (v) => money(Number(v)) },
                  { key: 'share', header: '% del total', align: 'right', format: (v) => pct(Number(v)) },
                ],
                rows: s.by_supplier.map((x) => ({ ...x, share: safeDiv(x.total, s.total) })),
              }}
            >
              <RankBars
                items={s.by_supplier.map((x) => ({ label: x.name, value: Math.round(x.total), sublabel: `${int(x.bottles)} bot.` }))}
                color={PURCHASE_COLOR}
                max={6}
                emptyText="No cargaste compras en este período."
              />
              {s.by_supplier.length > 6 && <p className="mt-3 px-2 text-[12.5px] text-muted sm:px-1">Mostramos los 6 principales. Tocá «Ver tabla» para ver todos.</p>}
              {topSupplier && s.by_supplier.length > 1 && (
                <p className="mt-3 px-2 text-[13px] text-ink-soft sm:px-1">
                  <b className="text-ink">{topSupplier.name}</b> se lleva el {pct(safeDiv(topSupplier.total, s.total), 0)} de tus compras.
                  {safeDiv(topSupplier.total, s.total) > 0.6 && ' Depender mucho de un proveedor te deja con poco margen para negociar.'}
                </p>
              )}
            </ChartCard>

            <Card
              title={
                <span className="inline-flex items-center gap-1.5">
                  ¿Comprar vino es un gasto? No.
                  <InfoTip term="cmv" />
                </span>
              }
              subtitle={`Lo que compraste vs. lo que salió vendido (a costo) en ${inPeriod}.`}
            >
              <div className="space-y-3.5">
                <CompareBar label="Compraste (entró al stock)" value={s.total} max={compareMax} color={PURCHASE_COLOR} />
                <CompareBar label="Vendiste, a costo (CMV)" value={s.cogs} max={compareMax} color={CHART_COLORS.costo} />
                {s.shrinkage > 0.5 && <CompareBar label="Roturas, degustaciones y regalos" value={s.shrinkage} max={compareMax} color={CHART_COLORS.gastos} />}
              </div>
              <p className="mt-4 text-[14px] leading-snug text-ink-soft">
                {s.total === 0 && s.cogs === 0 ? (
                  'En este período no hubo compras ni ventas de vino.'
                ) : stockChange >= 0 ? (
                  <>
                    Tu stock (a costo) <b className="text-ink">creció ≈ {nb(money(stockChange, { decimals: 0 }))}</b>: esa plata no se perdió, está en botellas esperando venderse.
                  </>
                ) : (
                  <>
                    Tu stock (a costo) <b className="text-ink">bajó ≈ {nb(money(-stockChange, { decimals: 0 }))}</b>: vendiste más de lo que repusiste. Fijate que no te falten tus
                    vinos más vendidos.
                  </>
                )}{' '}
                En tu ganancia cuenta el costo de lo vendido ({nb(money(s.cogs, { decimals: 0 }))}), no lo que compraste.
              </p>
              <p className="mt-3 flex flex-wrap items-center gap-x-1.5 rounded-xl bg-cream-deep px-3.5 py-2.5 text-[13.5px] text-ink-soft">
                Hoy tenés <b className="vh-num text-ink">{money(s.stock_value.value, { decimals: 0 })}</b> invertidos en {int(s.stock_value.bottles)} botellas
                <InfoTip term="stock_valorizado" />
              </p>
            </Card>
          </div>

          {s.monthly.some((m) => m.purchases > 0 || m.cogs > 0) && (
            <ChartCard
              className="mt-4"
              title="Compras vs. costo de lo vendido, mes a mes"
              subtitle={
                s.monthly_mode === 'last6'
                  ? 'Últimos 6 meses hasta el período elegido. Si compraste más de lo que vendiste (a costo), estás llenando el depósito; si es al revés, lo estás vaciando.'
                  : 'Si compraste más de lo que vendiste (a costo), estás llenando el depósito; si es al revés, lo estás vaciando.'
              }
              term="cmv"
              legend={
                <Legend
                  items={[
                    { label: 'Compras de vino', color: PURCHASE_COLOR },
                    { label: 'Costo de lo vendido (CMV)', color: CHART_COLORS.costo },
                  ]}
                />
              }
              table={{
                columns: [
                  { key: 'label', header: 'Mes' },
                  { key: 'purchases', header: 'Compras', align: 'right', format: (v) => money(Number(v)) },
                  { key: 'cogs', header: 'Costo de lo vendido', align: 'right', format: (v) => money(Number(v)) },
                  { key: 'diff', header: 'Diferencia (al stock)', align: 'right', format: (v) => money(Number(v), { sign: true }) },
                ],
                rows: [...s.monthly].reverse().map((m) => ({ ...m, diff: m.purchases - m.cogs })),
              }}
            >
              <ColumnChart
                data={s.monthly}
                height={230}
                series={[
                  { key: 'purchases', label: 'Compras de vino', color: PURCHASE_COLOR },
                  { key: 'cogs', label: 'Costo de lo vendido', color: CHART_COLORS.costo },
                ]}
              />
            </ChartCard>
          )}
        </>
      )}

      <Card
        id="compras-tabla"
        className="mt-4 scroll-mt-4"
        title={allDates ? (status === 'vencida' ? 'Compras vencidas' : 'Compras por pagar') : `Compras ${dePhrase(inPeriod)}`}
        subtitle={
          allDates
            ? 'Todas las que tienen saldo, de cualquier fecha (no solo del período). Tocá una para registrar el pago.'
            : 'Tocá una compra para ver el detalle, registrar un pago, editarla o borrarla.'
        }
        flush
      >
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
              searchPlaceholder="Buscar proveedor, vino o factura…"
              initialSort={{ key: 'date', dir: 'desc' }}
              rowClassName={(r) => (r.overdue ? 'bg-bad-soft/25' : undefined)}
              toolbar={
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
                  <Select aria-label="Estado de pago" className="sm:w-[160px]" value={status} onChange={(v) => setStatus(v as StatusFilter)} options={STATUS_FILTER_OPTIONS} />
                  <Combobox
                    className="sm:w-[230px]"
                    value={supplierId}
                    onChange={setSupplierId}
                    allowClear
                    placeholder="Cualquier proveedor"
                    searchPlaceholder="Buscar proveedor…"
                    emptyText="No hay proveedores con ese nombre."
                    options={supplierOptions}
                  />
                  {filtersOn && (
                    <Button size="sm" variant="ghost" icon={FilterX} onClick={clearFilters} className="col-span-2 justify-self-start">
                      Limpiar filtros
                    </Button>
                  )}
                </div>
              }
              empty={
                allDates && !supplierId ? (
                  <EmptyState compact icon={ShoppingBasket} title={status === 'vencida' ? 'No tenés compras vencidas' : 'No le debés nada a ningún proveedor'} action={<Button onClick={clearFilters}>Ver todas las compras</Button>}>
                    {status === 'vencida' ? 'Todas las compras con saldo están dentro de su plazo. ¡Bien ahí!' : 'Todas las compras están pagadas. ¡Al día!'}
                  </EmptyState>
                ) : filtersOn ? (
                  <EmptyState compact icon={FilterX} title="No hay compras con esos filtros" action={<Button onClick={clearFilters}>Limpiar filtros</Button>}>
                    Probá con otro estado o proveedor{allDates ? '' : ', o cambiá el período de arriba'}.
                  </EmptyState>
                ) : (
                  <EmptyState
                    icon={ShoppingBasket}
                    title={s && !s.first_purchase_date ? 'Todavía no cargaste ninguna compra' : 'No hay compras en este período'}
                    action={
                      <Button icon={Plus} onClick={openNew}>
                        {s && !s.first_purchase_date ? 'Cargar la primera compra' : 'Cargar una compra'}
                      </Button>
                    }
                  >
                    Cuando te llegue vino, cargá la factura: elegís el proveedor, los vinos, cuántas botellas y a cuánto. El stock y el costo de cada botella se actualizan solos.
                    {s?.first_purchase_date ? ` Tu primera compra cargada es del ${fmtDate(s.first_purchase_date)}: si buscás compras viejas, cambiá el período de arriba.` : ''}
                  </EmptyState>
                )
              }
            />
          )}
          {rows.length > 0 && totals.balance > 0.01 && (
            <p className="mt-3 text-[13px] text-ink-soft">
              De estas compras falta pagar <b className="text-ink">{nb(money(totals.balance))}</b>.
              {!allDates && (
                <>
                  {' '}
                  <button type="button" className="font-bold text-sky-deep hover:underline" onClick={() => showOwed('por_pagar')}>
                    Ver todo lo que debés
                  </button>{' '}
                  (de cualquier fecha).
                </>
              )}
            </p>
          )}
        </div>
      </Card>

      <PurchaseFormModal
        open={formOpen}
        purchase={editing}
        presetSupplierId={presetSupplier}
        presetProductId={presetProduct}
        onClose={closeForm}
        onSaved={(saved) => {
          if (editing) openDetail(saved.id)
        }}
      />
      <PurchaseDetailModal
        purchaseId={formOpen ? null : viewId}
        onClose={closeDetail}
        onEdit={(p) => {
          setEditing(p)
          closeDetail()
        }}
      />
    </>
  )
}
