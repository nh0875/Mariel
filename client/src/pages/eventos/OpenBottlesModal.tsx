// "Registrar botellas abiertas": las botellas que se abrieron para degustar en el evento.
// Salen del stock y se cuentan como costo del evento (a lo que te costó cada una).
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Wine } from 'lucide-react'
import type { OpenBottlesInput } from '@shared/schemas'
import type { WineEvent } from '@shared/types'
import { api } from '@/lib/api'
import { bottles as fmtBottles, money } from '@/lib/format'
import { beforeAltaText, winesBeforeAlta } from '@/lib/alta'
import { useApiMutation, useProducts } from '@/lib/queries'
import { Button, DateInput, Field, IntInput, Modal, ProductSelect, TextInput } from '@/components/ui'
import { nb } from './parts'

interface Row {
  key: number
  productId: number | null
  qty: number | null
}

let seq = 0
const newRow = (): Row => ({ key: ++seq, productId: null, qty: 1 })

/**
 * Fecha sugerida: la del evento (también si es a futuro: son botellas separadas para ese día).
 * Así la merma cae en el mes del evento y, si después cambiás la fecha del evento, se mueven con él.
 */
const defaultDate = (ev: WineEvent) => ev.date

export function OpenBottlesModal({ open, event, onClose }: { open: boolean; event: WineEvent; onClose: () => void }) {
  const productsQ = useProducts()
  const products = useMemo(() => productsQ.data ?? [], [productsQ.data])
  const noWines = !!productsQ.data && products.length === 0
  const [date, setDate] = useState(() => defaultDate(event))
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
  const [notes, setNotes] = useState('')
  const [submitted, setSubmitted] = useState(false)
  // Candado sincrónico contra doble Enter/doble clic (save.isPending tarda un render en enterarse).
  const busy = useRef(false)

  useEffect(() => {
    if (open) {
      busy.current = false
      setDate(defaultDate(event))
      setRows([newRow()])
      setNotes('')
      setSubmitted(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event.id])

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  // Botellas pedidas por vino (por si eligen el mismo vino en dos renglones).
  const askedByProduct = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of rows) if (r.productId) m.set(r.productId, (m.get(r.productId) ?? 0) + (r.qty ?? 0))
    return m
  }, [rows])

  const rowError = (r: Row): string | null => {
    if (!r.productId) return 'Elegí el vino.'
    if (!r.qty || r.qty < 1) return 'Poné cuántas botellas (1 o más).'
    const p = byId.get(r.productId)
    const asked = askedByProduct.get(r.productId) ?? 0
    if (p && asked > p.stock) return p.stock <= 0 ? 'No quedan botellas de este vino según el sistema.' : `Solo ${p.stock === 1 ? 'queda 1 botella' : `quedan ${p.stock} botellas`} de este vino.`
    return null
  }
  const errors = rows.map(rowError)
  // Aviso (no bloquea): fecha anterior al alta de algún vino elegido.
  const beforeAlta = beforeAltaText(
    winesBeforeAlta(
      products,
      rows.map((r) => r.productId),
      date,
    ),
    'abiertas',
  )
  const dateError = /^\d{4}-\d{2}-\d{2}$/.test(date) ? null : 'Elegí la fecha.'
  const hasErrors = errors.some(Boolean) || !!dateError

  const totalBottles = rows.reduce((a, r) => a + (r.productId ? r.qty ?? 0 : 0), 0)
  const totalCost = rows.reduce((a, r) => a + (r.productId ? (r.qty ?? 0) * (byId.get(r.productId)?.unit_cost ?? 0) : 0), 0)

  const save = useApiMutation(
    (body: OpenBottlesInput) => api.post(`/events/${event.id}/open-bottles`, body),
    {
      success: (_r, b) => {
        const n = b.items.reduce((a, i) => a + i.qty, 0)
        return `Listo: ${fmtBottles(n)} ${n === 1 ? 'abierta' : 'abiertas'}, descontadas del stock`
      },
      onSuccess: () => onClose(),
      onError: () => {
        busy.current = false
      },
    },
  )

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (busy.current || save.isPending) return // Enter dos veces seguidas no descuenta dos veces
    setSubmitted(true)
    if (hasErrors) return
    busy.current = true
    save.mutate({ date, items: rows.map((r) => ({ product_id: r.productId!, qty: r.qty! })), notes: notes.trim() || null })
  }

  const dirty = rows.some((r) => r.productId) || !!notes.trim()

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={!dirty}
      size="lg"
      title="Botellas abiertas"
      subtitle={`Las que abriste para degustar en «${event.name}». Salen del stock y cuentan como costo del evento.`}
      footer={
        <>
          <span className="mr-auto text-[14px] text-ink-soft">
            {totalBottles > 0 ? (
              <>
                <b className="text-ink">{fmtBottles(totalBottles)}</b> · costo <b className="vh-num text-ink">{nb(money(totalCost, { decimals: 0 }))}</b>
              </>
            ) : (
              'Elegí los vinos que abriste'
            )}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="open-bottles-form" icon={Wine} loading={save.isPending}>
            Registrar
          </Button>
        </>
      }
    >
      <form id="open-bottles-form" onSubmit={submit} noValidate className="space-y-4">
        {noWines && (
          <div className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13.5px] leading-snug text-warn">
            <b>Todavía no cargaste vinos.</b> Las botellas abiertas salen del stock, así que primero cargá tus vinos en{' '}
            <Link to="/vinos" className="font-bold underline">
              Vinos y stock
            </Link>
            .
          </div>
        )}
        <div className="rounded-xl bg-sky-soft/70 px-3.5 py-2.5 text-[13.5px] leading-snug text-ink-soft">
          <b className="text-ink">¿Por qué cargarlas?</b> Una botella abierta es vino que ya pagaste y no vas a vender. Si no la registrás, el stock te va a dar de más y el evento
          va a parecer más rentable de lo que fue. Se valoriza a lo que te costó (costo promedio), no al precio de venta.
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Fecha"
            required
            error={submitted && dateError}
            hint={
              beforeAlta ? (
                <span className="font-semibold text-warn" data-testid="before-alta">
                  {beforeAlta}
                </span>
              ) : (
                'Normalmente, el día del evento.'
              )
            }
          >
            <DateInput value={date} onChange={setDate} aria-invalid={submitted && !!dateError} />
          </Field>
          <Field label="Nota" hint="Opcional. Ej: «Para la mesa de degustación».">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder={`Degustación: ${event.name}`} />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-[14px] font-bold text-ink">¿Qué vinos abriste?</p>
          <ul className="space-y-3">
            {rows.map((r, idx) => {
              const p = r.productId ? byId.get(r.productId) : undefined
              const err = submitted ? errors[idx] : r.productId ? errors[idx] : null
              const lineCost = p ? (r.qty ?? 0) * p.unit_cost : 0
              return (
                <li key={r.key} className="rounded-xl border border-line bg-paper p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_auto]">
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <ProductSelect
                        value={r.productId}
                        onChange={(id) => setRow(r.key, { productId: id })}
                        showCost
                        invalid={!!err && !r.productId}
                        placeholder="Elegí el vino…"
                      />
                    </div>
                    <IntInput aria-label="Botellas" value={r.qty} onChange={(v) => setRow(r.key, { qty: v })} suffix="bot." aria-invalid={!!err && !!r.productId} />
                    <Button
                      variant="ghost"
                      icon={Trash2}
                      className="!px-0"
                      aria-label="Quitar este vino"
                      title="Quitar este vino"
                      disabled={rows.length === 1}
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[13px]">
                    {err ? (
                      <span className="font-semibold text-bad">{err}</span>
                    ) : p ? (
                      <span className="text-muted">
                        Quedan {p.stock} · costo {nb(money(p.unit_cost, { decimals: 0 }))} c/u
                      </span>
                    ) : (
                      <span className="text-muted">Buscá por nombre, bodega o varietal.</span>
                    )}
                    {p && (
                      <span className="vh-num font-bold text-ink">
                        {nb(money(lineCost, { decimals: 0 }))}
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <Button className="mt-3" size="sm" icon={Plus} onClick={() => setRows((rs) => [...rs, newRow()])}>
            Agregar otro vino
          </Button>
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
