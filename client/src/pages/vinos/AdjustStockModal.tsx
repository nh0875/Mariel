// "Ajustar stock": todo lo que mueve botellas y NO es una venta ni una compra.
// El usuario elige qué pasó (en palabras simples) y cuántas botellas; el signo lo pone el sistema.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ClipboardCheck, Gift, GlassWater, Coffee, Undo2, Bomb } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ManualStockKind } from '@shared/constants'
import { today } from '@shared/dates'
import { api } from '@/lib/api'
import { bottles, int, money } from '@/lib/format'
import { date as fmtDate } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/queries'
import { Button, ChoiceCards, DateInput, EventSelect, Field, IntInput, Modal, Spinner, TextInput, type ChoiceOption } from '@/components/ui'
import type { ProductRow } from './types'

const OPTIONS: ChoiceOption<ManualStockKind>[] = [
  { value: 'ajuste', title: 'Conté y hay otra cantidad', description: 'Hiciste inventario y no coincide con el sistema.', icon: ClipboardCheck },
  { value: 'rotura', title: 'Se rompió', description: 'Rota, picada, con corcho malo o perdida.', icon: Bomb },
  { value: 'degustacion', title: 'La abrí para degustar', description: 'Para que la prueben clientes (es costo de promoción).', icon: GlassWater },
  { value: 'regalo', title: 'La regalé / muestra', description: 'Regalo, sorteo, canje o muestra para un cliente.', icon: Gift },
  { value: 'consumo', title: 'Consumo interno', description: 'La tomaron ustedes o se usó para el negocio.', icon: Coffee },
]

const NOTE_PLACEHOLDER: Record<ManualStockKind, string> = {
  ajuste: 'Ej: inventario de fin de mes',
  rotura: 'Ej: se cayó una caja en el depósito',
  degustacion: 'Ej: degustación del sábado en el local',
  regalo: 'Ej: regalo de cumpleaños a cliente',
  consumo: 'Ej: cena del equipo',
}

