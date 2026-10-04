// "Punto de equilibrio": cuántas botellas (y cuántos pesos) tenés que vender por mes para no
// perder plata, comparado con lo que vendés hoy, y el resultado según las botellas que vendas.
import { CHART_COLORS } from '@shared/constants'
import { breakEven, variableCostPerBottle, type CalculatorContext } from '@shared/pricing'
import { ChartCard, ResultChart } from '@/components/charts'
import { Field, InfoTip, MoneyInput } from '@/components/ui'
import { int } from '@/lib/format'
import {
  ExampleNote,
  InputsCard,
  MiniStat,
  MobileResult,
  Note,
  PercentField,
  Ticket,
  TicketHero,
  TicketRow,
  baseNumbers,
  money,
  moneyCompact,
  monthsText,
  pct,
} from './parts'

export interface EquilibrioState {
  fixed: number | null
  price: number | null
  cost: number | null
  variablePct: number | null
}

export function defaultEquilibrio(ctx: CalculatorContext): EquilibrioState {
  const b = baseNumbers(ctx)
  return { fixed: b.fixed, price: b.price, cost: b.cost, variablePct: b.variable_pct }
}

const nf = (v: number, d = 1) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: d }).format(v)

/**
 * Redondea varios porcentajes de modo que sumen exactamente el total redondeado
 * (si no, "2,24 + 0,68 + 9,08 = 12,01" no cierra a la vista).
 */
function roundParts(values: number[], decimals = 2): number[] {
  const f = 10 ** decimals
  const total = Math.round(values.reduce((a, b) => a + b, 0) * f)
  const floors = values.map((v) => Math.floor(v * f + 1e-9))
  let rest = total - floors.reduce((a, b) => a + b, 0)
  const order = values.map((v, i) => ({ i, r: v * f - floors[i] })).sort((a, b) => b.r - a.r)
  for (const o of order) {
    if (rest <= 0) break
    floors[o.i]++
    rest--
  }
  return floors.map((x) => x / f)
}

/** Escala "linda" para el eje del gráfico (múltiplos de 1, 2, 5 × 10ⁿ). */
function niceStep(max: number, steps: number): number {
  const raw = Math.max(1, max / steps)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow
}

