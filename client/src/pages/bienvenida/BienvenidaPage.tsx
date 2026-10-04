// Pantalla provisoria de bienvenida (se reemplaza por el asistente de primeros pasos).
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useApiMutation } from '@/lib/queries'
import { Button } from '@/components/ui'

export default function BienvenidaPage() {
  const navigate = useNavigate()
  const done = useApiMutation(() => api.put('/settings', { onboarding: { completed: true } }), { onSuccess: () => navigate('/') })
  return (
    <div className="mx-auto max-w-xl px-6 py-20 text-center">
      <img src="/logo-vinoh.jpg" alt="VINOH!" className="mx-auto w-72 mix-blend-multiply" />
      <p className="mt-6 text-lg text-ink-soft">¡Bienvenida/o a VINOH! Finanzas!</p>
      <Button variant="primary" size="lg" className="mt-6" onClick={() => done.mutate()} loading={done.isPending}>
        Empezar
      </Button>
    </div>
  )
}
