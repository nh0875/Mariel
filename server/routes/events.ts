// Eventos: degustaciones, ferias, catas, cenas maridaje y eventos corporativos.
// (Ver docs/ARQUITECTURA.md → módulo "Eventos")
//
// La pregunta que contesta: "¿Me conviene hacer eventos?".
// Un evento es una inversión: lo que gastás (copas, picada, difusión) y las botellas que abrís
// para degustar tiene que volver en entradas y ventas de vino. Por eso cada evento tiene su
// propio "estado de resultados":
//
//     Entradas (renglones de venta que no son vino: "Entrada", "Cubierto"…)
//   + Ventas de vino (el resto de lo que se cobró en ventas asociadas al evento)
//   − Costo del vino vendido (CMV de esas ventas, al costo promedio)
//   − Comisiones de cobro (Mercado Pago, tarjetas)
//   − Gastos del evento (gastos cargados con este evento)
//   − Botellas abiertas (movimientos de stock asociados al evento, valorizados al costo)
//   = Resultado del evento
//
// Nada se recalcula "a mano": las ventas, gastos y botellas se cargan con sus servicios
// (services/sales.ts, services/expenses.ts, services/stock.ts) y acá solo se suman.
import { Router } from 'express'
import { z } from 'zod'
import { eventInput } from '../../shared/schemas'
import { EVENT_KIND_LABELS, STOCK_MOVEMENT_LABELS, type EventKind, type StockMovementKind } from '../../shared/constants'
import { round2, safeDiv } from '../../shared/calc'
import { addDays, today } from '../../shared/dates'
import type { ExpenseWithStatus, SaleWithStatus, WineEvent } from '../../shared/types'
import { all, get, run, tx } from '../db'
import { HttpError, notFound, parseId, qs, validate } from '../lib/http'
import { excelFilename, fmtDate, periodSubtitle, sendWorkbook, type ExcelColumn } from '../lib/excel'
import { addMovement, deleteMovement, recalcProducts } from '../services/stock'
import { listSales } from '../services/sales'
import { listExpenses } from '../services/expenses'

const router = Router()

// ───────────────────────── Tipos de respuesta ─────────────────────────

/** Las cuentas de un evento (ver el comentario de arriba). */
export interface EventSummary {
  /** Todo lo que se cobró en ventas asociadas al evento (total de cada venta). */
  revenue: number
  /** Parte de revenue que son entradas u otros ítems que no son vino del stock. */
  tickets: number
  /** Cantidad de entradas (unidades de ítems que no son vino). */
  tickets_qty: number
  /** revenue − tickets: lo que se vendió de vino (con descuentos y envíos repartidos). */
  wine_sales: number
  /** Costo de las botellas vendidas en el evento. */
  cogs: number
  /** Comisiones de cobro de esas ventas. */
  fees: number
  /** Gastos cargados con este evento. */
  expenses: number
  /** Botellas que salieron del stock para el evento sin venderse (degustación, regalos…). */
  bottles_opened: number
  /** Esas botellas valorizadas al costo promedio del momento. */
  bottles_opened_cost: number
  /** Botellas vendidas en las ventas del evento. */
  bottles_sold: number
  /** cogs + fees + expenses + bottles_opened_cost */
  costs: number
  /** Lo que pusiste para hacer el evento: gastos + botellas abiertas. */
  investment: number
  /** revenue − cogs − fees − expenses − bottles_opened_cost */
  result: number
  /** result ÷ personas (null si no se cargó cuánta gente fue). */
  per_attendee: number | null
  /** result ÷ (gastos + botellas abiertas) (null si no hubo inversión). */
  roi: number | null
  /** (gastos + botellas abiertas) ÷ presupuesto (null si no tiene presupuesto). */
  budget_used: number | null
  sales_count: number
  expenses_count: number
  /** Movimientos de stock asociados (para saber si se puede borrar el evento). */
  opened_count: number
}

export type EventWithSummary = WineEvent & { summary: EventSummary }

