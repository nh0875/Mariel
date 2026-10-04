// Formulario de venta (nueva o editar). Pensado para cargar rápido:
// elegís el vino (el precio se completa solo), la cantidad con − / +, cómo te pagan y listo.
// A la derecha se ve en vivo cuánto paga el cliente y cuánto te queda.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Banknote, Clock, Minus, PackagePlus, Plus, StickyNote, Trash2, Wine } from 'lucide-react'
import clsx from 'clsx'
import { round2, safeDiv } from '@shared/calc'
import { today } from '@shared/dates'
import {
  CLIENT_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  SALE_CHANNEL_LABELS,
  SALE_CHANNELS,
  type ClientKind,
  type PaymentMethod,
  type PriceList,
  type SaleChannel,
} from '@shared/constants'
import type { Product, SaleDetail, WineEvent } from '@shared/types'
import { api } from '@/lib/api'
import { eventStartDate, ticketLine } from '@/lib/eventPreset'
import { bottles as fmtBottles, date as fmtDate, dateShort, money, pct } from '@/lib/format'
import { beforeAltaText, winesBeforeAlta } from '@/lib/alta'
import { useAccounts, useApiMutation, useClients, useEvents, useProducts, useSettings } from '@/lib/queries'
import {
  AccountSelect,
  Button,
  ChoiceCards,
  ClientSelect,
  DateInput,
  EventSelect,
  Field,
  InfoTip,
  IntInput,
  Modal,
  MoneyInput,
  NumberInput,
  ProductSelect,
  Select,
  TextInput,
  Textarea,
  useConfirm,
} from '@/components/ui'
import { Segmented } from './parts'

// ───────────────────────── Estado del formulario ─────────────────────────

type RowKind = 'wine' | 'other'
interface Row {
  key: number
  kind: RowKind
  productId: number | null
  description: string
  qty: number | null
  price: number | null
  /** true = el precio lo puso el sistema (se actualiza si cambiás minorista/mayorista). */
  autoPrice: boolean
}

interface FormState {
  date: string
  rows: Row[]
  priceList: PriceList
  channel: SaleChannel
  clientId: number | null
  eventId: number | null
  discountMode: 'amount' | 'pct'
  discountValue: number | null
  shipping: number | null
  method: PaymentMethod
  paid: 'si' | 'no'
  accountId: number | null
  /** Si la persona eligió la cuenta a mano, no la cambiamos al cambiar el medio de pago. */
  accountTouched: boolean
  dueDate: string
  notes: string
  /** Comisión cargada a mano (null = automática con el % de Configuración). */
  feeOverride: number | null
}

let rowSeq = 0
const newRow = (kind: RowKind = 'wine'): Row => ({ key: ++rowSeq, kind, productId: null, description: '', qty: 1, price: null, autoPrice: true })
const priceFor = (p: Product, list: PriceList) => (list === 'mayorista' ? p.price_wholesale : p.price_retail)
const isEmptyRow = (r: Row) => (r.kind === 'wine' ? r.productId == null : !r.description.trim())
/** ¿Le cargaron algo (precio o una cantidad distinta de la que viene puesta)? Así no se descarta en silencio. */
const hasRowData = (r: Row) => r.price != null || (r.qty != null && r.qty !== 1)
const WHOLESALE_KINDS: ClientKind[] = ['restaurante', 'vinoteca', 'distribuidor']

function buildInitial(
  sale: SaleDetail | null | undefined,
  presetEventId: number | null | undefined,
  presetClientId: number | null | undefined,
  feePctOf: (m: string) => number,
  /** El evento de ?evento=ID (si ya pasó, la venta arranca con su fecha). */
  presetEvent?: WineEvent | null,
  /** ?entrada=1: arranca con un renglón «Entrada» (precio de la entrada × personas). */
  presetTickets?: boolean,
): FormState {
  if (sale) {
    const autoFee = round2((sale.total * feePctOf(sale.payment_method)) / 100)
    return {
      date: sale.date,
      rows: sale.items.length
        ? sale.items.map((i) => ({
            key: ++rowSeq,
            kind: i.product_id ? 'wine' : 'other',
            productId: i.product_id,
            description: i.description ?? '',
            qty: i.qty,
            price: i.unit_price,
            autoPrice: false,
          }))
        : [newRow()],
      priceList: sale.price_list,
      channel: sale.channel,
      clientId: sale.client_id,
      eventId: sale.event_id,
      discountMode: 'amount',
      discountValue: sale.discount || null,
      shipping: sale.shipping || null,
      method: sale.payment_method,
      paid: sale.status === 'pagado' ? 'si' : 'no',
      accountId: sale.payments[0]?.account_id ?? null,
      accountTouched: sale.payments.length > 0,
      dueDate: sale.due_date ?? '',
      notes: sale.notes ?? '',
      feeOverride: Math.abs(sale.fee - autoFee) > 0.01 ? sale.fee : null,
    }
  }
  const tickets = presetEvent && presetTickets ? ticketLine(presetEvent) : null
  return {
    date: eventStartDate(presetEvent),
    rows: tickets ? [{ ...newRow('other'), description: tickets.description, qty: tickets.qty, price: tickets.price, autoPrice: false }] : [newRow()],
    priceList: 'minorista',
    channel: presetEventId ? 'eventos' : 'local',
    clientId: presetClientId ?? null,
    eventId: presetEventId ?? null,
    discountMode: 'amount',
    discountValue: null,
    shipping: null,
    method: 'efectivo',
    paid: 'si',
    accountId: null,
    accountTouched: false,
    dueDate: '',
    notes: '',
    feeOverride: null,
  }
}

