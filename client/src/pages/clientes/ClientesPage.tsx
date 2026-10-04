// Clientes: quién te compra, cuánto, cuándo fue la última vez y quién te debe.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CircleCheck, Clock, Crown, Plus, Users } from 'lucide-react'
import { CLIENT_KIND_LABELS, CLIENT_KINDS, type ClientKind } from '@shared/constants'
import { addDays, today } from '@shared/dates'
import { dateShort, int, money, relativeDays } from '@/lib/format'
import { useNewParam } from '@/lib/hooks'
import { useApi } from '@/lib/queries'
import { Badge, Button, Checkbox, DataTable, EmptyState, ErrorState, ExportButton, HelpBox, Loading, PageHeader, Select, type Column } from '@/components/ui'
import { Kpi, nb, tileMoney } from '../caja/parts'
import type { ClientListRow } from '../caja/types'
import { ClientFormModal } from './ClientFormModal'

export const KIND_TONE: Record<ClientKind, 'sky' | 'orange' | 'mustard' | 'coral' | 'neutral'> = {
  consumidor: 'neutral',
  restaurante: 'orange',
  vinoteca: 'mustard',
  empresa: 'sky',
  distribuidor: 'coral',
  otro: 'neutral',
}
export const KIND_SHORT: Record<ClientKind, string> = {
  consumidor: 'Consumidor final',
  restaurante: 'Restó / bar',
  vinoteca: 'Vinoteca',
  empresa: 'Empresa',
  distribuidor: 'Distribuidor',
  otro: 'Otro',
}

/**
 * "Restó / bar · 11 5555-1234 · Palermo": cada parte no se corta (un teléfono queda entero) y el "·"
 * queda pegado a la parte anterior, así ningún renglón empieza con un punto.
 */
const joinDot = (xs: (string | null | undefined)[]) =>
  xs
    .filter((x): x is string => !!x)
    .map((x, i, arr) => (
      <span key={i}>
        <span className="whitespace-nowrap">
          {x}
          {i < arr.length - 1 && '\u00a0·'}
        </span>
        {i < arr.length - 1 && ' '}
      </span>
    ))

/** Saldo del cliente: "Al día", "Debe $X" o "Debe $X (vencido)". */
export function BalanceBadge({ balance, overdue }: { balance: number; overdue: number }) {
  if (balance <= 0.01)
    return (
      <Badge tone="good" icon={<CircleCheck size={12} strokeWidth={2.6} aria-hidden />}>
        Al día
      </Badge>
    )
  return (
    <Badge tone={overdue > 0.01 ? 'bad' : 'warn'} icon={overdue > 0.01 ? <AlertTriangle size={12} strokeWidth={2.6} aria-hidden /> : <Clock size={12} strokeWidth={2.6} aria-hidden />}>
      <span aria-label={`Debe ${money(balance, { decimals: 0 })}${overdue > 0.01 ? ', vencido' : ''}`}>
        Debe {nb(money(balance, { decimals: 0 }))}
        {/* En el celular alcanza con el ícono de alerta: así el nombre del cliente tiene lugar. */}
        {overdue > 0.01 && <span className="hidden sm:inline"> · vencido</span>}
      </span>
    </Badge>
  )
}

