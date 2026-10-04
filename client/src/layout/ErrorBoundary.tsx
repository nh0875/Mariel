import { Component, type ReactNode } from 'react'

/**
 * ¿El error es porque no se pudo bajar el código de una pantalla? Pasa si el programa (la ventana
 * negra) está cerrado, o si se actualizó VINOH! con la pestaña abierta (los archivos cambiaron de nombre).
 */
export function isChunkLoadError(error: unknown): boolean {
  const msg = String((error as Error)?.message ?? error ?? '')
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk .* failed|Unable to preload CSS/i.test(msg)
}

const RELOAD_FLAG = 'vinoh.chunkReload'

/** Recarga la página una sola vez (si ya se recargó hace menos de 30 s, no: evita un bucle). */
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

interface Props {
  children: ReactNode
  /** Si cambia (ej. la ruta), se olvida el error: moverse a otra pantalla la recupera. */
  resetKey?: string
  /** Dentro del programa (con el menú alrededor) en vez de pantalla completa. */
  inline?: boolean
}

/**
 * Si una pantalla se rompe, mostramos un mensaje amable en vez de una pantalla en blanco.
 * - Hay uno por pantalla (dentro del menú): si una falla, el menú sigue y podés ir a otra.
 * - Si el problema es que no se pudo cargar la pantalla (programa cerrado o recién actualizado),
 *   recargamos solos una vez; si sigue, explicamos que hay que abrir VINOH!.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null; key?: string }> {
  state = { error: null as Error | null, key: this.props.resetKey }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  static getDerivedStateFromProps(props: Props, state: { error: Error | null; key?: string }) {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey }
    return null
  }
  componentDidCatch(error: Error) {
    console.error('[VINOH]', error)
    // Si el programa está andando, seguramente se actualizó: recargamos una vez y listo. Si no
    // contesta (ventana negra cerrada), no recargamos: mostramos cómo abrirlo.
    if (isChunkLoadError(error)) {
      fetch('/api/health', { cache: 'no-store' })
        .then((r) => {
          if (r.ok) reloadOnce()
        })
        .catch(() => {
          /* programa cerrado: queda el mensaje */
        })
    }
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = isChunkLoadError(error)
    const title = chunk ? 'No pudimos abrir esta pantalla' : 'Uy, algo se rompió en esta pantalla 🍷'
    const text = chunk
      ? 'Puede ser que el programa esté cerrado (la ventana negra) o que se haya actualizado. Si cerraste la ventana negra, volvé a abrir VINOH! con el archivo INICIAR y después tocá «Probar de nuevo». Tus datos están a salvo.'
      : 'Tus datos están a salvo. Probá de nuevo o andá a otra pantalla del menú; si sigue pasando, cerrá y volvé a abrir el programa.'
    if (this.props.inline) {
      return (
        <div className="vh-card mx-auto mt-6 max-w-[620px] p-6 text-center" role="alert">
          <h1 className="text-[22px] font-extrabold text-ink">{title}</h1>
          <p className="mt-2 text-[15px] text-ink-soft">{text}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-brown px-5 py-2.5 font-bold text-white hover:opacity-90">
              Probar de nuevo
            </button>
            <a href="/" className="rounded-full border border-line-strong bg-paper px-5 py-2.5 font-bold text-ink hover:bg-cream-deep">
              Ir a Inicio
            </a>
          </div>
          {!chunk && (
            <details className="mt-4 text-left text-[12.5px] text-muted">
              <summary className="cursor-pointer">Detalle técnico (para quien te ayuda con el sistema)</summary>
              <p className="mt-1 break-words">{error.message}</p>
            </details>
          )}
        </div>
      )
    }
    return (
      <div role="alert" style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '80px auto', padding: 24, textAlign: 'center', color: '#3b2414' }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>{title}</h1>
        <p style={{ color: '#6b5546' }}>{text}</p>
        {!chunk && (
          <details style={{ color: '#948172', fontSize: 13, marginTop: 12 }}>
            <summary style={{ cursor: 'pointer' }}>Detalle técnico (para quien te ayuda con el sistema)</summary>
            <p>{error.message}</p>
          </details>
        )}
        <button onClick={() => location.reload()} style={{ marginTop: 18, padding: '10px 22px', borderRadius: 999, border: 0, background: '#a9520f', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
          Probar de nuevo
        </button>
      </div>
    )
  }
}
