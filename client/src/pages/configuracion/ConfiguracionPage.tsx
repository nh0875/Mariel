// Pantalla provisoria: se reemplaza por la implementación real. (Ver docs/ARQUITECTURA.md)
import { PageHeader, EmptyState } from '@/components/ui'

export default function ConfiguracionPage() {
  return (
    <>
      <PageHeader title="Configuración" description="Datos del negocio, cuentas y copias de seguridad." />
      <EmptyState title="Estamos preparando esta sección">Muy pronto vas a poder usarla.</EmptyState>
    </>
  )
}
