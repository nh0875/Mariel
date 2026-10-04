// "¿Qué pasa si…?": simulador del resultado del mes moviendo precio, costo del vino, botellas
// vendidas y gastos fijos, con 3 escenarios de un clic y la frase que lo resume.
import { useState } from 'react'
import { ChevronDown, Megaphone, Store, Truck, Undo2 } from 'lucide-react'
import clsx from 'clsx'
import { priceChangeToKeepResult, simulate, type CalculatorContext, type SimulationResult } from '@shared/pricing'
import { ChartCard, ResultChart } from '@/components/charts'
import { Badge, Button, Field, InfoTip, IntInput, MoneyInput, Money } from '@/components/ui'
import { int } from '@/lib/format'
import {
  ExampleNote,
  InputsCard,
  MobileResult,
  Note,
  PercentField,
  SliderField,
  Ticket,
  TicketHero,
  baseNumbers,
  money,
  monthsText,
  pct,
  pctDelta,
} from './parts'

export type ScenarioKey = 'bodega15' | 'promo2x1' | 'alquiler25' | null

export interface SimuladorState {
  bottles: number | null
  price: number | null
  cost: number | null
  fixed: number | null
  variablePct: number | null
  /** Cambios en % (10 = +10 %). */
  priceChange: number | null
  costChange: number | null
  volumeChange: number | null
  fixedChange: number | null
  scenario: ScenarioKey
}

export function defaultSimulador(ctx: CalculatorContext): SimuladorState {
  const b = baseNumbers(ctx)
  return { bottles: b.bottles, price: b.price, cost: b.cost, fixed: b.fixed, variablePct: b.variable_pct, priceChange: 0, costChange: 0, volumeChange: 0, fixedChange: 0, scenario: null }
}

const nf = (v: number, d = 1) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: d }).format(v)
const ZERO = { priceChange: 0, costChange: 0, volumeChange: 0, fixedChange: 0 }

/** Supuesto del escenario "Alquiler +25 %" cuando no hay un gasto de alquiler cargado. */
const ASSUMED_RENT_SHARE = 1 / 3
/** Supuestos de la promo 2x1: el vino en promo es el 15 % de las botellas y la promo trae 12 % más de botellas. */
const PROMO_SHARE = 0.15
const PROMO_EXTRA_VOLUME = 12

function rentShare(ctx: CalculatorContext): { share: number; rent: number | null } {
  const rent = ctx.fixed_by_category.filter((c) => /alquiler/i.test(c.category)).reduce((s, c) => s + c.avg, 0)
  if (rent > 0 && ctx.avg_fixed_expenses > 0) return { share: Math.min(1, rent / ctx.avg_fixed_expenses), rent }
  return { share: ASSUMED_RENT_SHARE, rent: null }
}

/** "Si subís los precios 10 % y vendés 5 % menos, ganarías $X más por mes." */
function sentence(s: SimuladorState, r: SimulationResult): string {
  const parts: string[] = []
  const p = s.priceChange ?? 0
  const c = s.costChange ?? 0
  const v = s.volumeChange ?? 0
  const f = s.fixedChange ?? 0
  if (p) parts.push(`${p > 0 ? 'subís' : 'bajás'} los precios ${nf(Math.abs(p))} %`)
  if (c) parts.push(c > 0 ? `la bodega te aumenta ${nf(c)} %` : `conseguís el vino ${nf(-c)} % más barato`)
  if (v) parts.push(`vendés ${nf(Math.abs(v))} % ${v > 0 ? 'más' : 'menos'} botellas`)
  if (f) parts.push(`tus gastos fijos ${f > 0 ? 'suben' : 'bajan'} ${nf(Math.abs(f))} %`)
  if (!parts.length) return 'Mové las barritas (o tocá un escenario) para ver qué le pasa a tu resultado del mes.'
  const cond = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
  const before = r.before.result
  const after = r.after.result
  const d = r.delta.result
  const m = (x: number) => money(Math.abs(x), { decimals: 0 })
  let out: string
  if (Math.abs(d) < 1) out = 'tu resultado del mes quedaría prácticamente igual'
  else if (before >= 0 && after >= 0) out = d > 0 ? `ganarías ${m(d)} más por mes` : `ganarías ${m(d)} menos por mes`
  else if (before >= 0 && after < 0) out = `pasarías a perder ${m(after)} por mes`
  else if (before < 0 && after >= 0) out = `dejarías de perder plata: ganarías ${m(after)} por mes`
  else out = d > 0 ? `perderías ${m(d)} menos por mes` : `perderías ${m(d)} más por mes`
  return `Si ${cond}, ${out}.`
}

