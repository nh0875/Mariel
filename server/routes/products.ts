// Vinos y stock: catálogo, precios, stock y movimientos de botellas.
// (Ver docs/ARQUITECTURA.md → módulo "Vinos y stock")
//
// Reglas importantes:
// - El stock y el costo de cada vino NUNCA se escriben a mano: salen de los movimientos
//   (services/stock.ts). Acá solo se agregan movimientos (inicial, ajustes, cambio de costo).
// - Un vino con ventas o compras no se borra (se perdería la historia): se desactiva.
import express, { Router } from 'express'
import ExcelJS from 'exceljs'
import type { ZodIssue, ZodTypeAny, z } from 'zod'
import { all, get, run, tx, withBools } from '../db'
import { HttpError, notFound, parseId, parsePeriod, qn, qs, validate } from '../lib/http'
import { addSheet, excelFilename, fmtDate, newWorkbook, periodSubtitle, readFirstSheet, sendWorkbook, sendWorkbookFile, type ExcelColumn } from '../lib/excel'
import { addMovement, deleteMovement } from '../services/stock'
import { getSettings } from '../services/settings'
import { bulkPriceInput, costChangeInput, productInput, stockAdjustInput } from '../../shared/schemas'
import {
  MANUAL_STOCK_KINDS,
  SHRINKAGE_KINDS,
  STOCK_MOVEMENT_KINDS,
  STOCK_MOVEMENT_LABELS,
  WINE_TYPES,
  WINE_TYPE_LABELS,
  type StockMovementKind,
  type WineType,
} from '../../shared/constants'
import { marginOnPrice, markupOnCost, reorderSuggestion, round2, roundUpTo } from '../../shared/calc'
import { addDays, addMonths, monthLabel, monthsBetween, startOfMonth, today } from '../../shared/dates'
import type { Product, StockMovement } from '../../shared/types'

const router = Router()

// ───────────────────────── Tipos de respuesta ─────────────────────────

export interface ProductWithStats extends Product {
  /** Botellas vendidas en los últimos 90 días. */
  sold_90d: number
  /** Para cuántos días alcanza el stock al ritmo de venta de los últimos 90 días (null si no vendió). */
  days_of_stock: number | null
  /** Margen sobre el precio minorista (0..1). */
  margin_retail: number
  margin_wholesale: number
  /** Botellas × costo promedio (0 si el stock es negativo). */
  stock_value: number
}

export interface MovementRow extends StockMovement {
  kind_label: string
  product_name: string
  product_winery: string | null
  /** Botellas que quedaban después de este movimiento. */
  saldo: number
  /** qty × unit_cost (con signo). */
  value: number
  /** Texto para mostrar: "Venta #123 · Cliente X", "Compra #45 · Bodega Y", "Evento: Feria". */
  reference: string | null
  sale_id: number | null
  purchase_id: number | null
  event_id: number | null
  /** Precio al que se vendió (solo ventas). */
  unit_price: number | null
  /** Se puede borrar desde Vinos (ajustes, roturas, cambios de costo…). */
  manual: boolean
}

// ───────────────────────── Ayudas ─────────────────────────

const DELETABLE_KINDS: StockMovementKind[] = [...MANUAL_STOCK_KINDS, 'revaluo']
const OUT_KINDS: StockMovementKind[] = ['rotura', 'degustacion', 'regalo', 'consumo']

/** Desde cuándo cuenta "los últimos 90 días" (hoy incluido). */
const since90 = () => addDays(today(), -89)

// ───────────────────────── Validación con palabras de la gente ─────────────────────────
// validate() (lib/http) ya da mensajes en castellano, pero solo traduce algunos campos.
// Acá traducimos los de este módulo para que nunca aparezca "units_per_box" o "winery".
const FIELD_LABELS_ES: Record<string, string> = {
  name: 'Nombre',
  winery: 'Bodega',
  varietal: 'Varietal',
  wine_type: 'Tipo',
  vintage: 'Cosecha',
  region: 'Región',
  size_ml: 'Tamaño (ml)',
  sku: 'Código (SKU)',
  unit_cost: 'Costo por botella',
  price_retail: 'Precio minorista',
  price_wholesale: 'Precio mayorista',
  min_stock: 'Stock mínimo',
  units_per_box: 'Botellas por caja',
  active: 'Activo',
  notes: 'Notas',
  initial_stock: 'Botellas que tenés hoy',
  date: 'Fecha',
  kind: 'Qué pasó',
  qty: 'Cantidad de botellas',
  event_id: 'Evento',
  percent: 'Porcentaje',
  apply_to: 'Qué precios',
  product_ids: 'Vinos elegidos',
  round_to: 'Redondeo',
}

function issueText(i: ZodIssue): string {
  const key = [...i.path].reverse().find((p) => typeof p === 'string') as string | undefined
  const label = key ? (FIELD_LABELS_ES[key] ?? key) : ''
  let msg = i.message
  if (i.code === 'invalid_type' && i.expected === 'integer') msg = 'tiene que ser un número entero (sin decimales)'
  return label ? `${label}: ${msg}` : msg
}

/** validate() + nombres de campos en castellano. */
function check<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  try {
    return validate(schema, data)
  } catch (err) {
    if (err instanceof HttpError && err.status === 400 && Array.isArray(err.details)) {
      const parts = (err.details as ZodIssue[]).slice(0, 4).map(issueText)
      throw new HttpError(400, `Revisá estos datos → ${parts.join(' · ')}`, err.details)
    }
    throw err
  }
}

/** El esquema acepta "2026-13-45" (solo mira el formato): acá verificamos que la fecha exista. */
function assertRealDate(s: string, label = 'Fecha') {
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const ok = dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d && y >= 1990 && y <= 2100
  if (!ok) throw new HttpError(400, `Revisá estos datos → ${label}: esa fecha no existe (revisá el día, el mes y el año).`)
}

/** Fecha del primer movimiento del vino (normalmente su alta o su primera compra). */
function firstMovementDate(productId: number): string | null {
  return get<{ d: string | null }>('SELECT MIN(date) AS d FROM stock_movements WHERE product_id = ?', [productId])?.d ?? null
}

/**
 * Un ajuste o cambio de costo con fecha ANTERIOR a que el vino existiera en el sistema no tiene sentido:
 * lo que pasó antes ya está incluido en el stock con el que se cargó (y un conteo así sumaría botellas de más).
 */
function assertNotBeforeFirst(productId: number, date: string) {
  const first = firstMovementDate(productId)
  if (first && date < first) {
    const name = get<{ name: string }>('SELECT name FROM products WHERE id = ?', [productId])?.name ?? 'el vino'
    throw new HttpError(
      400,
      `Ese día «${name}» todavía no estaba en el sistema (su primer movimiento es del ${fmtDate(first)}). Lo que pasó antes ya está incluido en el stock con el que lo cargaste: elegí una fecha desde el ${fmtDate(first)}.`,
    )
  }
}

/** Botellas que había de un vino al final de un día (suma de sus movimientos hasta esa fecha). */
function stockAt(productId: number, date: string): number {
  return get<{ s: number }>('SELECT COALESCE(SUM(qty), 0) AS s FROM stock_movements WHERE product_id = ? AND date <= ?', [productId, date])?.s ?? 0
}

