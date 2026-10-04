// Proveedores: a quién le comprás (bodegas, distribuidores) y quién te da servicios.
// Lo importante de un vistazo: cuánto le compraste a cada uno y cuánto le debés.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Phone, Plus, Truck } from 'lucide-react'
import { SUPPLIER_KIND_LABELS, SUPPLIER_KINDS, type SupplierKind } from '@shared/constants'
import { safeDiv } from '@shared/calc'
import { dateShort, int, money, pct, relativeDays } from '@/lib/format'
import { useNewParam } from '@/lib/hooks'
import { useApi } from '@/lib/queries'
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, ErrorState, ExportButton, HelpBox, Loading, PageHeader, Select, type Column } from '@/components/ui'
import { Kpi, nb, tileMoney } from '../compras/parts'
import { SupplierFormModal } from './SupplierFormModal'
import { WINE_KINDS, type SupplierListRow } from './types'

const KIND_TONE: Record<SupplierKind, 'mustard' | 'orange' | 'sky' | 'neutral' | 'coral'> = {
  bodega: 'mustard',
  distribuidor: 'orange',
  insumos: 'sky',
  servicios: 'neutral',
  logistica: 'coral',
  otro: 'neutral',
}

/** Nombre corto del tipo para la tabla. */
const KIND_SHORT: Record<SupplierKind, string> = {
  bodega: 'Bodega',
  distribuidor: 'Distribuidor',
  insumos: 'Insumos',
  servicios: 'Servicios',
  logistica: 'Logística',
  otro: 'Otro',
}

