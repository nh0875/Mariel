// "Lista de precios": un Excel prolijo para mandarle a clientes (sin costos ni márgenes).
import { useEffect, useState } from 'react'
import { Store, Truck } from 'lucide-react'
import { ChoiceCards, ExportButton, Button, Modal } from '@/components/ui'
import type { ProductRow } from './types'

export function PriceListModal({ open, onClose, products }: { open: boolean; onClose: () => void; products: ProductRow[] }) {
  const [list, setList] = useState<'minorista' | 'mayorista'>('minorista')
  useEffect(() => {
    if (open) setList('minorista')
  }, [open])
  const active = products.filter((p) => p.active)
  const count = active.filter((p) => (list === 'mayorista' ? p.price_wholesale : p.price_retail) > 0).length
  const missing = active.length - count
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lista de precios"
      subtitle="Un Excel prolijo para mandar por WhatsApp o mail, o para imprimir."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <ExportButton
            path="/products/price-list"
            params={{ list }}
            label={list === 'mayorista' ? 'Descargar lista mayorista' : 'Descargar lista minorista'}
            variant="primary"
            disabled={count === 0}
          />
        </>
      }
    >
      <div className="space-y-4">
        <ChoiceCards
          value={list}
          onChange={setList}
          options={[
            { value: 'minorista', title: 'Minorista', description: 'Para clientes finales: el precio de góndola.', icon: Store },
            { value: 'mayorista', title: 'Mayorista', description: 'Para restós, vinotecas y compras por caja.', icon: Truck },
          ]}
        />
        <div className="rounded-xl bg-cream-deep/80 px-4 py-3 text-[14px] leading-relaxed text-ink-soft">
          <p>
            Incluye tus <b className="text-ink">{count === 1 ? '1 vino activo' : `${count} vinos activos`}</b> con precio {list}, agrupados por tipo (tintos, blancos, espumantes…), con bodega,
            varietal y cosecha.
            {missing > 0 && ` ${missing === 1 ? 'Queda afuera 1 vino' : `Quedan afuera ${missing} vinos`} sin precio ${list} cargado.`}
          </p>
          <p className="mt-1">
            <b className="text-ink">No incluye costos ni márgenes</b>: es para tus clientes. Los vinos sin stock aparecen como «Consultar». Tus datos de contacto salen de Configuración.
          </p>
        </div>
      </div>
    </Modal>
  )
}
