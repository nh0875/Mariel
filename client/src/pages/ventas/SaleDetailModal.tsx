// Detalle de una venta: qué se llevó, cuánto te costó, cuánto te dejó y qué falta cobrar.
// Desde acá se registra un cobro, se edita, se borra o se imprime el comprobante.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarHeart, HandCoins, Pencil, Printer, Trash2, UserRound } from 'lucide-react'
import clsx from 'clsx'
import { round2, safeDiv } from '@shared/calc'
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@shared/constants'
import type { Payment, SaleDetail } from '@shared/types'
import { ApiError, api } from '@/lib/api'
import { dateLong, date as fmtDate, money, pct } from '@/lib/format'
import { useAccounts, useApi, useApiMutation, useSettings } from '@/lib/queries'
import { Badge, Button, ErrorState, InfoTip, Loading, Modal, StatusBadge, useConfirm } from '@/components/ui'
import { SettlementModal } from '@/components/forms/SettlementModal'
import { channelLabel, openReceipt } from './types'

function Row({ label, value, strong, tone }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3 py-1 text-[14.5px]', strong ? 'font-extrabold text-ink' : 'text-ink-soft')}>
      <span className="flex min-w-0 items-center gap-1">{label}</span>
      <span className={clsx('vh-num shrink-0 whitespace-nowrap', tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : strong && 'text-ink')}>{value}</span>
    </div>
  )
}

