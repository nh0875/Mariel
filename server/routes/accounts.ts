// Caja y bancos: dónde está la plata (efectivo, banco, billeteras virtuales), qué entra y qué sale,
// transferencias entre cuentas, arqueos, lo que está por cobrar y por pagar, y el flujo de caja mes a mes.
// (Ver docs/ARQUITECTURA.md → módulo "Caja + Clientes")
//
// Reglas que se respetan acá (y se explican en la pantalla):
// - Cada peso que entra o sale es un movimiento de la tabla payments. Los saldos salen SIEMPRE de
//   services/payments.ts (accountBalances / totalCash), igual que en Inicio y Reportes.
// - Las transferencias entre cuentas no son ingreso ni egreso: si mirás todas las cuentas juntas, no
//   suman ni restan (la plata sigue siendo tuya). Si mirás una cuenta sola, sí entran o salen de ella.
// - Lo "por cobrar" y "por pagar" usa los mismos listados que Ventas, Compras y Gastos, y los totales
//   salen de finance.receivables()/payables(), así coinciden con el tablero de Inicio.
// - El flujo de caja por mes usa finance.monthlySeries() (criterio "percibido").
import { Router } from 'express'
import { z } from 'zod'
import { accountInput, date as realDate, manualCashInput, transferInput } from '../../shared/schemas'
import {
  ACCOUNT_KIND_LABELS,
  MANUAL_CASH_DIRECTION,
  MANUAL_CASH_KINDS,
  MANUAL_CASH_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_REF_LABELS,
  PAYMENT_REF_TYPES,
  type AccountKind,
  type ManualCashKind,
  type PaymentMethod,
  type PaymentRefType,
} from '../../shared/constants'
import { round2 } from '../../shared/calc'
import { addDays, addMonths, endOfMonth, startOfMonth, today } from '../../shared/dates'
import type { AccountWithBalance, Payment } from '../../shared/types'
import { all, get, run, scalar } from '../db'
import { HttpError, badRequest, notFound, parseId, parsePeriod, qn, qs, validate } from '../lib/http'
import { excelFilename, fmtDate, periodSubtitle, sendWorkbook, type ExcelColumn } from '../lib/excel'
import { accountBalances, addPayment, addTransfer, deletePayment, totalCash, type ScheduledPayment } from '../services/payments'
import { pendingLists, projection, type PayableRow, type ReceivableRow } from '../services/cashProjection'
import { monthlySeries, payables, periodSummary, receivables } from '../services/finance'
import { ensureBaseData } from '../services/setup'

export type { PayableRow, Projection, ReceivableRow } from '../services/cashProjection'

const router = Router()

