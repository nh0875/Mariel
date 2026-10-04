// Pestaña "Gastos": cuánto gastaste en el período, cuánto es fijo y cuánto variable,
// cuánto se come de las ventas y qué falta pagar. Abajo, la lista completa.
import { useMemo } from 'react'
import clsx from 'clsx'
import { CalendarClock, FilterX, Plus, Receipt, Repeat, Wand2 } from 'lucide-react'
import type { ExpenseWithStatus } from '@shared/types'
import { DEFAULT_EXPENSE_CATEGORIES, type ExpenseNature } from '@shared/constants'
import { monthKey, today } from '@shared/dates'
import { api } from '@/lib/api'
import { dateShort, int, money, moneyCompact, monthName, pct } from '@/lib/format'
import { usePeriod } from '@/lib/period'
import { useApi, useApiMutation, useSettings } from '@/lib/queries'
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Loading, PeriodPicker, Select, type Column } from '@/components/ui'
import { Callout, KpiTile, ExpenseStatusBadge, useMinWidth } from './parts'
import {
  categoryIcon,
  categoryShort,
  NATURE_FILTER_OPTIONS,
  NATURE_SHORT,
  STATUS_FILTER_OPTIONS,
  type ExpensesSummary,
  type RecurringStatus,
  type StatusFilter,
} from './types'

/**
 * Plata para las tarjetas: completa hasta $ 10 M; si el total del período pasa eso, todas las tarjetas
 * van abreviadas ("$ 33,6 M", "$ 8,2 M") para que se lean parejas. El valor exacto queda en el tooltip.
 */
const tileMoney = (n: number, compact: boolean) => (compact ? moneyCompact(n) : money(n, { decimals: 0 }))

export interface ExpenseFilters {
  category: string
  nature: '' | ExpenseNature
  status: StatusFilter
}