export interface OpenedBottle {
  id: number
  date: string
  kind: StockMovementKind
  kind_label: string
  product_id: number
  product_name: string
  product_winery: string | null
  /** Botellas (positivo = salieron del stock). */
  bottles: number
  unit_cost: number
  /** bottles × unit_cost */
  cost: number
  notes: string | null
}

export type EventSale = SaleWithStatus & {
  /** "Entrada al evento ×24" / "Malbec Reserva ×2 +1". */
  items_label: string
  /** Parte de la venta que son entradas (para separar en la tabla). */
  tickets: number
}

export interface EventDetail {
  event: WineEvent
  summary: EventSummary
  sales: EventSale[]
  expenses: ExpenseWithStatus[]
  opened: OpenedBottle[]
  /** ¿Los clientes que compraron en el evento volvieron a comprar en los 30 días siguientes? */
  after: {
    days: number
    /** Clientes identificados que compraron en el evento. */
    clients: number
    /** Cuántos de ellos volvieron a comprar. */
    returning_clients: number
    sales_count: number
    revenue: number
    /** false si todavía no pasaron los 30 días. */
    complete: boolean
  }
  budget_used: number | null
}

const AFTER_DAYS = 30

// ───────────────────────── Cálculo de las cuentas ─────────────────────────

interface Agg {
  revenue: number
  tickets: number
  tickets_qty: number
  cogs: number
  fees: number
  bottles_sold: number
  sales_count: number
  expenses: number
  expenses_count: number
  bottles_opened: number
  bottles_opened_cost: number
  opened_count: number
}

const emptyAgg = (): Agg => ({
  revenue: 0,
  tickets: 0,
  tickets_qty: 0,
  cogs: 0,
  fees: 0,
  bottles_sold: 0,
  sales_count: 0,
  expenses: 0,
  expenses_count: 0,
  bottles_opened: 0,
  bottles_opened_cost: 0,
  opened_count: 0,
})

/**
 * Parte de una venta que corresponde a entradas (ítems sin vino).
 * Si la venta tuvo descuento o envío, se reparte en proporción al subtotal
 * (así "entradas + ventas de vino" da exactamente el total cobrado).
 */
function ticketShare(ticketsGross: number, subtotal: number, total: number): number {
  if (subtotal <= 0 || ticketsGross <= 0) return 0
  return (ticketsGross * total) / subtotal
}

/** Suma ventas, gastos y botellas abiertas de uno o de todos los eventos. */
function aggregate(eventId?: number): Map<number, Agg> {
  const out = new Map<number, Agg>()
  const bucket = (id: number) => {
    if (!out.has(id)) out.set(id, emptyAgg())
    return out.get(id)!
  }
  const filter = (col: string) => (eventId ? `${col} = ?` : `${col} IS NOT NULL`)
  const params = eventId ? [eventId] : []

  for (const s of all<{ event_id: number; subtotal: number; total: number; fee: number; tickets_gross: number; tickets_qty: number; bottles: number; cogs: number }>(
    `SELECT s.event_id, s.subtotal, s.total, s.fee,
       COALESCE(SUM(CASE WHEN si.product_id IS NULL THEN si.qty * si.unit_price END), 0) AS tickets_gross,
       COALESCE(SUM(CASE WHEN si.product_id IS NULL THEN si.qty END), 0) AS tickets_qty,
       COALESCE(SUM(CASE WHEN si.product_id IS NOT NULL THEN si.qty END), 0) AS bottles,
       COALESCE(SUM(si.qty * si.unit_cost), 0) AS cogs
     FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
     WHERE ${filter('s.event_id')}
     GROUP BY s.id`,
    params,
  )) {
    const b = bucket(s.event_id)
    b.revenue += s.total || 0
    b.fees += s.fee || 0
    b.tickets += ticketShare(s.tickets_gross, s.subtotal, s.total)
    b.tickets_qty += s.tickets_qty || 0
    b.bottles_sold += s.bottles || 0
    b.cogs += s.cogs || 0
    b.sales_count += 1
  }

  for (const e of all<{ event_id: number; total: number; n: number }>(
    `SELECT event_id, SUM(amount) AS total, COUNT(*) AS n FROM expenses WHERE ${filter('event_id')} GROUP BY event_id`,
    params,
  )) {
    const b = bucket(e.event_id)
    b.expenses += e.total || 0
    b.expenses_count += e.n || 0
  }

  for (const m of all<{ ref_id: number; bottles: number; cost: number; n: number }>(
    `SELECT ref_id, -SUM(qty) AS bottles, -SUM(qty * unit_cost) AS cost, COUNT(*) AS n
     FROM stock_movements WHERE ref_type = 'event' AND ${eventId ? 'ref_id = ?' : 'ref_id IS NOT NULL'} GROUP BY ref_id`,
    params,
  )) {
    const b = bucket(m.ref_id)
    b.bottles_opened += m.bottles || 0
    b.bottles_opened_cost += m.cost || 0
    b.opened_count += m.n || 0
  }
  return out
}

