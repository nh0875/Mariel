// Bienvenida (primer uso): pantalla completa, fuera del menú. Dos caminos:
// - "Probar con datos de ejemplo": carga 14 meses de una vinoteca inventada y te lleva a Inicio.
// - "Empezar con mis datos": 3 pasos cortos (tu negocio → tu plata y comisiones → ¡listo!) y arrancás
//   cargando tus vinos.
// "Saltar por ahora" marca la bienvenida como vista (todo se puede completar después en Configuración).
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Banknote, CircleCheck, FileSpreadsheet, FlaskConical, Landmark, Lock, Rocket, Wallet, Wine } from 'lucide-react'
import clsx from 'clsx'
import type { AccountWithBalance, PaymentMethodSetting, Settings } from '@shared/types'
import type { PaymentMethod } from '@shared/constants'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { useApi, useApiMutation, useSettings } from '@/lib/queries'
import { Button, ChoiceCards, Field, InfoTip, MoneyInput, NumberInput, Spinner, TextInput, useConfirm, useToast } from '@/components/ui'
import { nb } from '../configuracion/parts'

type Step = 0 | 1 | 2 | 3
const STEP_LABELS = ['Bienvenida', 'Tu negocio', 'Tu plata', '¡Listo!']
const SETTINGS_KEY = ['/settings', {}]

interface SystemCounts {
  counts: { table: string; count: number }[]
}

/** Manchas de color translúcidas, como las letras superpuestas del logo. */
function Swashes() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <span className="absolute -top-36 -left-48 h-64 w-[26rem] -rotate-12 rounded-[42%_58%_55%_45%] bg-coral/35 mix-blend-multiply sm:-top-20 sm:-left-24" />
      <span className="absolute top-[30rem] -right-52 h-56 w-[22rem] rotate-[18deg] rounded-[55%_45%_40%_60%] bg-sky/35 mix-blend-multiply sm:top-24 sm:-right-28" />
      <span className="absolute -bottom-36 -left-40 h-60 w-[24rem] rotate-6 rounded-[50%_50%_60%_40%] bg-mustard/45 mix-blend-multiply sm:-bottom-24 sm:-left-16" />
      <span className="absolute -right-44 -bottom-32 h-52 w-[20rem] -rotate-[10deg] rounded-[45%_55%_50%_50%] bg-orange/30 mix-blend-multiply sm:-right-20 sm:-bottom-16" />
    </div>
  )
}

function Dots({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-3">
      <ol className="flex items-center gap-2" aria-label={`Paso ${step + 1} de ${STEP_LABELS.length}`}>
        {STEP_LABELS.map((l, i) => (
          <li key={l} className="flex items-center gap-2">
            <span
              className={clsx('block h-2.5 rounded-full transition-all', i === step ? 'w-7 bg-brown' : i < step ? 'w-2.5 bg-brown/60' : 'w-2.5 bg-line-strong')}
              aria-current={i === step ? 'step' : undefined}
            />
            <span className={clsx('hidden text-[12.5px] font-bold sm:inline', i === step ? 'text-ink' : 'text-muted')}>{l}</span>
          </li>
        ))}
      </ol>
      <span className="text-[12.5px] font-bold text-ink-soft sm:hidden" aria-hidden>
        Paso {step + 1} de {STEP_LABELS.length}: {STEP_LABELS[step]}
      </span>
    </div>
  )
}

function Panel({ title, subtitle, children, footer, onSubmit }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer: ReactNode; onSubmit: () => void }) {
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onSubmit()
      }}
      noValidate
      className="vh-card vh-anim-pop overflow-hidden"
    >
      <div className="px-5 pt-6 pb-5 sm:px-8 sm:pt-8">
        <h1 className="font-display text-[2.1rem] leading-none text-ink sm:text-[2.5rem]">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] leading-snug text-ink-soft [&_b]:text-ink">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-cream/60 px-5 py-4 sm:px-8">{footer}</div>
    </form>
  )
}

const ACCOUNT_HINT: Record<string, string> = {
  efectivo: 'Contá los billetes de la caja del local.',
  banco: 'Mirá el saldo de hoy en el home banking.',
  billetera: 'En la app, mirá el «dinero disponible».',
  otro: 'Lo que haya hoy en esta cuenta.',
}
const ACCOUNT_ICON = { efectivo: Banknote, banco: Landmark, billetera: Wallet, otro: Wallet } as const