export function AdjustStockModal({ product, open, onClose, minDate }: { product: ProductRow; open: boolean; onClose: () => void; minDate?: string | null }) {
  const [kind, setKind] = useState<ManualStockKind>('ajuste')
  const [counted, setCounted] = useState<number | null>(null)
  const [qty, setQty] = useState<number | null>(1)
  const [date, setDate] = useState(today())
  const [eventId, setEventId] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (open) {
      setKind('ajuste')
      setCounted(null)
      setQty(1)
      setDate(today())
      setEventId(null)
      setNotes('')
      setTried(false)
    }
  }, [open])

  const stock = product.stock
  const cost = product.unit_cost
  const isOut = kind === 'rotura' || kind === 'degustacion' || kind === 'regalo' || kind === 'consumo'
  // Para el conteo: lo que el sistema tenía AL FINAL de la fecha elegida (si contaste hace unos días,
  // las ventas posteriores no se pisan). El servidor hace la misma cuenta al guardar.
  const isPast = !!date && date < today()
  const at = useApi<{ date: string; stock: number }>(`/products/${product.id}/stock-at`, { date }, { enabled: open && kind === 'ajuste' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !(minDate && date < minDate) && date <= today() })
  const systemStock: number | null = at.data && at.data.date === date ? at.data.stock : isPast ? null : stock
  const diff = counted == null || systemStock == null ? null : counted - systemStock
  const n = qty ?? 0

  let error: string | undefined
  if (kind === 'ajuste') {
    if (counted == null) error = tried ? 'Escribí cuántas botellas contaste (puede ser 0).' : undefined
    else if (counted < 0) error = 'No puede ser negativo.'
  } else if (!qty || qty <= 0) {
    error = 'Poné cuántas botellas (1 o más).'
  } else if (isOut && qty > stock) {
    error = `Según el sistema ${stock === 1 ? 'queda 1 botella' : `quedan ${int(Math.max(stock, 0))} botellas`}. Si contaste y hay otra cantidad, elegí «Conté y hay otra cantidad».`
  }
  const noChange = kind === 'ajuste' && diff === 0
  const futureDate = !!date && date > today()
  const beforeFirst = !!date && !!minDate && date < minDate
  const dateError = futureDate
    ? 'La fecha no puede ser futura: cargalo el día que pase.'
    : beforeFirst
      ? `Este vino está en el sistema desde el ${fmtDate(minDate)}: lo de antes ya está incluido en el stock con el que lo cargaste.`
      : undefined
  const canSave = !error && !noChange && (kind === 'ajuste' ? counted != null && diff != null : n > 0) && !!date && !dateError

  const save = useApiMutation(
    () =>
      api.post<ProductRow>(`/products/${product.id}/adjust`, {
        date,
        kind,
        qty: kind === 'ajuste' ? diff : n,
        counted: kind === 'ajuste' ? counted : undefined,
        event_id: kind === 'degustacion' || kind === 'regalo' ? eventId : null,
        notes: notes || null,
      }),
    {
      success: (r) => `Stock actualizado: ahora hay ${bottles(r.stock)} de «${r.name}»`,
      onSuccess: onClose,
    },
  )

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setTried(true)
    if (canSave && !save.isPending) save.mutate()
  }

  // Qué va a pasar, en palabras (y en plata).
  let impact: ReactNode = null
  const sysWhen = isPast ? `al ${fmtDate(date)}` : 'hoy'
  if (kind === 'ajuste' && diff != null && systemStock != null && counted != null && counted >= 0) {
    impact = noChange ? (
      <p>
        <b className="text-good">¡Coincide con el sistema!</b> No hace falta ajustar nada.
      </p>
    ) : diff < 0 ? (
      <p>
        El sistema dice <b className="text-ink">{int(systemStock)}</b> {sysWhen} y contaste <b className="text-ink">{int(counted)}</b>: faltan <b className="text-ink">{bottles(-diff)}</b>. A costo
        son <b className="text-ink">{money(-diff * cost)}</b>, que se cuentan como merma (faltante) en Reportes.
        {isPast && systemStock !== stock && <> El stock de hoy pasa de {int(stock)} a {int(stock + diff)}.</>}
      </p>
    ) : (
      <p>
        El sistema dice <b className="text-ink">{int(systemStock)}</b> {sysWhen} y contaste <b className="text-ink">{int(counted)}</b>: sobran <b className="text-ink">{bottles(diff)}</b>. Se suman al
        stock, valorizadas al costo promedio ({money(cost)}). Es un <b className="text-ink">sobrante</b>: botellas que tenías y el sistema no sabía. En Reportes resta de las mermas (son{' '}
        {money(diff * cost)} a costo que aparecieron), así que el resultado sube esa plata.
        {isPast && systemStock !== stock && <> El stock de hoy pasa de {int(stock)} a {int(stock + diff)}.</>}
        {' '}Si la botella sobra porque un cliente te la devolvió, no la cargues acá: corregí esa venta.
      </p>
    )
  } else if (isOut && n > 0 && !error) {
    impact = (
      <p>
        Salen <b className="text-ink">{bottles(n)}</b> y el stock queda en <b className="text-ink">{int(stock - n)}</b>. A costo son <b className="text-ink">{money(n * cost)}</b>: se cuentan en
        Reportes como «Mermas, degustaciones y regalos» (son costo aunque no sean ventas).
      </p>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Ajustar stock"
      subtitle={`${product.name} · hoy el sistema dice ${bottles(stock)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="ajuste-form" loading={save.isPending} disabled={!canSave}>
            Guardar ajuste
          </Button>
        </>
      }
    >
      <form id="ajuste-form" onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <p className="mb-2 text-[14px] font-bold text-ink">¿Qué pasó?</p>
          <ChoiceCards options={OPTIONS} value={kind} onChange={setKind} columns={2} />
          <p className="mt-2 text-[13px] text-muted">Las ventas y las compras no se cargan acá: el stock se mueve solo cuando las cargás en «Ventas» o «Compras de vino».</p>
          <p className="mt-2 flex items-start gap-2 rounded-xl bg-sky-soft/70 px-3 py-2 text-[13.5px] text-ink">
            <Undo2 size={16} className="mt-0.5 shrink-0 text-sky-deep" aria-hidden />
            <span>
              <b>¿Te devolvieron una botella?</b> Eso se carga en la venta: abrila en{' '}
              <Link to="/ventas" className="font-bold text-sky-deep hover:underline" onClick={onClose}>
                Ventas
              </Link>
              , tocá «Editar», sacá la botella (o bajá la cantidad) y guardá. Así vuelve al stock y se corrigen la venta y la ganancia; si le devolviste la plata, corregí también el cobro.
            </span>
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {kind === 'ajuste' ? (
            <Field
              label="¿Cuántas botellas contaste?"
              required
              htmlFor="ajuste-counted"
              error={error}
              hint={
                dateError ? (
                  'Elegí una fecha válida y te mostramos cuántas había según el sistema.'
                ) : systemStock == null ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner size={12} /> Mirando cuántas había ese día…
                  </span>
                ) : (
                  `El sistema dice ${int(systemStock)} ${sysWhen}. Escribí lo que hay de verdad y calculamos la diferencia.`
                )
              }
            >
              <IntInput id="ajuste-counted" value={counted} onChange={setCounted} placeholder="Ej: 25" aria-invalid={!!error} />
            </Field>
          ) : (
            <Field label="¿Cuántas botellas?" required htmlFor="ajuste-qty" error={error}>
              <IntInput id="ajuste-qty" value={qty} onChange={setQty} aria-invalid={!!error} />
            </Field>
          )}
          <Field
            label="Fecha"
            htmlFor="ajuste-date"
            error={dateError}
            hint={kind === 'ajuste' ? 'El día que contaste. Por defecto, hoy.' : 'Cuándo pasó. Por defecto, hoy.'}
          >
            <DateInput id="ajuste-date" value={date} onChange={setDate} max={today()} min={minDate ?? undefined} />
          </Field>
          {(kind === 'degustacion' || kind === 'regalo') && (
            <Field label="¿Fue en un evento?" hint="Opcional. Así el costo de estas botellas se suma al evento.">
              <EventSelect value={eventId} onChange={setEventId} placeholder="No, no fue en un evento" />
            </Field>
          )}
          <Field label="Nota" htmlFor="ajuste-notes" hint="Opcional, para acordarte después." className={kind === 'degustacion' || kind === 'regalo' ? '' : 'sm:col-span-2'}>
            <TextInput id="ajuste-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={NOTE_PLACEHOLDER[kind]} />
          </Field>
        </div>

        {impact && !dateError && <div className="rounded-xl bg-cream-deep/80 px-4 py-3 text-[14.5px] leading-relaxed text-ink-soft">{impact}</div>}
      </form>
    </Modal>
  )
}
