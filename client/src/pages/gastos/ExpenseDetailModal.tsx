// Detalle de un gasto: cuánto es, cuánto pagaste, desde qué cuenta y qué falta.
// Desde acá se registra un pago (total o en partes), se edita o se borra.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarHeart, HandCoins, Pencil, Repeat, Trash2, Truck, X } from 'lucide-react'
import clsx from 'clsx'
import { ApiError, api } from '@/lib/api'
import { dateLong, date as fmtDate, monthName } from '@/lib/format'
import { useLocalState } from '@/lib/hooks'
import { useAccounts, useApi, useApiMutation } from '@/lib/queries'
import { Badge, Button, ErrorState, InfoTip, Loading, Modal, useConfirm } from '@/components/ui'
import { SettlementModal } from '@/components/forms/SettlementModal'
import { ExpenseStatusBadge, money } from './parts'
import { categoryIcon, NATURE_SHORT, NATURE_TERM, type ExpenseDetail, type ExpensePaymentRow } from './types'

export function ExpenseDetailModal({
  expenseId,
  onClose,
  onEdit,
  onShowRecurring,
}: {
  expenseId: number | null
  onClose: () => void
  onEdit: (e: ExpenseDetail) => void
  /** Ir a la pestaña "Gastos fijos del mes". */
  onShowRecurring: () => void
}) {
  const open = expenseId != null
  // Gasto recién borrado: dejamos de pedirlo al toque (si no, se refresca y da "no encontrado").
  const [gone, setGone] = useState<number | null>(null)
  const q = useApi<ExpenseDetail>(`/expenses/${expenseId}`, undefined, { enabled: open && expenseId !== gone, retry: false })
  const confirm = useConfirm()
  const [settling, setSettling] = useState(false)
  const [lastAccount] = useLocalState<number | null>('gastos.account', null)
  const { data: accounts = [] } = useAccounts()
  const templates = useApi<{ id: number; account_id: number | null }[]>('/recurring-expenses', undefined, { enabled: open })
  const e = q.data && q.data.id === expenseId ? q.data : undefined

  // Cuenta sugerida para "Registrar pago": la del último pago de este gasto; si no, la del gasto fijo
  // de donde salió; si no, la última que usaste para un gasto; si no, el banco; si no, la primera.
  const activeIds = new Set(accounts.filter((a) => a.active).map((a) => a.id))
  const pick = (id: number | null | undefined) => (id != null && activeIds.has(id) ? id : null)
  const suggestedAccount = e
    ? (pick(e.payments[e.payments.length - 1]?.account_id) ??
      pick(templates.data?.find((t) => t.id === e.recurring_id)?.account_id) ??
      pick(lastAccount) ??
      accounts.find((a) => a.active && a.kind === 'banco')?.id ??
      accounts.find((a) => a.active)?.id ??
      null)
    : null

  const remove = useApiMutation(
    async (id: number) => {
      setGone(id)
      onClose()
      await api.del(`/expenses/${id}`)
      return id
    },
    { success: 'Gasto borrado.' },
  )

  const removePayment = useApiMutation(
    async (p: ExpensePaymentRow) => {
      try {
        await api.del(`/expenses/${p.ref_id}/payments/${p.id}`)
        return 'ok' as const
      } catch (err) {
        // Si el pago ya no existe (lo borraron desde Caja), simplemente refrescamos.
        if (err instanceof ApiError && err.status === 404) return 'gone' as const
        throw err
      }
    },
    {
      success: (r) => (r === 'gone' ? 'Ese pago ya no estaba (quizás lo borraste desde Caja). Actualizamos el gasto.' : 'Pago borrado. El gasto vuelve a tener ese saldo por pagar.'),
    },
  )

  const askDelete = async () => {
    if (!e) return
    const ok = await confirm({
      title: '¿Borrar este gasto?',
      message: (
        <div className="space-y-2">
          <p>
            «{e.description}» por <b>{money(e.amount)}</b>. Esto es lo que va a pasar:
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Deja de contar en los gastos y en el resultado de {monthName(e.date.slice(0, 7))}.</li>
            {e.paid > 0 && <li>Se borran sus pagos: los {money(e.paid)} vuelven a la cuenta de donde salieron.</li>}
            {e.recurring_id && (
              <li>
                Venía de un gasto fijo: la plantilla sigue. Si volvés a tocar «Generar» para {monthName(e.date.slice(0, 7))}, se vuelve a crear.
              </li>
            )}
          </ul>
          <p className="font-semibold text-ink">No se puede deshacer.</p>
        </div>
      ),
      confirmText: 'Sí, borrar el gasto',
      danger: true,
    })
    if (ok) remove.mutate(e.id)
  }

  const askDeletePayment = async (p: ExpensePaymentRow) => {
    const ok = await confirm({
      title: '¿Borrar este pago?',
      message: `Vuelven ${money(p.amount)} a «${p.account_name ?? 'la cuenta'}» y el gasto queda con ese saldo por pagar.`,
      confirmText: 'Sí, borrar el pago',
      danger: true,
    })
    if (ok) removePayment.mutate(p)
  }

  const notFound = q.error instanceof ApiError && q.error.status === 404
  const hasBalance = !!e && e.balance > 0.009
  const Icon = e ? categoryIcon(e.category) : null

  return (
    <>
      <Modal
        open={open && !settling}
        onClose={onClose}
        size="md"
        title={e ? e.description : 'Gasto'}
        subtitle={e ? `${dateLong(e.date)} · ${e.category}` : undefined}
        footer={
          e ? (
            <>
              <Button variant="ghost" icon={Trash2} className="mr-auto text-bad hover:bg-bad-soft hover:text-bad" onClick={askDelete} loading={remove.isPending}>
                Borrar
              </Button>
              <Button variant={hasBalance ? 'secondary' : 'primary'} icon={Pencil} onClick={() => onEdit(e)}>
                Editar
              </Button>
              {hasBalance && (
                <Button variant="primary" icon={HandCoins} onClick={() => setSettling(true)}>
                  Registrar pago
                </Button>
              )}
            </>
          ) : (
            <Button onClick={onClose}>Cerrar</Button>
          )
        }
      >
        {q.isLoading && <Loading />}
        {q.error && (
          <ErrorState error={notFound ? new Error('No encontramos ese gasto. Puede que se haya borrado.') : q.error} onRetry={notFound ? undefined : () => q.refetch()} />
        )}
        {e && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ExpenseStatusBadge status={e.status} overdue={e.overdue} />
              <Badge tone={e.nature === 'fijo' ? 'coral' : 'mustard'}>
                Gasto {NATURE_SHORT[e.nature].toLowerCase()}
              </Badge>
              <InfoTip term={NATURE_TERM[e.nature]} />
              {Icon && (
                <Badge icon={<Icon size={13} aria-hidden />} className="max-w-full">
                  <span className="truncate">{e.category}</span>
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { label: 'Monto', value: money(e.amount), tone: '' },
                { label: 'Pagado', value: money(e.paid), tone: '' },
                { label: 'Falta pagar', value: money(e.balance), tone: hasBalance ? 'text-warn' : 'text-good' },
              ].map((x) => (
                <div key={x.label} className="min-w-0 rounded-2xl bg-cream-deep px-3 py-2.5 sm:px-4">
                  <p className="text-[12.5px] font-bold text-ink-soft">{x.label}</p>
                  {/* Montos muy largos: letra más chica y que corte en renglones en vez de esconder cifras con "…". */}
                  <p
                    className={clsx(
                      'vh-num font-extrabold break-all text-ink',
                      x.value.length > 13 ? 'text-[0.95rem] leading-tight' : 'text-[1.1rem] sm:text-[1.3rem]',
                      x.tone,
                    )}
                    title={x.value}
                  >
                    {x.value}
                  </p>
                </div>
              ))}
            </div>
            {hasBalance && e.due_date && (
              <p className={clsx('-mt-2 text-[13.5px]', e.overdue ? 'font-bold text-bad' : 'text-ink-soft')}>
                {e.overdue ? `Venció el ${fmtDate(e.due_date)}: conviene pagarlo cuanto antes (pueden cobrarte recargo).` : `Vence el ${fmtDate(e.due_date)}.`}
              </p>
            )}

            {(e.supplier_id || e.event_id || e.recurring) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13.5px]">
                {e.supplier_id && (
                  <Link to={`/proveedores/${e.supplier_id}`} className="inline-flex items-center gap-1 font-bold text-sky-deep hover:underline">
                    <Truck size={14} aria-hidden /> {e.supplier_name}
                  </Link>
                )}
                {e.event_id && (
                  <Link to={`/eventos/${e.event_id}`} className="inline-flex items-center gap-1 font-bold text-sky-deep hover:underline">
                    <CalendarHeart size={14} aria-hidden /> {e.event_name}
                  </Link>
                )}
                {e.recurring && (
                  <button type="button" onClick={onShowRecurring} className="inline-flex items-center gap-1 font-bold text-sky-deep hover:underline">
                    <Repeat size={14} aria-hidden /> Gasto fijo: {e.recurring.description}
                    {!e.recurring.active && <span className="font-semibold text-muted">(pausado)</span>}
                  </button>
                )}
              </div>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[16px] font-extrabold text-ink">
                Pagos
                <InfoTip
                  title="Pagos de este gasto"
                  text="Cada pago es plata que salió de una de tus cuentas (Caja, Banco, Mercado Pago). Un gasto se puede pagar en partes: el saldo es lo que todavía debés. Si cargaste mal un pago, borralo con la ✕ y volvé a registrarlo."
                />
              </h3>
              {e.payments.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line-strong px-4 py-4 text-center text-[14px] text-ink-soft">
                  Todavía no registraste ningún pago. Cuando lo pagues, tocá <b>«Registrar pago»</b> y elegí de qué cuenta salió la plata.
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-2xl border border-line bg-paper">
                  {e.payments.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-[14.5px]">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">
                          {fmtDate(p.date)} · {p.account_name ?? 'Cuenta'}
                        </p>
                        {p.description && p.description !== e.description && <p className="truncate text-[13px] text-muted">{p.description}</p>}
                      </div>
                      <span className="vh-num shrink-0 font-bold text-ink">{money(p.amount)}</span>
                      <button
                        type="button"
                        onClick={() => askDeletePayment(p)}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-bad-soft hover:text-bad"
                        aria-label={`Borrar el pago de ${money(p.amount)} del ${fmtDate(p.date)}`}
                        title="Borrar este pago"
                      >
                        <X size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {e.notes && (
              <section>
                <h3 className="mb-1 text-[16px] font-extrabold text-ink">Notas</h3>
                <p className="text-[14.5px] whitespace-pre-line text-ink-soft">{e.notes}</p>
              </section>
            )}

            <p className="rounded-2xl bg-mustard-soft/70 px-4 py-3 text-[13.5px] leading-snug text-ink-soft">
              <b className="text-ink">¿Cómo cuenta este gasto?</b> En el resultado de <b className="text-ink">{monthName(e.date.slice(0, 7))}</b> como gasto {e.nature}, por la fecha del gasto
              (aunque lo pagues después). En la caja, la plata sale recién el día de cada pago. <InfoTip term="devengado_percibido" className="align-[-2px]" />
            </p>
          </div>
        )}
      </Modal>
      {e && (
        <SettlementModal
          kind="expense"
          id={e.id}
          balance={e.balance}
          description={`${e.description} · ${e.category}`}
          defaultAccountId={suggestedAccount}
          open={settling}
          onClose={() => setSettling(false)}
        />
      )}
    </>
  )
}