function normText(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function toProduct(row: Record<string, unknown>): Product {
  return withBools(row, ['active']) as unknown as Product
}

function soldSince(from: string, productId?: number): Map<number, number> {
  const rows = all<{ product_id: number; q: number }>(
    `SELECT si.product_id, SUM(si.qty) AS q
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE si.product_id IS NOT NULL AND s.date >= ? AND s.date <= ? ${productId ? 'AND si.product_id = ?' : ''}
     GROUP BY si.product_id`,
    productId ? [from, today(), productId] : [from, today()],
  )
  return new Map(rows.map((r) => [r.product_id, r.q || 0]))
}

function decorate(p: Product, sold90: number): ProductWithStats {
  const perDay = sold90 / 90
  return {
    ...p,
    sold_90d: sold90,
    days_of_stock: sold90 > 0 ? Math.max(0, Math.round(p.stock / perDay)) : null,
    margin_retail: marginOnPrice(p.price_retail, p.unit_cost),
    margin_wholesale: marginOnPrice(p.price_wholesale, p.unit_cost),
    stock_value: p.stock > 0 ? round2(p.stock * p.unit_cost) : 0,
  }
}

function listProducts(filter: { active?: boolean } = {}): ProductWithStats[] {
  const where = filter.active === undefined ? '' : `WHERE active = ${filter.active ? 1 : 0}`
  const sold = soldSince(since90())
  return all(`SELECT * FROM products ${where}`)
    .map(toProduct)
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id - b.id)
    .map((p) => decorate(p, sold.get(p.id) ?? 0))
}

function loadProduct(id: number): ProductWithStats {
  const row = get('SELECT * FROM products WHERE id = ?', [id])
  if (!row) throw notFound('ese vino')
  return decorate(toProduct(row), soldSince(since90(), id).get(id) ?? 0)
}

/** Cuánto conviene pedir de un vino (la regla vive en shared/calc.ts, igual que en la pantalla). */
export { reorderSuggestion }

function checkUniqueSku(sku: string | null, exceptId?: number) {
  if (!sku) return
  const other = get<{ id: number; name: string; sku: string }>('SELECT id, name, sku FROM products WHERE lower(sku) = lower(?) AND id <> ?', [
    sku,
    exceptId ?? 0,
  ])
  if (other)
    throw new HttpError(409, `Ya hay otro vino con el código «${other.sku}» («${other.name}»). Cada código tiene que ser único: cambialo o dejalo vacío.`)
}

type ProductData = ReturnType<typeof productInput.parse>

function insertProduct(data: ProductData): number {
  const { lastInsertRowid: id } = run(
    `INSERT INTO products (name, winery, varietal, wine_type, vintage, region, size_ml, sku, price_retail, price_wholesale, min_stock, units_per_box, active, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      data.winery,
      data.varietal,
      data.wine_type,
      data.vintage,
      data.region,
      data.size_ml,
      data.sku,
      round2(data.price_retail),
      round2(data.price_wholesale),
      data.min_stock,
      data.units_per_box,
      data.active,
      data.notes,
    ],
  )
  // El movimiento "inicial" va siempre (aunque sea con 0 botellas) para que el vino arranque con su costo.
  addMovement({ product_id: id, date: today(), kind: 'inicial', qty: data.initial_stock ?? 0, unit_cost: data.unit_cost ?? 0, notes: 'Alta del vino' })
  return id
}

function updateProductRow(id: number, data: ProductData) {
  run(
    `UPDATE products SET name = ?, winery = ?, varietal = ?, wine_type = ?, vintage = ?, region = ?, size_ml = ?, sku = ?,
       price_retail = ?, price_wholesale = ?, min_stock = ?, units_per_box = ?, active = ?, notes = ?, updated_at = datetime('now','localtime')
     WHERE id = ?`,
    [
      data.name,
      data.winery,
      data.varietal,
      data.wine_type,
      data.vintage,
      data.region,
      data.size_ml,
      data.sku,
      round2(data.price_retail),
      round2(data.price_wholesale),
      data.min_stock,
      data.units_per_box,
      data.active,
      data.notes,
      id,
    ],
  )
}

/** Movimientos con saldo acumulado y referencia legible. */
function queryMovements(f: { productId?: number; from?: string; to?: string; kind?: string; limit?: number; order?: 'asc' | 'desc' }): MovementRow[] {
  const inner: string[] = []
  const innerParams: (string | number)[] = []
  if (f.productId) (inner.push('sm.product_id = ?'), innerParams.push(f.productId))
  const outer: string[] = []
  const outerParams: (string | number)[] = []
  if (f.from) (outer.push('m.date >= ?'), outerParams.push(f.from))
  if (f.to) (outer.push('m.date <= ?'), outerParams.push(f.to))
  if (f.kind) (outer.push('m.kind = ?'), outerParams.push(f.kind))
  const dir = f.order === 'asc' ? 'ASC' : 'DESC'
  const rows = all<Record<string, unknown>>(
    `SELECT m.*, p.name AS product_name, p.winery AS product_winery,
       si.sale_id, si.unit_price, c.name AS client_name,
       pi.purchase_id, pu.invoice_number, sup.name AS supplier_name,
       e.id AS ev_id, e.name AS event_name
     FROM (
       SELECT sm.*, SUM(sm.qty) OVER (PARTITION BY sm.product_id ORDER BY sm.date, sm.id ROWS UNBOUNDED PRECEDING) AS saldo
       FROM stock_movements sm ${inner.length ? 'WHERE ' + inner.join(' AND ') : ''}
     ) m
     JOIN products p ON p.id = m.product_id
     LEFT JOIN sale_items si ON m.ref_type = 'sale_item' AND si.id = m.ref_id
     LEFT JOIN sales s ON s.id = si.sale_id
     LEFT JOIN clients c ON c.id = s.client_id
     LEFT JOIN purchase_items pi ON m.ref_type = 'purchase_item' AND pi.id = m.ref_id
     LEFT JOIN purchases pu ON pu.id = pi.purchase_id
     LEFT JOIN suppliers sup ON sup.id = pu.supplier_id
     LEFT JOIN events e ON e.id = (CASE WHEN m.ref_type = 'event' THEN m.ref_id ELSE s.event_id END)
     ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''}
     ORDER BY m.date ${dir}, m.id ${dir}
     ${f.limit ? `LIMIT ${Math.trunc(f.limit)}` : ''}`,
    [...innerParams, ...outerParams],
  )
  return rows.map((r) => {
    const kind = r.kind as StockMovementKind
    const saleId = (r.sale_id as number | null) ?? null
    const purchaseId = (r.purchase_id as number | null) ?? null
    const eventId = (r.ev_id as number | null) ?? null
    let reference: string | null = null
    if (saleId) {
      reference = [`Venta #${saleId}`, r.client_name || 'Consumidor final', r.event_name ? `Evento: ${r.event_name}` : null].filter(Boolean).join(' · ')
    } else if (purchaseId) {
      reference = [`Compra #${purchaseId}`, r.supplier_name, r.invoice_number ? `Fact. ${r.invoice_number}` : null].filter(Boolean).join(' · ')
    } else if (eventId) {
      reference = `Evento: ${r.event_name}`
    }
    return {
      id: r.id as number,
      product_id: r.product_id as number,
      product_name: r.product_name as string,
      product_winery: (r.product_winery as string | null) ?? null,
      date: r.date as string,
      kind,
      kind_label: STOCK_MOVEMENT_LABELS[kind] ?? kind,
      qty: r.qty as number,
      unit_cost: r.unit_cost as number,
      value: round2((r.qty as number) * (r.unit_cost as number)),
      saldo: r.saldo as number,
      ref_type: (r.ref_type as StockMovement['ref_type']) ?? null,
      ref_id: (r.ref_id as number | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      created_at: r.created_at as string,
      reference,
      sale_id: saleId,
      purchase_id: purchaseId,
      event_id: eventId,
      unit_price: saleId ? ((r.unit_price as number | null) ?? null) : null,
      manual: DELETABLE_KINDS.includes(kind),
    }
  })
}