const ISO = /^\d{4}-\d{2}-\d{2}$/
const isManual = (t: string): t is ManualCashKind => (MANUAL_CASH_KINDS as readonly string[]).includes(t)
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** "$ 12.345,50" para textos guardados (descripción del arqueo). */
function moneyText(n: number): string {
  const abs = Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${n < 0 ? '−' : ''}$ ${abs}`
}

// ───────────────────────── Cuentas ─────────────────────────

export type AccountRow = AccountWithBalance & {
  /** Lo que entró y salió de esta cuenta en el mes hasta hoy (incluye transferencias: para la cuenta, es plata que entra o sale). */
  month_in: number
  month_out: number
  /** Lo ya cargado para lo que queda del mes (fecha posterior a hoy): todavía no está en el saldo. */
  month_scheduled_in: number
  month_scheduled_out: number
  /** Cantidad de movimientos (si tiene, no se puede borrar: se desactiva). */
  movements_count: number
  last_movement: string | null
}

/** Cuentas con saldo (a hoy o a una fecha), lo que entró/salió en el mes y cuántos movimientos tienen. */
function listAccounts(asOf?: string): AccountRow[] {
  const ref = asOf ?? today()
  const mFrom = startOfMonth(ref)
  const mEnd = endOfMonth(ref)
  // "Entró/Salió este mes" va hasta la misma fecha que el saldo (hoy): lo cargado con fecha más
  // adelante en el mes se muestra aparte como "programado".
  const month = new Map(
    all<{ account_id: number; cin: number; cout: number; sin: number; sout: number }>(
      `SELECT account_id,
         COALESCE(SUM(CASE WHEN direction = 'in' AND date <= ? THEN amount END), 0) AS cin,
         COALESCE(SUM(CASE WHEN direction = 'out' AND date <= ? THEN amount END), 0) AS cout,
         COALESCE(SUM(CASE WHEN direction = 'in' AND date > ? THEN amount END), 0) AS sin,
         COALESCE(SUM(CASE WHEN direction = 'out' AND date > ? THEN amount END), 0) AS sout
       FROM payments WHERE date BETWEEN ? AND ? GROUP BY account_id`,
      [ref, ref, ref, ref, mFrom, mEnd],
    ).map((r) => [r.account_id, r]),
  )
  const counts = new Map(
    all<{ account_id: number; n: number; last: string | null }>('SELECT account_id, COUNT(*) AS n, MAX(date) AS last FROM payments GROUP BY account_id').map((r) => [
      r.account_id,
      r,
    ]),
  )
  return accountBalances(asOf).map((a) => ({
    ...a,
    month_in: round2(month.get(a.id)?.cin ?? 0),
    month_out: round2(month.get(a.id)?.cout ?? 0),
    month_scheduled_in: round2(month.get(a.id)?.sin ?? 0),
    month_scheduled_out: round2(month.get(a.id)?.sout ?? 0),
    movements_count: counts.get(a.id)?.n ?? 0,
    last_movement: counts.get(a.id)?.last ?? null,
  }))
}

function readAccount(id: number): AccountRow | undefined {
  return listAccounts().find((a) => a.id === id)
}

function mustAccount(id: number): AccountRow {
  const a = readAccount(id)
  if (!a) throw notFound('esa cuenta')
  return a
}

function checkDuplicate(name: string, exceptId?: number) {
  const target = normalize(name)
  const dup = all<{ id: number; name: string; active: number }>('SELECT id, name, active FROM accounts').find((a) => a.id !== exceptId && normalize(a.name) === target)
  if (dup) {
    throw new HttpError(
      409,
      dup.active
        ? `Ya tenés una cuenta llamada «${dup.name}». Usá esa o ponele otro nombre (ej: «${dup.name} 2» o «${dup.name} dólares»).`
        : `Ya tenés una cuenta llamada «${dup.name}», pero está desactivada. Reactivala en vez de crear otra.`,
    )
  }
}

const activeCount = () => scalar<number>('SELECT COUNT(*) FROM accounts WHERE active = 1') ?? 0
const LAST_ACTIVE_MSG =
  'Tiene que quedar al menos una cuenta activa: es donde entra la plata de las ventas y sale la de los gastos. Creá otra cuenta primero y después desactivá esta.'

router.get('/accounts', (req, res) => {
  const asOf = qs(req, 'as_of')
  res.json(listAccounts(asOf && ISO.test(asOf) ? asOf : undefined))
})

router.post('/accounts', (req, res) => {
  const data = validate(accountInput, req.body)
  checkDuplicate(data.name)
  const { lastInsertRowid } = run('INSERT INTO accounts (name, kind, initial_balance, active, notes) VALUES (?, ?, ?, ?, ?)', [
    data.name,
    data.kind,
    round2(data.initial_balance),
    data.active,
    data.notes,
  ])
  res.status(201).json(readAccount(lastInsertRowid))
})

/** Editar. Acepta la cuenta completa o solo lo que cambia (ej: { active: false } para desactivarla). */
router.put('/accounts/:id', (req, res) => {
  const id = parseId(req.params.id, 'esa cuenta')
  const prev = mustAccount(id)
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const cols = ['name', 'kind', 'initial_balance', 'active', 'notes'] as const
  const merged: Record<string, unknown> = {}
  for (const c of cols) merged[c] = c in body ? body[c] : prev[c]
  const data = validate(accountInput, merged)
  if (normalize(data.name) !== normalize(prev.name)) checkDuplicate(data.name, id)
  if (prev.active && !data.active && activeCount() <= 1) throw new HttpError(409, LAST_ACTIVE_MSG)
  run('UPDATE accounts SET name = ?, kind = ?, initial_balance = ?, active = ?, notes = ? WHERE id = ?', [
    data.name,
    data.kind,
    round2(data.initial_balance),
    data.active,
    data.notes,
    id,
  ])
  // Si se desactivó una cuenta asociada a un medio de pago (ej: "efectivo → Caja"), se reasigna sola.
  if (prev.active !== data.active) ensureBaseData()
  res.json(readAccount(id))
})

/** Borrar: solo si no tiene movimientos y no es la última cuenta activa. Si tiene historia → 409 sugiriendo desactivarla. */
router.delete('/accounts/:id', (req, res) => {
  const id = parseId(req.params.id, 'esa cuenta')
  const a = mustAccount(id)
  if (a.movements_count > 0) {
    throw new HttpError(
      409,
      `«${a.name}» tiene ${a.movements_count} ${a.movements_count === 1 ? 'movimiento' : 'movimientos'}. Si la borrás se pierden y los saldos dejan de cerrar, por eso no se puede. ` +
        'Desactivala: deja de aparecer para elegir y su historia se conserva.',
      { movements: a.movements_count },
    )
  }
  if (a.active && activeCount() <= 1) throw new HttpError(409, LAST_ACTIVE_MSG)
  run('DELETE FROM accounts WHERE id = ?', [id])
  ensureBaseData()
  res.json({ ok: true })
})

// ───────────────────────── Arqueo ─────────────────────────

const reconcileInput = z.object({
  date: realDate, // la misma validación que todo lo demás: rechaza fechas que no existen (2026-02-30)
  counted: z.number().finite().min(-1e12).max(1e12),
})

/**
 * Arqueo: contaste la plata real de una cuenta. Se compara con el saldo del sistema a esa fecha y,
 * si no coincide, se registra un "Ajuste de saldo" por la diferencia (entrada si sobra, salida si falta).
 */
router.post('/accounts/:id/reconcile', (req, res) => {
  const id = parseId(req.params.id, 'esa cuenta')
  const account = mustAccount(id)
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  if (typeof body.counted !== 'number' || !Number.isFinite(body.counted)) {
    throw badRequest('Contanos cuánta plata contaste (si no hay nada, poné 0).')
  }
  const data = validate(reconcileInput, { date: body.date ?? today(), counted: body.counted })
  if (data.date > today()) throw badRequest('El arqueo es de plata que ya contaste: la fecha no puede ser futura. Poné la de hoy (o la del día en que contaste).')
  const system = accountBalances(data.date).find((a) => a.id === id)?.balance ?? 0
  const difference = round2(data.counted - system)
  if (Math.abs(difference) < 0.005) {
    res.json({ account_id: id, date: data.date, counted: round2(data.counted), system_balance: system, difference: 0, payment_id: null })
    return
  }
  const paymentId = addPayment({
    date: data.date,
    account_id: id,
    direction: difference > 0 ? 'in' : 'out',
    amount: Math.abs(difference),
    ref_type: 'ajuste',
    description: `Arqueo: contaste ${moneyText(data.counted)}`,
  })
  res.status(201).json({
    account_id: id,
    account_name: account.name,
    date: data.date,
    counted: round2(data.counted),
    system_balance: system,
    difference,
    direction: difference > 0 ? 'in' : 'out',
    payment_id: paymentId,
  })
})

// ───────────────────────── Movimientos ─────────────────────────

export interface MovementRow extends Payment {
  account_name: string
  account_kind: AccountKind
  /** Tipo en castellano ("Cobro de venta", "Retiro de socios / dueños"…). */
  label: string
  /** Cliente, proveedor, medio de pago (comisiones) o la otra cuenta (transferencias). */
  counterpart: string | null
  /** De dónde viene: "Venta #12", "Compra #4 · factura A-0003", "Gasto: Alquiler del local"… */
  document: string
  /** + entra, − sale. */
  signed_amount: number
  /** Saldo de la cuenta después de este movimiento (solo si se filtra por una cuenta). */
  running_balance: number | null
  /** Movimiento cargado desde Caja (aporte, retiro, ajuste…) o transferencia: se puede editar/borrar acá. */
  manual: boolean
  /** Para transferencias: la otra cuenta. */
  other_account_id: number | null
  /** ¿El comprobante (venta/compra/gasto) todavía existe? */
  ref_exists: boolean
}

interface MovementsFilter {
  from: string
  to: string
  account_id?: number
  direction?: 'in' | 'out'
  ref_types?: PaymentRefType[]
}

/** ?ref_type=aporte,retiro · ?ref_type=manual (todos los sueltos). Lo que no es un tipo válido se ignora. */
function parseRefTypes(raw: string | undefined): PaymentRefType[] | undefined {
  if (!raw) return undefined
  const out = new Set<PaymentRefType>()
  for (const part of raw.split(',').map((s) => s.trim())) {
    if (part === 'manual') MANUAL_CASH_KINDS.forEach((k) => out.add(k))
    else if ((PAYMENT_REF_TYPES as readonly string[]).includes(part)) out.add(part as PaymentRefType)
  }
  return [...out]
}

function readFilter(req: Parameters<typeof qs>[0]): MovementsFilter {
  const { from, to } = parsePeriod(req)
  const dir = qs(req, 'direction')
  const accountId = qn(req, 'account_id')
  return {
    from,
    to,
    account_id: accountId && accountId > 0 ? accountId : undefined,
    direction: dir === 'in' || dir === 'out' ? dir : undefined,
    ref_types: parseRefTypes(qs(req, 'ref_type')),
  }
}

type RawMovement = Payment & {
  account_name: string
  account_kind: AccountKind
  sale_exists: number | null
  sale_method: PaymentMethod | null
  client_name: string | null
  purchase_exists: number | null
  invoice_number: string | null
  purchase_supplier: string | null
  expense_description: string | null
  expense_supplier: string | null
  other_account_id: number | null
  other_account_name: string | null
}

function enrich(r: RawMovement): Omit<MovementRow, 'running_balance'> {
  let counterpart: string | null = null
  let document: string
  let refExists = true
  switch (r.ref_type) {
    case 'sale':
      refExists = !!r.sale_exists
      counterpart = r.client_name
      document = refExists ? `Venta #${r.ref_id}` : `Venta #${r.ref_id} (borrada)`
      break
    case 'sale_fee':
      refExists = !!r.sale_exists
      counterpart = r.sale_method ? PAYMENT_METHOD_LABELS[r.sale_method] : null
      document = `Comisión de la venta #${r.ref_id}`
      break
    case 'purchase':
      refExists = !!r.purchase_exists
      counterpart = r.purchase_supplier
      document = `Compra #${r.ref_id}${r.invoice_number ? ` · factura ${r.invoice_number}` : ''}`
      break
    case 'expense':
      refExists = r.expense_description != null
      counterpart = r.expense_supplier
      document = refExists ? `Gasto: ${r.expense_description}` : `Gasto #${r.ref_id} (borrado)`
      break
    case 'transfer':
      counterpart = r.other_account_name
      document = r.other_account_name ? (r.direction === 'out' ? `Transferencia a ${r.other_account_name}` : `Transferencia desde ${r.other_account_name}`) : 'Transferencia entre cuentas'
      break
    default:
      document = r.description || PAYMENT_REF_LABELS[r.ref_type] || r.ref_type
  }
  const { sale_exists, sale_method, client_name, purchase_exists, invoice_number, purchase_supplier, expense_description, expense_supplier, other_account_name, ...payment } = r
  return {
    ...payment,
    label: PAYMENT_REF_LABELS[r.ref_type] ?? r.ref_type,
    counterpart,
    document,
    signed_amount: r.direction === 'in' ? r.amount : -r.amount,
    manual: isManual(r.ref_type) || r.ref_type === 'transfer',
    other_account_id: r.other_account_id ?? null,
    ref_exists: refExists,
  }
}

