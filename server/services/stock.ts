// Stock y costo de cada vino.
//
// Cómo funciona (y por qué):
// - Cada botella que entra o sale queda registrada como un "movimiento" (compra, venta,
//   rotura, degustación…). El stock de un vino es la suma de sus movimientos. Así nunca
//   hay un número "mágico": siempre se puede ver de dónde salió.
// - El costo por botella se calcula con COSTO PROMEDIO PONDERADO: si tenías 10 botellas a
//   $1.000 y comprás 10 más a $1.400, tu costo pasa a ser $1.200. Es el método más usado
//   por comercios chicos y el que acepta AFIP para valuar mercadería.
// - Cada salida (venta, rotura, etc.) se valoriza al costo promedio de ESE momento, y ese
//   valor es el "costo de la mercadería vendida" (CMV) que usan los reportes.
// - Si cargás una compra con fecha vieja, o editás/borrás algo, se recalcula toda la
//   historia del vino en orden de fecha. Por eso los números siempre cierran.
import { all, get, run, tx } from '../db'
import type { StockMovementKind } from '../../shared/constants'
import type { StockMovement } from '../../shared/types'

/** Movimientos que entran con su propio costo (actualizan el promedio). */
const INBOUND_WITH_COST: StockMovementKind[] = ['inicial', 'compra']

