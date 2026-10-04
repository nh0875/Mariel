// Calculadora de precios y punto de equilibrio: fórmulas puras (sin base de datos ni pantalla).
// Están acá para que el servidor, la interfaz y los tests calculen exactamente igual,
// y para poder explicarlas paso a paso en la pantalla «Calculadora».
//
// Convención de unidades (¡importante!):
//   - Los campos que terminan en `_pct` van en POR CIENTO, igual que en Configuración: 3.5 = 3,5 %.
//   - Los márgenes, markups y variaciones (`margin`, `markup`, `price_change`…) van como
//     PROPORCIÓN: 0.4 = 40 %.
//   - La plata va en pesos finales (con impuestos), como en el resto del sistema.
//
// Los márgenes de esta calculadora se miden "después de IIBB y de la comisión del medio de pago":
// es lo que de verdad te queda de cada botella para pagar los gastos fijos y ganar.
import { priceForMarkup, round2, roundUpTo, safeDiv } from './calc'

// ───────────────────────── Reglas prácticas ─────────────────────────

/**
 * Margen "sano" para una vinoteca: de cada $100 que cobrás te quedan $35 o más después de pagar
 * el vino, Ingresos Brutos y la comisión. Con eso se cubren gastos fijos típicos (alquiler,
 * sueldos, servicios: suelen ser 20–25 % de las ventas en un comercio chico) y queda ganancia.
 */
export const MARGIN_HEALTHY = 0.35
/** Entre 25 % y 35 %: alcanza si tus gastos fijos son bajos o vendés mucho volumen. */
export const MARGIN_FAIR = 0.25
/** Mínimo aceptable para el precio mayorista (vendés más botellas juntas, pero con menos margen). */
export const WHOLESALE_MIN_MARGIN = 0.2
/** Días hábiles de venta por mes (para pasar "botellas por mes" a "botellas por día"). */
export const WORKING_DAYS_PER_MONTH = 25

/** Número seguro: lo que no es un número finito cuenta como 0. */
const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
/** Por ciento → proporción (3.5 → 0.035). */
export const pctToRatio = (pct: number | null | undefined): number => n(pct) / 100
/** Proporción → por ciento con 2 decimales (0.035 → 3.5). */
export const ratioToPct = (ratio: number): number => round2(ratio * 100)

