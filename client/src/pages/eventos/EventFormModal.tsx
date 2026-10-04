// Formulario de evento (nuevo o editar). Pide lo mínimo: nombre y fecha.
// Personas, entrada y presupuesto son opcionales pero hacen que los números del evento digan más.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarHeart } from 'lucide-react'
import { EVENT_KINDS, EVENT_KIND_LABELS, type EventKind } from '@shared/constants'
import { today } from '@shared/dates'
import type { WineEvent } from '@shared/types'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { useApiMutation } from '@/lib/queries'
import { Button, DateInput, Field, IntInput, Modal, MoneyInput, Select, TextInput, Textarea } from '@/components/ui'
import type { EventWithSummary } from './types'

interface FormState {
  name: string
  date: string
  kind: EventKind
  location: string
  attendees: number | null
  ticketPrice: number | null
  budget: number | null
  notes: string
}

const KIND_HINTS: Record<EventKind, string> = {
  degustacion: 'Abrís botellas para que la gente pruebe y compre.',
  feria: 'Un stand en una feria, mercado o expo.',
  cata_privada: 'Un grupo chico, guiado, con cupo.',
  corporativo: 'Para una empresa: after office, regalos, capacitación.',
  maridaje: 'Comida + vinos, con un restó o en el local.',
  otro: 'Cualquier otra cosa donde muevas vino.',
}

function initial(ev?: WineEvent | null): FormState {
  if (ev) {
    return {
      name: ev.name,
      date: ev.date,
      kind: ev.kind,
      location: ev.location ?? '',
      attendees: ev.attendees,
      ticketPrice: ev.ticket_price,
      budget: ev.budget,
      notes: ev.notes ?? '',
    }
  }
  return { name: '', date: today(), kind: 'degustacion', location: '', attendees: null, ticketPrice: null, budget: null, notes: '' }
}

export function EventFormModal({
  open,
  event,
  onClose,
  onSaved,
}: {
  open: boolean
  /** Si viene, es "Editar evento". */
  event?: WineEvent | null
  onClose: () => void
  onSaved?: (ev: EventWithSummary) => void
}) {
  const editing = !!event
  const [f, setF] = useState<FormState>(() => initial(event))
  const [submitted, setSubmitted] = useState(false)
  const [start, setStart] = useState(() => JSON.stringify(initial(event)))

  // Cada vez que se abre, arranca de cero (o con los datos del evento a editar).
  useEffect(() => {
    if (open) {
      const init = initial(event)
      setF(init)
      setStart(JSON.stringify(init))
      setSubmitted(false)
    }
    // Solo al abrir (o si cambia de evento): un refresco de datos no debe pisar lo que estás escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))
  const dirty = JSON.stringify(f) !== start

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {}
    if (!f.name.trim()) e.name = 'Ponele un nombre (ej: «Degustación de Malbecs»).'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) e.date = 'Elegí la fecha del evento.'
    return e
  }, [f])

  const save = useApiMutation(
    (body: Record<string, unknown>) => (editing ? api.put<EventWithSummary>(`/events/${event!.id}`, body) : api.post<EventWithSummary>('/events', body)),
    {
      success: editing ? 'Evento actualizado' : (r) => `Listo, «${r.name}» quedó cargado`,
      onSuccess: (r) => {
        onClose()
        onSaved?.(r)
      },
    },
  )

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length) return
    save.mutate({
      name: f.name.trim(),
      date: f.date,
      kind: f.kind,
      location: f.location.trim() || null,
      attendees: f.attendees,
      ticket_price: f.ticketPrice || null,
      budget: f.budget || null,
      notes: f.notes.trim() || null,
    })
  }

  const isFuture = f.date > today()
  const expectedTickets = f.attendees && f.ticketPrice ? f.attendees * f.ticketPrice : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={!dirty}
      size="lg"
      title={editing ? 'Editar evento' : 'Nuevo evento'}
      subtitle={editing ? 'Cambiá lo que necesites. Las ventas, gastos y botellas del evento no se tocan.' : 'Cargalo antes o después de hacerlo: con nombre y fecha alcanza para empezar.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="event-form" icon={CalendarHeart} loading={save.isPending}>
            {editing ? 'Guardar cambios' : 'Crear evento'}
          </Button>
        </>
      }
    >
      <form id="event-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre del evento" required className="sm:col-span-2" error={submitted && errors.name} hint="Así lo vas a ver en las listas y al elegirlo en una venta o un gasto.">
          <TextInput
            value={f.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Ej: Degustación de Malbecs de altura"
            maxLength={200}
            aria-invalid={submitted && !!errors.name}
            data-autofocus
          />
        </Field>
        <Field label="Tipo de evento" hint={KIND_HINTS[f.kind]}>
          <Select value={f.kind} onChange={(v) => set('kind', v as EventKind)} options={EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABELS[k] }))} />
        </Field>
        <Field
          label="Fecha"
          required
          error={submitted && errors.date}
          hint={isFuture ? 'Es a futuro: va a aparecer en «Próximos» hasta que llegue el día.' : 'El día que se hizo (o se hace).'}
        >
          <DateInput value={f.date} onChange={(v) => set('date', v)} aria-invalid={submitted && !!errors.date} />
        </Field>
        <Field label="Lugar" hint="Opcional. Dónde se hace.">
          <TextInput value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Ej: En el local, Bistró La Esquina" maxLength={200} />
        </Field>
        <Field label="Personas" hint="Cuántos fueron (o esperás). Con esto calculamos cuánto dejó cada persona.">
          <IntInput value={f.attendees} onChange={(v) => set('attendees', v == null ? null : Math.max(0, v))} placeholder="Ej: 25" suffix="pers." />
        </Field>
        <Field
          label="Precio de la entrada"
          hint={
            expectedTickets
              ? `Con ${f.attendees} personas serían ${money(expectedTickets)} de entradas. Las cobrás cargando una venta del evento.`
              : 'Dejalo vacío si es gratis. Es de referencia: las entradas se cobran cargando una venta del evento.'
          }
        >
          <MoneyInput value={f.ticketPrice} onChange={(v) => set('ticketPrice', v)} />
        </Field>
        <Field label="Presupuesto" hint="Lo máximo que pensás poner: gastos (copas, picada, difusión) + las botellas que abras. Te avisamos si te pasás.">
          <MoneyInput value={f.budget} onChange={(v) => set('budget', v)} />
        </Field>
        <Field label="Notas" className="sm:col-span-2" hint="Opcional. Ej: qué vinos se sirvieron, qué funcionó, qué cambiarías la próxima.">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} maxLength={2000} />
        </Field>
        {/* Enter en cualquier campo guarda */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
