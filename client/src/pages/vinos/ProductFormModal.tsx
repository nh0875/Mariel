// Formulario para cargar o editar un vino.
// Al crear: también se carga el costo y el stock inicial (después cambian solos con compras y ventas).
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { VARIETALS, WINE_TYPES, WINE_TYPE_LABELS, type WineType } from '@shared/constants'
import { markupOnCost, marginOnPrice, priceForMargin, roundUpTo } from '@shared/calc'
import { api } from '@/lib/api'
import { money, pct } from '@/lib/format'
import { useApiMutation, useProducts, useSettings } from '@/lib/queries'
import { Button, Field, IntInput, MoneyInput, Modal, Select, Switch, TextInput, Textarea } from '@/components/ui'
import type { ProductRow } from './types'

const SIZES = [
  { value: 187, label: '187 ml (petaca)' },
  { value: 375, label: '375 ml (media botella)' },
  { value: 500, label: '500 ml' },
  { value: 750, label: '750 ml (botella común)' },
  { value: 1000, label: '1 litro' },
  { value: 1500, label: '1,5 L (magnum)' },
  { value: 3000, label: '3 L (doble magnum)' },
]

interface FormState {
  name: string
  winery: string
  varietal: string
  wine_type: WineType
  vintage: number | null
  region: string
  size_ml: number
  sku: string
  unit_cost: number | null
  price_retail: number | null
  price_wholesale: number | null
  initial_stock: number | null
  min_stock: number | null
  units_per_box: number | null
  notes: string
  active: boolean
}

function initialState(p: ProductRow | null | undefined, defaults: { min_stock: number; units_per_box: number }): FormState {
  if (p) {
    return {
      name: p.name,
      winery: p.winery ?? '',
      varietal: p.varietal ?? '',
      wine_type: p.wine_type,
      vintage: p.vintage,
      region: p.region ?? '',
      size_ml: p.size_ml,
      sku: p.sku ?? '',
      unit_cost: p.unit_cost,
      price_retail: p.price_retail,
      price_wholesale: p.price_wholesale,
      initial_stock: null,
      min_stock: p.min_stock,
      units_per_box: p.units_per_box,
      notes: p.notes ?? '',
      active: p.active,
    }
  }
  return {
    name: '',
    winery: '',
    varietal: '',
    wine_type: 'tinto',
    vintage: null,
    region: '',
    size_ml: 750,
    sku: '',
    unit_cost: null,
    price_retail: null,
    price_wholesale: null,
    initial_stock: 0,
    min_stock: defaults.min_stock,
    units_per_box: defaults.units_per_box,
    notes: '',
    active: true,
  }
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <legend className="px-1.5 text-[16px] font-extrabold text-ink">{title}</legend>
      {description && <p className="-mt-1 mb-3 text-[13.5px] text-ink-soft">{description}</p>}
      {children}
    </fieldset>
  )
}

/** "Margen 42 % · markup 73 % · te quedan $5.300 por botella" — en vivo mientras escribís el precio. */
function PriceInsight({ price, cost }: { price: number | null; cost: number | null }) {
  if (!price) return <span>Escribí el precio y te mostramos cuánto ganás.</span>
  if (!cost) return <span>Cargá el costo para ver cuánto ganás con este precio.</span>
  const gain = price - cost
  if (gain < 0) return <span className="font-semibold text-bad">Ojo: lo vendés por debajo del costo. Perdés {money(-gain)} por botella.</span>
  return (
    <span>
      Margen <b className="text-ink">{pct(marginOnPrice(price, cost), 1)}</b> · markup {pct(markupOnCost(price, cost), 0)} · te quedan <b className="text-ink">{money(gain)}</b> por botella
    </span>
  )
}

