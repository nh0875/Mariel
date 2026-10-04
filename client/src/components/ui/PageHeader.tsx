import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { groupForPath, TONE_VAR, type Tone } from '@/lib/nav'

/**
 * Encabezado de cada pantalla: bajada con líneas (como "── VIVÍ EL VINO ──" del logo),
 * título con la tipografía de la marca y un trazo de color translúcido detrás.
 * El color sale solo del grupo del menú (celeste = entra plata, coral = sale plata…).
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  tone,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** Por defecto: el nombre del grupo del menú. */
  eyebrow?: string
  tone?: Tone
}) {
  const { pathname } = useLocation()
  const group = groupForPath(pathname)
  const t = tone ?? group?.tone ?? 'mustard'
  useEffect(() => {
    document.title = `${title} · VINOH! Finanzas`
  }, [title])
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="vh-eyebrow mb-3">{eyebrow ?? group?.label ?? 'VINOH!'}</p>
        <h1 className="vh-title text-[2.6rem] text-ink sm:text-[3.1rem]" style={{ ['--swash' as string]: TONE_VAR[t] }}>
          <span className="vh-swash" aria-hidden />
          {title}
        </h1>
        {description && <p className="mt-3 max-w-2xl text-[15.5px] text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="vh-no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
