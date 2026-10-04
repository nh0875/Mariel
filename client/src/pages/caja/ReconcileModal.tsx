// Arqueo: contás la plata real de una cuenta y el sistema la compara con lo que tiene registrado.
// Si no coincide, registra un "Ajuste de saldo" por la diferencia (y explica por qué).
import { useEffect, useState, type FormEvent } from 'react'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { round2 } from '@shared/calc'
import { today } from '@shared/dates'
import { api } from '@/lib/api'
import { date as fmtDate, money } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/queries'
import { Button, DateInput, Field, Modal, MoneyInput } from '@/components/ui'
import type { AccountRow, ReconcileResult } from './types'

const COUNT_HINT: Record<AccountRow['kind'], string> = {
  efectivo: 'Contá billetes y monedas de la caja.',
  banco: 'Mirá el saldo en el home banking o en la app del banco.',
  billetera: 'Mirá el saldo disponible en la app.',
  otro: 'Fijate cuánto hay de verdad.',
}

export function ReconcileModal({ account, onClose }: { account: AccountRow | null; onClose: () => void }) {
  const open = !!account
  const [date, setDate] = useState(today())
  const [counted, setCounted] = useState<number | null>(null)

  useEffect(() => {
    if (open) {
      setDate(today())
      setCounted(null)
    }
  }, [open, account?.id])

  // Saldo del sistema al cierre de la fecha del arqueo: lo mismo que usa el servidor para calcular el ajuste.
  // (El saldo de la tarjeta incluye movimientos con fecha futura, si los hubiera; por eso siempre se pide a esa fecha.)
  const isToday = date === today()
  const future = !!date && date > today()
  const atDate = useApi<AccountRow[]>('/accounts', { as_of: date }, { enabled: open && !!date && !future })
  const system = future ? undefined : atDate.data?.find((a) => a.id === account?.id)?.balance
  const diff = counted != null && system != null ? round2(counted - system) : null

  const save = useApiMutation(() => api.post<ReconcileResult>(`/accounts/${account!.id}/reconcile`, { date, counted }), {
    success: (r) =>
      Math.abs(r.difference) < 0.005
        ? `¡Perfecto! ${account?.name} coincide con lo que contaste.`
        : `Ajuste registrado: ${r.difference > 0 ? 'sobraban' : 'faltaban'} ${money(Math.abs(r.difference))} en ${account?.name}.`,
    onSuccess: () => onClose(),
  })

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (counted == null || system == null || save.isPending) return
    save.mutate()
  }

  if (!account) return null
  const matches = diff != null && Math.abs(diff) < 0.005

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Arqueo de ${account.name}`}
      subtitle="Contá la plata real y la comparamos con lo que dice el sistema."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="reconcile-form" loading={save.isPending} disabled={counted == null || system == null}>
            {matches ? 'Listo, coincide' : diff != null ? 'Registrar el ajuste' : 'Registrar arqueo'}
          </Button>
        </>
      }
    >
      <form id="reconcile-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="¿Cuánta plata contaste?" info="arqueo" required hint={COUNT_HINT[account.kind]}>
            <MoneyInput value={counted} onChange={setCounted} aria-label="¿Cuánta plata contaste?" data-autofocus />
          </Field>
          <Field label="Fecha del arqueo" hint="Normalmente hoy, al cerrar la caja.">
            <DateInput value={date} onChange={setDate} max={today()} aria-label="Fecha del arqueo" />
          </Field>
        </div>

        <div className="rounded-xl bg-cream-deep px-3.5 py-3 text-[14.5px] text-ink">
          {future ? (
            <span className="text-bad">La fecha no puede ser futura: el arqueo es de plata que ya contaste.</span>
          ) : system == null ? (
            <span className="text-ink-soft">Buscando el saldo del sistema…</span>
          ) : (
            <>
              Según el sistema, {isToday ? 'hoy' : `al ${fmtDate(date)}`} {account.kind === 'efectivo' ? 'tendría que haber' : 'hay'} <b className="vh-num">{money(system)}</b> en {account.name}.
            </>
          )}
        </div>

        {diff != null &&
          (matches ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-good/30 bg-good-soft px-3.5 py-3 text-[14.5px] text-ink">
              <CircleCheck size={20} className="mt-0.5 shrink-0 text-good" aria-hidden />
              <p>
                <b>¡Coincide!</b> No hay nada que ajustar. Igual podés guardarlo para dejar constancia de que contaste.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn-soft px-3.5 py-3 text-[14.5px] text-ink">
              <TriangleAlert size={20} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <div className="space-y-1.5">
                <p className="text-[16px]">
                  <b>
                    {diff > 0 ? 'Sobran' : 'Faltan'} {money(Math.abs(diff))}
                  </b>
                </p>
                <p>
                  Vamos a registrar un <b>ajuste de saldo</b> de {diff > 0 ? 'entrada' : 'salida'} por {money(Math.abs(diff))}, así el sistema queda igual a lo que contaste. No cuenta como venta
                  ni como gasto.
                </p>
                {diff < 0 && (
                  <p className="text-ink-soft">
                    Antes de ajustar, pensá si te olvidaste de cargar algún gasto, una compra o un retiro: si es eso, cargalo primero y la diferencia se achica.
                  </p>
                )}
                {diff > 0 && <p className="text-ink-soft">¿Cobraste algo que no cargaste? Si fue una venta, cargala en Ventas en vez de ajustar.</p>}
              </div>
            </div>
          ))}
      </form>
    </Modal>
  )
}