export function ProductFormModal({
  open,
  onClose,
  product,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** Si viene, se edita ese vino; si no, se carga uno nuevo. */
  product?: ProductRow | null
  onSaved?: (p: ProductRow) => void
}) {
  const editing = !!product
  const { data: settings } = useSettings()
  const { data: allProducts = [] } = useProducts({ includeInactive: true })
  const defaults = { min_stock: settings?.defaults.min_stock ?? 6, units_per_box: settings?.defaults.units_per_box ?? 6 }
  const targetMargin = (settings?.pricing.target_margin_pct ?? 40) / 100
  const wholesaleDiscount = (settings?.pricing.wholesale_discount_pct ?? 20) / 100

  const [f, setF] = useState<FormState>(() => initialState(product, defaults))
  const [tried, setTried] = useState(false)
  const [suggested, setSuggested] = useState<{ retail: number; wholesale: number; raw: number } | null>(null)

  useEffect(() => {
    if (open) {
      setF(initialState(product, defaults))
      setTried(false)
      setSuggested(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))

  const wineries = useMemo(() => [...new Set(allProducts.map((p) => p.winery).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')), [allProducts])
  const regions = useMemo(() => [...new Set(allProducts.map((p) => p.region).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')), [allProducts])

  const cost = editing ? (product?.unit_cost ?? 0) : f.unit_cost
  const nameError = tried && !f.name.trim() ? 'Poné el nombre del vino (es lo único obligatorio).' : undefined
  const wholesaleWarn = f.price_wholesale && f.price_retail && f.price_wholesale > f.price_retail ? 'El precio mayorista suele ser MÁS BAJO que el minorista. ¿Están al revés?' : undefined

  const suggest = () => {
    if (!cost) return
    const raw = priceForMargin(cost, targetMargin)
    const retail = roundUpTo(raw, 100)
    const wholesale = roundUpTo(retail * (1 - wholesaleDiscount), 100)
    setSuggested({ retail, wholesale, raw })
    setF((s) => ({ ...s, price_retail: retail, price_wholesale: wholesale }))
  }

  const save = useApiMutation((body: Record<string, unknown>) => (product ? api.put<ProductRow>(`/products/${product.id}`, body) : api.post<ProductRow>('/products', body)), {
    success: (r) => (product ? `Listo, guardamos los cambios de «${r.name}»` : `«${r.name}» ya está en tu catálogo`),
    onSuccess: (r) => {
      onSaved?.(r)
      onClose()
    },
  })

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setTried(true)
    if (!f.name.trim() || (f.vintage != null && (f.vintage < 1900 || f.vintage > 2100))) return
    save.mutate({
      name: f.name.trim(),
      winery: f.winery || null,
      varietal: f.varietal || null,
      wine_type: f.wine_type,
      vintage: f.vintage || null,
      region: f.region || null,
      size_ml: f.size_ml,
      sku: f.sku || null,
      price_retail: f.price_retail ?? 0,
      price_wholesale: f.price_wholesale ?? 0,
      min_stock: f.min_stock ?? defaults.min_stock,
      units_per_box: f.units_per_box || defaults.units_per_box,
      notes: f.notes || null,
      active: f.active,
      ...(editing ? {} : { unit_cost: f.unit_cost ?? 0, initial_stock: f.initial_stock ?? 0 }),
    })
  }

  const vintageError = f.vintage != null && (tried || String(f.vintage).length >= 4) && (f.vintage < 1900 || f.vintage > 2100) ? 'Poné el año completo (ej: 2021).' : undefined

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={false}
      size="lg"
      title={editing ? 'Editar vino' : 'Nuevo vino'}
      subtitle={
        editing
          ? 'Cambiá los datos o los precios. El costo y el stock se cambian desde la ficha (así queda registrado).'
          : 'Cargalo una vez y después el stock y el costo se mueven solos con cada compra y venta.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="vino-form" loading={save.isPending} disabled={!!vintageError}>
            {editing ? 'Guardar cambios' : 'Agregar vino'}
          </Button>
        </>
      }
    >
      <form id="vino-form" onSubmit={submit} className="space-y-5" noValidate>
        <Section title="El vino">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" required error={nameError} hint="Así lo vas a ver al cargar ventas. Ej: Malbec Reserva." className="sm:col-span-2" htmlFor="vino-name">
              <TextInput id="vino-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej: Malbec Reserva" aria-invalid={!!nameError} autoComplete="off" />
            </Field>
            <Field label="Bodega" htmlFor="vino-winery" hint="Elegí una que ya tengas o escribí una nueva.">
              <TextInput id="vino-winery" list="vino-wineries" value={f.winery} onChange={(e) => set('winery', e.target.value)} placeholder="Ej: Bodega Los Cerros" autoComplete="off" />
              <datalist id="vino-wineries">
                {wineries.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
            </Field>
            <Field label="Varietal" htmlFor="vino-varietal" hint="La uva, o «Blend» si es un corte.">
              <TextInput id="vino-varietal" list="vino-varietals" value={f.varietal} onChange={(e) => set('varietal', e.target.value)} placeholder="Ej: Malbec" autoComplete="off" />
              <datalist id="vino-varietals">
                {VARIETALS.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Field>
            <Field label="Tipo" htmlFor="vino-type">
              <Select id="vino-type" value={f.wine_type} onChange={(v) => set('wine_type', v as WineType)} options={WINE_TYPES.map((t) => ({ value: t, label: WINE_TYPE_LABELS[t] }))} />
            </Field>
            <Field label="Cosecha" htmlFor="vino-vintage" error={vintageError} hint="El año de la uva. Vacío si no tiene (ej: espumantes sin añada).">
              <TextInput
                id="vino-vintage"
                inputMode="numeric"
                maxLength={4}
                value={f.vintage ?? ''}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                  set('vintage', digits ? Number(digits) : null)
                }}
                placeholder="Ej: 2021"
                autoComplete="off"
                aria-invalid={!!vintageError}
              />
            </Field>
            <Field label="Región" htmlFor="vino-region">
              <TextInput id="vino-region" list="vino-regions" value={f.region} onChange={(e) => set('region', e.target.value)} placeholder="Ej: Valle de Uco, Mendoza" autoComplete="off" />
              <datalist id="vino-regions">
                {regions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <Field label="Tamaño" htmlFor="vino-size">
              <Select id="vino-size" value={f.size_ml} onChange={(v) => set('size_ml', Number(v))} options={SIZES} />
            </Field>
            <Field label="Código (SKU)" htmlFor="vino-sku" hint="Opcional. Si usás códigos propios, sirve para reconocer el vino al importar desde Excel.">
              <TextInput id="vino-sku" value={f.sku} onChange={(e) => set('sku', e.target.value)} placeholder="Ej: VH-012" autoComplete="off" />
            </Field>
          </div>
        </Section>

        <Section
          title="Precios"
          description={
            editing ? (
              <>
                Costo actual: <b className="text-ink">{money(product?.unit_cost)}</b> por botella (promedio de tus compras). Si está mal, cambialo con «Cambiar costo» en la ficha.
              </>
            ) : (
              'Con el costo y el precio te mostramos al toque cuánto ganás con cada botella.'
            )
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {!editing && (
              <Field
                label="Costo por botella"
                info="costo_promedio"
                htmlFor="vino-cost"
                hint="Lo que te cuesta cada botella puesta en tu depósito (con flete). Después se actualiza solo con cada compra."
                className="sm:col-span-2"
              >
                <MoneyInput id="vino-cost" value={f.unit_cost} onChange={(v) => set('unit_cost', v)} className="sm:max-w-[calc(50%-0.5rem)]" />
              </Field>
            )}
            <Field label="Precio minorista" info="margen_vs_markup" htmlFor="vino-retail" hint={<PriceInsight price={f.price_retail} cost={cost} />}>
              <MoneyInput id="vino-retail" value={f.price_retail} onChange={(v) => set('price_retail', v)} />
            </Field>
            <Field label="Precio mayorista" htmlFor="vino-wholesale" error={wholesaleWarn} hint={<PriceInsight price={f.price_wholesale} cost={cost} />}>
              <MoneyInput id="vino-wholesale" value={f.price_wholesale} onChange={(v) => set('price_wholesale', v)} />
            </Field>
          </div>
          <div className="mt-4 rounded-xl bg-cream-deep/70 p-3.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button size="sm" variant="soft" icon={Sparkles} onClick={suggest} disabled={!cost}>
                Sugerir precio
              </Button>
              <p className="min-w-[220px] flex-1 text-[13.5px] text-ink-soft">
                {cost
                  ? `Calcula el precio para llegar a tu margen objetivo de ${pct(targetMargin, 0)} y un mayorista ${pct(wholesaleDiscount, 0)} más barato (lo cambiás en Configuración).`
                  : 'Cargá el costo para que te sugiramos un precio.'}
              </p>
            </div>
            {suggested && cost ? (
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
                <b className="text-ink">¿De dónde sale?</b> Precio = costo ÷ (1 − margen) = {money(cost)} ÷ (1 − {pct(targetMargin, 0)}) = {money(suggested.raw)}, redondeado para arriba a{' '}
                <b className="text-ink">{money(suggested.retail)}</b>. Mayorista: {pct(wholesaleDiscount, 0)} menos = <b className="text-ink">{money(suggested.wholesale)}</b> (margen{' '}
                {pct(marginOnPrice(suggested.wholesale, cost), 0)}). Ojo: sumarle {pct(targetMargin, 0)} al costo NO da {pct(targetMargin, 0)} de margen; por eso se divide.
              </p>
            ) : null}
          </div>
        </Section>

        <Section title="Stock" description={editing ? 'Las botellas se mueven solas con ventas y compras. Para roturas, regalos o un conteo, usá «Ajustar stock» en la ficha.' : undefined}>
          <div className="grid gap-4 sm:grid-cols-3">
            {!editing && (
              <Field label="Botellas que tenés hoy" htmlFor="vino-initial" hint="Si todavía no tenés, dejá 0: entran con la primera compra.">
                <IntInput id="vino-initial" value={f.initial_stock} onChange={(v) => set('initial_stock', v)} />
              </Field>
            )}
            <Field label="Stock mínimo" info="stock_minimo" htmlFor="vino-min" hint="Con esta cantidad o menos te avisamos que hay que reponer.">
              <IntInput id="vino-min" value={f.min_stock} onChange={(v) => set('min_stock', v)} />
            </Field>
            <Field label="Botellas por caja" htmlFor="vino-box" hint="Para mostrarte el stock en cajas y sugerir compras por caja cerrada.">
              <IntInput id="vino-box" value={f.units_per_box} onChange={(v) => set('units_per_box', v)} />
            </Field>
          </div>
        </Section>

        <Field label="Notas" htmlFor="vino-notes" hint="Lo que quieras recordar: maridaje, puntaje, a quién le gusta…">
          <Textarea id="vino-notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
        </Field>

        {editing && (
          <div className="rounded-xl border border-line bg-paper p-3.5">
            <Switch checked={f.active} onChange={(v) => set('active', v)} label={f.active ? 'Activo (se puede vender)' : 'Desactivado'} />
            <p className="mt-1.5 text-[13px] text-muted">Si lo desactivás, no aparece al cargar ventas ni compras, pero toda su historia queda guardada.</p>
          </div>
        )}
      </form>
    </Modal>
  )
}