const MOVEMENTS_SQL = `
  SELECT p.*, a.name AS account_name, a.kind AS account_kind,
    s.id AS sale_exists, s.payment_method AS sale_method, c.name AS client_name,
    pu.id AS purchase_exists, pu.invoice_number, sp.name AS purchase_supplier,
    ex.description AS expense_description, se.name AS expense_supplier,
    t.account_id AS other_account_id, oa.name AS other_account_name
  FROM payments p
  JOIN accounts a ON a.id = p.account_id
  LEFT JOIN sales s ON p.ref_type IN ('sale', 'sale_fee') AND s.id = p.ref_id
  LEFT JOIN clients c ON c.id = s.client_id
  LEFT JOIN purchases pu ON p.ref_type = 'purchase' AND pu.id = p.ref_id
  LEFT JOIN suppliers sp ON sp.id = pu.supplier_id
  LEFT JOIN expenses ex ON p.ref_type = 'expense' AND ex.id = p.ref_id
  LEFT JOIN suppliers se ON se.id = ex.supplier_id
  LEFT JOIN payments t ON p.transfer_id IS NOT NULL AND t.transfer_id = p.transfer_id AND t.id <> p.id
  LEFT JOIN accounts oa ON oa.id = t.account_id
`

/**
 * ¿Las transferencias suman en "entró/salió"? Mirando una cuenta sola, sí (para esa cuenta es plata que entra o sale).
 * Mirando todas juntas, no: se cancelan (salvo que se pida ver justamente las transferencias).
 */