export default function ClientesPage() {
  const navigate = useNavigate()
  const [newOpen, openNew, closeNew] = useNewParam()
  const [kind, setKind] = useState<ClientKind | ''>('')
  const [onlyDebt, setOnlyDebt] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const q = useApi<ClientListRow[]>('/clients')
  const all = q.data ?? []
  const year = today().slice(0, 4)

  const stats = useMemo(() => {
    const active = all.filter((c) => c.active)
    const since = addDays(today(), -90)
    const debtors = all.filter((c) => c.balance > 0.01)
    const best = [...all].sort((a, b) => b.year_total - a.year_total)[0]
    return {
      active: active.length,
      recent: active.filter((c) => c.last_purchase && c.last_purchase >= since).length,
      debtors: debtors.length,
      overdueDebtors: debtors.filter((c) => c.overdue > 0.01).length,
      owed: debtors.reduce((s, c) => s + c.balance, 0),
      overdue: debtors.reduce((s, c) => s + c.overdue, 0),
      best: best && best.year_total > 0 ? best : null,
      inactive: all.length - active.length,
    }
  }, [all])

  const rows = useMemo(
    () => all.filter((c) => (showInactive || c.active) && (!kind || c.kind === kind) && (!onlyDebt || c.balance > 0.01)),
    [all, showInactive, kind, onlyDebt],
  )

  const columns: Column<ClientListRow>[] = [
    {
      key: 'name',
      header: 'Cliente',
      value: (c) => `${c.name} ${c.phone ?? ''} ${c.email ?? ''} ${c.city ?? ''}`,
      cell: (c) => (
        <div className="min-w-0">
          <p className="font-semibold text-ink">
            {c.name}
            {!c.active && (
              <Badge className="ml-2 align-middle" tone="neutral">
                Desactivado
              </Badge>
            )}
          </p>
          {/* Debajo del nombre, lo que no tiene columna propia en ese ancho de pantalla. */}
          <p className="text-[12.5px] text-muted">
            <span className="md:hidden">{joinDot([KIND_SHORT[c.kind], c.phone, c.city])}</span>
            <span className="hidden md:inline lg:hidden">{joinDot([c.phone, c.city])}</span>
            <span className="hidden lg:inline">{c.phone}</span>
          </p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Tipo',
      hideBelow: 'md',
      value: (c) => KIND_SHORT[c.kind],
      cell: (c) => <Badge tone={KIND_TONE[c.kind]}>{KIND_SHORT[c.kind]}</Badge>,
    },
    { key: 'city', header: 'Ciudad', hideBelow: 'lg', cell: (c) => <span className="text-ink-soft">{c.city || '—'}</span> },
    {
      key: 'total_bought',
      header: 'Total comprado',
      align: 'right',
      hideBelow: 'sm',
      cell: (c) =>
        c.purchases_count ? (
          <span>
            <b>{nb(money(c.total_bought, { decimals: 0 }))}</b>
            <span className="block text-[12px] text-muted">
              {int(c.purchases_count)} {c.purchases_count === 1 ? 'compra' : 'compras'}
            </span>
          </span>
        ) : (
          <span className="text-muted">Todavía no compró</span>
        ),
    },
    {
      key: 'last_purchase',
      header: 'Última compra',
      hideBelow: 'md',
      cell: (c) =>
        c.last_purchase ? (
          <span className="whitespace-nowrap">
            {nb(dateShort(c.last_purchase))}
            <span className="block text-[12px] text-muted">{relativeDays(c.last_purchase)}</span>
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'balance',
      header: 'Saldo',
      align: 'right',
      cell: (c) => (c.purchases_count || c.balance > 0.01 ? <BalanceBadge balance={c.balance} overdue={c.overdue} /> : <span className="text-muted">—</span>),
    },
  ]

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Quién te compra, cuánto, cuándo fue la última vez y quién te debe."
        actions={
          <>
            <ExportButton path="/clients/export" />
            <Button variant="primary" icon={Plus} onClick={openNew}>
              Nuevo cliente
            </Button>
          </>
        }
      />

      <HelpBox id="clientes">
        <p>
          Tu lista de clientes con <b>lo que te compró cada uno y lo que te debe</b>. Por ejemplo: si «Bistró La Esquina» te compró 3 cajas de Malbec a $ 72.000 cada una y te pagó
          dos, acá ves que compró $ 216.000 y te debe $ 72.000.
        </p>
        <ul>
          <li>
            <b>¿Para qué sirve?</b> Para saber quiénes son tus mejores clientes (y cuidarlos), a quién hace rato que no le vendés (y escribirle) y a quién tenés que cobrarle.
          </li>
          <li>
            Los clientes se crean solos al cargar una venta (escribiendo un nombre nuevo), o desde acá con «Nuevo cliente». Tocá uno para ver su ficha: qué vinos prefiere,
            cuánto gasta por compra y su WhatsApp.
          </li>
          <li>Las ventas de mostrador sin cliente no aparecen acá; sus deudas las ves en «Caja y bancos» → «Por cobrar y por pagar».</li>
        </ul>
      </HelpBox>

      {q.error ? (
        <ErrorState className="mt-5" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Loading />
      ) : all.length === 0 ? (
        <div className="vh-card mt-5">
          <EmptyState
            icon={Users}
            title="Todavía no tenés clientes"
            action={
              <Button icon={Plus} onClick={openNew}>
                Cargar el primer cliente
              </Button>
            }
          >
            Cargá a los que te compran seguido (restós, vinotecas, amigos del club). También se crean solos cuando escribís un nombre nuevo al cargar una venta.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Kpi
              label="Clientes"
              tone="sky"
              info={{ title: 'Clientes activos', text: 'Los que aparecen para elegir al cargar una venta. "Compraron hace poco" cuenta a los que te compraron en los últimos 90 días.' }}
              value={int(stats.active)}
              hint={`${int(stats.recent)} compraron en los últimos 90 días`}
            />
            <Kpi
              label="Con deuda"
              info={{ title: 'Clientes con deuda', text: 'Clientes que tienen al menos una venta sin cobrar (o cobrada en parte).' }}
              value={int(stats.debtors)}
              valueClassName={stats.overdueDebtors ? 'text-bad' : undefined}
              hint={stats.debtors === 0 ? 'Nadie te debe nada' : stats.overdueDebtors ? `${int(stats.overdueDebtors)} con pagos vencidos` : 'Ninguno vencido todavía'}
              onClick={stats.debtors ? () => setOnlyDebt(true) : undefined}
            />
            <Kpi
              label="Te deben"
              term="por_cobrar"
              tone="mustard"
              value={tileMoney(stats.owed)}
              title={money(stats.owed)}
              hint={stats.overdue > 0.01 ? <b className="text-bad">{nb(money(stats.overdue, { decimals: 0 }))} ya vencido</b> : stats.owed > 0 ? 'Nada vencido' : 'Estás al día'}
            />
            <Kpi
              label={`Mejor cliente ${year}`}
              info={{ title: `Mejor cliente del ${year}`, text: `El cliente que más te compró en ${year} (en pesos, con descuentos y envíos). Tocalo para ver su ficha.` }}
              value={stats.best ? <span className="text-[1.25rem]">{stats.best.name}</span> : '—'}
              title={stats.best?.name}
              hint={stats.best ? `${nb(money(stats.best.year_total, { decimals: 0 }))} en el año` : 'Todavía no hay ventas con cliente este año'}
              onClick={stats.best ? () => navigate(`/clientes/${stats.best!.id}`) : undefined}
            />
          </div>

          <div className="mt-5">
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(c) => c.id}
              onRowClick={(c) => navigate(`/clientes/${c.id}`)}
              searchPlaceholder="Buscar por nombre, teléfono o ciudad…"
              rowClassName={(c) => (!c.active ? 'opacity-60' : undefined)}
              toolbar={
                <>
                  <Select
                    aria-label="Tipo de cliente"
                    className="w-full sm:w-[220px]"
                    value={kind}
                    onChange={(v) => setKind(v as ClientKind | '')}
                    placeholder="Todos los tipos"
                    options={CLIENT_KINDS.map((k) => ({ value: k, label: CLIENT_KIND_LABELS[k] }))}
                  />
                  <Checkbox checked={onlyDebt} onChange={setOnlyDebt} label="Solo los que deben" className="px-1" />
                  {stats.inactive > 0 && <Checkbox checked={showInactive} onChange={setShowInactive} label={`Ver desactivados (${stats.inactive})`} className="px-1" />}
                </>
              }
              empty={
                <div className="vh-card">
                  <EmptyState
                    compact
                    icon={Crown}
                    title="Ningún cliente con esos filtros"
                    action={
                      <Button
                        onClick={() => {
                          setKind('')
                          setOnlyDebt(false)
                        }}
                      >
                        Ver todos
                      </Button>
                    }
                  >
                    {onlyDebt ? '¡Buenas noticias: nadie de este grupo te debe nada!' : 'Probá con otro tipo de cliente.'}
                  </EmptyState>
                </div>
              }
            />
          </div>
        </>
      )}

      <ClientFormModal open={newOpen} client={null} onClose={closeNew} onSaved={(c) => navigate(`/clientes/${c.id}`)} />
    </>
  )
}
