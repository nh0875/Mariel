// Calculadora — herramientas para decidir precios y metas, explicadas paso a paso.
// Todo se calcula en el navegador con las fórmulas de shared/pricing.ts (las mismas que usa el
// servidor y que están testeadas), precargadas con los promedios de GET /api/calculator/context.
// Nada se guarda, salvo «Usar este precio» (PUT /api/products/:id, con confirmación).
//
// Links profundos: /calculadora?tab=precio|ganancia|equilibrio|simulador|cajas  ·  /calculadora?vino=ID
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Coins, Package, Scale, Sparkles, Tag } from 'lucide-react'
import type { CalculatorContext } from '@shared/pricing'
import { ErrorState, HelpBox, Loading, PageHeader, Tabs, type TabItem } from '@/components/ui'
import { useApi } from '@/lib/queries'
import { useLocalState } from '@/lib/hooks'
import { monthsText } from './parts'
import { PrecioTab, defaultPrecio, type PrecioState } from './PrecioTab'
import { GananciaTab, defaultGanancia, type GananciaState } from './GananciaTab'
import { EquilibrioTab, defaultEquilibrio, type EquilibrioState } from './EquilibrioTab'
import { SimuladorTab, defaultSimulador, type SimuladorState } from './SimuladorTab'
import { CajasTab, defaultCajas, type CajasState } from './CajasTab'

type TabKey = 'precio' | 'ganancia' | 'equilibrio' | 'simulador' | 'cajas'

const TABS: (TabItem<TabKey> & { intro: string })[] = [
  {
    key: 'precio',
    label: '¿A cuánto lo vendo?',
    icon: Tag,
    intro: 'Te dice a cuánto vender un vino para que te quede el margen que querés, después de pagar Ingresos Brutos y la comisión del medio de pago. Abajo, todos tus vinos con el mismo criterio.',
  },
  {
    key: 'ganancia',
    label: '¿Cuánto gano con este precio?',
    icon: Coins,
    intro: 'Al revés: ponés un precio y te muestra cuánto te deja cada botella y cada caja, con un semáforo para saber si el margen es sano.',
  },
  {
    key: 'equilibrio',
    label: 'Punto de equilibrio',
    icon: Scale,
    intro: 'Cuántas botellas (y cuántos pesos) tenés que vender por mes para cubrir los gastos fijos. Es el piso del mes: por debajo perdés, por encima ganás.',
  },
  {
    key: 'simulador',
    label: '¿Qué pasa si…?',
    icon: Sparkles,
    intro: 'Simulá aumentos de la bodega, cambios de precio, promos o una suba del alquiler, y mirá cómo cambia tu resultado del mes antes de decidir.',
  },
  {
    key: 'cajas',
    label: 'Cajas, promos y dólar',
    icon: Package,
    intro: 'Cuánto te queda si vendés una caja con descuento y hasta dónde podés descontar sin perder. Y un conversor de pesos a dólares.',
  },
]
const TAB_KEYS = TABS.map((t) => t.key)
const isTab = (v: unknown): v is TabKey => typeof v === 'string' && (TAB_KEYS as string[]).includes(v)

export default function CalculadoraPage() {
  const q = useApi<CalculatorContext>('/calculator/context')
  const months = q.data?.months_used.length ? monthsText(q.data.months_used) : null
  return (
    <>
      <PageHeader
        title="Calculadora"
        description="Probá precios, márgenes y escenarios antes de decidir. Todo se recalcula mientras escribís y nada se guarda (salvo que toques «Usar este precio»)."
      />
      <HelpBox id="calculadora">
        <p>
          Acá podés <b>simular sin miedo</b>: nada de lo que escribas cambia tus datos. La única excepción es el botón <b>«Usar este precio»</b>, que te pregunta antes de cambiarle el precio a un vino.
        </p>
        <p>
          {months ? (
            <>
              Los números de base (gastos fijos, precio y costo promedio, botellas por mes) salen de tus <b>últimos meses completos: {months}</b>. El mes en curso no cuenta porque está a medio terminar y
              engañaría los promedios.
            </>
          ) : (
            <>
              Cuando cargues ventas y gastos, los números de base (gastos fijos, precio y costo promedio, botellas por mes) se completan solos con tus <b>últimos 3 meses completos</b>. Mientras tanto usamos
              números de ejemplo.
            </>
          )}
        </p>
        <p>
          <b>Ejemplo:</b> un Malbec te cuesta $ 6.000 y querés que te quede un 40 %. Si le sumás 40 % al costo lo vendés a $ 8.400 y, después de Ingresos Brutos (3,5 %), te queda apenas un 25 %. Para
          quedarte con 40 % tenés que venderlo a <b>$ 10.700</b>. Esa diferencia entre margen y markup es el error de precios más común.
        </p>
        <p>
          <b>¿Por qué importa?</b> Con inflación, poner precios «a ojo» es la forma más rápida de trabajar gratis. Con estas cuentas sabés cuánto te deja cada botella, cuánto tenés que vender para cubrir los
          gastos y qué pasa si algo cambia.
        </p>
      </HelpBox>
      <div className="mt-6">{q.isLoading ? <Loading label="Trayendo los números de tu negocio…" /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data ? <Calculadora ctx={q.data} /> : null}</div>
    </>
  )
}

