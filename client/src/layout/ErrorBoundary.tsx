import { Component, type ReactNode } from 'react'

/** Si una pantalla se rompe, mostramos un mensaje amable en vez de una pantalla en blanco. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('[VINOH]', error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '80px auto', padding: 24, textAlign: 'center', color: '#3b2414' }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Uy, algo se rompió en esta pantalla 🍷</h1>
        <p style={{ color: '#6b5546' }}>Tus datos están a salvo. Probá recargar la página; si sigue pasando, cerrá y volvé a abrir el programa.</p>
        <p style={{ color: '#948172', fontSize: 13, marginTop: 12 }}>Detalle técnico: {this.state.error.message}</p>
        <button onClick={() => location.reload()} style={{ marginTop: 18, padding: '10px 22px', borderRadius: 999, border: 0, background: '#a9520f', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
          Recargar
        </button>
      </div>
    )
  }
}
