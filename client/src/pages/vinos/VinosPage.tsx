// Vinos y stock: el catálogo con costos, precios, márgenes y botellas.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Plus, ShoppingBasket, TrendingUp, Upload, Wine } from 'lucide-react'
import { WINE_TYPES, WINE_TYPE_LABELS } from '@shared/constants'
import { int, money, moneyCompact, pct } from '@/lib/format'
import { useNewParam } from '@/lib/hooks'
import { useApi, useSettings } from '@/lib/queries'
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, ErrorState, ExportButton, HelpBox, InfoTip, Loading, PageHeader, Select, StatTile, type Column } from '@/components/ui'
import type { ProductRow } from './types'
import { MarginChip, REORDER_HELP, StockBadge, daysOfStockText, reorderSuggestion, stockLevel, wineSubtitle } from './shared'
import { ProductFormModal } from './ProductFormModal'
import { BulkPriceModal } from './BulkPriceModal'
import { ImportModal } from './ImportModal'
import { PriceListModal } from './PriceListModal'

function boxesText(n: number, perBox: number): string {
  if (perBox <= 1 || n < perBox) return `${int(n)} ${n === 1 ? 'botella' : 'botellas'}`
  const b = Math.floor(n / perBox)
  return `${b} ${b === 1 ? 'caja' : 'cajas'}${n % perBox ? ` y ${n % perBox}` : ''}`
}