export function SimuladorTab({ ctx, state, set, onReset }: { ctx: CalculatorContext; state: SimuladorState; set: (patch: Partial<SimuladorState>) => void; onReset: () => void }) {
  const base = baseNumbers(ctx)
  const [showBase, setShowBase] = useState(base.isExample)
  const months = monthsText(ctx.months_used)
  const simBase = { bottles: state.bottles ?? 0, avg_price: state.price ?? 0, avg_cost: state.cost ?? 0, fixed: state.fixed ?? 0, variable_pct: state.variablePct ?? 0 }
  const changes = {
    price_change: (state.priceChange ?? 0) / 100,
    cost_change: (state.costChange ?? 0) / 100,
    volume_change: (state.volumeChange ?? 0) / 100,
    fixed_change: (state.fixedChange ?? 0) / 100,
  }
  const r = simulate({ base: simBase, ...changes })
  const keep = changes.cost_change || changes.volume_change || changes.fixed_change ? priceChangeToKeepResult(simBase, changes) : null
  const rent = rentShare(ctx)

  const scenarios: { key: Exclude<ScenarioKey, null>; label: string; icon: typeof Truck; apply: Partial<SimuladorState>; note: string }[] = [
    {
      key: 'bodega15',
      label: 'Aumento de la bodega del 15 %',
      icon: Truck,
      apply: { ...ZERO, costChange: 15 },
      note: 'Tu bodega aumenta 15 % y vos no tocás los precios. Abajo te decimos cuánto tendrías que subirlos para seguir ganando lo mismo.',
    },
    {
      key: 'promo2x1',
      label: 'Promo 2x1 en un vino',
      icon: Megaphone,
      apply: { ...ZERO, priceChange: -Math.round(PROMO_SHARE * 50 * 10) / 10, volumeChange: PROMO_EXTRA_VOLUME },
      note: `Es una aproximación: suponemos que el vino en promo es el ${pct(PROMO_SHARE, 0)} de las botellas que vendés. Esas botellas salen a mitad de precio (tu precio promedio baja ${nf(PROMO_SHARE * 50)} %) y la promo te trae ${PROMO_EXTRA_VOLUME} % más de botellas. Ajustá las barritas a tu caso.`,
    },
    {
      key: 'alquiler25',
      label: 'Alquiler +25 %',
      icon: Store,
      apply: { ...ZERO, fixedChange: Math.round(25 * rent.share * 10) / 10 },
      note:
        rent.rent != null
          ? `Tu alquiler promedio es ${money(rent.rent, { decimals: 0 })} por mes, el ${pct(rent.share, 0)} de tus gastos fijos. Si sube 25 %, tus gastos fijos suben ${nf(25 * rent.share)} %.`
          : `No encontramos un gasto «Alquiler» en tus últimos meses, así que suponemos que el alquiler es un tercio de tus gastos fijos: si sube 25 %, los fijos suben ${nf(25 * ASSUMED_RENT_SHARE)} %.`,
    },
  ]
  const active = scenarios.find((s) => s.key === state.scenario)
  const changed = !!(state.priceChange || state.costChange || state.volumeChange || state.fixedChange)

  const slider = (key: 'priceChange' | 'costChange' | 'volumeChange' | 'fixedChange', range: number) => ({
    value: state[key],
    onChange: (v: number | null) => set({ [key]: v, scenario: null } as Partial<SimuladorState>),
    min: -range,
    max: range,
    step: 1,
    signed: true,
    ticks: [`−${range} %`, '0', `+${range} %`],
  })

  const rows: { label: string; key: keyof SimulationResult['before']; kind: 'int' | 'money'; cost?: boolean; strong?: boolean }[] = [
    { label: 'Botellas por mes', key: 'bottles', kind: 'int' },
    { label: 'Ventas', key: 'sales', kind: 'money' },
    { label: 'Costo del vino', key: 'cogs', kind: 'money', cost: true },
    { label: 'Otros costos variables', key: 'variable', kind: 'money', cost: true },
    { label: 'Gastos fijos', key: 'fixed', kind: 'money', cost: true },
    { label: 'Resultado del mes', key: 'result', kind: 'money', strong: true },
  ]
  const fmt = (v: number, kind: 'int' | 'money') => (kind === 'int' ? int(Math.round(v)) : money(v, { decimals: 0 }))

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:items-start">
        <InputsCard
          title="Mové las barritas"
          subtitle={base.isExample ? 'Partimos de un negocio de ejemplo.' : `Partimos de tu mes promedio (${months}).`}
          onReset={onReset}
          note={<ExampleNote base={base} />}
        >
          <div>
            <p className="mb-2 text-[14px] font-bold text-ink">Escenarios de un clic</p>
            <div className="flex flex-wrap gap-2">
              {scenarios.map((s) => (
                <Button
                  key={s.key}
                  size="sm"
                  variant="soft"
                  icon={s.icon}
                  aria-pressed={state.scenario === s.key}
                  className={clsx(state.scenario === s.key && '!bg-ink !text-cream')}
                  onClick={() => set({ ...s.apply, scenario: s.key })}
                >
                  {s.label}
                </Button>
              ))}
              {changed && (
                <Button size="sm" variant="ghost" icon={Undo2} onClick={() => set({ ...ZERO, scenario: null })}>
                  Sin cambios
                </Button>
              )}
            </div>
            {active && (
              <Note tone="info" className="mt-3">
                {active.note}
              </Note>
            )}
          </div>
          <SliderField label="Precios" hint="Si subís los precios, la comisión también sube (es un % de lo que cobrás)." {...slider('priceChange', 30)} />
          <SliderField label="Costo del vino" info="costo_promedio" hint="Aumentos (o descuentos) de tus bodegas y distribuidores." {...slider('costChange', 30)} />
          <SliderField label="Botellas vendidas" hint="Cuántas botellas más (o menos) vendés por mes." {...slider('volumeChange', 50)} />
          <SliderField label="Gastos fijos" info="gastos_fijos" hint="Alquiler, sueldos, servicios…" {...slider('fixedChange', 30)} />

          <div className="rounded-xl border border-line">
            <button type="button" onClick={() => setShowBase((v) => !v)} aria-expanded={showBase} className="flex w-full items-center gap-2 px-3.5 py-3 text-left">
              <span className="flex-1">
                <span className="block text-[14px] font-bold text-ink">Tu mes de base</span>
                <span className="block text-[12.5px] text-muted">
                  {int(state.bottles ?? 0)} botellas a {money(state.price ?? 0, { decimals: 0 })} · fijos {money(state.fixed ?? 0, { decimals: 0 })}
                </span>
              </span>
              <span className="text-[13px] font-bold text-ink-soft">{showBase ? 'Ocultar' : 'Cambiar'}</span>
              <ChevronDown size={18} className={clsx('text-ink-soft transition-transform', showBase && 'rotate-180')} aria-hidden />
            </button>
            {showBase && (
              <div className="grid gap-4 border-t border-line p-3.5 sm:grid-cols-2">
                <Field label="Botellas por mes">
                  <IntInput value={state.bottles} onChange={(v) => set({ bottles: v })} aria-label="Botellas por mes" />
                </Field>
                <Field label="Precio promedio por botella">
                  <MoneyInput value={state.price} onChange={(v) => set({ price: v })} aria-label="Precio promedio por botella" />
                </Field>
                <Field label="Costo promedio por botella" info="cmv">
                  <MoneyInput value={state.cost} onChange={(v) => set({ cost: v })} aria-label="Costo promedio por botella" />
                </Field>
                <Field label="Gastos fijos por mes" info="gastos_fijos">
                  <MoneyInput value={state.fixed} onChange={(v) => set({ fixed: v })} aria-label="Gastos fijos por mes" />
                </Field>
                <PercentField
                  label="Otros costos variables"
                  info="gastos_variables"
                  value={state.variablePct}
                  onChange={(v) => set({ variablePct: v })}
                  hint="Comisiones, mermas, envíos… en % de las ventas."
                />
              </div>
            )}
          </div>
        </InputsCard>

        <div className="min-w-0 space-y-5">
          <Ticket
            id="calc-simulador-resultado"
            title="Hoy vs. con los cambios"
            hero={
              <TicketHero
                label="Resultado del mes con los cambios"
                info={<InfoTip term="resultado" />}
                value={money(r.after.result, { decimals: 0 })}
                valueClassName={r.after.result < -0.004 ? 'text-bad' : r.after.result > 0.004 ? 'text-good' : 'text-ink'}
                badge={
                  changed && Math.abs(r.delta.result) >= 1 ? (
                    <Badge tone={r.delta.result > 0 ? 'good' : 'bad'} className="!px-3 !py-1 !text-[14px]">
                      {money(r.delta.result, { decimals: 0, sign: true })} por mes
                    </Badge>
                  ) : undefined
                }
                sub={
                  <>
                    <span className="block font-semibold text-ink">{sentence(state, r)}</span>
                    <span className="mt-1 block">
                      Hoy: <Money value={r.before.result} decimals={0} tone="auto" className="font-bold" /> por mes
                      {base.isExample ? ' (negocio de ejemplo).' : ` (tu mes promedio de ${months}).`}
                    </span>
                  </>
                }
              />
            }
          >
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-line text-[12px] font-extrabold tracking-wide text-ink-soft uppercase">
                    <th className="px-1 py-2 text-left font-extrabold">Por mes</th>
                    <th className="px-1 py-2 text-right font-extrabold">Hoy</th>
                    <th className="px-1 py-2 text-right font-extrabold">Con cambios</th>
                    <th className="hidden px-1 py-2 text-right font-extrabold sm:table-cell">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const b = r.before[row.key] as number
                    const a = r.after[row.key] as number
                    const d = a - b
                    const good = row.cost ? d < 0 : d > 0
                    return (
                      <tr key={row.key} className={clsx('border-b border-dashed border-line last:border-0', row.strong && 'border-t-[1.5px] border-solid border-t-ink/70')}>
                        <td className={clsx('px-1 py-2', row.strong ? 'font-extrabold text-ink' : 'text-ink-soft')}>
                          {row.cost && <span className="mr-1 text-muted">−</span>}
                          {row.label}
                        </td>
                        <td className={clsx('vh-num px-1 py-2 text-right whitespace-nowrap', row.strong ? 'font-extrabold' : 'font-semibold')}>
                          {row.strong ? <Money value={b} decimals={0} tone="auto" /> : fmt(b, row.kind)}
                        </td>
                        <td className={clsx('vh-num px-1 py-2 text-right whitespace-nowrap', row.strong ? 'font-extrabold' : 'font-bold text-ink')}>
                          {row.strong ? <Money value={a} decimals={0} tone="auto" /> : fmt(a, row.kind)}
                        </td>
                        <td className={clsx('vh-num hidden px-1 py-2 text-right whitespace-nowrap sm:table-cell', Math.abs(d) < 0.5 ? 'text-muted' : good ? 'text-good' : 'text-bad')}>
                          {Math.abs(d) < 0.5 ? '=' : row.kind === 'int' ? `${d > 0 ? '+' : '−'}${int(Math.abs(Math.round(d)))}` : money(d, { decimals: 0, sign: true })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {keep != null && (
              <Note tone={keep > changes.price_change + 0.0005 ? 'warn' : 'good'} className="mt-4" title="Para seguir ganando lo mismo que hoy">
                {keep > changes.price_change + 0.0005 ? (
                  <>
                    Con esos cambios, los precios tendrían que moverse <b>{pctDelta(keep)}</b>
                    {changes.price_change ? <> (en la barrita pusiste {pctDelta(changes.price_change)})</> : null}.
                  </>
                ) : (
                  <>
                    Con esos cambios ya ganás lo mismo o más que hoy: alcanzaría con mover los precios <b>{pctDelta(keep)}</b>.
                  </>
                )}{' '}
                {keep > 0.0005 && `Un vino de ${money(10000)} pasaría a ${money(10000 * (1 + keep), { decimals: 0 })}.`}
              </Note>
            )}
            {r.after.sales > 0 && (
              <p className="mt-4 text-[13px] text-muted">
                Resultado = botellas × (precio − costo) − ventas × % de costos variables − gastos fijos.{' '}
                {changed && Math.abs(r.after.margin - r.before.margin) >= 0.0005
                  ? `El margen del mes pasaría de ${pct(r.before.margin)} a ${pct(r.after.margin)} de lo que vendés.`
                  : `Hoy te queda el ${pct(r.before.margin)} de lo que vendés.`}
              </p>
            )}
          </Ticket>
          <ChartCard
            title="Tu resultado del mes"
            term="resultado"
            subtitle="Verde si ganás, coral si perdés."
            table={{
              columns: [
                { key: 'label', header: '' },
                { key: 'result', header: 'Resultado del mes', align: 'right', format: (v) => money(Number(v), { decimals: 0 }) },
              ],
              rows: [
                { label: 'Hoy', result: r.before.result },
                { label: 'Con los cambios', result: r.after.result },
              ],
            }}
          >
            <ResultChart
              data={[
                { label: 'Hoy', result: r.before.result },
                { label: 'Con los cambios', result: r.after.result },
              ]}
              valueKey="result"
              label="Resultado del mes"
              height={190}
            />
          </ChartCard>
        </div>
      </div>

      <MobileResult label="Resultado con los cambios" value={money(r.after.result, { decimals: 0 })} targetId="calc-simulador-resultado" />
    </div>
  )
}