function transfersCount(f: MovementsFilter): boolean {
  return !!f.account_id || (!!f.ref_types?.length && f.ref_types.every((t) => t === 'transfer'))
}

/** "Solo lo que salió · Retiro de socios / dueños" para el subtítulo del Excel (vacío si no hay filtros). */
function filterLabel(f: MovementsFilter): string {
  const parts: string[] = []
  if (f.direction) parts.push(f.direction === 'in' ? 'Solo lo que entró' : 'Solo lo que salió')
  if (f.ref_types?.length) parts.push(f.ref_types.map((t) => PAYMENT_REF_LABELS[t] ?? t).join(', '))
  return parts.join(' · ')
}

/** Saldo de una cuenta (o de todas) al final de un día. */
function balanceAt(asOf: string, accountId?: number): number {
  if (!accountId) return totalCash(asOf)
  return accountBalances(asOf).find((a) => a.id === accountId)?.balance ?? 0
}

export interface MovementsResult {
  from: string
  to: string
  account_id: number | null
  rows: MovementRow[]
  summary: {
    /** Entró / salió según los filtros. Mirando todas las cuentas juntas, las transferencias no cuentan. */
    total_in: number
    total_out: number
    net: number
    count: number
    /** Saldo real (sin filtros de tipo) al empezar y al terminar el período. */
    opening_balance: number
    closing_balance: number
    /** Plata movida entre tus cuentas en el período (no es ingreso ni gasto). */
    transfers: number
  }
}

/**
 * Movimientos de caja del período, del más nuevo al más viejo.
 * Si se filtra por una cuenta, cada renglón trae el saldo de esa cuenta después del movimiento
 * (calculado en orden fecha + nº, como un resumen de banco).
 */
function listMovements(f: MovementsFilter): MovementsResult {
  const where = ['p.date BETWEEN ? AND ?']
  const params: (string | number)[] = [f.from, f.to]
  if (f.account_id) (where.push('p.account_id = ?'), params.push(f.account_id))
  const raw = all<RawMovement>(`${MOVEMENTS_SQL} WHERE ${where.join(' AND ')} ORDER BY p.date, p.id`, params)

  const opening = balanceAt(addDays(f.from, -1), f.account_id)
  let running = opening
  const withBalance: MovementRow[] = raw.map((r) => {
    const m = enrich(r)
    if (f.account_id) running = round2(running + m.signed_amount)
    return { ...m, running_balance: f.account_id ? running : null }
  })

  const rows = withBalance
    .filter((m) => (!f.direction || m.direction === f.direction) && (!f.ref_types || f.ref_types.includes(m.ref_type)))
    .reverse()
  const counted = transfersCount(f) ? rows : rows.filter((m) => m.ref_type !== 'transfer')
  const total_in = round2(counted.filter((m) => m.direction === 'in').reduce((s, m) => s + m.amount, 0))
  const total_out = round2(counted.filter((m) => m.direction === 'out').reduce((s, m) => s + m.amount, 0))
  const transfers = round2(withBalance.filter((m) => m.ref_type === 'transfer' && m.direction === 'out').reduce((s, m) => s + m.amount, 0))
  return {
    from: f.from,
    to: f.to,
    account_id: f.account_id ?? null,
    rows,
    summary: {
      total_in,
      total_out,
      net: round2(total_in - total_out),
      count: rows.length,
      opening_balance: opening,
      closing_balance: balanceAt(f.to, f.account_id),
      transfers: f.account_id ? round2(withBalance.filter((m) => m.ref_type === 'transfer').reduce((s, m) => s + m.amount, 0)) : transfers,
    },
  }
}

function readPayment(id: number): Payment {
  const p = get<Payment>('SELECT * FROM payments WHERE id = ?', [id])
  if (!p) throw notFound('ese movimiento')
  return p
}

const OPPOSITE: Partial<Record<ManualCashKind, ManualCashKind>> = {
  aporte: 'retiro',
  retiro: 'aporte',
  prestamo_recibido: 'prestamo_pagado',
  prestamo_pagado: 'prestamo_recibido',
  otro_ingreso: 'otro_egreso',
  otro_egreso: 'otro_ingreso',
}

