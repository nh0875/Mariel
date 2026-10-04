// Gastos: todo lo que pagás para que el negocio funcione (alquiler, sueldos, envíos, publicidad…).
// Tres pestañas: la lista del período, los gastos fijos que se generan cada mes y el análisis por categoría.
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChartPie, Plus, Receipt, Repeat } from 'lucide-react'
import { monthKey, today } from '@shared/dates'
import { useNewParam } from '@/lib/hooks'
import { usePeriod } from '@/lib/period'
import { useApi } from '@/lib/queries'
import { Button, ExportButton, HelpBox, PageHeader, Tabs } from '@/components/ui'
import { ExpensesTab, type ExpenseFilters } from './ExpensesTab'
import { RecurringTab } from './RecurringTab'
import { CategoriesTab } from './CategoriesTab'
import { ExpenseFormModal } from './ExpenseFormModal'
import { ExpenseDetailModal } from './ExpenseDetailModal'
import type { ExpenseDetail, RecurringStatus } from './types'

type TabKey = 'gastos' | 'fijos' | 'categorias'
const TAB_KEYS: TabKey[] = ['gastos', 'fijos', 'categorias']

export default function GastosPage() {
  const { period } = usePeriod()
  const [params, setParams] = useSearchParams()
  const [newOpen, openNew, closeNew] = useNewParam()
  const [presetEvent, setPresetEvent] = useState<number | null>(null)
  const [editing, setEditing] = useState<ExpenseDetail | null>(null)
  const [filters, setFilters] = useState<ExpenseFilters>({ category: '', nature: '', status: '' })

  const rawTab = params.get('tab') as TabKey | null
  const tab: TabKey = rawTab && TAB_KEYS.includes(rawTab) ? rawTab : 'gastos'
  const setTab = useCallback(
    (k: TabKey, opts: { closeDetail?: boolean } = {}) => {
      const next = new URLSearchParams(params)
      if (k === 'gastos') next.delete('tab')
      else next.set('tab', k)
      if (opts.closeDetail) next.delete('ver')
      setParams(next, { replace: true })
      window.scrollTo({ top: 0 })
    },
    [params, setParams],
  )

  // ?evento=ID → abre "Nuevo gasto" asociado a ese evento (desde la ficha del evento).
  useEffect(() => {
    const ev = Number(params.get('evento'))
    if (ev > 0) {
      setPresetEvent(ev)
      openNew()
      const next = new URLSearchParams(params)
      next.delete('evento')
      setParams(next, { replace: true })
    }
  }, [params, setParams, openNew])

  // ?ver=ID → abre el detalle de ese gasto (links desde otras pantallas).
  const viewId = Number(params.get('ver')) || null
  const openDetail = (id: number) => {
    const next = new URLSearchParams(params)
    next.set('ver', String(id))
    setParams(next, { replace: true })
  }
  const closeDetail = () => {
    const next = new URLSearchParams(params)
    next.delete('ver')
    setParams(next, { replace: true })
  }

  // Cuántos gastos fijos faltan generar este mes (para el numerito de la pestaña).
  const rec = useApi<RecurringStatus>('/recurring-expenses/status', { month: monthKey(today()) })
  const missing = rec.data?.missing ?? 0

  const formOpen = newOpen || !!editing
  const closeForm = () => {
    closeNew()
    setEditing(null)
    setPresetEvent(null)
  }

  return (
    <>
      <PageHeader
        title="Gastos"
        description="Todo lo que pagás para que el negocio funcione: alquiler, sueldos, envíos, publicidad… Cargalos acá y mirá en qué se va la plata."
        actions={
          <>
            <ExportButton
              path="/expenses/export"
              params={{ from: period.from, to: period.to, category: filters.category || undefined, nature: filters.nature || undefined, status: filters.status || undefined }}
            />
            <Button variant={tab === 'fijos' ? 'secondary' : 'primary'} icon={Plus} onClick={openNew}>
              Nuevo gasto
            </Button>
          </>
        }
      />

      <HelpBox id="gastos">
        <p>
          Acá cargás <b>todo lo que pagás para que el negocio funcione</b>: alquiler, sueldos y cargas sociales, luz e internet, envíos, packaging, publicidad, el contador, los impuestos.
          Con eso el sistema calcula tu resultado real y en qué se va la plata.
        </p>
        <ul>
          <li>
            <b>Lo que NO es un gasto:</b> comprar vino (es mercadería: va en «Compras de vino» y se vuelve costo recién cuando vendés la botella) y la plata que se llevan los dueños
            (es un retiro de ganancia: va en «Caja y bancos»).
          </li>
          <li>
            <b>Fijo o variable.</b> Fijo es lo que pagás igual vendas o no (el alquiler de $ 720.000, los sueldos). Variable es lo que sube o baja con las ventas (el cadete de cada envío,
            las cajas, la publicidad). ¿Por qué importa? Con los fijos se calcula el <b>punto de equilibrio</b>: cuánto tenés que vender por mes para no perder plata.
          </li>
          <li>
            <b>Cuenta cuando se gasta, no cuando se paga.</b> La factura del contador de octubre ($ 135.000) es gasto de octubre aunque la pagues el 10 de noviembre: mientras tanto
            queda «por pagar». La plata sale de la caja recién el día que la pagás.
          </li>
          <li>
            <b>Gastos fijos del mes:</b> cargá una vez lo que se repite (alquiler, sueldos, abonos) y cada mes se genera con un clic. Si te olvidás, te avisamos.
          </li>
        </ul>
      </HelpBox>

      <Tabs<TabKey>
        className="mt-6 mb-5"
        value={tab}
        onChange={(k) => setTab(k)}
        items={[
          { key: 'gastos', label: 'Gastos', icon: Receipt },
          { key: 'fijos', label: 'Gastos fijos del mes', icon: Repeat, count: missing > 0 ? missing : undefined },
          { key: 'categorias', label: 'Por categoría', icon: ChartPie },
        ]}
      />

      {tab === 'gastos' && <ExpensesTab filters={filters} setFilters={setFilters} onNew={openNew} onOpen={openDetail} onShowRecurring={() => setTab('fijos')} />}
      {tab === 'fijos' && <RecurringTab onOpenExpense={openDetail} />}
      {tab === 'categorias' && (
        <CategoriesTab
          onNew={openNew}
          onPickCategory={(category) => {
            setFilters({ category, nature: '', status: '' })
            setTab('gastos')
          }}
        />
      )}

      <ExpenseFormModal
        open={formOpen}
        onClose={closeForm}
        expense={editing}
        presetEventId={presetEvent}
        onSaved={(e) => {
          if (editing) openDetail(e.id)
        }}
      />
      <ExpenseDetailModal
        expenseId={formOpen ? null : viewId}
        onClose={closeDetail}
        onEdit={(e) => {
          closeDetail()
          setEditing(e)
        }}
        onShowRecurring={() => setTab('fijos', { closeDetail: true })}
      />
    </>
  )
}