export function EquilibrioTab({ ctx, state, set, onReset }: { ctx: CalculatorContext; state: EquilibrioState; set: (patch: Partial<EquilibrioState>) => void; onReset: () => void }) {
  const base = baseNumbers(ctx)
  const price = state.price ?? 0
  const cost = state.cost ?? 0
  const fixed = state.fixed ?? 0
  const varPct = state.variablePct ?? 0
  const variableOther = price * (varPct / 100)
  const be = breakEven({ fixed_costs: fixed, avg_price: price, avg_variable_cost_per_bottle: variableCostPerBottle(price, cost, varPct) })
  // Sin tocar nada: son los promedios reales (los mismos meses que usan Metas y Reportes).
  const untouched = state.fixed === base.fixed && state.price === base.price && state.cost === base.cost && state.variablePct === base.variable_pct
  const months = monthsText(ctx.months_used)
  // Botellas por mes reales (sin redondear, para que "te quedan $ X" coincida con Reportes).
  const actual = !base.isExample ? base.bottles : null
  const topFixed = ctx.fixed_by_category.slice(0, 3)

  // Comparación con lo que vendés hoy
  const compare = be.ok && be.bottles > 0 && actual != null && actual > 0 ? actual / be.bottles - 1 : null
  const resultAtActual = actual != null && be.ok ? actual * (price * (1 - varPct / 100) - cost) - fixed : null
  const salesBase = ctx.avg_sales > 0 ? ctx.avg_sales : 0
  const varParts = salesBase
    ? [
        { label: 'comisiones', v: ctx.avg_fees },
        { label: 'mermas', v: ctx.avg_shrinkage },
        { label: 'gastos variables (envíos, impuestos, packaging…)', v: ctx.avg_variable_expenses },
      ].filter((x) => x.v > 0)
    : []
  const varPartsPct = roundParts(varParts.map((x) => (x.v / salesBase) * 100))

  // Gráfico: resultado del mes según las botellas vendidas
  const maxB = Math.max(be.ok ? be.bottles * 2 : 0, actual ? actual * 1.3 : 0, 20)
  const step = niceStep(maxB, 12)
  const points = Array.from({ length: Math.ceil(maxB / step) + 1 }, (_, i) => i * step)
  const chartRows = points.map((b) => ({ label: `${int(b)} bot.`, bottles: b, sales: b * price, result: b * be.contribution_per_bottle - fixed }))
  const maxBar = Math.max(be.ok ? be.bottles : 0, actual ?? 0, 1)

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:items-start">
        <InputsCard
          subtitle={base.isExample ? 'Escribí tus números y mirá cuánto tenés que vender.' : `Precargado con tus promedios de ${months}. Podés cambiar cualquiera.`}
          onReset={onReset}
          note={<ExampleNote base={base} />}
        >
          <Field
            label="Gastos fijos por mes"
            info="gastos_fijos"
            hint={
              ctx.avg_fixed_expenses > 0 && topFixed.length ? (
                <>
                  Promedio de {months}. Los más grandes: {topFixed.map((c) => `${c.category} ${moneyCompact(c.avg)}`).join(' · ')}.
                </>
              ) : (
                'Alquiler, sueldos, servicios, contador… lo que pagás vendas o no.'
              )
            }
          >
            <MoneyInput value={state.fixed} onChange={(v) => set({ fixed: v })} aria-label="Gastos fijos por mes" />
          </Field>
          {ctx.has_data && ctx.avg_fixed_expenses <= 0 && (
            <Note tone="warn" title="No encontramos gastos fijos">
              En {months} no hay gastos marcados como fijos (alquiler, sueldos…). Cargalos en «Gastos» o escribí acá cuánto pagás por mes para que el cálculo sea real.
            </Note>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Precio promedio por botella" hint={ctx.has_data ? `Tus ventas ÷ botellas: ${money(ctx.avg_price_per_bottle)}.` : 'Lo que cobrás en promedio por botella.'}>
              <MoneyInput value={state.price} onChange={(v) => set({ price: v })} aria-label="Precio promedio por botella" />
            </Field>
            <Field
              label="Costo promedio por botella"
              info="cmv"
              hint={ctx.has_data ? `Lo que te costaron las que vendiste: ${money(ctx.avg_cost_per_bottle)}.` : 'Lo que te cuesta en promedio cada botella.'}
            >
              <MoneyInput value={state.cost} onChange={(v) => set({ cost: v })} aria-label="Costo promedio por botella" />
            </Field>
          </div>
          <PercentField
            label="Otros costos variables (% de las ventas)"
            info="gastos_variables"
            value={state.variablePct}
            onChange={(v) => set({ variablePct: v })}
            hint={
              ctx.has_data && varParts.length
                ? `Lo que se fue con cada venta además del vino en ${months}: ${varPartsPct.map((v, i) => `${varParts[i].label} ${nf(v, 2)}\u00a0%`).join(' + ')} = ${nf(varPartsPct.reduce((a, b) => a + b, 0), 2)}\u00a0% de lo que vendiste.`
                : 'Comisiones, envíos, packaging, roturas… como % de lo que vendés.'
            }
          />
        </InputsCard>

        <Ticket
          id="calc-equilibrio-resultado"
          hero={
            <TicketHero
              label="Para no perder plata necesitás vender por mes"
              info={<InfoTip term="punto_equilibrio" />}
              value={be.ok ? `${int(be.bottles)} botellas` : '—'}
              sub={
                be.ok ? (
                  be.bottles > 0 ? (
                    <>
                      Unas <b className="text-ink">{nf(be.bottles_per_day)} por día hábil</b> (contando 25 días de venta por mes), o sea <b className="text-ink">{money(be.sales, { decimals: 0 })}</b>{' '}
                      en ventas.
                    </>
                  ) : (
                    'Sin gastos fijos, cualquier venta ya te deja ganancia.'
                  )
                ) : (
                  'Con estos números no se puede calcular.'
                )
              }
            />
          }
        >
          <TicketRow label="Precio promedio por botella" value={money(price)} />
          <TicketRow op="−" label="Costo del vino" value={money(cost)} />
          <TicketRow op="−" label={`Otros costos variables (${nf(varPct, 2)} % del precio)`} value={money(variableOther, { decimals: 0 })} />
          <TicketRow
            op="="
            total
            label="Te deja cada botella"
            info={<InfoTip term="contribucion" />}
            sub={be.ok || price > 0 ? `Margen de contribución: ${pct(be.contribution_margin)}` : undefined}
            value={money(be.contribution_per_bottle)}
          />
          <div className="h-3" />
          <TicketRow label="Gastos fijos por mes" info={<InfoTip term="gastos_fijos" />} value={money(fixed)} />
          <TicketRow op="÷" label="Lo que deja cada botella" value={money(be.contribution_per_bottle)} />
          <TicketRow
            op="="
            total
            label="Botellas por mes"
            sub={be.ok && be.bottles_exact % 1 > 0.001 ? `${nf(be.bottles_exact, 1)}, redondeado para arriba` : undefined}
            value={be.ok ? int(be.bottles) : '—'}
          />
          {be.ok && be.bottles > 0 && (
            <TicketRow
              label="En pesos: ventas por mes"
              sub={
                untouched && !base.isExample
                  ? `Gastos fijos ÷ margen de contribución (${pct(be.contribution_margin)}). Es la misma cuenta que Metas y Reportes con ${months} (puede diferir unos pesos por el redondeo de los números de arriba).`
                  : `Gastos fijos ÷ margen de contribución (${pct(be.contribution_margin)})`
              }
              value={money(be.sales, { decimals: 0 })}
            />
          )}

          {!be.ok && be.error && (
            <Note tone="bad" className="mt-4" title="No hay punto de equilibrio">
              {be.error}
            </Note>
          )}

          {compare != null && actual != null && (
            <div className="mt-5 rounded-xl border border-line p-3.5">
              <p className="mb-2.5 text-[13.5px] font-bold text-ink">¿Cómo venís? (promedio de {months})</p>
              <div className="space-y-2.5">
                {[
                  { label: 'Para no perder', value: be.bottles, color: 'var(--color-ink-soft)' },
                  { label: 'Hoy vendés', value: actual, color: CHART_COLORS.ventas },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-3 text-[13.5px]">
                    <span className="w-28 shrink-0 text-ink-soft">{row.label}</span>
                    <div className="h-3 min-w-0 flex-1 rounded-full bg-cream-deep">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, (row.value / maxBar) * 100)}%`, background: row.color }} />
                    </div>
                    <span className="vh-num w-16 shrink-0 text-right font-extrabold text-ink">{int(row.value)}</span>
                  </div>
                ))}
              </div>
              {compare >= 0 ? (
                <Note tone="good" className="mt-3" title={`Hoy vendés ${int(actual)} botellas por mes: estás ${pct(compare, 0)} arriba del equilibrio\u00a0🎉`}>
                  {resultAtActual != null && resultAtActual > 0 && (
                    <>
                      Con estos números, a ese ritmo te quedan unos <b>{money(resultAtActual, { decimals: 0 })}</b> por mes. Cada botella de más suma {money(be.contribution_per_bottle)}.
                    </>
                  )}
                </Note>
              ) : (
                <Note tone="warn" className="mt-3" title={`Hoy vendés ${int(actual)} botellas por mes: estás ${pct(-compare, 0)} abajo del equilibrio`}>
                  Te faltan unas <b>{int(Math.ceil(be.bottles_exact - actual))} botellas por mes</b> para no perder. Podés subir precios, vender más o bajar gastos fijos: probá cada opción en «¿Qué pasa si…?».
                </Note>
              )}
            </div>
          )}

          {be.ok && (
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <MiniStat label="Por día hábil" value={`${nf(be.bottles_per_day)} bot.`} sub="Mes de 25 días de venta" />
              <MiniStat label="Por semana" value={`${nf(be.bottles / 4.33, 0)} bot.`} sub="Un mes tiene 4,33 semanas" />
            </div>
          )}
        </Ticket>
      </div>

      {be.ok && price > 0 && (
        <ChartCard
          title="Resultado del mes según cuántas botellas vendas"
          term="punto_equilibrio"
          subtitle={
            be.bottles > 0
              ? `Cada barra es un mes vendiendo esa cantidad de botellas: en coral perdés plata, en verde ganás. El cambio está en las ${int(be.bottles)} botellas.`
              : 'Sin gastos fijos, desde la primera botella ganás.'
          }
          table={{
            columns: [
              { key: 'bottles', header: 'Botellas por mes', align: 'right', format: (v) => int(Number(v)) },
              { key: 'sales', header: 'Ventas', align: 'right', format: (v) => money(Number(v), { decimals: 0 }) },
              { key: 'result', header: 'Resultado', align: 'right', format: (v) => money(Number(v), { decimals: 0 }) },
            ],
            rows: chartRows,
          }}
        >
          <ResultChart data={chartRows} valueKey="result" label="Resultado del mes" height={250} />
        </ChartCard>
      )}

      <MobileResult label="Botellas por mes para no perder" value={be.ok ? int(be.bottles) : '—'} targetId="calc-equilibrio-resultado" />
    </div>
  )
}