/** Si no mandan la dirección, se usa la natural del tipo (un retiro siempre sale). */
function withDefaultDirection(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const b = body as Record<string, unknown>
  if (b.direction == null && typeof b.kind === 'string' && isManual(b.kind)) {
    const d = MANUAL_CASH_DIRECTION[b.kind]
    if (d) return { ...b, direction: d }
  }
  return b
}

/** Un aporte siempre entra; un retiro siempre sale… Solo el "ajuste" puede ir para los dos lados. */
function checkDirection(kind: ManualCashKind, direction: 'in' | 'out') {
  const expected = MANUAL_CASH_DIRECTION[kind]
  if (!expected || expected === direction) return
  const opposite = OPPOSITE[kind]
  throw badRequest(
    `«${MANUAL_CASH_LABELS[kind]}» siempre es plata que ${expected === 'in' ? 'entra' : 'sale'}.` +
      (opposite ? ` Si la plata ${expected === 'in' ? 'salió' : 'entró'}, elegí «${MANUAL_CASH_LABELS[opposite]}».` : ''),
  )
}

function checkAccountExists(id: number, label = 'La cuenta elegida') {
  if (!get('SELECT id FROM accounts WHERE id = ?', [id])) throw badRequest(`${label} no existe. Elegí otra (o creala en «Caja y bancos»).`)
}

router.get('/movements', (req, res) => {
  res.json(listMovements(readFilter(req)))
})

router.get('/movements/export', async (req, res) => {
  const f = readFilter(req)
  const data = listMovements(f)
  const account = f.account_id ? readAccount(f.account_id) : undefined
  const rows = [...data.rows].reverse() // en Excel, del más viejo al más nuevo (como un resumen de banco)
  // Igual que en la pantalla: mirando todas las cuentas juntas, las transferencias no son "entró" ni "salió"
  // (van en su propia columna y suman cero), así el TOTAL del Excel coincide con lo que ves en Caja.
  const withTransfers = transfersCount(f)
  const isMove = (m: MovementRow) => withTransfers || m.ref_type !== 'transfer'
  const cols: ExcelColumn<MovementRow>[] = [
    { header: 'Fecha', key: 'date', type: 'date' },
    { header: 'Cuenta', key: 'account_name', width: 20 },
    { header: 'Tipo', key: 'label', width: 26 },
    { header: 'Detalle', key: 'document', width: 38 },
    { header: 'Cliente / proveedor', key: 'counterpart', value: (m) => m.counterpart ?? '', width: 26 },
    { header: 'Nota', key: 'description', value: (m) => (m.description && m.description !== m.document ? m.description : ''), width: 30 },
    { header: 'Entró', key: 'in', value: (m) => (m.direction === 'in' && isMove(m) ? m.amount : null), type: 'money' },
    { header: 'Salió', key: 'out', value: (m) => (m.direction === 'out' && isMove(m) ? m.amount : null), type: 'money' },
  ]
  if (!withTransfers && rows.some((m) => m.ref_type === 'transfer')) {
    cols.push({ header: 'Entre tus cuentas', key: 'transfer', value: (m) => (m.ref_type === 'transfer' ? m.signed_amount : null), type: 'money' })
  }
  if (f.account_id) cols.push({ header: 'Saldo de la cuenta', key: 'running_balance', type: 'money', total: false })
  const filters = filterLabel(f)

  // Hoja 2: saldo de cada cuenta al empezar y terminar el período.
  const startBal = accountBalances(addDays(f.from, -1))
  const endBal = accountBalances(f.to)
  const perAccount = endBal
    .filter((a) => !f.account_id || a.id === f.account_id)
    .map((a) => {
      const s = startBal.find((x) => x.id === a.id)
      return {
        name: a.name,
        kind: ACCOUNT_KIND_LABELS[a.kind] ?? a.kind,
        opening: s?.balance ?? a.initial_balance,
        in: round2(a.total_in - (s?.total_in ?? 0)),
        out: round2(a.total_out - (s?.total_out ?? 0)),
        closing: a.balance,
        active: a.active ? 'Sí' : 'No',
      }
    })

  await sendWorkbook(res, excelFilename(account ? `movimientos-${account.name}` : 'movimientos-de-caja'), [
    {
      name: 'Movimientos',
      title: account ? `Movimientos de ${account.name}` : 'Movimientos de caja',
      subtitle: `${periodSubtitle(f.from, f.to)}${filters ? ` · ${filters}` : ''}`,
      columns: cols,
      rows,
      notes: [
        'Cada renglón es plata que entró o salió de una cuenta (efectivo, banco, billetera virtual), ordenado del más viejo al más nuevo.',
        'Cobro de venta / Pago de compra / Pago de gasto: vienen de lo que cargaste en Ventas, Compras y Gastos. Comisión de cobro: lo que se queda Mercado Pago o la tarjeta.',
        'Aportes y retiros: plata que ponen o sacan los dueños. No es venta ni gasto, por eso no cambia el resultado del negocio.',
        withTransfers
          ? 'Transferencias entre cuentas: para cada cuenta sí es plata que entra o sale, por eso acá suman en "Entró" y "Salió".'
          : 'Transferencias entre cuentas: aparecen dos veces (sale de una y entra en otra) en la columna "Entre tus cuentas", que suma cero. No cuentan como "Entró" ni "Salió" porque la plata sigue siendo tuya.',
        ...(filters ? [`Ojo: esta planilla está filtrada (${filters}). Los saldos de abajo y la hoja "Saldos por cuenta" son sin filtros.`] : []),
        f.account_id
          ? `Saldo de la cuenta = saldo después de cada movimiento. Al empezar el período había ${moneyText(data.summary.opening_balance)} y al terminar ${moneyText(data.summary.closing_balance)}.`
          : `Plata total en todas las cuentas: ${moneyText(data.summary.opening_balance)} al empezar el período y ${moneyText(data.summary.closing_balance)} al terminar.`,
      ],
    },
    {
      name: 'Saldos por cuenta',
      title: 'Saldos por cuenta',
      subtitle: periodSubtitle(f.from, f.to),
      columns: [
        { header: 'Cuenta', key: 'name', width: 26 },
        { header: 'Tipo', key: 'kind', width: 22 },
        { header: 'Saldo al empezar', key: 'opening', type: 'money' },
        { header: 'Entró', key: 'in', type: 'money' },
        { header: 'Salió', key: 'out', type: 'money' },
        { header: 'Saldo al terminar', key: 'closing', type: 'money' },
        { header: 'Activa', key: 'active', width: 9 },
      ],
      rows: perAccount,
      notes: [
        'Saldo al terminar = saldo al empezar + entró − salió.',
        `Saldo al empezar es al cierre del ${fmtDate(addDays(f.from, -1))}; saldo al terminar, al cierre del ${fmtDate(f.to)}.`,
        'Acá "entró" y "salió" incluyen las transferencias entre tus cuentas, porque para cada cuenta sí es plata que entra o sale.',
      ],
    },
  ])
})

