// "Lista de precios": un Excel prolijo para mandarle a clientes (sin costos ni márgenes).
import { useEffect, useState } from 'react'
import { Store, Truck } from 'lucide-react'
import { ChoiceCards, ExportButton, Button, Modal } from '@/components/ui'

export function PriceListModal({ open, onClose, count }: { open: boolean; onClose: () => void; count: number }) {
  const [list, setList] = useState<'minorista' | 'mayorista'>('minorista')
  useEffect(() => {
    if (open) setList('minorista')
  }, [open])
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
          <ExportButton path="/products/price-list" params={{ list }} label={list === 'mayorista' ? 'Descargar lista mayorista' : 'Descargar lista minorista'} variant="primary" />
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
            Incluye tus <b className="text-ink">{count} vinos activos</b> con precio, agrupados por tipo (tintos, blancos, espumantes…), con bodega, varietal y cosecha.
          </p>
          <p className="mt-1">
            <b className="text-ink">No incluye costos ni márgenes</b>: es para tus clientes. Los vinos sin stock aparecen como «Consultar». Tus datos de contacto salen de Configuración.
          </p>
        </div>
      </div>
    </Modal>
  )
}
