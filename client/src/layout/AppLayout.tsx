import { Suspense, useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Plus, Receipt, ShoppingBasket, Store, X, FlaskConical } from 'lucide-react'
import clsx from 'clsx'
import { NAV, TONE_VAR } from '@/lib/nav'
import { useSettings } from '@/lib/queries'
import { Loading } from '@/components/ui'

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Menú principal" className="flex h-full flex-col">
      <Link to="/" onClick={onNavigate} className="mx-5 mt-4 mb-1 block rounded-2xl" aria-label="VINOH! — Inicio">
        <img src="/logo-vinoh.jpg" alt="VINOH! Viví el vino" className="mx-auto w-full max-w-[176px]" />
        <span className="vh-label mt-0.5 block text-center !text-brown">Finanzas</span>
      </Link>
      <div className="vh-scroll flex-1 space-y-4 overflow-y-auto px-3 pt-3 pb-4">
        {NAV.map((g) => (
          <div key={g.id}>
            <p className="vh-label mb-1.5 flex items-center gap-2 px-3">
              <span className="h-2 w-2 rounded-full" style={{ background: TONE_VAR[g.tone] }} aria-hidden />
              {g.label}
            </p>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.to === '/'}
                    onClick={onNavigate}
                    title={it.hint}
                    className={({ isActive }) =>
                      clsx(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-[7px] text-[15px] transition-colors',
                        isActive ? 'font-extrabold text-ink' : 'font-semibold text-ink-soft hover:bg-cream-deep hover:text-ink',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span
                            className="absolute inset-0 -z-0 rounded-xl opacity-45 mix-blend-multiply"
                            style={{ background: TONE_VAR[g.tone], borderRadius: '0.9rem 1.1rem 0.8rem 1.2rem' }}
                            aria-hidden
                          />
                        )}
                        <it.icon size={19} strokeWidth={isActive ? 2.5 : 2} className="relative shrink-0" aria-hidden />
                        <span className="relative">{it.label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="px-3 pt-2 text-[11.5px] leading-snug text-muted">🔒 Tus datos quedan guardados en esta computadora.</p>
      </div>
    </nav>
  )
}

function QuickActions() {
  const navigate = useNavigate()
  const actions = [
    { label: 'Venta', to: '/ventas?nuevo=1', icon: Store, tone: 'sky' as const, title: 'Cargar una venta' },
    { label: 'Gasto', to: '/gastos?nuevo=1', icon: Receipt, tone: 'coral' as const, title: 'Cargar un gasto' },
    { label: 'Compra', to: '/compras?nuevo=1', icon: ShoppingBasket, tone: 'coral' as const, title: 'Cargar una compra de vino' },
  ]
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 hidden text-[13px] font-bold text-ink-soft lg:inline">Cargar:</span>
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          title={a.title}
          onClick={() => navigate(a.to)}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-paper px-2.5 text-[14px] font-bold text-ink transition-colors hover:border-ink/30 sm:px-3"
        >
          <span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: TONE_VAR[a.tone] }} aria-hidden>
            <Plus size={13} strokeWidth={3} />
          </span>
          {a.label}
        </button>
      ))}
    </div>
  )
}

function DemoBanner() {
  const { data } = useSettings()
  if (!data?.onboarding.demo_loaded) return null
  return (
    <div className="vh-no-print flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-sky/40 bg-sky-soft px-4 py-2 text-[14px] text-ink sm:px-8">
      <FlaskConical size={16} className="text-sky-deep" aria-hidden />
      <span>
        <b>Estás viendo datos de ejemplo</b> para que pruebes el sistema sin miedo.
      </span>
      <Link to="/configuracion#datos" className="font-bold text-sky-deep underline-offset-2 hover:underline">
        Borrarlos y empezar con mis datos →
      </Link>
    </div>
  )
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()
  const { data: settings } = useSettings()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  if (settings && !settings.onboarding.completed) return <Navigate to="/bienvenida" replace />

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="vh-no-print sticky top-0 hidden h-screen border-r border-line bg-cream lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-ink/35" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="vh-anim-pop absolute inset-y-0 left-0 w-[280px] border-r border-line bg-cream shadow-[var(--shadow-pop)]">
            <button onClick={() => setMobileOpen(false)} className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full hover:bg-cream-deep" aria-label="Cerrar menú">
              <X size={20} />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <div className="vh-no-print sticky top-0 z-40 flex items-center gap-3 border-b border-line bg-cream/90 px-4 py-2.5 backdrop-blur sm:px-8">
          <button onClick={() => setMobileOpen(true)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-cream-deep lg:hidden" aria-label="Abrir menú">
            <Menu size={22} />
          </button>
          <Link to="/" className="hidden shrink-0 sm:block lg:hidden" aria-label="Inicio">
            <img src="/logo-vinoh.jpg" alt="VINOH!" className="h-10 w-auto" />
          </Link>
          <div className="ml-auto">
            <QuickActions />
          </div>
        </div>
        <DemoBanner />
        <main className="mx-auto w-full max-w-[1320px] px-4 pt-7 pb-16 sm:px-8">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
