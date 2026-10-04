// Caja y bancos: cuánta plata hay hoy, dónde está (efectivo, banco, billeteras), qué entró y salió,
// quién te debe y a quién le debés, y cómo viene la caja mes a mes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, ClipboardCheck, List, Pencil, Plus, Power, RotateCcw, Trash2, TrendingUp, Wallet } from 'lucide-react'
import clsx from 'clsx'
import { ACCOUNT_KIND_LABELS, CHART_COLORS } from '@shared/constants'
import { api } from '@/lib/api'
import { date as fmtDate, money, pct, usd } from '@/lib/format'
import { useLocalState, useNewParam } from '@/lib/hooks'
import { usePeriod } from '@/lib/period'
import { useApi, useApiMutation, useSettings } from '@/lib/queries'
import { Button, EmptyState, ErrorState, ExportButton, HelpBox, InfoTip, Loading, PageHeader, Tabs, useConfirm, type TabItem } from '@/components/ui'
import { AccountFormModal } from './AccountFormModal'
import { CashflowTab, flowPeriod, type FlowRange } from './CashflowTab'
import { MovementFormModal } from './MovementFormModal'
import { MovementsTab, type MovementFilters } from './MovementsTab'
import { PendingTab } from './PendingTab'
import { ReconcileModal } from './ReconcileModal'
import { TransferModal } from './TransferModal'
import { ACCOUNT_ICON, ActionMenu, nb } from './parts'
import type { AccountRow, MovementRow, PendingResult } from './types'

type TabKey = 'movimientos' | 'pendientes' | 'flujo'
const TAB_KEYS: TabKey[] = ['movimientos', 'pendientes', 'flujo']

