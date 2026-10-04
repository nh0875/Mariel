// "Aumentar precios": sube (o baja) los precios de muchos vinos de una vez, por porcentaje,
// con vista previa de cómo quedan antes de guardar.
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { WINE_TYPES, WINE_TYPE_LABELS, type WineType } from '@shared/constants'
import { api } from '@/lib/api'
import { money, pct } from '@/lib/format'
import { useDebounced } from '@/lib/hooks'
import { useApiMutation, useSettings } from '@/lib/queries'
import { Badge, Button, ChoiceCards, DataTable, Field, HelpBox, Modal, NumberInput, Select, Spinner, useConfirm } from '@/components/ui'
import type { BulkPriceChange, BulkPriceResult, ProductRow } from './types'
import { marginTone } from './shared'

type ApplyTo = 'both' | 'retail' | 'wholesale'
type Scope = 'all' | 'winery' | 'type'

const ROUND_OPTIONS = [
  { value: 0, label: 'No redondear' },
  { value: 10, label: 'A los $10' },
  { value: 50, label: 'A los $50' },
  { value: 100, label: 'A los $100' },
  { value: 500, label: 'A los $500' },
  { value: 1000, label: 'A los $1.000' },
]

function Change({ before, after }: { before: number; after: number }) {
  if (!before) return <span className="text-muted">sin precio</span>
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-muted line-through decoration-muted/50">{money(before)}</span>
      <ArrowRight size={13} className="text-muted" aria-hidden />
      <b className="text-ink">{money(after)}</b>
    </span>
  )
}