export function ExpensesTab({
  filters,
  setFilters,
  onNew,
  onOpen,
  onShowRecurring,
}: {
  filters: ExpenseFilters
  setFilters: (f: ExpenseFilters) => void
  onNew: () => void
  onOpen: (id: number) => void
  onShowRecurring: () => void
}) {
  const { period, preset, label: periodLabel } = usePeriod()
  const summary = useApi<ExpensesSummary>('/expenses/summary', { from: period.from, to: period.to })
  const query = { ...period, category: filters.category || undefined, nature: filters.nature || undefined, status: filters.status || undefined }
  const list = useApi<ExpenseWithStatus[]>('/expenses', query)
  const thisMonth = monthKey(today())
  const recStatus = useApi<RecurringStatus>('/recurring-expenses/status', { month: thisMonth })
  const { data: settings } = useSettings()

  const generate = useApiMutation((month: string) => api.post<{ created: number; skipped: number; label: string }>('/recurring-expenses/generate', { month }), {
    success: (r) => (r.created ? `Listo: se cargaron ${r.created} gasto${r.created === 1 ? '' : 's'} fijo${r.created === 1 ? '' : 's'} de ${r.label}.` : `Ya estaban todos los gastos fijos de ${r.label}.`),
  })

  const s = summary.data
  const rows = list.data ?? []
  const compact = !!s && Math.abs(s.total) >= 10_000_000
  // La columna "Proveedor" solo cuando entra sin apretar las demás; si no, el proveedor va debajo de la descripción.
  const showSupplierCol = useMinWidth(1400)
  const showTypeCol = useMinWidth(1180)
  const filtersOn = !!(filters.category || filters.nature || filters.status)

  // Comparación: solo si ya cargabas gastos al empezar el período anterior (si no, el % no significa nada).
  const cmp = s?.comparison
  const showDelta = preset !== 'todo' && !!cmp?.comparable
  const delta = (k: 'total' | 'fixed' | 'variable') => (showDelta && cmp && cmp.previous[k] ? (cmp.current[k] - cmp.previous[k]) / Math.abs(cmp.previous[k]) : null)
  const deltaLabel =
    cmp?.mode === 'same_days'
      ? `vs. ${dateShort(cmp.previous.from)} – ${dateShort(cmp.previous.to)}`
      : preset === 'este_mes' || preset === 'mes_pasado'
        ? 'vs. el mes anterior'
        : 'vs. período anterior'

  const categoryOptions = useMemo(() => {
    const names = new Set((settings?.expense_categories ?? DEFAULT_EXPENSE_CATEGORIES).map((c) => c.name))
    for (const c of s?.by_category ?? []) names.add(c.category)
    if (filters.category) names.add(filters.category)
    return [...names].sort((a, b) => a.localeCompare(b, 'es')).map((n) => ({ value: n, label: n }))
  }, [settings, s, filters.category])

  const total = rows.reduce((a, r) => a + r.amount, 0)
  const columns: Column<ExpenseWithStatus>[] = [
    { key: 'date', header: 'Fecha', cell: (r) => <span className="whitespace-nowrap">{dateShort(r.date)}</span>, className: 'w-[1%]', hideBelow: 'sm' },
    {
      key: 'description',
      header: 'Descripción',
      value: (r) => `${r.description} ${r.category} ${r.supplier_name ?? ''} ${r.event_name ?? ''}`,
      // Se queda con el espacio que sobra y corta con "…": así nunca empuja el monto o el estado fuera de la pantalla.
      className: 'w-full max-w-0 min-w-[7.5rem]',
      cell: (r) => {
        const extra = [!showSupplierCol && r.supplier_name, r.event_name && `Evento: ${r.event_name}`].filter(Boolean).join(' · ')
        return (
          <div className="min-w-0">
            <span className="flex max-w-full min-w-0 items-center gap-1.5 font-semibold text-ink" title={r.description}>
              <span className="truncate">{r.description}</span>
              {r.recurring_id && <Repeat size={13} className="shrink-0 text-muted" aria-label="Gasto fijo automático" />}
            </span>
            <span className={clsx('block truncate text-[12.5px] text-muted', !extra && 'md:hidden')}>
              <span className="sm:hidden">{dateShort(r.date)} · </span>
              <span className="md:hidden">{categoryShort(r.category)}</span>
              {extra && (
                <>
                  <span className="md:hidden"> · </span>
                  {extra}
                </>
              )}
            </span>
          </div>
        )
      },
    },
    {
      key: 'category',
      header: 'Categoría',
      hideBelow: 'md',
      cell: (r) => {
        const Icon = categoryIcon(r.category)
        return (
          <span className="inline-flex max-w-[150px] items-center gap-1.5 whitespace-nowrap text-ink-soft xl:max-w-[190px]" title={r.category}>
            <Icon size={15} className="shrink-0 text-muted" aria-hidden />
            <span className="truncate">{categoryShort(r.category)}</span>
          </span>
        )
      },
    },
    ...(showTypeCol
      ? [
          {
            key: 'nature',
            header: 'Tipo',
            hideBelow: 'lg' as const,
            value: (r: ExpenseWithStatus) => NATURE_SHORT[r.nature],
            cell: (r: ExpenseWithStatus) => <Badge tone={r.nature === 'fijo' ? 'coral' : 'mustard'}>{NATURE_SHORT[r.nature]}</Badge>,
            className: 'w-[1%]',
          },
        ]
      : []),
    ...(showSupplierCol
      ? [
          {
            key: 'supplier_name',
            header: 'Proveedor',
            hideBelow: 'lg' as const,
            cell: (r: ExpenseWithStatus) => <span className="block max-w-[150px] truncate whitespace-nowrap text-ink-soft" title={r.supplier_name ?? undefined}>{r.supplier_name || '—'}</span>,
          },
        ]
      : []),
    {
      key: 'amount',
      header: 'Monto',
      align: 'right',
      cell: (r) => (
        <>
          <span className="font-bold">{money(r.amount)}</span>
          <span className="mt-1 block sm:hidden">
            <ExpenseStatusBadge status={r.status} overdue={r.overdue} />
          </span>
        </>
      ),
      footer: money(total),
    },
    {
      key: 'status',
      header: 'Estado',
      value: (r) => (r.status === 'pagado' ? 'Pagado' : r.overdue ? 'Vencido' : 'Por pagar'),
      cell: (r) => <ExpenseStatusBadge status={r.status} overdue={r.overdue} />,
      hideBelow: 'sm',
      className: 'w-[1%]',
    },
  ]

  const rs = recStatus.data
  const missingNames = rs ? rs.items.filter((i) => i.expense_id == null).map((i) => i.description) : []

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker />
        {s && s.count > 0 && (
          <p className="text-[13.5px] text-ink-soft">
            {int(s.count)} {s.count === 1 ? 'gasto' : 'gastos'} en {periodLabel.toLowerCase()}
          </p>
        )}
      </div>

      {rs && rs.missing > 0 && (
        <Callout
          className="mb-4"
          icon={<CalendarClock size={22} aria-hidden />}
          title={`Te ${rs.missing === 1 ? 'falta' : 'faltan'} generar ${rs.missing} gasto${rs.missing === 1 ? '' : 's'} fijo${rs.missing === 1 ? '' : 's'} de ${monthName(rs.month).split(' ')[0]}`}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={onShowRecurring}>
                Ver cuáles
              </Button>
              <Button icon={Wand2} onClick={() => generate.mutate(rs.month)} loading={generate.isPending}>
                Generar ahora
              </Button>
            </>
          }
        >
          {missingNames.slice(0, 3).join(', ')}
          {missingNames.length > 3 ? ` y ${missingNames.length - 3} más` : ''} · {money(rs.missing_amount)}. Generalos para que el resultado del mes muestre lo que de verdad vas a pagar
          (los que se debitan solos quedan pagados; el resto, «por pagar»).
        </Callout>
      )}
      {rs && rs.templates === 0 && (
        <Callout
          className="mb-4"
          tone="mustard"
          icon={<Repeat size={22} aria-hidden />}
          title="¿Pagás alquiler, sueldos o abonos todos los meses?"
          actions={
            <Button variant="ghost" size="sm" onClick={onShowRecurring}>
              Cargar gastos fijos
            </Button>
          }
        >
          Cargalos una vez en «Gastos fijos del mes» y cada mes se generan con un clic. Así nunca te olvidás de ninguno.
        </Callout>
      )}

      {summary.error ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : !s ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-6 min-[87.5rem]:grid-cols-5">
          <KpiTile
            label="Gastos del período"
            className="md:col-span-2 min-[87.5rem]:col-span-1"
            term="gastos"
            tone="coral"
            value={tileMoney(s.total, compact)}
            title={money(s.total)}
            delta={delta('total')}
            upIsGood={false}
            deltaLabel={deltaLabel}
            hint={s.count ? `${int(s.count)} ${s.count === 1 ? 'gasto' : 'gastos'} cargados` : 'Sin gastos en el período'}
          />
          <KpiTile
            label="Fijos"
            className="md:col-span-2 min-[87.5rem]:col-span-1"
            term="gastos_fijos"
            value={tileMoney(s.fixed, compact)}
            title={money(s.fixed)}
            delta={delta('fixed')}
            upIsGood={false}
            deltaLabel={deltaLabel}
            hint={s.total ? `${pct(s.fixed / s.total, 0)} del total: lo que pagás sí o sí` : 'Alquiler, sueldos, abonos: lo que pagás sí o sí'}
          />
          <KpiTile
            label="Variables"
            className="md:col-span-2 min-[87.5rem]:col-span-1"
            term="gastos_variables"
            value={tileMoney(s.variable, compact)}
            title={money(s.variable)}
            delta={delta('variable')}
            upIsGood={false}
            deltaLabel={deltaLabel}
            hint={s.total ? `${pct(s.variable / s.total, 0)} del total: crecen con las ventas` : 'Envíos, packaging, publicidad: crecen con las ventas'}
          />
          <KpiTile
            label="Gastos sobre ventas"
            className="md:col-span-3 min-[87.5rem]:col-span-1"
            tone="orange"
            info={{
              title: 'Gastos sobre ventas',
              text: (
                <>
                  <p>Qué parte de lo que vendiste se fue en gastos (alquiler, sueldos, envíos…). No incluye el costo del vino: eso ya está descontado en el margen.</p>
                  <p className="mt-2 rounded-lg bg-cream-deep px-2.5 py-1.5 font-semibold text-ink">Gastos ÷ ventas × 100</p>
                  <p className="mt-2">
                    {s.vs_sales != null
                      ? `Este período: ${money(s.total)} ÷ ${money(s.sales)} = ${pct(s.vs_sales)}.`
                      : 'Ejemplo: vendiste $ 4.000.000 y gastaste $ 1.000.000 → 25 %.'}
                  </p>
                  <p className="mt-2">
                    <b className="text-ink">¿Por qué importa?</b> Tiene que ser menor que tu margen bruto: si de cada $100 te quedan $40 después de pagar el vino y los gastos se comen
                    $35, ganás $5. Si sube mes a mes, los gastos crecen más rápido que las ventas.
                  </p>
                </>
              ),
            }}
            value={s.vs_sales != null ? pct(s.vs_sales) : '—'}
            hint={
              s.vs_sales != null ? (
                <>
                  De cada $ 100 que vendiste, <b className="text-ink-soft">$ {Math.round(s.vs_sales * 100)}</b> se fueron en gastos
                  {showDelta && cmp?.previous.vs_sales != null && <> · antes {pct(cmp.previous.vs_sales, 0)}</>}
                </>
              ) : (
                'No hubo ventas en el período: no se puede calcular.'
              )
            }
          />
          <KpiTile
            label="Por pagar"
            term="por_pagar"
            tone="mustard"
            className="col-span-2 md:col-span-3 min-[87.5rem]:col-span-1"
            value={tileMoney(s.pending, compact)}
            title={money(s.pending)}
            hint={
              s.pending_count === 0 ? (
                <>
                  {s.count > 0 ? '¡Todo pagado en este período!' : 'No hay nada por pagar en este período.'}
                  {s.payables_total > 0.01 && <> De gastos anteriores debés {money(s.payables_total, { decimals: 0 })}.</>}
                </>
              ) : (
                <>
                  {s.pending_count} {s.pending_count === 1 ? 'gasto' : 'gastos'} de este período
                  {s.overdue_count > 0 && (
                    <b className="text-bad">
                      {' '}
                      · {s.overdue_count} vencido{s.overdue_count === 1 ? '' : 's'}
                    </b>
                  )}
                  {s.payables_total > s.pending + 0.01 && <> · en total debés {money(s.payables_total, { decimals: 0 })} de gastos</>}
                  {filters.status !== 'por_pagar' && (
                    <button
                      type="button"
                      onClick={() => setFilters({ ...filters, status: 'por_pagar' })}
                      className="mt-1 block font-bold text-sky-deep hover:underline"
                    >
                      Ver cuáles →
                    </button>
                  )}
                </>
              )
            }
          />
        </div>
      )}

      <Card className="mt-4" title="Todos los gastos" subtitle="Tocá un gasto para ver el detalle, pagarlo, editarlo o borrarlo." flush>
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
              onRowClick={(r) => onOpen(r.id)}
              searchPlaceholder="Buscar gasto, categoría o proveedor…"
              initialSort={{ key: 'date', dir: 'desc' }}
              toolbar={
                <>
                  <Select
                    aria-label="Categoría"
                    className="w-full sm:w-[220px]"
                    value={filters.category}
                    onChange={(v) => setFilters({ ...filters, category: v })}
                    placeholder="Todas las categorías"
                    options={categoryOptions}
                  />
                  <Select
                    aria-label="Fijo o variable"
                    className="w-[calc(50%-0.25rem)] sm:w-[170px]"
                    value={filters.nature}
                    onChange={(v) => setFilters({ ...filters, nature: v as ExpenseFilters['nature'] })}
                    options={NATURE_FILTER_OPTIONS}
                  />
                  <Select
                    aria-label="Estado de pago"
                    className="w-[calc(50%-0.25rem)] sm:w-[170px]"
                    value={filters.status}
                    onChange={(v) => setFilters({ ...filters, status: v as StatusFilter })}
                    options={STATUS_FILTER_OPTIONS}
                  />
                  {filtersOn && (
                    <Button variant="ghost" size="sm" icon={FilterX} onClick={() => setFilters({ category: '', nature: '', status: '' })}>
                      Sacar filtros
                    </Button>
                  )}
                </>
              }
              empty={
                filtersOn ? (
                  <EmptyState icon={FilterX} title="Ningún gasto coincide" compact action={<Button icon={FilterX} onClick={() => setFilters({ category: '', nature: '', status: '' })}>Sacar filtros</Button>}>
                    No hay gastos con esos filtros en {periodLabel.toLowerCase()}. Probá sacando alguno o eligiendo otro período.
                  </EmptyState>
                ) : (
                  <EmptyState
                    icon={Receipt}
                    title="No hay gastos en este período"
                    action={
                      <Button icon={Plus} onClick={onNew}>
                        Cargar un gasto
                      </Button>
                    }
                  >
                    Cargá el alquiler, los sueldos, los envíos o lo que hayas pagado. Así vas a saber en qué se va la plata y cuánto tenés que vender para cubrirlo.
                  </EmptyState>
                )
              }
            />
          )}
        </div>
      </Card>
    </>
  )
}
