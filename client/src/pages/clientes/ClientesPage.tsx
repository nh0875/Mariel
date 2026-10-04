// Pantalla provisoria: se reemplaza por la implementación real. (Ver docs/ARQUITECTURA.md)
import { PageHeader, EmptyState } from '@/components/ui'

export default function ClientesPage() {
  return (
    <>
      <PageHeader title="Clientes" description="Quién te compra y quién te debe." />
      <EmptyState title="Estamos preparando esta sección">Muy pronto vas a poder usarla.</EmptyState>
    </>
  )
}