// ───────────────────────── Piezas ─────────────────────────

function SectionTitle({ n, children, right }: { n: number; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-[16.5px] font-extrabold text-ink">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-soft text-[13px] text-sky-deep" aria-hidden>
          {n}
        </span>
        {children}
      </h3>
      {right}
    </div>
  )
}

function QtyStepper({ value, onChange, invalid }: { value: number | null; onChange: (v: number | null) => void; invalid?: boolean }) {
  const v = value ?? 0
  return (
    <div
      className={clsx(
        'flex h-11 items-stretch overflow-hidden rounded-xl border bg-paper transition-[border,box-shadow] focus-within:border-brown focus-within:ring-[3px] focus-within:ring-brown/15',
        invalid ? 'border-bad' : 'border-line-strong',
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Una botella menos"
        disabled={v <= 1}
        onClick={() => onChange(Math.max(1, v - 1))}
        className="grid w-8 shrink-0 place-items-center text-ink-soft hover:bg-cream-deep hover:text-ink disabled:opacity-35"
      >
        <Minus size={15} strokeWidth={2.6} />
      </button>
      <IntInput
        aria-label="Cantidad"
        aria-invalid={invalid || undefined}
        value={value}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') (e.preventDefault(), onChange(v + 1))
          if (e.key === 'ArrowDown') (e.preventDefault(), onChange(Math.max(1, v - 1)))
        }}
        className="min-w-0 flex-1"
        inputClassName="h-full! rounded-none! border-0! bg-transparent! px-0! text-center! font-bold focus:ring-0!"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Una botella más"
        onClick={() => onChange(v + 1)}
        className="grid w-8 shrink-0 place-items-center text-ink-soft hover:bg-cream-deep hover:text-ink"
      >
        <Plus size={15} strokeWidth={2.6} />
      </button>
    </div>
  )
}

function SummaryLine({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3 py-1 text-[14.5px]', muted ? 'text-ink-soft' : 'text-ink', strong && 'font-extrabold')}>
      <span className="flex min-w-0 items-center gap-1">{label}</span>
      <span className="vh-num shrink-0 whitespace-nowrap">{value}</span>
    </div>
  )
}

// ───────────────────────── Formulario ─────────────────────────

