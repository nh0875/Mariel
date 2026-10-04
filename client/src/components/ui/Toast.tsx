import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import clsx from 'clsx'

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}
interface ToastApi {
  success: (m: string) => void
  error: (m: string) => void
  info: (m: string) => void
}

const Ctx = createContext<ToastApi | null>(null)

/** Avisos que aparecen abajo a la derecha ("✓ Venta guardada"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++seq.current
      setItems((xs) => [...xs.slice(-3), { id, kind, message }])
      window.setTimeout(() => remove(id), kind === 'error' ? 7000 : 3500)
    },
    [remove],
  )
  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) }),
    [push],
  )
  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[90] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => {
          const Icon = t.kind === 'success' ? CircleCheck : t.kind === 'error' ? TriangleAlert : Info
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={clsx(
                'vh-anim-pop pointer-events-auto flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-[14.5px] font-semibold shadow-[var(--shadow-pop)]',
                t.kind === 'success' && 'border-good/25 bg-paper text-ink',
                t.kind === 'error' && 'border-bad/30 bg-bad-soft text-ink',
                t.kind === 'info' && 'border-sky/40 bg-paper text-ink',
              )}
            >
              <Icon size={19} className={clsx('mt-0.5 shrink-0', t.kind === 'success' ? 'text-good' : t.kind === 'error' ? 'text-bad' : 'text-sky-deep')} aria-hidden />
              <span className="flex-1">{t.message}</span>
              <button onClick={() => remove(t.id)} aria-label="Cerrar aviso" className="text-muted hover:text-ink">
                <X size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast fuera de ToastProvider')
  return v
}
