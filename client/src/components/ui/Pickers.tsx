// Selectores listos para usar en formularios: vino, cliente, proveedor, cuenta, evento.
import { useMemo } from 'react'
import type { Product } from '@shared/types'
import { WINE_TYPE_LABELS } from '@shared/constants'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { useAccounts, useApiMutation, useClients, useEvents, useProducts, useSuppliers } from '@/lib/queries'
import { Combobox } from './Combobox'
import { Select } from './Field'

/**
 * Elegir un vino. Muestra bodega, stock y precio para no equivocarse.
 * priceList decide qué precio se muestra a la derecha.
 */
export function ProductSelect({
  value,
  onChange,
  priceList = 'minorista',
  showCost,
  exclude,
  invalid,
  placeholder = 'Elegí un vino…',
}: {
  value: number | null | undefined
  onChange: (id: number | null, product: Product | null) => void
  priceList?: 'minorista' | 'mayorista'
  /** Mostrar el costo en vez del precio (para compras). */
  showCost?: boolean
  exclude?: number[]
  invalid?: boolean
  placeholder?: string
}) {
  const { data: products = [] } = useProducts()
  const options = useMemo(
    () =>
      products
        .filter((p) => !exclude?.includes(p.id) || p.id === value)
        .map((p) => ({
          value: p.id,
          label: `${p.name}${p.vintage ? ` ${p.vintage}` : ''}`,
          sublabel: [p.winery, p.varietal || WINE_TYPE_LABELS[p.wine_type], `stock ${p.stock}`].filter(Boolean).join(' · '),
          keywords: `${p.sku ?? ''} ${p.region ?? ''}`,
          meta: money(showCost ? p.unit_cost : priceList === 'mayorista' ? p.price_wholesale : p.price_retail),
        })),
    [products, priceList, showCost, exclude, value],
  )
  return (
    <Combobox
      options={options}
      value={value ?? null}
      onChange={(id) => onChange(id, products.find((p) => p.id === id) ?? null)}
      placeholder={placeholder}
      searchPlaceholder="Buscá por nombre, bodega o varietal…"
      emptyText="No encontramos ese vino. Cargalo primero en «Vinos y stock»."
      invalid={invalid}
    />
  )
}

/** Elegir cliente (opcional). Permite crear uno nuevo escribiendo su nombre. */
export function ClientSelect({ value, onChange, placeholder = 'Cliente (opcional)' }: { value: number | null | undefined; onChange: (id: number | null) => void; placeholder?: string }) {
  const { data: clients = [] } = useClients()
  const create = useApiMutation((name: string) => api.post<{ id: number }>('/clients', { name }), {
    success: (_r, name) => `Cliente «${name}» agregado`,
    onSuccess: (r) => onChange(r.id),
  })
  const options = useMemo(
    () => clients.filter((c) => c.active || c.id === value).map((c) => ({ value: c.id, label: c.name, sublabel: [c.phone, c.city].filter(Boolean).join(' · ') || undefined })),
    [clients, value],
  )
  return (
    <Combobox
      options={options}
      value={value ?? null}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Buscá o escribí un nombre nuevo…"
      allowClear
      onCreate={(name) => create.mutate(name)}
      createLabel="Agregar cliente"
    />
  )
}

/** Elegir proveedor (opcional). Permite crear uno nuevo. */
export function SupplierSelect({ value, onChange, placeholder = 'Proveedor (opcional)' }: { value: number | null | undefined; onChange: (id: number | null) => void; placeholder?: string }) {
  const { data: suppliers = [] } = useSuppliers()
  const create = useApiMutation((name: string) => api.post<{ id: number }>('/suppliers', { name }), {
    success: (_r, name) => `Proveedor «${name}» agregado`,
    onSuccess: (r) => onChange(r.id),
  })
  const options = useMemo(
    () => suppliers.filter((s) => s.active || s.id === value).map((s) => ({ value: s.id, label: s.name, sublabel: s.contact_name || undefined })),
    [suppliers, value],
  )
  return (
    <Combobox
      options={options}
      value={value ?? null}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Buscá o escribí un nombre nuevo…"
      allowClear
      onCreate={(name) => create.mutate(name)}
      createLabel="Agregar proveedor"
    />
  )
}

/** Elegir cuenta (Caja, Banco, Mercado Pago…) mostrando el saldo. */
export function AccountSelect({ value, onChange, placeholder, className }: { value: number | null | undefined; onChange: (id: number | null) => void; placeholder?: string; className?: string }) {
  const { data: accounts = [] } = useAccounts()
  return (
    <Select
      className={className}
      value={value ?? ''}
      onChange={(v) => onChange(v ? Number(v) : null)}
      placeholder={placeholder}
      options={accounts.filter((a) => a.active || a.id === value).map((a) => ({ value: a.id, label: `${a.name} (saldo ${money(a.balance)})` }))}
    />
  )
}

/** Elegir evento (opcional). */
export function EventSelect({ value, onChange, placeholder = 'Sin evento' }: { value: number | null | undefined; onChange: (id: number | null) => void; placeholder?: string }) {
  const { data: events = [] } = useEvents()
  const options = useMemo(() => events.map((e) => ({ value: e.id, label: e.name, sublabel: e.date.split('-').reverse().join('/') })), [events])
  return <Combobox options={options} value={value ?? null} onChange={onChange} placeholder={placeholder} allowClear searchPlaceholder="Buscar evento…" emptyText="No hay eventos cargados." />
}
