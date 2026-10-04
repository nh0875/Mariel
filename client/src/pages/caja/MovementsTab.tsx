// Pestaña "Movimientos": cada peso que entró o salió de tus cuentas, con de dónde vino
// (venta, compra, gasto, aporte, retiro…) y, si mirás una cuenta sola, el saldo después de cada movimiento.
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUpRight, ArrowRightLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { MANUAL_CASH_KINDS } from '@shared/constants'
import { addDays } from '@shared/dates'
import { api } from '@/lib/api'
import { date as fmtDate, dateShort, money } from '@/lib/format'
import { usePeriod } from '@/lib/period'
import { useApi, useApiMutation } from '@/lib/queries'
import { Button, DataTable, EmptyState, ErrorState, InfoTip, Loading, PeriodPicker, Select, useConfirm, type Column } from '@/components/ui'
import { ACCOUNT_ICON, SignedMoney, docLink, nb } from './parts'
import type { AccountRow, MovementRow, MovementsResult } from './types'

export const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: 'sale', label: 'Cobros de ventas' },
  { value: 'purchase', label: 'Pagos de compras de vino' },
  { value: 'expense', label: 'Pagos de gastos' },
  { value: 'sale_fee', label: 'Comisiones de cobro' },
  { value: 'transfer', label: 'Transferencias entre cuentas' },
  { value: 'aporte,retiro', label: 'Aportes y retiros de los dueños' },
  { value: 'prestamo_recibido,prestamo_pagado', label: 'Préstamos' },
  { value: 'otro_ingreso,otro_egreso', label: 'Otros ingresos y egresos' },
  { value: 'ajuste', label: 'Ajustes y arqueos' },
]

export interface MovementFilters {
  accountId: number | null
  direction: '' | 'in' | 'out'
  type: string
}

const isManualKind = (t: string) => (MANUAL_CASH_KINDS as readonly string[]).includes(t)

function Stat({ label, value, info, tone }: { label: string; value: ReactNode; info?: { title: string; text: string }; tone?: 'in' | 'out' }) {
  return (
    <div className="min-w-0 rounded-xl bg-cream/80 px-3.5 py-2.5">
      <p className="flex items-center gap-1 text-[12.5px] font-bold text-ink-soft">
        {tone && <span className={clsx('h-2 w-2 rounded-full', tone === 'in' ? 'bg-good' : 'bg-bad')} aria-hidden />}
        {label}
        {info && <InfoTip title={info.title} text={info.text} size={14} />}
      </p>
      <p className="vh-num mt-0.5 truncate text-[1.15rem] font-extrabold text-ink">{value}</p>
    </div>
  )
}

