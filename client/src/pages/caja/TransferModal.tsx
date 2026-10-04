// "Transferir entre cuentas": la plata cambia de lugar pero sigue siendo tuya
// (depositar el efectivo en el banco, pasar de Mercado Pago al banco…).
import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { today } from '@shared/dates'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { useAccounts, useApiMutation } from '@/lib/queries'
import { AccountSelect, Button, DateInput, Field, Modal, MoneyInput, TextInput } from '@/components/ui'

export function TransferModal({ open, onClose, defaultFromId }: { open: boolean; onClose: () => void; defaultFromId?: number | null }) {
  const { data: accounts = [] } = useAccounts()
  const active = accounts.filter((a) => a.active)
  const [fromId, setFromId] = useState<number | null>(null)
  const [toId, setToId] = useState<number | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!open) return
    const cash = active.find((a) => a.kind === 'efectivo')
    const from = defaultFromId ?? cash?.id ?? active[0]?.id ?? null
    const to = active.find((a) => a.id !== from && a.kind === 'banco')?.id ?? active.find((a) => a.id !== from)?.id ?? null
    setFromId(from)
    setToId(to)
    setAmount(null)
    setDate(today())
    setNote('')
    setSubmitted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultFromId, accounts.length])

  const from = accounts.find((a) => a.id === fromId)
  const to = accounts.find((a) => a.id === toId)
  const errors: Record<string, string> = {}
  if (!fromId) errors.from = 'Elegí de qué cuenta sale.'
  if (!toId) errors.to = 'Elegí a qué cuenta va.'
  else if (fromId === toId) errors.to = 'Elegí una cuenta distinta a la de origen.'
  if (!amount || amount <= 0) errors.amount = '¿Cuánto pasaste? Poné un monto mayor a $ 0.'
  const shown = submitted ? errors : {}

  const save = useApiMutation(
    () => api.post('/transfers', { from_account_id: fromId, to_account_id: toId, amount: amount ?? 0, date, description: note.trim() || null }),
    {
      success: () => `Listo: pasaste ${money(amount)} de ${from?.name ?? 'una cuenta'} a ${to?.name ?? 'otra'}`,
      onSuccess: () => onClose(),
    },
  )

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length || save.isPending) return
    save.mutate()
  }

  const fromAfter = from && amount ? from.balance - amount : null
  const toAfter = to && amount ? to.balance + amount : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Transferir entre cuentas"
      subtitle="La plata cambia de lugar pero sigue siendo tuya: no es un ingreso ni un gasto."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="transfer-form" loading={save.isPending}>
            Guardar transferencia
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Field label="Sale de" required error={shown.from}>
            <AccountSelect value={fromId} onChange={setFromId} placeholder="Elegí…" />
          </Field>
          <ArrowRight size={20} className="mt-10 hidden text-muted sm:block" aria-hidden />
          <Field label="Va a" required error={shown.to}>
            <AccountSelect value={toId} onChange={setToId} placeholder="Elegí…" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monto" required error={shown.amount}>
            <MoneyInput value={amount} onChange={setAmount} aria-label="Monto" data-autofocus />
          </Field>
          <Field label="Fecha">
            <DateInput value={date} onChange={setDate} aria-label="Fecha" />
          </Field>
        </div>
        <Field label="Detalle (opcional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: Depósito del efectivo del fin de semana" maxLength={200} aria-label="Detalle" />
        </Field>
        {from && to && fromId !== toId && amount ? (
          <div className="rounded-xl bg-cream-deep px-3.5 py-3 text-[14px] text-ink">
            <p className="mb-1 font-extrabold">Así quedarían las cuentas</p>
            <p>
              {from.name}: {money(from.balance)} → <b className={fromAfter! < 0 ? 'text-bad' : undefined}>{money(fromAfter)}</b>
            </p>
            <p>
              {to.name}: {money(to.balance)} → <b>{money(toAfter)}</b>
            </p>
            {fromAfter! < 0 && <p className="mt-1.5 font-semibold text-bad">Ojo: «{from.name}» quedaría en negativo. ¿Seguro que el monto está bien?</p>}
          </div>
        ) : (
          <p className="text-[13.5px] text-ink-soft">Ejemplos: depositaste el efectivo de la semana en el banco, o pasaste lo cobrado por Mercado Pago a tu cuenta bancaria.</p>
        )}
      </form>
    </Modal>
  )
}
