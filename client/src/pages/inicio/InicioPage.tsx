// Pantalla provisoria: se reemplaza por la implementación real. (Ver docs/ARQUITECTURA.md)
import { PageHeader, EmptyState } from '@/components/ui'

export default function InicioPage() {
  return (
    <>
      <PageHeader title="¿Cómo venimos?" description="El resumen del negocio de un vistazo." />
      <EmptyState title="Estamos preparando esta sección">Muy pronto vas a poder usarla.</EmptyState>
    </>
  )
}
