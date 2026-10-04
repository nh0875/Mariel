// Formulario de gasto (nuevo o editar). Pensado para cargar rápido y sin dudas:
// tocás la categoría (ya sabe si es fijo o variable), escribís qué fue y cuánto, y decís si ya lo pagaste.
// Abajo se explica en criollo qué va a pasar al guardar.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, Banknote, ChevronDown, Clock, Repeat, TrendingDown, Waves, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { DEFAULT_EXPENSE_CATEGORIES, type ExpenseNature } from '@shared/constants'
import { endOfMonth, startOfMonth, today } from '@shared/dates'
import type { ExpenseCategorySetting, ExpenseWithStatus, WineEvent } from '@shared/types'
import { api } from '@/lib/api'
import { eventStartDate } from '@/lib/eventPreset'
import { date as fmtDate, dateShort, monthName } from '@/lib/format'
import { useLocalState } from '@/lib/hooks'
import { useAccounts, useApi, useApiMutation, useEvents, useSettings } from '@/lib/queries'
import { SettlementModal } from '@/components/forms/SettlementModal'
import {
  AccountSelect,
  Button,
  Checkbox,
  ChoiceCards,
  DateInput,
  EventSelect,
  Field,
  InfoTip,
  Modal,
  MoneyInput,
  SupplierSelect,
  TextInput,
  Textarea,
} from '@/components/ui'
import { CategoryPicker, money } from './parts'
import { descriptionExample, type ExpenseDetail } from './types'

interface FormState {
  category: string | null
  other: boolean
  otherText: string
  description: string
  amount: number | null
  date: string
  nature: ExpenseNature
  supplierId: number | null
  eventId: number | null
  paid: 'si' | 'no'
  accountId: number | null
  dueDate: string
  notes: string
  repeat: boolean
  repeatAutoPaid: boolean
}

const EVENT_CATEGORY = /evento|degustaci/i

function buildInitial(
  expense: ExpenseDetail | null | undefined,
  categories: ExpenseCategorySetting[],
  presetEventId: number | null | undefined,
  defaultAccount: number | null,
  /** El evento de ?evento=ID: si ya pasó, el gasto arranca con su fecha. */
  presetEvent?: WineEvent | null,
): FormState {
  if (expense) {
    const known = categories.some((c) => c.name === expense.category)
    return {
      category: known ? expense.category : null,
      other: !known,
      otherText: known ? '' : expense.category,
      description: expense.description,
      amount: expense.amount,
      date: expense.date,
      nature: expense.nature,
      supplierId: expense.supplier_id,
      eventId: expense.event_id,
      // Con pagos parciales arrancamos en "todavía no": así se conservan y el resto se paga con «Registrar pago».
      paid: expense.status === 'pagado' ? 'si' : 'no',
      accountId: expense.payments[0]?.account_id ?? defaultAccount,
      dueDate: expense.due_date ?? '',
      notes: expense.notes ?? '',
      repeat: false,
      repeatAutoPaid: false,
    }
  }
  const eventCat = presetEventId ? categories.find((c) => EVENT_CATEGORY.test(c.name)) : undefined
  return {
    category: eventCat?.name ?? null,
    other: false,
    otherText: '',
    description: '',
    amount: null,
    date: eventStartDate(presetEvent),
    nature: eventCat?.nature ?? 'variable',
    supplierId: null,
    eventId: presetEventId ?? null,
    paid: 'si',
    accountId: defaultAccount,
    dueDate: '',
    notes: '',
    repeat: false,
    repeatAutoPaid: false,
  }
}

