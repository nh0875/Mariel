// Aviso antes de salir de una pantalla con cambios sin guardar (ej. Configuración).
// El router que usamos (BrowserRouter) no tiene "bloqueo de navegación", así que mientras haya
// cambios interceptamos los clics en links internos (menú, logo, avisos) y en los botones que
// navegan con `data-nav-to` (los de «Cargar: Venta / Gasto / Compra»). Si la persona confirma,
// navegamos igual; si no, se queda. Para recargar o cerrar la pestaña está el aviso del navegador
// (beforeunload).
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useConfirm } from '@/components/ui'

export interface LeaveGuardText {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
}

export function useLeaveGuard(active: boolean, text: LeaveGuardText) {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const location = useLocation()
  // Refs: el listener se instala una sola vez por "activo" y siempre lee lo último.
  const ref = useRef({ text, pathname: location.pathname, confirm, navigate })
  ref.current = { text, pathname: location.pathname, confirm, navigate }

  useEffect(() => {
    if (!active) return
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const el = (e.target as Element | null)?.closest?.('a[href], [data-nav-to]')
      if (!el) return
      if (el instanceof HTMLAnchorElement && (el.target === '_blank' || el.hasAttribute('download'))) return
      const raw = el.getAttribute('data-nav-to') ?? el.getAttribute('href')
      if (!raw || raw.startsWith('#') || /^(mailto|tel):/i.test(raw)) return
      let url: URL
      try {
        url = new URL(raw, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return
      const { pathname, text: t, confirm: ask, navigate: go } = ref.current
      if (url.pathname === pathname) return // mismo lugar (ej. el índice de secciones)
      e.preventDefault()
      e.stopPropagation()
      void ask({ title: t.title, message: t.message, confirmText: t.confirmText ?? 'Salir sin guardar', cancelText: t.cancelText ?? 'Quedarme', danger: true }).then((ok) => {
        if (ok) go(url.pathname + url.search + url.hash)
      })
    }
    // Fase de captura en document: corre antes que el onClick de React (que escucha en la raíz).
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [active])
}
