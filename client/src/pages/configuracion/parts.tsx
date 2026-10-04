// Piezas compartidas por Configuración y Ayuda: índice lateral con anclas, scroll a #ancla con
// resaltado, borradores por sección (cada sección guarda lo suyo) y formatos chicos.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Save, Undo2 } from 'lucide-react'
import clsx from 'clsx'
import { Badge, Button } from '@/components/ui'

// ───────────────────────── Índice lateral ─────────────────────────

export interface IndexItem {
  id: string
  label: string
  icon?: LucideIcon
  /** Puntito de "cambios sin guardar". */
  dirty?: boolean
}

/** Sección que se ve ahora (para marcarla en el índice). */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null)
  const key = ids.join('|')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const visible = new Map<string, number>()
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top)
          else visible.delete(e.target.id)
        }
        if (visible.size) {
          const first = ids.find((id) => visible.has(id))
          if (first) setActive(first)
        }
      },
      { rootMargin: '-90px 0px -55% 0px', threshold: 0 },
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) obs.observe(el)
    }
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return active
}

export function scrollToId(id: string, highlight = true) {
  const el = document.getElementById(id)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  if (highlight) flash(el)
  return true
}

const FLASH = ['ring-4', 'ring-mustard/80', 'ring-offset-4', 'ring-offset-cream']
function flash(el: HTMLElement) {
  el.classList.add('transition-shadow', 'duration-500', ...FLASH)
  window.setTimeout(() => el.classList.remove(...FLASH), 1900)
}

/**
 * Índice de secciones: columna fija a la izquierda en pantallas grandes, fila de "chips"
 * deslizable en el celular.
 */
export function SectionIndex({ items, title = 'En esta página' }: { items: IndexItem[]; title?: string }) {
  const active = useActiveSection(items.map((i) => i.id))
  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    window.history.replaceState(null, '', `#${id}`)
    scrollToId(id, false)
  }
  return (
    <>
      <nav aria-label={title} className="vh-no-print sticky top-24 hidden self-start lg:block">
        <p className="vh-label mb-2 px-3">{title}</p>
        <ul className="space-y-0.5 border-l-2 border-line">
          {items.map((it) => {
            const on = active === it.id
            const Icon = it.icon
            return (
              <li key={it.id}>
                <a
                  href={`#${it.id}`}
                  onClick={go(it.id)}
                  aria-current={on ? 'location' : undefined}
                  className={clsx(
                    '-ml-0.5 flex items-center gap-2 border-l-2 py-1.5 pr-2 pl-3 text-[14px] transition-colors',
                    on ? 'border-brown font-extrabold text-ink' : 'border-transparent font-semibold text-ink-soft hover:border-line-strong hover:text-ink',
                  )}
                >
                  {Icon && <Icon size={16} className={clsx('shrink-0', on ? 'text-brown' : 'text-muted')} aria-hidden />}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-orange" title="Tiene cambios sin guardar" aria-label="sin guardar" />}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
      <nav aria-label={title} className="vh-no-print vh-scroll -mx-4 mb-1 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden">
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            onClick={go(it.id)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-paper px-3 py-1.5 text-[13.5px] font-bold whitespace-nowrap text-ink-soft"
          >
            {it.label}
            {it.dirty && <span className="h-2 w-2 rounded-full bg-orange" aria-label="sin guardar" />}
          </a>
        ))}
      </nav>
    </>
  )
}

/**
 * Si la URL trae #ancla (ej: /ayuda#cmv o /configuracion#datos), lleva la pantalla hasta ahí y la
 * resalta un ratito. Espera a que lleguen los datos (ready) y a que el menú haga su scroll arriba.
 */
export function useHashScroll(ready = true, onTarget?: (id: string) => void) {
  const { hash } = useLocation()
  const cb = useRef(onTarget)
  cb.current = onTarget
  useEffect(() => {
    if (!ready || !hash || hash.length < 2) return
    const id = decodeURIComponent(hash.slice(1))
    cb.current?.(id)
    const timers: number[] = []
    let userMoved = false
    const stop = () => {
      userMoved = true
    }
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchmove', stop, { passive: true })
    window.addEventListener('keydown', stop)
    let tries = 0
    const first = () => {
      if (scrollToId(id)) {
        // Mientras terminan de cargar las secciones de arriba, el destino se puede correr: lo volvemos a alinear.
        for (const ms of [450, 900, 1500, 2300]) {
          timers.push(
            window.setTimeout(() => {
              const el = document.getElementById(id)
              if (!el || userMoved) return
              const top = el.getBoundingClientRect().top
              const want = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
              if (Math.abs(top - want) > 24) el.scrollIntoView({ block: 'start' })
            }, ms),
          )
        }
        return
      }
      if (tries++ < 12) timers.push(window.setTimeout(first, 120))
    }
    timers.push(window.setTimeout(first, 140))
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchmove', stop)
      window.removeEventListener('keydown', stop)
    }
  }, [hash, ready])
}

// ───────────────────────── Borradores por sección ─────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Copia editable de una parte de la configuración. Mientras no la toques, sigue a lo guardado;
 * cuando la cambiás queda "sin guardar" hasta que guardes o descartes.
 */