function ReorderCard({ low }: { low: ProductRow[] }) {
  const navigate = useNavigate()
  const [all, setAll] = useState(false)
  const shown = all ? low : low.slice(0, 6)
  return (
    <Card
      className="mt-5 border-coral/40"
      title={
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-coral" aria-hidden />
          Reponer pronto
          <Badge tone="coral">{low.length}</Badge>
        </span>
      }
      subtitle="Estos vinos llegaron a su stock mínimo (o se quedaron sin botellas). Tocá uno para ver su ficha."
      actions={
        <Button size="sm" icon={ShoppingBasket} onClick={() => navigate('/compras?nuevo=1')}>
          Cargar una compra
        </Button>
      }
    >
      <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((p) => {
          const sug = reorderSuggestion(p)
          return (
            <li key={p.id} className="min-w-0">
              <Link to={`/vinos/${p.id}`} className="flex h-full items-start gap-3 rounded-xl border border-line bg-cream/60 px-3.5 py-3 transition-colors hover:border-line-strong hover:bg-cream">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{p.name}</p>
                  <p className="truncate text-[12.5px] text-muted">{wineSubtitle(p) || WINE_TYPE_LABELS[p.wine_type]}</p>
                  <p className="mt-1 text-[13px] text-ink-soft">
                    Mínimo {int(p.min_stock)} · {daysOfStockText(p.days_of_stock, p.stock)}
                  </p>
                  {sug > 0 && (
                    <p className="text-[13px] text-ink-soft">
                      Sugerido: <b className="text-ink">{boxesText(sug, p.units_per_box)}</b>
                      {p.units_per_box > 1 && sug >= p.units_per_box ? ` (${sug} botellas)` : ''}
                    </p>
                  )}
                </div>
                <StockBadge product={p} />
              </Link>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          ¿Cómo se calcula lo sugerido? <InfoTip title="Cuánto conviene pedir" text={REORDER_HELP} />
        </span>
        {low.length > 6 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="font-bold text-sky-deep hover:underline">
            {all ? 'Ver menos' : `Ver los ${low.length}`}
          </button>
        )}
      </div>
    </Card>
  )
}

export default function VinosPage() {
  const navigate = useNavigate()
  const { data: products, isLoading, error, refetch } = useApi<ProductRow[]>('/products')
  const { data: settings } = useSettings()
  const target = (settings?.pricing.target_margin_pct ?? 40) / 100
  const [newOpen, openNew, closeNew] = useNewParam()
  const [bulkOpen, setBulkOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  // ?importar=1 → abre «Importar desde Excel» (desde la Bienvenida y la Ayuda).
  useEffect(() => {
    if (params.get('importar') !== '1') return
    setImportOpen(true)
    const next = new URLSearchParams(params)
    next.delete('importar')
    setParams(next, { replace: true })
  }, [params, setParams])
  const [listOpen, setListOpen] = useState(false)
  const [type, setType] = useState('')
  const [winery, setWinery] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const all = useMemo(() => products ?? [], [products])
  const active = useMemo(() => all.filter((p) => p.active), [all])
  const inactiveCount = all.length - active.length
  const wineries = useMemo(() => [...new Set(all.map((p) => p.winery).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')), [all])
  const types = useMemo(() => WINE_TYPES.filter((t) => all.some((p) => p.wine_type === t)), [all])

  const rows = useMemo(() => all.filter((p) => (showInactive || p.active) && (!type || p.wine_type === type) && (!winery || p.winery === winery)), [all, showInactive, type, winery])

  const kpi = useMemo(() => {
    const priced = active.filter((p) => p.price_retail > 0)
    const low = active.filter((p) => stockLevel(p) !== 'ok').sort((a, b) => a.stock - a.min_stock - (b.stock - b.min_stock) || a.name.localeCompare(b.name, 'es'))
    // Botellas y valor: TODOS los vinos con botellas (también los desactivados que todavía tienen),
    // igual que en Inicio. Esa plata está invertida aunque el vino ya no se ofrezca.
    const inactiveWithStock = all.filter((p) => !p.active && p.stock > 0)
    return {
      bottles: all.reduce((s, p) => s + Math.max(p.stock, 0), 0),
      withStock: all.filter((p) => p.stock > 0).length,
      inactiveWithStock,
      value: all.reduce((s, p) => s + p.stock_value, 0),
      low,
      avgMargin: priced.length ? priced.reduce((s, p) => s + p.margin_retail, 0) / priced.length : null,
      under: priced.filter((p) => p.margin_retail < target - 0.005).length,
    }
  }, [all, active, target])

  const columns: Column<ProductRow>[] = [
    {
      key: 'name',
      header: 'Vino',
      footer: `Total (${rows.length} ${rows.length === 1 ? 'vino' : 'vinos'})`,
      value: (p) => `${p.name} ${p.winery ?? ''} ${p.varietal ?? ''} ${p.vintage ?? ''} ${p.sku ?? ''}`,
      cell: (p) => (
        <span className="block min-w-[140px]">
          <span className="font-bold text-ink">{p.name}</span>
          {!p.active && (
            <Badge tone="neutral" className="ml-2 align-middle">
              Desactivado
            </Badge>
          )}
          <span className="block text-[12.5px] text-muted">{wineSubtitle(p) || WINE_TYPE_LABELS[p.wine_type]}</span>
          {/* En el celular, precio y margen van acá (no entran como columnas). */}
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] sm:hidden">
            <span className="vh-num font-bold text-ink">{p.price_retail ? money(p.price_retail) : 'Sin precio'}</span>
            {p.price_retail > 0 && <MarginChip margin={p.margin_retail} price={p.price_retail} target={target} />}
          </span>
        </span>
      ),
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right',
      value: (p) => p.stock,
      cell: (p) => (
        <span className="inline-flex flex-col items-end gap-0.5">
          <StockBadge product={p} />
          <span className="text-[12px] text-muted">{daysOfStockText(p.days_of_stock, p.stock)}</span>
        </span>
      ),
      footer: int(rows.reduce((s, p) => s + Math.max(p.stock, 0), 0)),
    },
    { key: 'unit_cost', header: 'Costo', align: 'right', hideBelow: 'md', cell: (p) => money(p.unit_cost, { decimals: 0 }) },
    { key: 'price_retail', header: 'Precio', align: 'right', hideBelow: 'sm', cell: (p) => (p.price_retail ? money(p.price_retail) : <span className="text-muted">—</span>) },
    { key: 'margin_retail', header: 'Margen', align: 'right', hideBelow: 'sm', cell: (p) => <MarginChip margin={p.margin_retail} price={p.price_retail} target={target} /> },
    { key: 'price_wholesale', header: 'Mayorista', align: 'right', hideBelow: 'lg', cell: (p) => (p.price_wholesale ? money(p.price_wholesale) : <span className="text-muted">—</span>) },
    {
      key: 'stock_value',
      header: 'Stock valorizado',
      align: 'right',
      hideBelow: 'md',
      cell: (p) => money(p.stock_value, { decimals: 0 }),
      footer: money(
        rows.reduce((s, p) => s + p.stock_value, 0),
        { decimals: 0 },
      ),
    },
  ]

  const filtersOn = !!type || !!winery
  const headerActions = (
    <>
      <Button icon={TrendingUp} onClick={() => setBulkOpen(true)} disabled={!active.length}>
        Aumentar precios
      </Button>
      <Button icon={Upload} onClick={() => setImportOpen(true)}>
        Importar desde Excel
      </Button>
      <Button icon={FileText} onClick={() => setListOpen(true)} disabled={!active.length}>
        Lista de precios
      </Button>
      <ExportButton path="/products/export" disabled={!all.length} />
      <Button variant="primary" icon={Plus} onClick={openNew}>
        Nuevo vino
      </Button>
    </>
  )

  return (
    <>
      <PageHeader title="Vinos y stock" description="Tu catálogo: cuánto te cuesta cada vino, a cuánto lo vendés, cuánto te deja y cuántas botellas te quedan." actions={headerActions} />
      <HelpBox id="vinos">
        <p>
          Acá está <b>todo tu catálogo</b>. Para cada vino ves su costo, sus precios, cuánto ganás con cada botella (el <b>margen</b>) y cuántas te quedan.
        </p>
        <p>
          <b>Ejemplo:</b> si el Malbec Clásico te cuesta $7.200 y lo vendés a $12.500, el margen es 42 %: de cada $100 que cobrás, $42 te quedan para pagar gastos y ganar.
        </p>
        <ul>
          <li>
            <b>El stock se mueve solo:</b> baja con cada venta y sube con cada compra. Acá solo cargás lo que no es venta ni compra (botellas rotas, degustaciones, regalos, o si contaste y hay otra
            cantidad), desde la ficha de cada vino.
          </li>
          <li>
            <b>El costo también se calcula solo</b> (costo promedio de tus compras, con el flete incluido), así el margen que ves es el real.
          </li>
        </ul>
        <p>
          <b>¿Por qué importa?</b> Saber qué vinos te dejan más y cuáles están parados te ayuda a decidir qué reponer y a qué precio vender. Con inflación, revisá los márgenes seguido: si el costo
          sube y el precio no, ganás menos sin darte cuenta.
        </p>
      </HelpBox>

      {isLoading ? (
        <Loading label="Cargando tus vinos…" />
      ) : error ? (
        <ErrorState className="mt-5" error={error} onRetry={() => refetch()} />
      ) : all.length === 0 ? (
        <Card className="mt-5">
          <EmptyState
            icon={Wine}
            title="Todavía no cargaste vinos"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={Plus} onClick={openNew}>
                  Cargar el primer vino
                </Button>
                <Button icon={Upload} onClick={() => setImportOpen(true)}>
                  Importar desde Excel
                </Button>
              </div>
            }
          >
            Empezá cargando tus vinos uno por uno, o subí una planilla de Excel con todo tu catálogo de una vez. Con el costo y el precio de cada uno, el sistema te muestra cuánto ganás por botella.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile
              label="Botellas en stock"
              tone="mustard"
              value={int(kpi.bottles)}
              hint={
                <span className="inline-flex items-center gap-1">
                  en {kpi.withStock} {kpi.withStock === 1 ? 'vino' : 'vinos'}
                  <InfoTip
                    title="Botellas en stock"
                    text={`Suma de las botellas de todos tus vinos${
                      kpi.inactiveWithStock.length
                        ? ` (incluye ${kpi.inactiveWithStock.length === 1 ? '1 vino desactivado que todavía tiene botellas' : `${kpi.inactiveWithStock.length} vinos desactivados que todavía tienen botellas`})`
                        : ''
                    }. Sale de los movimientos: compras y stock inicial suman; ventas, roturas, degustaciones y regalos restan.`}
                  />
                </span>
              }
            />
            <StatTile label="Valor del stock" term="stock_valorizado" tone="orange" value={moneyCompact(kpi.value)} hint={`${money(kpi.value, { decimals: 0 })} invertidos en botellas`} />
            <StatTile
              label="Para reponer"
              term="stock_minimo"
              tone="coral"
              value={int(kpi.low.length)}
              hint={kpi.low.length ? (kpi.low.length === 1 ? 'vino llegó al mínimo' : 'vinos llegaron al mínimo') : 'ninguno llegó al mínimo'}
            />
            <StatTile
              label="Margen medio"
              term="margen_bruto"
              tone="sky"
              value={pct(kpi.avgMargin, 0)}
              hint={kpi.under ? `${kpi.under} debajo de tu objetivo (${pct(target, 0)})` : `tu objetivo: ${pct(target, 0)} · precio minorista`}
            />
          </div>

          {kpi.low.length > 0 ? (
            <ReorderCard low={kpi.low} />
          ) : (
            <p className="mt-5 rounded-2xl border border-good/25 bg-good-soft/50 px-4 py-3 text-[14.5px] text-ink">
              <b>Todo en orden:</b> ningún vino activo está en su stock mínimo.
            </p>
          )}

          <Card className="mt-5" title="Catálogo" subtitle="Tocá un vino para ver su ficha: historial de botellas, ventas por mes y ajustes." flush>
            <div className="px-5 pb-5">
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-soft">
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b className="text-ink">Margen:</b>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <Badge tone="good">≥ {pct(target, 0)}</Badge> tu objetivo
                  </span>
                  {target > 0.25 && <Badge tone="warn">25–{pct(target, 0)}</Badge>}
                  <span className="inline-flex items-center gap-1">
                    <Badge tone="bad">&lt; {pct(Math.min(0.25, target), 0)}</Badge>
                    <InfoTip term="margen_bruto" />
                  </span>
                </span>
                <span>
                  <b className="text-ink">Stock:</b> amarillo = en el mínimo · rojo = sin botellas · «≈ días» = para cuánto te alcanza <InfoTip term="rotacion" className="align-[-3px]" />
                </span>
              </div>
              <DataTable
                rows={rows}
                columns={columns}
                rowKey={(p) => p.id}
                onRowClick={(p) => navigate(`/vinos/${p.id}`)}
                searchPlaceholder="Buscar por nombre, bodega, varietal…"
                rowClassName={(p) => (!p.active ? 'opacity-60' : undefined)}
                pageSize={30}
                toolbar={
                  <>
                    <Select
                      aria-label="Tipo de vino"
                      className="w-[calc(50%-0.25rem)] sm:w-[170px]"
                      value={type}
                      onChange={setType}
                      placeholder="Tipo: todos"
                      options={types.map((t) => ({ value: t, label: WINE_TYPE_LABELS[t] }))}
                    />
                    <Select
                      aria-label="Bodega"
                      className="w-[calc(50%-0.25rem)] sm:w-[200px]"
                      value={winery}
                      onChange={setWinery}
                      placeholder="Bodega: todas"
                      options={wineries.map((w) => ({ value: w, label: w }))}
                    />
                    {inactiveCount > 0 && <Checkbox checked={showInactive} onChange={setShowInactive} label={`Ver desactivados (${inactiveCount})`} className="ml-1" />}
                  </>
                }
                empty={
                  <EmptyState compact title="Ningún vino coincide" action={filtersOn ? <Button onClick={() => (setType(''), setWinery(''))}>Limpiar filtros</Button> : undefined}>
                    {filtersOn ? 'Probá con otro tipo o bodega.' : 'Activá «Ver desactivados» para ver los que guardaste.'}
                  </EmptyState>
                }
              />
              {!showInactive && kpi.inactiveWithStock.length > 0 && (
                <p className="mt-2.5 text-[13px] text-muted">
                  El total de la tabla no incluye {kpi.inactiveWithStock.length === 1 ? '1 vino desactivado que todavía tiene' : `${kpi.inactiveWithStock.length} vinos desactivados que todavía tienen`}{' '}
                  {int(kpi.inactiveWithStock.reduce((s, p) => s + p.stock, 0))} botellas (los números de arriba sí). Tildá «Ver desactivados» para verlos.
                </p>
              )}
            </div>
          </Card>
        </>
      )}

      <ProductFormModal open={newOpen} onClose={closeNew} />
      <BulkPriceModal open={bulkOpen} onClose={() => setBulkOpen(false)} products={all} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <PriceListModal open={listOpen} onClose={() => setListOpen(false)} products={all} />
    </>
  )
}
