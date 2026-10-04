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