function finish(a: Agg, ev: Pick<WineEvent, 'attendees' | 'budget'>): EventSummary {
  const revenue = round2(a.revenue)
  const tickets = round2(a.tickets)
  const cogs = round2(a.cogs)
  const fees = round2(a.fees)
  const expenses = round2(a.expenses)
  const openedCost = round2(a.bottles_opened_cost)
  const investment = round2(expenses + openedCost)
  const result = round2(revenue - cogs - fees - expenses - openedCost)
  return {
    revenue,
    tickets,
    tickets_qty: a.tickets_qty,
    wine_sales: round2(revenue - tickets),
    cogs,
    fees,
    expenses,
    bottles_opened: a.bottles_opened,
    bottles_opened_cost: openedCost,
    bottles_sold: a.bottles_sold,
    costs: round2(cogs + fees + expenses + openedCost),
    investment,
    result,
    per_attendee: ev.attendees ? round2(result / ev.attendees) : null,
    roi: investment > 0 ? safeDiv(result, investment) : null,
    budget_used: ev.budget ? safeDiv(investment, ev.budget) : null,
    sales_count: a.sales_count,
    expenses_count: a.expenses_count,
    opened_count: a.opened_count,
  }
}

function loadEvent(id: number): WineEvent | undefined {
  return get<WineEvent>('SELECT * FROM events WHERE id = ?', [id])
}

