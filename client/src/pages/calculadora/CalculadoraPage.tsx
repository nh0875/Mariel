// Pantalla provisoria: se reemplaza por la implementación real. (Ver docs/ARQUITECTURA.md)
import { PageHeader, EmptyState } from '@/components/ui'

export default function CalculadoraPage() {
  return (
    <>
      <PageHeader title="Calculadora" description="¿A cuánto lo vendo? ¿Cuánto tengo que vender?" />
      <EmptyState title="Estamos preparando esta sección">Muy pronto vas a poder usarla.</EmptyState>
    </>
  )
}