function productStats(p: ProductWithStats) {
  const totals = get<{ sold: number; revenue: number; cost: number }>(
    `SELECT COALESCE(SUM(qty), 0) AS sold, COALESCE(SUM(qty * unit_price), 0) AS revenue, COALESCE(SUM(qty * unit_cost), 0) AS cost
     FROM sale_items WHERE product_id = ?`,
    [p.id],
  )!
  const lastSale =
    get<{ d: string | null }>('SELECT MAX(s.date) AS d FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = ?', [p.id])?.d ?? null
  const lastPurchase = get<{ date: string; unit_cost: number; landed_unit_cost: number; supplier_name: string | null }>(
    `SELECT pu.date, pi.unit_cost, pi.landed_unit_cost, sup.name AS supplier_name
     FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id LEFT JOIN suppliers sup ON sup.id = pu.supplier_id
     WHERE pi.product_id = ? ORDER BY pu.date DESC, pi.id DESC LIMIT 1`,
    [p.id],
  )
  const kinds = SHRINKAGE_KINDS.map((k) => `'${k}'`).join(',')
  const shrink = get<{ bottles: number; cost: number }>(
    `SELECT COALESCE(-SUM(qty), 0) AS bottles, COALESCE(-SUM(qty * unit_cost), 0) AS cost FROM stock_movements WHERE product_id = ? AND kind IN (${kinds})`,
    [p.id],
  )!
  return {
    sold_total: totals.sold,
    revenue_total: round2(totals.revenue),
    cost_total: round2(totals.cost),
    profit_total: round2(totals.revenue - totals.cost),
    sold_90d: p.sold_90d,
    days_of_stock: p.days_of_stock,
    last_sale_date: lastSale,
    last_purchase_date: lastPurchase?.date ?? null,
    /** Costo real por botella de la última compra (con flete repartido). */
    last_purchase_cost: lastPurchase ? round2(lastPurchase.landed_unit_cost) : null,
    last_purchase_supplier: lastPurchase?.supplier_name ?? null,
    shrinkage_bottles: shrink.bottles,
    shrinkage_cost: round2(shrink.cost),
    reorder_suggestion: reorderSuggestion(p),
    /** Desde cuándo tiene movimientos (no se aceptan ajustes con fecha anterior). */
    first_movement_date: firstMovementDate(p.id),
  }
}

function productMonthly(productId: number) {
  const t = today()
  const from = addMonths(startOfMonth(t), -11)
  const map = new Map(
    all<{ m: string; bottles: number; revenue: number; cost: number }>(
      `SELECT substr(s.date, 1, 7) AS m, SUM(si.qty) AS bottles, SUM(si.qty * si.unit_price) AS revenue, SUM(si.qty * si.unit_cost) AS cost
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id = ? AND s.date >= ? AND s.date <= ?
       GROUP BY m`,
      [productId, from, `${t.slice(0, 7)}-31`],
    ).map((r) => [r.m, r]),
  )
  return monthsBetween(from, t).map((m) => {
    const r = map.get(m)
    return {
      month: m,
      label: monthLabel(m),
      bottles: r?.bottles ?? 0,
      revenue: round2(r?.revenue ?? 0),
      profit: round2((r?.revenue ?? 0) - (r?.cost ?? 0)),
    }
  })
}

// ───────────────────────── Lectura de números "a la argentina" (importación) ─────────────────────────

/** "$ 12.500,50" → 12500.5 · "12500.5" → 12500.5 · "1.234" → 1234. Devuelve undefined si está vacío y NaN si no es número. */
function parseArNumber(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.NaN
  let s = String(v).trim()
  if (!s || s === '-') return undefined
  s = s.replace(/[$\s]/g, '').replace(/ars/gi, '')
  if (!s) return undefined
  if (/[^\d.,-]/.test(s)) return Number.NaN
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma > -1) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > -1) {
    const parts = s.split('.')
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.NaN
}

const TYPE_ALIASES: Record<string, WineType> = {
  tinto: 'tinto',
  tintos: 'tinto',
  red: 'tinto',
  blanco: 'blanco',
  blancos: 'blanco',
  white: 'blanco',
  rosado: 'rosado',
  rosados: 'rosado',
  rose: 'rosado',
  espumante: 'espumante',
  espumantes: 'espumante',
  espumoso: 'espumante',
  champagne: 'espumante',
  champana: 'espumante',
  sparkling: 'espumante',
  naranjo: 'naranjo',
  naranjos: 'naranjo',
  orange: 'naranjo',
  dulce: 'dulce',
  dulces: 'dulce',
  'cosecha tardia': 'dulce',
  'dulce cosecha tardia': 'dulce',
  tardio: 'dulce',
  otro: 'otro',
  otros: 'otro',
}
for (const t of WINE_TYPES) TYPE_ALIASES[normText(WINE_TYPE_LABELS[t])] = t

type ImportField =
  | 'name'
  | 'winery'
  | 'varietal'
  | 'wine_type'
  | 'vintage'
  | 'region'
  | 'unit_cost'
  | 'price_retail'
  | 'price_wholesale'
  | 'initial_stock'
  | 'min_stock'
  | 'sku'
  | 'units_per_box'
  | 'size_ml'
  | 'notes'

const HEADER_ALIASES: Record<string, ImportField> = {
  nombre: 'name',
  'nombre del vino': 'name',
  vino: 'name',
  producto: 'name',
  bodega: 'winery',
  varietal: 'varietal',
  cepa: 'varietal',
  uva: 'varietal',
  tipo: 'wine_type',
  'tipo de vino': 'wine_type',
  color: 'wine_type',
  cosecha: 'vintage',
  anada: 'vintage',
  ano: 'vintage',
  vintage: 'vintage',
  region: 'region',
  zona: 'region',
  costo: 'unit_cost',
  'costo por botella': 'unit_cost',
  'costo unitario': 'unit_cost',
  'precio minorista': 'price_retail',
  'precio de venta': 'price_retail',
  'precio publico': 'price_retail',
  precio: 'price_retail',
  minorista: 'price_retail',
  'precio mayorista': 'price_wholesale',
  mayorista: 'price_wholesale',
  'stock inicial': 'initial_stock',
  stock: 'initial_stock',
  cantidad: 'initial_stock',
  botellas: 'initial_stock',
  'stock minimo': 'min_stock',
  minimo: 'min_stock',
  sku: 'sku',
  codigo: 'sku',
  'codigo sku': 'sku',
  'botellas por caja': 'units_per_box',
  tamano: 'size_ml',
  'tamano ml': 'size_ml',
  ml: 'size_ml',
  notas: 'notes',
  nota: 'notes',
  observaciones: 'notes',
}

