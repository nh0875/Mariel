// "Registrar cobro" (ventas) / "Registrar pago" (compras y gastos), total o parcial.
// Lo usan Ventas, Compras, Gastos y Caja (pendientes).
import { useEffect, useState } from 'react'
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@shared/constants'
import { today } from '@shared/dates'
import { api } from '@/lib/api'
import { money, pct } from '@/lib/format'
import { useApiMutation, useSettings } from '@/lib/queries'
import { AccountSelect, Button, DateInput, Field, Modal, MoneyInput, Select, TextInput } from '@/components/ui'

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
  sale,
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
  /**
   * Solo ventas: su medio de pago, total, comisión y lo ya cobrado. Con esto se pregunta «¿Cómo te
   * pagó?»: si la venta no tenía cobros y te pagó por otro medio (ej. Mercado Pago), la venta pasa a
   * ese medio y se descuenta su comisión.
   */
  sale?: { payment_method: string; total: number; fee: number; paid: number }
}) {
  const c = CONFIG[kind]
  const { data: settings } = useSettings()
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState<number | null>(balance)
  const [accountId, setAccountId] = useState<number | null>(defaultAccountId ?? null)
  const [accountTouched, setAccountTouched] = useState(false)
  const [method, setMethod] = useState<string | null>(sale?.payment_method ?? null)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) {
      setDate(today())
      setAmount(balance)
      setAccountId(defaultAccountId ?? null)
      setAccountTouched(false)
      setMethod(sale?.payment_method ?? null)
      setNote('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, balance, defaultAccountId])

  // ¿Cómo te pagó? (solo ventas)
  const methods = settings?.payment_methods ?? []
  const feePctOf = (m: string | null) => (m ? (methods.find((x) => x.key === m)?.fee_pct ?? 0) : 0)
  const methodLabel = (m: string) => methods.find((x) => x.key === m)?.label || PAYMENT_METHOD_LABELS[m as PaymentMethod] || m
  const methodChanged = !!sale && !!method && method !== sale.payment_method
  const canChangeMethod = !!sale && sale.paid <= 0.009
  // Comisión total de la venta con el medio elegido (si cambia y se puede recalcular) y la parte de este cobro.
  const autoOld = sale ? Math.round(sale.total * feePctOf(sale.payment_method)) / 100 : 0
  const feeWasAuto = !!sale && Math.abs(sale.fee - autoOld) < 0.01
  const saleFee = !sale ? 0 : methodChanged && canChangeMethod && feeWasAuto ? Math.round(sale.total * feePctOf(method)) / 100 : sale.fee
  const feeThis = sale && sale.total > 0 ? Math.round(((saleFee * (amount ?? 0)) / sale.total) * 100) / 100 : 0
  const pickMethod = (m: string) => {
    setMethod(m)
    // La plata entra en la cuenta de ese medio (Configuración → Medios de pago), salvo que ya hayas elegido otra.
    const acc = methods.find((x) => x.key === m)?.account_id
    if (!accountTouched && acc) setAccountId(acc)
  }

  const save = useApiMutation(
    () =>
      api.post(`/${c.path}/${id}/payments`, {
        date,
        amount: amount ?? 0,
        account_id: accountId,
        description: note || null,
        ...(sale && methodChanged ? { payment_method: method } : {}),
      }),
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
        {sale && (
          <Field
            label="¿Cómo te pagó?"
            hint={
              methodChanged && !canChangeMethod ? (
                <span className="font-semibold text-warn">
                  Esta venta ya tiene cobros y su comisión se calcula con {methodLabel(sale.payment_method)}. Si cambió el medio, editá la venta.
                </span>
              ) : feeThis > 0.004 ? (
                <>
                  {methodLabel(method ?? sale.payment_method)} se queda ≈ <b>{money(feeThis)}</b> de este cobro ({pct(feePctOf(method ?? sale.payment_method) / 100, 2)}): se descuenta solo de la
                  cuenta, así el saldo coincide con el de la app.{methodChanged ? ' La venta queda con ese medio de pago.' : ''}
                </>
              ) : methodChanged ? (
                `La venta queda con ${methodLabel(method!)}${feePctOf(method) > 0 ? '' : ' (sin comisión)'}.`
              ) : (
                'Si te pagó por otro medio (Mercado Pago, tarjeta…), cambialo: así se descuenta la comisión que corresponde.'
              )
            }
          >
            <Select value={method ?? sale.payment_method} onChange={pickMethod} options={methods.map((m) => ({ value: m.key, label: m.label || methodLabel(m.key) }))} />
          </Field>
        )}
        <Field
          label={c.account}
          required
          hint={!accountId ? (kind === 'sale' ? 'Elegí en qué cuenta entró la plata para poder guardar.' : 'Elegí de qué cuenta salió la plata para poder guardar.') : undefined}
        >
          <AccountSelect
            value={accountId}
            onChange={(v) => {
              setAccountTouched(true)
              setAccountId(v)
            }}
            placeholder="Elegí una cuenta…"
          />
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
