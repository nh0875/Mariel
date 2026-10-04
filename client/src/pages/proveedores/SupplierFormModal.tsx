// Formulario de proveedor (nuevo o editar). Solo el nombre es obligatorio:
// el resto son datos de contacto para tenerlos a mano cuando hay que pedir o reclamar algo.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SUPPLIER_KIND_LABELS, SUPPLIER_KINDS, type SupplierKind } from '@shared/constants'
import type { Supplier } from '@shared/types'
import { api } from '@/lib/api'
import { useApiMutation } from '@/lib/queries'
import { Button, Field, Modal, Select, Switch, TextInput, Textarea, useConfirm } from '@/components/ui'

interface FormState {
  name: string
  kind: SupplierKind
  contact_name: string
  phone: string
  email: string
  tax_id: string
  address: string
  notes: string
  active: boolean
}

const KIND_HINTS: Record<SupplierKind, string> = {
  bodega: 'Te vende vino directo de su producción.',
  distribuidor: 'Te vende vinos de varias bodegas.',
  insumos: 'Cajas, bolsas, etiquetas, copas… (se cargan en Gastos).',
  servicios: 'Contador, alquiler, diseño, mantenimiento… (se cargan en Gastos).',
  logistica: 'Fletes y envíos a clientes.',
  otro: 'Cualquier otro.',
}

function initial(s: Supplier | null): FormState {
  return {
    name: s?.name ?? '',
    kind: s?.kind ?? 'bodega',
    contact_name: s?.contact_name ?? '',
    phone: s?.phone ?? '',
    email: s?.email ?? '',
    tax_id: s?.tax_id ?? '',
    address: s?.address ?? '',
    notes: s?.notes ?? '',
    active: s?.active ?? true,
  }
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function SupplierFormModal({
  open,
  supplier,
  onClose,
  onSaved,
}: {
  open: boolean
  /** Si viene, se edita ese proveedor. */
  supplier: Supplier | null
  onClose: () => void
  onSaved?: (s: Supplier) => void
}) {
  const editing = !!supplier
  const confirm = useConfirm()
  const [f, setF] = useState<FormState>(() => initial(supplier))
  const [submitted, setSubmitted] = useState(false)
  const initialRef = useRef('')

  useEffect(() => {
    if (!open) return
    const s = initial(supplier)
    setF(s)
    initialRef.current = JSON.stringify(s)
    setSubmitted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier?.id])

  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }))
  const dirty = open && JSON.stringify(f) !== initialRef.current

  const errors: Record<string, string> = {}
  if (!f.name.trim()) errors.name = 'Poné el nombre (ej: «Bodega Los Cerros»).'
  if (f.email.trim() && !EMAIL_OK.test(f.email.trim())) errors.email = 'Ese email no parece válido: revisá que tenga @ y un punto (ej: ventas@bodega.com).'
  const shown = submitted ? errors : {}

  const save = useApiMutation(
    () => {
      const payload = {
        name: f.name.trim(),
        kind: f.kind,
        contact_name: f.contact_name,
        phone: f.phone,
        email: f.email.trim(),
        tax_id: f.tax_id,
        address: f.address,
        notes: f.notes,
        active: f.active,
      }
      return supplier ? api.put<Supplier>(`/suppliers/${supplier.id}`, payload) : api.post<Supplier>('/suppliers', payload)
    },
    {
      success: (res) => (supplier ? `Datos de «${res.name}» actualizados` : `Proveedor «${res.name}» agregado`),
      onSuccess: (res) => {
        onSaved?.(res)
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
    if (dirty) {
      const ok = await confirm({
        title: '¿Salís sin guardar?',
        message: 'Los datos que cargaste de este proveedor se pierden.',
        confirmText: 'Sí, salir sin guardar',
        cancelText: 'Seguir cargando',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={requestClose}
      dismissable={!dirty}
      size="lg"
      title={editing ? `Editar ${supplier!.name}` : 'Nuevo proveedor'}
      subtitle={editing ? 'Cambiá lo que necesites. Sus compras y gastos no se tocan.' : 'Solo el nombre es obligatorio. El resto te sirve para tener los contactos a mano.'}
      footer={
        <>
          <Button variant="ghost" onClick={requestClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="supplier-form" loading={save.isPending}>
            {editing ? 'Guardar cambios' : 'Guardar proveedor'}
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required error={shown.name} hint="Como lo reconocés: la bodega, la distribuidora o la empresa." className="sm:col-span-2">
          <TextInput
            value={f.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Ej: Bodega Los Cerros"
            maxLength={200}
            aria-invalid={!!shown.name || undefined}
            data-autofocus
          />
        </Field>
        <Field label="Tipo" hint={KIND_HINTS[f.kind]}>
          <Select value={f.kind} onChange={(v) => set({ kind: v as SupplierKind })} options={SUPPLIER_KINDS.map((k) => ({ value: k, label: SUPPLIER_KIND_LABELS[k] }))} />
        </Field>
        <Field label="Persona de contacto" hint="Con quién hablás (vendedor, administración…).">
          <TextInput value={f.contact_name} onChange={(e) => set({ contact_name: e.target.value })} placeholder="Ej: Martín Aguirre" maxLength={120} />
        </Field>
        <Field label="Teléfono / WhatsApp" hint="Desde la ficha lo podés llamar con un toque.">
          <TextInput type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="Ej: 261 455-1234" maxLength={60} />
        </Field>
        <Field label="Email" error={shown.email} hint="Para mandar pedidos o pedir la factura.">
          <TextInput
            type="email"
            value={f.email}
            onChange={(e) => set({ email: e.target.value })}
            placeholder="Ej: ventas@bodega.com"
            maxLength={120}
            aria-invalid={!!shown.email || undefined}
          />
        </Field>
        <Field label="CUIT" hint="11 números, con o sin guiones. Lo pide el contador.">
          <TextInput value={f.tax_id} onChange={(e) => set({ tax_id: e.target.value })} placeholder="Ej: 30-71234567-8" maxLength={30} inputMode="numeric" />
        </Field>
        <Field label="Dirección" hint="Dónde retirás o desde dónde te mandan.">
          <TextInput value={f.address} onChange={(e) => set({ address: e.target.value })} placeholder="Ej: Ruta 89 km 12, Tupungato" maxLength={200} />
        </Field>
        <Field label="Notas" hint="Ej: «Pedido mínimo 6 cajas», «Pago a 30 días», «Entrega los jueves»." className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} maxLength={2000} />
        </Field>
        {editing && (
          <div className="sm:col-span-2">
            <Switch checked={f.active} onChange={(v) => set({ active: v })} label={f.active ? 'Activo' : 'Desactivado'} />
            <p className="mt-1 text-[13px] text-muted">Si lo desactivás, deja de aparecer al cargar compras y gastos. Su historial y sus números se conservan.</p>
          </div>
        )}
      </form>
    </Modal>
  )
}