const TEMPLATE_COLUMNS: { header: string; field: ImportField; width: number; money?: boolean; help: string; example: string; required?: boolean }[] = [
  { header: 'Nombre', field: 'name', width: 30, required: true, help: 'Cómo le decís al vino. Es lo único obligatorio.', example: 'Malbec Reserva' },
  { header: 'Bodega', field: 'winery', width: 24, help: 'Quién lo hace.', example: 'Bodega Los Cerros' },
  { header: 'Varietal', field: 'varietal', width: 18, help: 'La uva o "Blend".', example: 'Malbec' },
  {
    header: 'Tipo',
    field: 'wine_type',
    width: 14,
    help: 'Tinto, Blanco, Rosado, Espumante, Naranjo, Dulce u Otro. Si lo dejás vacío, va como Tinto.',
    example: 'Tinto',
  },
  { header: 'Cosecha', field: 'vintage', width: 10, help: 'El año de la uva. Vacío si no tiene.', example: '2021' },
  { header: 'Región', field: 'region', width: 20, help: 'De dónde viene.', example: 'Valle de Uco' },
  {
    header: 'Costo',
    field: 'unit_cost',
    width: 14,
    money: true,
    help: 'Lo que te cuesta cada botella (con flete). Solo se usa para vinos nuevos.',
    example: '$ 13.500',
  },
  { header: 'Precio minorista', field: 'price_retail', width: 16, money: true, help: 'Precio de venta al público, por botella.', example: '$ 23.300' },
  { header: 'Precio mayorista', field: 'price_wholesale', width: 16, money: true, help: 'Precio para restós y vinotecas, por botella.', example: '$ 19.200' },
  { header: 'Stock inicial', field: 'initial_stock', width: 13, help: 'Botellas que tenés hoy. Solo se usa para vinos nuevos.', example: '24' },
  { header: 'Stock mínimo', field: 'min_stock', width: 13, help: 'Con esta cantidad o menos te avisamos para reponer.', example: '12' },
  { header: 'SKU', field: 'sku', width: 12, help: 'Código propio (opcional). Si lo ponés, se usa para reconocer el vino la próxima vez.', example: 'VH-002' },
]

// ───────────────────────── Excel ─────────────────────────

router.get('/products/export', async (req, res) => {
  const activeQ = qs(req, 'active')
  const products = listProducts(activeQ === '1' ? { active: true } : {})
  const columns: ExcelColumn<ProductWithStats>[] = [
    { header: 'Vino', key: 'name', width: 30 },
    { header: 'Bodega', key: 'winery', width: 24 },
    { header: 'Varietal', key: 'varietal', width: 18 },
    { header: 'Tipo', key: 'wine_type', value: (r) => WINE_TYPE_LABELS[r.wine_type] ?? r.wine_type },
    { header: 'Cosecha', key: 'vintage', width: 10 },
    { header: 'Código (SKU)', key: 'sku', width: 14 },
    { header: 'Stock (botellas)', key: 'stock', type: 'int' },
    { header: 'Stock mínimo', key: 'min_stock', type: 'int', total: false },
    { header: 'Costo promedio', key: 'unit_cost', type: 'money', total: false },
    { header: 'Precio minorista', key: 'price_retail', type: 'money', total: false },
    { header: 'Margen minorista', key: 'margin_retail', type: 'percent', total: false },
    { header: 'Markup minorista', key: 'markup_retail', type: 'percent', total: false, value: (r) => markupOnCost(r.price_retail, r.unit_cost) },
    { header: 'Precio mayorista', key: 'price_wholesale', type: 'money', total: false },
    { header: 'Margen mayorista', key: 'margin_wholesale', type: 'percent', total: false },
    { header: 'Stock valorizado', key: 'stock_value', type: 'money' },
    { header: 'Vendidas (90 días)', key: 'sold_90d', type: 'int' },
    { header: 'Días de stock', key: 'days_of_stock', type: 'int', total: false },
    { header: 'Estado', key: 'active', value: (r) => (r.active ? 'Activo' : 'Desactivado') },
  ]
  const low = products.filter((p) => p.active && p.stock <= p.min_stock)
  await sendWorkbook(res, excelFilename('catalogo-de-vinos'), [
    {
      name: 'Catálogo',
      title: 'Catálogo de vinos',
      subtitle: `${products.length} ${products.length === 1 ? 'vino' : 'vinos'}${activeQ === '1' ? ' activos' : ' (activos y desactivados)'} · stock, costos y precios de hoy`,
      columns,
      rows: products,
      notes: [
        'Costo promedio: es el costo PONDERADO de cada botella. Si tenías 10 botellas a $1.000 y compraste 10 a $1.400, el costo pasa a $1.200. Incluye el flete de cada compra repartido entre las botellas.',
        'Margen = (precio − costo) ÷ precio. Dice de cada $100 que cobrás cuántos te quedan después de pagar el vino.',
        'Markup = (precio − costo) ÷ costo. Es cuánto le sumaste al costo. Ojo: no son lo mismo. Un markup de 66,7 % es un margen de 40 %.',
        'Stock valorizado = botellas × costo promedio: la plata que tenés invertida en cada vino. La fila TOTAL suma todo tu stock.',
        'Días de stock = stock ÷ (botellas vendidas en los últimos 90 días ÷ 90). Vacío = no se vendió en los últimos 90 días.',
      ],
    },
    {
      name: 'Para reponer',
      title: 'Vinos para reponer',
      subtitle: 'Vinos activos con stock en el mínimo o por debajo, con cuánto conviene pedir',
      columns: [
        { header: 'Vino', key: 'name', width: 30 },
        { header: 'Bodega', key: 'winery', width: 24 },
        { header: 'Stock', key: 'stock', type: 'int' },
        { header: 'Stock mínimo', key: 'min_stock', type: 'int', total: false },
        { header: 'Vendidas (90 días)', key: 'sold_90d', type: 'int' },
        { header: 'Sugerido (botellas)', key: 'suggest', type: 'int', value: (r) => reorderSuggestion(r) },
        { header: 'Botellas por caja', key: 'units_per_box', type: 'int', total: false },
        { header: 'Costo estimado', key: 'cost', type: 'money', value: (r) => round2(reorderSuggestion(r) * r.unit_cost) },
      ],
      rows: low,
      notes: [
        'Sugerido: lo necesario para cubrir unos 45 días de venta (al ritmo de los últimos 90 días) o el doble del stock mínimo, lo que sea mayor, redondeado a cajas cerradas.',
        'Costo estimado = sugerido × costo promedio actual. Es una referencia: la bodega puede haber aumentado.',
      ],
    },
  ])
})

const TYPE_PLURALS: Record<WineType, string> = {
  tinto: 'Tintos',
  blanco: 'Blancos',
  rosado: 'Rosados',
  espumante: 'Espumantes',
  naranjo: 'Naranjos',
  dulce: 'Dulces y cosecha tardía',
  otro: 'Otros',
}

