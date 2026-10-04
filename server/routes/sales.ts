// Ventas: listado, resumen del período, alta/edición/borrado, cobros, Excel y comprobante imprimible.
// (Ver docs/ARQUITECTURA.md → módulo "Ventas")
//
// Toda la lógica contable vive en services/sales.ts (stock, costo congelado, cobros y comisiones)
// y services/finance.ts (números del período). Acá solo se valida, se filtra y se arma la respuesta.
import { Router, type Request } from 'express'
import { saleInput, settlementInput } from '../../shared/schemas'
import {
  PAYMENT_METHOD_LABELS,
  SALE_CHANNEL_LABELS,
  SALE_CHANNELS,
  type PaymentMethod,
  type SaleChannel,
} from '../../shared/constants'
import { round2, safeDiv } from '../../shared/calc'
import type { SaleWithStatus } from '../../shared/types'
import { all, get, scalar } from '../db'
import { badRequest, notFound, parseId, parsePeriod, qn, qs, validate } from '../lib/http'
import { excelFilename, fmtDate, periodSubtitle, sendWorkbook, type ExcelColumn } from '../lib/excel'
import { createSale, deleteSale, getSaleDetail, listSales, updateSale, type SalesFilter } from '../services/sales'
import { addSettlement, paidFor } from '../services/payments'
import { periodSummary, receivables, salesByChannel } from '../services/finance'
import { getSettings } from '../services/settings'

const router = Router()

// ───────────────────────── Filtros ─────────────────────────

/**
 * Estados de cobro que se pueden filtrar:
 * - pagado / parcial / pendiente: el estado exacto.
 * - por_cobrar: todo lo que tiene saldo (pendiente + parcial).
 * - vencida: tiene saldo y la fecha de vencimiento ya pasó.
 */
