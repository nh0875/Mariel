import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import clsx from 'clsx'

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }

/**
 * Ventana sobre la pantalla (para formularios y detalles).
 * Se cierra con Esc, con la X o tocando afuera (si no hay cambios sin guardar: pasá dismissable={false}).
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  dismissable = true,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  /** Botones de abajo (Cancelar / Guardar). */
  footer?: ReactNode
  size?: keyof typeof SIZES
  dismissable?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea')
      ;(first ?? panel.current)?.focus()
    }, 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div className="vh-anim-fade absolute inset-0 bg-ink/35 backdrop-blur-[2px]" onClick={() => dismissable && onClose()} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={clsx(
          'vh-anim-pop relative flex max-h-[94vh] w-full flex-col rounded-t-[1.5rem] border border-line bg-cream shadow-[var(--shadow-pop)] outline-none sm:rounded-[1.5rem]',
          SIZES[size],
        )}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 pt-5 pb-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1.9rem] leading-none text-ink">{title}</h2>
            {subtitle && <p className="mt-1.5 text-sm text-ink-soft">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="-mt-1 -mr-1 grid h-9 w-9 place-items-center rounded-full text-ink-soft hover:bg-cream-deep hover:text-ink">
            <X size={20} />
          </button>
        </header>
        <div className="vh-scroll flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper/60 px-5 py-4 sm:rounded-b-[1.5rem] sm:px-6">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