function eventSummary(ev: WineEvent): EventSummary {
  return finish(aggregate(ev.id).get(ev.id) ?? emptyAgg(), ev)
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Todos los eventos (o los de un período, si vienen from/to) con sus cuentas, del más nuevo al más viejo. */
function listEvents(f: { from?: string; to?: string } = {}): EventWithSummary[] {
  const where: string[] = []
  const params: string[] = []
  if (f.from) (where.push('date >= ?'), params.push(f.from))
  if (f.to) (where.push('date <= ?'), params.push(f.to))
  const events = all<WineEvent>(`SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, id DESC`, params)
  const aggs = aggregate()
  return events.map((e) => ({ ...e, summary: finish(aggs.get(e.id) ?? emptyAgg(), e) }))
}

/** Lee ?from&to opcionales (sin ellos, trae todo). */
function optionalPeriod(req: Parameters<typeof qs>[0]): { from?: string; to?: string } {
  const from = qs(req, 'from')
  const to = qs(req, 'to')
  const f = from && ISO.test(from) ? from : undefined
  const t = to && ISO.test(to) ? to : undefined
  return f && t && f > t ? { from: t, to: f } : { from: f, to: t }
}

/** Botellas abiertas (y otros movimientos de stock) asociados al evento. */
function openedFor(eventId: number): OpenedBottle[] {
  return all<{ id: number; date: string; kind: StockMovementKind; product_id: number; product_name: string; product_winery: string | null; qty: number; unit_cost: number; notes: string | null }>(
    `SELECT m.id, m.date, m.kind, m.product_id, p.name AS product_name, p.winery AS product_winery, m.qty, m.unit_cost, m.notes
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     WHERE m.ref_type = 'event' AND m.ref_id = ?
     ORDER BY m.date DESC, m.id DESC`,
    [eventId],
  ).map((m) => ({
    id: m.id,
    date: m.date,
    kind: m.kind,
    kind_label: STOCK_MOVEMENT_LABELS[m.kind] ?? m.kind,
    product_id: m.product_id,
    product_name: m.product_name,
    product_winery: m.product_winery,
    bottles: -m.qty,
    unit_cost: round2(m.unit_cost),
    cost: round2(-m.qty * m.unit_cost),
    notes: m.notes,
  }))
}

/** Ventas del evento con un resumen de qué se vendió ("Entrada ×24", "Malbec ×2 +1"). */
function salesFor(eventId: number): EventSale[] {
  const sales = listSales({ event_id: eventId })
  if (!sales.length) return []
  const items = all<{ sale_id: number; name: string | null; qty: number; product_id: number | null; unit_price: number }>(
    `SELECT si.sale_id, COALESCE(p.name, si.description) AS name, si.qty, si.product_id, si.unit_price
     FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
     WHERE s.event_id = ? ORDER BY si.sale_id, si.id`,
    [eventId],
  )
  const bySale = new Map<number, typeof items>()
  for (const it of items) {
    if (!bySale.has(it.sale_id)) bySale.set(it.sale_id, [])
    bySale.get(it.sale_id)!.push(it)
  }
  return sales.map((s) => {
    const its = bySale.get(s.id) ?? []
    const first = its[0]
    const label = first ? `${first.name || 'Ítem'} ×${first.qty}${its.length > 1 ? ` +${its.length - 1}` : ''}` : '—'
    const ticketsGross = its.filter((i) => i.product_id == null).reduce((a, i) => a + i.qty * i.unit_price, 0)
    return { ...s, items_label: label, tickets: round2(ticketShare(ticketsGross, s.subtotal, s.total)) }
  })
}

/** ¿Volvieron a comprar los clientes que compraron en el evento? (30 días después) */
function afterEvent(ev: WineEvent): EventDetail['after'] {
  const clientIds = all<{ client_id: number }>('SELECT DISTINCT client_id FROM sales WHERE event_id = ? AND client_id IS NOT NULL', [ev.id]).map((r) => r.client_id)
  const end = addDays(ev.date, AFTER_DAYS)
  const base = { days: AFTER_DAYS, clients: clientIds.length, complete: today() > end }
  if (!clientIds.length) return { ...base, returning_clients: 0, sales_count: 0, revenue: 0 }
  const ph = clientIds.map(() => '?').join(',')
  const r = get<{ n: number; total: number; back_clients: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total, COUNT(DISTINCT client_id) AS back_clients
     FROM sales WHERE client_id IN (${ph}) AND date > ? AND date <= ? AND (event_id IS NULL OR event_id <> ?)`,
    [...clientIds, ev.date, end, ev.id],
  )
  return { ...base, returning_clients: r?.back_clients ?? 0, sales_count: r?.n ?? 0, revenue: round2(r?.total ?? 0) }
}

function eventDetail(id: number): EventDetail {
  const event = loadEvent(id)
  if (!event) throw notFound('ese evento')
  const summary = eventSummary(event)
  return {
    event,
    summary,
    sales: salesFor(id),
    expenses: listExpenses({ event_id: id }),
    opened: openedFor(id),
    after: afterEvent(event),
    budget_used: summary.budget_used,
  }
}

// ───────────────────────── Validación de "botellas abiertas" ─────────────────────────

const openBottlesInput = z.object({
  /** Si no viene, se usa la fecha del evento. */
  date: z
    .string()
    .regex(ISO, 'tiene que ser una fecha válida')
    .nullish()
    .transform((v) => v || null),
  items: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        qty: z.number().int().min(1).max(10_000),
      }),
    )
    .min(1),
  notes: z
    .string()
    .max(500)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
})

// ───────────────────────── Excel ─────────────────────────

const kindLabel = (k: string) => EVENT_KIND_LABELS[k as EventKind] ?? k

const EVENT_COLUMNS: ExcelColumn<EventWithSummary>[] = [
  { header: 'Fecha', key: 'date', type: 'date' },
  { header: 'Evento', key: 'name', width: 34 },
  { header: 'Tipo', key: 'kind', value: (e) => kindLabel(e.kind), width: 18 },
  { header: 'Lugar', key: 'location', value: (e) => e.location || '', width: 22 },
  { header: 'Personas', key: 'attendees', type: 'int', width: 10 },
  { header: 'Entradas', key: 'tickets', value: (e) => e.summary.tickets, type: 'money' },
  { header: 'Ventas de vino', key: 'wine_sales', value: (e) => e.summary.wine_sales, type: 'money' },
  { header: 'Ingresos totales', key: 'revenue', value: (e) => e.summary.revenue, type: 'money' },
  { header: 'Costo del vino vendido', key: 'cogs', value: (e) => e.summary.cogs, type: 'money' },
  { header: 'Comisiones', key: 'fees', value: (e) => e.summary.fees, type: 'money' },
  { header: 'Gastos del evento', key: 'expenses', value: (e) => e.summary.expenses, type: 'money' },
  { header: 'Botellas abiertas', key: 'bottles_opened', value: (e) => e.summary.bottles_opened, type: 'int', width: 11 },
  { header: 'Costo botellas abiertas', key: 'bottles_opened_cost', value: (e) => e.summary.bottles_opened_cost, type: 'money' },
  { header: 'Resultado', key: 'result', value: (e) => e.summary.result, type: 'money' },
  { header: 'Resultado por persona', key: 'per_attendee', value: (e) => e.summary.per_attendee, type: 'money', total: false },
  { header: 'Retorno', key: 'roi', value: (e) => e.summary.roi, type: 'percent', total: false, width: 10 },
  { header: 'Presupuesto', key: 'budget', type: 'money', total: false },
  { header: 'Presupuesto usado', key: 'budget_used', value: (e) => e.summary.budget_used, type: 'percent', total: false, width: 12 },
  { header: 'Botellas vendidas', key: 'bottles_sold', value: (e) => e.summary.bottles_sold, type: 'int', width: 11 },
]

const EVENT_NOTES = [
  'Una fila por evento. Ingresos totales = Entradas + Ventas de vino: todo lo cobrado en ventas que cargaste con ese evento.',
  'Entradas = renglones de venta que no son un vino del stock (entradas, cubiertos…). Si la venta tuvo descuento o envío, se reparte en proporción.',
  'Costo del vino vendido = lo que te costaron las botellas que vendiste en el evento (costo promedio del día de la venta).',
  'Gastos del evento = los gastos que cargaste eligiendo ese evento (copas, picada, difusión…). Botellas abiertas = las que salieron del stock para degustar, valorizadas a su costo.',
  'Resultado = Ingresos − Costo del vino vendido − Comisiones − Gastos del evento − Costo botellas abiertas. Si es positivo, el evento dejó plata.',
  'Retorno = Resultado ÷ (Gastos del evento + Costo botellas abiertas). Ej: 50 % significa que por cada $100 que pusiste, recuperaste los $100 y ganaste $50 más.',
  'Presupuesto usado = (Gastos + botellas abiertas) ÷ Presupuesto. Más de 100 % = te pasaste.',
]

// ───────────────────────── Rutas ─────────────────────────

router.get('/events', (req, res) => {
  res.json(listEvents(optionalPeriod(req)))
})

router.get('/events/export', async (req, res) => {
  const p = optionalPeriod(req)
  const rows = listEvents(p).reverse() // del más viejo al más nuevo
  const subtitle = p.from && p.to ? periodSubtitle(p.from, p.to) : p.from ? `Desde el ${fmtDate(p.from)}` : p.to ? `Hasta el ${fmtDate(p.to)}` : 'Todos los eventos'
  await sendWorkbook(res, excelFilename('eventos'), [
    {
      name: 'Eventos',
      title: 'Eventos: cuánto costó y cuánto dejó cada uno',
      subtitle,
      columns: EVENT_COLUMNS,
      rows,
      notes: EVENT_NOTES,
    },
  ])
})

router.get('/events/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese evento')
  res.json(eventDetail(id))
})

router.get('/events/:id/export', async (req, res) => {
  const id = parseId(req.params.id, 'ese evento')
  const d = eventDetail(id)
  const ev = d.event
  const s = d.summary
  const subtitle = `${kindLabel(ev.kind)} · ${fmtDate(ev.date)}${ev.location ? ` · ${ev.location}` : ''}${ev.attendees ? ` · ${ev.attendees} personas` : ''}`
  type Line = { concept: string; amount: number | null; detail: string }
  const resumen: Line[] = [
    { concept: '+ Entradas', amount: s.tickets, detail: s.tickets_qty ? `${s.tickets_qty} entradas u otros ítems que no son vino` : 'Sin entradas cargadas' },
    { concept: '+ Ventas de vino', amount: s.wine_sales, detail: `${s.bottles_sold} botellas vendidas en ${s.sales_count} ${s.sales_count === 1 ? 'venta' : 'ventas'}` },
    { concept: '= Ingresos del evento', amount: s.revenue, detail: 'Todo lo cobrado en ventas asociadas al evento' },
    { concept: '− Costo del vino vendido', amount: -s.cogs, detail: 'Lo que te costaron las botellas vendidas (costo promedio)' },
    { concept: '− Comisiones de cobro', amount: -s.fees, detail: 'Lo que se quedaron Mercado Pago, tarjetas, etc.' },
    { concept: '− Gastos del evento', amount: -s.expenses, detail: `${s.expenses_count} ${s.expenses_count === 1 ? 'gasto' : 'gastos'} (copas, comida, difusión…)` },
    { concept: '− Botellas abiertas', amount: -s.bottles_opened_cost, detail: `${s.bottles_opened} botellas abiertas para degustar, a su costo` },
    { concept: '= RESULTADO DEL EVENTO', amount: s.result, detail: s.result >= 0 ? 'El evento dejó plata' : 'El evento perdió plata' },
    { concept: 'Resultado por persona', amount: s.per_attendee, detail: ev.attendees ? `Resultado ÷ ${ev.attendees} personas` : 'No cargaste cuánta gente fue' },
    {
      concept: 'Retorno',
      amount: null,
      detail: s.roi == null ? 'Sin gastos ni botellas abiertas: no hay inversión para comparar' : `${Math.round(s.roi * 1000) / 10} % (Resultado ÷ lo que pusiste en gastos y botellas)`,
    },
    {
      concept: 'Presupuesto',
      amount: ev.budget,
      detail: ev.budget ? `Usaste ${Math.round((s.budget_used ?? 0) * 1000) / 10} % (gastos + botellas abiertas = $ ${s.investment.toLocaleString('es-AR')})` : 'Sin presupuesto cargado',
    },
  ]
  await sendWorkbook(res, excelFilename(`evento-${ev.name}`), [
    {
      name: 'Resumen',
      title: `Evento: ${ev.name}`,
      subtitle,
      columns: [
        { header: 'Concepto', key: 'concept', width: 30 },
        { header: 'Monto', key: 'amount', type: 'money' },
        { header: 'Detalle', key: 'detail', width: 60 },
      ],
      rows: resumen,
      totals: false,
      notes: [
        'Se lee de arriba hacia abajo: lo que entró (entradas + ventas de vino) menos lo que costó hacer el evento = el resultado.',
        'Las botellas abiertas no son plata nueva que sale de la caja: es vino que ya tenías y no vas a poder vender. Por eso se cuentan a su costo.',
        'Retorno = Resultado ÷ (Gastos del evento + Botellas abiertas). Ej: 50 % = por cada $100 que pusiste, volvieron $150.',
      ],
    },
    {
      name: 'Ventas',
      title: `Ventas del evento: ${ev.name}`,
      subtitle,
      columns: [
        { header: 'Fecha', key: 'date', type: 'date' },
        { header: 'Venta Nº', key: 'id', type: 'int', total: false, width: 10 },
        { header: 'Cliente', key: 'client_name', value: (x: EventSale) => x.client_name || 'Consumidor final', width: 24 },
        { header: 'Qué se vendió', key: 'items_label', width: 30 },
        { header: 'Entradas', key: 'tickets', type: 'money' },
        { header: 'Botellas', key: 'bottles', type: 'int', width: 10 },
        { header: 'Total', key: 'total', type: 'money' },
        { header: 'Comisión', key: 'fee', type: 'money' },
        { header: 'Costo de las botellas', key: 'cost', type: 'money' },
        { header: 'Ganancia', key: 'profit', type: 'money' },
      ] as ExcelColumn<EventSale>[],
      rows: [...d.sales].reverse(),
      notes: [
        'Las ventas que cargaste eligiendo este evento (entradas y vino).',
        'Ganancia = Total − Comisión − Costo de las botellas. Todavía no descuenta los gastos del evento ni las botellas abiertas: eso está en «Resumen».',
      ],
    },
    {
      name: 'Gastos',
      title: `Gastos del evento: ${ev.name}`,
      subtitle,
      columns: [
        { header: 'Fecha', key: 'date', type: 'date' },
        { header: 'Gasto', key: 'description', width: 34 },
        { header: 'Categoría', key: 'category', width: 26 },
        { header: 'Proveedor', key: 'supplier_name', value: (x: ExpenseWithStatus) => x.supplier_name || '', width: 22 },
        { header: 'Monto', key: 'amount', type: 'money' },
        { header: 'Pagado', key: 'paid', type: 'money' },
        { header: 'Falta pagar', key: 'balance', type: 'money' },
      ] as ExcelColumn<ExpenseWithStatus>[],
      rows: [...d.expenses].reverse(),
      notes: ['Los gastos que cargaste eligiendo este evento. Cuentan en el resultado del evento por su monto, se hayan pagado o no.'],
    },
    {
      name: 'Botellas abiertas',
      title: `Botellas abiertas: ${ev.name}`,
      subtitle,
      columns: [
        { header: 'Fecha', key: 'date', type: 'date' },
        { header: 'Vino', key: 'product_name', width: 30 },
        { header: 'Bodega', key: 'product_winery', value: (x: OpenedBottle) => x.product_winery || '', width: 22 },
        { header: 'Motivo', key: 'kind_label', width: 24 },
        { header: 'Botellas', key: 'bottles', type: 'int', width: 10 },
        { header: 'Costo por botella', key: 'unit_cost', type: 'money', total: false },
        { header: 'Costo total', key: 'cost', type: 'money' },
        { header: 'Notas', key: 'notes', value: (x: OpenedBottle) => x.notes || '', width: 30 },
      ] as ExcelColumn<OpenedBottle>[],
      rows: [...d.opened].reverse(),
      notes: ['Botellas que salieron del stock para el evento sin venderse (para degustar, regalar o sortear). Se valorizan al costo promedio de cada vino ese día.'],
    },
  ])
})

router.post('/events', (req, res) => {
  const data = validate(eventInput, req.body)
  const { lastInsertRowid: id } = run(
    'INSERT INTO events (name, date, kind, location, attendees, ticket_price, budget, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [data.name, data.date, data.kind, data.location, data.attendees, data.ticket_price, data.budget, data.notes],
  )
  const ev = loadEvent(id)!
  res.status(201).json({ ...ev, summary: eventSummary(ev) } satisfies EventWithSummary)
})

router.put('/events/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese evento')
  if (!loadEvent(id)) throw notFound('ese evento')
  const data = validate(eventInput, req.body)
  run('UPDATE events SET name = ?, date = ?, kind = ?, location = ?, attendees = ?, ticket_price = ?, budget = ?, notes = ? WHERE id = ?', [
    data.name,
    data.date,
    data.kind,
    data.location,
    data.attendees,
    data.ticket_price,
    data.budget,
    data.notes,
    id,
  ])
  const ev = loadEvent(id)!
  res.json({ ...ev, summary: eventSummary(ev) } satisfies EventWithSummary)
})

/** "5 ventas, 3 gastos y 8 botellas abiertas" */
function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

router.delete('/events/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese evento')
  const ev = loadEvent(id)
  if (!ev) throw notFound('ese evento')
  const s = eventSummary(ev)
  if (s.sales_count || s.expenses_count || s.opened_count) {
    const parts = [
      s.sales_count ? `${s.sales_count} ${s.sales_count === 1 ? 'venta' : 'ventas'}` : '',
      s.expenses_count ? `${s.expenses_count} ${s.expenses_count === 1 ? 'gasto' : 'gastos'}` : '',
      s.opened_count ? `${s.opened_count} ${s.opened_count === 1 ? 'registro' : 'registros'} de botellas abiertas` : '',
    ].filter(Boolean)
    throw new HttpError(
      409,
      `No se puede borrar «${ev.name}»: tiene ${joinParts(parts)}. Si lo borrás perdés la cuenta de cuánto te costó y cuánto te dejó, así que conviene dejarlo. Si igual querés borrarlo, primero sacale el evento a esas ventas y gastos (o borralos) y quitá las botellas abiertas.`,
    )
  }
  run('DELETE FROM events WHERE id = ?', [id])
  res.json({ ok: true })
})

router.post('/events/:id/open-bottles', (req, res) => {
  const id = parseId(req.params.id, 'ese evento')
  const ev = loadEvent(id)
  if (!ev) throw notFound('ese evento')
  const data = validate(openBottlesInput, req.body)
  const date = data.date ?? ev.date

  // Un renglón por vino (si eligieron el mismo vino dos veces, se suman).
  const byProduct = new Map<number, number>()
  for (const it of data.items) byProduct.set(it.product_id, (byProduct.get(it.product_id) ?? 0) + it.qty)

  for (const [productId, qty] of byProduct) {
    const p = get<{ name: string; stock: number }>('SELECT name, stock FROM products WHERE id = ?', [productId])
    if (!p) throw new HttpError(400, 'Uno de los vinos elegidos no existe más. Revisá los renglones.')
    if (qty > p.stock) {
      throw new HttpError(
        400,
        p.stock <= 0
          ? `No quedan botellas de «${p.name}» según el sistema. Si en realidad tenés, primero corregí el stock en «Vinos y stock».`
          : `No podés abrir ${qty} botellas de «${p.name}»: según el sistema ${p.stock === 1 ? 'queda 1' : `quedan ${p.stock}`}. Si contaste otra cantidad, corregí el stock en «Vinos y stock».`,
      )
    }
  }

  const created = tx(() => {
    const ids: number[] = []
    for (const [productId, qty] of byProduct) {
      ids.push(
        addMovement(
          { product_id: productId, date, kind: 'degustacion', qty: -qty, ref_type: 'event', ref_id: id, notes: data.notes ?? `Degustación: ${ev.name}` },
          { recalc: false },
        ),
      )
    }
    recalcProducts([...byProduct.keys()])
    return ids
  })
  const detail = eventDetail(id)
  res.status(201).json({ ...detail, created: detail.opened.filter((o) => created.includes(o.id)) })
})

router.delete('/events/:id/open-bottles/:movementId', (req, res) => {
  const id = parseId(req.params.id, 'ese evento')
  const movementId = parseId(req.params.movementId, 'ese registro de botellas')
  if (!loadEvent(id)) throw notFound('ese evento')
  const m = get<{ id: number }>("SELECT id FROM stock_movements WHERE id = ? AND ref_type = 'event' AND ref_id = ?", [movementId, id])
  if (!m) throw notFound('ese registro de botellas abiertas')
  deleteMovement(movementId)
  res.json({ ok: true })
})

export default router
