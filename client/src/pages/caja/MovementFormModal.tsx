// "Nuevo movimiento": plata que entra o sale y NO es una venta, una compra ni un gasto
// (aportes y retiros de los dueños, préstamos, otros ingresos/egresos, ajustes).
// Cada tipo explica qué es y cómo afecta los números, porque es donde más se confunde la gente.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, HandCoins, Landmark, LogOut, PiggyBank, Scale, Trash2, type LucideIcon } from 'lucide-react'
import { MANUAL_CASH_DIRECTION, MANUAL_CASH_KINDS, MANUAL_CASH_LABELS, type ManualCashKind } from '@shared/constants'
import { today } from '@shared/dates'
import type { Payment } from '@shared/types'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { useAccounts, useApiMutation } from '@/lib/queries'
import { AccountSelect, Button, ChoiceCards, DateInput, Field, Modal, MoneyInput, TextInput, useConfirm, type ChoiceOption } from '@/components/ui'
import type { MovementRow } from './types'

interface KindInfo {
  title: string
  short: string
  icon: LucideIcon
  /** Cómo afecta la caja y el resultado. */
  effect: string
  placeholder: string
}

export const KIND_INFO: Record<ManualCashKind, KindInfo> = {
  aporte: {
    title: 'Aporte de los dueños',
    short: 'Plata que ponés vos (o un socio) en el negocio.',
    icon: PiggyBank,
    effect: 'Suma a la cuenta elegida. No es una venta, así que no cambia la ganancia del negocio: es capital que ponen los dueños.',
    placeholder: 'Ej: Aporte para la compra de fin de año',
  },
  retiro: {
    title: 'Retiro de los dueños',
    short: 'Plata que te llevás vos. No es un gasto del negocio.',
    icon: LogOut,
    effect: 'Resta de la cuenta elegida, pero no baja la ganancia: es parte de la ganancia que te llevás. Por eso va acá y no en Gastos.',
    placeholder: 'Ej: Retiro mensual de Mariel',
  },
  prestamo_recibido: {
    title: 'Préstamo recibido',
    short: 'Te prestaron plata (un banco, un familiar).',
    icon: Landmark,
    effect: 'Entra plata a la cuenta, pero no es ganancia: es una deuda que vas a devolver. Las cuotas, cargalas como «Pago de préstamo».',
    placeholder: 'Ej: Préstamo Banco Nación 12 cuotas',
  },
  prestamo_pagado: {
    title: 'Pago de préstamo',
    short: 'Devolvés una cuota o parte de un préstamo.',
    icon: HandCoins,
    effect: 'Sale plata de la cuenta y baja la deuda. Si la cuota trae intereses, esa parte cargala como gasto en «Bancos y comisiones» (esa sí es un costo).',
    placeholder: 'Ej: Cuota 3 de 12',
  },
  otro_ingreso: {
    title: 'Otro ingreso',
    short: 'Plata que entra y no es una venta (reintegros, intereses).',
    icon: ArrowDownToLine,
    effect: 'Suma a la cuenta. No aparece como venta en los reportes. Si en realidad vendiste algo, cargalo en Ventas.',
    placeholder: 'Ej: Reintegro de la tarjeta',
  },
  otro_egreso: {
    title: 'Otro egreso',
    short: 'Plata que sale y no es gasto ni compra (ej: devolviste una seña).',
    icon: ArrowUpFromLine,
    effect: 'Resta de la cuenta. No aparece como gasto en los reportes: si es un gasto del negocio (envíos, alquiler…), cargalo en Gastos así se descuenta de la ganancia.',
    placeholder: 'Ej: Devolución de seña a un cliente',
  },
  ajuste: {
    title: 'Ajuste de saldo',
    short: 'Corregís el saldo porque no coincide con la plata real.',
    icon: Scale,
    effect: 'Corrige el saldo de la cuenta sin tocar ventas ni gastos. Para la caja física es más fácil usar «Arqueo» (te calcula la diferencia solo).',
    placeholder: 'Ej: Diferencia de caja del sábado',
  },
}

