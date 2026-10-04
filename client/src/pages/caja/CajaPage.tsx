// Pantalla provisoria: se reemplaza por la implementación real. (Ver docs/ARQUITECTURA.md)
import { PageHeader, EmptyState } from '@/components/ui'

export default function CajaPage() {
  return (
    <>
      <PageHeader title="Caja y bancos" description="Cuánta plata hay y dónde." />
      <EmptyState title="Estamos preparando esta sección">Muy pronto vas a poder usarla.</EmptyState>
    </>
  )
}
