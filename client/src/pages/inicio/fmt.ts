// Formatos propios de Inicio y Metas.
// - En un tablero los centavos solo molestan: redondeamos a pesos enteros.
// - Espacio que no se corta entre "$" y el número, así nunca queda "$" en una línea y el monto en otra.
import { money, moneyCompact } from '@/lib/format'

const NBSP = ' '
const glue = (s: string) => s.replace(/ /g, NBSP)

export const money0 = (v: number | null | undefined, opts: { sign?: boolean } = {}) => glue(money(v == null ? v : Math.round(v), { ...opts, decimals: 0 }))
export const compact = (v: number | null | undefined) => glue(moneyCompact(v))
/** "$ 61" (de cada $ 100) sin corte de línea. */
export const pesos = (n: number) => `$${NBSP}${n}`