/** "40 %" / "3,5 %" para los mensajes de error (sin depender del formato de la interfaz). */
function pctText(ratio: number): string {
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(round2(ratio * 100))} %`
}

/**
 * Redondea un precio hacia ARRIBA al múltiplo elegido ($100, $500, $1.000).
 * Hacia arriba para que el redondeo nunca te coma el margen. Sin múltiplo → centavos.
 */
export function roundPrice(price: number, roundTo = 0): number {
  if (!Number.isFinite(price)) return price
  return roundTo > 0 ? roundUpTo(round2(price), roundTo) : round2(price)
}

// ───────────────────────── Semáforo del margen ─────────────────────────

export type MarginLevel = 'sano' | 'justo' | 'bajo' | 'perdida'

export interface MarginVerdict {
  level: MarginLevel
  /** Texto corto para la etiqueta ("Margen sano"). */
  label: string
  /** Una frase que explica qué significa. */
  explanation: string
}

/**
 * Semáforo del margen (después de IIBB y comisión):
 * - ≥ 35 % → "Margen sano"
 * - 25 % a 35 % → "Justo"
 * - 0 a 25 % → "Bajo"
 * - negativo → "Perdés plata"
 */
export function marginVerdict(margin: number): MarginVerdict {
  if (!Number.isFinite(margin) || margin < 0) {
    return {
      level: 'perdida',
      label: 'Perdés plata',
      explanation: 'Con este precio no llegás a cubrir el vino, el impuesto y la comisión: cada botella que vendés te cuesta plata.',
    }
  }
  if (margin < MARGIN_FAIR) {
    return {
      level: 'bajo',
      label: 'Margen bajo',
      explanation: 'Te queda poco para pagar alquiler, sueldos y demás gastos fijos. Sirve solo si vendés mucho volumen (o para un vino "gancho").',
    }
  }
  if (margin < MARGIN_HEALTHY) {
    return {
      level: 'justo',
      label: 'Justo',
      explanation: 'Alcanza si tus gastos fijos son bajos. Cualquier aumento de la bodega que no traslades te lo come rápido.',
    }
  }
  return {
    level: 'sano',
    label: 'Margen sano',
    explanation: 'Queda lugar para cubrir los gastos fijos, ganar y aguantar algún aumento de costos sin tocar el precio enseguida.',
  }
}

// ───────────────────────── ¿A cuánto lo vendo? ─────────────────────────

export interface SuggestPriceInput {
  /** Costo por botella (el costo promedio del sistema ya incluye el flete de las compras). */
  cost: number
  /** Flete o costo extra por botella que todavía no está en el costo (opcional). */
  freight_per_bottle?: number
  /** Margen que querés que te quede sobre el precio FINAL, como proporción (0.4 = 40 %). */
  target_margin: number
  /** Ingresos Brutos en % del precio (3.5 = 3,5 %). */
  iibb_pct?: number
  /** Comisión del medio de pago en % del precio (6.29 = 6,29 %). */
  fee_pct?: number
  /** Redondear hacia arriba a este múltiplo (0 = sin redondeo). */
  round_to?: number
}

export interface PriceBreakdown {
  /** Costo total por botella (costo + flete). */
  cost_total: number
  /** Lo que se lleva Ingresos Brutos de esa botella. */
  iibb: number
  /** Lo que se lleva el medio de pago. */
  fee: number
  /** Lo que te queda limpio de esa botella. */
  profit: number
}

export type SuggestPriceResult =
  | {
      ok: true
      /** Precio sugerido (ya redondeado). */
      price: number
      /** Precio exacto antes de redondear. */
      raw_price: number
      /** Cuánto sumó el redondeo. */
      rounding: number
      breakdown: PriceBreakdown
      /** Margen real después de IIBB y comisión, con el precio redondeado (≥ el margen pedido). */
      margin: number
      /** Margen bruto: (precio − costo) ÷ precio, antes de IIBB y comisión (el de los reportes). */
      gross_margin: number
      /** Markup equivalente: cuánto le sumás al costo para llegar al precio (0.77 = 77 %). */
      markup: number
      /** Por cuánto multiplicás el costo (1.77 → "costo × 1,77"). */
      multiplier: number
      /** Margen + IIBB + comisión (lo que se "reserva" de cada $1 de precio), como proporción. */
      reserved: number
    }
  | { ok: false; error: string }

/**
 * Precio sugerido para quedarte con un margen después de pagar IIBB y la comisión
 * (los dos se calculan sobre el precio, por eso no alcanza con sumarlos al costo):
 *
 *     precio = (costo + flete) ÷ (1 − margen − IIBB − comisión)
 *
 * Ej: costo $6.000, margen 40 %, IIBB 3,5 %, sin comisión →
 *     6.000 ÷ (1 − 0,40 − 0,035) = 6.000 ÷ 0,565 = $10.619,47.
 * Comprobación: IIBB $371,68 + te quedan $4.247,79 (40 % de $10.619,47) + costo $6.000 = $10.619,47 ✔
 *
 * Si margen + IIBB + comisión suman 100 % o más no existe un precio posible (no queda nada para
 * pagar el vino): devuelve `{ ok: false, error }` con el motivo.
 */
export function suggestPrice(input: SuggestPriceInput): SuggestPriceResult {
  const cost = n(input.cost)
  const freight = n(input.freight_per_bottle)
  const margin = n(input.target_margin)
  const iibb = pctToRatio(input.iibb_pct)
  const fee = pctToRatio(input.fee_pct)
  const costTotal = round2(cost + freight)

  if (cost < 0 || freight < 0) return { ok: false, error: 'El costo y el flete no pueden ser negativos.' }
  if (costTotal <= 0) return { ok: false, error: 'Cargá el costo de la botella para calcular el precio.' }
  if (margin < 0) return { ok: false, error: 'El margen deseado no puede ser negativo.' }
  if (iibb < 0 || fee < 0) return { ok: false, error: 'Ingresos Brutos y la comisión no pueden ser negativos.' }
  if (margin >= 1) return { ok: false, error: 'El margen tiene que ser menor a 100 %: con 100 % el vino tendría que ser gratis.' }

  const reserved = margin + iibb + fee
  if (reserved >= 1 - 1e-9) {
    return {
      ok: false,
      error: `Margen (${pctText(margin)}) + Ingresos Brutos (${pctText(iibb)}) + comisión (${pctText(fee)}) suman ${pctText(reserved)}: no queda nada del precio para pagar el vino. Bajá el margen deseado o elegí un medio de pago con menos comisión.`,
    }
  }

  const raw = costTotal / (1 - reserved)
  const price = roundPrice(raw, n(input.round_to))
  const a = analyzePrice({ price, cost: costTotal, iibb_pct: input.iibb_pct, fee_pct: input.fee_pct })
  return {
    ok: true,
    price,
    raw_price: round2(raw),
    rounding: round2(price - round2(raw)),
    breakdown: { cost_total: costTotal, iibb: a.iibb, fee: a.fee, profit: a.profit_per_bottle },
    margin: a.margin,
    gross_margin: a.gross_margin,
    markup: a.markup,
    multiplier: safeDiv(price, costTotal),
    reserved,
  }
}

/**
 * Precio mayorista a partir del minorista: precio minorista − descuento mayorista (%), redondeado
 * hacia arriba al mismo múltiplo. Ej: $10.700 con 20 % de descuento → $8.560.
 */
export function wholesaleFromRetail(retail: number, discount_pct: number, round_to = 0): number {
  const r = n(retail)
  if (r <= 0) return 0
  const d = Math.min(Math.max(pctToRatio(discount_pct), 0), 1)
  return roundPrice(r * (1 - d), round_to)
}

/**
 * La trampa del markup: si al costo le sumás el margen que querés como si fuera un recargo
 * (costo × (1 + margen)), el margen real te queda mucho más bajo.
 * Ej: costo $6.000 + 40 % = $8.400 → margen bruto 28,6 %, no 40 %.
 */
export function markupTrap(input: { cost: number; target_margin: number; iibb_pct?: number; fee_pct?: number }) {
  const cost = n(input.cost)
  const naivePrice = priceForMarkup(cost, n(input.target_margin))
  const a = analyzePrice({ price: naivePrice, cost, iibb_pct: input.iibb_pct, fee_pct: input.fee_pct })
  return { naive_price: naivePrice, naive_margin: a.margin, naive_gross_margin: a.gross_margin, naive_profit: a.profit_per_bottle }
}

// ───────────────────────── ¿Cuánto gano con este precio? ─────────────────────────

export interface AnalyzePriceInput {
  /** Precio final de venta por botella. */
  price: number
  /** Costo por botella (con flete). */
  cost: number
  iibb_pct?: number
  fee_pct?: number
  /** Botellas por caja (default 6). */
  units_per_box?: number
}

export interface PriceAnalysis {
  price: number
  cost: number
  /** Ingresos Brutos de esa botella. */
  iibb: number
  /** Comisión del medio de pago de esa botella. */
  fee: number
  /** Lo que te queda por botella: precio − costo − IIBB − comisión. */
  profit_per_bottle: number
  /** Margen después de IIBB y comisión: ganancia ÷ precio (0..1; negativo = pérdida). */
  margin: number
  /** Margen bruto: (precio − costo) ÷ precio (antes de IIBB y comisión). */
  gross_margin: number
  /** Markup: (precio − costo) ÷ costo. 0 si el costo es 0. */
  markup: number
  units_per_box: number
  /** Lo que te queda por caja (ganancia por botella × botellas por caja). */
  profit_per_box: number
  verdict: MarginVerdict
}

/**
 * Cuánto te deja un precio:
 *   ganancia por botella = precio − costo − precio × IIBB − precio × comisión
 *   margen = ganancia ÷ precio        markup = (precio − costo) ÷ costo
 * Ej: precio $10.000, costo $6.000, IIBB 3,5 %, comisión 0 → te quedan $3.650 (margen 36,5 %, markup 66,7 %).
 */
export function analyzePrice(input: AnalyzePriceInput): PriceAnalysis {
  const price = round2(n(input.price))
  const cost = round2(n(input.cost))
  const units = Math.max(1, Math.round(n(input.units_per_box) || 6))
  const iibb = round2(price * pctToRatio(input.iibb_pct))
  const fee = round2(price * pctToRatio(input.fee_pct))
  const profit = round2(price - cost - iibb - fee)
  const margin = price > 0 ? profit / price : cost > 0 ? -1 : 0
  return {
    price,
    cost,
    iibb,
    fee,
    profit_per_bottle: profit,
    margin,
    gross_margin: safeDiv(price - cost, price),
    markup: safeDiv(price - cost, cost),
    units_per_box: units,
    profit_per_box: round2(profit * units),
    verdict: marginVerdict(margin),
  }
}

// ───────────────────────── Punto de equilibrio ─────────────────────────

export interface BreakEvenInput {
  /** Gastos fijos por mes (alquiler, sueldos, servicios…). */
  fixed_costs: number
  /** Precio promedio por botella (ventas ÷ botellas). */
  avg_price: number
  /** Costo variable por botella: el vino + comisiones + mermas + gastos variables, por botella. */
  avg_variable_cost_per_bottle: number
}

export interface BreakEvenResult {
  /** false si no se puede calcular o si no hay cantidad de ventas que alcance. */
  ok: boolean
  error: string | null
  /** Lo que te deja cada botella para cubrir los fijos: precio − costo variable. */
  contribution_per_bottle: number
  /** Lo mismo como proporción del precio (0..1). */
  contribution_margin: number
  /** Botellas por mes para no perder plata (redondeado hacia arriba). Infinity si no hay forma. */
  bottles: number
  /** Botellas sin redondear. */
  bottles_exact: number
  /** Ventas en pesos por mes para no perder plata. Infinity si no hay forma. */
  sales: number
  /** Botellas por día hábil (÷ 25). */
  bottles_per_day: number
}

/**
 * Punto de equilibrio: cuántas botellas (y cuántos pesos) tenés que vender por mes para no perder.
 *
 *     ganancia por botella (contribución) = precio promedio − costo variable por botella
 *     botellas = gastos fijos ÷ contribución          ventas = gastos fijos ÷ (contribución ÷ precio)
 *
 * Ej: fijos $900.000, precio $10.000, costo variable $7.000 → cada botella deja $3.000 →
 *     300 botellas por mes ($3.000.000 en ventas), 12 por día hábil.
 * Si cada botella no deja nada (o deja negativo), devuelve ok: false y bottles/sales = Infinity.
 */
export function breakEven(input: BreakEvenInput): BreakEvenResult {
  const fixed = n(input.fixed_costs)
  const price = n(input.avg_price)
  const variable = n(input.avg_variable_cost_per_bottle)
  const contribution = round2(price - variable)
  const cm = safeDiv(contribution, price)
  const fail = (error: string, bottles = NaN): BreakEvenResult => ({
    ok: false,
    error,
    contribution_per_bottle: contribution,
    contribution_margin: cm,
    bottles,
    bottles_exact: bottles,
    sales: bottles,
    bottles_per_day: bottles,
  })
  if (fixed < 0) return fail('Los gastos fijos no pueden ser negativos.')
  if (variable < 0) return fail('El costo variable no puede ser negativo.')
  if (price <= 0) return fail('Cargá el precio promedio por botella para calcular el punto de equilibrio.')
  if (contribution <= 0) {
    return fail(
      'Con estos números cada botella no deja nada (o te cuesta más de lo que cobrás): no hay cantidad de ventas que cubra los gastos fijos. Subí precios o bajá costos variables.',
      Infinity,
    )
  }
  const exact = fixed / contribution
  // −1e-9 para que 300,0000001 (error de coma flotante) no pase a 301; Math.max evita el "−0".
  const bottles = Math.max(0, Math.ceil(exact - 1e-9))
  return {
    ok: true,
    error: null,
    contribution_per_bottle: contribution,
    contribution_margin: cm,
    bottles,
    bottles_exact: exact,
    sales: round2(fixed / cm),
    bottles_per_day: bottles / WORKING_DAYS_PER_MONTH,
  }
}

/**
 * Costo variable por botella a partir de promedios:
 *     costo del vino + precio × (% variables ÷ 100)
 * donde "% variables" son comisiones + mermas + gastos variables sobre las ventas.
 */
export function variableCostPerBottle(avg_price: number, avg_cost: number, variable_pct: number): number {
  return round2(n(avg_cost) + n(avg_price) * pctToRatio(variable_pct))
}

// ───────────────────────── ¿Qué pasa si…? ─────────────────────────

export interface SimulationBase {
  /** Botellas por mes. */
  bottles: number
  /** Precio promedio por botella. */
  avg_price: number
  /** Costo promedio por botella. */
  avg_cost: number
  /** Gastos fijos por mes. */
  fixed: number
  /** Costos variables como % de las ventas (comisiones + mermas + gastos variables). 8.5 = 8,5 %. */
  variable_pct: number
}

export interface SimulationChanges {
  /** Variación del precio (0.1 = +10 %). */
  price_change?: number
  /** Variación del costo del vino (0.15 = +15 %). */
  cost_change?: number
  /** Variación de las botellas vendidas (−0.05 = −5 %). */
  volume_change?: number
  /** Variación de los gastos fijos. */
  fixed_change?: number
}

export interface SimulationSnapshot {
  bottles: number
  avg_price: number
  avg_cost: number
  fixed: number
  /** botellas × precio */
  sales: number
  /** botellas × costo */
  cogs: number
  /** ventas × % variables */
  variable: number
  /** ventas − costo del vino − variables */
  contribution: number
  /** contribución − fijos */
  result: number
  /** resultado ÷ ventas */
  margin: number
}

export interface SimulationResult {
  before: SimulationSnapshot
  after: SimulationSnapshot
  delta: {
    sales: number
    contribution: number
    result: number
    bottles: number
    /** Variación del resultado en proporción (null si antes era 0). */
    result_pct: number | null
  }
}

function snapshot(b: SimulationBase): SimulationSnapshot {
  const bottles = n(b.bottles)
  const price = n(b.avg_price)
  const cost = n(b.avg_cost)
  const fixed = n(b.fixed)
  const sales = bottles * price
  const cogs = bottles * cost
  const variable = sales * pctToRatio(b.variable_pct)
  const contribution = sales - cogs - variable
  const result = contribution - fixed
  return {
    bottles: round2(bottles),
    avg_price: round2(price),
    avg_cost: round2(cost),
    fixed: round2(fixed),
    sales: round2(sales),
    cogs: round2(cogs),
    variable: round2(variable),
    contribution: round2(contribution),
    result: round2(result),
    margin: safeDiv(result, sales),
  }
}

function applyChanges(base: SimulationBase, c: SimulationChanges): SimulationBase {
  return {
    bottles: n(base.bottles) * (1 + n(c.volume_change)),
    avg_price: n(base.avg_price) * (1 + n(c.price_change)),
    avg_cost: n(base.avg_cost) * (1 + n(c.cost_change)),
    fixed: n(base.fixed) * (1 + n(c.fixed_change)),
    variable_pct: n(base.variable_pct),
  }
}

/**
 * Simulador "¿qué pasa si…?": resultado del mes antes y después de cambiar precio, costo,
 * botellas vendidas y gastos fijos.
 *
 *     resultado = botellas × (precio − costo) − precio × botellas × % variables − fijos
 *
 * Los costos variables (comisiones, envíos…) se mueven con las ventas: si subís el precio,
 * la comisión también sube.
 */
export function simulate(input: { base: SimulationBase } & SimulationChanges): SimulationResult {
  const before = snapshot(input.base)
  const after = snapshot(applyChanges(input.base, input))
  return {
    before,
    after,
    delta: {
      sales: round2(after.sales - before.sales),
      contribution: round2(after.contribution - before.contribution),
      result: round2(after.result - before.result),
      bottles: round2(after.bottles - before.bottles),
      result_pct: before.result !== 0 ? (after.result - before.result) / Math.abs(before.result) : null,
    },
  }
}

/**
 * ¿Cuánto tendría que cambiar el precio para seguir ganando lo mismo que antes,
 * con los demás cambios (costo, botellas, fijos)? Devuelve una proporción (0.092 = subir 9,2 %)
 * o null si no hay forma (ej: no vendés botellas).
 *
 * Despeje: botellas' × (precio' × (1 − %var) − costo') − fijos' = resultado de antes.
 */
export function priceChangeToKeepResult(base: SimulationBase, changes: Omit<SimulationChanges, 'price_change'>): number | null {
  const before = snapshot(base)
  const b = n(base.bottles) * (1 + n(changes.volume_change))
  const c = n(base.avg_cost) * (1 + n(changes.cost_change))
  const f = n(base.fixed) * (1 + n(changes.fixed_change))
  const k = 1 - pctToRatio(base.variable_pct)
  const p = n(base.avg_price)
  if (b <= 0 || k <= 0 || p <= 0) return null
  const neededPrice = ((before.result + f) / b + c) / k
  if (!Number.isFinite(neededPrice) || neededPrice <= 0) return null
  return neededPrice / p - 1
}

// ───────────────────────── Cajas y promos ─────────────────────────

export interface BoxDealInput {
  /** Precio de lista por botella. */
  price: number
  /** Costo por botella. */
  cost: number
  /** Botellas por caja. */
  units: number
  /** Descuento sobre el precio de lista de la caja (10 = 10 %). */
  discount_pct: number
  iibb_pct?: number
  fee_pct?: number
  /** Margen mínimo que querés conservar (proporción). Default: 25 %. */
  min_margin?: number
}

export interface BoxDealResult {
  ok: boolean
  error: string | null
  units: number
  /** Precio de la caja sin descuento (precio × botellas). */
  list_price: number
  /** Cuánto descontás en pesos. */
  discount_amount: number
  /** Precio de la caja con descuento (lo que paga el cliente). */
  box_price: number
  box_cost: number
  iibb: number
  fee: number
  /** Lo que te queda por caja. */
  profit: number
  profit_per_bottle: number
  /** Margen con el descuento (después de IIBB y comisión). */
  margin: number
  /** Margen que tendrías sin descuento. */
  margin_without_discount: number
  /** Lo que "te cuesta" el descuento: ganancia sin descuento − ganancia con descuento. */
  profit_lost: number
  min_margin: number
  /** Descuento máximo (en %) que todavía te deja el margen mínimo. 0 si ya sin descuento no llegás. */
  max_discount_pct: number
  /** A partir de este descuento (en %) perdés plata con la caja. */
  break_even_discount_pct: number
  verdict: MarginVerdict
}

/**
 * Venta de una caja con descuento: ¿cuánto te queda?
 *     precio de la caja = precio × botellas × (1 − descuento)
 *     te queda = precio de la caja × (1 − IIBB − comisión) − costo × botellas
 * Y los umbrales:
 *     descuento máximo para conservar un margen M = 1 − costo de la caja ÷ ((1 − IIBB − comisión − M) × precio de lista de la caja)
 *     descuento a partir del cual perdés = 1 − costo de la caja ÷ ((1 − IIBB − comisión) × precio de lista de la caja)
 * Ej: caja de 6 a $10.000 (costo $6.000), 10 % off, IIBB 3,5 % → caja $54.000, IIBB $1.890,
 *     te quedan $16.110 (29,8 %). Sin descuento te quedaban $21.900 (36,5 %).
 */
export function boxDeal(input: BoxDealInput): BoxDealResult {
  const price = n(input.price)
  const cost = n(input.cost)
  const units = Math.max(0, Math.round(n(input.units)))
  const d = pctToRatio(input.discount_pct)
  const t = pctToRatio(input.iibb_pct) + pctToRatio(input.fee_pct)
  const minMargin = input.min_margin ?? MARGIN_FAIR
  const list = round2(price * units)
  const boxPrice = round2(list * (1 - d))
  const boxCost = round2(cost * units)
  const a = analyzePrice({ price: boxPrice, cost: boxCost, iibb_pct: input.iibb_pct, fee_pct: input.fee_pct, units_per_box: 1 })
  const noDiscount = analyzePrice({ price: list, cost: boxCost, iibb_pct: input.iibb_pct, fee_pct: input.fee_pct, units_per_box: 1 })
  const threshold = (m: number) => {
    const k = 1 - t - m
    if (k <= 0 || list <= 0) return 0
    return Math.max(0, Math.min(100, round2((1 - boxCost / (k * list)) * 100)))
  }
  let error: string | null = null
  if (price <= 0) error = 'Cargá el precio por botella.'
  else if (units < 1) error = 'La caja tiene que tener al menos 1 botella.'
  else if (cost < 0) error = 'El costo no puede ser negativo.'
  else if (d < 0 || d >= 1) error = 'El descuento tiene que estar entre 0 % y 99 %.'
  return {
    ok: error == null,
    error,
    units,
    list_price: list,
    discount_amount: round2(list - boxPrice),
    box_price: boxPrice,
    box_cost: boxCost,
    iibb: a.iibb,
    fee: a.fee,
    profit: a.profit_per_bottle,
    profit_per_bottle: units > 0 ? round2(a.profit_per_bottle / units) : 0,
    margin: a.margin,
    margin_without_discount: noDiscount.margin,
    profit_lost: round2(noDiscount.profit_per_bottle - a.profit_per_bottle),
    min_margin: minMargin,
    max_discount_pct: threshold(minMargin),
    break_even_discount_pct: threshold(0),
    verdict: a.verdict,
  }
}

// ───────────────────────── Dólar ─────────────────────────

/** Dólares → pesos con la cotización de referencia. null si no hay cotización cargada. */
export function usdToArs(usd: number, rate: number): number | null {
  if (!(rate > 0) || !Number.isFinite(usd)) return null
  return round2(usd * rate)
}

/** Pesos → dólares con la cotización de referencia. null si no hay cotización cargada. */
export function arsToUsd(ars: number, rate: number): number | null {
  if (!(rate > 0) || !Number.isFinite(ars)) return null
  return round2(ars / rate)
}

// ───────────────────────── Respuesta de GET /api/calculator/context ─────────────────────────

/** Vino tal como lo necesita la calculadora. */
export interface CalculatorProduct {
  id: number
  name: string
  winery: string | null
  vintage: number | null
  unit_cost: number
  price_retail: number
  price_wholesale: number
  units_per_box: number
}

/**
 * Los números del negocio para precargar la calculadora: promedios mensuales de los últimos
 * 3 meses COMPLETOS con movimiento (el mes en curso no cuenta: a medio terminar engaña),
 * calculados con el mismo motor que Inicio y Reportes (services/finance.ts).
 */
export interface CalculatorContext {
  /** true si hubo ventas en esos meses (si no, la pantalla usa valores de ejemplo). */
  has_data: boolean
  /** Meses usados para los promedios ('YYYY-MM'), del más viejo al más nuevo. */
  months_used: string[]
  /** Ventas promedio por mes. */
  avg_sales: number
  /** Botellas vendidas por mes (promedio). */
  avg_bottles: number
  /** Ventas ÷ botellas. */
  avg_price_per_bottle: number
  /** Costo de lo vendido ÷ botellas. */
  avg_cost_per_bottle: number
  /** Gastos fijos promedio por mes. */
  avg_fixed_expenses: number
  /** Gastos variables promedio por mes. */
  avg_variable_expenses: number
  /** Comisiones de cobro promedio por mes. */
  avg_fees: number
  /** Mermas (roturas, degustaciones, regalos) promedio por mes, al costo. */
  avg_shrinkage: number
  /** Comisiones ÷ ventas, en %. */
  avg_fee_pct: number
  /** (Comisiones + mermas + gastos variables) ÷ ventas, en %. Lo que se va con cada venta además del vino. */
  variable_pct_of_sales: number
  /** (Ventas − costo de lo vendido) ÷ ventas (0..1). */
  gross_margin: number
  /** Resultado promedio por mes (Ventas − CMV − comisiones − mermas − gastos). */
  avg_net_result: number
  /** Gastos fijos promedio por mes, por categoría (de mayor a menor). */
  fixed_by_category: { category: string; avg: number }[]
  /** Configuración → Precios. */
  pricing: { target_margin_pct: number; iibb_pct: number; iva_pct: number; wholesale_discount_pct: number }
  usd_rate: number
  usd_rate_date: string | null
  /** Medios de pago con su comisión (%). */
  payment_methods: { key: string; label: string; fee_pct: number }[]
  /** Botellas por caja por defecto. */
  units_per_box: number
  /** Vinos activos. */
  products: CalculatorProduct[]
}

// ───────────────────────── Revisión de precios de todo el catálogo ─────────────────────────

export interface PriceReviewParams {
  /** Margen deseado en % (40 = 40 %). */
  target_margin_pct: number
  iibb_pct: number
  fee_pct: number
  round_to: number
  /** Descuento del mayorista sobre el minorista, en %. */
  wholesale_discount_pct: number
}

export type PriceReviewStatus = 'sin_costo' | 'sin_precio' | 'debajo' | 'ok'

export interface PriceReviewRow {
  id: number
  name: string
  winery: string | null
  vintage: number | null
  cost: number
  price_retail: number
  /** Margen actual del precio minorista (después de IIBB y comisión). */
  margin_retail: number
  verdict: MarginVerdict
  /** Precio minorista para llegar al margen deseado (null si no hay costo cargado o es imposible). */
  suggested_retail: number | null
  /** Sugerido − actual (positivo = te conviene subirlo). */
  diff_retail: number | null
  /** Sugerido ÷ actual − 1. */
  diff_retail_pct: number | null
  price_wholesale: number
  margin_wholesale: number
  suggested_wholesale: number | null
  status: PriceReviewStatus
}

/** Tolerancia para no marcar "debajo" por centavos (medio punto de margen). */
const REVIEW_TOLERANCE = 0.005

/**
 * Compara el precio actual de cada vino con el que tendría con el margen deseado.
 * Mismo cálculo que «¿A cuánto lo vendo?», para todos los vinos a la vez.
 */
export function reviewPrices(products: CalculatorProduct[], p: PriceReviewParams): PriceReviewRow[] {
  const target = pctToRatio(p.target_margin_pct)
  return products.map((prod) => {
    const cost = n(prod.unit_cost)
    const retail = analyzePrice({ price: prod.price_retail, cost, iibb_pct: p.iibb_pct, fee_pct: p.fee_pct })
    const wholesale = analyzePrice({ price: prod.price_wholesale, cost, iibb_pct: p.iibb_pct, fee_pct: p.fee_pct })
    const s = cost > 0 ? suggestPrice({ cost, target_margin: target, iibb_pct: p.iibb_pct, fee_pct: p.fee_pct, round_to: p.round_to }) : null
    const suggested = s && s.ok ? s.price : null
    const status: PriceReviewStatus =
      cost <= 0 ? 'sin_costo' : n(prod.price_retail) <= 0 ? 'sin_precio' : retail.margin < target - REVIEW_TOLERANCE ? 'debajo' : 'ok'
    return {
      id: prod.id,
      name: prod.name,
      winery: prod.winery,
      vintage: prod.vintage,
      cost,
      price_retail: n(prod.price_retail),
      margin_retail: retail.margin,
      verdict: retail.verdict,
      suggested_retail: suggested,
      diff_retail: suggested != null && n(prod.price_retail) > 0 ? round2(suggested - prod.price_retail) : null,
      diff_retail_pct: suggested != null && n(prod.price_retail) > 0 ? suggested / prod.price_retail - 1 : null,
      price_wholesale: n(prod.price_wholesale),
      margin_wholesale: wholesale.margin,
      suggested_wholesale: suggested != null ? wholesaleFromRetail(suggested, p.wholesale_discount_pct, p.round_to) : null,
      status,
    }
  })
}
