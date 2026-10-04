import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp } from 'lucide-react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { GLOSSARY, type GlossaryEntry, type GlossaryKey } from '@/lib/glossary'

export interface InfoTipProps {
  /** Concepto del diccionario (lib/glossary.ts). */
  term?: GlossaryKey
  /** O un título/texto propio. */
  title?: string
  text?: ReactNode
  className?: string
  size?: number
}

/**
 * El "?" al lado de cada número: al pasar el mouse (o tocarlo) explica qué es,
 * cómo se calcula y por qué importa.
 */
export function InfoTip({ term, title, text, className, size = 15 }: InfoTipProps) {
  const entry: GlossaryEntry | undefined = term ? GLOSSARY[term] : undefined
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const id = useId()

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect()
    if (!b) return
    const w = 320
    const h = pop.current?.offsetHeight ?? 180
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = b.left + b.width / 2 - w / 2
    left = Math.max(12, Math.min(left, vw - w - 12))
    const above = b.bottom + h + 12 > vh && b.top - h - 12 > 0
    const top = above ? b.top - h - 8 : b.bottom + 8
    setPos({ top, left, above })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onScroll = () => place()
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, place])

  const show = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const hide = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 120)
  }

  const heading = title ?? entry?.title
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={heading ? `¿Qué es ${heading}?` : 'Más información'}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={clsx('inline-flex shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-brown focus-visible:text-brown', className)}
      >
        <CircleHelp size={size} strokeWidth={2.2} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={id}
            role="tooltip"
            onMouseEnter={show}
            onMouseLeave={hide}
            className="vh-anim-pop fixed z-[80] w-[320px] rounded-2xl border border-line bg-paper p-4 text-left text-[13.5px] leading-snug text-ink shadow-[var(--shadow-pop)]"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          >
            {heading && <p className="mb-1 text-[15px] font-extrabold">{heading}</p>}
            {entry && <p className="text-ink-soft">{entry.short}</p>}
            {text && <div className="text-ink-soft">{text}</div>}
            {entry?.formula && (
              <p className="mt-2.5 rounded-lg bg-cream-deep px-2.5 py-1.5 font-semibold text-ink">
                <span className="vh-label mr-1.5 !text-brown">Cálculo</span>
                {entry.formula}
              </p>
            )}
            {entry?.example && <p className="mt-2 text-ink-soft"><b className="text-ink">Ejemplo:</b> {entry.example}</p>}
            {entry?.why && <p className="mt-2 text-ink-soft"><b className="text-ink">¿Por qué importa?</b> {entry.why}</p>}
            {term && (
              <Link to={`/ayuda#${term}`} onClick={() => setOpen(false)} className="mt-2.5 inline-block text-[13px] font-bold text-sky-deep hover:underline">
                Ver más en Ayuda →
              </Link>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