const STATUS_FILTERS = ['pagado', 'parcial', 'pendiente', 'por_cobrar', 'vencida'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const ISO = /^\d{4}-\d{2}-\d{2}$/

interface ListFilter {
  base: SalesFilter
  status?: StatusFilter
}

/**
 * Lee los filtros del listado. Las fechas son opcionales: sin from/to trae todas las ventas
 * (lo usan, por ejemplo, la ficha de un cliente o de un evento).
 */
function readFilters(req: Request, period?: { from: string; to: string }): ListFilter {
  const from = period?.from ?? (qs(req, 'from') && ISO.test(qs(req, 'from')!) ? qs(req, 'from') : undefined)
  const to = period?.to ?? (qs(req, 'to') && ISO.test(qs(req, 'to')!) ? qs(req, 'to') : undefined)
  const channel = qs(req, 'channel')
  if (channel && !(SALE_CHANNELS as readonly string[]).includes(channel)) {
    throw badRequest('Ese canal de venta no existe. Elegí uno de la lista.')
  }
  const status = qs(req, 'status')
  if (status && !(STATUS_FILTERS as readonly string[]).includes(status)) {
    throw badRequest('Ese estado de cobro no existe. Probá con: cobradas, por cobrar o vencidas.')
  }
  const base: SalesFilter = {
    from: from && to && from > to ? to : from,
    to: from && to && from > to ? from : to,
    channel,
    client_id: qn(req, 'client_id'),
    event_id: qn(req, 'event_id'),
    product_id: qn(req, 'product_id'),
  }
  // Los estados exactos los filtra el servicio; los combinados, acá.
  if (status === 'pagado' || status === 'parcial' || status === 'pendiente') base.status = status
  return { base, status: status as StatusFilter | undefined }
}

function applyStatus(list: SaleWithStatus[], status?: StatusFilter): SaleWithStatus[] {
  if (status === 'por_cobrar') return list.filter((s) => s.status !== 'pagado')
  if (status === 'vencida') return list.filter((s) => s.overdue)
  return list
}

export interface ItemPreview {
  name: string
  qty: number
  /** true = vino del stock; false = ítem suelto (entrada, caja de regalo…). */
  is_wine: boolean
}

export type SaleListRow = SaleWithStatus & {
  /** Los renglones resumidos, para mostrar "3 botellas · Malbec Reserva +1" sin pedir el detalle. */
  items_preview: ItemPreview[]
}

/** Agrega a cada venta un resumen de sus renglones (nombre del vino o descripción y cantidad). */
function withPreviews(list: SaleWithStatus[], f: SalesFilter): SaleListRow[] {
  if (!list.length) return []
  const where: string[] = []
  const params: string[] = []
  if (f.from) (where.push('s.date >= ?'), params.push(f.from))
  if (f.to) (where.push('s.date <= ?'), params.push(f.to))
  const rows = all<{ sale_id: number; qty: number; product_id: number | null; name: string | null }>(
    `SELECT si.sale_id, si.qty, si.product_id, COALESCE(p.name, si.description) AS name
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     LEFT JOIN products p ON p.id = si.product_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY si.sale_id, si.id`,
    params,
  )
  const bySale = new Map<number, ItemPreview[]>()
  for (const r of rows) {
    if (!bySale.has(r.sale_id)) bySale.set(r.sale_id, [])
    bySale.get(r.sale_id)!.push({ name: r.name || 'Ítem sin nombre', qty: r.qty, is_wine: r.product_id != null })
  }
  return list.map((s) => ({ ...s, items_preview: bySale.get(s.id) ?? [] }))
}

const channelLabel = (c: string) => SALE_CHANNEL_LABELS[c as SaleChannel] ?? c
/** Nombres de los medios de pago (los de Configuración, que el usuario puede renombrar). Se arma una vez por pedido. */
function methodLabeler() {
  const configured = new Map(getSettings().payment_methods.map((x) => [x.key as string, x.label]))
  return (m: string) => configured.get(m) || PAYMENT_METHOD_LABELS[m as PaymentMethod] || m
}
const statusLabel = (s: SaleWithStatus) =>
  s.status === 'pagado' ? 'Cobrada' : s.overdue ? 'Vencida' : s.status === 'parcial' ? 'Cobro parcial' : 'Por cobrar'

// ───────────────────────── Listado y resumen ─────────────────────────

router.get('/sales', (req, res) => {
  const f = readFilters(req)
  const list = applyStatus(listSales(f.base), f.status)
  res.json(withPreviews(list, f.base))
})

/**
 * Resumen del período para la pantalla de Ventas.
 * Los totales salen de finance.periodSummary (los mismos números que Inicio y Reportes).
 */
router.get('/sales/summary', (req, res) => {
  const { from, to } = parsePeriod(req)
  const ps = periodSummary(from, to)
  const list = listSales({ from, to })

  const pendingRows = list.filter((s) => s.balance > 0.01)
  const pending = round2(pendingRows.reduce((sum, s) => sum + s.balance, 0))
  const overdueRows = pendingRows.filter((s) => s.overdue)

  const byMethod = new Map<string, { total: number; count: number; fees: number }>()
  const byDay = new Map<string, { total: number; count: number }>()
  for (const s of list) {
    const m = byMethod.get(s.payment_method) ?? { total: 0, count: 0, fees: 0 }
    m.total += s.total
    m.count += 1
    m.fees += s.fee
    byMethod.set(s.payment_method, m)
    const d = byDay.get(s.date) ?? { total: 0, count: 0 }
    d.total += s.total
    d.count += 1
    byDay.set(s.date, d)
  }

  const profit = round2(ps.sales - ps.fees - ps.cogs)
  const methodLabel = methodLabeler()
  res.json({
    from,
    to,
    count: ps.sales_count,
    total: ps.sales,
    bottles: ps.bottles_sold,
    cost: ps.cogs,
    fees: ps.fees,
    /** Ganancia de las ventas = total − comisiones − costo de las botellas (antes de gastos). */
    profit,
    margin: safeDiv(profit, ps.sales),
    avg_ticket: ps.avg_ticket,
    /** Lo que falta cobrar de las ventas de ESTE período. */
    pending,
    pending_count: pendingRows.length,
    overdue: round2(overdueRows.reduce((sum, s) => sum + s.balance, 0)),
    overdue_count: overdueRows.length,
    /** Lo que te deben en total (todas las fechas), para dar contexto. */
    receivables: receivables(),
    /** Fecha de la primera venta cargada (para no comparar contra períodos sin datos). */
    first_sale_date: scalar<string | null>('SELECT MIN(date) FROM sales') ?? null,
    by_channel: salesByChannel(from, to).map((c) => ({
      channel: c.channel,
      label: channelLabel(c.channel),
      total: c.sales,
      count: c.count,
      profit: c.profit,
    })),
    by_payment_method: [...byMethod.entries()]
      .map(([method, v]) => ({ method, label: methodLabel(method), total: round2(v.total), count: v.count, fees: round2(v.fees) }))
      .sort((a, b) => b.total - a.total),
    by_day: [...byDay.entries()]
      .map(([date, v]) => ({ date, total: round2(v.total), count: v.count }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
  })
})

// ───────────────────────── Excel ─────────────────────────

router.get('/sales/export', async (req, res) => {
  const period = parsePeriod(req)
  const f = readFilters(req, period)
  const list = applyStatus(listSales(f.base), f.status)
  const ids = new Set(list.map((s) => s.id))
  const saleById = new Map(list.map((s) => [s.id, s]))

  const items = all<{
    sale_id: number
    product_id: number | null
    product_name: string | null
    winery: string | null
    description: string | null
    qty: number
    unit_price: number
    unit_cost: number
  }>(
    `SELECT si.sale_id, si.product_id, p.name AS product_name, p.winery, si.description, si.qty, si.unit_price, si.unit_cost
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     LEFT JOIN products p ON p.id = si.product_id
     WHERE s.date BETWEEN ? AND ?
     ORDER BY s.date, s.id, si.id`,
    [period.from, period.to],
  ).filter((i) => ids.has(i.sale_id))

  const methodLabel = methodLabeler()
  const salesRows = [...list].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
  const salesCols: ExcelColumn<SaleWithStatus>[] = [
    { header: 'Fecha', key: 'date', type: 'date' },
    { header: 'Nº', key: 'id', type: 'int', total: false, width: 8 },
    { header: 'Cliente', key: 'client_name', value: (s) => s.client_name || 'Consumidor final', width: 26 },
    { header: 'Canal', key: 'channel', value: (s) => channelLabel(s.channel), width: 22 },
    { header: 'Medio de pago', key: 'payment_method', value: (s) => methodLabel(s.payment_method), width: 20 },
    { header: 'Evento', key: 'event_name', value: (s) => s.event_name || '', width: 22 },
    { header: 'Botellas', key: 'bottles', type: 'int', width: 10 },
    { header: 'Subtotal', key: 'subtotal', type: 'money' },
    { header: 'Descuento', key: 'discount', type: 'money' },
    { header: 'Envío cobrado', key: 'shipping', type: 'money' },
    { header: 'Total', key: 'total', type: 'money' },
    { header: 'Comisión', key: 'fee', type: 'money' },
    { header: 'Costo de las botellas', key: 'cost', type: 'money' },
    { header: 'Ganancia', key: 'profit', type: 'money' },
    { header: 'Margen', key: 'margin', value: (s) => safeDiv(s.profit, s.total), type: 'percent', total: false, width: 10 },
    { header: 'Cobrado', key: 'paid', type: 'money' },
    { header: 'Saldo por cobrar', key: 'balance', type: 'money' },
    { header: 'Estado', key: 'status', value: statusLabel, width: 15 },
    { header: 'Vence el', key: 'due_date', type: 'date' },
    { header: 'Notas', key: 'notes', value: (s) => s.notes || '', width: 30 },
  ]

  type ItemRow = (typeof items)[number]
  const itemCols: ExcelColumn<ItemRow>[] = [
    { header: 'Fecha', key: 'date', value: (i) => saleById.get(i.sale_id)?.date, type: 'date' },
    { header: 'Venta Nº', key: 'sale_id', type: 'int', total: false, width: 10 },
    { header: 'Cliente', key: 'client', value: (i) => saleById.get(i.sale_id)?.client_name || 'Consumidor final', width: 24 },
    { header: 'Canal', key: 'channel', value: (i) => channelLabel(saleById.get(i.sale_id)?.channel ?? ''), width: 22 },
    { header: 'Vino / ítem', key: 'name', value: (i) => i.product_name || i.description || '', width: 30 },
    { header: 'Bodega', key: 'winery', value: (i) => (i.product_id ? i.winery || '' : 'No es vino (no mueve stock)'), width: 24 },
    { header: 'Cantidad', key: 'qty', type: 'int', width: 10 },
    { header: 'Precio unitario', key: 'unit_price', type: 'money', total: false },
    { header: 'Subtotal', key: 'line_total', value: (i) => round2(i.qty * i.unit_price), type: 'money' },
    { header: 'Costo unitario', key: 'unit_cost', type: 'money', total: false },
    { header: 'Costo total', key: 'line_cost', value: (i) => round2(i.qty * i.unit_cost), type: 'money' },
    { header: 'Ganancia del renglón', key: 'line_profit', value: (i) => round2(i.qty * (i.unit_price - i.unit_cost)), type: 'money' },
    { header: 'Margen', key: 'margin', value: (i) => safeDiv(i.unit_price - i.unit_cost, i.unit_price), type: 'percent', total: false, width: 10 },
  ]

  // Si se exportó con filtros, se aclara en el subtítulo (así nadie confunde una lista filtrada con el total).
  const STATUS_TEXT: Record<StatusFilter, string> = {
    pagado: 'solo cobradas',
    parcial: 'solo con cobro parcial',
    pendiente: 'solo sin cobrar',
    por_cobrar: 'solo por cobrar',
    vencida: 'solo vencidas',
  }
  const filterParts = [
    f.base.channel ? `canal ${channelLabel(f.base.channel)}` : '',
    f.status ? STATUS_TEXT[f.status] : '',
    f.base.client_id ? `cliente ${get<{ name: string }>('SELECT name FROM clients WHERE id = ?', [f.base.client_id])?.name ?? '—'}` : '',
    f.base.event_id ? `evento ${get<{ name: string }>('SELECT name FROM events WHERE id = ?', [f.base.event_id])?.name ?? '—'}` : '',
    f.base.product_id ? `vino ${get<{ name: string }>('SELECT name FROM products WHERE id = ?', [f.base.product_id])?.name ?? '—'}` : '',
  ].filter(Boolean)
  const subtitle = periodSubtitle(period.from, period.to) + (filterParts.length ? ` · Filtro: ${filterParts.join(', ')}` : '')
  await sendWorkbook(res, excelFilename('ventas'), [
    {
      name: 'Ventas',
      title: 'Ventas',
      subtitle,
      columns: salesCols,
      rows: salesRows,
      notes: [
        'Una fila por venta. Total = subtotal (vinos × precio) − descuento + envío cobrado: es lo que paga el cliente.',
        'Comisión = lo que se queda el medio de pago (Mercado Pago, tarjetas) según el % de Configuración → Medios de pago.',
        'Costo de las botellas = lo que te costó cada botella el día de la venta (costo promedio ponderado). Queda "congelado" en la venta.',
        'Ganancia = total − comisión − costo de las botellas. Todavía NO descuenta gastos fijos (alquiler, sueldos…): el resultado final está en Reportes.',
        'Cobrado / Saldo por cobrar: lo que ya entró a tus cuentas y lo que falta. Estado: Cobrada, Cobro parcial, Por cobrar o Vencida (pasó la fecha de vencimiento).',
      ],
    },
    {
      name: 'Detalle por vino',
      title: 'Ventas · detalle por vino',
      subtitle,
      columns: itemCols,
      rows: items,
      notes: [
        'Una fila por renglón de cada venta (cada vino o ítem vendido).',
        'Subtotal = cantidad × precio unitario. No incluye el descuento ni el envío de la venta (esos van en la hoja "Ventas"), por eso la suma puede no coincidir exacto con el total vendido.',
        'Costo unitario = costo promedio de la botella el día de la venta. Los ítems que no son vino (entradas, cajas de regalo) tienen costo 0 y no mueven stock.',
        'Margen = (precio − costo) ÷ precio. Sirve para ver qué vinos te dejan más plata por botella.',
      ],
    },
  ])
})

// ───────────────────────── Una venta ─────────────────────────

router.get('/sales/:id', (req, res) => {
  const id = parseId(req.params.id, 'esa venta')
  res.json(getSaleDetail(id))
})

router.post('/sales', (req, res) => {
  const data = validate(saleInput, req.body)
  const id = createSale(data)
  res.status(201).json(getSaleDetail(id))
})

router.put('/sales/:id', (req, res) => {
  const id = parseId(req.params.id, 'esa venta')
  const data = validate(saleInput, req.body)
  const prev = get<{ total: number }>('SELECT total FROM sales WHERE id = ?', [id])
  if (!prev) throw notFound('esa venta')
  // Si queda "sin cobrar" y ya tenía cobros parciales, esos cobros se mantienen:
  // no puede quedar cobrado más de lo que vale la venta.
  if (!data.paid) {
    const newTotal = round2(data.items.reduce((s, i) => s + i.qty * i.unit_price, 0) - (data.discount ?? 0) + (data.shipping ?? 0))
    const paid = paidFor('sale', id)
    const wasFullyPaid = paid >= prev.total - 0.01
    if (!wasFullyPaid && paid > newTotal + 0.01) {
      throw badRequest(
        `Ya cobraste $${paid.toLocaleString('es-AR')} de esta venta y el nuevo total sería $${newTotal.toLocaleString('es-AR')}. ` +
          'Marcala como cobrada, o borrá algún cobro desde el detalle de la venta antes de bajar el total.',
      )
    }
  }
  updateSale(id, data)
  res.json(getSaleDetail(id))
})

router.delete('/sales/:id', (req, res) => {
  const id = parseId(req.params.id, 'esa venta')
  deleteSale(id)
  res.json({ ok: true })
})

/** Registrar un cobro (total o parcial). */
router.post('/sales/:id/payments', (req, res) => {
  const id = parseId(req.params.id, 'esa venta')
  if (!get('SELECT id FROM sales WHERE id = ?', [id])) throw notFound('esa venta')
  const s = validate(settlementInput, req.body)
  addSettlement('sale', id, s)
  res.status(201).json(getSaleDetail(id))
})

// ───────────────────────── Comprobante imprimible ─────────────────────────

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const ars = (n: number) => {
  const cents = Math.abs(n % 1) > 0.004
  return `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`
}

const FISCAL_LABELS: Record<string, string> = {
  monotributo: 'Monotributista',
  responsable_inscripto: 'Responsable inscripto',
  otro: '',
}

/**
 * Comprobante simple para darle al cliente (remito / ticket interno).
 * NO es una factura: para facturar hay que usar ARCA (ex AFIP) o el sistema de facturación.
 * ?print=1 abre directamente el diálogo de impresión.
 */
router.get('/sales/:id/receipt', (req, res) => {
  const id = parseId(req.params.id, 'esa venta')
  const sale = getSaleDetail(id)
  const settings = getSettings()
  const b = settings.business
  const autoPrint = qs(req, 'print') === '1'
  const methodLabel = methodLabeler()
  const client = sale.client_id ? get<{ name: string; tax_id: string | null; address: string | null; city: string | null; phone: string | null }>(
    'SELECT name, tax_id, address, city, phone FROM clients WHERE id = ?',
    [sale.client_id],
  ) : undefined

  const businessLines = [
    b.address,
    [b.phone, b.email].filter(Boolean).join(' · '),
    [b.tax_id ? `CUIT ${b.tax_id}` : '', FISCAL_LABELS[b.fiscal_condition] ?? ''].filter(Boolean).join(' · '),
  ].filter(Boolean)

  const itemsHtml = sale.items
    .map(
      (i) => `<tr>
        <td>${esc(i.product_name || i.description || 'Ítem')}</td>
        <td class="num">${i.qty}</td>
        <td class="num">${esc(ars(i.unit_price))}</td>
        <td class="num">${esc(ars(round2(i.qty * i.unit_price)))}</td>
      </tr>`,
    )
    .join('')

  const totals: [string, string, string?][] = [['Subtotal', ars(sale.subtotal)]]
  if (sale.discount > 0) totals.push(['Descuento', `− ${ars(sale.discount)}`])
  if (sale.shipping > 0) totals.push(['Envío', ars(sale.shipping)])
  totals.push(['TOTAL', ars(sale.total), 'grand'])

  const payState =
    sale.status === 'pagado'
      ? 'Pagado'
      : `Saldo pendiente: ${ars(sale.balance)}${sale.due_date ? ` · vence el ${fmtDate(sale.due_date)}` : ''}`

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprobante venta #${sale.id} · ${esc(b.name || 'VINOH!')}</title>
<link rel="icon" href="/favicon.svg">
<style>
  :root { --ink:#3b2414; --soft:#6b5546; --muted:#948172; --line:#e6d9ca; --brown:#a9520f; --cream:#fdfaf5; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--cream); color:var(--ink); font: 15px/1.45 'Nunito', 'Segoe UI', system-ui, -apple-system, sans-serif; }
  .bar { display:flex; gap:8px; justify-content:center; padding:14px; }
  .bar button { font:inherit; font-weight:700; border-radius:999px; padding:8px 18px; border:1px solid var(--line); background:#fff; color:var(--ink); cursor:pointer; }
  .bar button.primary { background:var(--brown); border-color:var(--brown); color:#fff; }
  .sheet { max-width:720px; margin:0 auto 32px; background:#fff; border:1px solid var(--line); border-radius:18px; padding:32px 36px; }
  header { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; border-bottom:2px solid var(--brown); padding-bottom:16px; }
  .brand { display:flex; gap:14px; align-items:center; }
  .brand img { width:86px; height:auto; }
  .brand h1 { margin:0; font-size:24px; line-height:1.1; }
  .brand p { margin:2px 0 0; color:var(--soft); font-size:13px; }
  .doc { text-align:right; }
  .doc .kind { font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:var(--brown); font-weight:800; }
  .doc .no { font-size:22px; font-weight:800; }
  .doc p { margin:2px 0 0; color:var(--soft); font-size:13px; }
  .who { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:18px 0; }
  .who h2 { margin:0 0 4px; font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); }
  .who p { margin:0; }
  table { width:100%; border-collapse:collapse; margin-top:6px; }
  th { text-align:left; font-size:11.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--soft); border-bottom:1px solid var(--line); padding:8px 6px; }
  td { padding:8px 6px; border-bottom:1px solid #f1e8dd; vertical-align:top; }
  .num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .totals { margin-left:auto; margin-top:12px; width:min(320px,100%); }
  .totals div { display:flex; justify-content:space-between; padding:4px 6px; }
  .totals .grand { border-top:2px solid var(--ink); margin-top:4px; padding-top:8px; font-size:19px; font-weight:800; }
  .state { margin-top:16px; padding:10px 14px; border-radius:12px; background:#f7f0e6; border:1px solid var(--line); font-weight:700; }
  .notes { margin-top:12px; color:var(--soft); font-size:13.5px; }
  footer { margin-top:26px; padding-top:12px; border-top:1px dashed var(--line); text-align:center; color:var(--muted); font-size:12.5px; }
  footer b { color:var(--ink); }
  @page { size:A4; margin:14mm; }
  @media print {
    body { background:#fff; }
    .bar { display:none; }
    .sheet { border:none; border-radius:0; padding:0; max-width:none; margin:0; }
  }
  @media (max-width:560px) {
    .sheet { padding:22px 18px; border-radius:0; border-left:0; border-right:0; }
    header { flex-direction:column; }
    .doc { text-align:left; }
    .who { grid-template-columns:1fr; }
  }
</style>
</head>
<body>
<div class="bar"><button class="primary" onclick="window.print()">Imprimir</button><button onclick="window.close()">Cerrar</button></div>
<main class="sheet">
  <header>
    <div class="brand">
      <img src="/logo-vinoh.jpg" alt="" onerror="this.remove()">
      <div>
        <h1>${esc(b.name || 'VINOH!')}</h1>
        ${b.tagline ? `<p>${esc(b.tagline)}</p>` : ''}
        ${businessLines.map((l) => `<p>${esc(l)}</p>`).join('')}
      </div>
    </div>
    <div class="doc">
      <div class="kind">Comprobante de venta</div>
      <div class="no">Nº ${String(sale.id).padStart(6, '0')}</div>
      <p>Fecha: ${esc(fmtDate(sale.date))}</p>
    </div>
  </header>
  <section class="who">
    <div>
      <h2>Cliente</h2>
      <p><b>${esc(client?.name || 'Consumidor final')}</b></p>
      ${client?.tax_id ? `<p>CUIT/DNI ${esc(client.tax_id)}</p>` : ''}
      ${client?.address || client?.city ? `<p>${esc([client?.address, client?.city].filter(Boolean).join(', '))}</p>` : ''}
      ${client?.phone ? `<p>${esc(client.phone)}</p>` : ''}
    </div>
    <div>
      <h2>Forma de pago</h2>
      <p>${esc(methodLabel(sale.payment_method))}</p>
      ${sale.event_name ? `<p>Evento: ${esc(sale.event_name)}</p>` : ''}
    </div>
  </section>
  <table>
    <thead><tr><th>Detalle</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Subtotal</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <div class="totals">
    ${totals.map(([k, v, cls]) => `<div class="${cls ?? ''}"><span>${esc(k)}</span><span class="num">${esc(v)}</span></div>`).join('')}
  </div>
  <div class="state">${esc(payState)}</div>
  ${sale.notes ? `<p class="notes">${esc(sale.notes)}</p>` : ''}
  <footer><b>Comprobante no válido como factura.</b> ¡Gracias por tu compra! ${b.tagline ? esc(b.tagline) : ''}</footer>
</main>
${autoPrint ? '<script>window.addEventListener("load", function () { setTimeout(function () { window.print() }, 250) })</script>' : ''}
</body>
</html>`
  res.type('html').send(html)
})

export default router