router.get('/products/price-list', async (req, res) => {
  const list = qs(req, 'list') === 'mayorista' ? 'mayorista' : 'minorista'
  const settings = getSettings()
  const products = listProducts({ active: true }).filter((p) => (list === 'mayorista' ? p.price_wholesale : p.price_retail) > 0)
  type Row = {
    name: string
    winery: string | null
    varietal: string | null
    vintage: number | string | null
    price: number | null
    available: string
    group?: boolean
  }
  const rows: Row[] = []
  const groupRows: number[] = []
  for (const t of WINE_TYPES) {
    const items = products.filter((p) => p.wine_type === t)
    if (!items.length) continue
    groupRows.push(rows.length)
    rows.push({ name: TYPE_PLURALS[t].toUpperCase(), winery: null, varietal: null, vintage: null, price: null, available: '', group: true })
    for (const p of items) {
      const size = p.size_ml !== 750 ? ` (${p.size_ml >= 1000 ? `${String(p.size_ml / 1000).replace('.', ',')} L` : `${p.size_ml} ml`})` : ''
      rows.push({
        name: `${p.name}${size}`,
        winery: p.winery,
        varietal: p.varietal,
        vintage: p.vintage,
        price: list === 'mayorista' ? p.price_wholesale : p.price_retail,
        available: p.stock > 0 ? 'Sí' : 'Consultar',
      })
    }
  }
  const b = settings.business
  const contact = [b.phone && `Tel./WhatsApp: ${b.phone}`, b.email && `Email: ${b.email}`, b.address && b.address].filter(Boolean).join(' · ')
  const wb = newWorkbook()
  const ws = addSheet(wb, {
    name: list === 'mayorista' ? 'Lista mayorista' : 'Lista de precios',
    title: list === 'mayorista' ? 'Lista de precios mayorista' : 'Lista de precios',
    subtitle: `Precios por botella vigentes al ${fmtDate(today())}`,
    totals: false,
    columns: [
      { header: 'Vino', key: 'name', width: 34 },
      { header: 'Bodega', key: 'winery', width: 26 },
      { header: 'Varietal', key: 'varietal', width: 20 },
      { header: 'Cosecha', key: 'vintage', width: 10 },
      { header: 'Precio', key: 'price', type: 'money', width: 16 },
      { header: 'Disponible', key: 'available', width: 12 },
    ],
    rows,
    notes: [
      'Precios finales por botella, en pesos argentinos.',
      'Los precios pueden cambiar sin previo aviso. "Consultar" = sin stock en este momento.',
      ...(list === 'mayorista' ? ['Precios mayoristas para restaurantes, vinotecas y compras por caja.'] : []),
      ...(contact ? [`Pedidos: ${contact}`] : []),
    ],
  })
  // Encabezados de grupo (TINTOS, BLANCOS…) destacados y a lo ancho.
  for (const idx of groupRows) {
    const r = 5 + idx
    ws.mergeCells(r, 1, r, 6)
    const cell = ws.getCell(r, 1)
    cell.font = { bold: true, size: 12, color: { argb: 'FFA9520F' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCF3D6' } }
    ws.getRow(r).height = 20
  }
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
  await sendWorkbookFile(res, excelFilename(list === 'mayorista' ? 'lista-de-precios-mayorista' : 'lista-de-precios'), wb)
})

router.get('/products/import-template', async (req, res) => {
  const withProducts = qs(req, 'con_vinos') === '1'
  const wb = newWorkbook()
  const ws = wb.addWorksheet('Vinos', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.field, width: c.width }))
  const header = ws.getRow(1)
  header.height = 22
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA9520F' } }
    cell.alignment = { vertical: 'middle' }
  })
  TEMPLATE_COLUMNS.forEach((c, i) => {
    if (c.money) ws.getColumn(i + 1).numFmt = '"$ "#,##0.00'
  })
  if (withProducts) {
    for (const p of listProducts({ active: true })) {
      ws.addRow({
        name: p.name,
        winery: p.winery,
        varietal: p.varietal,
        wine_type: WINE_TYPE_LABELS[p.wine_type]?.split(' /')[0] ?? p.wine_type,
        vintage: p.vintage,
        region: p.region,
        unit_cost: null,
        price_retail: p.price_retail,
        price_wholesale: p.price_wholesale,
        initial_stock: null,
        min_stock: p.min_stock,
        sku: p.sku,
      })
    }
  }
  const typeCol = TEMPLATE_COLUMNS.findIndex((c) => c.field === 'wine_type') + 1
  for (let r = 2; r <= 1000; r++) {
    ws.getCell(r, typeCol).dataValidation = {
      type: 'list',
      allowBlank: true,
      showErrorMessage: false,
      formulae: ['"Tinto,Blanco,Rosado,Espumante,Naranjo,Dulce,Otro"'],
    }
  }
  addSheet(wb, {
    name: 'Instrucciones',
    title: 'Cómo completar la planilla de vinos',
    subtitle: 'Completá la pestaña «Vinos» (un vino por fila) y subila desde Vinos y stock → Importar desde Excel',
    totals: false,
    columns: [
      { header: 'Columna', key: 'header', width: 18 },
      { header: '¿Qué va?', key: 'help', width: 70 },
      { header: 'Ejemplo', key: 'example', width: 20 },
      { header: '¿Obligatoria?', key: 'required', width: 14 },
    ],
    rows: TEMPLATE_COLUMNS.map((c) => ({ ...c, required: c.required ? 'Sí' : 'No' })),
    notes: [
      'No cambies los nombres de la primera fila (los encabezados): el sistema los usa para saber qué es cada cosa.',
      'Los precios y costos se pueden escribir como quieras: 12500, 12.500 o $ 12.500,50.',
      'Si un vino YA EXISTE en el sistema (mismo SKU, o mismo nombre aunque cambien mayúsculas o tildes), se actualizan sus datos y precios. El costo y el stock no se tocan: para eso están «Cambiar costo» y «Ajustar stock» en la ficha del vino (así queda registrado).',
      'Si el vino es NUEVO, se crea con el costo y el stock inicial que pongas.',
      'Las filas con errores no se cargan; el sistema te dice cuáles son para que las corrijas y vuelvas a subir el archivo (las que ya entraron no se duplican).',
    ],
  })
  await sendWorkbookFile(res, excelFilename(withProducts ? 'mis-vinos-para-editar' : 'plantilla-vinos'), wb)
})

/**
 * Números de fila (1, 2, 3… como los ve el usuario en Excel) de las filas con datos de la primera hoja,
 * con el mismo criterio que readFirstSheet (fila 1 = encabezados; se saltean las filas vacías).
 */
async function dataRowNumbers(buffer: Buffer): Promise<number[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const headers: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cell.text ?? '').trim()
  })
  const out: number[] = []
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n <= 1) return
    let hasValue = false
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (!headers[col]) return
      let v: unknown = cell.value
      if (v && typeof v === 'object' && 'result' in (v as object)) v = (v as { result: unknown }).result
      if (v && typeof v === 'object' && 'text' in (v as object)) v = (v as { text: unknown }).text
      if (v && typeof v === 'object' && 'richText' in (v as object)) v = cell.text
      if (v !== null && v !== undefined && v !== '') hasValue = true
    })
    if (hasValue) out.push(n)
  })
  return out
}

