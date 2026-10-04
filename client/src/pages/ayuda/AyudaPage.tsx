// Pantalla provisoria: se reemplaza por la implementación real. (Ver docs/ARQUITECTURA.md)
import { PageHeader, EmptyState } from '@/components/ui'

export default function AyudaPage() {
  return (
    <>
      <PageHeader title="Ayuda" description="Cómo se usa y qué significa cada número." />
      <EmptyState title="Estamos preparando esta sección">Muy pronto vas a poder usarla.</EmptyState>
    </>
  )
}
