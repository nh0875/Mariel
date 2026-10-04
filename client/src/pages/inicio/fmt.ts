// Formatos propios de Inicio y Metas.
// - En un tablero los centavos solo molestan: redondeamos a pesos enteros.
// - Espacio que no se corta entre "$" y el número, así nunca queda "$" en una línea y el monto en otra.
import type { PeriodSummary } from '@shared/types'
import { money, moneyCompact } from '@/lib/format'

const NBSP = ' '
const glue = (s: string) => s.replace(/ /g, NBSP)

export const money0 = (v: number | null | undefined, opts: { sign?: boolean } = {}) => glue(money(v == null ? v : Math.round(v), { ...opts, decimals: 0 }))
export const compact = (v: number | null | undefined) => glue(moneyCompact(v))
/** "$ 61" (de cada $ 100) sin corte de línea. */
export const pesos = (n: number) => `$${NBSP}${n}`

const intFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

/**
 * Avance de una meta en %. Redondeo común, salvo cerca de la meta: 99,6 % no es "100 %" (todavía
 * no llegaste) y muestra "99 %". Así el número nunca contradice a "Metas cumplidas".
 */
export function progressPct(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  let v = Math.round(ratio * 100)
  if (ratio < 1 && v >= 100) v = 99
  return `${intFmt.format(v)}${NBSP}%`
}

/**
 * Pasa montos a "$ X de cada $ 100" con redondeo común y, si la suma no da `target` por los
 * redondeos, la diferencia (casi siempre ±1) la absorbe la parte más grande, donde no se nota.
 */
export function per100Parts(values: number[], base: number, target?: number): number[] {
  if (base <= 0) return values.map(() => 0)
  const out = values.map((v) => Math.round((v / base) * 100))
  if (target == null || !out.length) return out
  const diff = target - out.reduce((a, b) => a + b, 0)
  let big = 0
  values.forEach((v, i) => {
    if (v > values[big]) big = i
  })
  out[big] = Math.max(0, out[big] + diff)
  return out
}

/**
 * "$ X de cada $ 100" para cada paso del resultado, repartidos para que todo cierre:
 * - el vino y la ganancia bruta van con redondeo común (coinciden con el "Margen bruto" de arriba);
 * - comisiones, mermas y gastos se reparten para que, junto con lo que quedó (o lo que faltó),
 *   sumen exactamente la ganancia bruta. Sin esto, "$ 61 + $ 2 + $ 70" daba 133 y la pérdida decía 34.
 */
export function per100Map(s: PeriodSummary): Record<string, number> | null {
  if (s.sales <= 0) return null
  const simple = (v: number) => Math.round((Math.abs(v) / s.sales) * 100)
  const cogs = simple(s.cogs)
  const gross = 100 - cogs
  const net = simple(s.net_result)
  const rest = [s.fees, s.shrinkage, s.expenses_fixed, s.expenses_variable]
  // Con algún valor negativo (ej: un ajuste de stock a favor) el reparto no aplica: redondeo simple.
  const target = s.net_result >= 0 ? gross - net : gross + net
  const p = rest.some((v) => v < 0) || target < 0 ? rest.map(simple) : per100Parts(rest, s.sales, target)
  return { sales: 100, cogs, gross, fees: p[0], shrinkage: p[1], fixed: p[2], variable: p[3], net }
}

/** Uso de un presupuesto en %: si te pasaste aunque sea un poco, nunca dice "100 %" (dice 101 %). */
export function budgetPct(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  let v = Math.round(ratio * 100)
  if (ratio > 1 && v <= 100) v = 101
  return `${intFmt.format(v)}${NBSP}%`
}
