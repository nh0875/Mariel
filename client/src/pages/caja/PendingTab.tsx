// Pestaña "Por cobrar y por pagar": quién te debe, a quién le debés, qué está vencido
// y cómo quedaría la caja en los próximos 30 días si se cobra y se paga todo lo que vence.
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ChevronDown, CircleCheck, Equal, HandCoins, Minus, Plus, Receipt } from 'lucide-react'
import clsx from 'clsx'
import { date as fmtDate, dateShort, money } from '@/lib/format'
import type { GlossaryKey } from '@/lib/glossary'
import { useApi, useSettings } from '@/lib/queries'
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, InfoTip, Loading, type Column } from '@/components/ui'
import { SettlementModal } from '@/components/forms/SettlementModal'
import { SummaryLine, nb } from './parts'
import type { PayableRow, PendingResult, Projection, ReceivableRow } from './types'

/** "Vencida hace 12 días" / "Vence en 5 días" / "Sin fecha". */
function DueBadge({ due, overdue, daysOverdue }: { due: string | null; overdue: boolean; daysOverdue: number }) {
  if (!due) return <Badge>Sin fecha</Badge>
  if (overdue) {
    return (
      <Badge tone="bad" icon={<AlertTriangle size={12} strokeWidth={2.6} aria-hidden />}>
        {daysOverdue === 1 ? 'Venció ayer' : `Vencida hace ${daysOverdue} días`}
      </Badge>
    )
  }
  const days = Math.round((new Date(`${due}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000)
  return (
    <Badge tone={days <= 7 ? 'warn' : 'neutral'} icon={<CalendarClock size={12} strokeWidth={2.6} aria-hidden />}>
      {days === 0 ? 'Vence hoy' : days === 1 ? 'Vence mañana' : `Vence en ${days} días`}
    </Badge>
  )
}

function EquationBox({ label, value, tone, sub }: { label: string; value: number; tone?: 'in' | 'out' | 'result'; sub?: string }) {
  return (
    <div
      className={clsx(
        'min-w-0 flex-1 rounded-2xl px-3.5 py-3',
        tone === 'result' ? (value < 0 ? 'bg-bad-soft' : 'bg-good-soft') : tone === 'in' ? 'bg-sky-soft' : tone === 'out' ? 'bg-coral-soft' : 'bg-cream-deep',
      )}
    >
      <p className="text-[12.5px] leading-tight font-bold text-ink-soft">{label}</p>
      <p className={clsx('vh-num mt-1 truncate text-[1.3rem] font-extrabold', tone === 'result' && value < 0 ? 'text-bad' : 'text-ink')} title={money(value)}>
        {nb(money(value, { decimals: 0 }))}
      </p>
      {sub && <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{sub}</p>}
    </div>
  )
}

const Op = ({ icon: Icon }: { icon: typeof Plus }) => (
  <span className="grid h-7 w-7 shrink-0 place-items-center self-center rounded-full bg-paper text-ink-soft shadow-sm" aria-hidden>
    <Icon size={15} strokeWidth={3} />
  </span>
)

function ProjectionCard({ p }: { p: Projection }) {
  const [open, setOpen] = useState(false)
  const short = p.expected_balance < 0
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          ¿Cómo quedaría la caja en 30 días?
          <InfoTip
            title="Proyección a 30 días"
            text={
              <>
                Una cuenta simple: la plata que tenés hoy, más lo que te tienen que pagar (lo vencido, lo que vence en los próximos 30 días y las ventas a cuenta sin fecha), menos lo que tenés
                que pagar (lo mismo) y los gastos fijos del mes que todavía no cargaste. No incluye ventas ni compras que todavía no hiciste.
              </>
            }
          />
        </span>
      }
      subtitle={`Si cobrás y pagás todo lo que vence hasta el ${fmtDate(p.until)}.`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <EquationBox label="Plata hoy" value={p.cash_now} sub="Todas las cuentas" />
        <Op icon={Plus} />
        <EquationBox label="Te van a pagar" value={p.next_30_days_in} tone="in" sub={p.in_breakdown.overdue > 0 ? `${nb(money(p.in_breakdown.overdue, { decimals: 0 }))} ya vencido` : undefined} />
        <Op icon={Minus} />
        <EquationBox
          label="Tenés que pagar"
          value={p.next_30_days_out}
          tone="out"
          sub={p.out_breakdown.fixed > 0 ? `Incluye ${nb(money(p.out_breakdown.fixed, { decimals: 0 }))} de gastos fijos` : undefined}
        />
        <Op icon={Equal} />
        <EquationBox label="Te quedarían" value={p.expected_balance} tone="result" />
      </div>
      <p className={clsx('mt-3 flex items-start gap-2 text-[14.5px]', short ? 'text-bad' : 'text-ink')}>
        {short ? <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden /> : <CircleCheck size={18} className="mt-0.5 shrink-0 text-good" aria-hidden />}
        <span>
          {short ? (
            <>
              <b>Ojo: no te alcanzaría.</b> Te faltarían {money(-p.expected_balance, { decimals: 0 })}. Cobrá lo vencido, negociá plazos con proveedores o frená retiros este mes.
            </>
          ) : p.in_breakdown.overdue > p.cash_now * 0.5 && p.in_breakdown.overdue > 0 ? (
            <>
              <b>Te alcanza, pero dependés de cobrar lo vencido</b> ({money(p.in_breakdown.overdue, { decimals: 0 })}). Llamá primero a los que deben hace más tiempo.
            </>
          ) : (
            <>
              <b>Vas bien:</b> con lo que tenés y lo que vas a cobrar, cubrís lo que vence en el mes.
            </>
          )}
        </span>
      </p>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 inline-flex items-center gap-1 text-[13.5px] font-bold text-sky-deep hover:underline">
        {open ? 'Ocultar el detalle' : 'Ver de dónde salen estos números'}
        <ChevronDown size={15} className={clsx('transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="vh-anim-fade mt-3 grid gap-x-8 gap-y-4 md:grid-cols-2">
          <div>
            <p className="vh-label mb-1">Te van a pagar</p>
            <SummaryLine label="Ventas ya vencidas" value={money(p.in_breakdown.overdue)} />
            <SummaryLine label="Vencen en los próximos 30 días" value={money(p.in_breakdown.upcoming)} />
            <SummaryLine label="Ventas a cuenta sin fecha" value={money(p.in_breakdown.no_date)} />
            <SummaryLine label="Total" value={money(p.next_30_days_in)} strong />
            {p.in_breakdown.later > 0 && <p className="text-[12.5px] text-muted">No cuenta {money(p.in_breakdown.later)} que vence más adelante.</p>}
          </div>
          <div>
            <p className="vh-label mb-1">Tenés que pagar</p>
            <SummaryLine label="Deudas ya vencidas" value={money(p.out_breakdown.overdue)} />
            <SummaryLine label="Vencen en los próximos 30 días" value={money(p.out_breakdown.upcoming)} />
            <SummaryLine label="Deudas sin fecha" value={money(p.out_breakdown.no_date)} />
            <SummaryLine label="Gastos fijos que todavía no cargaste" value={money(p.out_breakdown.fixed)} />
            {p.fixed_items.map((f) => (
              <SummaryLine
                key={`${f.id}-${f.date}`}
                muted
                label={
                  <span className="truncate pl-3 text-[13.5px]">
                    {f.description} · {dateShort(f.date)}
                  </span>
                }
                value={<span className="text-[13.5px]">{money(f.amount)}</span>}
              />
            ))}
            <SummaryLine label="Total" value={money(p.next_30_days_out)} strong />
            {p.out_breakdown.later > 0 && <p className="text-[12.5px] text-muted">No cuenta {money(p.out_breakdown.later)} que vence más adelante.</p>}
          </div>
        </div>
      )}
    </Card>
  )
}

function ListCard({
  title,
  term,
  subtitle,
  total,
  overdue,
  count,
  noun,
  children,
}: {
  title: string
  term: GlossaryKey
  subtitle: string
  total: number
  overdue: number
  count: number
  noun: [string, string]
  children: ReactNode
}) {
  return (
    <section className="vh-card min-w-0 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[17px] leading-tight font-extrabold text-ink">
            {title} <InfoTip term={term} />
          </h3>
          <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="vh-num text-[1.6rem] leading-none font-extrabold text-ink">{nb(money(total, { decimals: 0 }))}</span>
          <span className="text-[13px] text-muted">
            {count} {count === 1 ? noun[0] : noun[1]}
          </span>
          {overdue > 0.01 && (
            <Badge tone="bad" icon={<AlertTriangle size={12} strokeWidth={2.6} aria-hidden />}>
              {nb(money(overdue, { decimals: 0 }))} vencido
            </Badge>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

type Settle =
  | { kind: 'sale'; id: number; balance: number; description: string; account: number | null }
  | { kind: 'purchase' | 'expense'; id: number; balance: number; description: string; account: number | null }

export function PendingTab() {
  const navigate = useNavigate()
  const q = useApi<PendingResult>('/pending')
  const { data: settings } = useSettings()
  const [settle, setSettle] = useState<Settle | null>(null)
  const accountFor = (method: string) => settings?.payment_methods.find((m) => m.key === method)?.account_id ?? null

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Loading />
  const { receivables, payables, totals, projection } = q.data

  const collect = (s: ReceivableRow) =>
    setSettle({ kind: 'sale', id: s.id, balance: s.balance, description: `Venta #${s.id}${s.client_name ? ` · ${s.client_name}` : ''}`, account: accountFor(s.payment_method) })
  const pay = (p: PayableRow) =>
    setSettle({ kind: p.type, id: p.id, balance: p.balance, description: `${p.type === 'purchase' ? p.detail : 'Gasto'} · ${p.name}`, account: accountFor('transferencia') })
  /** En el celular el botón va debajo del monto (si no, la tabla no entra a lo ancho). */
  const quickButton = (label: string, icon: typeof HandCoins, onClick: () => void) => (
    <Button
      size="sm"
      variant="soft"
      icon={icon}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {label}
    </Button>
  )

  const recCols: Column<ReceivableRow>[] = [
    {
      key: 'client_name',
      header: 'Cliente',
      value: (s) => `${s.client_name ?? 'Sin cliente'} ${s.id}`,
      cell: (s) => (
        <div className="min-w-0">
          <p className="font-semibold text-ink">{s.client_name ?? <span className="text-ink-soft">Sin cliente (mostrador)</span>}</p>
          <p className="text-[12.5px] text-muted">
            Venta #{s.id} · {nb(dateShort(s.date))}
            {s.status === 'parcial' && ` · cobraste ${money(s.paid, { decimals: 0 })}`}
          </p>
          <span className="mt-1 block sm:hidden">
            <DueBadge due={s.due_date} overdue={s.overdue} daysOverdue={s.days_overdue} />
          </span>
        </div>
      ),
    },
    {
      key: 'due_date',
      header: 'Vence',
      hideBelow: 'sm',
      value: (s) => s.due_date ?? '9999',
      cell: (s) => <DueBadge due={s.due_date} overdue={s.overdue} daysOverdue={s.days_overdue} />,
    },
    {
      key: 'balance',
      header: 'Falta',
      align: 'right',
      cell: (s) => (
        <>
          <span className={clsx('font-bold', s.overdue && 'text-bad')}>{nb(money(s.balance))}</span>
          <span className="mt-1.5 block sm:hidden">
            {quickButton('Cobrar', HandCoins, () => collect(s))}
          </span>
        </>
      ),
    },
    {
      key: 'act',
      header: <span className="sr-only">Cobrar</span>,
      sortable: false,
      hideBelow: 'sm',
      className: 'w-[1%]',
      cell: (s) => quickButton('Cobrar', HandCoins, () => collect(s)),
    },
  ]

  const payCols: Column<PayableRow>[] = [
    {
      key: 'name',
      header: 'A quién / qué',
      value: (p) => `${p.name} ${p.detail}`,
      cell: (p) => (
        <div className="min-w-0">
          <p className="font-semibold text-ink">{p.name}</p>
          <p className="text-[12.5px] text-muted">
            {p.type === 'purchase' ? p.detail : `Gasto${p.detail ? ` · ${p.detail}` : ''}`} · {nb(dateShort(p.date))}
          </p>
          <span className="mt-1 block sm:hidden">
            <DueBadge due={p.due_date} overdue={p.overdue} daysOverdue={p.days_overdue} />
          </span>
        </div>
      ),
    },
    {
      key: 'due_date',
      header: 'Vence',
      hideBelow: 'sm',
      value: (p) => p.due_date ?? '9999',
      cell: (p) => <DueBadge due={p.due_date} overdue={p.overdue} daysOverdue={p.days_overdue} />,
    },
    {
      key: 'balance',
      header: 'Falta',
      align: 'right',
      cell: (p) => (
        <>
          <span className={clsx('font-bold', p.overdue && 'text-bad')}>{nb(money(p.balance))}</span>
          <span className="mt-1.5 block sm:hidden">
            {quickButton('Pagar', Receipt, () => pay(p))}
          </span>
        </>
      ),
    },
    {
      key: 'act',
      header: <span className="sr-only">Pagar</span>,
      sortable: false,
      hideBelow: 'sm',
      className: 'w-[1%]',
      cell: (p) => quickButton('Pagar', Receipt, () => pay(p)),
    },
  ]

  return (
    <div className="space-y-4">
      <ProjectionCard p={projection} />

      <div className="grid gap-4 2xl:grid-cols-2">
        <ListCard
          title="Te deben"
          term="por_cobrar"
          subtitle="Ventas que todavía no cobraste, de la más vieja a la más nueva. Tocá una para ver el detalle."
          total={totals.receivables}
          overdue={totals.receivables_overdue}
          count={totals.receivables_count}
          noun={['venta', 'ventas']}
        >
          <DataTable
            rows={receivables}
            columns={recCols}
            rowKey={(s) => s.id}
            dense
            pageSize={8}
            searchPlaceholder="Buscar cliente o nº…"
            onRowClick={(s) => navigate(`/ventas?ver=${s.id}`)}
            empty={
              <EmptyState compact icon={CircleCheck} title="¡Nadie te debe nada!">
                Todas tus ventas están cobradas. Cuando vendas «a cuenta», van a aparecer acá.
              </EmptyState>
            }
          />
        </ListCard>

        <ListCard
          title="Debés"
          term="por_pagar"
          subtitle="Compras de vino y gastos sin pagar, ordenados por vencimiento."
          total={totals.payables}
          overdue={totals.payables_overdue}
          count={totals.payables_count}
          noun={['deuda', 'deudas']}
        >
          <DataTable
            rows={payables}
            columns={payCols}
            rowKey={(p) => `${p.type}-${p.id}`}
            dense
            pageSize={8}
            searchPlaceholder="Buscar proveedor o gasto…"
            onRowClick={(p) => navigate(p.type === 'purchase' ? `/compras?ver=${p.id}` : `/gastos?ver=${p.id}`)}
            empty={
              <EmptyState compact icon={CircleCheck} title="¡Estás al día!">
                No tenés compras ni gastos sin pagar.
              </EmptyState>
            }
          />
        </ListCard>
      </div>

      {settle && (
        <SettlementModal
          open
          kind={settle.kind}
          id={settle.id}
          balance={settle.balance}
          description={settle.description}
          defaultAccountId={settle.account}
          onClose={() => setSettle(null)}
        />
      )}
    </div>
  )
}