export function useDraft<T>(source: T | undefined) {
  const [draft, setDraft] = useState<T | undefined>(source)
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched) setDraft(source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(source)])
  const dirty = touched && !same(draft, source)
  const update = useCallback((fn: (d: T) => T) => {
    setTouched(true)
    setDraft((d) => (d === undefined ? d : fn(d)))
  }, [])
  const reset = useCallback(() => {
    setTouched(false)
    setDraft(source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(source)])
  /** Después de guardar: vuelve a seguir lo guardado. */
  const saved = useCallback(() => setTouched(false), [])
  return { draft, update, dirty, reset, saved }
}

/** Avisa al padre si la sección tiene cambios sin guardar (para el índice y para no perderlos al salir). */
export function useReportDirty(id: string, dirty: boolean, onDirty?: (id: string, dirty: boolean) => void) {
  useEffect(() => {
    onDirty?.(id, dirty)
  }, [id, dirty, onDirty])
}

// ───────────────────────── Tarjeta de sección ─────────────────────────

export function SectionCard({
  id,
  icon: Icon,
  title,
  why,
  children,
  dirty,
  saving,
  onSave,
  onReset,
  saveLabel = 'Guardar',
  error,
  extraActions,
  className,
}: {
  id: string
  icon: LucideIcon
  title: ReactNode
  /** Una o dos líneas: por qué importa esta sección. */
  why: ReactNode
  children: ReactNode
  dirty?: boolean
  saving?: boolean
  /** Si viene, la sección es un formulario con su propio "Guardar" (Enter también guarda). */
  onSave?: () => void
  onReset?: () => void
  saveLabel?: string
  /** Mensaje de validación general (bloquea el guardado). */
  error?: string | null
  extraActions?: ReactNode
  className?: string
}) {
  const body = (
    <>
      <header className="px-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cream-deep text-brown" aria-hidden>
            <Icon size={20} strokeWidth={2.2} />
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <h2 className="text-[19px] leading-tight font-extrabold text-ink">{title}</h2>
            {dirty && <Badge tone="orange">Sin guardar</Badge>}
          </div>
          {extraActions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{extraActions}</div>}
        </div>
        <div className="mt-2 max-w-3xl text-[14.5px] leading-snug text-ink-soft sm:pl-[52px] [&_b]:text-ink">{why}</div>
      </header>
      <div className="px-5 pt-5 pb-5 sm:px-6">{children}</div>
      {onSave && (
        <footer className="flex flex-wrap items-center justify-end gap-2 rounded-b-[var(--radius-card)] border-t border-line bg-cream/60 px-5 py-3 sm:px-6">
          {error ? (
            <p className="mr-auto text-[13.5px] font-semibold text-bad">{error}</p>
          ) : dirty ? (
            <p className="mr-auto text-[13px] text-muted">Tenés cambios sin guardar en esta sección.</p>
          ) : (
            <p className="mr-auto text-[13px] text-muted">Todo guardado.</p>
          )}
          {dirty && onReset && (
            <Button size="sm" variant="ghost" icon={Undo2} onClick={onReset} disabled={saving}>
              Descartar
            </Button>
          )}
          <Button size="sm" type="submit" variant={dirty ? 'soft' : 'secondary'} icon={Save} loading={saving} disabled={!dirty || !!error}>
            {saveLabel}
          </Button>
        </footer>
      )}
    </>
  )
  const cls = clsx('vh-card min-w-0 scroll-mt-24', className)
  if (!onSave) {
    return (
      <section id={id} className={cls}>
        {body}
      </section>
    )
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (dirty && !error && !saving) onSave()
  }
  return (
    <form id={id} className={cls} onSubmit={submit} noValidate>
      {body}
    </form>
  )
}

/** Caja de "ejemplo" que se recalcula con lo que vas escribiendo. */
export function Example({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={clsx('rounded-xl bg-cream-deep/70 px-3 py-2 text-[13.5px] leading-snug text-ink-soft [&_b]:text-ink', className)}>
      <span className="vh-label mr-1.5 !text-brown">Ejemplo</span>
      {children}
    </p>
  )
}

// ───────────────────────── Formatos ─────────────────────────

/** 2154496 → "2,1 MB" */
export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} ${units[u]}`
}

const dtFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

/** ISO con hora → "04/10/2026 17:11" (hora de esta compu). */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dtFmt.format(d).replace(',', '')
}

/** ISO con hora → "hace 3 horas", "ayer", "hace 5 días". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return 'recién'
  if (mins < 60) return `hace ${mins} ${mins === 1 ? 'minuto' : 'minutos'}`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`
  const days = Math.round(hours / 24)
  if (days === 1) return 'ayer'
  return `hace ${days} días`
}

/** Saca acentos y pasa a minúsculas (para comparar nombres). */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export function useDirtyRegistry() {
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const onDirty = useCallback((id: string, d: boolean) => setDirty((m) => (m[id] === d ? m : { ...m, [id]: d })), [])
  const any = useMemo(() => Object.values(dirty).some(Boolean), [dirty])
  // Si te vas de la página con cambios sin guardar, el navegador pregunta.
  useEffect(() => {
    if (!any) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [any])
  return { dirty, onDirty, any }
}

/** Que "$ 10.000" o "6,29 %" no se corten en dos renglones (money() usa un espacio común). */
export const nb = (s: string) => s.replace(/ /g, ' ')

/** 1 → "1 gasto", 3 → "3 gastos" (con separador de miles). */
export function plural(n: number, one: string, many: string): string {
  return `${new Intl.NumberFormat('es-AR').format(n)} ${n === 1 ? one : many}`
}