/** Movimiento suelto: aporte, retiro, préstamo, otro ingreso/egreso o ajuste. */
router.post('/movements', (req, res) => {
  const data = validate(manualCashInput, withDefaultDirection(req.body))
  checkDirection(data.kind, data.direction)
  checkAccountExists(data.account_id)
  const id = addPayment({
    date: data.date,
    account_id: data.account_id,
    direction: data.direction,
    amount: data.amount,
    ref_type: data.kind,
    description: data.description,
  })
  res.status(201).json(readPayment(id))
})

/** Editar un movimiento suelto (los cobros y pagos se editan desde su venta, compra o gasto). */
router.put('/movements/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese movimiento')
  const prev = readPayment(id)
  if (!isManual(prev.ref_type)) {
    throw badRequest(
      prev.ref_type === 'transfer'
        ? 'Las transferencias no se editan: borrala y cargala de nuevo.'
        : 'Este movimiento viene de una venta, compra o gasto. Editalo desde ahí, así todo queda coherente.',
    )
  }
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const merged: Record<string, unknown> = {
    date: prev.date,
    kind: prev.ref_type,
    direction: prev.direction,
    amount: prev.amount,
    account_id: prev.account_id,
    description: prev.description,
  }
  for (const k of Object.keys(merged)) if (k in body) merged[k] = body[k]
  // Si cambian el tipo y no dicen la dirección, se toma la natural del tipo nuevo.
  if ('kind' in body && !('direction' in body)) delete merged.direction
  const data = validate(manualCashInput, withDefaultDirection(merged))
  checkDirection(data.kind, data.direction)
  checkAccountExists(data.account_id)
  run('UPDATE payments SET date = ?, account_id = ?, direction = ?, amount = ?, ref_type = ?, description = ? WHERE id = ?', [
    data.date,
    data.account_id,
    data.direction,
    round2(data.amount),
    data.kind,
    data.description,
    id,
  ])
  res.json(readPayment(id))
})

/** Transferencia entre cuentas (ej: depositar el efectivo en el banco). */
router.post('/transfers', (req, res) => {
  const data = validate(transferInput, req.body)
  checkAccountExists(data.from_account_id, 'La cuenta de origen')
  checkAccountExists(data.to_account_id, 'La cuenta de destino')
  const transferId = addTransfer(data)
  const legs = all<Payment>('SELECT * FROM payments WHERE transfer_id = ? ORDER BY id', [transferId])
  const out = legs.find((p) => p.direction === 'out')!
  const inn = legs.find((p) => p.direction === 'in')!
  res.status(201).json({
    id: out.id,
    transfer_id: transferId,
    date: data.date,
    amount: out.amount,
    from_account_id: data.from_account_id,
    to_account_id: data.to_account_id,
    description: out.description,
    payments: [out, inn],
  })
})

/**
 * Borrar un movimiento de caja (genérico: lo usan Caja y los detalles de Ventas, Compras y Gastos).
 * Si es una transferencia se borran las dos patas; si es un cobro de venta se recalculan las comisiones.
 */
router.delete('/payments/:id', (req, res) => {
  const id = parseId(req.params.id, 'ese movimiento')
  deletePayment(id)
  res.json({ ok: true })
})

// ───────────────────────── Por cobrar y por pagar ─────────────────────────

function pendingData() {
  const lists = pendingLists()
  const r = receivables()
  const p = payables()
  return {
    ...lists,
    totals: {
      receivables: r.total,
      receivables_overdue: r.overdue,
      receivables_count: r.count,
      payables: p.total,
      payables_overdue: p.overdue,
      payables_count: p.count,
      payables_purchases: p.purchases,
      payables_expenses: p.expenses,
    },
    projection: projection(lists),
  }
}

router.get('/pending', (_req, res) => {
  res.json(pendingData())
})

