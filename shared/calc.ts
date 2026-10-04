// Fórmulas básicas de negocio. Están acá (y no escondidas en pantallas) para que
// todo el sistema calcule igual y para poder explicarlas en la Ayuda.

/** Redondea a centavos evitando errores de coma flotante (0.1 + 0.2). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** División segura: si el divisor es 0 devuelve 0 (en vez de Infinity/NaN). */
export function safeDiv(a: number, b: number): number {
  return b === 0 || !Number.isFinite(b) ? 0 : a / b
}

/**
 * Margen sobre el precio de venta (0..1).
 * Ej: costo $600, precio $1000 → (1000 − 600) / 1000 = 0,40 = 40 %.
 * "De cada $100 que cobrás, $40 te quedan para cubrir gastos y ganar."
 */
export function marginOnPrice(price: number, cost: number): number {
  return safeDiv(price - cost, price)
}

/**
 * Markup o recargo sobre el costo (0..∞).
 * Ej: costo $600, precio $1000 → (1000 − 600) / 600 = 0,667 = 66,7 %.
 * Ojo: un markup del 66,7 % es un margen del 40 %. No son lo mismo.
 */
export function markupOnCost(price: number, cost: number): number {
  return safeDiv(price - cost, cost)
}

/** Precio para lograr un margen objetivo (0..1) sobre el precio. precio = costo / (1 − margen). */
export function priceForMargin(cost: number, margin: number): number {
  if (margin >= 1) return 0
  return round2(cost / (1 - margin))
}

/** Precio aplicando un markup (0..∞) sobre el costo. precio = costo × (1 + markup). */
export function priceForMarkup(cost: number, markup: number): number {
  return round2(cost * (1 + markup))
}

/** Variación porcentual entre dos valores (0..1). Si el anterior es 0 devuelve null (no se puede comparar). */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null
  return (current - previous) / Math.abs(previous)
}

/** Redondea hacia arriba a un múltiplo "lindo" (ej: 100 → $12.340 queda $12.400). */
export function roundUpTo(n: number, multiple: number): number {
  if (!multiple) return round2(n)
  return Math.ceil(n / multiple) * multiple
}

/**
 * Cuánto conviene pedir de un vino: lo necesario para cubrir ~45 días de venta (al ritmo de los
 * últimos 90 días) o el doble del stock mínimo, lo que sea mayor, redondeado a cajas cerradas.
 * La usan la API (ficha del vino y Excel de reposición) y la pantalla «Vinos y stock».
 */
export function reorderSuggestion(p: { sold_90d: number; min_stock: number; stock: number; units_per_box: number; rate_days?: number }): number {
  const target = Math.max(p.min_stock * 2, Math.ceil((p.sold_90d / Math.max(1, p.rate_days ?? SALES_WINDOW_DAYS)) * 45))
  const need = target - Math.max(p.stock, 0)
  if (need <= 0) return 0
  const box = Math.max(1, p.units_per_box)
  return Math.ceil(need / box) * box
}

/** Días con los que se mide el ritmo de venta de un vino ("vendidas en 90 días"). */
export const SALES_WINDOW_DAYS = 90

/**
 * Días que se usan para medir el ritmo de venta de un vino: los últimos 90, o menos si el vino está
 * en el sistema hace menos (si no, un vino cargado hace una semana parecería "parado" o con stock
 * para años). `firstDate` = su primer movimiento de stock (alta o primera compra).
 */
export function salesWindowDays(firstDate: string | null, ref: string): number {
  if (!firstDate || firstDate > ref) return firstDate ? 1 : SALES_WINDOW_DAYS
  const days = Math.round((Date.parse(`${ref}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / 86_400_000) + 1
  return Math.max(1, Math.min(SALES_WINDOW_DAYS, days))
}

/** Para cuántos días alcanza el stock al ritmo de venta (null si no vendió en la ventana). */
export function daysOfStock(stock: number, sold: number, windowDays: number = SALES_WINDOW_DAYS): number | null {
  if (!(sold > 0)) return null
  return Math.max(0, Math.round(stock / (sold / Math.max(1, windowDays))))
}
