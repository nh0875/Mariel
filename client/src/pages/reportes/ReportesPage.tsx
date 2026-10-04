// Reportes: el análisis a fondo de "¿Cómo venimos?".
// Seis pestañas (resultados, vinos, canales y cobros, clientes, gastos, inflación), cada una con su
// explicación, su Excel y frases que traducen los números. Todo sale del mismo motor que Inicio y Metas.
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { CalendarClock, ChartColumn, Landmark, Printer, Receipt, TrendingUp, Users, Wine } from 'lucide-react'
import { presetToPeriod, type PeriodPreset } from '@shared/dates'
import { usePeriod } from '@/lib/period'
import { date } from '@/lib/format'
import { Button, ExportButton, HelpBox, PageHeader, PeriodPicker, Tabs } from '@/components/ui'
import { PnlTab } from './PnlTab'
import { ProductsTab } from './ProductsTab'
import { ChannelsTab } from './ChannelsTab'
import { ClientsTab } from './ClientsTab'
import { ExpensesTab } from './ExpensesTab'
import { InflationTab } from './InflationTab'

type TabKey = 'resultados' | 'vinos' | 'canales' | 'clientes' | 'gastos' | 'inflacion'
const TABS: { key: TabKey; label: string; icon: typeof Wine }[] = [
  { key: 'resultados', label: 'Estado de resultados', icon: ChartColumn },
  { key: 'vinos', label: 'Rentabilidad por vino', icon: Wine },
  { key: 'canales', label: 'Canales y cobros', icon: Landmark },
  { key: 'clientes', label: 'Clientes', icon: Users },
  { key: 'gastos', label: 'Gastos', icon: Receipt },
  { key: 'inflacion', label: 'Inflación', icon: TrendingUp },
]
/** Pestañas donde lo importante es ver la evolución mes a mes. */
const MONTHLY_TABS: TabKey[] = ['resultados', 'gastos', 'inflacion']

const QUICK: { preset: PeriodPreset; label: string }[] = [
  { preset: 'ultimos_12_meses', label: 'Últimos 12 meses' },
  { preset: 'este_anio', label: 'Este año' },
]

export default function ReportesPage() {
  const { period, preset, label, setPreset } = usePeriod()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') as TabKey | null
  const tab: TabKey = raw && TABS.some((t) => t.key === raw) ? raw : 'resultados'
  const setTab = useCallback(
    (k: TabKey) => {
      const next = new URLSearchParams(params)
      if (k === 'resultados') next.delete('tab')
      else next.set('tab', k)
      setParams(next, { replace: true })
    },
    [params, setParams],
  )
  const singleMonth = period.from.slice(0, 7) === period.to.slice(0, 7)
  const tabLabel = TABS.find((t) => t.key === tab)!.label

  return (
    <>
      <PageHeader
        title="Reportes"
        description="El análisis a fondo: si el negocio gana plata y por qué, qué vinos y canales te convienen, quién te compra, en qué se va la plata y cuánto creciste de verdad, sin la inflación."
        actions={
          <>
            <Button icon={Printer} onClick={() => window.print()} title="Imprimí la pestaña que estás viendo (o guardala como PDF)">
              Imprimir
            </Button>
            <ExportButton variant="primary" path="/reports/full/export" params={{ from: period.from, to: period.to }} label="Descargar todo en Excel" />
          </>
        }
      />

      <HelpBox id="reportes">
        <p>
          Inicio te dice <b>cómo venís</b>; acá ves <b>por qué</b>. Cada pestaña responde una pregunta del negocio y explica cómo se calcula cada número (tocá los <b>?</b>).
        </p>
        <ul>
          <li>
            <b>Estado de resultados:</b> ¿gano o pierdo plata? Ejemplo: si en un mes vendiste $ 4.000.000, el vino te costó $ 2.300.000 y los gastos fueron $ 1.200.000, te quedaron $ 500.000 (un
            margen neto del 12,5 %).
          </li>
          <li>
            <b>Rentabilidad por vino:</b> qué vinos te hacen ganar plata (análisis ABC) y cuáles están quietos con plata parada en botellas.
          </li>
          <li>
            <b>Canales y cobros:</b> dónde vendés, cuánto te deja cada canal, cuánto te cobra cada medio de pago y qué días vendés más.
          </li>
          <li>
            <b>Clientes, Gastos e Inflación:</b> quién te compra, en qué se va la plata, cuánto tenés que vender para no perder y si creciste de verdad o solo subieron los precios.
          </li>
        </ul>
        <p>
          <b>¿Por qué importa?</b> Vender mucho no alcanza: lo que importa es cuánto te queda. Con estos reportes decidís precios, qué reponer, qué dejar de comprar y dónde recortar, con números y no
          a ojo. Cada pestaña tiene su Excel, y arriba podés bajar <b>todo junto</b> (con un índice que explica cada hoja) para tu contador.
        </p>
      </HelpBox>

      <div className="vh-no-print mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <PeriodPicker />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Períodos rápidos">
          {QUICK.map((q) => {
            const p = presetToPeriod(q.preset)
            const active = preset === q.preset || (preset === 'personalizado' && p.from === period.from && p.to === period.to)
            return (
              <button
                key={q.preset}
                type="button"
                onClick={() => setPreset(q.preset)}
                aria-pressed={active}
                className={clsx(
                  'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-bold transition-colors',
                  active ? 'border-orange bg-orange-soft text-ink' : 'border-line-strong bg-paper text-ink-soft hover:border-ink/40 hover:text-ink',
                )}
              >
                <CalendarClock size={15} aria-hidden />
                {q.label}
              </button>
            )
          })}
        </div>
      </div>
      {singleMonth && MONTHLY_TABS.includes(tab) && (
        <p className="vh-no-print mt-2 text-[13.5px] text-ink-soft">
          Elegiste un solo mes. Para ver cómo vienen las cosas mes a mes, probá con <b className="text-ink">Últimos 12 meses</b>.
        </p>
      )}

      {/* Solo al imprimir: qué reporte y de qué período es. */}
      <p className="hidden text-[14px] text-ink-soft print:mt-2 print:block">
        <b className="text-ink">{tabLabel}</b> · {label} ({date(period.from)} al {date(period.to)})
      </p>

      <Tabs<TabKey> className="mt-5 mb-6" value={tab} onChange={setTab} items={TABS} />

      {tab === 'resultados' && <PnlTab period={period} />}
      {tab === 'vinos' && <ProductsTab period={period} />}
      {tab === 'canales' && <ChannelsTab period={period} />}
      {tab === 'clientes' && <ClientsTab period={period} />}
      {tab === 'gastos' && <ExpensesTab period={period} />}
      {tab === 'inflacion' && <InflationTab period={period} />}
    </>
  )
}
