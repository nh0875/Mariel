import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Plus, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { inputClass, useFieldLabelId } from './Field'

export interface ComboOption<V extends string | number = number> {
  value: V
  label: string
  /** Texto chico debajo (ej: "Bodega Norton · stock 12"). */
  sublabel?: string
  /** Algo a la derecha (ej: el precio). */
  meta?: ReactNode
  /** Palabras extra para la búsqueda. */
  keywords?: string
  disabled?: boolean
}

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * Desplegable con buscador. Escribís parte del nombre y filtra (sin importar tildes).
 * Con onCreate aparece "+ Agregar «texto»" para crear algo nuevo sin salir del formulario.
 */
export function Combobox<V extends string | number>({
  options,
  value,
  onChange,
  placeholder = 'Elegí una opción…',
  searchPlaceholder = 'Buscar…',
  emptyText = 'No hay coincidencias',
  allowClear,
  onCreate,
  createLabel = 'Agregar',
  disabled,
  className,
  invalid,
  id,
}: {
  options: ComboOption<V>[]
  value: V | null | undefined
  onChange: (v: V | null) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  allowClear?: boolean
  onCreate?: (text: string) => void | Promise<void>
  createLabel?: string
  disabled?: boolean
  className?: string
  invalid?: boolean
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<{ top: number; left: number; width: number; maxH: number; above: boolean } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const selected = options.find((o) => o.value === value)
  // Dentro de un Field: el botón se nombra con la etiqueta + lo elegido («Vino: Malbec Reserva»).
  const autoId = useId()
  const triggerId = id ?? autoId
  const fieldLabelId = useFieldLabelId()

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return options
    const words = q.split(/\s+/)
    return options.filter((o) => {
      const hay = normalize(`${o.label} ${o.sublabel ?? ''} ${o.keywords ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
  }, [options, query])

  const place = () => {
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    const spaceBelow = window.innerHeight - r.bottom - 12
    const spaceAbove = r.top - 12
    const above = spaceBelow < 260 && spaceAbove > spaceBelow
    const maxH = Math.min(360, above ? spaceAbove : spaceBelow)
    setRect({ top: above ? r.top - 6 : r.bottom + 6, left: r.left, width: Math.max(r.width, 280), maxH, above })
  }

  useLayoutEffect(() => {
    if (open) place()
  }, [open])

  useEffect(() => {
    if (!open) return
    setActive(0)
    const t = window.setTimeout(() => search.current?.focus(), 10)
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false)
    }
    const onMove = () => place()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (o: ComboOption<V>) => {
    if (o.disabled) return
    onChange(o.value)
    setOpen(false)
    setQuery('')
    trigger.current?.focus()
  }

  const canCreate = !!onCreate && query.trim().length > 1 && !options.some((o) => normalize(o.label) === normalize(query.trim()))
  const total = filtered.length + (canCreate ? 1 : 0)

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active < filtered.length) {
        const o = filtered[active]
        if (o) choose(o)
      } else if (canCreate) {
        void onCreate!(query.trim())
        setOpen(false)
        setQuery('')
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className={clsx('relative min-w-0', className)}>
      <button
        ref={trigger}
        id={triggerId}
        aria-labelledby={fieldLabelId && !id ? `${fieldLabelId} ${triggerId}` : undefined}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || (e.key.length === 1 && /\S/.test(e.key))) {
            e.preventDefault()
            if (e.key.length === 1) setQuery(e.key)
            setOpen(true)
          }
        }}
        className={clsx(inputClass, 'flex items-center gap-2 pr-9 text-left')}
      >
        <span className={clsx('min-w-0 flex-1 truncate', !selected && 'text-muted/80')}>{selected ? selected.label : placeholder}</span>
        {selected?.meta && <span className="hidden shrink-0 text-sm text-ink-soft sm:inline">{selected.meta}</span>}
      </button>
      {allowClear && selected && !disabled ? (
        <button type="button" aria-label="Quitar selección" onClick={() => onChange(null)} className="absolute top-1/2 right-2.5 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-cream-deep hover:text-ink">
          <X size={15} />
        </button>
      ) : (
        <ChevronDown size={17} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-soft" aria-hidden />
      )}
      {open &&
        rect &&
        createPortal(
          <div
            ref={panel}
            className="vh-anim-pop fixed z-[85] flex flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-[var(--shadow-pop)]"
            style={{ left: rect.left, width: rect.width, maxHeight: rect.maxH, ...(rect.above ? { bottom: window.innerHeight - rect.top } : { top: rect.top }) }}
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Search size={16} className="text-muted" aria-hidden />
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder={searchPlaceholder}
                className="h-8 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70"
                aria-label={searchPlaceholder}
              />
            </div>
            <ul ref={list} role="listbox" className="vh-scroll flex-1 overflow-y-auto py-1">
              {filtered.map((o, i) => (
                <li
                  key={String(o.value)}
                  data-idx={i}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(o)
                  }}
                  className={clsx(
                    'mx-1 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2',
                    i === active && 'bg-cream-deep',
                    o.value === value && 'font-bold',
                    o.disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-ink">{o.label}</span>
                    {o.sublabel && <span className="block truncate text-[12.5px] text-muted">{o.sublabel}</span>}
                  </span>
                  {o.meta && <span className="shrink-0 text-[13px] text-ink-soft">{o.meta}</span>}
                </li>
              ))}
              {canCreate && (
                <li
                  data-idx={filtered.length}
                  role="option"
                  aria-selected={false}
                  onMouseEnter={() => setActive(filtered.length)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    void onCreate!(query.trim())
                    setOpen(false)
                    setQuery('')
                  }}
                  className={clsx('mx-1 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 font-bold text-sky-deep', active === filtered.length && 'bg-sky-soft')}
                >
                  <Plus size={16} aria-hidden /> {createLabel} «{query.trim()}»
                </li>
              )}
              {total === 0 && <li className="px-4 py-6 text-center text-sm text-muted">{emptyText}</li>}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  )
}