export function SaleFormModal({
  open,
  sale,
  presetEventId,
  presetClientId,
  presetTickets,
  onClose,
  onSaved,
}: {
  open: boolean
  /** Si viene, es "Editar venta". */
  sale?: SaleDetail | null
  /** ?evento=ID: preselecciona el evento y el canal "Eventos". */
  presetEventId?: number | null
  /** ?cliente=ID (desde la ficha del cliente): preselecciona el cliente. */
  presetClientId?: number | null
  /** ?entrada=1 (junto con ?evento=ID, «Vender entradas»): arranca con el renglón de entradas del evento. */
  presetTickets?: boolean
  onClose: () => void
  onSaved?: (sale: SaleDetail) => void
}) {
  const { data: settings } = useSettings()
  const productsQ = useProducts()
  const products = useMemo(() => productsQ.data ?? [], [productsQ.data])
  const { data: accounts = [] } = useAccounts()
  const { data: clients = [] } = useClients()
  const eventsQ = useEvents()
  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data])
  const confirm = useConfirm()
  const editing = !!sale
  const presetEvent = !editing && presetEventId ? (events.find((e) => e.id === presetEventId) ?? null) : null

  const feePctOf = (m: string) => settings?.payment_methods.find((x) => x.key === m)?.fee_pct ?? 0
  const methodLabel = (m: string) => settings?.payment_methods.find((x) => x.key === m)?.label || PAYMENT_METHOD_LABELS[m as PaymentMethod] || m
  // Cuenta por defecto: la configurada para ese medio de pago (si sigue activa) o la primera cuenta activa,
  // igual que hace el servidor si no le mandás ninguna.
  const defaultAccountFor = (m: string) => {
    const configured = settings?.payment_methods.find((x) => x.key === m)?.account_id ?? null
    if (configured && accounts.some((a) => a.id === configured && a.active)) return configured
    return accounts.find((a) => a.active)?.id ?? null
  }

  const [f, setF] = useState<FormState>(() => buildInitial(sale, presetEventId, presetClientId, feePctOf, presetEvent, presetTickets))
  const [submitted, setSubmitted] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [editFee, setEditFee] = useState(false)
  const initialRef = useRef('')
  const formRef = useRef<HTMLFormElement>(null)
  const [focusRow, setFocusRow] = useState<number | null>(null)

  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }))
  const setRow = (key: number, patch: Partial<Row>) => setF((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))

  // Al abrir: arrancar de cero (o con los datos de la venta a editar).
  // Al editar esperamos la configuración: hace falta para saber si la comisión fue automática o a mano.
  // Si viene de un evento, esperamos sus datos (fecha, precio de la entrada): es local, tarda un instante.
  const waitSettings = editing && !settings
  const waitEvent = !editing && !!presetEventId && eventsQ.isPending
  useEffect(() => {
    if (!open || waitSettings || waitEvent) return
    const init = buildInitial(sale, presetEventId, presetClientId, feePctOf, presetEvent, presetTickets)
    setF(init)
    initialRef.current = JSON.stringify(init)
    setSubmitted(false)
    setShowNotes(!!init.notes)
    setEditFee(init.feeOverride != null)
    setFocusRow(init.rows[0]?.key ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sale?.id, waitSettings, waitEvent])

  // Llevar el foco al renglón nuevo (así se puede seguir cargando con el teclado).
  useEffect(() => {
    if (focusRow == null || !open) return
    const t = window.setTimeout(() => {
      const row = formRef.current?.querySelector<HTMLElement>(`[data-row="${focusRow}"]`)
      row?.querySelector<HTMLElement>('button[aria-haspopup="listbox"], input')?.focus()
      setFocusRow(null)
    }, 80)
    return () => window.clearTimeout(t)
  }, [focusRow, open])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  // Aviso (no bloquea): venta con fecha anterior al alta de algún vino elegido.
  const beforeAlta = beforeAltaText(
    winesBeforeAlta(
      products,
      f.rows.filter((r) => r.kind === 'wine').map((r) => r.productId),
      f.date,
    ),
    'venta',
  )
  // Al editar, las botellas de esta venta ya salieron del stock: se suman a lo disponible.
  const originalQty = useMemo(() => {
    const m = new Map<number, number>()
    for (const i of sale?.items ?? []) if (i.product_id) m.set(i.product_id, (m.get(i.product_id) ?? 0) + i.qty)
    return m
  }, [sale])
  const originalItem = useMemo(() => new Map((sale?.items ?? []).filter((i) => i.product_id).map((i) => [i.product_id!, i])), [sale])

  // ───── Números en vivo ─────
  const calc = useMemo(() => {
    const used = new Map<number, number>()
    for (const r of f.rows) if (r.kind === 'wine' && r.productId) used.set(r.productId, (used.get(r.productId) ?? 0) + (r.qty ?? 0))
    const subtotal = round2(f.rows.reduce((s, r) => s + (r.qty ?? 0) * (r.price ?? 0), 0))
    const discount = round2(f.discountMode === 'pct' ? (subtotal * (f.discountValue ?? 0)) / 100 : (f.discountValue ?? 0))
    const shipping = round2(f.shipping ?? 0)
    const total = round2(subtotal - discount + shipping)
    const feePct = feePctOf(f.method)
    const autoFee = round2((total * feePct) / 100)
    const fee = f.feeOverride ?? autoFee
    const unitCost = (id: number) => originalItem.get(id)?.unit_cost ?? productById.get(id)?.unit_cost ?? 0
    const cost = round2(f.rows.reduce((s, r) => s + (r.kind === 'wine' && r.productId ? (r.qty ?? 0) * unitCost(r.productId) : 0), 0))
    const bottleCount = f.rows.reduce((s, r) => s + (r.kind === 'wine' && r.productId ? (r.qty ?? 0) : 0), 0)
    const profit = round2(total - fee - cost)
    const available = (id: number) => (productById.get(id)?.stock ?? 0) + (originalQty.get(id) ?? 0)
    const remaining = (id: number) => available(id) - (used.get(id) ?? 0)
    return { subtotal, discount, shipping, total, feePct, autoFee, fee, cost, bottleCount, profit, margin: safeDiv(profit, total), unitCost, available, remaining }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, productById, originalQty, originalItem, settings])

  const accountId = f.accountTouched ? f.accountId : (defaultAccountFor(f.method) ?? f.accountId)
  // La venta quedó con la fecha de un evento que ya pasó (la ponemos así al venir desde su ficha).
  const dateEvent = events.find((e) => e.id === f.eventId && e.date === f.date && e.date < today()) ?? null
  const client = clients.find((c) => c.id === f.clientId)
  const suggestWholesale = f.priceList === 'minorista' && ((client && WHOLESALE_KINDS.includes(client.kind)) || f.channel === 'mayorista')

  // ───── Validación ─────
  const filled = f.rows.filter((r) => !isEmptyRow(r))
  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!f.date) e.date = 'Poné la fecha de la venta.'
    // Un renglón con precio o cantidad pero sin vino (o sin descripción) nunca se descarta en silencio.
    for (const r of f.rows) {
      if (isEmptyRow(r) && hasRowData(r)) {
        e[`what-${r.key}`] =
          r.kind === 'wine'
            ? 'Este renglón tiene cantidad o precio pero no dice qué vino es: elegí el vino o borralo con el tachito.'
            : 'Este renglón tiene cantidad o precio pero no dice qué es: escribí qué vendiste o borralo con el tachito.'
      }
    }
    if (!filled.length && !Object.keys(e).some((k) => k.startsWith('what-'))) e.items = 'Elegí al menos un vino (o agregá un ítem que no sea vino).'
    for (const r of filled) {
      if (!r.qty || r.qty < 1) e[`qty-${r.key}`] = 'La cantidad tiene que ser 1 o más.'
      else if (r.qty > 1_000_000) e[`qty-${r.key}`] = 'Esa cantidad es demasiado grande. Revisala.'
      if (r.price == null) e[`price-${r.key}`] = 'Poné el precio (puede ser $ 0 si va sin cargo).'
      else if (r.price < 0) e[`price-${r.key}`] = 'El precio no puede ser negativo. Si es una devolución, borrá o editá la venta original.'
    }
    if ((f.discountValue ?? 0) < 0) e.discount = 'El descuento no puede ser negativo.'
    else if (f.discountMode === 'pct' && (f.discountValue ?? 0) > 100) e.discount = 'El descuento no puede pasar el 100 %.'
    else if (calc.discount > calc.subtotal + calc.shipping + 0.001) e.discount = 'El descuento no puede ser mayor que la venta.'
    if ((f.shipping ?? 0) < 0) e.shipping = 'El envío no puede ser negativo.'
    if ((f.feeOverride ?? 0) < 0) e.fee = 'La comisión no puede ser negativa.'
    if (f.paid === 'si' && calc.total > 0 && !accountId) e.account = 'Elegí en qué cuenta entró la plata.'
    if (sale && sale.status === 'parcial' && f.paid === 'no' && calc.total < sale.paid - 0.01) {
      e.paid = `Ya cobraste ${money(sale.paid)} de esta venta: el total no puede quedar por debajo. Marcala como cobrada o borrá algún cobro desde el detalle.`
    }
    return e
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, calc, accountId, sale])
  const shownErrors = submitted ? errors : {}
  const dirty = open && JSON.stringify(f) !== initialRef.current

  // ───── Guardar ─────
  const save = useApiMutation(
    (vars: { again: boolean }) => {
      const payload = {
        date: f.date,
        client_id: f.clientId,
        channel: f.channel,
        price_list: f.priceList,
        payment_method: f.method,
        items: filled.map((r) =>
          r.kind === 'wine'
            ? { product_id: r.productId, description: null, qty: r.qty ?? 1, unit_price: r.price ?? 0 }
            : { product_id: null, description: r.description.trim(), qty: r.qty ?? 1, unit_price: r.price ?? 0 },
        ),
        discount: calc.discount,
        shipping: calc.shipping,
        fee: f.feeOverride,
        due_date: f.paid === 'no' ? f.dueDate || null : null,
        event_id: f.eventId,
        notes: f.notes.trim() || null,
        paid: f.paid === 'si',
        account_id: f.paid === 'si' ? accountId : null,
      }
      return sale ? api.put<SaleDetail>(`/sales/${sale.id}`, payload) : api.post<SaleDetail>('/sales', payload)
    },
    {
      success: (res) => (sale ? `Venta #${res.id} actualizada` : `Venta guardada (#${res.id} · ${money(res.total)})`),
      onSuccess: (res, vars) => {
        if (vars.again) {
          // "Guardar y cargar otra": se mantiene fecha, canal, evento y cómo te pagan.
          const next: FormState = {
            ...f,
            rows: [newRow()],
            clientId: null,
            discountMode: 'amount',
            discountValue: null,
            shipping: null,
            dueDate: '',
            notes: '',
            feeOverride: null,
          }
          setF(next)
          initialRef.current = JSON.stringify(next)
          setSubmitted(false)
          setShowNotes(false)
          setEditFee(false)
          setFocusRow(next.rows[0].key)
        } else {
          onSaved?.(res)
          onClose()
        }
      },
    },
  )

  const submit = (again = false) => {
    setSubmitted(true)
    if (Object.keys(errors).length) {
      window.setTimeout(() => formRef.current?.querySelector('[data-error="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30)
      return
    }
    if (!save.isPending) save.mutate({ again })
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(false)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit(false)
    }
  }

  const requestClose = async () => {
    if (save.isPending) return
    if (dirty) {
      const ok = await confirm({
        title: '¿Salís sin guardar?',
        message: 'Lo que cargaste en esta venta se pierde.',
        confirmText: 'Sí, salir sin guardar',
        cancelText: 'Seguir cargando',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }

  // ───── Acciones sobre renglones ─────
  const addRow = (kind: RowKind) => {
    const r = newRow(kind)
    setF((s) => ({ ...s, rows: [...s.rows, r] }))
    setFocusRow(r.key)
  }
  const removeRow = (key: number) =>
    setF((s) => {
      if (s.rows.length > 1) return { ...s, rows: s.rows.filter((r) => r.key !== key) }
      return { ...s, rows: [newRow()] }
    })
  const changePriceList = (list: PriceList) =>
    setF((s) => ({
      ...s,
      priceList: list,
      rows: s.rows.map((r) => {
        const p = r.productId ? productById.get(r.productId) : undefined
        return r.kind === 'wine' && r.autoPrice && p ? { ...r, price: priceFor(p, list) } : r
      }),
    }))

  const paidOptions = [
    { value: 'si' as const, title: 'Sí, ya está cobrada', description: 'La plata entra en la cuenta que elijas, con la fecha de la venta.', icon: Banknote },
    { value: 'no' as const, title: 'No, me la pagan después', description: 'Queda en «Por cobrar» hasta que registres el cobro.', icon: Clock },
  ]

  const editPaidNote = (() => {
    if (!sale) return null
    if (sale.status === 'pagado' && f.paid === 'no')
      return { tone: 'warn', text: `Esta venta figura cobrada. Si elegís «No», se borran sus cobros (${money(sale.paid)}) de la caja y vuelve a quedar por cobrar.` }
    if (sale.status === 'pagado' && f.paid === 'si') {
      const totalChanged = Math.abs(calc.total - sale.total) > 0.01
      const accountChanged = sale.payments.length > 0 && accountId !== sale.payments[0].account_id
      if (totalChanged || accountChanged)
        return {
          tone: 'info',
          text: `Sigue cobrada. Como cambiaste ${totalChanged ? 'el total' : 'la cuenta'}, los cobros anteriores se reemplazan por uno solo de ${money(calc.total)}, con la fecha de la venta y en la cuenta elegida.`,
        }
      return { tone: 'info', text: 'Sigue cobrada: los cobros quedan como estaban (mismas fechas y cuentas).' }
    }
    if (sale.status === 'parcial' && f.paid === 'si')
      return { tone: 'info', text: `Tenía cobros parciales por ${money(sale.paid)}. Al marcarla cobrada se reemplazan por un único cobro por el total, en la cuenta que elijas.` }
    if (sale.status === 'parcial' && f.paid === 'no') return { tone: 'info', text: `Se mantienen los cobros que ya registraste (${money(sale.paid)}). El resto queda por cobrar.` }
    return null
  })()

  const marginPer100 = Math.round(calc.margin * 100)

  return (
    <Modal
      open={open}
      onClose={requestClose}
      size="xl"
      dismissable={!dirty}
      title={editing ? `Editar venta #${sale!.id}` : 'Nueva venta'}
      subtitle={
        editing
          ? `Del ${fmtDate(sale!.date)}. Cambiá lo que necesites: el stock, la caja y la ganancia se recalculan solos.`
          : 'Elegí los vinos, cuántos y cómo te pagan. El resto lo calcula el sistema.'
      }
      footer={
        <>
          <div className="mr-auto min-w-0 lg:hidden">
            <span className="text-[13px] font-bold text-ink-soft">Total </span>
            <span className="vh-num text-lg font-extrabold text-ink">{money(calc.total)}</span>
          </div>
          <Button variant="ghost" onClick={requestClose} disabled={save.isPending}>
            Cancelar
          </Button>
          {!editing && (
            <Button onClick={() => submit(true)} disabled={save.isPending} title="Guarda esta venta y deja el formulario listo para la próxima">
              Guardar y cargar otra
            </Button>
          )}
          <Button variant="primary" type="submit" form="sale-form" loading={save.isPending}>
            {editing ? 'Guardar cambios' : 'Guardar venta'}
          </Button>
        </>
      }
    >
      <form id="sale-form" ref={formRef} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
          <div className="min-w-0 space-y-7">
            {/* 1 · Vinos */}
            <section>
              <SectionTitle
                n={1}
                right={
                  <div className="flex items-center gap-1.5">
                    <Segmented
                      size="sm"
                      label="Lista de precios"
                      value={f.priceList}
                      onChange={changePriceList}
                      options={[
                        { value: 'minorista', label: 'Precio minorista', title: 'Precio de góndola, para consumidor final' },
                        { value: 'mayorista', label: 'Mayorista', title: 'Precio para restós, vinotecas y distribuidores' },
                      ]}
                    />
                    <InfoTip
                      title="Minorista o mayorista"
                      text="Elige qué precio se completa solo en cada vino (los que cargaste en «Vinos y stock»). Si cambiás de lista, se actualizan los precios que no tocaste a mano."
                    />
                  </div>
                }
              >
                ¿Qué vendiste?
              </SectionTitle>

              {productsQ.isSuccess && products.length === 0 && (
                <div className="mb-3 rounded-xl border border-mustard/60 bg-mustard-soft/70 px-3.5 py-2.5 text-[14px] text-ink">
                  Todavía no cargaste ningún vino. Cargalos en{' '}
                  <Link to="/vinos?nuevo=1" className="font-bold text-sky-deep hover:underline">
                    Vinos y stock
                  </Link>{' '}
                  para que cada venta descuente botellas y calcule su costo. Mientras tanto podés cargar un ítem que no sea vino.
                </div>
              )}
              {suggestWholesale && (
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-sky/50 bg-sky-soft/70 px-3.5 py-2.5 text-[14px] text-ink">
                  <span className="min-w-0 flex-1">
                    {client && WHOLESALE_KINDS.includes(client.kind)
                      ? `${client.name} es ${CLIENT_KIND_LABELS[client.kind].toLowerCase()}: ¿le cobrás precio mayorista?`
                      : 'Es una venta mayorista: ¿usás el precio mayorista?'}
                  </span>
                  <Button size="sm" onClick={() => changePriceList('mayorista')}>
                    Usar precio mayorista
                  </Button>
                </div>
              )}

              <div className="mb-1.5 hidden gap-2 px-0.5 text-[12.5px] font-extrabold tracking-wide text-ink-soft uppercase sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_8.25rem_6rem_2.25rem]">
                <span>Vino</span>
                <span className="text-center">Cantidad</span>
                <span className="text-right">Precio unitario</span>
                <span className="text-right">Subtotal</span>
                <span />
              </div>

              <ul className="space-y-3">
                {f.rows.map((r, idx) => {
                  const p = r.productId ? productById.get(r.productId) : undefined
                  const rowSub = round2((r.qty ?? 0) * (r.price ?? 0))
                  const rem = r.productId ? calc.remaining(r.productId) : 0
                  const cost = r.productId ? calc.unitCost(r.productId) : 0
                  const qtyErr = shownErrors[`qty-${r.key}`]
                  const priceErr = shownErrors[`price-${r.key}`]
                  const whatErr = shownErrors[`what-${r.key}`]
                  const emptyErr = (submitted && shownErrors.items && idx === 0) || !!whatErr
                  const inactiveName = r.productId && !p ? originalItem.get(r.productId)?.product_name : null
                  return (
                    <li key={r.key} data-row={r.key} data-error={!!(qtyErr || priceErr || emptyErr)} className="rounded-2xl border border-line bg-paper p-3 sm:border-0 sm:bg-transparent sm:p-0">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_8.25rem_6rem_2.25rem] sm:items-start">
                        <div className="min-w-0">
                          {r.kind === 'wine' ? (
                            <ProductSelect
                              value={r.productId}
                              priceList={f.priceList}
                              invalid={!!emptyErr}
                              onChange={(id, prod) =>
                                setRow(r.key, { productId: id, price: prod ? priceFor(prod, f.priceList) : r.price, autoPrice: true })
                              }
                            />
                          ) : (
                            <TextInput
                              aria-label="Descripción del ítem"
                              aria-invalid={!!emptyErr || undefined}
                              value={r.description}
                              onChange={(e) => setRow(r.key, { description: e.target.value })}
                              placeholder="Ej: Entrada degustación, Caja de regalo"
                              maxLength={200}
                            />
                          )}
                        </div>
                        <div className="grid grid-cols-[7rem_minmax(0,1fr)_2.25rem] gap-2 sm:contents">
                          <QtyStepper value={r.qty} onChange={(v) => setRow(r.key, { qty: v })} invalid={!!qtyErr} />
                          <MoneyInput
                            aria-label="Precio unitario"
                            aria-invalid={!!priceErr || undefined}
                            value={r.price}
                            onChange={(v) => setRow(r.key, { price: v, autoPrice: false })}
                          />
                          <div className="vh-num hidden h-11 items-center justify-end font-bold whitespace-nowrap text-ink sm:flex">{money(rowSub)}</div>
                          <button
                            type="button"
                            onClick={() => removeRow(r.key)}
                            aria-label={f.rows.length > 1 ? 'Quitar este renglón' : 'Vaciar este renglón'}
                            title={f.rows.length > 1 ? 'Quitar' : 'Vaciar'}
                            className="grid h-11 w-9 place-items-center rounded-full text-muted hover:bg-bad-soft hover:text-bad"
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </div>
                      {/* Ayudas debajo del renglón */}
                      <div className="mt-1.5 space-y-0.5 px-0.5 text-[12.5px] leading-snug">
                        {r.kind === 'wine' && p && (
                          <p className="text-muted">
                            Hay {fmtBottles(calc.available(p.id))} en stock · te cuesta {money(cost, { decimals: 0 })} c/u
                            {priceFor(p, f.priceList) === 0 && ' · este vino no tiene precio cargado'}
                            <span className="sm:hidden"> · subtotal {money(rowSub)}</span>
                          </p>
                        )}
                        {r.kind === 'wine' && inactiveName && <p className="text-muted">{inactiveName} (vino desactivado)</p>}
                        {r.kind === 'wine' && p && rem < 0 && (
                          <p className="flex items-start gap-1 font-semibold text-warn">
                            <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />
                            Ojo: te quedarían −{Math.abs(rem)} {Math.abs(rem) === 1 ? 'botella' : 'botellas'}. ¿Cargaste todas las compras? Igual podés guardar la venta.
                          </p>
                        )}
                        {r.kind === 'wine' && p && rem >= 0 && rem <= p.min_stock && (r.qty ?? 0) > 0 && (
                          <p className="text-warn">Después de esta venta quedan {fmtBottles(rem)}: conviene reponer.</p>
                        )}
                        {r.kind === 'wine' && p && r.price != null && r.price > 0 && r.price < cost && (
                          <p className="font-semibold text-warn">Lo estás vendiendo por debajo de lo que te costó ({money(cost, { decimals: 0 })}).</p>
                        )}
                        {r.kind === 'other' && (
                          <p className="text-muted">
                            No es un vino del stock: no descuenta botellas ni suma costo.
                            <span className="sm:hidden"> Subtotal {money(rowSub)}</span>
                          </p>
                        )}
                        {whatErr && <p className="font-semibold text-bad">{whatErr}</p>}
                        {qtyErr && <p className="font-semibold text-bad">{qtyErr}</p>}
                        {priceErr && <p className="font-semibold text-bad">{priceErr}</p>}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {shownErrors.items && (
                <p className="mt-2 text-[13px] font-semibold text-bad" data-error="true">
                  {shownErrors.items}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" icon={Wine} onClick={() => addRow('wine')}>
                  Agregar otro vino
                </Button>
                <Button size="sm" variant="ghost" icon={PackagePlus} onClick={() => addRow('other')}>
                  Agregar otro ítem (no es vino)
                </Button>
              </div>
            </section>

            {/* 2 · Datos */}
            <section>
              <SectionTitle n={2}>¿Cuándo, a quién y por dónde?</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Fecha"
                  required
                  error={shownErrors.date}
                  hint={
                    beforeAlta ? (
                      <span className="font-semibold text-warn" data-testid="before-alta">
                        {beforeAlta}
                      </span>
                    ) : f.date > today() ? (
                      'Ojo: es una fecha futura. Si la venta ya se hizo, poné el día que vendiste.'
                    ) : dateEvent ? (
                      `Es el día del evento «${dateEvent.name}» (${dateShort(dateEvent.date)}). Si vendiste otro día, cambiala.`
                    ) : (
                      'Si la cargás tarde, poné el día que vendiste.'
                    )
                  }
                >
                  <DateInput value={f.date} onChange={(v) => set({ date: v })} max="2100-12-31" />
                </Field>
                <Field label="Canal" hint="Por dónde vino la venta. Sirve para ver qué canal te conviene.">
                  <Select
                    value={f.channel}
                    onChange={(v) => set({ channel: v as SaleChannel })}
                    options={SALE_CHANNELS.map((c) => ({ value: c, label: SALE_CHANNEL_LABELS[c] }))}
                  />
                </Field>
                <Field label="Cliente" hint="Opcional. Si no elegís, queda «Consumidor final». Escribí un nombre nuevo para agregarlo.">
                  <ClientSelect value={f.clientId} onChange={(id) => set({ clientId: id })} placeholder="Consumidor final" />
                </Field>
                <Field label="Evento" hint="Opcional: para saber cuánto vendiste en cada degustación o feria.">
                  <EventSelect
                    value={f.eventId}
                    onChange={(id) => setF((s) => ({ ...s, eventId: id, channel: id && s.channel === 'local' ? 'eventos' : s.channel }))}
                  />
                </Field>
              </div>
            </section>

            {/* 3 · Descuento y envío */}
            <section>
              <SectionTitle n={3}>Descuento y envío</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Descuento"
                  error={shownErrors.discount}
                  hint={
                    f.discountMode === 'pct' && calc.discount > 0
                      ? `Son ${money(calc.discount)} de descuento sobre ${money(calc.subtotal)}.`
                      : 'Opcional. En pesos o en % sobre lo que suman los vinos e ítems.'
                  }
                >
                  <div className="flex items-center gap-2" data-error={!!shownErrors.discount}>
                    <Segmented
                      size="sm"
                      label="Descuento en pesos o porcentaje"
                      value={f.discountMode}
                      onChange={(m) => set({ discountMode: m, discountValue: null })}
                      options={[
                        { value: 'amount', label: '$', title: 'Descuento en pesos' },
                        { value: 'pct', label: '%', title: 'Descuento en porcentaje' },
                      ]}
                    />
                    {f.discountMode === 'amount' ? (
                      <MoneyInput aria-label="Descuento en pesos" className="flex-1" value={f.discountValue} onChange={(v) => set({ discountValue: v })} />
                    ) : (
                      <NumberInput aria-label="Descuento en porcentaje" className="flex-1" decimals={2} suffix="%" placeholder="0" value={f.discountValue} onChange={(v) => set({ discountValue: v })} />
                    )}
                  </div>
                </Field>
                <Field label="Envío cobrado" error={shownErrors.shipping} hint="Lo que le cobrás al cliente por el envío. Lo que te cobra el correo cargalo en Gastos.">
                  <MoneyInput value={f.shipping} onChange={(v) => set({ shipping: v })} aria-invalid={!!shownErrors.shipping || undefined} data-error={!!shownErrors.shipping} />
                </Field>
              </div>
            </section>

            {/* 4 · Cobro */}
            <section>
              <SectionTitle n={4}>¿Cómo te paga?</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Medio de pago"
                  hint={f.paid === 'no' ? 'Cómo te va a pagar. Si todavía no sabés, dejalo: cuando registres el cobro elegís el medio real y se descuenta su comisión.' : undefined}
                >
                  <Select
                    value={f.method}
                    onChange={(v) => set({ method: v as PaymentMethod })}
                    options={(settings?.payment_methods.map((m) => m.key) ?? [...PAYMENT_METHODS]).map((m) => ({ value: m, label: methodLabel(m) }))}
                  />
                </Field>
                <div className="flex min-w-0 flex-col justify-end gap-1.5 sm:pb-0.5">
                  {editFee ? (
                    <Field
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          Comisión (a mano) <InfoTip term="comisiones" />
                        </span>
                      }
                      error={shownErrors.fee}
                      hint={
                        <button
                          type="button"
                          className="font-bold text-sky-deep hover:underline"
                          onClick={() => {
                            set({ feeOverride: null })
                            setEditFee(false)
                          }}
                        >
                          Volver a la automática ({money(calc.autoFee, { decimals: 0 })})
                        </button>
                      }
                    >
                      <MoneyInput value={f.feeOverride} onChange={(v) => set({ feeOverride: v ?? 0 })} aria-invalid={!!shownErrors.fee || undefined} data-error={!!shownErrors.fee} />
                    </Field>
                  ) : (
                    <div className="rounded-xl bg-cream-deep px-3.5 py-2.5 text-[14px] text-ink">
                      <p>
                        {calc.feePct > 0 ? (
                          <>
                            {methodLabel(f.method)} se queda ≈ <b className="vh-num whitespace-nowrap">{money(calc.fee, { decimals: 0 })}</b>{' '}
                            <span className="whitespace-nowrap">({pct(calc.feePct / 100, 2)})</span>
                          </>
                        ) : (
                          <>{methodLabel(f.method)} no cobra comisión.</>
                        )}
                        <InfoTip term="comisiones" className="ml-1.5 align-[-2px]" />
                      </p>
                      {f.method !== 'efectivo' && (
                        <button
                          type="button"
                          className="text-[13px] font-bold text-sky-deep hover:underline"
                          onClick={() => {
                            set({ feeOverride: calc.autoFee })
                            setEditFee(true)
                          }}
                        >
                          ¿Te cobraron otra cosa? Cambiala
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-[14px] font-bold text-ink">¿Ya la cobraste?</p>
                <ChoiceCards value={f.paid} onChange={(v) => set({ paid: v })} options={paidOptions} />
                {editPaidNote && (
                  <p
                    className={clsx(
                      'mt-2 rounded-xl px-3.5 py-2.5 text-[13.5px]',
                      editPaidNote.tone === 'warn' ? 'bg-warn-soft font-semibold text-ink' : 'bg-cream-deep text-ink-soft',
                    )}
                  >
                    {editPaidNote.text}
                  </p>
                )}
                {shownErrors.paid && (
                  <p className="mt-2 text-[13px] font-semibold text-bad" data-error="true">
                    {shownErrors.paid}
                  </p>
                )}
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {f.paid === 'si' ? (
                    <Field label="¿Dónde entró la plata?" required error={shownErrors.account} hint="Por defecto, la cuenta de ese medio de pago (se cambia en Configuración).">
                      <div data-error={!!shownErrors.account}>
                        <AccountSelect value={accountId} onChange={(id) => set({ accountId: id, accountTouched: true })} placeholder="Elegí una cuenta…" />
                      </div>
                    </Field>
                  ) : (
                    <Field label="¿Para cuándo te la pagan? (opcional)" hint="Si ponés fecha, te avisamos cuando se venza.">
                      <DateInput value={f.dueDate} onChange={(v) => set({ dueDate: v })} min={f.date || undefined} />
                    </Field>
                  )}
                </div>
              </div>
            </section>

            {/* Notas */}
            <section>
              {showNotes ? (
                <Field label="Nota (opcional)" hint="Ej: «Retira el sábado», «Pidió factura A».">
                  <Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={2000} rows={2} />
                </Field>
              ) : (
                <Button size="sm" variant="ghost" icon={StickyNote} onClick={() => setShowNotes(true)}>
                  Agregar una nota
                </Button>
              )}
            </section>
          </div>

          {/* Resumen en vivo */}
          <aside className="min-w-0 self-start lg:sticky lg:top-0">
            <div className="rounded-2xl border border-line bg-paper p-4 shadow-[var(--shadow-card)]">
              <p className="vh-label mb-2">Resumen de la venta</p>
              <SummaryLine label={`Vinos e ítems${calc.bottleCount ? ` (${fmtBottles(calc.bottleCount)})` : ''}`} value={money(calc.subtotal)} />
              {calc.discount > 0 && <SummaryLine label="Descuento" value={`− ${money(calc.discount)}`} />}
              {calc.shipping > 0 && <SummaryLine label="Envío cobrado" value={`+ ${money(calc.shipping)}`} />}
              <div className="my-2 border-y border-line py-3">
                <p className="text-[13px] font-bold text-ink-soft">Total que paga el cliente</p>
                <p className="vh-num text-[2.1rem] leading-tight font-extrabold tracking-tight text-ink">{money(calc.total)}</p>
              </div>
              <SummaryLine
                muted
                label={
                  <>
                    Costo del vino
                    <InfoTip
                      title="Costo del vino"
                      text="Lo que te costó cada botella (costo promedio de tus compras, con flete). Se congela el día de la venta: si mañana el vino aumenta, esta venta mantiene su ganancia real."
                    />
                  </>
                }
                value={`− ${money(calc.cost, { decimals: 0 })}`}
              />
              <SummaryLine
                muted
                label={
                  <>
                    Comisión <InfoTip term="comisiones" />
                  </>
                }
                value={`− ${money(calc.fee, { decimals: 0 })}`}
              />
              <div className={clsx('mt-2 rounded-xl p-3', calc.total <= 0 ? 'bg-cream-deep' : calc.profit < 0 ? 'bg-bad-soft' : 'bg-good-soft/80')}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-1 font-extrabold text-ink">
                    Te queda
                    <InfoTip
                      title="Te queda (ganancia de la venta)"
                      text="Total − costo de las botellas − comisión. Todavía no descuenta los gastos fijos del negocio (alquiler, sueldos): eso lo ves en Reportes."
                    />
                  </span>
                  <span className={clsx('vh-num text-[1.35rem] font-extrabold', calc.total <= 0 ? 'text-ink-soft' : calc.profit < 0 ? 'text-bad' : 'text-good')}>
                    {money(calc.profit, { decimals: 0 })}
                  </span>
                </div>
                <p className="text-[13px] text-ink-soft">
                  {calc.total > 0 ? <>Es el <b className="text-ink">{pct(calc.margin)}</b> del total</> : '—'}
                </p>
              </div>
              <p className="mt-2.5 text-[12.5px] leading-snug text-muted">
                {calc.total > 0
                  ? calc.profit >= 0
                    ? `De cada $ 100 que cobrás te quedan $ ${marginPer100} para pagar los gastos del negocio y ganar.`
                    : 'Con estos precios perdés plata en esta venta: revisá el precio o el descuento.'
                  : 'Elegí un vino y vas a ver acá cuánto te deja la venta.'}
              </p>
            </div>
            <p className="mt-3 hidden text-center text-[12px] text-muted lg:block">
              Atajo: <kbd className="rounded border border-line-strong bg-paper px-1 font-sans">Ctrl</kbd> + <kbd className="rounded border border-line-strong bg-paper px-1 font-sans">Enter</kbd> guarda
            </p>
          </aside>
        </div>
      </form>
    </Modal>
  )
}
