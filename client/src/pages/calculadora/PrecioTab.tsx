// "¿A cuánto lo vendo?": precio sugerido para quedarte con el margen que querés después de
// Ingresos Brutos y la comisión, el mayorista que sale de ahí, la trampa del markup y la
// revisión de todos tus vinos con el mismo criterio.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Check, Wine } from 'lucide-react'
import { CHART_COLORS } from '@shared/constants'
import type { Product } from '@shared/types'
import { round2 } from '@shared/calc'
import type { ProductInput } from '@shared/schemas'
import {
  WHOLESALE_MIN_MARGIN,
  analyzePrice,
  markupTrap,
  reviewPrices,
  suggestPrice,
  wholesaleFromRetail,
  type CalculatorContext,
  type PriceReviewRow,
} from '@shared/pricing'
import { Button, Card, DataTable, EmptyState, ExportButton, Field, InfoTip, MoneyInput, ProductSelect, useConfirm, type Column } from '@/components/ui'
import { api } from '@/lib/api'
import { pct, pctDelta } from '@/lib/format'
import { useApiMutation, useProducts } from '@/lib/queries'
import {
  InputsCard,
  MiniStat,
  MobileResult,
  Note,
  PaymentMethodField,
  PercentField,
  ROUNDING_OPTIONS,
  Segmented,
  SliderField,
  SplitBar,
  Ticket,
  TicketHero,
  TicketRow,
  VerdictBadge,
  baseNumbers,
  defaultFeeKey,
  feeFor,
  money,
} from './parts'

export interface PrecioState {
  productId: number | null
  cost: number | null
  freight: number | null
  margin: number | null
  iibb: number | null
  feeKey: string
  roundTo: number
  wholesaleDiscount: number | null
}

export function defaultPrecio(ctx: CalculatorContext): PrecioState {
  return {
    productId: null,
    cost: baseNumbers(ctx).cost,
    freight: 0,
    margin: ctx.pricing.target_margin_pct,
    iibb: ctx.pricing.iibb_pct,
    feeKey: defaultFeeKey(ctx),
    roundTo: 100,
    wholesaleDiscount: ctx.pricing.wholesale_discount_pct,
  }
}

const nf = (v: number, d = 2) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: d }).format(v)

/** El vino completo con los precios nuevos (PUT /products/:id pide todos los campos editables). */
function productBody(p: Product, retail: number, wholesale: number): ProductInput {
  return {
    name: p.name,
    winery: p.winery,
    varietal: p.varietal,
    wine_type: p.wine_type,
    vintage: p.vintage,
    region: p.region,
    size_ml: p.size_ml,
    sku: p.sku,
    price_retail: retail,
    price_wholesale: wholesale,
    min_stock: p.min_stock,
    units_per_box: p.units_per_box,
    active: p.active,
    notes: p.notes,
  }
}