export function SaleDetailModal({
  saleId,
  onClose,
  onEdit,
}: {
  saleId: number | null
  onClose: () => void
  onEdit: (sale: SaleDetail) => void
}) {
  const open = saleId != null
  // Venta recién borrada: dejamos de pedirla al toque (si no, se refresca y da "no encontrada").
  const [gone, setGone] = useState<number | null>(null)
  const q = useApi<SaleDetail>(`/sales/${saleId}`, undefined, { enabled: open && saleId !== gone, retry: false })
  const { data: accounts = [] } = useAccounts()
  const { data: settings } = useSettings()
  const confirm = useConfirm()
  const [settling, setSettling] = useState(false)
  const s = q.data && q.data.id === saleId ? q.data : undefined

  const methodLabel = (m: string) => settings?.payment_methods.find((x) => x.key === m)?.label || PAYMENT_METHOD_LABELS[m as PaymentMethod] || m
  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? 'Cuenta'
  const defaultAccount = s ? (settings?.payment_methods.find((m) => m.key === s.payment_method)?.account_id ?? null) : null

  const remove = useApiMutation(
    async (id: number) => {
      // Cerramos el detalle antes de borrar, así no se vuelve a pedir una venta que ya no existe.
      setGone(id)
      onClose()
      await api.del(`/sales/${id}`)
      return id
    },
    { success: (id) => `Venta #${id} borrada. Las botellas volvieron al stock.` },
  )

  const removePayment = useApiMutation(
    async (p: Payment) => {
      try {
        await api.del(`/payments/${p.id}`)
        return 'ok' as const
      } catch (e) {
        // Si el cobro ya no existe (lo borraron desde Caja), simplemente refrescamos.
        if (e instanceof ApiError && e.status === 404) return 'gone' as const
        throw e
      }
    },
    {
      success: (r) => (r === 'gone' ? 'Ese cobro ya no estaba (quizás lo borraste desde Caja). Actualizamos la venta.' : 'Cobro borrado. La venta vuelve a tener saldo por cobrar.'),
    },
  )

  const askDelete = async () => {
    if (!s) return
    const ok = await confirm({
      title: `¿Borrar la venta #${s.id}?`,
      message: (
        <div className="space-y-2">
          <p>Esto es lo que va a pasar:</p>
          <ul className="ml-4 list-disc space-y-1">
            {s.bottles > 0 && <li>Las {s.bottles} botellas vuelven al stock.</li>}
            {s.paid > 0 && <li>Se borran los cobros ({money(s.paid)}) y su comisión de las cuentas.</li>}
            <li>Deja de contar en las ventas y la ganancia del período.</li>
          </ul>
          <p className="font-semibold text-ink">No se puede deshacer.</p>
        </div>
      ),
      confirmText: 'Sí, borrar la venta',
      danger: true,
    })
    if (ok) remove.mutate(s.id)
  }

  const askDeletePayment = async (p: Payment) => {
    const ok = await confirm({
      title: '¿Borrar este cobro?',
      message: `Sale ${money(p.amount)} de «${accountName(p.account_id)}» y la venta vuelve a quedar con ese saldo por cobrar. La comisión se recalcula sola.`,
      confirmText: 'Sí, borrar el cobro',
      danger: true,
    })
    if (ok) removePayment.mutate(p)
  }

  const notFound = q.error instanceof ApiError && q.error.status === 404
  const hasBalance = !!s && s.balance > 0.009
  const margin = s ? safeDiv(s.profit, s.total) : 0

  return (
    <>
      <Modal
        open={open && !settling}
        onClose={onClose}
        size="lg"
        title={s ? `Venta #${s.id}` : 'Venta'}
        subtitle={s ? `${dateLong(s.date)} · ${s.client_name || 'Consumidor final'}` : undefined}
        footer={
          s ? (
            <>
              <Button variant="ghost" icon={Trash2} className="mr-auto text-bad hover:bg-bad-soft hover:text-bad" onClick={askDelete} loading={remove.isPending}>
                Borrar
              </Button>
              <Button icon={Printer} onClick={() => openReceipt(s.id)} title="Abre un comprobante para imprimir o guardar en PDF">
                <span className="hidden sm:inline">Imprimir comprobante</span>
                <span className="sm:hidden">Imprimir</span>
              </Button>
              <Button variant={hasBalance ? 'secondary' : 'primary'} icon={Pencil} onClick={() => onEdit(s)}>
                Editar
              </Button>
              {hasBalance && (
                <Button variant="primary" icon={HandCoins} onClick={() => setSettling(true)}>
                  Registrar cobro
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
          <ErrorState
            error={notFound ? new Error('No encontramos esa venta. Puede que se haya borrado.') : q.error}
            onRetry={notFound ? undefined : () => q.refetch()}
          />
        )}
        {s && (
          <div className="space-y-6">
            {/* Estado y datos */}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={s.status} overdue={s.overdue} kind="sale" />
              <Badge>{channelLabel(s.channel)}</Badge>
              <Badge>{methodLabel(s.payment_method)}</Badge>
              {s.client_id && (
                <Link to={`/clientes/${s.client_id}`} className="inline-flex items-center gap-1 text-[13.5px] font-bold text-sky-deep hover:underline">
                  <UserRound size={14} aria-hidden /> Ficha del cliente
                </Link>
              )}
              {s.event_id && (
                <Link to={`/eventos/${s.event_id}`} className="inline-flex items-center gap-1 text-[13.5px] font-bold text-sky-deep hover:underline">
                  <CalendarHeart size={14} aria-hidden /> {s.event_name}
                </Link>
              )}
            </div>

            {/* Números grandes */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { label: 'Total', value: money(s.total), tone: '' },
                { label: 'Cobrado', value: money(s.paid), tone: '' },
                { label: hasBalance ? 'Falta cobrar' : 'Falta cobrar', value: money(s.balance), tone: hasBalance ? 'text-warn' : 'text-good' },
              ].map((x) => (
                <div key={x.label} className="rounded-2xl bg-cream-deep px-3 py-2.5 sm:px-4">
                  <p className="text-[12.5px] font-bold text-ink-soft">{x.label}</p>
                  <p className={clsx('vh-num truncate text-[1.15rem] font-extrabold text-ink sm:text-[1.35rem]', x.tone)}>{x.value}</p>
                </div>
              ))}
            </div>
            {hasBalance && s.due_date && (
              <p className={clsx('-mt-3 text-[13.5px]', s.overdue ? 'font-bold text-bad' : 'text-ink-soft')}>
                {s.overdue ? `Venció el ${fmtDate(s.due_date)}: conviene reclamarla.` : `Vence el ${fmtDate(s.due_date)}.`}
              </p>
            )}

            {/* Renglones */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[16px] font-extrabold text-ink">
                Qué se llevó
                <InfoTip
                  title="Costo y ganancia por vino"
                  text="El costo es el de cada botella el día de la venta (costo promedio de tus compras). Queda congelado: si después el vino aumenta, esta venta conserva su ganancia real. La ganancia de cada renglón es (precio − costo) × cantidad, antes del descuento, el envío y la comisión de toda la venta (esos van abajo, en «Cuánto te dejó»)."
                />
              </h3>
              <div className="vh-scroll overflow-x-auto rounded-2xl border border-line bg-paper">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="border-b border-line bg-cream/70 text-[12px] font-extrabold tracking-wide text-ink-soft uppercase">
                      <th className="px-3 py-2 text-left">Vino / ítem</th>
                      <th className="px-3 py-2 text-right">Cant.</th>
                      <th className="px-3 py-2 text-right">Precio</th>
                      <th className="hidden px-3 py-2 text-right sm:table-cell">Costo</th>
                      <th className="px-3 py-2 text-right">Subtotal</th>
                      <th className="hidden px-3 py-2 text-right sm:table-cell">Ganancia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.items.map((i) => {
                      const sub = round2(i.qty * i.unit_price)
                      const profit = round2(i.qty * (i.unit_price - i.unit_cost))
                      return (
                        <tr key={i.id} className="border-b border-line/70 last:border-0">
                          <td className="px-3 py-2">
                            {i.product_id ? (
                              <Link to={`/vinos/${i.product_id}`} className="font-semibold text-ink hover:underline">
                                {i.product_name ?? 'Vino'}
                              </Link>
                            ) : (
                              <span className="font-semibold text-ink">{i.description}</span>
                            )}
                            {!i.product_id && <span className="block text-[12px] text-muted">No es vino del stock</span>}
                          </td>
                          <td className="vh-num px-3 py-2 text-right">{i.qty}</td>
                          <td className="vh-num px-3 py-2 text-right whitespace-nowrap">{money(i.unit_price)}</td>
                          <td className="vh-num hidden px-3 py-2 text-right whitespace-nowrap text-ink-soft sm:table-cell">{i.product_id ? money(i.unit_cost) : '—'}</td>
                          <td className="vh-num px-3 py-2 text-right font-bold whitespace-nowrap">{money(sub)}</td>
                          <td className={clsx('vh-num hidden px-3 py-2 text-right whitespace-nowrap sm:table-cell', profit < 0 ? 'text-bad' : 'text-good')}>{money(profit)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-6 sm:grid-cols-2">
              {/* Cuentas de la venta */}
              <section>
                <h3 className="mb-1 text-[16px] font-extrabold text-ink">Cuánto te dejó</h3>
                <Row label="Vinos e ítems" value={money(s.subtotal)} />
                {s.discount > 0 && <Row label="Descuento" value={`− ${money(s.discount)}`} />}
                {s.shipping > 0 && <Row label="Envío cobrado" value={`+ ${money(s.shipping)}`} />}
                <Row label="Total" value={money(s.total)} strong />
                <Row
                  label={
                    <>
                      Costo de las botellas <InfoTip term="cmv" />
                    </>
                  }
                  value={`− ${money(s.cost)}`}
                />
                <Row
                  label={
                    <>
                      Comisión ({methodLabel(s.payment_method)}) <InfoTip term="comisiones" />
                    </>
                  }
                  value={`− ${money(s.fee)}`}
                />
                <div className="mt-1 border-t border-line pt-1">
                  <Row
                    strong
                    label={
                      <>
                        Te quedó
                        <InfoTip title="Ganancia de la venta" text="Total − costo de las botellas − comisión. Todavía no descuenta gastos fijos (alquiler, sueldos): el resultado final está en Reportes." />
                      </>
                    }
                    value={money(s.profit)}
                    tone={s.profit < 0 ? 'bad' : 'good'}
                  />
                  <p className="text-right text-[13px] text-muted">Margen {pct(margin)}</p>
                </div>
              </section>

              {/* Cobros */}
              <section>
                <h3 className="mb-1 text-[16px] font-extrabold text-ink">Cobros</h3>
                {s.payments.length === 0 ? (
                  <p className="rounded-xl bg-cream-deep px-3.5 py-3 text-[14px] text-ink-soft">
                    Todavía no registraste ningún cobro. Cuando te paguen, tocá <b className="text-ink">Registrar cobro</b> (se puede cobrar en partes).
                  </p>
                ) : (
                  <ul className="divide-y divide-line/70">
                    {s.payments.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[14.5px] font-semibold text-ink">
                            {fmtDate(p.date)} · {accountName(p.account_id)}
                          </p>
                          {p.description && <p className="truncate text-[12.5px] text-muted">{p.description}</p>}
                        </div>
                        <span className="vh-num font-bold whitespace-nowrap text-ink">{money(p.amount)}</span>
                        <button
                          type="button"
                          onClick={() => askDeletePayment(p)}
                          disabled={removePayment.isPending}
                          aria-label={`Borrar el cobro de ${money(p.amount)}`}
                          title="Borrar este cobro"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-bad-soft hover:text-bad disabled:opacity-40"
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {s.fee > 0 && s.paid > 0 && (
                  <p className="mt-2 text-[12.5px] text-muted">
                    La comisión se descuenta sola de la cuenta en cada cobro, en proporción a lo cobrado.
                  </p>
                )}
              </section>
            </div>

            {s.notes && (
              <section className="rounded-xl bg-mustard-soft/70 px-4 py-3">
                <p className="vh-label mb-1 !text-mustard-deep">Nota</p>
                <p className="text-[14.5px] whitespace-pre-line text-ink">{s.notes}</p>
              </section>
            )}
          </div>
        )}
      </Modal>
      {s && (
        <SettlementModal
          kind="sale"
          id={s.id}
          balance={s.balance}
          description={`Venta #${s.id} · ${s.client_name || 'Consumidor final'}`}
          defaultAccountId={defaultAccount}
          open={settling}
          onClose={() => setSettling(false)}
        />
      )}
    </>
  )
}