export function BulkPriceModal({ open, onClose, products }: { open: boolean; onClose: () => void; products: ProductRow[] }) {
  const confirm = useConfirm()
  const { data: settings } = useSettings()
  const target = (settings?.pricing.target_margin_pct ?? 40) / 100
  const [percent, setPercent] = useState<number | null>(10)
  const [applyTo, setApplyTo] = useState<ApplyTo>('both')
  const [scope, setScope] = useState<Scope>('all')
  const [winery, setWinery] = useState('')
  const [wineType, setWineType] = useState<WineType | ''>('')
  const [roundTo, setRoundTo] = useState(100)

  useEffect(() => {
    if (open) {
      setPercent(10)
      setApplyTo('both')
      setScope('all')
      setWinery('')
      setWineType('')
      setRoundTo(100)
    }
  }, [open])

  const wineries = useMemo(() => [...new Set(products.filter((p) => p.active && p.winery).map((p) => p.winery as string))].sort((a, b) => a.localeCompare(b, 'es')), [products])

  const percentError =
    percent == null ? 'Escribí un porcentaje.' : percent === 0 && !roundTo ? 'Con 0 % no cambia nada.' : percent < -90 ? 'Como mucho podés bajar 90 %.' : percent > 1000 ? 'Es demasiado.' : undefined
  const scopeMissing = (scope === 'winery' && !winery) || (scope === 'type' && !wineType)

  const body = useMemo(
    () => ({
      percent: percent ?? 0,
      apply_to: applyTo,
      round_to: roundTo,
      winery: scope === 'winery' ? winery || null : null,
      wine_type: scope === 'type' ? wineType || null : null,
    }),
    [percent, applyTo, roundTo, scope, winery, wineType],
  )
  const debounced = useDebounced(body, 350)
  const preview = useQuery({
    queryKey: ['/products/bulk-price', 'preview', debounced],
    queryFn: () => api.post<BulkPriceResult>('/products/bulk-price?preview=1', debounced),
    enabled: open && !percentError && !scopeMissing,
  })
  const result = !percentError && !scopeMissing ? preview.data : undefined
  const count = result?.updated ?? 0

  const apply = useApiMutation(() => api.post<BulkPriceResult>('/products/bulk-price', body), {
    success: (r) => `Listo: actualizamos los precios de ${r.updated} ${r.updated === 1 ? 'vino' : 'vinos'}`,
    onSuccess: onClose,
  })

  const onApply = async () => {
    const ok = await confirm({
      title: `¿Aplicar ${percent && percent > 0 ? 'el aumento' : 'el cambio'} a ${count} ${count === 1 ? 'vino' : 'vinos'}?`,
      message: 'Las ventas que ya cargaste no cambian: los precios nuevos corren para las próximas. Si te equivocás, podés hacer otro cambio con el porcentaje al revés.',
      confirmText: 'Sí, aplicar',
    })
    if (ok) apply.mutate()
  }

  const examples: BulkPriceChange[] = result?.examples ?? []
  const avgMarginAfter = examples.length ? examples.filter((e) => e.after_retail > 0).reduce((s, e) => s + e.margin_after, 0) / Math.max(1, examples.filter((e) => e.after_retail > 0).length) : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Aumentar precios"
      subtitle="Actualizá muchos precios de una vez, por porcentaje. Mirás cómo quedan antes de guardar."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onApply} loading={apply.isPending} disabled={!!percentError || scopeMissing || count === 0 || preview.isFetching}>
            {count ? `Aplicar a ${count} ${count === 1 ? 'vino' : 'vinos'}` : 'Aplicar'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <HelpBox id="vinos-aumento" title="¿Por qué conviene actualizar precios seguido?">
          <p>
            Con inflación, tus costos suben todos los meses. Si no actualizás, <b>tu margen se achica sin que te des cuenta</b>: un vino que te dejaba 40 % puede pasar a dejarte 30 % en pocos meses,
            aunque vendas lo mismo.
          </p>
          <p>
            <b>Ejemplo:</b> si la bodega te aumentó 8 %, subí 8 % y mantenés el mismo margen. Un Malbec de $12.500 pasa a $13.500, y tu ganancia por botella crece igual que el costo.
          </p>
          <p>
            <b>¿Por qué redondear?</b> Un precio como $13.500 es más fácil de leer, de cobrar y de dar vuelto que $13.437,80. Siempre redondeamos <b>para arriba</b>, así nunca perdés margen por
            redondear.
          </p>
          <p>Para bajar precios (una promo, por ejemplo), poné un número negativo: −10 baja 10 %.</p>
        </HelpBox>

        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <Field label="¿Cuánto?" required error={percentError} hint="Porcentaje sobre el precio actual. Negativo para bajar.">
            <div className="flex flex-wrap items-center gap-2">
              <NumberInput value={percent} onChange={setPercent} decimals={1} suffix="%" className="w-[130px]" aria-label="Porcentaje" />
              {[5, 8, 10, 15, 20].map((v) => (
                <Button key={v} size="sm" variant={percent === v ? 'soft' : 'ghost'} onClick={() => setPercent(v)} aria-pressed={percent === v}>
                  {v} %
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Redondeo" hint="Para arriba, al múltiplo que elijas.">
            <Select value={roundTo} onChange={(v) => setRoundTo(Number(v))} options={ROUND_OPTIONS} />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-[14px] font-bold text-ink">¿Qué precios?</p>
          <ChoiceCards
            columns={3}
            value={applyTo}
            onChange={setApplyTo}
            options={[
              { value: 'both', title: 'Los dos', description: 'Minorista y mayorista.' },
              { value: 'retail', title: 'Solo minorista', description: 'El de venta al público.' },
              { value: 'wholesale', title: 'Solo mayorista', description: 'Restós, vinotecas, cajas.' },
            ]}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <Field label="¿A qué vinos?" hint="Solo se cambian los vinos activos.">
            <Select
              value={scope}
              onChange={(v) => setScope(v as Scope)}
              options={[
                { value: 'all', label: 'A todos los vinos' },
                { value: 'winery', label: 'Solo los de una bodega' },
                { value: 'type', label: 'Solo un tipo (tintos, blancos…)' },
              ]}
            />
          </Field>
          {scope === 'winery' && (
            <Field label="Bodega" required error={!winery ? 'Elegí la bodega.' : undefined}>
              <Select value={winery} onChange={setWinery} placeholder="Elegí una bodega…" options={wineries.map((w) => ({ value: w, label: w }))} />
            </Field>
          )}
          {scope === 'type' && (
            <Field label="Tipo" required error={!wineType ? 'Elegí el tipo.' : undefined}>
              <Select value={wineType} onChange={(v) => setWineType(v as WineType)} placeholder="Elegí un tipo…" options={WINE_TYPES.map((t) => ({ value: t, label: WINE_TYPE_LABELS[t] }))} />
            </Field>
          )}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-bold text-ink">Así quedarían</p>
            {preview.isFetching && <Spinner size={14} className="text-muted" />}
            {result && (
              <Badge tone="sky">
                {count} {count === 1 ? 'vino cambia' : 'vinos cambian'}
              </Badge>
            )}
            {avgMarginAfter != null && applyTo !== 'wholesale' && (
              <span className="text-[13px] text-ink-soft">
                · margen minorista promedio después: <b className="text-ink">{pct(avgMarginAfter, 0)}</b>
              </span>
            )}
          </div>
          {percentError || scopeMissing ? (
            <p className="rounded-xl bg-cream-deep px-4 py-6 text-center text-[14px] text-ink-soft">Completá lo de arriba y te mostramos cómo quedan los precios.</p>
          ) : (
            <DataTable
              dense
              rows={examples}
              rowKey={(r) => r.id}
              pageSize={8}
              searchPlaceholder="Buscar un vino en la lista…"
              empty={<p className="rounded-xl bg-cream-deep px-4 py-6 text-center text-[14px] text-ink-soft">{preview.isFetching ? 'Calculando…' : 'Ningún precio cambia con esta combinación.'}</p>}
              columns={[
                {
                  key: 'name',
                  header: 'Vino',
                  cell: (r) => (
                    <span className="block min-w-[140px]">
                      <span className="font-bold text-ink">{r.name}</span>
                      {r.winery && <span className="block text-[12.5px] text-muted">{r.winery}</span>}
                    </span>
                  ),
                },
                ...(applyTo !== 'wholesale'
                  ? [
                      {
                        key: 'after_retail',
                        header: 'Minorista',
                        align: 'right' as const,
                        value: (r: BulkPriceChange) => r.after_retail,
                        cell: (r: BulkPriceChange) => <Change before={r.before_retail} after={r.after_retail} />,
                      },
                    ]
                  : []),
                ...(applyTo !== 'retail'
                  ? [
                      {
                        key: 'after_wholesale',
                        header: 'Mayorista',
                        align: 'right' as const,
                        hideBelow: applyTo === 'both' ? ('md' as const) : undefined,
                        value: (r: BulkPriceChange) => r.after_wholesale,
                        cell: (r: BulkPriceChange) => <Change before={r.before_wholesale} after={r.after_wholesale} />,
                      },
                    ]
                  : []),
                {
                  key: 'margin_after',
                  header: 'Margen min.',
                  align: 'right' as const,
                  hideBelow: 'sm' as const,
                  value: (r: BulkPriceChange) => r.margin_after,
                  cell: (r: BulkPriceChange) =>
                    r.after_retail > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-muted">{pct(r.margin_before, 0)}</span>
                        <ArrowRight size={12} className="text-muted" aria-hidden />
                        <Badge tone={marginTone(r.margin_after, target)}>{pct(r.margin_after, 0)}</Badge>
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    ),
                },
              ]}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