const KIND_OPTIONS: ChoiceOption<ManualCashKind>[] = MANUAL_CASH_KINDS.map((k) => ({ value: k, title: KIND_INFO[k].title, description: KIND_INFO[k].short, icon: KIND_INFO[k].icon }))

interface FormState {
  kind: ManualCashKind
  direction: 'in' | 'out'
  amount: number | null
  account_id: number | null
  date: string
  description: string
}

function initial(m: MovementRow | null, defaultAccountId: number | null): FormState {
  if (m) {
    return {
      kind: m.ref_type as ManualCashKind,
      direction: m.direction,
      amount: m.amount,
      account_id: m.account_id,
      date: m.date,
      description: m.description ?? '',
    }
  }
  return { kind: 'aporte', direction: 'in', amount: null, account_id: defaultAccountId, date: today(), description: '' }
}

export function MovementFormModal({
  open,
  movement,
  defaultAccountId,
  onClose,
}: {
  open: boolean
  /** Si viene, se edita ese movimiento (solo movimientos sueltos). */
  movement: MovementRow | null
  defaultAccountId?: number | null
  onClose: () => void
}) {
  const editing = !!movement
  const confirm = useConfirm()
  const { data: accounts = [] } = useAccounts()
  const fallbackAccount = defaultAccountId ?? accounts.find((a) => a.active)?.id ?? null
  const [f, setF] = useState<FormState>(() => initial(movement, fallbackAccount))
  const [submitted, setSubmitted] = useState(false)
  const initialRef = useRef('')

  useEffect(() => {
    if (!open) return
    const s = initial(movement, fallbackAccount)
    setF(s)
    initialRef.current = JSON.stringify(s)
    setSubmitted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, movement?.id])

  // Si las cuentas llegan después de abrir, elegimos la primera.
  useEffect(() => {
    if (open && !editing && f.account_id == null && fallbackAccount) setF((s) => ({ ...s, account_id: fallbackAccount }))
  }, [open, editing, f.account_id, fallbackAccount])

  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }))
  const setKind = (kind: ManualCashKind) => set({ kind, direction: MANUAL_CASH_DIRECTION[kind] ?? f.direction })
  const dirty = open && JSON.stringify(f) !== initialRef.current
  const info = KIND_INFO[f.kind]
  const direction = MANUAL_CASH_DIRECTION[f.kind] ?? f.direction
  const account = accounts.find((a) => a.id === f.account_id)

  const errors: Record<string, string> = {}
  if (!f.amount || f.amount <= 0) errors.amount = '¿De cuánto fue? Poné un monto mayor a $ 0.'
  if (!f.account_id) errors.account_id = 'Elegí en qué cuenta entró o de cuál salió la plata.'
  if (!f.date) errors.date = 'Poné la fecha.'
  const shown = submitted ? errors : {}

  const save = useApiMutation(
    () => {
      const payload = { kind: f.kind, direction, amount: f.amount ?? 0, account_id: f.account_id, date: f.date, description: f.description.trim() || null }
      return movement ? api.put<Payment>(`/movements/${movement.id}`, payload) : api.post<Payment>('/movements', payload)
    },
    {
      success: () => (movement ? 'Movimiento actualizado' : `${MANUAL_CASH_LABELS[f.kind]} registrado: ${money(f.amount)}`),
      onSuccess: () => onClose(),
    },
  )

  const remove = useApiMutation(() => api.del(`/payments/${movement!.id}`), {
    success: 'Movimiento borrado. El saldo de la cuenta ya está corregido.',
    onSuccess: () => onClose(),
  })
  const askDelete = async () => {
    if (!movement) return
    const ok = await confirm({
      title: '¿Borrar este movimiento?',
      message: `«${MANUAL_CASH_LABELS[movement.ref_type as ManualCashKind]}» por ${money(movement.amount)} en ${movement.account_name}. El saldo de la cuenta se corrige solo. No se puede deshacer.`,
      confirmText: 'Sí, borrar',
      danger: true,
    })
    if (ok) remove.mutate()
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length || save.isPending) return
    save.mutate()
  }

  const requestClose = async () => {
    if (save.isPending) return
    if (dirty && !(await confirm({ title: '¿Salís sin guardar?', message: 'Lo que cargaste de este movimiento se pierde.', confirmText: 'Sí, salir', cancelText: 'Seguir cargando', danger: true }))) return
    onClose()
  }

  const after = account && f.amount ? account.balance + (editing ? 0 : direction === 'in' ? f.amount : -f.amount) : null

  return (
    <Modal
      open={open}
      onClose={requestClose}
      dismissable={!dirty}
      size="lg"
      title={editing ? 'Editar movimiento' : 'Nuevo movimiento'}
      subtitle={
        editing
          ? 'Corregí lo que haga falta. El saldo de la cuenta se recalcula solo.'
          : 'Para plata que entra o sale y no es una venta, una compra de vino ni un gasto. Esas se cargan en su pantalla.'
      }
      footer={
        <>
          {editing && (
            <Button variant="ghost" icon={Trash2} onClick={askDelete} loading={remove.isPending} disabled={save.isPending} className="mr-auto text-bad hover:bg-bad-soft hover:text-bad">
              Borrar
            </Button>
          )}
          <Button variant="ghost" onClick={requestClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="movement-form" loading={save.isPending}>
            {editing ? 'Guardar cambios' : 'Guardar movimiento'}
          </Button>
        </>
      }
    >
      <form id="movement-form" onSubmit={submit} noValidate className="space-y-5">
        <Field label="¿Qué fue?">
          <ChoiceCards options={KIND_OPTIONS} value={f.kind} onChange={setKind} />
        </Field>

        <div className="rounded-xl border border-sky/40 bg-sky-soft/60 px-3.5 py-2.5 text-[14px] text-ink">
          <b>¿Cómo afecta tus números?</b> {info.effect}
        </div>

        {f.kind === 'ajuste' && (
          <Field label="¿Sobra o falta plata?">
            <ChoiceCards
              value={f.direction}
              onChange={(v) => set({ direction: v })}
              options={[
                { value: 'in', title: 'Sobra plata', description: 'Hay más de lo que dice el sistema: se suma la diferencia.', icon: ArrowDownToLine },
                { value: 'out', title: 'Falta plata', description: 'Hay menos de lo que dice el sistema: se resta la diferencia.', icon: ArrowUpFromLine },
              ]}
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monto" required error={shown.amount} hint={direction === 'in' ? 'Plata que entra.' : 'Plata que sale.'}>
            <MoneyInput value={f.amount} onChange={(v) => set({ amount: v })} aria-invalid={!!shown.amount || undefined} aria-label="Monto" data-autofocus />
          </Field>
          <Field
            label={direction === 'in' ? '¿A qué cuenta entró?' : '¿De qué cuenta salió?'}
            required
            error={shown.account_id}
            hint={after != null && !editing ? <>Le quedarían {money(after)}{after < 0 ? ' (en rojo: revisá el monto o la cuenta)' : ''}.</> : undefined}
          >
            <AccountSelect value={f.account_id} onChange={(v) => set({ account_id: v })} placeholder="Elegí una cuenta…" />
          </Field>
          <Field label="Fecha" required error={shown.date}>
            <DateInput value={f.date} onChange={(v) => set({ date: v })} aria-label="Fecha" />
          </Field>
          <Field label="Detalle (opcional)" hint="Para acordarte después de qué fue.">
            <TextInput value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder={info.placeholder} maxLength={200} aria-label="Detalle" />
          </Field>
        </div>
      </form>
    </Modal>
  )
}
