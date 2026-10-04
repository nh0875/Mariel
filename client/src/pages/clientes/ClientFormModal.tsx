// Formulario de cliente (nuevo o editar). Solo el nombre es obligatorio: el resto son datos
// para tenerlos a mano (mandarle un WhatsApp, facturarle, saber dónde entregar).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CLIENT_KIND_LABELS, CLIENT_KINDS, type ClientKind } from '@shared/constants'
import type { Client } from '@shared/types'
import { api } from '@/lib/api'
import { useApiMutation } from '@/lib/queries'
import { Button, Field, Modal, Select, Switch, TextInput, Textarea, useConfirm } from '@/components/ui'

interface FormState {
  name: string
  kind: ClientKind
  phone: string
  email: string
  tax_id: string
  address: string
  city: string
  notes: string
  active: boolean
}

const KIND_HINTS: Record<ClientKind, string> = {
  consumidor: 'Una persona que compra para tomar o regalar.',
  restaurante: 'Te compra para su carta de vinos (suele ir a precio mayorista).',
  vinoteca: 'Revende tus vinos en su local.',
  empresa: 'Regalos corporativos, eventos de fin de año…',
  distribuidor: 'Compra en cantidad para revender a otros.',
  otro: 'Cualquier otro.',
}

const initial = (c: Client | null): FormState => ({
  name: c?.name ?? '',
  kind: c?.kind ?? 'consumidor',
  phone: c?.phone ?? '',
  email: c?.email ?? '',
  tax_id: c?.tax_id ?? '',
  address: c?.address ?? '',
  city: c?.city ?? '',
  notes: c?.notes ?? '',
  active: c?.active ?? true,
})

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ClientFormModal({ open, client, onClose, onSaved }: { open: boolean; client: Client | null; onClose: () => void; onSaved?: (c: Client) => void }) {
  const editing = !!client
  const confirm = useConfirm()
  const [f, setF] = useState<FormState>(() => initial(client))
  const [submitted, setSubmitted] = useState(false)
  const initialRef = useRef('')

  useEffect(() => {
    if (!open) return
    const s = initial(client)
    setF(s)
    initialRef.current = JSON.stringify(s)
    setSubmitted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id])

  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }))
  const dirty = open && JSON.stringify(f) !== initialRef.current

  const errors: Record<string, string> = {}
  if (!f.name.trim()) errors.name = 'Poné el nombre (ej: «Bistró La Esquina» o «Ana Pérez»).'
  if (f.email.trim() && !EMAIL_OK.test(f.email.trim())) errors.email = 'Ese email no parece válido: revisá que tenga @ y un punto (ej: ana@gmail.com).'
  const shown = submitted ? errors : {}

  const save = useApiMutation(
    () => {
      const payload = { ...f, name: f.name.trim(), email: f.email.trim() }
      return client ? api.put<Client>(`/clients/${client.id}`, payload) : api.post<Client>('/clients', payload)
    },
    {
      success: (r) => (client ? `Datos de «${r.name}» actualizados` : `Cliente «${r.name}» agregado`),
      onSuccess: (r) => {
        onSaved?.(r)
        onClose()
      },
    },
  )

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length || save.isPending) return
    save.mutate()
  }

  const requestClose = async () => {
    if (save.isPending) return
    if (dirty && !(await confirm({ title: '¿Salís sin guardar?', message: 'Los datos que cargaste de este cliente se pierden.', confirmText: 'Sí, salir sin guardar', cancelText: 'Seguir cargando', danger: true }))) return
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={requestClose}
      dismissable={!dirty}
      size="lg"
      title={editing ? `Editar ${client!.name}` : 'Nuevo cliente'}
      subtitle={editing ? 'Cambiá lo que necesites. Sus ventas no se tocan.' : 'Solo el nombre es obligatorio. Con el teléfono le podés escribir por WhatsApp con un toque.'}
      footer={
        <>
          <Button variant="ghost" onClick={requestClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="client-form" loading={save.isPending}>
            {editing ? 'Guardar cambios' : 'Guardar cliente'}
          </Button>
        </>
      }
    >
      <form id="client-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required error={shown.name} hint="Como lo reconocés: la persona, el restó o la empresa." className="sm:col-span-2">
          <TextInput value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ej: Bistró La Esquina" maxLength={200} aria-invalid={!!shown.name || undefined} aria-label="Nombre" data-autofocus />
        </Field>
        <Field label="Tipo de cliente" hint={KIND_HINTS[f.kind]}>
          <Select aria-label="Tipo de cliente" value={f.kind} onChange={(v) => set({ kind: v as ClientKind })} options={CLIENT_KINDS.map((k) => ({ value: k, label: CLIENT_KIND_LABELS[k] }))} />
        </Field>
        <Field label="Teléfono / WhatsApp" hint="Con característica, ej: 11 5555-1234.">
          <TextInput type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="Ej: 11 5555-1234" maxLength={60} aria-label="Teléfono" />
        </Field>
        <Field label="Email" error={shown.email} hint="Para mandarle la lista de precios o el comprobante.">
          <TextInput type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="Ej: compras@bistro.com" maxLength={120} aria-invalid={!!shown.email || undefined} aria-label="Email" />
        </Field>
        <Field label="CUIT / DNI" hint="Si le hacés factura.">
          <TextInput value={f.tax_id} onChange={(e) => set({ tax_id: e.target.value })} placeholder="Ej: 30-71234567-8" maxLength={30} inputMode="numeric" aria-label="CUIT / DNI" />
        </Field>
        <Field label="Dirección" hint="Dónde le entregás.">
          <TextInput value={f.address} onChange={(e) => set({ address: e.target.value })} placeholder="Ej: Av. Corrientes 1234" maxLength={200} aria-label="Dirección" />
        </Field>
        <Field label="Ciudad / barrio">
          <TextInput value={f.city} onChange={(e) => set({ city: e.target.value })} placeholder="Ej: Palermo, CABA" maxLength={100} aria-label="Ciudad" />
        </Field>
        <Field label="Notas" hint="Ej: «Le gustan los Malbec de altura», «Paga a 30 días», «Cumple el 12/5»." className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} maxLength={2000} aria-label="Notas" />
        </Field>
        {editing && (
          <div className="sm:col-span-2">
            <Switch checked={f.active} onChange={(v) => set({ active: v })} label={f.active ? 'Activo' : 'Desactivado'} />
            <p className="mt-1 text-[13px] text-muted">Si lo desactivás, deja de aparecer al cargar ventas. Su historial y sus números se conservan.</p>
          </div>
        )}
      </form>
    </Modal>
  )
}