/** Estado de una pestaña con "parche" (set({ campo: valor })) y "volver a empezar". */
function useTabState<T>(init: () => T): [T, (patch: Partial<T>) => void, () => void] {
  const [state, setState] = useState<T>(init)
  const set = useCallback((patch: Partial<T>) => setState((s) => ({ ...s, ...patch })), [])
  const reset = useCallback(() => setState(init()), [init])
  return [state, set, reset]
}

function Calculadora({ ctx }: { ctx: CalculatorContext }) {
  const [params, setParams] = useSearchParams()
  const [stored, setStored] = useLocalState<TabKey>('calculadora.tab', 'precio')
  const urlTab = params.get('tab')
  const tab: TabKey = isTab(urlTab) ? urlTab : isTab(stored) ? stored : 'precio'

  // Los valores iniciales se toman del contexto la primera vez (después, mandás vos).
  const [initCtx] = useState(ctx)
  const [precio, setPrecio, resetPrecio] = useTabState<PrecioState>(useCallback(() => defaultPrecio(initCtx), [initCtx]))
  const [ganancia, setGanancia, resetGanancia] = useTabState<GananciaState>(useCallback(() => defaultGanancia(initCtx), [initCtx]))
  const [equilibrio, setEquilibrio, resetEquilibrio] = useTabState<EquilibrioState>(useCallback(() => defaultEquilibrio(initCtx), [initCtx]))
  const [simulador, setSimulador, resetSimulador] = useTabState<SimuladorState>(useCallback(() => defaultSimulador(initCtx), [initCtx]))
  const [cajas, setCajas, resetCajas] = useTabState<CajasState>(useCallback(() => defaultCajas(initCtx), [initCtx]))

  // ?vino=ID → abre «¿A cuánto lo vendo?» con ese vino cargado (link desde otras pantallas).
  useEffect(() => {
    const id = Number(params.get('vino'))
    if (!id) return
    const p = ctx.products.find((x) => x.id === id)
    if (p) setPrecio({ productId: p.id, cost: p.unit_cost, freight: 0 })
    const next = new URLSearchParams(params)
    next.delete('vino')
    next.set('tab', 'precio')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const changeTab = (k: TabKey) => {
    setStored(k)
    if (params.get('tab')) {
      const next = new URLSearchParams(params)
      next.delete('tab')
      setParams(next, { replace: true })
    }
  }

  const current = TABS.find((t) => t.key === tab)!

  return (
    <div className="space-y-4">
      <div id="calculadora-tabs" className="scroll-mt-24">
        <Tabs items={TABS} value={tab} onChange={changeTab} />
        <p className="mt-2.5 max-w-3xl text-[14.5px] text-ink-soft">{current.intro}</p>
      </div>
      <div role="tabpanel" aria-label={current.label} className="pb-16 lg:pb-0">
        {tab === 'precio' && <PrecioTab ctx={ctx} state={precio} set={setPrecio} onReset={resetPrecio} />}
        {tab === 'ganancia' && <GananciaTab ctx={ctx} state={ganancia} set={setGanancia} onReset={resetGanancia} />}
        {tab === 'equilibrio' && <EquilibrioTab ctx={ctx} state={equilibrio} set={setEquilibrio} onReset={resetEquilibrio} />}
        {tab === 'simulador' && <SimuladorTab ctx={ctx} state={simulador} set={setSimulador} onReset={resetSimulador} />}
        {tab === 'cajas' && <CajasTab ctx={ctx} state={cajas} set={setCajas} onReset={resetCajas} />}
      </div>
    </div>
  )
}