router.get('/pending/export', async (_req, res) => {
  const d = pendingData()
  const t = today()
  const pr = d.projection
  await sendWorkbook(res, excelFilename('por-cobrar-y-por-pagar'), [
    {
      name: 'Por cobrar',
      title: 'Lo que te deben (por cobrar)',
      subtitle: `Situación al ${fmtDate(t)}`,
      columns: [
        { header: 'Fecha de venta', key: 'date', type: 'date' },
        { header: 'Venta nº', key: 'id', type: 'text', value: (s: ReceivableRow) => `#${s.id}`, width: 10 },
        { header: 'Cliente', key: 'client_name', value: (s: ReceivableRow) => s.client_name ?? 'Sin cliente', width: 28 },
        { header: 'Vence', key: 'due_date', type: 'date' },
        { header: 'Días vencida', key: 'days_overdue', type: 'int', total: false, value: (s: ReceivableRow) => (s.days_overdue > 0 ? s.days_overdue : null) },
        { header: 'Total venta', key: 'total', type: 'money' },
        { header: 'Ya cobrado', key: 'paid', type: 'money' },
        { header: 'Falta cobrar', key: 'balance', type: 'money' },
      ] as ExcelColumn<ReceivableRow>[],
      rows: d.receivables,
      notes: [
        'Ventas que todavía no te pagaron (o te pagaron una parte), de la más vieja a la más nueva.',
        `Total por cobrar: ${moneyText(d.totals.receivables)}. De eso, ya vencido: ${moneyText(d.totals.receivables_overdue)}.`,
        'Días vencida: cuántos días pasaron desde la fecha en que te tenían que pagar. Cuanto más vieja la deuda, más difícil cobrarla: llamá primero a los de arriba.',
      ],
    },
    {
      name: 'Por pagar',
      title: 'Lo que debés (por pagar)',
      subtitle: `Situación al ${fmtDate(t)}`,
      columns: [
        { header: 'Qué es', key: 'type', value: (p: PayableRow) => (p.type === 'purchase' ? 'Compra de vino' : 'Gasto'), width: 16 },
        { header: 'Fecha', key: 'date', type: 'date' },
        { header: 'A quién / qué', key: 'name', width: 30 },
        { header: 'Detalle', key: 'detail', width: 34 },
        { header: 'Vence', key: 'due_date', type: 'date' },
        { header: 'Días vencida', key: 'days_overdue', type: 'int', total: false, value: (p: PayableRow) => (p.days_overdue > 0 ? p.days_overdue : null) },
        { header: 'Total', key: 'total', type: 'money' },
        { header: 'Ya pagado', key: 'paid', type: 'money' },
        { header: 'Falta pagar', key: 'balance', type: 'money' },
      ] as ExcelColumn<PayableRow>[],
      rows: d.payables,
      notes: [
        'Compras de vino y gastos que todavía no pagaste (o pagaste en parte), ordenados por vencimiento.',
        `Total por pagar: ${moneyText(d.totals.payables)} (compras ${moneyText(d.totals.payables_purchases)} + gastos ${moneyText(d.totals.payables_expenses)}). Ya vencido: ${moneyText(d.totals.payables_overdue)}.`,
      ],
    },
    {
      name: 'Próximos 30 días',
      title: `Cómo quedaría la caja al ${fmtDate(pr.until)}`,
      subtitle: `Proyección hecha el ${fmtDate(t)}`,
      totals: false,
      columns: [
        { header: 'Concepto', key: 'label', width: 58 },
        { header: 'Monto', key: 'amount', type: 'money' },
      ],
      rows: [
        { label: 'Plata que tenés hoy (todas las cuentas)', amount: pr.cash_now },
        { label: '+ Te tienen que pagar (vencido)', amount: pr.in_breakdown.overdue },
        { label: '+ Te tienen que pagar (vence en los próximos 30 días)', amount: pr.in_breakdown.upcoming },
        { label: '+ Ventas a cuenta sin fecha de pago', amount: pr.in_breakdown.no_date },
        { label: '+ Cobros programados (ya cargados, con fecha más adelante)', amount: pr.in_breakdown.scheduled },
        { label: '− Tenés que pagar (vencido)', amount: -pr.out_breakdown.overdue },
        { label: '− Tenés que pagar (vence en los próximos 30 días)', amount: -pr.out_breakdown.upcoming },
        { label: '− Deudas sin fecha de vencimiento', amount: -pr.out_breakdown.no_date },
        { label: '− Pagos programados (ya cargados como pagados, con fecha más adelante)', amount: -pr.out_breakdown.scheduled },
        { label: '− Gastos fijos que todavía no cargaste (alquiler, sueldos…)', amount: -pr.out_breakdown.fixed },
        { label: '= Plata que te quedaría', amount: pr.expected_balance },
      ],
      notes: [
        'Es una estimación: supone que cobrás y pagás todo lo que vence en los próximos 30 días (y lo ya vencido).',
        'Programados: pagos o cobros que ya cargaste con una fecha que todavía no llegó (por ejemplo, gastos fijos generados como pagados para el día 20). En Gastos figuran como pagados, pero la plata sale de la cuenta ese día; por eso la plata de hoy todavía no los descuenta y se restan acá. El detalle está en la hoja «Programados».',
        'No incluye ventas ni compras nuevas que todavía no hiciste. Si el resultado da negativo o muy justo, anticipate: cobrá lo vencido o negociá plazos.',
      ],
    },
    {
      name: 'Programados',
      title: 'Pagos y cobros programados (ya cargados, con fecha más adelante)',
      subtitle: `Del ${fmtDate(addDays(t, 1))} al ${fmtDate(pr.until)}`,
      columns: [
        { header: 'Fecha', key: 'date', type: 'date' },
        { header: 'Qué es', key: 'label', width: 34 },
        { header: 'Tipo', key: 'ref_type', width: 22, value: (r: ScheduledPayment) => PAYMENT_REF_LABELS[r.ref_type] ?? r.ref_type },
        { header: 'Cuenta', key: 'account_name', width: 22 },
        { header: 'Entra', key: 'in', type: 'money', value: (r: ScheduledPayment) => (r.direction === 'in' ? r.amount : null) },
        { header: 'Sale', key: 'out', type: 'money', value: (r: ScheduledPayment) => (r.direction === 'out' ? r.amount : null) },
      ] as ExcelColumn<ScheduledPayment>[],
      rows: pr.scheduled_items,
      notes: [
        'Movimientos que ya cargaste con una fecha que todavía no llegó. El saldo de hoy no los cuenta: entran o salen de la cuenta ese día.',
        'Ejemplo típico: al generar los gastos fijos del mes, los que se debitan solos quedan «pagados» con la fecha de su débito.',
      ],
    },
  ])
})