export interface NewMovement {
  product_id: number
  date: string
  kind: StockMovementKind
  qty: number
  /** Solo se usa para 'inicial', 'compra' y 'revaluo'. El resto toma el costo promedio. */
  unit_cost?: number
  ref_type?: StockMovement['ref_type']
  ref_id?: number | null
  notes?: string | null
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

/**
 * Orden de la historia de un vino (el mismo para el recálculo del costo y para el «saldo» que
 * se muestra en su ficha y en el Excel):
 *  1) el "stock inicial" (alta del vino) siempre primero, sea cual sea su fecha: es el punto de partida;
 *  2) después por fecha;
 *  3) dentro del mismo día, primero lo que ENTRA (compras, cambios de costo, sobrantes) y después lo
 *     que SALE (ventas, roturas…). Así editar una compra o una venta (que vuelve a grabar sus
 *     renglones) no cambia el costo de las ventas de ese mismo día.
 */
export function movementOrderSql(alias = '', dir: 'ASC' | 'DESC' = 'ASC', opts: { initialFirst?: boolean } = {}): string {
  const a = alias ? `${alias}.` : ''
  return [
    // En listados de varios vinos no se adelanta el alta (se ordena por fecha); el saldo igual se calcula por vino.
    ...(opts.initialFirst === false ? [] : [`CASE WHEN ${a}kind = 'inicial' THEN 0 ELSE 1 END ${dir}`]),
    `${a}date ${dir}`,
    `CASE WHEN ${a}kind IN ('compra', 'revaluo') OR ${a}qty > 0 THEN 0 ELSE 1 END ${dir}`,
    `${a}id ${dir}`,
  ].join(', ')
}

/**
 * Registra un movimiento de stock. Por defecto recalcula el vino al toque;
 * con { recalc: false } se puede cargar en lote y llamar a recalcProducts() al final.
 */
export function addMovement(m: NewMovement, opts: { recalc?: boolean } = {}): number {
  const product = get<{ id: number }>('SELECT id FROM products WHERE id = ?', [m.product_id])
  if (!product) throw new Error(`Producto ${m.product_id} inexistente`)
  const { lastInsertRowid } = run(
    `INSERT INTO stock_movements (product_id, date, kind, qty, unit_cost, ref_type, ref_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.product_id, m.date, m.kind, Math.trunc(m.qty), round4(m.unit_cost ?? 0), m.ref_type ?? null, m.ref_id ?? null, m.notes ?? null],
  )
  if (opts.recalc !== false) recalcProduct(m.product_id)
  return lastInsertRowid
}

/** Borra los movimientos generados por algo (ej: los renglones de una venta) y recalcula los vinos afectados. */
export function removeMovementsByRef(refType: NonNullable<StockMovement['ref_type']>, refIds: number[]) {
  if (!refIds.length) return
  const placeholders = refIds.map(() => '?').join(',')
  const affected = all<{ product_id: number }>(
    `SELECT DISTINCT product_id FROM stock_movements WHERE ref_type = ? AND ref_id IN (${placeholders})`,
    [refType, ...refIds],
  ).map((r) => r.product_id)
  run(`DELETE FROM stock_movements WHERE ref_type = ? AND ref_id IN (${placeholders})`, [refType, ...refIds])
  recalcProducts(affected)
}

/** Borra un movimiento puntual (solo los manuales: ajustes, roturas, etc.). */
export function deleteMovement(id: number) {
  const m = get<{ product_id: number }>('SELECT product_id FROM stock_movements WHERE id = ?', [id])
  if (!m) return
  run('DELETE FROM stock_movements WHERE id = ?', [id])
  recalcProduct(m.product_id)
}

/**
 * Recalcula stock y costo promedio de un vino recorriendo toda su historia en orden.
 * También actualiza el costo de cada venta (sale_items.unit_cost) para que el CMV sea exacto.
 */
export function recalcProduct(productId: number) {
  tx(() => {
    // Orden de la historia: ver movementOrderSql (inicial primero, por fecha, en el día primero lo que entra).
    const movs = all<{ id: number; kind: StockMovementKind; qty: number; unit_cost: number; ref_type: string | null; ref_id: number | null }>(
      `SELECT id, kind, qty, unit_cost, ref_type, ref_id FROM stock_movements WHERE product_id = ?
       ORDER BY ${movementOrderSql()}`,
      [productId],
    )
    let stock = 0
    let avg = 0
    let hasCost = false
    for (const m of movs) {
      if (m.kind === 'revaluo') {
        avg = m.unit_cost
        hasCost = true
        continue
      }
      if (m.kind === 'inicial') {
        // Stock con el que se dio de alta el vino. Si se cargó sin costo ($0), esas botellas
        // toman el costo de la primera compra (no "promedian para abajo" con $0).
        stock += m.qty
        if (m.unit_cost > 0) {
          avg = m.unit_cost
          hasCost = true
        }
        continue
      }
      if (INBOUND_WITH_COST.includes(m.kind) && m.qty > 0) {
        // Si todavía no había un costo conocido, las botellas previas (ej: un stock inicial sin costo)
        // toman el costo de esta primera entrada.
        const base = hasCost ? Math.max(stock, 0) : 0
        avg = (base * avg + m.qty * m.unit_cost) / (base + m.qty)
        hasCost = true
        stock += m.qty
        continue
      }
      // Salidas y entradas sin costo propio: se valorizan al promedio del momento.
      const cost = round4(avg)
      if (Math.abs(m.unit_cost - cost) > 1e-6) {
        run('UPDATE stock_movements SET unit_cost = ? WHERE id = ?', [cost, m.id])
      }
      if (m.ref_type === 'sale_item' && m.ref_id != null) {
        run('UPDATE sale_items SET unit_cost = ? WHERE id = ? AND ABS(unit_cost - ?) > 0.000001', [cost, m.ref_id, cost])
      }
      stock += m.qty
    }
    run(`UPDATE products SET stock = ?, unit_cost = ?, updated_at = datetime('now','localtime') WHERE id = ?`, [
      stock,
      round4(avg),
      productId,
    ])
  })
}

export function recalcProducts(ids: number[]) {
  for (const id of new Set(ids)) recalcProduct(id)
}

export function recalcAll() {
  for (const { id } of all<{ id: number }>('SELECT id FROM products')) recalcProduct(id)
}

/** Costo promedio actual de un vino (para mostrar/sugerir antes de guardar una venta). */
export function currentCost(productId: number): number {
  return get<{ unit_cost: number }>('SELECT unit_cost FROM products WHERE id = ?', [productId])?.unit_cost ?? 0
}
