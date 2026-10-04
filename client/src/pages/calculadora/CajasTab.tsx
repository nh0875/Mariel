// "Cajas, promos y dólar": cuánto te queda al vender una caja con descuento (y hasta dónde
// podés descontar), más un conversor pesos ↔ dólares con la cotización de referencia.
import { Link } from 'react-router-dom'
import { ArrowRightLeft } from 'lucide-react'
import type { Product } from '@shared/types'
import { round2 } from '@shared/calc'
import { MARGIN_FAIR, arsToUsd, boxDeal, usdToArs, type CalculatorContext } from '@shared/pricing'
import { ChartCard, ResultChart } from '@/components/charts'
import { Card, Field, InfoTip, IntInput, MoneyInput, NumberInput } from '@/components/ui'
import { date, usd } from '@/lib/format'
import {
  InputsCard,
  MiniStat,
  MobileResult,
  Note,
  PaymentMethodField,
  PercentField,
  SliderField,
  Ticket,
  TicketHero,
  TicketRow,
  VerdictBadge,
  WinePicker,
  baseNumbers,
  defaultFeeKey,
  feeFor,
  money,
  pct,
} from './parts'

export interface CajasState {
  productId: number | null
  price: number | null
  cost: number | null
  units: number | null
  discount: number | null
  iibb: number | null
  feeKey: string
  usdRate: number | null
  /** Monto del conversor y en qué moneda lo escribiste. */
  convAmount: number | null
  convDir: 'ars' | 'usd'
}

export function defaultCajas(ctx: CalculatorContext): CajasState {
  const b = baseNumbers(ctx)
  return {
    productId: null,
    price: Math.round(b.price),
    cost: round2(b.cost),
    units: ctx.units_per_box,
    discount: 10,
    iibb: ctx.pricing.iibb_pct,
    feeKey: defaultFeeKey(ctx),
    usdRate: ctx.usd_rate > 0 ? ctx.usd_rate : null,
    convAmount: Math.round(b.price) * ctx.units_per_box,
    convDir: 'ars',
  }
}

const nf = (v: number, d = 1) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: d }).format(v)

