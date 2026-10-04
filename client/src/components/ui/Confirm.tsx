import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

const Ctx = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null)

/**
 * Pregunta "¿Seguro?" antes de hacer algo que no se puede deshacer.
 * Uso: const confirm = useConfirm(); if (await confirm({ title: '¿Borrar la venta?', danger: true })) …
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])
  const close = (v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setOpts(null)
  }
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        onClose={() => close(false)}
        title={opts?.title ?? ''}
        size="sm"
        footer={
          <>
            {/* Si la acción es peligrosa, el foco arranca en "Cancelar" (un Enter distraído no borra nada). */}
            <Button variant="ghost" onClick={() => close(false)} data-autofocus={opts?.danger ? true : undefined}>
              {opts?.cancelText ?? 'Cancelar'}
            </Button>
            <Button variant={opts?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus={opts?.danger ? undefined : true}>
              {opts?.confirmText ?? 'Sí, dale'}
            </Button>
          </>
        }
      >
        <div className="text-[15px] text-ink-soft">{opts?.message ?? 'Esta acción no se puede deshacer.'}</div>
      </Modal>
    </Ctx.Provider>
  )
}

export function useConfirm() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useConfirm fuera de ConfirmProvider')
  return v
}