// ───────────────────────── Flujo de caja ─────────────────────────

function cashflowData(from: string, to: string) {
  const series = monthlySeries(from, to)
  const months = series.map((m) => ({
    month: m.month,
    label: m.label,
    from: m.from,
    to: m.to,
    cash_in: m.cash_in,
    cash_out: m.cash_out,
    net: round2(m.cash_in - m.cash_out),
    /** Plata total en todas las cuentas al terminar el mes. */
    balance_end: totalCash(m.to),
    /** Resultado del mes (criterio devengado), para comparar con la caja. */
    result: m.net_result,
  }))
  const by_kind = all<{ ref_type: PaymentRefType; cin: number; cout: number }>(
    `SELECT ref_type,
       COALESCE(SUM(CASE WHEN direction = 'in' THEN amount END), 0) AS cin,
       COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS cout
     FROM payments WHERE ref_type <> 'transfer' AND date BETWEEN ? AND ? GROUP BY ref_type`,
    [from, to],
  )
    .map((r) => ({ ref_type: r.ref_type, label: PAYMENT_REF_LABELS[r.ref_type] ?? r.ref_type, in: round2(r.cin), out: round2(r.cout) }))
    .sort((a, b) => b.in + b.out - (a.in + a.out))
  const s = periodSummary(from, to)
  const kind = (k: PaymentRefType) => by_kind.find((x) => x.ref_type === k)
  return {
    from,
    to,
    months,
    by_kind,
    totals: {
      cash_in: s.cash_in,
      cash_out: s.cash_out,
      net: round2(s.cash_in - s.cash_out),
      balance_start: totalCash(addDays(from, -1)),
      balance_end: totalCash(to),
      /** Para explicar "resultado ≠ caja". */
      result: s.net_result,
      sales: s.sales,
      purchases: s.purchases,
      contributions: kind('aporte')?.in ?? 0,
      withdrawals: kind('retiro')?.out ?? 0,
    },
    projection: projection(),
  }
}

const cashflowPeriod = (req: Parameters<typeof parsePeriod>[0]) => {
  const t = today()
  return parsePeriod(req, { from: addMonths(startOfMonth(t), -11), to: endOfMonth(t) })
}

router.get('/cashflow', (req, res) => {
  const { from, to } = cashflowPeriod(req)
  res.json(cashflowData(from, to))
})

router.get('/cashflow/export', async (req, res) => {
  const { from, to } = cashflowPeriod(req)
  const d = cashflowData(from, to)
  await sendWorkbook(res, excelFilename('flujo-de-caja'), [
    {
      name: 'Flujo de caja',
      title: 'Flujo de caja mes a mes',
      subtitle: periodSubtitle(from, to),
      columns: [
        { header: 'Mes', key: 'label', width: 12 },
        { header: 'Entró', key: 'cash_in', type: 'money' },
        { header: 'Salió', key: 'cash_out', type: 'money' },
        { header: 'Flujo neto (entró − salió)', key: 'net', type: 'money' },
        { header: 'Plata a fin de mes', key: 'balance_end', type: 'money', total: false },
        { header: 'Resultado del mes', key: 'result', type: 'money' },
      ],
      rows: d.months,
      notes: [
        'Entró / Salió = plata que efectivamente se movió en tus cuentas (cobros, pagos, aportes, retiros, préstamos…). Las transferencias entre tus cuentas no cuentan.',
        'Plata a fin de mes = suma de todas tus cuentas el último día del mes.',
        'Resultado del mes = ventas − costo de lo vendido − comisiones − mermas − gastos. Cuenta lo vendido y gastado aunque no se haya cobrado o pagado; por eso no coincide con el flujo de caja (y está bien).',
      ],
    },
    {
      name: 'Por tipo',
      title: 'De dónde vino y a dónde fue la plata',
      subtitle: periodSubtitle(from, to),
      columns: [
        { header: 'Tipo de movimiento', key: 'label', width: 34 },
        { header: 'Entró', key: 'in', type: 'money' },
        { header: 'Salió', key: 'out', type: 'money' },
      ],
      rows: d.by_kind,
      notes: ['Sumá "Entró" y "Salió" para ver el total del período. Las transferencias entre tus cuentas no aparecen porque se cancelan.'],
    },
  ])
})

export default router
