// "Registrar cobro" (ventas) / "Registrar pago" (compras y gastos), total o parcial.
// Lo usan Ventas, Compras, Gastos y Caja (pendientes).
import { useEffect, useState } from 'react'
import { today } from '@shared/dates'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { useApiMutation } from '@/lib/queries'
import { AccountSelect, Button, DateInput, Field, Modal, MoneyInput, TextInput } from '@/components/ui'

const CONFIG = {
  sale: { path: 'sales', verb: 'cobro', title: 'Registrar cobro', button: 'Guardar cobro', done: 'Cobro registrado', question: '¿Cuánto te pagaron?', account: '¿Dónde entró la plata?' },
  purchase: { path: 'purchases', verb: 'pago', title: 'Registrar pago', button: 'Guardar pago', done: 'Pago registrado', question: '¿Cuánto pagaste?', account: '¿De dónde salió la plata?' },
  expense: { path: 'expenses', verb: 'pago', title: 'Registrar pago', button: 'Guardar pago', done: 'Pago registrado', question: '¿Cuánto pagaste?', account: '¿De dónde salió la plata?' },
} as const

export function SettlementModal({
  kind,
  id,
  balance,
  description,
  defaultAccountId,
  open,
  onClose,
  onDone,
}: {
  kind: 'sale' | 'purchase' | 'expense'
  id: number
  /** Lo que falta cobrar/pagar. */
  balance: number
  /** Ej: "Venta #123 · Bistró La Esquina". */
  description?: string
  defaultAccountId?: number | null
  open: boolean
  onClose: () => void
  onDone?: () => void
}) {
  const c = CONFIG[kind]
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState<number | null>(balance)
  const [accountId, setAccountId] = useState<number | null>(defaultAccountId ?? null)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) {
      setDate(today())
      setAmount(balance)
      setAccountId(defaultAccountId ?? null)
      setNote('')
    }
  }, [open, balance, defaultAccountId])

  const save = useApiMutation(
    () => api.post(`/${c.path}/${id}/payments`, { date, amount: amount ?? 0, account_id: accountId, description: note || null }),
    {
      success: c.done,
      onSuccess: () => {
        onDone?.()
        onClose()
      },
    },
  )
  const tooMuch = (amount ?? 0) > balance + 0.01
  const partial = amount != null && amount > 0 && amount < balance - 0.01

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={c.title}
      subtitle={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!amount || amount <= 0 || tooMuch || !accountId} onClick={() => save.mutate()}>
            {c.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl bg-cream-deep px-3.5 py-2.5 text-[14.5px] text-ink">
          Falta {kind === 'sale' ? 'cobrar' : 'pagar'}: <b className="vh-num">{money(balance)}</b>
        </p>
        <Field label={c.question} required error={tooMuch ? `No puede ser más de ${money(balance)}.` : undefined} hint={partial ? `Queda un saldo de ${money(balance - (amount ?? 0))} para más adelante.` : undefined}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field
          label={c.account}
          required
          hint={!accountId ? (kind === 'sale' ? 'Elegí en qué cuenta entró la plata para poder guardar.' : 'Elegí de qué cuenta salió la plata para poder guardar.') : undefined}
        >
          <AccountSelect value={accountId} onChange={setAccountId} placeholder="Elegí una cuenta…" />
        </Field>
        <Field label="Fecha">
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="Nota (opcional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Ej: ${c.verb} por transferencia`} />
        </Field>
      </div>
    </Modal>
  )
}