export function CajasTab({ ctx, state, set, onReset }: { ctx: CalculatorContext; state: CajasState; set: (patch: Partial<CajasState>) => void; onReset: () => void }) {
  const fee = feeFor(ctx, state.feeKey)
  const iibb = state.iibb ?? 0
  const input = { price: state.price ?? 0, cost: state.cost ?? 0, units: state.units ?? 0, discount_pct: state.discount ?? 0, iibb_pct: iibb, fee_pct: fee }
  const d = boxDeal(input)
  const rate = state.usdRate ?? 0
  const overMax = d.ok && (state.discount ?? 0) > d.max_discount_pct + 0.05

  const chartRows = Array.from({ length: 9 }, (_, i) => i * 5).map((disc) => {
    const x = boxDeal({ ...input, discount_pct: disc })
    return { label: `${disc} %`, discount: disc, profit: x.profit, margin: x.margin }
  })

  const pick = (id: number | null, p: Product | null) => {
    if (!p) return set({ productId: id })
    set({ productId: id, price: p.price_retail, cost: round2(p.unit_cost), units: p.units_per_box })
  }

  const arsValue = state.convDir === 'ars' ? state.convAmount : state.convAmount != null ? usdToArs(state.convAmount, rate) : null
  const usdValue = state.convDir === 'usd' ? state.convAmount : state.convAmount != null ? arsToUsd(state.convAmount, rate) : null

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:items-start">
        <InputsCard
          title="Una caja con descuento"
          subtitle="Ej: «llevando 6, 10 % off». ¿Cuánto te queda y hasta dónde podés descontar?"
          onReset={onReset}
          note={<WinePicker value={state.productId} onChange={pick} hint="Trae su precio minorista, su costo y cuántas botellas trae la caja." />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Precio por botella" hint="El de lista, sin descuento.">
              <MoneyInput value={state.price} onChange={(v) => set({ price: v })} aria-label="Precio por botella" />
            </Field>
            <Field label="Costo por botella" info="costo_promedio">
              <MoneyInput value={state.cost} onChange={(v) => set({ cost: v })} aria-label="Costo por botella" />
            </Field>
          </div>
          <Field label="Botellas por caja" error={(state.units ?? 0) < 1 ? 'La caja tiene que tener al menos 1 botella.' : undefined}>
            <IntInput value={state.units} onChange={(v) => set({ units: v })} suffix="bot." aria-label="Botellas por caja" />
          </Field>
          <SliderField
            label="Descuento de la caja"
            hint="Sobre el precio de lista de toda la caja."
            value={state.discount}
            onChange={(v) => set({ discount: v })}
            min={0}
            max={40}
            ticks={['0 %', '20 %', '40 %']}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <PercentField label="Ingresos Brutos" info="iibb" value={state.iibb} onChange={(v) => set({ iibb: v })} max={20} />
            <PaymentMethodField ctx={ctx} value={state.feeKey} onChange={(feeKey) => set({ feeKey })} />
          </div>
        </InputsCard>

        <Ticket
          id="calc-cajas-resultado"
          hero={
            <TicketHero
              label="Te queda por caja"
              info={<InfoTip title="Lo que te queda por caja" text="Precio de la caja con descuento − costo de las botellas − Ingresos Brutos − comisión." />}
              value={d.ok ? money(d.profit, { decimals: 0 }) : '—'}
              badge={d.ok && (state.cost ?? 0) > 0 ? <VerdictBadge verdict={d.verdict} large /> : undefined}
              sub={
                d.ok ? (
                  <>
                    Un <b className="text-ink">{pct(d.margin)}</b> de lo que cobrás. Sin descuento te quedaban {money(d.profit + d.profit_lost, { decimals: 0 })} ({pct(d.margin_without_discount)}).
                  </>
                ) : (
                  d.error
                )
              }
            />
          }
        >
          <TicketRow label="Precio de lista de la caja" sub={`${d.units} × ${money(state.price ?? 0)}`} value={money(d.list_price)} />
          <TicketRow op="−" label={`Descuento (${nf(state.discount ?? 0)} %)`} value={money(d.discount_amount)} />
          <TicketRow op="=" label="Lo que paga el cliente" value={<b>{money(d.box_price)}</b>} sub={rate > 0 && d.box_price > 0 ? `≈ ${usd(arsToUsd(d.box_price, rate))}` : undefined} />
          <TicketRow op="−" label="Costo del vino" sub={`${d.units} × ${money(state.cost ?? 0)}`} value={money(d.box_cost)} />
          <TicketRow op="−" label={`Ingresos Brutos (${nf(iibb, 2)} %)`} value={money(d.iibb)} />
          <TicketRow op="−" label={`Comisión (${nf(fee, 2)} %)`} value={money(d.fee)} />
          <TicketRow op="=" total label="Te queda por caja" value={money(d.profit)} />

          {d.ok && (
            <>
              <div className="mt-5 grid grid-cols-2 gap-2.5">
                <MiniStat label="Por botella" value={money(d.profit_per_bottle, { decimals: 0 })} sub={`Sin descuento: ${money((d.profit + d.profit_lost) / Math.max(1, d.units), { decimals: 0 })}`} />
                <MiniStat
                  label="El descuento te cuesta"
                  info={
                    <InfoTip
                      title="Lo que te cuesta el descuento"
                      text="Lo que dejás de ganar con la caja por hacer el descuento. Tiene sentido si te hace vender más botellas (o vender antes un vino que está parado)."
                    />
                  }
                  value={money(d.profit_lost, { decimals: 0 })}
                  sub="de ganancia por caja"
                />
              </div>
              {(state.cost ?? 0) <= 0 ? (
                <Note tone="warn" className="mt-4" title="Falta el costo">
                  Sin el costo de la botella no podemos decirte hasta dónde descontar. Escribilo arriba o elegí un vino de tu lista.
                </Note>
              ) : d.margin_without_discount <= 0 ? (
                <Note tone="bad" className="mt-4" title="¿Hasta dónde podés descontar?">
                  Ni siquiera sin descuento te queda algo: con este precio ya perdés plata en cada caja. Revisá el precio en «¿A cuánto lo vendo?» antes de pensar en promos.
                </Note>
              ) : (
                <Note tone={d.profit < 0 ? 'bad' : overMax ? 'warn' : 'good'} className="mt-4" title="¿Hasta dónde podés descontar?">
                  {d.max_discount_pct > 0 ? (
                    <>
                      Hasta <b>{nf(d.max_discount_pct)} %</b> de descuento te sigue quedando un {pct(MARGIN_FAIR, 0)} de margen.{' '}
                    </>
                  ) : (
                    <>Sin descuento ya te queda menos de {pct(MARGIN_FAIR, 0)}: en este vino no conviene descontar. </>
                  )}
                  Con más de <b>{nf(d.break_even_discount_pct)} %</b> perdés plata con la caja.
                </Note>
              )}
            </>
          )}
        </Ticket>
      </div>

      {d.ok && (
        <ChartCard
          title="Lo que te queda por caja según el descuento"
          subtitle={`Caja de ${d.units} a ${money(state.price ?? 0)} por botella. En verde ganás; en coral, perdés plata con la caja.`}
          table={{
            columns: [
              { key: 'label', header: 'Descuento' },
              { key: 'profit', header: 'Te queda por caja', align: 'right', format: (v) => money(Number(v)) },
              { key: 'margin', header: 'Margen', align: 'right', format: (v) => pct(Number(v)) },
            ],
            rows: chartRows,
          }}
        >
          <ResultChart data={chartRows} valueKey="profit" label="Te queda por caja" height={230} />
        </ChartCard>
      )}

      <Card
        title={
          <span>
            Pesos ↔ dólares <InfoTip term="dolar" className="align-[-2px]" />
          </span>
        }
        subtitle="Para tener una referencia en dólares (ej: precios de bodegas o comparar en el tiempo). Escribí en cualquiera de los dos campos."
      >
        <div className="grid items-start gap-4 sm:grid-cols-[1fr_1fr_auto_1fr]">
          <Field
            label="Cotización del dólar"
            hint={
              ctx.usd_rate > 0 ? (
                <>
                  La de Configuración{ctx.usd_rate_date ? ` (${date(ctx.usd_rate_date)})` : ''}. Si la cambiás acá no se guarda:{' '}
                  <Link to="/configuracion" className="font-bold text-sky-deep hover:underline">
                    guardala en Configuración
                  </Link>
                  .
                </>
              ) : (
                <>
                  Todavía no cargaste una cotización. Escribila acá para probar, o{' '}
                  <Link to="/configuracion" className="font-bold text-sky-deep hover:underline">
                    guardala en Configuración
                  </Link>
                  .
                </>
              )
            }
          >
            <MoneyInput value={state.usdRate} onChange={(v) => set({ usdRate: v })} aria-label="Cotización del dólar" />
          </Field>
          <Field label="Pesos">
            <MoneyInput value={arsValue} onChange={(v) => set({ convAmount: v, convDir: 'ars' })} aria-label="Monto en pesos" />
          </Field>
          <ArrowRightLeft size={20} className="mt-10 hidden justify-self-center text-muted sm:block" aria-hidden />
          <Field label="Dólares">
            <NumberInput
              value={usdValue}
              onChange={(v) => set({ convAmount: v, convDir: 'usd' })}
              prefix="US$"
              decimals={2}
              inputClassName="pl-12"
              aria-label="Monto en dólares"
              placeholder={rate > 0 ? '0' : 'Falta la cotización'}
            />
          </Field>
        </div>
        {!(rate > 0) && (
          <Note tone="info" className="mt-4">
            Sin cotización no podemos convertir. Escribí cuántos pesos vale un dólar arriba a la izquierda.
          </Note>
        )}
      </Card>

      <MobileResult label="Te queda por caja" value={d.ok ? money(d.profit, { decimals: 0 }) : '—'} targetId="calc-cajas-resultado" />
    </div>
  )
}
