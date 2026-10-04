import { useState, type ReactNode } from 'react'
import { ChevronDown, Lightbulb } from 'lucide-react'
import clsx from 'clsx'

function readClosed(id: string): boolean {
  try {
    return localStorage.getItem(`vinoh.help.${id}`) === 'closed'
  } catch {
    return false
  }
}
function writeClosed(id: string, closed: boolean) {
  try {
    localStorage.setItem(`vinoh.help.${id}`, closed ? 'closed' : 'open')
  } catch {
    /* sin localStorage */
  }
}

/**
 * "¿Para qué sirve esta pantalla?" — explicación plegable al principio de cada sección.
 * Se recuerda si la cerraste (por pantalla), así no molesta a quien ya la leyó.
 */
export function HelpBox({
  id,
  title = '¿Para qué sirve esta pantalla?',
  children,
  className,
  defaultOpen = true,
}: {
  /** Identificador único (ej: "ventas") para recordar si está abierta o cerrada. */
  id: string
  title?: string
  children: ReactNode
  className?: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(() => (readClosed(id) ? false : defaultOpen))
  const toggle = () => {
    setOpen((o) => {
      writeClosed(id, o)
      return !o
    })
  }
  return (
    <div className={clsx('vh-no-print rounded-2xl border border-mustard/50 bg-mustard-soft/70', className)}>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mustard/60 text-ink">
          <Lightbulb size={16} strokeWidth={2.4} aria-hidden />
        </span>
        <span className="flex-1 font-extrabold text-ink">{title}</span>
        <span className="text-[13px] font-bold text-ink-soft">{open ? 'Ocultar' : 'Mostrar'}</span>
        <ChevronDown size={18} className={clsx('text-ink-soft transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="vh-anim-fade space-y-2 px-4 pb-4 pl-[3.25rem] text-[14.5px] leading-relaxed text-ink-soft [&_b]:text-ink [&_li]:ml-4 [&_li]:list-disc [&_ul]:space-y-1">{children}</div>}
    </div>
  )
}
