// Formulario de compra de vino (nueva o editar).
// Se piensa como la factura que te dio la bodega: a quién, qué vinos, cuántas botellas, a cuánto,
// cuánto salió el flete y si ya la pagaste. Mientras cargás se ve, en vivo:
//   - el costo REAL de cada botella (precio + su parte del flete),
//   - cómo cambia el costo promedio de cada vino,
//   - y que esto NO es un gasto: es plata que se transforma en stock.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AlertTriangle, ArrowRight, Banknote, CalendarClock, ExternalLink, Plus, StickyNote, Trash2, Wine } from 'lucide-react'
import clsx from 'clsx'
import { round2, safeDiv } from '@shared/calc'
import { addDays, today } from '@shared/dates'
import type { AccountWithBalance, Product } from '@shared/types'
import { api } from '@/lib/api'
import { boxes, bottles as fmtBottles, date as fmtDate, dateShort, int, money, pct } from '@/lib/format'
import { beforeAltaText, winesBeforeAlta } from '@/lib/alta'
import { useApi, useApiMutation, useSettings } from '@/lib/queries'
import {
  AccountSelect,
  Button,
  ChoiceCards,
  DateInput,
  EmptyState,
  Field,
  InfoTip,
  IntInput,
  Modal,
  MoneyInput,
  ProductSelect,
  SupplierSelect,
  TextInput,
  Textarea,
  useConfirm,
} from '@/components/ui'
import { SectionTitle, SummaryLine } from './parts'
import { landedCosts, newAverageCost, type LastPrice, type PurchaseDetailOut } from './types'

// ───────────────────────── Estado del formulario ─────────────────────────

interface Row {
  key: number
  productId: number | null
  qty: number | null
  /** Precio por botella según la factura. */
  cost: number | null
  /** true = el costo lo completó el sistema (costo actual del vino); se reemplaza si cambiás de vino. */
  autoCost: boolean
}

interface FormState {
  supplierId: number | null
  date: string
  invoice: string
  rows: Row[]
  shipping: number | null
  paid: 'si' | 'no'
  accountId: number | null
  accountTouched: boolean
  dueDate: string
  notes: string
}

let rowSeq = 0
const newRow = (productId: number | null = null): Row => ({ key: ++rowSeq, productId, qty: null, cost: null, autoCost: true })

const DUE_PRESETS = [15, 30, 60]

function initialState(purchase: PurchaseDetailOut | null, presetSupplierId: number | null): FormState {
  if (purchase) {
    return {
      supplierId: purchase.supplier_id,
      date: purchase.date,
      invoice: purchase.invoice_number ?? '',
      rows: purchase.items.map((i) => ({ key: ++rowSeq, productId: i.product_id, qty: i.qty, cost: i.unit_cost, autoCost: false })),
      shipping: purchase.shipping || null,
      paid: purchase.status === 'pagado' ? 'si' : 'no',
      accountId: purchase.payments[0]?.account_id ?? null,
      accountTouched: purchase.payments.length > 0,
      dueDate: purchase.due_date ?? '',
      notes: purchase.notes ?? '',
    }
  }
  const t = today()
  return {
    supplierId: presetSupplierId,
    date: t,
    invoice: '',
    rows: [newRow()],
    shipping: null,
    paid: 'si',
    accountId: null,
    accountTouched: false,
    dueDate: addDays(t, 30),
    notes: '',
  }
}

// ───────────────────────── Formulario ─────────────────────────