export default function BienvenidaPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const { data: settings } = useSettings()
  const accountsQ = useApi<AccountWithBalance[]>('/accounts')
  const sys = useApi<SystemCounts>('/system')
  const [step, setStep] = useState<Step>(0)

  useEffect(() => {
    document.title = 'Bienvenida · VINOH! Finanzas'
  }, [])
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  // ── Paso 2: tu negocio
  const [biz, setBiz] = useState({ name: '', owner: '', fiscal_condition: 'monotributo' as Settings['business']['fiscal_condition'] })
  const [bizLoaded, setBizLoaded] = useState(false)
  useEffect(() => {
    if (settings && !bizLoaded) {
      setBiz({ name: settings.business.name, owner: settings.business.owner, fiscal_condition: settings.business.fiscal_condition })
      setBizLoaded(true)
    }
  }, [settings, bizLoaded])

  // ── Paso 3: saldos y comisiones. Se guarda solo lo que la persona cambia: el resto sale siempre de lo
  // guardado (así, si se borran los datos de ejemplo en el medio, no quedan saldos viejos de la demo).
  const [balanceEdits, setBalanceEdits] = useState<Record<number, number | null>>({})
  const [feeEdits, setFeeEdits] = useState<Partial<Record<PaymentMethod, number>>>({})
  const accounts = useMemo(() => (accountsQ.data ?? []).filter((a) => a.active), [accountsQ.data])
  const balanceOf = (a: AccountWithBalance) => (a.id in balanceEdits ? (balanceEdits[a.id] ?? 0) : a.initial_balance)
  const fees: PaymentMethodSetting[] = (settings?.payment_methods ?? []).map((m) => ({ ...m, fee_pct: feeEdits[m.key] ?? m.fee_pct }))

  const [tried, setTried] = useState(false)
  const bizError = !biz.name.trim() ? 'Poné el nombre de tu negocio (después lo podés cambiar).' : null
  const feeError = fees.find((m) => m.fee_pct < 0 || m.fee_pct > 50)
  const total = accounts.reduce((s, a) => s + balanceOf(a), 0)
  const hasData = (sys.data?.counts ?? []).some((c) => ['products', 'sales', 'purchases', 'expenses'].includes(c.table) && c.count > 0)

  const putSettings = async (patch: Partial<Settings> | Record<string, unknown>) => {
    const res = await api.put<Settings>('/settings', patch)
    qc.setQueryData(SETTINGS_KEY, res)
    return res
  }

  const demo = useApiMutation(
    async () => {
      const r = await api.post<{ sales: number }>('/demo/load')
      await putSettings({ onboarding: { completed: true, demo_loaded: true } })
      return r
    },
    { success: '¡Listo! Estás viendo una vinoteca de ejemplo. Tocá lo que quieras: no se rompe nada.', onSuccess: () => navigate('/') },
  )
  const resetDemo = useApiMutation(() => api.post('/data/reset'), {
    success: 'Listo, borramos los datos de ejemplo.',
    onSuccess: () => {
      setBalanceEdits({})
      setFeeEdits({})
      setStep(1)
    },
  })
  const saveBiz = useApiMutation(() => putSettings({ business: { name: biz.name.trim(), owner: biz.owner.trim(), fiscal_condition: biz.fiscal_condition } }), {
    onSuccess: () => setStep(2),
  })
  const saveMoney = useApiMutation(
    async () => {
      await Promise.all(
        accounts
          .filter((a) => a.id in balanceEdits && balanceOf(a) !== a.initial_balance)
          .map((a) => api.put(`/accounts/${a.id}`, { name: a.name, kind: a.kind, initial_balance: balanceOf(a), active: a.active })),
      )
      const changed = Object.keys(feeEdits) as PaymentMethod[]
      if (changed.length) {
        // Solo las comisiones que tocaste, sobre lo guardado ahora (la cuenta de cada medio no se toca).
        const fresh = await api.get<Settings>('/settings')
        await putSettings({
          payment_methods: fresh.payment_methods.map((m) => (feeEdits[m.key] != null ? { ...m, fee_pct: Math.round(feeEdits[m.key]! * 100) / 100 } : m)),
        })
      }
    },
    {
      onSuccess: () => {
        setBalanceEdits({})
        setFeeEdits({})
        setStep(3)
      },
    },
  )
  const finish = useApiMutation((to: string) => putSettings({ onboarding: { completed: true } }).then(() => to), {
    onSuccess: (to) => {
      if (to === '/vinos') toast.info('Tocá «Importar desde Excel» (arriba a la derecha) para subir tu planilla.')
      navigate(to)
    },
  })
  const skip = useApiMutation(() => putSettings({ onboarding: { completed: true } }), {
    success: 'Dale. Cuando quieras, completá tus datos en Configuración.',
    onSuccess: () => navigate('/'),
  })

  const chooseDemo = async () => {
    if (demo.isPending) return
    if (hasData && !settings?.onboarding.demo_loaded) {
      const ok = await confirm({
        title: '¿Reemplazar tus datos por los de ejemplo?',
        danger: true,
        confirmText: 'Sí, cargar el ejemplo',
        message: 'Ya tenés datos cargados. Si cargás el ejemplo, se reemplazan todos (antes guardamos una copia de seguridad para que puedas volver).',
      })
      if (!ok) return
    }
    demo.mutate()
  }
  const chooseOwn = async () => {
    if (settings?.onboarding.demo_loaded && hasData) {
      const ok = await confirm({
        title: 'Primero sacamos los datos de ejemplo',
        confirmText: 'Sí, borrarlos y seguir',
        message: 'Ahora estás viendo la vinoteca de ejemplo. Para empezar con lo tuyo, borramos esos datos (tu configuración se mantiene y antes guardamos una copia).',
      })
      if (!ok) return
      resetDemo.mutate()
      return
    }
    setStep(1)
  }

  if (demo.isPending) {
    return (
      <div className="relative grid min-h-screen place-items-center bg-cream px-4">
        <Swashes />
        <div className="vh-card vh-anim-pop relative max-w-md p-8 text-center">
          <Spinner size={34} className="mx-auto text-brown" />
          <p className="mt-4 font-display text-[2rem] leading-none text-ink">Armando una vinoteca de ejemplo…</p>
          <p className="mt-3 text-[15px] text-ink-soft">14 meses de ventas, compras, gastos y clientes inventados. Tarda unos segundos.</p>
        </div>
      </div>
    )
  }

  const owner = biz.owner.trim().split(' ')[0]

  return (
    <div className="relative min-h-screen overflow-hidden bg-cream">
      <Swashes />
      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-6 flex min-h-8 items-center justify-between gap-3">
          {step > 0 ? <Dots step={step} /> : <span />}
          {step < 3 && (
            <button type="button" onClick={() => skip.mutate()} disabled={skip.isPending} className="text-[14px] font-bold text-ink-soft underline-offset-2 hover:text-ink hover:underline">
              Saltar por ahora
            </button>
          )}
        </div>

        {step === 0 && (
          <main className="flex flex-1 flex-col items-center text-center">
            <img src="/logo-vinoh.jpg" alt="VINOH! Viví el vino" className="w-60 mix-blend-multiply sm:w-80" />
            <p className="vh-eyebrow mt-4 justify-center">Finanzas</p>
            <h1 className="mt-5 font-display text-[2.6rem] leading-none text-ink sm:text-[3.4rem]">
              ¡Te damos la{' '}
              <span className="vh-title" style={{ ['--swash' as string]: 'var(--color-coral)' }}>
                <span className="vh-swash" aria-hidden />
                bienvenida!
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-[16.5px] leading-relaxed text-ink-soft">
              Este sistema te dice <b className="text-ink">cuánto vendés, cuánto ganás de verdad y cuánta plata tenés</b>, y te explica cada número. ¿Cómo querés arrancar?
            </p>
            <div className="vh-anim-pop mt-8 grid w-full gap-3 sm:grid-cols-2">
              <BigChoice
                icon={FlaskConical}
                tone="sky"
                title="Quiero probar con datos de ejemplo"
                text="Cargamos 14 meses de una vinoteca inventada para que veas cómo funciona todo. Cuando quieras, la borrás desde Configuración y empezás con lo tuyo."
                onClick={chooseDemo}
              />
              <BigChoice
                icon={Rocket}
                tone="coral"
                title="Quiero empezar con mis datos"
                text="Dos pasos cortos (tu negocio y tu plata, un par de minutos) y arrancás cargando tus vinos."
                onClick={chooseOwn}
                loading={resetDemo.isPending}
              />
            </div>
            <p className="mt-8 max-w-md text-center text-[13.5px] text-muted">
              <Lock size={15} className="mr-1.5 inline -translate-y-px" aria-hidden />
              Todo queda guardado en esta computadora. Nada se sube a internet.
            </p>
          </main>
        )}

        {step === 1 && (
          <Panel
            title="Contanos de tu negocio"
            subtitle="Con esto armamos los Excel, los comprobantes y te saludamos por tu nombre."
            onSubmit={() => {
              setTried(true)
              if (!bizError) saveBiz.mutate()
            }}
            footer={
              <>
                <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(0)}>
                  Volver
                </Button>
                <Button type="submit" variant="primary" iconRight={ArrowRight} loading={saveBiz.isPending}>
                  Seguir
                </Button>
              </>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field htmlFor="bv-name" label="Nombre del negocio" required error={tried ? bizError : null} hint="Como querés que aparezca en los Excel.">
                <TextInput
                  id="bv-name"
                  value={biz.name}
                  onChange={(e) => setBiz({ ...biz, name: e.target.value })}
                  maxLength={120}
                  placeholder="Ej: VINOH!"
                  aria-invalid={tried && !!bizError}
                  data-autofocus
                  autoFocus
                />
              </Field>
              <Field htmlFor="bv-owner" label="¿Cómo te llamás?" hint={owner ? `Te vamos a saludar: «¡Hola, ${owner}!»` : 'Para saludarte cuando abrís el sistema.'}>
                <TextInput id="bv-owner" value={biz.owner} onChange={(e) => setBiz({ ...biz, owner: e.target.value })} maxLength={120} placeholder="Ej: Mariel" autoComplete="given-name" />
              </Field>
            </div>
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-1.5">
                <p className="text-[14px] font-bold text-ink">¿Cómo estás inscripta/o en ARCA (ex AFIP)?</p>
                <InfoTip term="iva" />
              </div>
              <ChoiceCards
                columns={3}
                value={biz.fiscal_condition}
                onChange={(v) => setBiz({ ...biz, fiscal_condition: v })}
                options={[
                  { value: 'monotributo', title: 'Monotributo', description: 'Tus precios son finales.' },
                  { value: 'responsable_inscripto', title: 'Responsable inscripto', description: 'Cobrás y pagás IVA.' },
                  { value: 'otro', title: 'Otro', description: 'Exento u otra situación.' },
                ]}
              />
              <p className="mt-3 text-[13.5px] text-muted">Sea cual sea, en el sistema cargás todo con impuestos incluidos, como sale en el ticket o la factura: es la plata que realmente se mueve.</p>
            </div>
          </Panel>
        )}

        {step === 2 && (
          <Panel
            title="¿Cuánta plata hay hoy en cada lugar?"
            subtitle={
              <>
                Es tu <b>punto de partida</b>: desde acá, cada venta, compra y gasto lo va moviendo. Si no sabés el número exacto, poné uno aproximado; después lo ajustás en Caja y bancos.
              </>
            }
            onSubmit={() => {
              if (!feeError) saveMoney.mutate()
            }}
            footer={
              <>
                <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(1)}>
                  Volver
                </Button>
                <Button type="submit" variant="primary" iconRight={ArrowRight} loading={saveMoney.isPending} disabled={!!feeError || accountsQ.isLoading}>
                  Seguir
                </Button>
              </>
            }
          >
            {accountsQ.error ? (
              <p className="rounded-xl bg-bad-soft px-3 py-2 text-[14px] text-ink">No pudimos leer tus cuentas. Podés seguir y cargar los saldos después en Caja y bancos.</p>
            ) : (
              <ul className="space-y-3">
                {accounts.map((a) => {
                  const Icon = ACCOUNT_ICON[a.kind] ?? Wallet
                  return (
                    <li key={a.id} className="grid items-center gap-2 rounded-2xl border border-line bg-paper p-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-soft text-sky-deep" aria-hidden>
                          <Icon size={20} />
                        </span>
                        <div className="min-w-0">
                          <p className="font-extrabold text-ink">{a.name}</p>
                          <p className="text-[13px] text-muted">{ACCOUNT_HINT[a.kind]}</p>
                        </div>
                      </div>
                      <MoneyInput value={balanceOf(a)} onChange={(v) => setBalanceEdits((b) => ({ ...b, [a.id]: v }))} aria-label={`Saldo de hoy en ${a.name}`} />
                    </li>
                  )
                })}
              </ul>
            )}
            {accounts.length > 0 && (
              <p className="mt-3 text-right text-[14.5px] text-ink-soft">
                En total arrancás con <b className="vh-num text-[17px] text-ink">{nb(money(total))}</b>
              </p>
            )}

            <div className="mt-6 border-t border-line pt-5">
              <div className="mb-1 flex items-center gap-1.5">
                <p className="font-extrabold text-ink">¿Cuánto te cobra cada medio de pago?</p>
                <InfoTip term="comisiones" />
              </div>
              <p className="mb-3 text-[13.5px] text-ink-soft">
                Con esto el sistema descuenta solo la comisión de cada venta. Dejamos valores típicos: <b className="text-ink">revisá lo que te cobra tu banco</b> o Mercado Pago.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {fees.map((m) => (
                  <li key={m.key} className="flex items-center gap-2 rounded-xl bg-cream/70 px-3 py-2">
                    <span className="min-w-0 flex-1 text-[14.5px] font-bold text-ink">{m.label}</span>
                    <NumberInput
                      value={m.fee_pct}
                      onChange={(v) => setFeeEdits((f) => ({ ...f, [m.key]: v ?? 0 }))}
                      suffix="%"
                      decimals={2}
                      className="w-28 shrink-0"
                      aria-label={`Comisión de ${m.label}`}
                      aria-invalid={m.fee_pct < 0 || m.fee_pct > 50}
                    />
                  </li>
                ))}
              </ul>
              {feeError && <p className="mt-2 text-[13px] font-semibold text-bad">La comisión de «{feeError.label}» tiene que estar entre 0 % y 50 %.</p>}
            </div>
          </Panel>
        )}

        {step === 3 && (
          <main className="vh-card vh-anim-pop overflow-hidden text-center">
            <div className="px-5 pt-8 pb-6 sm:px-10">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-good-soft text-good" aria-hidden>
                <CircleCheck size={34} strokeWidth={2.4} />
              </span>
              <h1 className="mt-4 font-display text-[2.4rem] leading-none text-ink sm:text-[2.9rem]">¡Listo{owner ? `, ${owner}` : ''}!</h1>
              <p className="mx-auto mt-3 max-w-lg text-[16px] leading-relaxed text-ink-soft">
                <b className="text-ink">Arrancamos cargando tus vinos.</b> Con el costo y el precio de cada uno, el sistema te dice cuánto ganás por botella y te avisa cuando hay que reponer.
              </p>
              <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
                <Button variant="primary" size="lg" icon={Wine} onClick={() => finish.mutate('/vinos?nuevo=1')} loading={finish.isPending && finish.variables === '/vinos?nuevo=1'}>
                  Cargar mi primer vino
                </Button>
                <Button size="lg" icon={FileSpreadsheet} onClick={() => finish.mutate('/vinos')} loading={finish.isPending && finish.variables === '/vinos'}>
                  Importar desde Excel
                </Button>
              </div>
              <p className="mt-3 text-[13.5px] text-muted">¿Tenés tu lista de vinos en una planilla? Importala y te ahorrás cargarlos uno por uno.</p>
            </div>
            <div className="border-t border-line bg-cream/60 px-5 py-4 text-left text-[14px] text-ink-soft sm:px-10">
              <p className="mb-1 font-bold text-ink">Ya quedó guardado:</p>
              <ul className="ml-4 list-disc space-y-0.5">
                <li>
                  Tu negocio: <b className="text-ink">{biz.name.trim() || settings?.business.name}</b>
                </li>
                <li>
                  Plata para arrancar: <b className="text-ink">{nb(money(total))}</b> entre {accounts.map((a) => a.name).join(', ')}
                </li>
                <li>Las comisiones de tus medios de pago</li>
              </ul>
              <p className="mt-2">
                Todo se puede cambiar cuando quieras en{' '}
                <Link to="/configuracion" onClick={(e) => (e.preventDefault(), finish.mutate('/configuracion'))} className="font-bold text-sky-deep hover:underline">
                  Configuración
                </Link>
                . O andá directo al{' '}
                <Link to="/" onClick={(e) => (e.preventDefault(), finish.mutate('/'))} className="font-bold text-sky-deep hover:underline">
                  Inicio
                </Link>
                .
              </p>
            </div>
          </main>
        )}
      </div>
    </div>
  )
}

function BigChoice({ icon: Icon, tone, title, text, onClick, loading }: { icon: typeof Rocket; tone: 'sky' | 'coral'; title: string; text: string; onClick: () => void; loading?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="group vh-card flex h-full flex-col items-start gap-3 p-5 text-left transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-brown/50 hover:shadow-[var(--shadow-pop)] focus-visible:border-brown sm:p-6"
    >
      <span className={clsx('relative grid h-12 w-12 place-items-center rounded-2xl', tone === 'sky' ? 'bg-sky-soft text-sky-deep' : 'bg-coral-soft text-coral-deep')} aria-hidden>
        {loading ? <Spinner size={22} /> : <Icon size={24} strokeWidth={2.2} />}
      </span>
      <span className="font-display text-[1.65rem] leading-[1.05] text-ink">{title}</span>
      <span className="flex-1 text-[14.5px] leading-snug text-ink-soft">{text}</span>
      <span className="inline-flex items-center gap-1 text-[14px] font-extrabold text-brown">
        Elegir <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  )
}
