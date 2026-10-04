// Nueva cuenta / editar cuenta (efectivo, banco, billetera virtual…).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AccountKind } from '@shared/constants'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { useApiMutation } from '@/lib/queries'
import { Button, ChoiceCards, Field, Modal, MoneyInput, TextInput, Textarea, useConfirm, type ChoiceOption } from '@/components/ui'
import { ACCOUNT_ICON } from './parts'
import type { AccountRow } from './types'

const KIND_OPTIONS: ChoiceOption<AccountKind>[] = [
  { value: 'efectivo', title: 'Efectivo', description: 'La caja física del local: billetes y monedas.', icon: ACCOUNT_ICON.efectivo },
  { value: 'banco', title: 'Cuenta bancaria', description: 'Caja de ahorro o cuenta corriente.', icon: ACCOUNT_ICON.banco },
  { value: 'billetera', title: 'Billetera virtual', description: 'Mercado Pago, Ualá, Naranja X, MODO…', icon: ACCOUNT_ICON.billetera },
  { value: 'otro', title: 'Otra', description: 'Ej: plata en dólares guardada, un fondo común.', icon: ACCOUNT_ICON.otro },
]

interface FormState {
  name: string
  kind: AccountKind
  initial_balance: number | null
  notes: string
}

const initial = (a: AccountRow | null): FormState => ({
  name: a?.name ?? '',
  kind: a?.kind ?? 'banco',
  initial_balance: a?.initial_balance ?? 0,
  notes: a?.notes ?? '',
})

export function AccountFormModal({ open, account, onClose }: { open: boolean; account: AccountRow | null; onClose: () => void }) {
  const editing = !!account
  const confirm = useConfirm()
  const [f, setF] = useState<FormState>(() => initial(account))
  const [submitted, setSubmitted] = useState(false)
  const initialRef = useRef('')

  useEffect(() => {
    if (!open) return
    const s = initial(account)
    setF(s)
    initialRef.current = JSON.stringify(s)
    setSubmitted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id])

  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }))
  const dirty = open && JSON.stringify(f) !== initialRef.current
  const errors: Record<string, string> = {}
  if (!f.name.trim()) errors.name = 'Ponele un nombre (ej: «Banco Galicia» o «Caja del local»).'
  const shown = submitted ? errors : {}

  const save = useApiMutation(
    () => {
      const payload = { name: f.name.trim(), kind: f.kind, initial_balance: f.initial_balance ?? 0, notes: f.notes }
      return account ? api.put<AccountRow>(`/accounts/${account.id}`, payload) : api.post<AccountRow>('/accounts', payload)
    },
    {
      success: (r) => (account ? `Cuenta «${r.name}» actualizada` : `Cuenta «${r.name}» creada`),
      onSuccess: () => onClose(),
    },
  )

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length || save.isPending) return
    save.mutate()
  }

  const requestClose = async () => {
    if (save.isPending) return
    if (dirty && !(await confirm({ title: '¿Salís sin guardar?', message: 'Los cambios de esta cuenta se pierden.', confirmText: 'Sí, salir', cancelText: 'Seguir editando', danger: true }))) return
    onClose()
  }

  const balanceDelta = editing ? (f.initial_balance ?? 0) - account!.initial_balance : 0

  return (
    <Modal
      open={open}
      onClose={requestClose}
      dismissable={!dirty}
      title={editing ? `Editar ${account!.name}` : 'Nueva cuenta'}
      subtitle={editing ? 'Cambiá el nombre, el tipo o el saldo con el que arrancó.' : 'Un lugar donde tenés plata: la caja del local, un banco, Mercado Pago…'}
      footer={
        <>
          <Button variant="ghost" onClick={requestClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="account-form" loading={save.isPending}>
            {editing ? 'Guardar cambios' : 'Crear cuenta'}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} noValidate className="space-y-4">
        <Field label="Nombre" required error={shown.name} hint="Como la reconocés. Así aparece al cobrar y pagar.">
          <TextInput value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ej: Banco Galicia" maxLength={80} aria-invalid={!!shown.name || undefined} data-autofocus />
        </Field>
        <Field label="¿Qué tipo de cuenta es?">
          <ChoiceCards options={KIND_OPTIONS} value={f.kind} onChange={(v) => set({ kind: v })} />
        </Field>
        <Field
          label={editing ? 'Saldo con el que arrancó' : '¿Cuánta plata hay hoy en esta cuenta?'}
          hint={
            editing ? (
              Math.abs(balanceDelta) > 0.004 ? (
                <>
                  Ojo: esto cambia el saldo de hoy en <b className="text-ink">{money(balanceDelta, { sign: true })}</b> y todos los saldos para atrás. Si es una diferencia de hoy, mejor hacé un
                  arqueo.
                </>
              ) : (
                'Es la plata que había antes de empezar a cargar movimientos. Si hoy no coincide, usá «Arqueo» en vez de tocar esto.'
              )
            ) : (
              'Lo que tenés ahora (mirá el home banking o contá la caja). Si está en rojo (descubierto), poné el número con un menos adelante.'
            )
          }
        >
          <MoneyInput value={f.initial_balance} onChange={(v) => set({ initial_balance: v })} />
        </Field>
        <Field label="Notas (opcional)" hint="Ej: «CBU 0070…», «La usamos para pagar a bodegas».">
          <Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} maxLength={500} />
        </Field>
      </form>
    </Modal>
  )
}