export function ExpenseFormModal({
  open,
  onClose,
  expense,
  presetEventId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** Si viene, es "editar". */
  expense?: ExpenseDetail | null
  /** ?evento=ID → el gasto queda asociado a ese evento. */
  presetEventId?: number | null
  onSaved?: (e: ExpenseDetail) => void
}) {
  const { data: settings } = useSettings()
  const { data: accounts = [] } = useAccounts()
  const categories = settings?.expense_categories?.length ? settings.expense_categories : DEFAULT_EXPENSE_CATEGORIES
  const [lastAccount, setLastAccount] = useLocalState<number | null>('gastos.account', null)
  const eventsQ = useEvents()
  const presetEvent = !expense && presetEventId ? (eventsQ.data?.find((e) => e.id === presetEventId) ?? null) : null
  // Si viene de un evento, esperamos sus datos (la fecha): es local, tarda un instante.
  const waitEvent = !expense && !!presetEventId && eventsQ.isPending

  // Cuenta sugerida: la última que usaste para un gasto; si no, el banco; si no, la primera.
  const activeAccounts = accounts.filter((a) => a.active)
  const defaultAccount =
    (lastAccount && activeAccounts.some((a) => a.id === lastAccount) ? lastAccount : null) ??
    activeAccounts.find((a) => a.kind === 'banco')?.id ??
    activeAccounts[0]?.id ??
    null

  const [f, setF] = useState<FormState>(() => buildInitial(expense, categories, presetEventId, defaultAccount, presetEvent))
  const [touched, setTouched] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    if (!open || waitEvent) return
    const init = buildInitial(expense, categories, presetEventId, defaultAccount, presetEvent)
    setF(init)
    setTouched(false)
    setShowErrors(false)
    setMoreOpen(!!(init.supplierId || init.eventId || init.notes))
    // Solo al abrir (o cambiar de gasto): no pisar lo que la persona está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense?.id, presetEventId, waitEvent])

  // Si las cuentas llegan después de abrir, completamos la sugerida.
  useEffect(() => {
    if (open && f.accountId == null && defaultAccount != null) setF((s) => ({ ...s, accountId: defaultAccount }))
  }, [open, defaultAccount, f.accountId])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setTouched(true)
    setF((s) => ({ ...s, [k]: v }))
  }

  const isEdit = !!expense
  // El gasto quedó con la fecha de un evento que ya pasó (la ponemos así al venir desde su ficha).
  const dateEvent = eventsQ.data?.find((e) => e.id === f.eventId && e.date === f.date && e.date < today()) ?? null
  const category = f.other ? f.otherText.trim() : (f.category ?? '')
  const day = Math.min(Number(f.date.slice(8, 10)) || 1, 28)
  const partialPaid = isEdit && expense!.status === 'parcial'
  /** Al editar: ya estaba pagado del todo (con uno o varios pagos). */
  const wasPaid = isEdit && expense!.status === 'pagado' && expense!.payments.length > 0
  const initialAccount = expense?.payments[0]?.account_id ?? null
  /** Al editar un gasto pagado: no tocaron ni la cuenta ni el monto → los pagos quedan como están. */
  const sameAccount = wasPaid && f.accountId === initialAccount
  const sameAmount = wasPaid && f.amount != null && Math.abs(f.amount - expense!.amount) < 0.005
  const account = accounts.find((a) => a.id === f.accountId)
  const paidAccounts = isEdit ? [...new Set(expense!.payments.map((p) => p.account_name ?? 'la cuenta'))].join(' y ') : ''
  // "Se debita solo" necesita saber de qué cuenta: solo vale si ya lo pagaste desde una.
  const autoPaid = f.repeat && f.repeatAutoPaid && f.paid === 'si'

  const errors = {
    category: !category ? (f.other ? 'Escribí el nombre de la categoría.' : 'Elegí una categoría (o «Otra…» y escribila).') : undefined,
    description: !f.description.trim() ? 'Contá en pocas palabras qué pagaste.' : undefined,
    amount:
      !f.amount || f.amount <= 0
        ? '¿Cuánto fue? Tiene que ser más de $ 0.'
        : partialPaid && f.paid === 'no' && f.amount < expense!.paid - 0.01
          ? `Ya pagaste ${money(expense!.paid)} de este gasto: el monto no puede ser menor. Si un pago estaba mal, borralo desde el detalle.`
          : undefined,
    date: !f.date ? 'Poné la fecha del gasto.' : undefined,
    // Si todavía no hay cuentas cargadas, el sistema usa la caja principal (no trabamos el formulario).
    account: f.paid === 'si' && !f.accountId && activeAccounts.length > 0 ? 'Elegí de qué cuenta salió la plata.' : undefined,
    due: f.paid === 'no' && f.dueDate && f.dueDate < f.date ? 'El vencimiento no puede ser antes de la fecha del gasto.' : undefined,
  }
  const hasErrors = Object.values(errors).some(Boolean)
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : undefined)

  // ¿Ya hay un gasto de esta categoría en el mismo mes? (típico: el alquiler generado desde «Gastos
  // fijos del mes» espera como «por pagar» y la persona entra por «Pagué algo» → se duplicaría).
  const monthOk = /^\d{4}-\d{2}-\d{2}$/.test(f.date)
  const sameMonthQ = useApi<ExpenseWithStatus[]>(
    '/expenses',
    monthOk ? { from: startOfMonth(f.date), to: endOfMonth(f.date), category } : undefined,
    { enabled: open && !isEdit && !!category && monthOk },
  )
  const sameMonth = !isEdit && category ? (sameMonthQ.data ?? []) : []
  const pendingSame = sameMonth.filter((e) => e.balance > 0.009)
  const paidFixedSame = sameMonth.filter((e) => e.balance <= 0.009 && e.recurring_id != null)
  const [settleTarget, setSettleTarget] = useState<ExpenseWithStatus | null>(null)

  // Candado para no mandar dos veces el mismo formulario (dos Enter seguidos llegan antes de que se vuelva a dibujar).
  const submitting = useRef(false)
  const save = useApiMutation(
    (body: Record<string, unknown>) => (isEdit ? api.put<ExpenseDetail>(`/expenses/${expense!.id}`, body) : api.post<ExpenseDetail>('/expenses', body)),
    {
      success: (res) =>
        isEdit
          ? 'Cambios guardados'
          : res.recurring
            ? `Gasto guardado. También quedó en «Gastos fijos del mes»: se carga solo el día ${day} de cada mes.`
            : `Gasto guardado: ${res.description} (${money(res.amount)})`,
      onSuccess: (res) => {
        if (f.paid === 'si' && f.accountId) setLastAccount(f.accountId)
        onSaved?.(res)
        onClose()
      },
    },
  )

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    // Enter dos veces seguidas (o doble clic) no tiene que cargar el gasto dos veces.
    if (save.isPending || submitting.current) return
    if (hasErrors) {
      setShowErrors(true)
      return
    }
    submitting.current = true
    save.mutate(
      {
        date: f.date,
        category,
        description: f.description.trim(),
        amount: f.amount,
        nature: f.nature,
        supplier_id: f.supplierId,
        event_id: f.eventId,
        notes: f.notes.trim() || null,
        paid: f.paid === 'si',
        // Si ya estaba pagado (quizás en partes, desde varias cuentas) y no cambiaron la cuenta, no la mandamos:
        // así el sistema conserva los pagos tal cual en vez de juntarlos en uno solo.
        account_id: f.paid === 'si' ? (sameAccount ? null : f.accountId) : null,
        due_date: f.paid === 'no' && f.dueDate ? f.dueDate : null,
        repeat_monthly: !isEdit && f.repeat,
        repeat_auto_paid: !isEdit && autoPaid,
      },
      { onSettled: () => (submitting.current = false) },
    )
  }

  // "Qué va a pasar al guardar": la explicación en criollo de lo que hace el sistema.
  const consequences = useMemo(() => {
    if (!f.amount || f.amount <= 0 || !f.date) return []
    const out: { icon: LucideIcon; text: ReactNode }[] = []
    out.push({
      icon: TrendingDown,
      text: (
        <>
          Suma <b>{money(f.amount)}</b> a los gastos <b>{f.nature === 'fijo' ? 'fijos' : 'variables'}</b> de {monthName(f.date.slice(0, 7))} y baja el resultado de ese mes
          (aunque lo pagues otro día).
        </>
      ),
    })
    if (f.paid === 'si' && sameAccount && sameAmount) {
      out.push({
        icon: Banknote,
        text: (
          <>
            No se mueve plata: {expense!.payments.length === 1 ? 'el pago que ya registraste' : `los ${expense!.payments.length} pagos que ya registraste`} ({money(expense!.paid)}{' '}
            desde {paidAccounts}) {expense!.payments.length === 1 ? 'queda' : 'quedan'} como {expense!.payments.length === 1 ? 'está' : 'están'}.
          </>
        ),
      })
    } else if (f.paid === 'si') {
      const willBe = account ? account.balance - f.amount + (isEdit ? expense!.payments.filter((p) => p.account_id === account.id).reduce((s, p) => s + p.amount, 0) : 0) : null
      out.push({
        icon: Banknote,
        text: (
          <>
            {isEdit && expense!.paid > 0.009 ? (
              <>
                Queda un solo pago de <b>{money(f.amount)}</b> desde <b>{account?.name ?? 'la cuenta elegida'}</b>, en lugar de los {money(expense!.paid)} que habías registrado desde{' '}
                {paidAccounts}
              </>
            ) : (
              <>
                Sale <b>{money(f.amount)}</b> de <b>{account?.name ?? 'la cuenta elegida'}</b>
              </>
            )}
            {willBe != null && (
              <>
                {' '}
                ({isEdit && expense!.paid > 0.009 ? `a ${account?.name ?? 'la cuenta'} le quedarían` : 'le quedarían'}{' '}
                <b className={willBe < 0 ? 'text-bad' : undefined}>{money(willBe)}</b>
                {willBe < 0 ? ': ojo, quedaría en negativo' : ''})
              </>
            )}
            .
          </>
        ),
      })
    } else {
      if (wasPaid) {
        out.push({
          icon: Banknote,
          text: (
            <>
              Se borra{expense!.payments.length === 1 ? ' el pago' : 'n los pagos'} que habías registrado: <b>{money(expense!.paid)}</b> vuelven a {paidAccounts}.
            </>
          ),
        })
      }
      out.push({
        icon: Clock,
        text: partialPaid ? (
          <>
            Lo que ya pagaste ({money(expense!.paid)}) queda registrado y el resto, <b>{money(Math.max(0, f.amount - expense!.paid))}</b>, queda <b>por pagar</b>
            {f.dueDate ? <> (vence el {fmtDate(f.dueDate)})</> : ''}. No sale más plata hasta que toques «Registrar pago».
          </>
        ) : (
          <>
            Queda <b>por pagar</b>
            {f.dueDate ? <>, vence el {fmtDate(f.dueDate)}</> : ''}. No sale plata de ninguna cuenta hasta que toques «Registrar pago».
          </>
        ),
      })
    }
    if (!isEdit && f.repeat) {
      out.push({
        icon: Repeat,
        text: (
          <>
            Se agrega a <b>Gastos fijos del mes</b>: cada mes se carga solo el día {day}
            {autoPaid ? ' y se marca como pagado' : ' como «por pagar»'}.
          </>
        ),
      })
    }
    return out
  }, [f, account, isEdit, expense, day, autoPaid, sameAccount, sameAmount, wasPaid, partialPaid, paidAccounts])

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={!touched}
      size="lg"
      title={isEdit ? 'Editar gasto' : 'Nuevo gasto'}
      subtitle={isEdit ? `${expense!.description} · ${fmtDate(expense!.date)}` : 'Alquiler, sueldos, envíos, publicidad… todo lo que pagás para que el negocio funcione (menos el vino, que va en Compras).'}
      footer={
        <>
          {showErrors && hasErrors && <p className="mr-auto text-[13.5px] font-semibold text-bad">Revisá los campos marcados en rojo.</p>}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="expense-form" loading={save.isPending}>
            {isEdit ? 'Guardar cambios' : 'Guardar gasto'}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} noValidate className="space-y-5">
        <Field label="¿En qué se fue la plata?" required error={err('category')}>
          <CategoryPicker
            categories={categories}
            value={f.category}
            other={f.other}
            invalid={!!err('category')}
            onPick={(c) => {
              setTouched(true)
              setF((s) => ({ ...s, category: c.name, other: false, nature: c.nature }))
            }}
            onOther={() => {
              setTouched(true)
              setF((s) => ({ ...s, other: true, category: null }))
            }}
          />
          {f.other && (
            <TextInput
              className="mt-2"
              autoFocus
              value={f.otherText}
              onChange={(e) => set('otherText', e.target.value)}
              placeholder="Ej: Capacitaciones"
              aria-label="Nombre de la categoría"
              maxLength={80}
            />
          )}
          {f.other && <p className="text-[13px] text-muted">Si la vas a usar seguido, agregala en Configuración → Categorías de gastos y te aparece como botón.</p>}
        </Field>

        <div className="grid gap-4 sm:grid-cols-[1fr_11rem_11rem]">
          <Field label="Descripción" required error={err('description')} hint="Así lo vas a encontrar en la lista.">
            <TextInput value={f.description} onChange={(e) => set('description', e.target.value)} placeholder={descriptionExample(category)} maxLength={200} aria-invalid={!!err('description')} aria-label="Descripción" />
          </Field>
          <Field label="Monto" required error={err('amount')} hint="Lo que figura en la factura o ticket.">
            <MoneyInput value={f.amount} onChange={(v) => set('amount', v)} aria-invalid={!!err('amount')} aria-label="Monto" />
          </Field>
          <Field
            label="Fecha"
            required
            error={err('date')}
            hint={dateEvent ? `Es el día del evento «${dateEvent.name}» (${dateShort(dateEvent.date)}). Si el gasto fue de otro día, cambiala.` : 'El día del gasto.'}
          >
            <DateInput value={f.date} onChange={(v) => set('date', v)} aria-invalid={!!err('date')} aria-label="Fecha" />
          </Field>
        </div>

        {(pendingSame.length > 0 || paidFixedSame.length > 0) && (
          <div className="rounded-2xl border border-warn/50 bg-warn-soft px-4 py-3 text-[14px] text-ink" data-testid="duplicate-warning">
            <p className="flex items-start gap-2 font-bold">
              <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              {pendingSame.length > 0
                ? `Ojo: en ${monthName(f.date.slice(0, 7))} ya tenés ${pendingSame.length === 1 ? 'un gasto' : `${pendingSame.length} gastos`} de «${category}» esperando como «por pagar».`
                : `Ojo: en ${monthName(f.date.slice(0, 7))} ya está cargado ${paidFixedSame.length === 1 ? 'un gasto fijo' : `${paidFixedSame.length} gastos fijos`} de «${category}».`}
            </p>
            <ul className="mt-2 space-y-2">
              {pendingSame.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-6">
                  <span className="min-w-0 flex-1">
                    <b>{e.description}</b> · {money(e.balance)} {e.paid > 0.009 ? `(falta pagar, de ${money(e.amount)})` : ''} · {dateShort(e.date)}
                    {e.recurring_id != null ? ' · se generó de tus gastos fijos' : ''}
                  </span>
                  <Button size="sm" variant="secondary" icon={Banknote} onClick={() => setSettleTarget(e)}>
                    Registrar el pago de ese
                  </Button>
                </li>
              ))}
              {paidFixedSame.map((e) => (
                <li key={e.id} className="pl-6">
                  <b>{e.description}</b> · {money(e.amount)} · {dateShort(e.date)} · figura pagado (se generó de tus gastos fijos)
                </li>
              ))}
            </ul>
            <p className="mt-2 pl-6 text-[13px] text-ink-soft">
              {pendingSame.length > 0
                ? 'Si es ese mismo, no cargues otro (el gasto quedaría dos veces y el resultado bajaría de más): tocá «Registrar el pago de ese». Si es un gasto distinto, seguí cargando.'
                : 'Si es el mismo pago, no hace falta cargarlo de nuevo (quedaría dos veces). Si es un gasto distinto, seguí cargando.'}
            </p>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[14px] font-bold text-ink">¿Es fijo o variable?</span>
            <InfoTip term="punto_equilibrio" />
          </div>
          <ChoiceCards
            value={f.nature}
            onChange={(v) => set('nature', v)}
            options={[
              { value: 'fijo', title: 'Fijo', description: 'Lo pagás igual vendas o no: alquiler, sueldos, internet.', icon: Repeat },
              { value: 'variable', title: 'Variable', description: 'Sube o baja según cuánto vendés: envíos, packaging, publicidad.', icon: Waves },
            ]}
          />
          <p className="mt-1.5 text-[13px] text-muted">Lo completamos solo según la categoría; cambialo si en tu caso es distinto. Los fijos son el piso que tenés que cubrir cada mes.</p>
        </div>

        <div>
          <p className="mb-1.5 text-[14px] font-bold text-ink">¿Ya lo pagaste?</p>
          {partialPaid && (
            <p className="mb-2 rounded-xl bg-warn-soft px-3.5 py-2 text-[13.5px] text-ink">
              Ya pagaste <b>{money(expense!.paid)}</b> de {money(expense!.amount)}. Si dejás «Todavía no», esos pagos se mantienen; para pagar el resto usá «Registrar pago» en el
              detalle.
            </p>
          )}
          <ChoiceCards
            value={f.paid}
            onChange={(v) => set('paid', v)}
            options={[
              { value: 'si', title: 'Sí, ya lo pagué', description: 'Sale la plata de la cuenta que elijas.', icon: Banknote },
              { value: 'no', title: 'Todavía no', description: 'Queda «por pagar» y te avisamos si se vence.', icon: Clock },
            ]}
          />
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {f.paid === 'si' ? (
              <Field label="¿De dónde salió la plata?" required error={err('account')} hint={!err('account') ? (activeAccounts.length ? 'Te sugerimos la última cuenta que usaste para un gasto.' : 'Si no elegís, sale de la caja principal.') : undefined}>
                <AccountSelect value={f.accountId} onChange={(v) => set('accountId', v)} placeholder="Elegí una cuenta…" />
              </Field>
            ) : (
              <Field label="¿Cuándo vence?" error={err('due')} hint="Opcional. Si tiene fecha límite, ponela y te avisamos cuando se venza.">
                <DateInput value={f.dueDate} onChange={(v) => set('dueDate', v)} min={f.date} aria-label="Vencimiento" />
              </Field>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-paper/70">
          <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} className="flex w-full items-center gap-2 px-4 py-3 text-left">
            <span className="flex-1 text-[14px] font-bold text-ink">
              Más datos <span className="font-semibold text-muted">(opcional): proveedor, evento, notas</span>
            </span>
            <ChevronDown size={18} className={clsx('text-ink-soft transition-transform', moreOpen && 'rotate-180')} aria-hidden />
          </button>
          {moreOpen && (
            <div className="grid gap-4 border-t border-line px-4 py-4 sm:grid-cols-2">
              <Field label="Proveedor" hint="Quién te cobró. Si no está, escribí el nombre y lo agregamos.">
                <SupplierSelect value={f.supplierId} onChange={(v) => set('supplierId', v)} />
              </Field>
              <Field label="Evento" hint="Si fue para una degustación o feria: así sabés cuánto te costó cada evento.">
                <EventSelect value={f.eventId} onChange={(v) => set('eventId', v)} />
              </Field>
              <Field label="Notas" className="sm:col-span-2">
                <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ej: Nº de factura, a quién se lo pagaste…" maxLength={2000} />
              </Field>
            </div>
          )}
        </div>

        {!isEdit && (
          <div className="rounded-2xl border border-line bg-paper/70 px-4 py-3.5">
            <Checkbox
              checked={f.repeat}
              onChange={(v) => set('repeat', v)}
              label="Repetir todos los meses"
              hint={
                <>
                  Lo agregamos a «Gastos fijos del mes» para que se cargue solo el <b>día {day}</b> de cada mes
                  {Number(f.date.slice(8, 10)) > 28 ? ' (máximo 28, así existe en todos los meses)' : ''}. Ideal para alquiler, sueldos, abonos.
                </>
              }
            />
            {f.repeat && (
              <Checkbox
                className="mt-3 ml-7"
                checked={autoPaid}
                onChange={(v) => set('repeatAutoPaid', v)}
                label="Se debita solo (débito automático)"
                hint={f.paid === 'si' ? `Cada mes se marca como pagado desde ${account?.name ?? 'la cuenta elegida'}.` : 'Elegí «Sí, ya lo pagué» y una cuenta para saber de dónde se debita.'}
                disabled={f.paid !== 'si'}
              />
            )}
          </div>
        )}

        {consequences.length > 0 && (
          <div className="rounded-2xl bg-cream-deep px-4 py-3.5">
            <p className="vh-label mb-2 !text-brown">Al guardar</p>
            <ul className="space-y-1.5 text-[14px] text-ink-soft">
              {consequences.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <c.icon size={16} className="mt-0.5 shrink-0 text-brown" aria-hidden />
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Enter en cualquier campo guarda */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
      {settleTarget && (
        <SettlementModal
          kind="expense"
          id={settleTarget.id}
          balance={settleTarget.balance}
          description={`${settleTarget.description} · ${fmtDate(settleTarget.date)}`}
          defaultAccountId={f.accountId}
          open
          onClose={() => setSettleTarget(null)}
          onDone={() => {
            setSettleTarget(null)
            onClose()
          }}
        />
      )}
    </Modal>
  )
}