/** true en pantallas de celular (menos de 640 px). */
function useNarrow(): boolean {
  const query = '(max-width: 639px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/**
 * Colores de las cuentas en "¿Dónde está?". Sin el coral: en los gráficos el coral significa
 * "gastos/salidas" y una cuenta con plata no tiene que leerse como algo malo.
 */
const ACCOUNT_COLORS = [CHART_COLORS.ventas, CHART_COLORS.costo, CHART_COLORS.ganancia, CHART_COLORS.extra, CHART_COLORS.envios]

/**
 * Barra apilada "¿Dónde está la plata?" con la parte de cada cuenta (de la que más tiene a la que menos).
 * Como máximo 5 tramos: si hay más cuentas con plata, las más chicas se juntan en "Otras cuentas".
 */
function WhereBar({ accounts }: { accounts: AccountRow[] }) {
  const positive = accounts.filter((a) => a.balance > 0.004).sort((a, b) => b.balance - a.balance)
  const sum = positive.reduce((s, a) => s + a.balance, 0)
  if (!positive.length) return null
  const MAX = ACCOUNT_COLORS.length
  const parts =
    positive.length > MAX
      ? [
          ...positive.slice(0, MAX - 1).map((a) => ({ key: String(a.id), name: a.name, value: a.balance })),
          { key: 'otras', name: `Otras cuentas (${positive.length - MAX + 1})`, value: positive.slice(MAX - 1).reduce((s, a) => s + a.balance, 0) },
        ]
      : positive.map((a) => ({ key: String(a.id), name: a.name, value: a.balance }))
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[13px] font-bold text-ink-soft">¿Dónde está?</p>
      <div className="flex h-3.5 overflow-hidden rounded-full bg-cream-deep" role="img" aria-label="Parte de la plata en cada cuenta">
        {parts.map((p, i) => (
          <div key={p.key} style={{ width: `${(p.value / sum) * 100}%`, background: ACCOUNT_COLORS[i] }} className="h-full border-r-2 border-paper last:border-r-0" />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {parts.map((p, i) => (
          <li key={p.key} className="flex max-w-full min-w-0 items-baseline gap-1.5 text-ink-soft">
            <span className="h-2.5 w-2.5 shrink-0 translate-y-px rounded-full" style={{ background: ACCOUNT_COLORS[i] }} aria-hidden />
            <span className="min-w-0">
              {p.name} <b className="vh-num whitespace-nowrap text-ink">{nb(pct(p.value / sum, 0))}</b>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AccountCard({
  a,
  onMovements,
  onEdit,
  onReconcile,
  onToggle,
  onDelete,
}: {
  a: AccountRow
  onMovements: () => void
  onEdit: () => void
  onReconcile: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const Icon = ACCOUNT_ICON[a.kind] ?? ACCOUNT_ICON.otro
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onMovements}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onMovements()}
      className="vh-card flex min-w-0 cursor-pointer flex-col gap-2 p-4 transition-colors hover:border-line-strong sm:p-5"
      title={`Ver los movimientos de ${a.name}`}
      aria-label={`${a.name}: saldo ${money(a.balance, { decimals: 0 })}. Ver sus movimientos`}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-soft text-orange-deep" aria-hidden>
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold text-ink">{a.name}</p>
          <p className="truncate text-[12.5px] text-muted">{ACCOUNT_KIND_LABELS[a.kind]}</p>
        </div>
        <ActionMenu
          label={`Acciones de ${a.name}`}
          items={[
            { label: 'Ver movimientos', icon: List, onClick: onMovements },
            { label: 'Hacer arqueo', icon: ClipboardCheck, onClick: onReconcile },
            { label: 'Editar', icon: Pencil, onClick: onEdit },
            { label: 'Desactivar', icon: Power, onClick: onToggle, hidden: a.movements_count === 0 },
            { label: 'Borrar', icon: Trash2, onClick: onDelete, danger: true, hidden: a.movements_count > 0 },
          ]}
        />
      </div>
      <p className={clsx('vh-num truncate text-[1.65rem] leading-tight font-extrabold', a.balance < -0.004 ? 'text-bad' : 'text-ink')} title={money(a.balance)}>
        {nb(money(a.balance, { decimals: 0 }))}
      </p>
      <div className="border-t border-line pt-2 text-[12.5px] text-ink-soft">
        <p className="vh-label mb-0.5">Este mes, hasta hoy</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="inline-flex items-center gap-1">
            <ArrowDownLeft size={13} className="text-good" aria-hidden /> Entró <b className="vh-num text-ink">{nb(money(a.month_in, { decimals: 0 }))}</b>
          </span>
          <span className="inline-flex items-center gap-1">
            <ArrowUpRight size={13} className="text-bad" aria-hidden /> Salió <b className="vh-num text-ink">{nb(money(a.month_out, { decimals: 0 }))}</b>
          </span>
        </div>
        {(a.month_scheduled_out > 0.5 || a.month_scheduled_in > 0.5) && (
          <p className="mt-1 text-[12px] leading-snug text-muted" title="Movimientos ya cargados con una fecha que todavía no llegó: el saldo de hoy no los cuenta.">
            Programado para lo que queda del mes:{' '}
            {[
              a.month_scheduled_out > 0.5 ? `sale ${nb(money(a.month_scheduled_out, { decimals: 0 }))}` : null,
              a.month_scheduled_in > 0.5 ? `entra ${nb(money(a.month_scheduled_in, { decimals: 0 }))}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            .
          </p>
        )}
      </div>
    </div>
  )
}

export default function CajaPage() {
  const [params, setParams] = useSearchParams()
  const confirm = useConfirm()
  const { period } = usePeriod()
  const accountsQ = useApi<AccountRow[]>('/accounts')
  const pendingQ = useApi<PendingResult>('/pending')
  const { data: settings } = useSettings()

  const [savedTab, setSavedTab] = useLocalState<TabKey>('caja.tab', 'movimientos')
  const urlTab = params.get('tab') as TabKey | null
  const tab: TabKey = urlTab && TAB_KEYS.includes(urlTab) ? urlTab : savedTab
  const setTab = (t: TabKey) => {
    setSavedTab(t)
    if (params.get('tab')) {
      const next = new URLSearchParams(params)
      next.delete('tab')
      setParams(next, { replace: true })
    }
  }

  const [filters, setFilters] = useState<MovementFilters>({ accountId: null, direction: '', type: '' })
  const [flowRange, setFlowRange] = useLocalState<FlowRange>('caja.flujo', '12')
  const [newOpen, openNew, closeNew] = useNewParam()
  const [editMovement, setEditMovement] = useState<MovementRow | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [accountModal, setAccountModal] = useState<{ account: AccountRow | null } | null>(null)
  const [reconcile, setReconcile] = useState<AccountRow | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  // ?tab=pendientes (ej: «Me pagaron una deuda» desde Inicio) → bajamos directo a esa pestaña, que queda debajo de las cuentas.
  const arrivedWithTab = useRef(!!urlTab)
  useEffect(() => {
    if (!arrivedWithTab.current || !accountsQ.data) return
    arrivedWithTab.current = false
    window.setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }, [accountsQ.data])

  // ?cuenta=ID → muestra los movimientos de esa cuenta (links desde otras pantallas).
  useEffect(() => {
    const acc = Number(params.get('cuenta'))
    if (acc > 0) {
      setFilters((f) => ({ ...f, accountId: acc }))
      setSavedTab('movimientos')
      window.setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
      const next = new URLSearchParams(params)
      next.delete('cuenta')
      next.delete('tab')
      setParams(next, { replace: true })
    }
  }, [params, setParams, setSavedTab])

  const toggle = useApiMutation((a: AccountRow) => api.put(`/accounts/${a.id}`, { active: !a.active }), {
    success: (_r, a) => (a.active ? `«${a.name}» desactivada. Su historia se conserva.` : `«${a.name}» reactivada.`),
  })
  const remove = useApiMutation((a: AccountRow) => api.del(`/accounts/${a.id}`), { success: (_r, a) => `Cuenta «${a.name}» borrada` })

  const accounts = accountsQ.data ?? []
  const active = useMemo(() => accounts.filter((a) => a.active), [accounts])
  const inactive = useMemo(() => accounts.filter((a) => !a.active), [accounts])
  // Plata que quedó en cuentas desactivadas: sigue siendo tuya, por eso suma en el total (igual que en Inicio).
  const inactiveMoney = inactive.reduce((s, a) => s + a.balance, 0)
  const total = accounts.reduce((s, a) => s + a.balance, 0)
  const usdRate = settings?.usd_rate ?? 0
  const pending = pendingQ.data?.totals
  const scheduledOut = pendingQ.data?.projection.out_breakdown.scheduled ?? 0
  // Recién empezás: ninguna cuenta tiene saldo inicial ni movimientos → te contamos cómo cargar lo que ya tenés.
  const fresh = accounts.length > 0 && accounts.every((a) => a.movements_count === 0 && Math.abs(a.initial_balance) < 0.005)

  // Si estás mirando una cuenta, los formularios la proponen (solo si está activa: en una desactivada no se carga nada).
  const filteredActiveId = active.some((a) => a.id === filters.accountId) ? filters.accountId : null

  const showMovements = (a: AccountRow) => {
    setFilters({ accountId: a.id, direction: '', type: '' })
    setTab('movimientos')
    window.setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const askDeactivate = async (a: AccountRow) => {
    const ok = await confirm({
      title: `¿Desactivar «${a.name}»?`,
      message: (
        <>
          Deja de aparecer para elegir al cobrar y pagar. Sus movimientos se conservan y la podés reactivar cuando quieras.
          {Math.abs(a.balance) > 0.004 && (
            <>
              {' '}
              <b className="text-ink">Ojo: todavía tiene {money(a.balance)}.</b> Si esa plata está en otro lado, pasala antes con «Transferir entre cuentas».
            </>
          )}
        </>
      ),
      confirmText: 'Sí, desactivar',
    })
    if (ok) toggle.mutate(a)
  }
  const askDelete = async (a: AccountRow) => {
    if (await confirm({ title: `¿Borrar «${a.name}»?`, message: 'No tiene movimientos, así que se puede borrar sin perder nada. No se puede deshacer.', confirmText: 'Sí, borrar', danger: true })) remove.mutate(a)
  }

  const flow = flowPeriod(flowRange)
  const exportProps =
    tab === 'movimientos'
      ? {
          path: '/movements/export',
          // Los mismos filtros que la tabla, así el Excel trae lo mismo que estás viendo.
          params: { from: period.from, to: period.to, account_id: filters.accountId, direction: filters.direction || null, ref_type: filters.type || null },
        }
      : tab === 'pendientes'
        ? { path: '/pending/export', params: undefined }
        : { path: '/cashflow/export', params: { from: flow.from, to: flow.to } }

  // En el celular, sin íconos: así las tres pestañas entran en dos renglones (con íconos quedaba una por renglón).
  const narrow = useNarrow()
  const tabs: TabItem<TabKey>[] = [
    { key: 'movimientos', label: 'Movimientos', icon: narrow ? undefined : List },
    { key: 'pendientes', label: 'Por cobrar y por pagar', icon: narrow ? undefined : Wallet, count: pending ? pending.receivables_count + pending.payables_count : undefined },
    { key: 'flujo', label: 'Flujo de caja', icon: narrow ? undefined : TrendingUp },
  ]

  return (
    <>
      <PageHeader
        title="Caja y bancos"
        description="Cuánta plata hay, dónde está y qué entra y sale de cada cuenta."
        actions={
          <>
            <ExportButton path={exportProps.path} params={exportProps.params} />
            <Button icon={ArrowRightLeft} onClick={() => setTransferOpen(true)} disabled={active.length < 2} title={active.length < 2 ? 'Necesitás al menos dos cuentas activas' : undefined}>
              Transferir entre cuentas
            </Button>
            <Button variant="primary" icon={Plus} onClick={openNew}>
              Nuevo movimiento
            </Button>
          </>
        }
      />

      <HelpBox id="caja">
        <p>
          Acá ves <b>dónde está la plata del negocio</b>: cuánto hay en la caja del local, en el banco y en Mercado Pago. Cada venta cobrada suma en la cuenta donde entró la plata, y cada compra o
          gasto pagado resta. Por ejemplo: si vendés 6 Malbec a $ 12.000 en efectivo, la «Caja» sube $ 72.000; si le pagás $ 300.000 a la bodega por transferencia, el «Banco» baja eso.
        </p>
        <p>
          <b>Ojo: ganar plata no es lo mismo que tener plata.</b> Si vendés a cuenta o comprás mucho vino, el resultado y la caja se separan (mirá la pestaña «Flujo de caja»).
        </p>
        <ul>
          <li>
            <b>Aportes y retiros:</b> la plata que ponen o se llevan los dueños. Cargalos con «Nuevo movimiento»: no son ventas ni gastos, así no te desarman la ganancia.
          </li>
          <li>
            <b>Transferir entre cuentas:</b> cuando depositás el efectivo en el banco o pasás de Mercado Pago al banco. La plata sigue siendo tuya, solo cambia de lugar.
          </li>
          <li>
            <b>Arqueo:</b> contá la plata real (menú ⋮ de cada cuenta) y el sistema la compara con lo que tiene. Si no coincide, ajusta la diferencia. Hacelo seguido: evita sorpresas.
          </li>
        </ul>
      </HelpBox>

      {accountsQ.error ? (
        <ErrorState className="mt-5" error={accountsQ.error} onRetry={() => accountsQ.refetch()} />
      ) : !accountsQ.data ? (
        <Loading />
      ) : (
        <>
          {/* Plata disponible hoy */}
          <section className="vh-card mt-5 grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-center">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[14px] font-bold text-ink-soft">
                <span className="h-2.5 w-2.5 rounded-full bg-orange" aria-hidden />
                Plata disponible hoy <InfoTip term="caja" />
              </p>
              <p
                className={clsx(
                  'vh-num mt-1.5 leading-none font-extrabold tracking-tight sm:text-[3rem]',
                  // Montos de 11+ cifras no entran a 2.6rem en un celular de 390 px.
                  money(total, { decimals: 0 }).length > 14 ? 'text-[2.1rem]' : 'text-[2.6rem]',
                  total < 0 ? 'text-bad' : 'text-ink',
                )}
                title={money(total)}
              >
                {nb(money(total, { decimals: 0 }))}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-ink-soft">
                {usdRate > 0 ? (
                  <>
                    ≈ <b className="vh-num text-ink">{usd(total / usdRate)}</b> a {nb(money(usdRate))} por dólar
                    {settings?.usd_rate_date ? ` (${fmtDate(settings.usd_rate_date)})` : ''} <InfoTip term="dolar" />
                  </>
                ) : (
                  <>
                    Suma de {active.length} {active.length === 1 ? 'cuenta' : 'cuentas'}.{' '}
                    <Link to="/configuracion" className="font-bold text-sky-deep hover:underline">
                      Cargá la cotización del dólar
                    </Link>{' '}
                    para verlo en USD.
                  </>
                )}
              </p>
              {fresh && active[0] && (
                <p className="mt-3 rounded-xl bg-sky-soft/70 px-3 py-2 text-[13.5px] text-ink">
                  <b>¿Ya tenés plata en la caja o en el banco?</b> Cargá cuánto hay hoy en cada cuenta (menú ⋮ → «Editar») y los saldos arrancan bien.{' '}
                  <button type="button" className="font-bold text-sky-deep hover:underline" onClick={() => setAccountModal({ account: active[0] })}>
                    Empezar por «{active[0].name}»
                  </button>
                </p>
              )}
              {Math.abs(inactiveMoney) > 0.004 && (
                <p className="mt-1 text-[13px] text-muted">
                  Incluye {nb(money(inactiveMoney, { decimals: 0 }))} que quedaron en {inactive.filter((a) => Math.abs(a.balance) > 0.004).map((a) => `«${a.name}»`).join(', ')} (desactivada). Si esa plata
                  ya no está ahí, reactivala y pasala a otra cuenta o hacele un arqueo.
                </p>
              )}
              {scheduledOut > 0.5 && (
                <p className="mt-1 text-[13px] text-muted">
                  Todavía no descuenta {nb(money(scheduledOut, { decimals: 0 }))} de pagos programados para los próximos 30 días (ya cargados como pagados, con fecha más adelante): salen de la
                  cuenta el día de su fecha. Están en «Por cobrar y por pagar».
                </p>
              )}
              {pending && (pending.receivables > 0 || pending.payables > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setTab('pendientes')
                    window.setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
                  }}
                  className="mt-3 inline-flex flex-wrap items-center gap-x-1.5 rounded-xl bg-cream-deep px-3 py-1.5 text-left text-[13.5px] text-ink hover:bg-mustard-soft"
                >
                  Te deben <b className="vh-num">{nb(money(pending.receivables, { decimals: 0 }))}</b> · Debés <b className="vh-num">{nb(money(pending.payables, { decimals: 0 }))}</b>
                  <span className="font-bold text-sky-deep">Ver →</span>
                </button>
              )}
            </div>
            <WhereBar accounts={Math.abs(inactiveMoney) > 0.004 ? accounts : active} />
          </section>

          {/* Cuentas */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            {active.map((a) => (
              <AccountCard
                key={a.id}
                a={a}
                onMovements={() => showMovements(a)}
                onEdit={() => setAccountModal({ account: a })}
                onReconcile={() => setReconcile(a)}
                onToggle={() => askDeactivate(a)}
                onDelete={() => askDelete(a)}
              />
            ))}
            <button
              type="button"
              onClick={() => setAccountModal({ account: null })}
              className="flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-card)] border-2 border-dashed border-line-strong px-4 py-4 text-center sm:min-h-[148px] text-ink-soft transition-colors hover:border-brown/50 hover:bg-paper hover:text-ink"
            >
              <Plus size={22} aria-hidden />
              <span className="font-extrabold">Nueva cuenta</span>
              <span className="text-[12.5px]">Otro banco, otra billetera…</span>
            </button>
          </div>
          {inactive.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13.5px] text-ink-soft">
              <span className="font-bold">Desactivadas:</span>
              {inactive.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-cream-deep py-0.5 pr-1 pl-3">
                  {a.name} · <span className="vh-num">{nb(money(a.balance, { decimals: 0 }))}</span>
                  <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => toggle.mutate(a)} className="h-7">
                    Reactivar
                  </Button>
                </span>
              ))}
            </div>
          )}
          {accounts.length === 0 && (
            <EmptyState icon={Wallet} title="Todavía no tenés cuentas" action={<Button icon={Plus} onClick={() => setAccountModal({ account: null })}>Crear la primera cuenta</Button>}>
              Creá una cuenta por cada lugar donde tenés plata: la caja del local, el banco, Mercado Pago.
            </EmptyState>
          )}
        </>
      )}

      <div ref={tabsRef} className="mt-7 scroll-mt-20">
        {/* flex-wrap: en el celular las tres pestañas no entran en un renglón y «Flujo de caja» quedaba escondida. */}
        <Tabs items={tabs} value={tab} onChange={setTab} className="mb-4" />
        {tab === 'movimientos' && (
          <MovementsTab accounts={accounts} filters={filters} setFilters={setFilters} onNew={openNew} onEdit={(m) => setEditMovement(m)} />
        )}
        {tab === 'pendientes' && <PendingTab />}
        {tab === 'flujo' && <CashflowTab range={flowRange} setRange={setFlowRange} onNew={openNew} />}
      </div>

      <MovementFormModal open={newOpen || !!editMovement} movement={editMovement} defaultAccountId={filteredActiveId} onClose={() => (editMovement ? setEditMovement(null) : closeNew())} />
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} defaultFromId={filteredActiveId} />
      <AccountFormModal open={!!accountModal} account={accountModal?.account ?? null} onClose={() => setAccountModal(null)} />
      <ReconcileModal account={reconcile} onClose={() => setReconcile(null)} />
    </>
  )
}