router.post('/products/import', express.raw({ type: () => true, limit: '20mb' }), async (req, res) => {
  const body = req.body as unknown
  if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'No llegó ningún archivo. Elegí el Excel y probá de nuevo.')
  let rows: Record<string, unknown>[]
  let rowNumbers: number[] = []
  try {
    rows = await readFirstSheet(body)
    rowNumbers = await dataRowNumbers(body)
  } catch {
    throw new HttpError(
      400,
      'No pudimos leer el archivo. ¿Es un Excel (.xlsx)? Si es un .xls viejo o un .csv, abrilo en Excel y usá «Guardar como» → Libro de Excel (.xlsx).',
    )
  }
  if (rows.length === 0) throw new HttpError(400, 'El Excel está vacío: no encontramos vinos debajo de los encabezados.')
  if (rows.length > 3000) throw new HttpError(400, 'Son demasiadas filas (más de 3.000). Dividí el archivo en partes.')

  // Qué columna es cada cosa (tolerante a mayúsculas, tildes y "($)").
  const headerMap = new Map<string, ImportField>()
  for (const h of new Set(rows.flatMap((r) => Object.keys(r)))) {
    const f = HEADER_ALIASES[normText(h)]
    if (f && ![...headerMap.values()].includes(f)) headerMap.set(h, f)
  }
  if (![...headerMap.values()].includes('name')) {
    throw new HttpError(400, 'No encontramos la columna «Nombre» en la primera fila. Bajá la plantilla y copiá tus vinos ahí.')
  }

  const settings = getSettings()
  const existing = all('SELECT * FROM products').map(toProduct)
  const bySku = new Map<string, Product>()
  const byName = new Map<string, Product>()
  for (const p of existing) {
    if (p.sku && !bySku.has(normText(p.sku))) bySku.set(normText(p.sku), p)
    if (!byName.has(normText(p.name))) byName.set(normText(p.name), p)
  }

  let created = 0
  let updated = 0
  const errors: { row: number; message: string }[] = []
  const notes: { row: number; message: string }[] = []

  tx(() => {
    // Número de fila REAL del Excel (readFirstSheet saltea las filas vacías, así que i + 2 podría no coincidir).
    const sameShape = rowNumbers.length === rows.length
    rows.forEach((raw, i) => {
      const rowNum = sameShape ? rowNumbers[i] : i + 2
      const cells: Partial<Record<ImportField, unknown>> = {}
      for (const [h, f] of headerMap) {
        const v = raw[h]
        if (v instanceof Date) cells[f] = v.getUTCFullYear()
        else if (v !== null && v !== undefined && String(v).trim() !== '') cells[f] = typeof v === 'string' ? v.trim() : v
      }
      const name = cells.name != null ? String(cells.name).trim() : ''
      const label = name ? `«${name}»` : ''
      const rowNotes: string[] = []
      try {
        if (!name) throw new HttpError(400, 'Falta el nombre del vino.')
        const patch: Record<string, unknown> = {}
        for (const f of ['winery', 'varietal', 'region', 'sku', 'notes'] as const) if (cells[f] != null) patch[f] = String(cells[f])
        if (cells.wine_type != null) {
          const t = TYPE_ALIASES[normText(cells.wine_type)]
          if (t) patch.wine_type = t
          else {
            patch.wine_type = 'otro'
            rowNotes.push(`${label}: el tipo «${cells.wine_type}» no lo conocemos, lo cargamos como «Otro».`)
          }
        }
        const numbers: [ImportField, string, boolean][] = [
          ['vintage', 'Cosecha', true],
          ['unit_cost', 'Costo', false],
          ['price_retail', 'Precio minorista', false],
          ['price_wholesale', 'Precio mayorista', false],
          ['initial_stock', 'Stock inicial', true],
          ['min_stock', 'Stock mínimo', true],
          ['units_per_box', 'Botellas por caja', true],
          ['size_ml', 'Tamaño', true],
        ]
        for (const [f, human, isInt] of numbers) {
          if (cells[f] == null) continue
          if (f === 'vintage' && typeof cells[f] === 'string' && /^(nv|s\/?c|sin cosecha|-)$/i.test(String(cells[f]).trim())) continue
          const n = parseArNumber(cells[f])
          if (n === undefined) continue
          if (Number.isNaN(n)) throw new HttpError(400, `${human}: «${cells[f]}» no es un número.`)
          if (n < 0) throw new HttpError(400, `${human}: no puede ser negativo.`)
          patch[f] = isInt ? Math.round(n) : round2(n)
        }

        const skuKey = patch.sku ? normText(patch.sku) : ''
        const match: Product | undefined = (skuKey ? bySku.get(skuKey) : undefined) ?? byName.get(normText(name))
        // Cada fila en su propio "savepoint": si falla, no deja nada a medias.
        tx(() => {
          if (match) {
            const merged = check(productInput, {
              name,
              winery: match.winery,
              varietal: match.varietal,
              wine_type: match.wine_type,
              vintage: match.vintage,
              region: match.region,
              size_ml: match.size_ml,
              sku: match.sku,
              price_retail: match.price_retail,
              price_wholesale: match.price_wholesale,
              min_stock: match.min_stock,
              units_per_box: match.units_per_box,
              active: match.active,
              notes: match.notes,
              ...patch,
              unit_cost: undefined,
              initial_stock: undefined,
            })
            checkUniqueSku(merged.sku, match.id)
            updateProductRow(match.id, merged)
            const fresh = toProduct(get('SELECT * FROM products WHERE id = ?', [match.id])!)
            if (fresh.sku) bySku.set(normText(fresh.sku), fresh)
            byName.set(normText(fresh.name), fresh)
            updated++
            const ignored: string[] = []
            if (patch.unit_cost != null && Math.abs(Number(patch.unit_cost) - match.unit_cost) > 0.01) ignored.push('el costo')
            if (patch.initial_stock != null && Number(patch.initial_stock) !== match.stock) ignored.push('el stock')
            if (ignored.length) {
              rowNotes.push(
                `${label} ya existía: actualizamos sus datos y precios, pero ${ignored.join(' y ')} no se cambia${ignored.length > 1 ? 'n' : ''} desde Excel. Usá «Cambiar costo» o «Ajustar stock» en su ficha.`,
              )
            }
          } else {
            const data = check(productInput, {
              min_stock: settings.defaults.min_stock,
              units_per_box: settings.defaults.units_per_box,
              ...patch,
              name,
            })
            checkUniqueSku(data.sku)
            const id = insertProduct(data)
            const fresh = toProduct(get('SELECT * FROM products WHERE id = ?', [id])!)
            if (fresh.sku) bySku.set(normText(fresh.sku), fresh)
            byName.set(normText(fresh.name), fresh)
            created++
          }
        })
        for (const message of rowNotes) notes.push({ row: rowNum, message })
      } catch (err) {
        const msg = err instanceof HttpError ? err.message.replace(/^Revisá estos datos → /, '') : 'No se pudo cargar esta fila.'
        errors.push({ row: rowNum, message: label ? `${label}: ${msg}` : msg })
      }
    })
  })

  res.json({ created, updated, errors, notes, total: rows.length })
})

// ───────────────────────── Catálogo ─────────────────────────

router.get('/products', (req, res) => {
  const a = qs(req, 'active')
  res.json(listProducts(a === '1' || a === 'true' ? { active: true } : a === '0' || a === 'false' ? { active: false } : {}))
})