export function PrecioTab({ ctx, state, set, onReset }: { ctx: CalculatorContext; state: PrecioState; set: (patch: Partial<PrecioState>) => void; onReset: () => void }) {
  const confirm = useConfirm()
  const { data: products = [] } = useProducts()
  const product = products.find((p) => p.id === state.productId) ?? null
  const fee = feeFor(ctx, state.feeKey)
  const cost = state.cost ?? 0
  const freight = state.freight ?? 0
  const marginPct = state.margin ?? 0
  const iibb = state.iibb ?? 0
  const units = product?.units_per_box ?? ctx.units_per_box

  const r = suggestPrice({ cost, freight_per_bottle: freight, target_margin: marginPct / 100, iibb_pct: iibb, fee_pct: fee, round_to: state.roundTo })
  const wholesale = r.ok ? wholesaleFromRetail(r.price, state.wholesaleDiscount ?? 0, state.roundTo) : 0
  const wholesaleA = r.ok ? analyzePrice({ price: wholesale, cost: r.breakdown.cost_total, iibb_pct: iibb, fee_pct: fee }) : null
  const trap = markupTrap({ cost: cost + freight, target_margin: marginPct / 100, iibb_pct: iibb, fee_pct: fee })
  const current = product && product.price_retail > 0 ? analyzePrice({ price: product.price_retail, cost: cost + freight, iibb_pct: iibb, fee_pct: fee }) : null

  const save = useApiMutation((vars: { p: Product; retail: number; wholesale: number }) => api.put(`/products/${vars.p.id}`, productBody(vars.p, vars.retail, vars.wholesale)), {
    success: (_res, v) => `Listo: ${v.p.name} ahora sale ${money(v.retail)} (mayorista ${money(v.wholesale)}).`,
  })

  const usePrice = async () => {
    if (!product || !r.ok) return
    const ok = await confirm({
      title: `¿Cambiar el precio de ${product.name}?`,
      confirmText: 'Sí, usar este precio',
      message: (
        <div className="space-y-2">
          <p>
            Precio minorista: <b className="text-ink">{money(product.price_retail)}</b> → <b className="text-ink">{money(r.price)}</b>
          </p>
          <p>
            Precio mayorista: <b className="text-ink">{money(product.price_wholesale)}</b> → <b className="text-ink">{money(wholesale)}</b>
          </p>
          <p className="text-[14px]">Las ventas que ya cargaste no cambian: el precio nuevo se usa desde ahora. El costo y el stock del vino no se tocan.</p>
        </div>
      ),
    })
    if (ok) save.mutate({ p: product, retail: r.price, wholesale })
  }

  const pickProduct = (id: number | null, p: Product | null) => {
    set({ productId: id, ...(p ? { cost: round2(p.unit_cost), freight: 0 } : {}) })
  }

  const sameAsCurrent = !!product && r.ok && Math.abs(product.price_retail - r.price) < 0.5 && Math.abs(product.price_wholesale - wholesale) < 0.5

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:items-start">
        <InputsCard
          subtitle="Cambiá cualquier número y el precio se recalcula al toque."
          onReset={onReset}
          note={
            <Field label="Elegí un vino (opcional)" hint="Trae su costo actual, que ya incluye el flete de las compras. También podés escribir un costo a mano.">
              <ProductSelect value={state.productId} onChange={pickProduct} showCost placeholder="Buscá un vino de tu lista…" />
            </Field>
          }
        >
          {product && (
            <p className="-mt-1 rounded-xl bg-cream px-3.5 py-2.5 text-[14px] text-ink-soft">
              Hoy lo vendés a <b className="text-ink">{money(product.price_retail)}</b>
              {current && (
                <>
                  {' '}
                  y te queda un <b className="text-ink">{pct(current.margin)}</b> <VerdictBadge verdict={current.verdict} />
                </>
              )}
              {product.price_retail <= 0 && ' (todavía no tiene precio cargado)'}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Costo por botella" info="costo_promedio" hint={state.productId ? 'Costo promedio actual del vino.' : 'Lo que te cuesta cada botella puesta en el depósito.'}>
              <MoneyInput value={state.cost} onChange={(v) => set({ cost: v })} aria-label="Costo por botella" />
            </Field>
            <Field label="Flete por botella" info="flete_prorrateado" hint="Solo si no está incluido en el costo.">
              <MoneyInput value={state.freight} onChange={(v) => set({ freight: v })} aria-label="Flete por botella" />
            </Field>
          </div>
          <SliderField
            label="Margen que querés que te quede"
            info="margen_vs_markup"
            hint="De cada $ 100 que cobrás, cuánto te queda después de pagar el vino, Ingresos Brutos y la comisión."
            value={state.margin}
            onChange={(v) => set({ margin: v })}
            min={0}
            max={70}
            ticks={['0 %', '35 %', '70 %']}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <PercentField label="Ingresos Brutos" info="iibb" value={state.iibb} onChange={(v) => set({ iibb: v })} max={20} hint="El % de tu provincia (Configuración → Precios)." />
            <PaymentMethodField ctx={ctx} value={state.feeKey} onChange={(feeKey) => set({ feeKey })} />
          </div>
          <Field label="Redondear el precio" hint="Siempre hacia arriba, así el redondeo no te come el margen.">
            <Segmented label="Redondear el precio" options={ROUNDING_OPTIONS} value={state.roundTo} onChange={(roundTo) => set({ roundTo })} />
          </Field>
          <PercentField
            label="Descuento para mayoristas"
            value={state.wholesaleDiscount}
            onChange={(v) => set({ wholesaleDiscount: v })}
            max={90}
            hint="Cuánto más barato le vendés a restós y vinotecas. Por defecto, el de Configuración."
          />
        </InputsCard>

        {r.ok ? (
          <Ticket
            id="calc-precio-resultado"
            hero={
              <TicketHero
                label="Precio sugerido (minorista)"
                value={money(r.price)}
                sub={
                  <>
                    Para que te quede un <b className="text-ink">{nf(marginPct)} %</b> después de Ingresos Brutos y la comisión.
                    {product && product.price_retail > 0 && Math.abs(product.price_retail - r.price) >= 0.5 && (
                      <span className="mt-1 block">
                        Hoy está a {money(product.price_retail)}: {r.price > product.price_retail ? 'subilo' : 'podrías bajarlo'}{' '}
                        <b className={r.price > product.price_retail ? 'text-bad' : 'text-good'}>
                          {money(Math.abs(r.price - product.price_retail))} ({pctDelta(r.price / product.price_retail - 1)})
                        </b>
                        .
                      </span>
                    )}
                  </>
                }
              />
            }
            footer={
              product ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 flex-1 text-[13.5px] text-ink-soft">
                    {sameAsCurrent ? (
                      <>
                        <Check size={15} className="mr-1 inline text-good" aria-hidden />
                        {product.name} ya tiene estos precios.
                      </>
                    ) : (
                      <>
                        Guarda {money(r.price)} como minorista y {money(wholesale)} como mayorista de <b className="text-ink">{product.name}</b>. Es lo único que se guarda en esta pantalla.
                      </>
                    )}
                  </p>
                  <Button variant="primary" icon={Check} onClick={usePrice} loading={save.isPending} disabled={sameAsCurrent}>
                    Usar este precio
                  </Button>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-[13.5px] text-ink-soft">
                  <Wine size={16} className="shrink-0 text-muted" aria-hidden />
                  Si elegís un vino de tu lista, vas a poder guardarle este precio con un clic.
                </p>
              )
            }
          >
            <TicketRow label="Costo por botella" value={money(cost)} />
            {freight > 0 && <TicketRow op="+" label="Flete por botella" value={money(freight)} />}
            {freight > 0 && <TicketRow op="=" label="Costo total" value={money(r.breakdown.cost_total)} />}
            <TicketRow
              op="÷"
              label="Lo que queda del precio para el vino"
              info={
                <InfoTip
                  title="¿Por qué se divide?"
                  text="Ingresos Brutos y la comisión se cobran sobre el precio, no sobre el costo. Por eso no alcanza con sumarle un % al costo: hay que ver qué parte del precio queda para pagar el vino."
                />
              }
              sub={`100 % − ${nf(marginPct)} % margen − ${nf(iibb)} % IIBB − ${nf(fee)} % comisión`}
              value={pct(1 - r.reserved, 2)}
            />
            <TicketRow op="=" label="Precio exacto" value={money(r.raw_price, { decimals: 2 })} />
            {state.roundTo > 0 && <TicketRow op="+" label={`Redondeo a ${money(state.roundTo)}`} value={money(r.rounding, { decimals: 2 })} muted />}
            <TicketRow op="=" total label="Precio sugerido" value={money(r.price)} />

            <p className="mt-5 mb-2 text-[13.5px] font-bold text-ink">¿A dónde va cada peso de esos {money(r.price)}?</p>
            <SplitBar
              total={r.price}
              parts={[
                { label: 'El vino', value: r.breakdown.cost_total, color: CHART_COLORS.costo },
                { label: 'Ingresos Brutos', value: r.breakdown.iibb, color: CHART_COLORS.extra },
                { label: 'Comisión', value: r.breakdown.fee, color: CHART_COLORS.envios },
                { label: 'Te queda', value: r.breakdown.profit, color: CHART_COLORS.ganancia },
              ]}
            />

            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <MiniStat
                label="Te queda por botella"
                info={<InfoTip title="Lo que te queda" text="Precio − costo del vino − Ingresos Brutos − comisión. Con esto pagás los gastos fijos (alquiler, sueldos…) y lo que sobra es ganancia." />}
                value={money(r.breakdown.profit, { decimals: 0 })}
                sub={`${pct(r.margin)} del precio`}
              />
              <MiniStat label={`Por caja de ${units}`} value={money(r.breakdown.profit * units, { decimals: 0 })} sub={`${units} × ${money(r.breakdown.profit, { decimals: 0 })}`} />
              <MiniStat label="Markup equivalente" info={<InfoTip term="markup" />} value={pct(r.markup)} sub={`O sea: costo × ${nf(r.multiplier)}`} />
              <MiniStat label="Margen bruto" info={<InfoTip term="margen_bruto" />} value={pct(r.gross_margin)} sub="Antes de IIBB y comisión (el de Reportes)" />
            </div>

            <div className="mt-5 rounded-xl border border-line p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[14px] font-bold text-ink-soft">
                  Precio mayorista sugerido
                  <InfoTip
                    title="Precio mayorista"
                    text={`Es el minorista sugerido con ${nf(state.wholesaleDiscount ?? 0)} % de descuento (redondeado igual). El margen se calcula con el mismo IIBB y comisión. Por debajo de 20 % casi no deja nada para los gastos: vendés más botellas juntas, pero ganás poco con cada una.`}
                  />
                </p>
                {wholesaleA && <VerdictBadge verdict={wholesaleA.verdict} />}
              </div>
              <p className="vh-num mt-1 text-[1.6rem] leading-none font-extrabold text-ink">{money(wholesale)}</p>
              {wholesaleA && (
                <p className="mt-1.5 text-[13.5px] text-ink-soft">
                  Te quedan {money(wholesaleA.profit_per_bottle, { decimals: 0 })} por botella ({pct(wholesaleA.margin)}).
                </p>
              )}
              {wholesaleA && wholesaleA.margin < WHOLESALE_MIN_MARGIN && (
                <Note tone="warn" className="mt-2.5" title="Ojo con el mayorista">
                  Con {nf(state.wholesaleDiscount ?? 0)} % de descuento te queda menos de 20 % por botella. Achicá el descuento o subí el margen del minorista.
                </Note>
              )}
            </div>

            <Note tone="info" className="mt-4" title="La trampa del markup">
              Si al costo de {money(cost + freight, { decimals: 0 })} le sumás un {nf(marginPct)} % (markup), lo vendés a {money(trap.naive_price, { decimals: 0 })} y te queda solo un{' '}
              <b className="text-ink">{pct(trap.naive_margin)}</b>, no {nf(marginPct)} %. Para que te quede {nf(marginPct)} % hay que multiplicar el costo por <b className="text-ink">{nf(r.multiplier)}</b>.{' '}
              <InfoTip term="margen_vs_markup" className="align-[-2px]" />
            </Note>
          </Ticket>
        ) : (
          <Ticket id="calc-precio-resultado" hero={<TicketHero label="Precio sugerido (minorista)" value="—" />}>
            <Note tone="warn" title="Así no se puede calcular">
              {r.error}
            </Note>
          </Ticket>
        )}
      </div>

      <PriceReview ctx={ctx} state={state} fee={fee} onPick={(id) => {
        const p = products.find((x) => x.id === id) ?? null
        pickProduct(id, p)
        document.getElementById('calculadora-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }} />

      <MobileResult label="Precio sugerido" value={r.ok ? money(r.price) : '—'} targetId="calc-precio-resultado" />
    </div>
  )
}

// ───────────────────────── Revisión de todo el catálogo ─────────────────────────

function PriceReview({ ctx, state, fee, onPick }: { ctx: CalculatorContext; state: PrecioState; fee: number; onPick: (id: number) => void }) {
  const params = {
    target_margin_pct: state.margin ?? 0,
    iibb_pct: state.iibb ?? 0,
    fee_pct: fee,
    round_to: state.roundTo,
    wholesale_discount_pct: state.wholesaleDiscount ?? 0,
  }
  const valid = params.target_margin_pct + params.iibb_pct + params.fee_pct < 100 && params.target_margin_pct >= 0
  const rows = useMemo(() => (valid ? reviewPrices(ctx.products, params) : []), [ctx.products, valid, params.target_margin_pct, params.iibb_pct, params.fee_pct, params.round_to, params.wholesale_discount_pct]) // eslint-disable-line react-hooks/exhaustive-deps
  const below = rows.filter((r) => r.status === 'debajo').length
  const priced = rows.filter((r) => r.status === 'debajo' || r.status === 'ok').length

  const columns: Column<PriceReviewRow>[] = [
    {
      key: 'name',
      header: 'Vino',
      value: (r) => `${r.name} ${r.winery ?? ''}`,
      cell: (r) => (
        <span className="block min-w-[9rem]">
          <span className="block font-bold text-ink">
            {r.name}
            {r.vintage ? ` ${r.vintage}` : ''}
          </span>
          {r.winery && <span className="block text-[12.5px] text-muted">{r.winery}</span>}
        </span>
      ),
    },
    { key: 'cost', header: 'Costo', align: 'right', hideBelow: 'md', cell: (r) => (r.cost > 0 ? money(r.cost) : <span className="text-muted">sin costo</span>) },
    { key: 'price_retail', header: 'Precio hoy', align: 'right', cell: (r) => (r.price_retail > 0 ? money(r.price_retail) : <span className="text-muted">sin precio</span>) },
    {
      key: 'margin_retail',
      header: 'Te queda hoy',
      align: 'right',
      value: (r) => (r.price_retail > 0 ? r.margin_retail : null),
      cell: (r) =>
        r.price_retail > 0 && r.cost > 0 ? (
          <span className="inline-flex flex-col items-end gap-1">
            <span className="vh-num font-bold">{pct(r.margin_retail)}</span>
            <VerdictBadge verdict={r.verdict} />
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'suggested_retail', header: 'Precio sugerido', align: 'right', cell: (r) => (r.suggested_retail != null ? <b>{money(r.suggested_retail)}</b> : '—') },
    {
      key: 'diff_retail_pct',
      header: 'Diferencia',
      align: 'right',
      hideBelow: 'sm',
      cell: (r) =>
        r.diff_retail_pct == null || r.diff_retail == null ? (
          '—'
        ) : (
          <span className={r.status === 'debajo' ? 'font-bold text-bad' : 'text-good'}>
            {r.diff_retail > 0 ? `+${money(r.diff_retail)}` : money(r.diff_retail)}
            <span className="block text-[12px]">{pctDelta(r.diff_retail_pct)}</span>
          </span>
        ),
    },
    { key: 'suggested_wholesale', header: 'Mayorista sugerido', align: 'right', hideBelow: 'lg', cell: (r) => (r.suggested_wholesale != null ? money(r.suggested_wholesale) : '—') },
  ]

  return (
    <Card
      title={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          ¿Cómo están todos tus vinos con este margen?
          <InfoTip
            title="Revisión de precios"
            text="Usa los mismos números de arriba (margen, IIBB, comisión y redondeo) con el costo actual de cada vino. Tocá un vino para cargarlo en la calculadora. Es solo para mirar: no cambia ningún precio."
          />
        </span>
      }
      subtitle={
        rows.length
          ? below
            ? `${below} de ${priced} ${priced === 1 ? 'vino con precio queda' : 'vinos con precio quedan'} por debajo del ${nf(params.target_margin_pct)} %. Arriba de todo están los que más conviene revisar.`
            : `Todos tus vinos con precio llegan al ${nf(params.target_margin_pct)} %. ¡Bien ahí!`
          : 'Compará el precio de cada vino con el sugerido.'
      }
      actions={rows.length ? <ExportButton path="/calculator/prices/export" params={params} size="sm" /> : undefined}
      flush
    >
      <div className="px-5 pb-5">
        {!valid ? (
          <Note tone="warn">Con este margen, IIBB y comisión no hay precio posible. Ajustá los números de arriba.</Note>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => onPick(r.id)}
            initialSort={{ key: 'diff_retail_pct', dir: 'desc' }}
            searchPlaceholder="Buscar vino o bodega…"
            pageSize={10}
            empty={
              <EmptyState
                compact
                title="Todavía no cargaste vinos"
                action={
                  <Link to="/vinos?nuevo=1" className="inline-flex h-10 items-center rounded-full border border-line-strong bg-paper px-4 text-[14.5px] font-bold text-ink hover:border-brown/50">
                    Cargar mi primer vino
                  </Link>
                }
              >
                Cuando tengas tus vinos con su costo, acá vas a ver cuáles están por debajo del margen que querés.
              </EmptyState>
            }
          />
        )}
      </div>
    </Card>
  )
}
