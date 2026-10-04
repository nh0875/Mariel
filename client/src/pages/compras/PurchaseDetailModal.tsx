// Detalle de una compra: qué vinos entraron, cuánto costó cada botella de verdad (con flete),
// qué se pagó y qué falta. Desde acá se registra un pago, se edita o se borra.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, FileText, HandCoins, Pencil, Trash2, Truck } from 'lucide-react'
import clsx from 'clsx'
import { safeDiv } from '@shared/calc'
import type { Product } from '@shared/types'
import { ApiError, api } from '@/lib/api'
import { boxes, dateLong, date as fmtDate, money, pct } from '@/lib/format'
import { useApi, useApiMutation, useSettings } from '@/lib/queries'
import { Badge, Button, ErrorState, InfoTip, Loading, Modal, StatusBadge, useConfirm } from '@/components/ui'
import { SettlementModal } from '@/components/forms/SettlementModal'
import { SummaryLine } from './parts'
import type { PurchaseDetailOut } from './types'

export function PurchaseDetailModal({ purchaseId, onClose, onEdit }: { purchaseId: number | null; onClose: () => void; onEdit: (p: PurchaseDetailOut) => void }) {
  const open = purchaseId != null
  // Compra recién borrada: dejamos de pedirla al toque (si no, se refresca y da "no encontrada").
  const [gone, setGone] = useState<number | null>(null)
  const q = useApi<PurchaseDetailOut>(`/purchases/${purchaseId}`, undefined, { enabled: open && purchaseId !== gone, retry: false })
  const { data: products = [] } = useApi<Product[]>('/products', {}, { enabled: open })
  const { data: settings } = useSettings()
  const confirm = useConfirm()
  const [settling, setSettling] = useState(false)
  const p = q.data && q.data.id === purchaseId ? q.data : undefined

  const remove = useApiMutation(
    async (id: number) => {
      setGone(id)
      onClose()
      await api.del(`/purchases/${id}`)
      return id
    },
    { success: (id) => `Compra #${id} borrada. Las botellas salieron del stock y el costo de cada vino se recalculó.` },
  )

  const removePayment = useApiMutation(
    async (pay: { id: number }) => {
      try {
        await api.del(`/purchases/${p!.id}/payments/${pay.id}`)
        return 'ok' as const
      } catch (e) {
        // Si el pago ya no existe (lo borraron desde Caja), simplemente refrescamos.
        if (e instanceof ApiError && e.status === 404) return 'gone' as const
        throw e
      }
    },
    {
      success: (r) =>
        r === 'gone'
          ? 'Ese pago ya no estaba (quizás lo borraste desde Caja). Actualizamos la compra.'
          : 'Pago borrado. La plata volvió a la cuenta y la compra vuelve a tener saldo.',
    },
  )

  const askDelete = async () => {
    if (!p) return
    // ¿Alguno de estos vinos quedaría con stock negativo? (ya vendiste parte de las botellas)
    const negatives = p.items
      .map((i) => {
        const prod = products.find((x) => x.id === i.product_id)
        return prod && prod.stock - i.qty < 0 ? { name: i.product_name, left: prod.stock - i.qty } : null
      })
      .filter((x): x is { name: string; left: number } => !!x)
    const ok = await confirm({
      title: `¿Borrar la compra #${p.id}?`,
      message: (
        <div className="space-y-2">
          <p>Esto es lo que va a pasar:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Salen del stock las {p.bottles} botellas que entraron con esta compra.</li>
            <li>
              Se recalcula el costo promedio de {p.items.length === 1 ? p.items[0].product_name : `${p.items.length} vinos`} (y el costo de las ventas que se hicieron después).
            </li>
            {p.paid > 0 && <li>Se borran los pagos ({money(p.paid)}): la plata vuelve a las cuentas.</li>}
          </ul>
          {negatives.length > 0 && (
            <p className="flex gap-1.5 rounded-xl bg-warn-soft px-3 py-2 font-semibold text-ink">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <span>
                Ojo: ya vendiste parte de estas botellas. {negatives.map((n) => `${n.name} quedaría en ${n.left}`).join(', ')}. Si la compra está mal cargada, mejor editala.
              </span>
            </p>
          )}
          <p className="font-semibold text-ink">No se puede deshacer.</p>
        </div>
      ),
      confirmText: 'Sí, borrar la compra',
      danger: true,
    })
    if (ok) remove.mutate(p.id)
  }

  const askDeletePayment = async (pay: { id: number; amount: number; account_name: string | null }) => {
    const ok = await confirm({
      title: '¿Borrar este pago?',
      message: `Vuelven ${money(pay.amount)} a «${pay.account_name ?? 'la cuenta'}» y la compra queda con ese saldo por pagar.`,
      confirmText: 'Sí, borrar el pago',
      danger: true,
    })
    if (ok) removePayment.mutate(pay)
  }

  const notFound = q.error instanceof ApiError && q.error.status === 404
  const hasBalance = !!p && p.balance > 0.009
  const defaultAccount = settings?.payment_methods.find((m) => m.key === 'transferencia')?.account_id ?? null
  const avgLanded = p ? safeDiv(p.total, p.bottles) : 0
  const perBox = p?.items[0]?.units_per_box ?? 6

  return (
    <>
      <Modal
        open={open && !settling}
        onClose={onClose}
        size="lg"
        title={p ? `Compra #${p.id}` : 'Compra'}
        subtitle={p ? `${dateLong(p.date)} · ${p.supplier_name || 'Sin proveedor'}` : undefined}
        footer={
          p ? (
            <>
              <Button variant="ghost" icon={Trash2} className="mr-auto text-bad hover:bg-bad-soft hover:text-bad" onClick={askDelete} loading={remove.isPending}>
                Borrar
              </Button>
              <Button variant={hasBalance ? 'secondary' : 'primary'} icon={Pencil} onClick={() => onEdit(p)}>
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
          <ErrorState error={notFound ? new Error('No encontramos esa compra. Puede que se haya borrado.') : q.error} onRetry={notFound ? undefined : () => q.refetch()} />
        )}
        {p && (
          <div className="space-y-6">
            {/* Estado y datos */}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={p.status} overdue={p.overdue} kind="pay" />
              {p.invoice_number && <Badge icon={<FileText size={13} aria-hidden />}>Factura {p.invoice_number}</Badge>}
              {p.supplier_id && (
                <Link to={`/proveedores/${p.supplier_id}`} className="inline-flex items-center gap-1 text-[13.5px] font-bold text-sky-deep hover:underline">
                  <Truck size={14} aria-hidden /> Ficha del proveedor
                </Link>
              )}
            </div>

            {/* Números grandes */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { label: 'Total', value: money(p.total), tone: '' },
                { label: 'Pagado', value: money(p.paid), tone: '' },
                { label: 'Falta pagar', value: money(p.balance), tone: hasBalance ? 'text-warn' : 'text-good' },
              ].map((x) => (
                <div key={x.label} className="min-w-0 rounded-2xl bg-cream-deep px-3 py-2.5 sm:px-4">
                  <p className="text-[12.5px] font-bold text-ink-soft">{x.label}</p>
                  <p className={clsx('vh-num truncate text-[1.1rem] font-extrabold text-ink sm:text-[1.35rem]', x.tone)} title={x.value}>
                    {x.value}
                  </p>
                </div>
              ))}
            </div>
            {hasBalance && p.due_date && (
              <p className={clsx('-mt-3 text-[13.5px]', p.overdue ? 'font-bold text-bad' : 'text-ink-soft')}>
                {p.overdue ? `Venció el ${fmtDate(p.due_date)}: conviene pagarla o hablar con el proveedor.` : `Vence el ${fmtDate(p.due_date)}.`}
              </p>
            )}

            {/* Vinos */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[16px] font-extrabold text-ink">
                Qué vinos entraron
                <InfoTip
                  title="Costo real por botella"
                  text="Es el precio de la factura más la parte del flete que le toca a cada botella (el flete se reparte según el precio de cada vino). Con ese costo entra la botella al stock y se promedia con lo que ya tenías."
                />
              </h3>
              <div className="vh-scroll overflow-x-auto rounded-2xl border border-line bg-paper">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="border-b border-line bg-cream/70 text-[12px] font-extrabold tracking-wide text-ink-soft uppercase">
                      <th className="px-3 py-2 text-left">Vino</th>
                      <th className="px-3 py-2 text-right">Botellas</th>
                      <th className="hidden px-3 py-2 text-right sm:table-cell">Factura c/u</th>
                      <th className="hidden px-3 py-2 text-right sm:table-cell">Flete c/u</th>
                      <th className="px-3 py-2 text-right">Costo real c/u</th>
                      <th className="hidden px-3 py-2 text-right md:table-cell">Total real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.items.map((i) => (
                      <tr key={i.id} className="border-b border-line/70 last:border-0">
                        <td className="px-3 py-2">
                          <Link to={`/vinos/${i.product_id}`} className="font-semibold text-ink hover:underline">
                            {i.product_name}
                          </Link>
                          {i.winery && <span className="block text-[12px] text-muted">{i.winery}</span>}
                          <span className="block text-[12px] text-muted sm:hidden">
                            Factura {money(i.unit_cost)}
                            {i.freight_per_bottle > 0 ? ` + flete ${money(i.freight_per_bottle)}` : ''}
                          </span>
                        </td>
                        <td className="vh-num px-3 py-2 text-right">
                          {i.qty}
                          {i.qty >= i.units_per_box && i.units_per_box > 1 && (
                            <span className="block text-[11.5px] whitespace-nowrap text-muted">{boxes(i.qty, i.units_per_box)}</span>
                          )}
                        </td>
                        <td className="vh-num hidden px-3 py-2 text-right whitespace-nowrap sm:table-cell">{money(i.unit_cost)}</td>
                        <td className="vh-num hidden px-3 py-2 text-right whitespace-nowrap text-ink-soft sm:table-cell">
                          {i.freight_per_bottle > 0 ? `+ ${money(i.freight_per_bottle)}` : '—'}
                        </td>
                        <td className="vh-num px-3 py-2 text-right font-bold whitespace-nowrap">{money(i.landed_unit_cost)}</td>
                        <td className="vh-num hidden px-3 py-2 text-right whitespace-nowrap md:table-cell">{money(i.landed_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-6 sm:grid-cols-2">
              {/* Cuentas de la compra */}
              <section>
                <h3 className="mb-1 text-[16px] font-extrabold text-ink">La cuenta</h3>
                <SummaryLine label={`Vinos (${p.bottles} botellas)`} value={money(p.subtotal)} muted />
                <SummaryLine
                  label={
                    <>
                      Flete / envío <InfoTip term="flete_prorrateado" />
                    </>
                  }
                  value={`+ ${money(p.shipping)}`}
                  muted
                />
                <div className="mt-1 border-t border-line pt-1">
                  <SummaryLine label="Total" value={money(p.total)} strong />
                </div>
                <p className="mt-1 text-[13px] text-ink-soft">
                  {p.bottles >= perBox && perBox > 1 ? `≈ ${boxes(p.bottles, perBox)} · ` : ''}costo real promedio <b className="vh-num text-ink">{money(avgLanded)}</b> por botella
                  {p.shipping > 0 && p.subtotal > 0 && <> (el flete sumó un {pct(p.shipping / p.subtotal)})</>}.
                </p>
                <p className="mt-3 rounded-xl bg-mustard-soft/70 px-3 py-2 text-[13px] leading-snug text-ink-soft">
                  <b className="text-ink">No es un gasto:</b> estos {money(p.total, { decimals: 0 })} pasaron a ser botellas en tu depósito. Cuentan como costo (CMV) a medida que
                  las vendés.
                </p>
              </section>

              {/* Pagos */}
              <section>
                <h3 className="mb-1 text-[16px] font-extrabold text-ink">Pagos</h3>
                {p.payments.length === 0 ? (
                  <p className="rounded-xl bg-cream-deep px-3.5 py-3 text-[14px] text-ink-soft">
                    Todavía no registraste ningún pago. Cuando le pagues al proveedor, tocá <b className="text-ink">Registrar pago</b> (se puede pagar en partes).
                  </p>
                ) : (
                  <ul className="divide-y divide-line/70">
                    {p.payments.map((pay) => (
                      <li key={pay.id} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[14.5px] font-semibold text-ink">
                            {fmtDate(pay.date)} · {pay.account_name ?? 'Cuenta'}
                          </p>
                          {pay.description && <p className="truncate text-[12.5px] text-muted">{pay.description}</p>}
                        </div>
                        <span className="vh-num font-bold whitespace-nowrap text-ink">{money(pay.amount)}</span>
                        <button
                          type="button"
                          onClick={() => askDeletePayment(pay)}
                          disabled={removePayment.isPending}
                          aria-label={`Borrar el pago de ${money(pay.amount)}`}
                          title="Borrar este pago"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-bad-soft hover:text-bad disabled:opacity-40"
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {p.notes && (
              <section className="rounded-xl bg-mustard-soft/70 px-4 py-3">
                <p className="vh-label mb-1 !text-mustard-deep">Nota</p>
                <p className="text-[14.5px] whitespace-pre-line text-ink">{p.notes}</p>
              </section>
            )}
          </div>
        )}
      </Modal>
      {p && (
        <SettlementModal
          kind="purchase"
          id={p.id}
          balance={p.balance}
          description={`Compra #${p.id} · ${p.supplier_name || 'Sin proveedor'}`}
          defaultAccountId={p.payments[p.payments.length - 1]?.account_id ?? defaultAccount}
          open={settling}
          onClose={() => setSettling(false)}
        />
      )}
    </>
  )
}
