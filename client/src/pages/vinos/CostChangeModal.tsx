// "Cambiar costo": fija un costo nuevo por botella desde una fecha (movimiento "Cambio de costo").
// Casi nunca hace falta: el costo se actualiza solo con cada compra.
import { useEffect, useState, type FormEvent } from 'react'
import { today } from '@shared/dates'
import { marginOnPrice } from '@shared/calc'
import { api } from '@/lib/api'
import { money, pct } from '@/lib/format'
import { useApiMutation } from '@/lib/queries'
import { Button, DateInput, Field, Modal, MoneyInput, TextInput } from '@/components/ui'
import type { ProductRow } from './types'

export function CostChangeModal({ product, open, onClose }: { product: ProductRow; open: boolean; onClose: () => void }) {
  const [cost, setCost] = useState<number | null>(product.unit_cost)
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (open) {
      setCost(product.unit_cost)
      setDate(today())
      setNotes('')
    }
  }, [open, product.unit_cost])

  const save = useApiMutation(() => api.post<ProductRow>(`/products/${product.id}/cost`, { date, unit_cost: cost ?? 0, notes: notes || null }), {
    success: (r) => `Listo: «${r.name}» ahora cuesta ${money(r.unit_cost)} por botella`,
    onSuccess: onClose,
  })

  const changed = cost != null && Math.abs(cost - product.unit_cost) > 0.004
  const stock = Math.max(product.stock, 0)
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (changed && date) save.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cambiar costo"
      subtitle={`${product.name} · costo actual ${money(product.unit_cost)} por botella`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="costo-form" loading={save.isPending} disabled={!changed || !date}>
            Guardar costo nuevo
          </Button>
        </>
      }
    >
      <form id="costo-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="rounded-xl border border-mustard/50 bg-mustard-soft/70 px-4 py-3 text-[14px] leading-relaxed text-ink-soft">
          <p className="font-extrabold text-ink">¿Cuándo se usa?</p>
          <p className="mt-1">
            Casi nunca: el costo se actualiza <b className="text-ink">solo</b> con cada compra (costo promedio). Usalo si cargaste mal el costo inicial, si te hicieron una bonificación o nota de
            crédito, o para corregir un error.
          </p>
          <p className="mt-1.5">
            <b className="text-ink">¿Qué pasa?</b> Desde la fecha que elijas, cada botella vale el costo nuevo. Las ventas posteriores a esa fecha recalculan su costo (y tu ganancia). Si después hubo
            compras, se vuelven a promediar con ese costo.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Costo nuevo por botella" required htmlFor="costo-valor" info="costo_promedio">
            <MoneyInput id="costo-valor" value={cost} onChange={setCost} />
          </Field>
          <Field label="¿Desde cuándo?" htmlFor="costo-fecha" hint="Normalmente hoy. Si es una corrección vieja, la fecha del error.">
            <DateInput id="costo-fecha" value={date} onChange={setDate} />
          </Field>
          <Field label="Motivo" htmlFor="costo-nota" className="sm:col-span-2" hint="Opcional, pero ayuda a entender el cambio después.">
            <TextInput id="costo-nota" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: la bodega nos bonificó 10 %" />
          </Field>
        </div>
        {changed && cost != null && (
          <div className="rounded-xl bg-cream-deep/80 px-4 py-3 text-[14.5px] leading-relaxed text-ink-soft">
            {stock > 0 && (
              <p>
                Tus {stock} botellas pasan de valer {money(stock * product.unit_cost)} a <b className="text-ink">{money(stock * cost)}</b> ({cost > product.unit_cost ? '+' : '−'}
                {money(Math.abs(stock * (cost - product.unit_cost)))}).
              </p>
            )}
            {product.price_retail > 0 && (
              <p>
                Con el precio minorista de {money(product.price_retail)}, el margen pasa de {pct(marginOnPrice(product.price_retail, product.unit_cost), 0)} a{' '}
                <b className="text-ink">{pct(marginOnPrice(product.price_retail, cost), 0)}</b>.
              </p>
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}
