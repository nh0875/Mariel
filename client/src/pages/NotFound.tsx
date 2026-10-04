import { Link } from 'react-router-dom'
import { EmptyState, Button } from '@/components/ui'
import { Wine } from 'lucide-react'

export default function NotFound() {
  return (
    <EmptyState icon={Wine} title="Acá no hay nada (ni siquiera vino)" action={<Link to="/"><Button variant="primary">Volver al inicio</Button></Link>}>
      Esa página no existe. Usá el menú de la izquierda para ir a donde querías.
    </EmptyState>
  )
}
