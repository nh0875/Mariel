// "¿Cuánto gano con este precio?": lo que te queda de cada botella con un precio dado,
// con semáforo (sano / justo / bajo) y el porqué de esos umbrales.
import type { Product } from '@shared/types'
import { MARGIN_FAIR, MARGIN_HEALTHY, analyzePrice, suggestPrice, type CalculatorContext } from '@shared/pricing'
import { round2, safeDiv } from '@shared/calc'
import { Field, InfoTip, IntInput, MoneyInput, ProductSelect } from '@/components/ui'
import { pct } from '@/lib/format'
import { useProducts } from '@/lib/queries'
import {
  InputsCard,
  MarginMeter,
  MiniStat,
  MobileResult,
  Note,
  PaymentMethodField,
  PercentField,
  Segmented,
  Ticket,
  TicketHero,
  TicketRow,
  VerdictBadge,
  baseNumbers,
  defaultFeeKey,
  feeFor,
  money,
  monthsText,
} from './parts'

export interface GananciaState {
  productId: number | null
  list: 'minorista' | 'mayorista'
  price: number | null
  cost: number | null
  iibb: number | null
  feeKey: string
  units: number | null
}

export function defaultGanancia(ctx: CalculatorContext): GananciaState {
  const b = baseNumbers(ctx)
  return { productId: null, list: 'minorista', price: b.price, cost: b.cost, iibb: ctx.pricing.iibb_pct, feeKey: defaultFeeKey(ctx), units: ctx.units_per_box }
}

const nf = (v: number, d = 2) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: d }).format(v)

