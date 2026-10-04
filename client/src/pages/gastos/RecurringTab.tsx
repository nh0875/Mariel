// Pestaña "Gastos fijos del mes": las plantillas de lo que se paga todos los meses
// y el botón para generar los gastos de un mes (sin duplicar nunca).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarCheck, Check, Pencil, Plus, Repeat, Wand2 } from 'lucide-react'
import { monthKey, today } from '@shared/dates'
import { api } from '@/lib/api'
import { money, monthName } from '@/lib/format'
import { useApi, useApiMutation } from '@/lib/queries'
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, InfoTip, Loading, ProgressBar, type Column } from '@/components/ui'
import { MonthStepper, ExpenseStatusBadge } from './parts'
import { RecurringFormModal } from './RecurringFormModal'
import { categoryIcon, categoryShort, NATURE_SHORT, type RecurringRow, type RecurringStatus } from './types'

/** "octubre" si es de este año; "octubre 2025" si no. */
function monthWord(m: string): string {
  const full = monthName(m)
  return m.slice(0, 4) === today().slice(0, 4) ? full.split(' ')[0] : full
}

export function RecurringTab({ onOpenExpense }: { onOpenExpense: (id: number) => void }) {
  const [month, setMonth] = useState(monthKey(today()))
  const templates = useApi<RecurringRow[]>('/recurring-expenses')
  const status = useApi<RecurringStatus>('/recurring-expenses/status', { month })
  const [editing, setEditing] = useState<RecurringRow | null>(null)
  const [creating, setCreating] = useState(false)

  const generate = useApiMutation((m: string) => api.post<{ created: number; skipped: number; label: string }>('/recurring-expenses/generate', { month: m }), {
    success: (r) =>
      r.created
        ? `Listo: se cargaron ${r.created} gasto${r.created === 1 ? '' : 's'} fijo${r.created === 1 ? '' : 's'} de ${r.label}${r.skipped ? ` (${r.skipped} ya estaba${r.skipped === 1 ? '' : 'n'}, no se duplicó nada)` : ''}.`
        : `Ya estaban todos los gastos fijos de ${r.label}: no se duplicó nada.`,
  })

  const rows = templates.data ?? []
  const st = status.data && status.data.month === month ? status.data : undefined
  const byTemplate = useMemo(() => new Map((st?.items ?? []).map((i) => [i.id, i])), [st])
  const active = rows.filter((r) => r.active)
  const fixedTotal = active.filter((r) => r.nature === 'fijo').reduce((s, r) => s + r.amount, 0)
  const variableTotal = active.filter((r) => r.nature !== 'fijo').reduce((s, r) => s + r.amount, 0)
  const word = monthWord(month)

  /** Qué pasó con este gasto fijo en el mes elegido: ya cargado (y si se pagó) o falta generar. */
  const monthStatus = (r: RecurringRow) => {
    if (!r.active) return <Badge>Pausado</Badge>
    const it = byTemplate.get(r.id)
    if (!it) return <span className="text-muted">…</span>
    if (it.expense_id == null) return <Badge tone="orange">Falta generar</Badge>
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenExpense(it.expense_id!)
        }}
        className="rounded-full focus-visible:outline-2"
        title="Ver el gasto cargado"
      >
        <ExpenseStatusBadge status={it.expense_status ?? 'pendiente'} overdue={it.expense_overdue} />
      </button>
    )
  }

  const columns: Column<RecurringRow>[] = [
    {
      key: 'day_of_month',
      header: 'Día',
      cell: (r) => <span className="font-extrabold whitespace-nowrap text-ink-soft">día {r.day_of_month}</span>,
      className: 'w-[1%]',
      hideBelow: 'sm',
    },
    {
      key: 'description',
      header: 'Gasto',
      value: (r) => `${r.description} ${r.category}`,
      cell: (r) => (
        <div className="max-w-[46vw] min-w-0 sm:max-w-none">
          <span className={r.active ? 'font-semibold text-ink' : 'font-semibold text-muted line-through decoration-1'}>{r.description}</span>
          <span className="block truncate text-[12.5px] text-muted md:hidden">
            <span className="sm:hidden">día {r.day_of_month} · </span>
            {categoryShort(r.category)}
            {r.auto_paid ? ' · se paga solo' : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Categoría',
      hideBelow: 'md',
      cell: (r) => {
        const Icon = categoryIcon(r.category)
        return (
          <span className="inline-flex max-w-[200px] items-center gap-1.5 text-ink-soft" title={r.category}>
            <Icon size={15} className="shrink-0 text-muted" aria-hidden />
            <span className="truncate">{categoryShort(r.category)}</span>
            {r.nature !== 'fijo' && <Badge tone="mustard">{NATURE_SHORT[r.nature]}</Badge>}
          </span>
        )
      },
    },
    { key: 'account_name', header: 'Cuenta', hideBelow: 'lg', cell: (r) => <span className="whitespace-nowrap text-ink-soft">{r.account_name || '—'}</span> },
    {
      key: 'auto_paid',
      header: '¿Se paga solo?',
      hideBelow: 'lg',
      value: (r) => (r.auto_paid ? 'Sí' : 'No'),
      cell: (r) =>
        r.auto_paid ? (
          <Badge tone="good" icon={<Check size={13} strokeWidth={3} aria-hidden />}>
            Débito automático
          </Badge>
        ) : (
          <span className="text-[13.5px] text-muted">Lo pagás vos</span>
        ),
    },
    {
      key: 'amount',
      header: 'Monto',
      align: 'right',
      cell: (r) => (
        <>
          <span className={r.active ? 'font-bold' : 'text-muted'}>{money(r.amount)}</span>
          <span className="mt-1 block sm:hidden">{monthStatus(r)}</span>
        </>
      ),
      footer: money(fixedTotal + variableTotal),
    },
    {
      key: 'month_status',
      header: `En ${word}`,
      sortable: false,
      value: (r) => (byTemplate.get(r.id)?.expense_id ? 1 : 0),
      cell: (r) => monthStatus(r),
      hideBelow: 'sm',
      className: 'w-[1%] whitespace-nowrap',
    },
    {
      key: 'edit',
      header: '',
      sortable: false,
      hideBelow: 'sm',
      cell: () => <Pencil size={16} className="text-muted" aria-hidden />,
      className: 'w-[1%]',
    },
  ]

  const nothingMissing = !!st && st.templates > 0 && st.missing === 0
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card
          title={
            <span className="flex items-center gap-1.5">
              Generar los gastos del mes
              <InfoTip
                title="¿Cómo funciona «Generar»?"
                text="Por cada gasto fijo de la lista se crea el gasto real del mes, con la fecha del día que elegiste. Los que se pagan solos quedan pagados desde su cuenta; el resto queda «por pagar». Es seguro apretarlo varias veces: si el gasto de ese mes ya existe, no se duplica."
              />
            </span>
          }
          subtitle="Una vez por mes alcanza. Si te olvidás, en la pestaña «Gastos» te avisamos."
        >
          <div className="flex flex-wrap items-center gap-3">
            <MonthStepper month={month} onChange={setMonth} />
            {month !== monthKey(today()) && (
              <Button variant="ghost" size="sm" onClick={() => setMonth(monthKey(today()))}>
                Volver a este mes
              </Button>
            )}
          </div>
          {status.error ? (
            <ErrorState className="mt-4" error={status.error} onRetry={() => status.refetch()} />
          ) : !st ? (
            <Loading />
          ) : st.templates === 0 ? (
            <p className="mt-4 text-[14.5px] text-ink-soft">Todavía no hay gastos fijos activos. Agregá el primero con «Agregar gasto fijo» y después generalos acá.</p>
          ) : (
            <div className="mt-4 space-y-3">
              <ProgressBar value={st.generated} max={st.templates} />
              <p className="text-[14.5px] text-ink-soft">
                {nothingMissing ? (
                  <>
                    <b className="text-good">¡Listo!</b> Ya están cargados los {st.templates} gastos fijos de {word}.
                  </>
                ) : (
                  <>
                    Ya se {st.generated === 1 ? 'cargó' : 'cargaron'} <b className="text-ink">{st.generated}</b> de {st.templates}. {st.missing === 1 ? 'Falta' : 'Faltan'}{' '}
                    <b className="text-ink">{st.missing}</b> por <b className="text-ink">{money(st.missing_amount)}</b>.
                  </>
                )}
              </p>
              <Button
                variant="primary"
                size="lg"
                icon={nothingMissing ? CalendarCheck : Wand2}
                className="w-full sm:w-auto"
                disabled={nothingMissing}
                loading={generate.isPending}
                onClick={() => generate.mutate(month)}
              >
                {nothingMissing ? `Ya están todos los de ${word}` : `Generar los gastos de ${word}`}
              </Button>
            </div>
          )}
        </Card>

        <Card title="Lo mínimo que tenés que cubrir" subtitle="Con este número arranca el punto de equilibrio.">
          <p className="vh-num text-[2.2rem] leading-none font-extrabold tracking-tight text-ink">
            {money(fixedTotal, { decimals: 0 })}
            <span className="ml-1 text-[15px] font-bold text-muted">por mes</span>
          </p>
          <p className="mt-3 text-[14.5px] leading-snug text-ink-soft">
            Tus gastos fijos suman <b className="text-ink">{money(fixedTotal, { decimals: 0 })}</b> por mes: es lo mínimo que tenés que cubrir con la ganancia de tus ventas, vendas
            mucho o poco.
            {variableTotal > 0 && <> Además se repiten {money(variableTotal, { decimals: 0 })} de gastos variables.</>}
          </p>
          <Link to="/calculadora" className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-bold text-sky-deep hover:underline">
            Ver punto de equilibrio en la Calculadora <ArrowRight size={15} aria-hidden />
          </Link>
          <InfoTip term="punto_equilibrio" className="ml-1.5 align-[-3px]" />
        </Card>
      </div>

      <Card
        className="mt-4"
        title="Tus gastos fijos"
        subtitle="Lo que pagás todos los meses. Tocá uno para cambiar el monto, el día, pausarlo o borrarlo."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            Agregar gasto fijo
          </Button>
        }
        flush
      >
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          {templates.error ? (
            <ErrorState error={templates.error} onRetry={() => templates.refetch()} />
          ) : templates.isLoading ? (
            <Loading />
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={(r) => setEditing(r)}
              searchable={rows.length > 8}
              searchPlaceholder="Buscar gasto fijo…"
              pageSize={50}
              empty={
                <EmptyState
                  icon={Repeat}
                  title="Todavía no cargaste gastos fijos"
                  action={
                    <Button icon={Plus} onClick={() => setCreating(true)}>
                      Agregar el primero
                    </Button>
                  }
                >
                  Alquiler, sueldos, cargas sociales, luz, internet, contador, el abono de la tienda online… Cargalos una vez con su monto y su día, y cada mes se generan solos con
                  un clic.
                </EmptyState>
              }
            />
          )}
        </div>
      </Card>

      <RecurringFormModal open={creating || !!editing} template={editing} onClose={() => (setCreating(false), setEditing(null))} />
    </>
  )
}