export default function ProveedoresPage() {
  const navigate = useNavigate()
  const [newOpen, openNew, closeNew] = useNewParam()
  const [kind, setKind] = useState<SupplierKind | ''>('')
  const [showInactive, setShowInactive] = useState(false)
  const q = useApi<SupplierListRow[]>('/suppliers')
  const all = q.data ?? []

  const stats = useMemo(() => {
    const active = all.filter((s) => s.active)
    const wine = active.filter((s) => (WINE_KINDS as readonly string[]).includes(s.kind))
    const owed = all.filter((s) => s.balance > 0.01)
    const totalBought = all.reduce((a, s) => a + s.total_bought, 0)
    const top = [...all].sort((a, b) => b.total_bought - a.total_bought)[0]
    return {
      active: active.length,
      wine: wine.length,
      services: active.length - wine.length,
      inactive: all.length - active.length,
      balance: owed.reduce((a, s) => a + s.balance, 0),
      overdue: all.reduce((a, s) => a + s.overdue, 0),
      owedCount: owed.length,
      totalBought,
      top: top && top.total_bought > 0 ? top : null,
    }
  }, [all])

  const rows = useMemo(() => all.filter((s) => (showInactive || s.active) && (!kind || s.kind === kind)), [all, showInactive, kind])
  const totals = useMemo(() => ({ bought: rows.reduce((a, s) => a + s.total_bought, 0), balance: rows.reduce((a, s) => a + s.balance, 0) }), [rows])

  const columns: Column<SupplierListRow>[] = [
    {
      key: 'name',
      header: 'Proveedor',
      value: (s) => `${s.name} ${s.contact_name ?? ''} ${s.phone ?? ''} ${s.email ?? ''} ${KIND_SHORT[s.kind]}`,
      cell: (s) => (
        <div className="min-w-0">
          <span className="font-semibold text-ink">{s.name}</span>
          {!s.active && (
            <Badge className="ml-2 align-[1px]" tone="neutral">
              Desactivado
            </Badge>
          )}
          <span className="block max-w-[52vw] truncate text-[12.5px] text-muted sm:max-w-[320px]">
            <span className="md:hidden">{KIND_SHORT[s.kind]}</span>
            {s.contact_name && (
              <>
                <span className="md:hidden"> · </span>
                {s.contact_name}
              </>
            )}
          </span>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Tipo',
      value: (s) => KIND_SHORT[s.kind],
      cell: (s) => <Badge tone={KIND_TONE[s.kind]}>{KIND_SHORT[s.kind]}</Badge>,
      hideBelow: 'md',
      className: 'w-[1%]',
    },
    {
      key: 'contact',
      header: 'Contacto',
      sortable: false,
      value: (s) => `${s.phone ?? ''} ${s.email ?? ''}`,
      cell: (s) =>
        s.phone || s.email ? (
          <div className="flex flex-col gap-0.5 text-[13.5px]">
            {s.phone && (
              <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-sky-deep hover:underline">
                <Phone size={13} aria-hidden /> {s.phone}
              </a>
            )}
            {s.email && (
              <a href={`mailto:${s.email}`} onClick={(e) => e.stopPropagation()} className="inline-flex max-w-[220px] items-center gap-1 truncate text-sky-deep hover:underline">
                <Mail size={13} aria-hidden /> <span className="truncate">{s.email}</span>
              </a>
            )}
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
      hideBelow: 'lg',
    },
    {
      key: 'last_purchase',
      header: 'Última compra',
      value: (s) => s.last_purchase,
      cell: (s) =>
        s.last_purchase ? (
          <span className="whitespace-nowrap text-ink-soft">
            {dateShort(s.last_purchase)}
            <span className="block text-[12px] text-muted">{relativeDays(s.last_purchase)}</span>
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
      hideBelow: 'lg',
    },
    {
      key: 'total_bought',
      header: 'Total comprado',
      align: 'right',
      cell: (s) =>
        s.total_bought > 0 ? (
          <span className="font-semibold">{money(s.total_bought, { decimals: 0 })}</span>
        ) : s.expenses_total > 0 ? (
          // Proveedores de servicios: no les comprás vino, pero sí les pagás gastos. Lo mostramos aparte (no suma al total de vino).
          <span className="text-[12.5px] whitespace-nowrap text-muted" title="Gastos cargados con este proveedor (no es compra de vino)">
            {money(s.expenses_total, { decimals: 0 })} en gastos
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
      hideBelow: 'sm',
      footer: money(totals.bought, { decimals: 0 }),
    },
    {
      key: 'balance',
      header: 'Saldo a pagar',
      align: 'right',
      cell: (s) =>
        s.balance > 0.01 ? (
          <span>
            <span className={s.overdue > 0.01 ? 'font-bold text-bad' : 'font-bold text-ink'}>{money(s.balance, { decimals: 0 })}</span>
            {s.overdue > 0.01 && <span className="block text-[12px] font-semibold text-bad">{money(s.overdue, { decimals: 0 })} vencido</span>}
          </span>
        ) : (
          <span className="text-muted">Al día</span>
        ),
      footer: money(totals.balance, { decimals: 0 }),
    },
  ]

  return (
    <>
      <PageHeader
        title="Proveedores"
        description="Bodegas, distribuidores y servicios: cuánto le comprás a cada uno, cuánto les debés y cómo contactarlos."
        actions={
          <>
            <ExportButton path="/suppliers/export" />
            <Button variant="primary" icon={Plus} onClick={openNew}>
              Nuevo proveedor
            </Button>
          </>
        }
      />

      <HelpBox id="proveedores">
        <p>
          Acá tenés a <b>todos tus proveedores</b>: las bodegas y distribuidoras que te venden vino (aparecen en «Compras») y los que te dan servicios, como el flete, el packaging
          o el contador (aparecen en «Gastos»).
        </p>
        <ul>
          <li>
            <b>Total comprado:</b> todo lo que le compraste de vino, con flete, desde la primera compra cargada.
          </li>
          <li>
            <b>Saldo a pagar:</b> lo que todavía le debés, sumando compras y gastos sin pagar. Si aparece en rojo, hay algo vencido.
          </li>
        </ul>
        <p>
          <b>Ejemplo:</b> si a «Bodega Los Cerros» le compraste $ 2.400.000 este año y le debés $ 380.000 de una factura a 30 días, lo ves acá sin buscar papeles. Tocá un proveedor
          para ver su ficha: qué vinos le comprás, cómo te fue aumentando cada uno y el historial de pagos.
        </p>
        <p>
          <b>¿Por qué importa?</b> Saber cuánto le comprás a cada uno te da fuerza para negociar precios y plazos, y tener las deudas a la vista evita sorpresas en la caja.
        </p>
      </HelpBox>

      {q.error ? (
        <ErrorState className="mt-6" error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <Kpi
              label="Proveedores activos"
              info={{
                title: 'Proveedores activos',
                text: 'Los que aparecen al cargar compras y gastos. Los desactivados conservan su historial pero no se ofrecen en los formularios.',
              }}
              value={int(stats.active)}
              hint={
                stats.active
                  ? `${int(stats.wine)} de vino · ${int(stats.services)} de servicios${stats.inactive ? ` · ${int(stats.inactive)} desactivado${stats.inactive === 1 ? '' : 's'}` : ''}`
                  : 'Todavía no cargaste ninguno'
              }
            />
            <Kpi
              label="Les debés"
              term="por_pagar"
              tone="coral"
              value={tileMoney(stats.balance)}
              title={money(stats.balance)}
              valueClassName={stats.overdue > 0.01 ? 'text-bad' : undefined}
              hint={
                stats.owedCount === 0 ? (
                  'Estás al día con todos.'
                ) : (
                  <>
                    {stats.owedCount} {stats.owedCount === 1 ? 'proveedor' : 'proveedores'} con saldo
                    {stats.overdue > 0.01 && <b className="text-bad"> · {nb(`${money(stats.overdue, { decimals: 0 })} vencido`)}</b>}
                  </>
                )
              }
            />
            <Kpi
              className="col-span-2 lg:col-span-1"
              label="Comprado en total"
              info={{
                title: 'Comprado en total',
                text: 'Todo lo que compraste de vino (con flete) desde la primera compra cargada en el sistema. No es un gasto: es lo que invertiste en stock.',
              }}
              value={tileMoney(stats.totalBought)}
              title={money(stats.totalBought)}
              hint={stats.top ? `El que más: ${stats.top.name} (${pct(safeDiv(stats.top.total_bought, stats.totalBought), 0)})` : 'Sin compras cargadas'}
            />
          </div>

          <Card className="mt-4" title="Todos los proveedores" subtitle="Tocá uno para ver su ficha: compras, pagos, vinos y contacto." flush>
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <DataTable
                rows={rows}
                columns={columns}
                rowKey={(s) => s.id}
                onRowClick={(s) => navigate(`/proveedores/${s.id}`)}
                searchPlaceholder="Buscar por nombre, contacto o teléfono…"
                rowClassName={(s) => (!s.active ? 'opacity-70' : s.overdue > 0.01 ? 'bg-bad-soft/25' : undefined)}
                toolbar={
                  <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 sm:w-auto">
                    <Select
                      aria-label="Tipo de proveedor"
                      className="w-full sm:w-[210px]"
                      value={kind}
                      onChange={(v) => setKind(v as SupplierKind | '')}
                      placeholder="Todos los tipos"
                      options={SUPPLIER_KINDS.map((k) => ({ value: k, label: SUPPLIER_KIND_LABELS[k] }))}
                    />
                    {stats.inactive > 0 && <Checkbox checked={showInactive} onChange={setShowInactive} label={`Mostrar desactivados (${stats.inactive})`} />}
                  </div>
                }
                empty={
                  all.length === 0 ? (
                    <EmptyState
                      icon={Truck}
                      title="Todavía no cargaste proveedores"
                      action={
                        <Button icon={Plus} onClick={openNew}>
                          Agregar el primero
                        </Button>
                      }
                    >
                      Empezá por las bodegas y distribuidoras que te venden vino. También los podés crear al vuelo mientras cargás una compra: escribís el nombre y listo.
                    </EmptyState>
                  ) : (
                    <EmptyState
                      compact
                      icon={Truck}
                      title="No hay proveedores con ese filtro"
                      action={<Button onClick={() => (setKind(''), setShowInactive(true))}>Ver todos</Button>}
                    >
                      Probá con otro tipo o mostrá también los desactivados.
                    </EmptyState>
                  )
                }
              />
            </div>
          </Card>
        </>
      )}

      <SupplierFormModal open={newOpen} supplier={null} onClose={closeNew} onSaved={(s) => navigate(`/proveedores/${s.id}`)} />
    </>
  )
}