export function MovementsTab({
  accounts,
  filters,
  setFilters,
  onNew,
  onEdit,
}: {
  accounts: AccountRow[]
  filters: MovementFilters
  setFilters: (f: MovementFilters) => void
  onNew: () => void
  onEdit: (m: MovementRow) => void
}) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { period, label: periodLabel } = usePeriod()
  const q = useApi<MovementsResult>('/movements', {
    from: period.from,
    to: period.to,
    account_id: filters.accountId,
    direction: filters.direction || null,
    ref_type: filters.type || null,
  })
  const remove = useApiMutation((id: number) => api.del(`/payments/${id}`), { success: 'Movimiento borrado. Los saldos ya están corregidos.' })

  const account = accounts.find((a) => a.id === filters.accountId)
  const filtered = !!(filters.direction || filters.type)
  const rows = q.data?.rows ?? []
  const s = q.data?.summary

  const askDelete = async (m: MovementRow) => {
    const isTransfer = m.ref_type === 'transfer'
    const ok = await confirm({
      title: isTransfer ? '¿Borrar la transferencia?' : '¿Borrar este movimiento?',
      message: isTransfer ? (
        <>
          Se borran las dos partes: la salida de una cuenta y la entrada en la otra ({m.document.toLowerCase()}, {money(m.amount)}). Los saldos vuelven a como estaban.
        </>
      ) : (
        <>
          «{m.label}» por <b className="text-ink">{money(m.amount)}</b> en {m.account_name}, del {fmtDate(m.date)}. El saldo de la cuenta se corrige solo. No se puede deshacer.
        </>
      ),
      confirmText: 'Sí, borrar',
      danger: true,
    })
    if (ok) remove.mutate(m.id)
  }

  const columns: Column<MovementRow>[] = [
    {
      key: 'date',
      header: 'Fecha',
      cell: (m) => <span className="whitespace-nowrap">{nb(dateShort(m.date))}</span>,
      className: 'w-[1%]',
      hideBelow: 'sm',
    },
    {
      key: 'document',
      header: 'Movimiento',
      value: (m) => `${m.document} ${m.counterpart ?? ''} ${m.label} ${m.description ?? ''} ${m.account_name}`,
      sortable: false,
      cell: (m) => {
        const link = m.ref_exists ? docLink(m.ref_type, m.ref_id) : null
        const note =
          m.description && !m.document.endsWith(m.description) && !/^(Cobro|Pago) (venta|compra) #\d+$/.test(m.description) && !m.description.startsWith('Comisión de cobro')
            ? m.description
            : null
        return (
          <div className="min-w-0">
            <p className="font-semibold text-ink">
              {link ? (
                <Link to={link} onClick={(e) => e.stopPropagation()} className="hover:text-sky-deep hover:underline">
                  {m.document}
                </Link>
              ) : (
                m.document
              )}
              {m.counterpart && m.ref_type !== 'transfer' && <span className="font-normal text-ink-soft"> · {m.counterpart}</span>}
            </p>
            <p className="text-[12.5px] text-muted">
              <span className="sm:hidden">{nb(dateShort(m.date))} · </span>
              {m.label}
              <span className="md:hidden"> · {m.account_name}</span>
              {note && <span> · {note}</span>}
            </p>
          </div>
        )
      },
    },
    {
      key: 'account_name',
      header: 'Cuenta',
      hideBelow: 'md',
      cell: (m) => {
        const Icon = ACCOUNT_ICON[m.account_kind] ?? ACCOUNT_ICON.otro
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-soft">
            <Icon size={15} aria-hidden />
            {m.account_name}
          </span>
        )
      },
    },
    {
      key: 'signed_amount',
      header: 'Monto',
      align: 'right',
      cell: (m) => <SignedMoney value={m.signed_amount} />,
    },
    ...(filters.accountId
      ? [
          {
            key: 'running_balance',
            header: 'Saldo',
            align: 'right' as const,
            hideBelow: 'sm' as const,
            sortable: false,
            cell: (m: MovementRow) => <span className={clsx('vh-num', (m.running_balance ?? 0) < 0 ? 'text-bad' : 'text-ink-soft')}>{nb(money(m.running_balance))}</span>,
          },
        ]
      : []),
    {
      key: 'actions',
      header: <span className="sr-only">Acciones</span>,
      sortable: false,
      className: 'w-[1%]',
      cell: (m) => {
        const link = m.ref_exists ? docLink(m.ref_type, m.ref_id) : null
        if (m.manual) {
          return (
            <div className="flex justify-end gap-0.5">
              {isManualKind(m.ref_type) && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Pencil}
                  aria-label="Editar movimiento"
                  title="Editar"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEdit(m)
                  }}
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                aria-label={m.ref_type === 'transfer' ? 'Borrar transferencia' : 'Borrar movimiento'}
                title="Borrar"
                className={clsx('hover:bg-bad-soft hover:text-bad', isManualKind(m.ref_type) && 'hidden sm:inline-flex')}
                onClick={(e) => {
                  e.stopPropagation()
                  askDelete(m)
                }}
              />
            </div>
          )
        }
        if (link) {
          return (
            <div className="hidden justify-end sm:flex">
              <Button
                size="sm"
                variant="ghost"
                icon={ArrowUpRight}
                aria-label={`Abrir ${m.document}`}
                title={`Abrir ${m.document}`}
                onClick={(e) => {
                  e.stopPropagation()
                  navigate(link)
                }}
              />
            </div>
          )
        }
        return null
      },
    },
  ]

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.active ? a.name : `${a.name} (desactivada)` }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker />
        <Select
          aria-label="Cuenta"
          className="w-full sm:w-[210px]"
          value={filters.accountId ?? ''}
          onChange={(v) => setFilters({ ...filters, accountId: v ? Number(v) : null })}
          placeholder="Todas las cuentas"
          options={accountOptions}
        />
        <Select
          aria-label="Tipo de movimiento"
          className="w-full sm:w-[250px]"
          value={filters.type}
          onChange={(v) => setFilters({ ...filters, type: v })}
          placeholder="Todos los tipos"
          options={TYPE_FILTERS}
        />
        <Select
          aria-label="Entradas o salidas"
          className="w-full sm:w-[190px]"
          value={filters.direction}
          onChange={(v) => setFilters({ ...filters, direction: v as MovementFilters['direction'] })}
          placeholder="Entradas y salidas"
          options={[
            { value: 'in', label: 'Solo lo que entró' },
            { value: 'out', label: 'Solo lo que salió' },
          ]}
        />
        {(filters.accountId || filtered) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({ accountId: null, direction: '', type: '' })}>
            Sacar filtros
          </Button>
        )}
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || !s ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat
              label={account ? `Saldo al empezar` : 'Plata al empezar'}
              value={nb(money(s.opening_balance, { decimals: 0 }))}
              info={{
                title: 'Saldo al empezar el período',
                text: `${account ? `Lo que había en ${account.name}` : 'La suma de todas tus cuentas'} al cierre del ${fmtDate(addDays(period.from, -1))}, antes del primer movimiento del período.`,
              }}
            />
            <Stat
              label={filtered ? 'Entró (filtrado)' : 'Entró'}
              tone="in"
              value={nb(money(s.total_in, { decimals: 0 }))}
              info={{
                title: 'Lo que entró',
                text: account
                  ? `Todo lo que entró a ${account.name} en el período (incluye transferencias desde otras cuentas).`
                  : 'Cobros, aportes, préstamos y otros ingresos del período. Las transferencias entre tus cuentas no cuentan: la plata sigue siendo tuya.',
              }}
            />
            <Stat
              label={filtered ? 'Salió (filtrado)' : 'Salió'}
              tone="out"
              value={nb(money(s.total_out, { decimals: 0 }))}
              info={{
                title: 'Lo que salió',
                text: account
                  ? `Todo lo que salió de ${account.name} en el período (incluye transferencias a otras cuentas).`
                  : 'Pagos de compras y gastos, comisiones, retiros y préstamos pagados. Las transferencias entre tus cuentas no cuentan.',
              }}
            />
            <Stat
              label={account ? 'Saldo al terminar' : 'Plata al terminar'}
              value={<span className={s.closing_balance < 0 ? 'text-bad' : undefined}>{nb(money(s.closing_balance, { decimals: 0 }))}</span>}
              info={{ title: 'Saldo al terminar el período', text: `Saldo al empezar + lo que entró − lo que salió (sin filtros), al ${fmtDate(period.to)}.` }}
            />
          </div>
          {!account && s.transfers > 0 && !filtered && (
            <p className="flex items-start gap-1.5 text-[13px] text-muted">
              <ArrowRightLeft size={14} className="mt-[3px] shrink-0" aria-hidden /> Además pasaste {money(s.transfers)} de una cuenta a otra. Eso no es entrada ni salida: la plata sigue siendo tuya.
            </p>
          )}

          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(m) => m.id}
            searchPlaceholder="Buscar cliente, proveedor, nº o detalle…"
            pageSize={30}
            dense
            onRowClick={(m) => {
              const link = m.ref_exists ? docLink(m.ref_type, m.ref_id) : null
              if (link) navigate(link)
              else if (isManualKind(m.ref_type)) onEdit(m)
            }}
            empty={
              <div className="vh-card">
                <EmptyState
                  compact
                  icon={ArrowRightLeft}
                  title={filtered || account ? 'No hay movimientos con esos filtros' : 'No hubo movimientos en este período'}
                  action={
                    filtered || account ? (
                      <Button onClick={() => setFilters({ accountId: null, direction: '', type: '' })}>Ver todos los movimientos</Button>
                    ) : (
                      <Button icon={Plus} onClick={onNew}>
                        Cargar un movimiento
                      </Button>
                    )
                  }
                >
                  {filtered || account
                    ? `Probá con otro período (estás viendo: ${periodLabel.toLowerCase()}) o sacá los filtros.`
                    : 'Cuando cargues ventas cobradas, compras o gastos pagados, la plata aparece acá sola. Para aportes, retiros o préstamos usá «Nuevo movimiento».'}
                </EmptyState>
              </div>
            }
          />
        </>
      )}
    </div>
  )
}
