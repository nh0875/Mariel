// Aviso (no bloqueo) cuando se carga una venta, compra o botellas abiertas con fecha ANTERIOR al alta
// de un vino. El stock con el que se dio de alta ya incluye todo lo que pasó antes: cargar algo de
// antes suele duplicar botellas (una compra) o descontarlas de más (una venta).
import type { Product } from '@shared/types'
import { date as fmtDate } from './format'

/** GET /products trae, además del vino, el día de su alta (movimiento «stock inicial»). */
export type ProductWithAlta = Product & { alta_date?: string | null }

/** Vinos elegidos cuya alta es posterior a `date` (sin repetir). */
export function winesBeforeAlta(products: ProductWithAlta[], productIds: (number | null | undefined)[], date: string): { name: string; alta: string }[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
  const byId = new Map(products.map((p) => [p.id, p]))
  const seen = new Set<number>()
  const out: { name: string; alta: string }[] = []
  for (const id of productIds) {
    if (id == null || seen.has(id)) continue
    seen.add(id)
    const p = byId.get(id)
    if (p?.alta_date && date < p.alta_date) out.push({ name: p.name, alta: p.alta_date })
  }
  return out
}

/** Texto del aviso según qué se está cargando. */
export function beforeAltaText(list: { name: string; alta: string }[], what: 'compra' | 'venta' | 'abiertas'): string | null {
  if (!list.length) return null
  const names =
    list.length === 1
      ? `«${list[0].name}» lo diste de alta el ${fmtDate(list[0].alta)}`
      : `${list.map((w) => `«${w.name}» (alta ${fmtDate(w.alta)})`).join(', ')} los diste de alta después`
  const tail =
    what === 'compra'
      ? 'Si esta compra es de antes, esas botellas probablemente ya están en el stock con que lo cargaste: guardarla las sumaría dos veces. Si ya estaban contadas, no la cargues (o después corregí el stock con «Ajustar stock → Conté y hay otra cantidad»).'
      : what === 'venta'
        ? 'Si esta venta es de antes, esa botella ya no estaba en el stock con que lo cargaste: guardarla la descontaría de nuevo y el stock quedaría por debajo del real. Si querés registrarla igual, después corregí el stock contando.'
        : 'Si las abriste antes, ya no estaban en el stock con que lo cargaste: registrarlas las descontaría de nuevo. Revisá la fecha.'
  return `Ojo: ${names}, y esta fecha es anterior. ${tail}`
}