export function GananciaTab({ ctx, state, set, onReset }: { ctx: CalculatorContext; state: GananciaState; set: (patch: Partial<GananciaState>) => void; onReset: () => void }) {
  const { data: products = [] } = useProducts()
  const fee = feeFor(ctx, state.feeKey)
  const iibb = state.iibb ?? 0
  const a = analyzePrice({ price: state.price ?? 0, cost: state.cost ?? 0, iibb_pct: iibb, fee_pct: fee, units_per_box: state.units ?? 6 })
  const hasPrice = a.price > 0
  const healthy = suggestPrice({ cost: a.cost, target_margin: MARGIN_HEALTHY, iibb_pct: iibb, fee_pct: fee, round_to: 100 })
  const noLoss = suggestPrice({ cost: a.cost, target_margin: 0, iibb_pct: iibb, fee_pct: fee })
  const fixedShare = ctx.has_data ? safeDiv(ctx.avg_fixed_expenses, ctx.avg_sales) : null

  const pick = (id: number | null, p: Product | null, list = state.list) => {
    if (!p) return set({ productId: id })
    set({ productId: id, cost: round2(p.unit_cost), price: list === 'mayorista' ? p.price_wholesale : p.price_retail, units: p.units_per_box })
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:items-start">
      <InputsCard
        subtitle="Poné un precio y mirá cuánto te deja de verdad cada botella."
        onReset={onReset}
        note={
          <Field label="Elegí un vino (opcional)" hint="Trae su precio y su costo actual.">
            <ProductSelect value={state.productId} onChange={(id, p) => pick(id, p)} priceList={state.list} placeholder="Buscá un vino de tu lista…" />
          </Field>
        }
      >
        {state.productId != null && (
          <Field label="¿Qué precio querés mirar?">
            <Segmented
              label="Lista de precios"
              value={state.list}
              onChange={(list) => {
                set({ list })
                const p = products.find((x) => x.id === state.productId)
                if (p) set({ list, price: list === 'mayorista' ? p.price_wholesale : p.price_retail })
              }}
              options={[
                { value: 'minorista', label: 'Minorista' },
                { value: 'mayorista', label: 'Mayorista' },
              ]}
            />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Precio de venta" hint="Lo que paga el cliente por la botella.">
            <MoneyInput value={state.price} onChange={(v) => set({ price: v })} aria-label="Precio de venta" />
          </Field>
          <Field label="Costo por botella" info="costo_promedio" hint="Con el flete incluido.">
            <MoneyInput value={state.cost} onChange={(v) => set({ cost: v })} aria-label="Costo por botella" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <PercentField label="Ingresos Brutos" info="iibb" value={state.iibb} onChange={(v) => set({ iibb: v })} max={20} hint="El % de tu provincia." />
          <PaymentMethodField ctx={ctx} value={state.feeKey} onChange={(feeKey) => set({ feeKey })} />
        </div>
        <Field label="Botellas por caja" hint="Para calcular cuánto te deja una caja entera.">
          <IntInput value={state.units} onChange={(v) => set({ units: v })} suffix="bot." aria-label="Botellas por caja" />
        </Field>
      </InputsCard>

      <Ticket
        id="calc-ganancia-resultado"
        hero={
          <TicketHero
            label="Te queda por botella"
            info={<InfoTip title="Lo que te queda por botella" text="Precio − costo del vino − Ingresos Brutos − comisión. Es lo que aporta cada botella para pagar los gastos fijos y ganar." />}
            value={hasPrice ? money(a.profit_per_bottle, { decimals: 0 }) : '—'}
            badge={hasPrice ? <VerdictBadge verdict={a.verdict} large /> : undefined}
            sub={
              hasPrice ? (
                a.profit_per_bottle >= 0 ? (
                  <>
                    De cada $ 100 que cobrás te quedan <b className="text-ink">$ {nf(a.margin * 100, 1)}</b>. {a.verdict.explanation}
                  </>
                ) : (
                  <>{a.verdict.explanation}</>
                )
              ) : (
                'Escribí un precio de venta para ver cuánto te deja.'
              )
            }
          />
        }
      >
        <TicketRow label="Precio de venta" value={money(a.price)} />
        <TicketRow op="−" label="Costo del vino" value={money(a.cost)} />
        <TicketRow op="−" label={`Ingresos Brutos (${nf(iibb)} %)`} info={<InfoTip term="iibb" />} value={money(a.iibb)} />
        <TicketRow op="−" label={`Comisión (${nf(fee)} %)`} info={<InfoTip term="comisiones" />} value={money(a.fee)} />
        <TicketRow op="=" total label="Te queda por botella" value={money(a.profit_per_bottle)} />

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <MiniStat
            label="Margen"
            info={<InfoTip title="Margen (después de IIBB y comisión)" text="Lo que te queda ÷ precio. Es el número del semáforo: de cada $ 100 que cobrás, cuántos quedan para gastos fijos y ganancia." />}
            value={hasPrice ? pct(a.margin) : '—'}
            sub="Sobre el precio"
          />
          <MiniStat label="Markup" info={<InfoTip term="markup" />} value={a.cost > 0 && hasPrice ? pct(a.markup) : '—'} sub="Lo que le sumás al costo" />
          <MiniStat label={`Por caja de ${a.units_per_box}`} value={money(a.profit_per_box, { decimals: 0 })} sub={`${a.units_per_box} × ${money(a.profit_per_bottle, { decimals: 0 })}`} />
          <MiniStat label="Margen bruto" info={<InfoTip term="margen_bruto" />} value={hasPrice ? pct(a.gross_margin) : '—'} sub="Antes de IIBB y comisión" />
        </div>

        {hasPrice && (
          <div className="mt-5">
            <p className="mb-2 text-[13.5px] font-bold text-ink">Dónde cae tu margen</p>
            <MarginMeter margin={a.margin} />
          </div>
        )}

        {hasPrice && a.cost > 0 && a.margin < MARGIN_HEALTHY && healthy.ok && (
          <Note tone={a.margin < 0 ? 'bad' : 'warn'} className="mt-4" title={a.margin < 0 ? 'Así perdés plata con cada botella' : 'Para llegar a un margen sano'}>
            {a.margin < 0 && noLoss.ok && (
              <>
                Para no perder tendrías que cobrarla al menos <b>{money(noLoss.price)}</b>.{' '}
              </>
            )}
            Con un 35 % de margen el precio sería <b>{money(healthy.price)}</b> (redondeado a $ 100).
          </Note>
        )}

        <div className="mt-4 rounded-xl bg-cream px-3.5 py-3 text-[13.5px] leading-snug text-ink-soft">
          <p className="mb-1 font-extrabold text-ink">¿Por qué 35 % y 25 %?</p>
          <p>
            Es una regla práctica para vinotecas. Con lo que te queda de cada botella pagás alquiler, sueldos, servicios y el contador. En un comercio chico esos gastos fijos suelen comerse entre el 20 % y el 25 % de
            las ventas: con <b className="text-ink">{pct(MARGIN_HEALTHY, 0)} o más</b> los cubrís y queda ganancia; entre {pct(MARGIN_FAIR, 0)} y {pct(MARGIN_HEALTHY, 0)} vas justo; por debajo de {pct(MARGIN_FAIR, 0)}{' '}
            probablemente estés trabajando para pagar los gastos.
          </p>
          {fixedShare != null && fixedShare > 0 && (
            <p className="mt-1.5">
              En tu negocio, los gastos fijos fueron el <b className="text-ink">{pct(fixedShare)}</b> de lo que vendiste ({monthsText(ctx.months_used)}).
              {a.margin > 0 && hasPrice && (a.margin > fixedShare ? ' Este margen los cubre.' : ' Este margen no alcanza a cubrirlos.')}
            </p>
          )}
        </div>
      </Ticket>

      <MobileResult label="Te queda por botella" value={hasPrice ? money(a.profit_per_bottle, { decimals: 0 }) : '—'} targetId="calc-ganancia-resultado" />
    </div>
  )
}