export function PurchaseFormModal({
  open,
  purchase,
  presetSupplierId,
  presetProductId,
  onClose,
  onSaved,
}: {
  open: boolean
  /** Si viene, se edita esa compra. */
  purchase: PurchaseDetailOut | null
  /** Proveedor elegido de entrada (?proveedor=ID, desde la ficha del proveedor). */
  presetSupplierId?: number | null
  /** Vino elegido de entrada (?vino=ID, para "reponer" desde Vinos). */
  presetProductId?: number | null
  onClose: () => void
  onSaved?: (p: PurchaseDetailOut) => void
}) {
  const editing = !!purchase
  // Solo se piden los datos con el formulario abierto (mismas claves que useProducts/useAccounts: comparten caché).
  const { data: products = [], isLoading: productsLoading } = useApi<Product[]>('/products', { active: 1 }, { enabled: open })
  const { data: settings } = useSettings()
  const { data: accounts, isError: accountsError } = useApi<AccountWithBalance[]>('/accounts', undefined, { enabled: open, retry: false })
  const confirm = useConfirm()
  const [f, setF] = useState<FormState>(() => initialState(purchase, presetSupplierId ?? null))
  const [submitted, setSubmitted] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const initialRef = useRef('')
  const formRef = useRef<HTMLFormElement>(null)

  // Al abrir: arrancar de cero (o con los datos de la compra a editar).
  useEffect(() => {
    if (!open) return
    const s = initialState(purchase, presetSupplierId ?? null)
    if (!purchase && presetProductId) s.rows = [newRow(presetProductId)]
    setF(s)
    initialRef.current = JSON.stringify(s)
    setSubmitted(false)
    setShowNotes(!!s.notes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, purchase?.id])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  // Aviso (no bloquea): compra con fecha anterior al alta de algún vino elegido.
  const beforeAlta = beforeAltaText(
    winesBeforeAlta(
      products,
      f.rows.map((r) => r.productId),
      f.date,
    ),
    'compra',
  )
  const originalItem = useMemo(() => new Map((purchase?.items ?? []).map((i) => [i.product_id, i])), [purchase])

  // Precio sugerido para cada vino: el de su última factura (mejor si es del mismo proveedor).
  // No usamos el costo promedio como primera opción porque ya incluye el flete de compras anteriores:
  // si lo tomáramos como precio de factura, el flete se contaría dos veces y el costo subiría solo.
  const lastPricesQ = useApi<LastPrice[]>('/purchases/last-prices', f.supplierId ? { supplier_id: f.supplierId } : undefined, { enabled: open && !editing })
  const lastByProduct = useMemo(() => new Map((lastPricesQ.data ?? []).map((l) => [l.product_id, l])), [lastPricesQ.data])
  const suggestedCost = (productId: number | null, prod?: Product | null): number | null => {
    if (productId == null) return null
    const last = lastByProduct.get(productId)
    if (last) return round2(last.unit_cost)
    const p = prod ?? productById.get(productId)
    return p && p.unit_cost > 0 ? round2(p.unit_cost) : null
  }

  // Completar (o actualizar) el precio sugerido de los renglones que no tocaste: cuando llegan los datos,
  // cuando viene un vino preseleccionado (?vino=ID) o cuando cambiás de proveedor.
  useEffect(() => {
    if (!open || editing || lastPricesQ.isFetching) return
    setF((s) => {
      let changed = false
      const rows = s.rows.map((r) => {
        if (!r.autoCost || r.productId == null) return r
        const next = suggestedCost(r.productId)
        if (next != null && next !== r.cost) {
          changed = true
          return { ...r, cost: next }
        }
        return r
      })
      if (!changed) return s
      const next = { ...s, rows }
      // Si todavía no tocaste nada, completar el precio solo no cuenta como "cambio sin guardar".
      if (JSON.stringify(s) === initialRef.current) initialRef.current = JSON.stringify(next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productById, lastByProduct, lastPricesQ.isFetching])

  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }))
  const setRow = (key: number, patch: Partial<Row>) => setF((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))

  // Cuenta por defecto: la configurada para "Transferencia" (así pagás a proveedores casi siempre), o la primera.
  const defaultAccount = settings?.payment_methods.find((m) => m.key === 'transferencia')?.account_id ?? accounts?.find((a) => a.active)?.id ?? null
  const accountId = f.accountTouched ? f.accountId : (f.accountId ?? defaultAccount)
  const accountsAvailable = !!accounts && accounts.length > 0
  const accountName = accounts?.find((a) => a.id === accountId)?.name

  // ───── Cálculos en vivo ─────
  const calc = useMemo(() => {
    const complete = f.rows.filter((r) => r.productId != null && (r.qty ?? 0) >= 1 && r.cost != null)
    const shipping = f.shipping ?? 0
    const subtotal = round2(complete.reduce((s, r) => s + (r.qty ?? 0) * (r.cost ?? 0), 0))
    const bottles = complete.reduce((s, r) => s + (r.qty ?? 0), 0)
    const landed = landedCosts(
      complete.map((r) => ({ qty: r.qty ?? 0, unit_cost: r.cost ?? 0 })),
      shipping,
    )
    const landedByKey = new Map(complete.map((r, i) => [r.key, landed[i]]))
    const total = round2(subtotal + shipping)
    return { complete, shipping, subtotal, bottles, total, landedByKey, avgLanded: safeDiv(total, bottles), freightPct: safeDiv(shipping, subtotal) }
  }, [f.rows, f.shipping])

  const targetMargin = (settings?.pricing.target_margin_pct ?? 40) / 100

  // ───── Validación ─────
  const filled = f.rows.filter((r) => r.productId != null)
  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!f.date) e.date = 'Poné la fecha de la compra (la de la factura o el día que llegó el vino).'
    // Un renglón con botellas o precio pero sin vino nunca se descarta en silencio (el stock y la deuda quedarían mal).
    for (const r of f.rows) {
      if (r.productId == null && (r.qty != null || r.cost != null)) {
        e[`wine-${r.key}`] = 'Este renglón tiene botellas o precio pero no dice qué vino es: elegí el vino o borralo con el tachito.'
      }
    }
    if (!filled.length && !Object.keys(e).some((k) => k.startsWith('wine-'))) e.items = 'Elegí al menos un vino.'
    for (const r of filled) {
      if (!r.qty || r.qty < 1) e[`qty-${r.key}`] = 'Poné cuántas botellas entraron (1 o más).'
      if (r.cost == null) e[`cost-${r.key}`] = 'Poné el precio por botella de la factura (puede ser $ 0 si vino bonificado).'
    }
    if (f.paid === 'si' && calc.total > 0 && accountsAvailable && !accountId) e.account = 'Elegí de qué cuenta salió la plata.'
    if (f.paid === 'no' && f.dueDate && f.date && f.dueDate < f.date) e.dueDate = 'El vencimiento no puede ser antes de la fecha de la compra.'
    if (purchase && purchase.status === 'parcial' && f.paid === 'no' && calc.total < purchase.paid - 0.01) {
      e.paid = `Ya le pagaste ${money(purchase.paid)} de esta compra: el total no puede quedar por debajo. Marcala como pagada o borrá algún pago desde el detalle.`
    }
    return e
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, calc, accountId, accountsAvailable, purchase])
  const shownErrors = submitted ? errors : {}
  const dirty = open && JSON.stringify(f) !== initialRef.current

  // ───── Guardar ─────
  const save = useApiMutation(
    () => {
      const payload = {
        date: f.date,
        supplier_id: f.supplierId,
        invoice_number: f.invoice.trim() || null,
        items: filled.map((r) => ({ product_id: r.productId, qty: r.qty ?? 1, unit_cost: r.cost ?? 0 })),
        shipping: f.shipping ?? 0,
        // Si está pagada, el vencimiento ya no importa, pero no lo borramos al editar (era «a 30 días», por ejemplo).
        due_date: f.paid === 'no' ? f.dueDate || null : (purchase?.due_date ?? null),
        notes: f.notes.trim() || null,
        paid: f.paid === 'si',
        account_id: f.paid === 'si' ? accountId : null,
      }
      return purchase ? api.put<PurchaseDetailOut>(`/purchases/${purchase.id}`, payload) : api.post<PurchaseDetailOut>('/purchases', payload)
    },
    {
      success: (res) =>
        purchase
          ? `Compra #${res.id} actualizada. El stock y el costo de cada vino se recalcularon.`
          : `Compra guardada: entraron ${fmtBottles(res.bottles)} al stock (${money(res.total)}).`,
      onSuccess: (res) => {
        onSaved?.(res)
        onClose()
      },
    },
  )

  const submit = () => {
    setSubmitted(true)
    if (Object.keys(errors).length) {
      window.setTimeout(() => formRef.current?.querySelector('[data-error="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30)
      return
    }
    if (!save.isPending) save.mutate()
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit()
    }
  }

  const requestClose = async () => {
    if (save.isPending) return
    if (dirty) {
      const ok = await confirm({
        title: '¿Salís sin guardar?',
        message: 'Lo que cargaste en esta compra se pierde.',
        confirmText: 'Sí, salir sin guardar',
        cancelText: 'Seguir cargando',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }

  const addRow = () => setF((s) => ({ ...s, rows: [...s.rows, newRow()] }))
  const removeRow = (key: number) => setF((s) => (s.rows.length > 1 ? { ...s, rows: s.rows.filter((r) => r.key !== key) } : { ...s, rows: [newRow()] }))

  const chosenIds = f.rows.map((r) => r.productId).filter((x): x is number => x != null)

  const paidOptions = [
    { value: 'si' as const, title: 'Sí, ya la pagué', description: 'La plata sale de la cuenta que elijas, con la fecha de la compra.', icon: Banknote },
    { value: 'no' as const, title: 'No, la pago después', description: 'Queda en «Por pagar» hasta que registres el pago (se puede pagar en partes).', icon: CalendarClock },
  ]

  const editPaidNote = (() => {
    if (!purchase) return null
    if (purchase.status === 'pagado' && f.paid === 'no')
      return { tone: 'warn', text: `Esta compra figura pagada. Si elegís «No», se borran sus pagos (${money(purchase.paid)}) de la caja y vuelve a quedar por pagar.` }
    if (purchase.status === 'pagado' && f.paid === 'si')
      return {
        tone: 'info',
        text:
          purchase.payments.length > 1
            ? 'Sigue pagada: sus pagos se mantienen con sus fechas. Si cambia el total, se ajusta el último pago.'
            : 'Sigue pagada: el pago se mantiene con su fecha. Si cambia el total, el pago se ajusta solo al nuevo total.',
      }
    if (purchase.status === 'parcial' && f.paid === 'si') {
      const lastDate = purchase.payments[purchase.payments.length - 1]?.date ?? f.date
      const restDate = f.date && lastDate < f.date ? f.date : lastDate
      return {
        tone: 'info',
        text: `Se mantienen los pagos que ya registraste (${money(purchase.paid)}) y se agrega uno por lo que falta (${money(Math.max(calc.total - purchase.paid, 0))}) con fecha ${fmtDate(restDate)}, desde la cuenta que elijas. Si lo pagaste otro día, mejor usá «Registrar pago» desde el detalle.`,
      }
    }
    if (purchase.status === 'parcial' && f.paid === 'no')
      return { tone: 'info', text: `Se mantienen los pagos que ya registraste (${money(purchase.paid)}). El resto queda por pagar.` }
    return null
  })()

  const pastDate = !!f.date && f.date < today()

  return (
    <Modal
      open={open}
      onClose={requestClose}
      size="xl"
      dismissable={!dirty}
      title={editing ? `Editar compra #${purchase!.id}` : 'Nueva compra de vino'}
      subtitle={
        editing
          ? `Del ${fmtDate(purchase!.date)}. Cambiá lo que necesites: el stock, el costo de cada vino y la caja se recalculan solos.`
          : 'Cargala como dice la factura: qué vinos, cuántas botellas y a cuánto. El costo real y el stock se calculan solos.'
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
          <Button variant="primary" type="submit" form="purchase-form" loading={save.isPending}>
            {editing ? 'Guardar cambios' : 'Guardar compra'}
          </Button>
        </>
      }
    >
      <form id="purchase-form" ref={formRef} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
          <div className="min-w-0 space-y-7">
            {/* 1 · Proveedor y factura */}
            <section>
              <SectionTitle n={1}>¿A quién le compraste?</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field className="sm:col-span-2" label="Proveedor" hint="La bodega o distribuidora. Si es nueva, escribí el nombre y tocá «Agregar proveedor».">
                  <SupplierSelect value={f.supplierId} onChange={(id) => set({ supplierId: id })} placeholder="Elegí o escribí un proveedor…" />
                </Field>
                <Field
                  label="Fecha"
                  required
                  error={shownErrors.date}
                  hint={
                    beforeAlta ? (
                      <span className="font-semibold text-warn" data-testid="before-alta">
                        {beforeAlta}
                      </span>
                    ) : (
                      'La de la factura o el día que llegó el vino.'
                    )
                  }
                >
                  <div data-error={!!shownErrors.date}>
                    <DateInput value={f.date} onChange={(v) => set({ date: v })} max="2100-12-31" aria-invalid={!!shownErrors.date || undefined} />
                  </div>
                </Field>
                <Field label="Nº de factura o remito" hint="Opcional. Sirve para encontrarla rápido y para el contador.">
                  <TextInput value={f.invoice} onChange={(e) => set({ invoice: e.target.value })} placeholder="Ej: A-0003-00012345" maxLength={60} />
                </Field>
              </div>
            </section>

            {/* 2 · Vinos */}
            <section>
              <SectionTitle n={2}>¿Qué vinos entraron?</SectionTitle>

              {!productsLoading && products.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line-strong bg-paper">
                  <EmptyState
                    compact
                    icon={Wine}
                    title="Primero cargá tus vinos"
                    action={
                      <a href="/vinos?nuevo=1" target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 font-bold text-sky-deep hover:underline">
                        Cargar un vino en «Vinos y stock» <ExternalLink size={14} aria-hidden />
                      </a>
                    }
                  >
                    Para registrar una compra, el vino tiene que estar en tu catálogo. Se abre en otra pestaña: cargalo, volvé acá y elegilo.
                  </EmptyState>
                </div>
              ) : (
                <>
                  <div className="mb-1.5 hidden gap-2 px-0.5 text-[12.5px] font-extrabold tracking-wide text-ink-soft uppercase sm:grid sm:grid-cols-[minmax(0,1fr)_6.5rem_9rem_6.5rem_2.25rem]">
                    <span>Vino</span>
                    <span className="text-right">Botellas</span>
                    <span className="flex items-center justify-end gap-1">Precio x botella</span>
                    <span className="text-right">Subtotal</span>
                    <span />
                  </div>
                  <ul className="space-y-3">
                    {f.rows.map((r, idx) => {
                      const p = r.productId ? productById.get(r.productId) : undefined
                      const perBox = p?.units_per_box ?? originalItem.get(r.productId ?? -1)?.units_per_box ?? 6
                      const rowSub = round2((r.qty ?? 0) * (r.cost ?? 0))
                      const qtyErr = shownErrors[`qty-${r.key}`]
                      const costErr = shownErrors[`cost-${r.key}`]
                      const wineErr = shownErrors[`wine-${r.key}`]
                      const emptyErr = (!!shownErrors.items && idx === 0) || !!wineErr
                      const inactiveName = r.productId && !p ? originalItem.get(r.productId)?.product_name : null
                      return (
                        <li key={r.key} data-error={!!(qtyErr || costErr || emptyErr)} className="rounded-2xl border border-line bg-paper p-3 sm:border-0 sm:bg-transparent sm:p-0">
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_9rem_6.5rem_2.25rem] sm:items-start">
                            <div className="min-w-0">
                              <ProductSelect
                                value={r.productId}
                                showCost
                                exclude={chosenIds.filter((id) => id !== r.productId)}
                                invalid={emptyErr}
                                placeholder={inactiveName ?? 'Elegí un vino…'}
                                onChange={(id, prod: Product | null) =>
                                  setRow(r.key, {
                                    productId: id,
                                    cost: r.autoCost || r.cost == null ? suggestedCost(id, prod) : r.cost,
                                    autoCost: r.autoCost || r.cost == null,
                                  })
                                }
                              />
                            </div>
                            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.25rem] gap-2 sm:contents">
                              <IntInput
                                aria-label="Botellas"
                                aria-invalid={!!qtyErr || undefined}
                                placeholder="Botellas"
                                value={r.qty}
                                onChange={(v) => setRow(r.key, { qty: v })}
                              />
                              <MoneyInput
                                aria-label="Precio por botella (factura)"
                                aria-invalid={!!costErr || undefined}
                                placeholder="Precio c/u"
                                value={r.cost}
                                onChange={(v) => setRow(r.key, { cost: v, autoCost: false })}
                              />
                              <div className="vh-num hidden h-11 items-center justify-end font-bold whitespace-nowrap text-ink sm:flex">{money(rowSub)}</div>
                              <button
                                type="button"
                                onClick={() => removeRow(r.key)}
                                aria-label={f.rows.length > 1 ? 'Quitar este vino' : 'Vaciar este renglón'}
                                title={f.rows.length > 1 ? 'Quitar' : 'Vaciar'}
                                className="grid h-11 w-9 place-items-center rounded-full text-muted hover:bg-bad-soft hover:text-bad"
                              >
                                <Trash2 size={17} />
                              </button>
                            </div>
                          </div>
                          {/* Ayudas debajo del renglón */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-0.5 text-[12.5px] leading-snug">
                            {p && (
                              <span className="text-muted">
                                Hoy tenés {fmtBottles(p.stock)} · tu costo actual {money(p.unit_cost, { decimals: 0 })}
                              </span>
                            )}
                            {inactiveName && <span className="text-muted">{inactiveName} (vino desactivado)</span>}
                            {r.productId != null && (r.qty ?? 0) >= perBox && perBox > 1 && <span className="font-semibold text-ink-soft">= {boxes(r.qty ?? 0, perBox)}</span>}
                            {r.productId != null && perBox > 1 && (
                              <button
                                type="button"
                                className="font-bold text-sky-deep hover:underline"
                                onClick={() => setRow(r.key, { qty: (r.qty ?? 0) + perBox })}
                                title={`Suma ${perBox} botellas`}
                              >
                                + 1 caja ({perBox})
                              </button>
                            )}
                            <span className="sm:hidden text-muted">Subtotal {money(rowSub)}</span>
                          </div>
                          {p && r.autoCost && r.cost != null && !costErr && (
                            <p className="mt-0.5 px-0.5 text-[12.5px] text-muted">
                              {(() => {
                                const last = lastByProduct.get(p.id)
                                if (last && round2(last.unit_cost) === r.cost)
                                  return `Completamos con el precio de tu última compra${last.same_supplier ? ' a este proveedor' : last.supplier_name ? ` (a ${last.supplier_name})` : ''}, del ${dateShort(last.date)}: si la factura dice otro, cambialo.`
                                return 'Completamos con tu costo actual (ya incluye fletes anteriores): poné el precio de la factura.'
                              })()}
                            </p>
                          )}
                          {r.cost === 0 && r.productId != null && (
                            <p className="mt-0.5 px-0.5 text-[12.5px] text-muted">Va sin cargo (bonificado): solo le toca su parte del flete.</p>
                          )}
                          {wineErr && <p className="mt-0.5 px-0.5 text-[13px] font-semibold text-bad">{wineErr}</p>}
                          {qtyErr && <p className="mt-0.5 px-0.5 text-[13px] font-semibold text-bad">{qtyErr}</p>}
                          {costErr && <p className="mt-0.5 px-0.5 text-[13px] font-semibold text-bad">{costErr}</p>}
                        </li>
                      )
                    })}
                  </ul>
                  {shownErrors.items && (
                    <p className="mt-2 text-[13px] font-semibold text-bad" data-error="true">
                      {shownErrors.items}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Button size="sm" icon={Plus} onClick={addRow}>
                      Agregar otro vino
                    </Button>
                    <a
                      href="/vinos?nuevo=1"
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 text-[13.5px] font-bold text-sky-deep hover:underline"
                      title="Se abre en otra pestaña. Cuando lo cargues, volvé acá y elegilo."
                    >
                      ¿El vino no está en la lista? Cargalo en «Vinos y stock» <ExternalLink size={13} aria-hidden />
                    </a>
                  </div>
                </>
              )}
            </section>

            {/* 3 · Flete */}
            <section>
              <SectionTitle n={3}>Flete y envío</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      Flete / envío <InfoTip term="flete_prorrateado" />
                    </span>
                  }
                  hint="Opcional. Lo que pagaste para que te traigan el vino (si viene en la misma factura o lo pagás aparte por esta compra)."
                >
                  <MoneyInput value={f.shipping} onChange={(v) => set({ shipping: v })} />
                </Field>
                <div className="flex items-end">
                  <p className="w-full rounded-xl bg-cream-deep px-3.5 py-2.5 text-[13.5px] leading-snug text-ink-soft">
                    {calc.shipping > 0 && calc.subtotal > 0 ? (
                      <>
                        El flete encarece cada botella un <b className="text-ink">{pct(calc.freightPct)}</b>. Se reparte según el precio: el vino más caro absorbe más flete. Así tu
                        costo es el real, puesto en tu depósito.
                      </>
                    ) : calc.shipping > 0 ? (
                      <>Como los vinos van sin cargo, el flete se reparte igual entre todas las botellas.</>
                    ) : (
                      <>Si el flete viene en otra factura (de un transporte), cargalo igual acá: forma parte del costo del vino, no es un gasto aparte.</>
                    )}
                  </p>
                </div>
              </div>
            </section>

            {/* 4 · Cómo queda el costo */}
            {calc.complete.length > 0 && (
              <section>
                <SectionTitle
                  n={4}
                  right={
                    <span className="inline-flex items-center gap-1 text-[13px] font-bold text-ink-soft">
                      ¿Cómo se calcula? <InfoTip term="costo_promedio" />
                    </span>
                  }
                >
                  Así queda el costo de cada vino
                </SectionTitle>
                <ul className="divide-y divide-line/70 rounded-2xl border border-line bg-paper">
                  {calc.complete.map((r) => {
                    const p = productById.get(r.productId!)
                    const name = p?.name ?? originalItem.get(r.productId!)?.product_name ?? 'Vino'
                    const landed = calc.landedByKey.get(r.key) ?? r.cost ?? 0
                    const freight = landed - (r.cost ?? 0)
                    const prevAvg = p?.unit_cost ?? 0
                    const stock = p?.stock ?? 0
                    const nextAvg = p ? newAverageCost(stock, prevAvg, r.qty ?? 0, landed) : landed
                    const change = prevAvg > 0 ? (nextAvg - prevAvg) / prevAvg : null
                    const marginAfter = p && p.price_retail > 0 ? safeDiv(p.price_retail - nextAvg, p.price_retail) : null
                    return (
                      <li key={r.key} className="px-4 py-3 text-[14px]">
                        <p className="font-extrabold text-ink">
                          {name} <span className="font-semibold text-muted">· {fmtBottles(r.qty ?? 0)}</span>
                        </p>
                        <p className="mt-0.5 text-ink-soft">
                          Factura {money(r.cost ?? 0)}
                          {freight > 0.004 && <> + flete {money(freight)}</>} = <b className="vh-num text-ink">{money(landed)}</b> por botella{' '}
                          <span className="text-muted">(costo real)</span>
                        </p>
                        {!editing && p && (
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-ink-soft">
                            {stock > 0 && prevAvg > 0 ? (
                              <>
                                Costo promedio: <span className="vh-num">{money(prevAvg)}</span>
                                <ArrowRight size={14} className="text-muted" aria-hidden />
                                <b className="vh-num text-ink">{money(nextAvg)}</b>
                                {change != null && Math.abs(change) >= 0.001 && (
                                  <span className={clsx('rounded-full px-1.5 text-[12px] font-extrabold', change > 0 ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good')}>
                                    {change > 0 ? 'sube' : 'baja'} {pct(Math.abs(change))}
                                  </span>
                                )}
                                <span className="basis-full text-[12.5px] text-muted">
                                  Tenías {int(stock)} a {money(prevAvg, { decimals: 0 })} y entran {int(r.qty ?? 0)} a {money(landed, { decimals: 0 })}: se promedian.
                                </span>
                              </>
                            ) : (
                              <>No tenías botellas en stock: el costo de este vino pasa a ser {money(landed)}.</>
                            )}
                          </p>
                        )}
                        {!editing && marginAfter != null && (
                          <p className={clsx('mt-0.5 text-[12.5px]', marginAfter < targetMargin ? 'font-semibold text-warn' : 'text-muted')}>
                            {marginAfter < targetMargin && <AlertTriangle size={13} className="mr-1 inline align-[-2px]" aria-hidden />}
                            Con tu precio minorista ({money(p!.price_retail, { decimals: 0 })}) el margen queda en {pct(marginAfter)}
                            {marginAfter < targetMargin ? `, menos que tu objetivo (${pct(targetMargin, 0)}): revisá el precio en «Vinos y stock».` : '.'}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-2 text-[12.5px] leading-snug text-muted">
                  {editing
                    ? 'Al guardar, el costo promedio de cada vino se recalcula con toda su historia (compras y ventas en orden de fecha).'
                    : pastDate
                      ? 'La fecha es anterior a hoy: al guardar, el sistema recalcula la historia de cada vino en orden de fecha, así que el promedio final puede variar un poco.'
                      : 'Las ventas que hagas desde ahora usan el costo promedio nuevo. Las ventas anteriores no cambian.'}
                </p>
              </section>
            )}

            {/* 5 · Pago */}
            <section>
              <SectionTitle n={calc.complete.length > 0 ? 5 : 4}>¿Ya la pagaste?</SectionTitle>
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
                  <Field
                    label="¿De dónde salió la plata?"
                    required={accountsAvailable}
                    error={shownErrors.account}
                    hint={
                      accountsAvailable
                        ? 'Por defecto, la cuenta de las transferencias (se cambia en Configuración → Medios de pago).'
                        : accountsError
                          ? 'No pudimos traer tus cuentas: se usa la cuenta configurada para transferencias.'
                          : undefined
                    }
                  >
                    <div data-error={!!shownErrors.account}>
                      <AccountSelect value={accountId} onChange={(id) => set({ accountId: id, accountTouched: true })} placeholder="Elegí una cuenta…" />
                    </div>
                  </Field>
                ) : (
                  <Field label="¿Para cuándo la tenés que pagar?" error={shownErrors.dueDate} hint="Opcional, pero conviene: te avisamos cuando se venza.">
                    <div className="space-y-2" data-error={!!shownErrors.dueDate}>
                      <DateInput value={f.dueDate} onChange={(v) => set({ dueDate: v })} min={f.date || undefined} aria-invalid={!!shownErrors.dueDate || undefined} />
                      <div className="flex flex-wrap gap-1.5">
                        {DUE_PRESETS.map((d) => {
                          const v = f.date ? addDays(f.date, d) : ''
                          const active = !!v && f.dueDate === v
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => set({ dueDate: v })}
                              aria-pressed={active}
                              className={clsx(
                                'rounded-full border px-2.5 py-1 text-[12.5px] font-bold',
                                active ? 'border-ink bg-ink text-cream' : 'border-line-strong bg-paper text-ink-soft hover:border-ink/40 hover:text-ink',
                              )}
                            >
                              A {d} días
                            </button>
                          )
                        })}
                        <button
                          type="button"
                          onClick={() => set({ dueDate: '' })}
                          aria-pressed={!f.dueDate}
                          className={clsx(
                            'rounded-full border px-2.5 py-1 text-[12.5px] font-bold',
                            !f.dueDate ? 'border-ink bg-ink text-cream' : 'border-line-strong bg-paper text-ink-soft hover:border-ink/40 hover:text-ink',
                          )}
                        >
                          Sin fecha
                        </button>
                      </div>
                    </div>
                  </Field>
                )}
              </div>
            </section>

            {/* Notas */}
            <section>
              {showNotes ? (
                <Field label="Nota (opcional)" hint="Ej: «Llegaron 2 botellas rotas, reclamé», «Precio con 5 % de descuento por pago contado».">
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
              <p className="vh-label mb-2">Resumen de la compra</p>
              <SummaryLine label={`Vinos${calc.bottles ? ` (${fmtBottles(calc.bottles)})` : ''}`} value={money(calc.subtotal)} />
              <SummaryLine label="Flete / envío" value={`+ ${money(calc.shipping)}`} muted />
              <div className="my-2 border-y border-line py-3">
                <p className="text-[13px] font-bold text-ink-soft">Total a pagarle al proveedor</p>
                <p className="vh-num text-[2.1rem] leading-tight font-extrabold tracking-tight text-ink">{money(calc.total)}</p>
                {calc.bottles > 0 && (
                  <p className="text-[13px] text-ink-soft">
                    {calc.bottles >= 6 ? `≈ ${boxes(calc.bottles)} · ` : ''}
                    costo real promedio <b className="vh-num text-ink">{money(calc.avgLanded, { decimals: 0 })}</b> por botella
                  </p>
                )}
              </div>
              <p className="text-[13.5px] text-ink-soft">
                {f.paid === 'si' ? (
                  <>
                    <Banknote size={14} className="mr-1 inline align-[-2px] text-good" aria-hidden />
                    {purchase && purchase.payments.length > 0 ? (
                      purchase.status === 'pagado' ? (
                        <>
                          Ya está pagada
                          {purchase.payments.length === 1 && (
                            <> el {fmtDate(purchase.payments[0].date === purchase.date ? f.date || purchase.date : purchase.payments[0].date)}</>
                          )}{' '}
                          desde <b className="text-ink">{accountName ?? 'tu cuenta'}</b>.
                        </>
                      ) : (
                        <>
                          Se completa el pago desde <b className="text-ink">{accountName ?? 'la cuenta de transferencias'}</b>.
                        </>
                      )
                    ) : (
                      <>
                        Sale de <b className="text-ink">{accountName ?? 'la cuenta de transferencias'}</b> el {fmtDate(f.date || today())}.
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <CalendarClock size={14} className="mr-1 inline align-[-2px] text-warn" aria-hidden />
                    Queda <b className="text-ink">por pagar</b>
                    {f.dueDate ? <> · vence el {fmtDate(f.dueDate)}</> : null}.
                  </>
                )}
              </p>
              <div className="mt-3 rounded-xl bg-mustard-soft/80 p-3 text-[13px] leading-snug text-ink-soft">
                <p className="mb-0.5 flex items-center gap-1 font-extrabold text-ink">
                  Esto no es un gasto <InfoTip term="cmv" />
                </p>
                {calc.total > 0 ? (
                  <>
                    Los {money(calc.total, { decimals: 0 })} se transforman en botellas: suman a tu stock. Se vuelven costo (CMV) recién cuando vendas cada una, y ahí cuentan en tu
                    ganancia.
                  </>
                ) : (
                  <>Comprar vino es transformar plata en botellas (stock). Se vuelve costo recién cuando vendés cada botella.</>
                )}
              </div>
            </div>
            <p className="mt-3 hidden text-center text-[12px] text-muted lg:block">
              Atajo: <kbd className="rounded border border-line-strong bg-paper px-1 font-sans">Ctrl</kbd> +{' '}
              <kbd className="rounded border border-line-strong bg-paper px-1 font-sans">Enter</kbd> guarda
            </p>
          </aside>
        </div>
      </form>
    </Modal>
  )
}
