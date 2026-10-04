import { AlertTriangle, RotateCcw } from 'lucide-react'
import clsx from 'clsx'

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={clsx('inline-block rounded-full border-2 border-current border-r-transparent', className)}
      style={{ width: size, height: size, animation: 'vh-spin .7s linear infinite' }}
    />
  )
}

/** Bloque de "cargando" para cuando todavía no llegaron los datos. */
export function Loading({ label = 'Cargando…', className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex items-center justify-center gap-3 py-14 text-muted', className)}>
      <Spinner size={20} />
      <span className="font-semibold">{label}</span>
    </div>
  )
}

/** Error al cargar datos, con botón para reintentar. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const msg = error instanceof Error ? error.message : String(error ?? 'Error desconocido')
  return (
    <div className={clsx('flex flex-col items-center gap-3 rounded-2xl border border-bad/25 bg-bad-soft/60 px-6 py-8 text-center', className)}>
      <AlertTriangle className="text-bad" size={26} aria-hidden />
      <p className="max-w-md font-semibold text-ink">{msg}</p>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-full bg-paper px-4 py-1.5 text-sm font-bold text-ink shadow-sm hover:bg-cream">
          <RotateCcw size={15} /> Reintentar
        </button>
      )}
    </div>
  )
}