router.post('/products/bulk-price', (req, res) => {
  const data = check(bulkPriceInput, req.body)
  const preview = qs(req, 'preview') === '1' || qs(req, 'preview') === 'true'
  let targets: Product[]
  if (data.product_ids && data.product_ids.length) {
    const ids = [...new Set(data.product_ids)]
    targets = all(`SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ids).map(toProduct)
  } else {
    targets = all('SELECT * FROM products WHERE active = 1').map(toProduct)
    if (data.winery) targets = targets.filter((p) => normText(p.winery) === normText(data.winery))
    if (data.wine_type) targets = targets.filter((p) => p.wine_type === data.wine_type)
  }
  targets.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  const factor = 1 + data.percent / 100
  // Al subir se redondea para arriba (nunca perdés margen por redondear). Al BAJAR se redondea para abajo:
  // si no, una baja chica con redondeo grueso podía terminar subiendo el precio ($12.350 −1 % → $13.000).
  const newPrice = (old: number) => {
    if (!old) return old
    const raw = round2(old * factor)
    if (!data.round_to) return raw
    if (data.percent < 0) {
      const down = Math.floor(raw / data.round_to + 1e-9) * data.round_to
      return down > 0 ? down : raw
    }
    return roundUpTo(raw, data.round_to)
  }
  const doRetail = data.apply_to !== 'wholesale'
  const doWholesale = data.apply_to !== 'retail'
  const changes = targets
    .map((p) => {
      const retail = doRetail ? newPrice(p.price_retail) : p.price_retail
      const wholesale = doWholesale ? newPrice(p.price_wholesale) : p.price_wholesale
      return {
        id: p.id,
        name: p.name,
        winery: p.winery,
        unit_cost: p.unit_cost,
        before: doRetail ? p.price_retail : p.price_wholesale,
        after: doRetail ? retail : wholesale,
        before_retail: p.price_retail,
        after_retail: retail,
        before_wholesale: p.price_wholesale,
        after_wholesale: wholesale,
        margin_before: marginOnPrice(p.price_retail, p.unit_cost),
        margin_after: marginOnPrice(retail, p.unit_cost),
      }
    })
    .filter((c) => Math.abs(c.after_retail - c.before_retail) > 0.004 || Math.abs(c.after_wholesale - c.before_wholesale) > 0.004)

  if (!preview) {
    if (!targets.length) throw new HttpError(400, 'No hay vinos que coincidan con lo que elegiste. Revisá el filtro de bodega o tipo.')
    tx(() => {
      for (const c of changes) {
        run(`UPDATE products SET price_retail = ?, price_wholesale = ?, updated_at = datetime('now','localtime') WHERE id = ?`, [
          c.after_retail,
          c.after_wholesale,
          c.id,
        ])
      }
    })
  }
  res.json({ updated: changes.length, matched: targets.length, preview, examples: changes })
})

router.get('/products/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese vino')
  const product = loadProduct(id)
  res.json({
    product,
    movements: queryMovements({ productId: id, limit: 300 }),
    stats: productStats(product),
    monthly: productMonthly(id),
  })
})

router.post('/products', (req, res) => {
  const data = check(productInput, req.body)
  const id = tx(() => {
    checkUniqueSku(data.sku)
    return insertProduct(data)
  })
  res.status(201).json(loadProduct(id))
})

router.put('/products/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese vino')
  const row = get('SELECT * FROM products WHERE id = ?', [id])
  if (!row) throw notFound('ese vino')
  const current = toProduct(row)
  // Lo que no venga en el body queda como estaba (si otra pantalla manda solo { price_retail },
  // no se resetean el stock mínimo, el tamaño ni se reactiva un vino desactivado).
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const base: Record<string, unknown> = {
    name: current.name,
    winery: current.winery,
    varietal: current.varietal,
    wine_type: current.wine_type,
    vintage: current.vintage,
    region: current.region,
    size_ml: current.size_ml,
    sku: current.sku,
    price_retail: current.price_retail,
    price_wholesale: current.price_wholesale,
    min_stock: current.min_stock,
    units_per_box: current.units_per_box,
    active: current.active,
    notes: current.notes,
  }
  // El costo y el stock no se editan acá: para eso están /cost y /adjust (así queda registrado).
  const data = check(productInput, { ...base, ...body, unit_cost: undefined, initial_stock: undefined })
  checkUniqueSku(data.sku, id)
  updateProductRow(id, data)
  res.json(loadProduct(id))
})

router.delete('/products/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese vino')
  if (!get('SELECT id FROM products WHERE id = ?', [id])) throw notFound('ese vino')
  const salesOrPurchases =
    get('SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1', [id]) ||
    get('SELECT 1 FROM purchase_items WHERE product_id = ? LIMIT 1', [id]) ||
    get(`SELECT 1 FROM stock_movements WHERE product_id = ? AND kind IN ('venta', 'compra') LIMIT 1`, [id])
  if (salesOrPurchases) {
    throw new HttpError(409, 'Este vino tiene ventas o compras. Desactivalo en vez de borrarlo (así no se pierde la historia).')
  }
  if (get(`SELECT 1 FROM stock_movements WHERE product_id = ? AND kind NOT IN ('inicial', 'revaluo') LIMIT 1`, [id])) {
    throw new HttpError(
      409,
      'Este vino tiene movimientos de stock (ajustes, roturas, degustaciones o regalos). Desactivalo en vez de borrarlo (así no se pierde la historia).',
    )
  }
  tx(() => {
    run('DELETE FROM stock_movements WHERE product_id = ?', [id])
    run('DELETE FROM products WHERE id = ?', [id])
  })
  res.json({ ok: true })
})

// ───────────────────────── Stock: ajustes y costo ─────────────────────────

router.post('/products/:id/adjust', (req, res) => {
  const id = parseId(req.params.id, 'ese vino')
  const product = get<{ id: number; stock: number }>('SELECT id, stock FROM products WHERE id = ?', [id])
  if (!product) throw notFound('ese vino')
  const body: Record<string, unknown> = req.body && typeof req.body === 'object' ? { ...(req.body as Record<string, unknown>) } : {}
  // Conteo de inventario: si viene "counted" (botellas que contaste), la diferencia se calcula acá contra
  // lo que el sistema tenía AL FINAL DE ESA FECHA. Así un conteo cargado con fecha de hace unos días
  // no pisa las ventas que hubo después.
  let counted: number | null = null
  if (body.kind === 'ajuste' && body.counted !== undefined && body.counted !== null && body.counted !== '') {
    const c = body.counted
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 1_000_000) {
      throw new HttpError(400, 'Revisá estos datos → Botellas que contaste: tiene que ser un número entero, 0 o más.')
    }
    counted = c
    if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      assertRealDate(body.date)
      assertNotBeforeFirst(id, body.date)
      const diff = c - stockAt(id, body.date)
      if (diff === 0) {
        throw new HttpError(400, `Contaste ${c} y el sistema dice lo mismo para el ${fmtDate(body.date)}: no hace falta ajustar nada.`)
      }
      body.qty = diff
    }
  }
  const data = check(stockAdjustInput, body)
  assertRealDate(data.date)
  assertNotBeforeFirst(id, data.date)
  // El usuario escribe "cuántas botellas"; el signo lo pone el sistema según el tipo.
  const qty = data.kind === 'ajuste' ? data.qty : OUT_KINDS.includes(data.kind) ? -Math.abs(data.qty) : Math.abs(data.qty)
  if (qty < 0 && product.stock + qty < 0) {
    const has = product.stock
    throw new HttpError(
      400,
      counted != null
        ? `Con ese conteo, el stock de hoy quedaría en ${has + qty}: después del ${fmtDate(data.date)} salieron más botellas de las que contaste. Revisá la fecha o la cantidad.`
        : data.kind === 'ajuste'
          ? `Con ese ajuste el stock quedaría en ${has + qty}. Si contaste las botellas, poné lo que contaste (no puede ser menos de 0).`
          : `No podés sacar ${Math.abs(qty)} ${Math.abs(qty) === 1 ? 'botella' : 'botellas'}: según el sistema ${has === 1 ? 'queda 1' : `quedan ${has}`}. Si contaste y hay otra cantidad, primero usá «Conté y hay otra cantidad».`,
    )
  }
  if (data.event_id && !get('SELECT id FROM events WHERE id = ?', [data.event_id])) throw new HttpError(400, 'El evento elegido no existe.')
  addMovement({
    product_id: id,
    date: data.date,
    kind: data.kind,
    qty,
    ref_type: data.event_id ? 'event' : null,
    ref_id: data.event_id ?? null,
    notes: data.notes,
  })
  res.json(loadProduct(id))
})

/** Botellas que había al final de un día (para el conteo con fecha pasada). */
router.get('/products/:id/stock-at', (req, res) => {
  const id = parseId(req.params.id, 'ese vino')
  if (!get('SELECT id FROM products WHERE id = ?', [id])) throw notFound('ese vino')
  const d = qs(req, 'date') ?? today()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, 'Revisá estos datos → Fecha: tiene que ser una fecha válida')
  assertRealDate(d)
  res.json({ date: d, stock: stockAt(id, d) })
})

router.post('/products/:id/cost', (req, res) => {
  const id = parseId(req.params.id, 'ese vino')
  if (!get('SELECT id FROM products WHERE id = ?', [id])) throw notFound('ese vino')
  const data = check(costChangeInput, req.body)
  assertRealDate(data.date)
  assertNotBeforeFirst(id, data.date)
  addMovement({ product_id: id, date: data.date, kind: 'revaluo', qty: 0, unit_cost: data.unit_cost, notes: data.notes })
  res.json(loadProduct(id))
})

router.delete('/stock/movements/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese movimiento')
  const m = get<{ id: number; kind: StockMovementKind; ref_type: string | null; ref_id: number | null }>(
    'SELECT id, kind, ref_type, ref_id FROM stock_movements WHERE id = ?',
    [id],
  )
  if (!m) throw notFound('ese movimiento')
  if (!DELETABLE_KINDS.includes(m.kind)) {
    if (m.kind === 'venta') {
      const sale = m.ref_id ? get<{ sale_id: number }>('SELECT sale_id FROM sale_items WHERE id = ?', [m.ref_id]) : undefined
      throw new HttpError(400, `Este movimiento viene de una venta${sale ? ` (#${sale.sale_id})` : ''}. Para cambiarlo, editá o borrá la venta en «Ventas».`)
    }
    if (m.kind === 'compra') {
      const pur = m.ref_id ? get<{ purchase_id: number }>('SELECT purchase_id FROM purchase_items WHERE id = ?', [m.ref_id]) : undefined
      throw new HttpError(
        400,
        `Este movimiento viene de una compra${pur ? ` (#${pur.purchase_id})` : ''}. Para cambiarlo, editá o borrá la compra en «Compras de vino».`,
      )
    }
    throw new HttpError(400, 'El stock inicial no se borra. Si estaba mal, hacé un ajuste («Conté y hay otra cantidad») o usá «Cambiar costo».')
  }
  deleteMovement(id)
  res.json({ ok: true })
})

// ───────────────────────── Movimientos de stock ─────────────────────────

router.get('/stock/movements', (req, res) => {
  const { from, to } = parsePeriod(req)
  const kind = qs(req, 'kind')
  res.json(
    queryMovements({
      from,
      to,
      productId: qn(req, 'product_id'),
      kind: kind && (STOCK_MOVEMENT_KINDS as readonly string[]).includes(kind) ? kind : undefined,
    }),
  )
})

router.get('/stock/export', async (req, res) => {
  const productId = qn(req, 'product_id')
  // Para la planilla de UN vino sin fechas: toda su historia (del primer al último movimiento).
  let defaults: { from: string; to: string } | undefined
  if (productId && !qs(req, 'from') && !qs(req, 'to')) {
    const r = get<{ a: string | null; b: string | null }>('SELECT MIN(date) AS a, MAX(date) AS b FROM stock_movements WHERE product_id = ?', [productId])
    if (r?.a) defaults = { from: r.a, to: r.b && r.b > today() ? r.b : today() }
  }
  const { from, to } = parsePeriod(req, defaults)
  const movements = queryMovements({ from, to, productId, order: 'asc' })
  // Resumen por vino: stock al inicio + entradas − salidas = stock al final.
  const kinds = (ks: string[]) => ks.map((k) => `'${k}'`).join(',')
  const summary = all<{
    name: string
    winery: string | null
    stock_start: number
    entradas: number
    ventas: number
    mermas: number
    ajustes: number
    stock_end: number
  }>(
    `SELECT p.name, p.winery,
       COALESCE(SUM(CASE WHEN m.date < ? THEN m.qty END), 0) AS stock_start,
       COALESCE(SUM(CASE WHEN m.date BETWEEN ? AND ? AND m.kind IN ('inicial','compra') THEN m.qty END), 0) AS entradas,
       COALESCE(-SUM(CASE WHEN m.date BETWEEN ? AND ? AND m.kind = 'venta' THEN m.qty END), 0) AS ventas,
       COALESCE(-SUM(CASE WHEN m.date BETWEEN ? AND ? AND m.kind IN (${kinds(OUT_KINDS)}) THEN m.qty END), 0) AS mermas,
       COALESCE(SUM(CASE WHEN m.date BETWEEN ? AND ? AND m.kind IN ('ajuste','devolucion') THEN m.qty END), 0) AS ajustes,
       COALESCE(SUM(CASE WHEN m.date <= ? THEN m.qty END), 0) AS stock_end
     FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
     ${productId ? 'WHERE p.id = ?' : ''}
     GROUP BY p.id
     HAVING stock_start <> 0 OR stock_end <> 0 OR SUM(CASE WHEN m.date BETWEEN ? AND ? THEN 1 ELSE 0 END) > 0
     ORDER BY p.name COLLATE NOCASE`,
    [from, from, to, from, to, from, to, from, to, to, ...(productId ? [productId] : []), from, to],
  )
  const productName = productId ? get<{ name: string }>('SELECT name FROM products WHERE id = ?', [productId])?.name : undefined
  await sendWorkbook(res, excelFilename(productName ? `movimientos-${productName}` : 'movimientos-de-stock'), [
    {
      name: 'Movimientos',
      title: productName ? `Movimientos de stock · ${productName}` : 'Movimientos de stock',
      subtitle: periodSubtitle(from, to),
      columns: [
        { header: 'Fecha', key: 'date', type: 'date' },
        { header: 'Vino', key: 'product_name', width: 30 },
        { header: 'Bodega', key: 'product_winery', width: 22 },
        { header: 'Movimiento', key: 'kind_label', width: 26 },
        { header: 'Botellas (+ entra / − sale)', key: 'qty', type: 'int', width: 16 },
        { header: 'Costo por botella', key: 'unit_cost', type: 'money', total: false },
        { header: 'Valor a costo', key: 'value', type: 'money' },
        { header: 'Saldo del vino', key: 'saldo', type: 'int', total: false },
        { header: 'Referencia', key: 'reference', width: 40 },
        { header: 'Nota', key: 'notes', width: 30 },
      ],
      rows: movements,
      notes: [
        'Cada fila es una entrada (+) o salida (−) de botellas. «Saldo del vino» = botellas que quedaban de ese vino después del movimiento.',
        'Las salidas se valorizan al costo promedio del momento: así sale el costo de lo vendido y de las mermas.',
        '«Cambio de costo» no mueve botellas: fija un costo nuevo desde esa fecha.',
      ],
    },
    {
      name: 'Resumen por vino',
      title: 'Resumen de stock por vino',
      subtitle: periodSubtitle(from, to),
      columns: [
        { header: 'Vino', key: 'name', width: 30 },
        { header: 'Bodega', key: 'winery', width: 22 },
        { header: 'Stock al inicio', key: 'stock_start', type: 'int' },
        { header: 'Entradas (compras y stock inicial)', key: 'entradas', type: 'int' },
        { header: 'Vendidas', key: 'ventas', type: 'int' },
        { header: 'Roturas, degustaciones, regalos y consumo', key: 'mermas', type: 'int' },
        { header: 'Ajustes y devoluciones (±)', key: 'ajustes', type: 'int' },
        { header: 'Stock al final', key: 'stock_end', type: 'int' },
      ],
      rows: summary,
      notes: [
        'Stock al inicio + entradas − vendidas − roturas/degustaciones/regalos/consumo ± ajustes y devoluciones = stock al final.',
        'Sirve para controlar el inventario y para pasarle al contador.',
      ],
    },
  ])
})

export default router
