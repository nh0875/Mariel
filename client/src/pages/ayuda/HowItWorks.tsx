// "Cómo calcula el sistema": el modelo contable explicado con un mes de ejemplo, con números.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, Calculator, Coins, PackageOpen, Scale, Truck } from 'lucide-react'
import { CHART_COLORS } from '@shared/constants'
import type { GlossaryKey } from '@/lib/glossary'
import { money, pct } from '@/lib/format'
import { InfoTip } from '@/components/ui'

interface CascadeRow {
  label: string
  value: number
  term: GlossaryKey
  color: string
  note: string
  kind: 'base' | 'minus' | 'subtotal' | 'total'
}

// Un mes de ejemplo (redondo para que se pueda seguir con la cabeza).
const SALES = 3_000_000
const COGS = 1_800_000
const FEES = 90_000
const SHRINK = 36_000
const EXPENSES = 850_000
const GROSS = SALES - COGS
const RESULT = GROSS - FEES - SHRINK - EXPENSES

const ROWS: CascadeRow[] = [
  { label: 'Ventas', value: SALES, term: 'ventas', color: CHART_COLORS.ventas, kind: 'base', note: '250 botellas a $ 12.000 en promedio (con descuentos y envíos cobrados).' },
  { label: '− Costo de lo vendido (CMV)', value: COGS, term: 'cmv', color: CHART_COLORS.costo, kind: 'minus', note: 'Esas 250 botellas a su costo promedio: $ 7.200 cada una.' },
  { label: '= Ganancia bruta', value: GROSS, term: 'ganancia_bruta', color: CHART_COLORS.ganancia, kind: 'subtotal', note: `Margen bruto ${pct(GROSS / SALES, 0)}: de cada $ 100 vendidos, $ 40 quedan para todo lo demás.` },
  { label: '− Comisiones de cobro', value: FEES, term: 'comisiones', color: CHART_COLORS.gastos, kind: 'minus', note: 'Lo que se quedaron Mercado Pago y las tarjetas.' },
  { label: '− Mermas, degustaciones y regalos', value: SHRINK, term: 'mermas', color: CHART_COLORS.gastos, kind: 'minus', note: '5 botellas (2 rotas y 3 abiertas para degustar) a $ 7.200.' },
  { label: '− Gastos', value: EXPENSES, term: 'gastos', color: CHART_COLORS.gastos, kind: 'minus', note: 'Alquiler, sueldos, envíos, packaging, contador…' },
  { label: '= Resultado del mes', value: RESULT, term: 'resultado', color: CHART_COLORS.ganancia, kind: 'total', note: `Margen neto ${pct(RESULT / SALES, 1)}: de cada $ 100 vendidos, ganaste ${money(Math.round((RESULT / SALES) * 10000) / 100)}.` },
]

function Cascade() {
  return (
    <ol className="space-y-2.5">
      {ROWS.map((r) => (
        <li key={r.label} className={r.kind === 'subtotal' || r.kind === 'total' ? 'rounded-xl bg-cream-deep/60 px-3 py-2.5' : 'px-3'}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className={`inline-flex items-center gap-1.5 ${r.kind === 'total' ? 'text-[16px] font-extrabold' : 'font-bold'} text-ink`}>
              {r.label}
              <InfoTip term={r.term} />
            </span>
            <span className={`vh-num ml-auto ${r.kind === 'total' ? 'text-[18px]' : 'text-[15.5px]'} font-extrabold text-ink`}>{money(r.value)}</span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-cream-deep" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${(r.value / SALES) * 100}%`, background: r.color, opacity: r.kind === 'minus' ? 0.85 : 1 }} />
          </div>
          <p className="mt-1 text-[13px] text-muted">{r.note}</p>
        </li>
      ))}
    </ol>
  )
}

function Idea({ icon: Icon, title, term, children }: { icon: typeof Calculator; title: string; term?: GlossaryKey; children: ReactNode }) {
  return (
    <div className="vh-card p-5">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mustard-soft text-mustard-deep" aria-hidden>
          <Icon size={18} />
        </span>
        <h3 className="text-[16.5px] leading-tight font-extrabold text-ink">{title}</h3>
        {term && <InfoTip term={term} />}
      </div>
      <div className="space-y-2 text-[14.5px] leading-relaxed text-ink-soft [&_b]:text-ink">{children}</div>
    </div>
  )
}

const BRIDGE: [string, string, string][] = [
  ['Le vendiste $ 400.000 a un restó que te paga el mes que viene', '+ $ 400.000', 'cuando te pague'],
  ['Compraste vino por $ 1.500.000 para reponer', '$ 0 (es stock)', '− $ 1.500.000'],
  ['Vendiste botellas que ya habías pagado antes', '− su costo (CMV)', '$ 0'],
  ['Te llevaste $ 200.000 (retiro)', '$ 0', '− $ 200.000'],
  ['Te pagaron $ 350.000 de ventas del mes pasado', '$ 0 (ya contó)', '+ $ 350.000'],
]

const Mini = ({ rows }: { rows: [string, string][] }) => (
  <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-xl bg-cream/80 px-3 py-2 text-[13.5px]">
    {rows.map(([k, v]) => (
      <div key={k} className="contents">
        <dt className="text-ink-soft">{k}</dt>
        <dd className="vh-num text-right font-bold text-ink">{v}</dd>
      </div>
    ))}
  </dl>
)

export function HowItWorks() {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="vh-card p-5">
          <h3 className="text-[17px] font-extrabold text-ink">La cuenta del resultado, con un mes de ejemplo</h3>
          <p className="mt-1 mb-4 text-[14px] text-ink-soft">Así arma el sistema el número más importante (el mismo que ves en Inicio y en Reportes). Las barras muestran cuánto es cada cosa al lado de las ventas.</p>
          <Cascade />
        </div>
        <div className="space-y-5">
          <Idea icon={Scale} title="Resultado vs. caja: por qué no coinciden" term="devengado_percibido">
            <p>
              El <b>resultado</b> cuenta lo que vendiste y gastaste en el mes, se haya cobrado o no («devengado»). La <b>caja</b> cuenta la plata que efectivamente entró y salió («percibido»).
            </p>
            <p>Algunos movimientos del mes y cómo los ve cada uno:</p>
            <div className="vh-scroll overflow-x-auto rounded-xl bg-cream/80">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-left text-[12px] font-extrabold tracking-wide text-ink-soft uppercase">
                    <th className="px-3 pt-2 pb-1 font-extrabold">Pasó esto</th>
                    <th className="px-2 pt-2 pb-1 text-right font-extrabold">Resultado</th>
                    <th className="px-3 pt-2 pb-1 text-right font-extrabold">Caja</th>
                  </tr>
                </thead>
                <tbody className="vh-num">
                  {BRIDGE.map(([what, res, cash]) => (
                    <tr key={what} className="border-t border-line/70 align-top">
                      <td className="px-3 py-1.5 text-ink-soft">{what}</td>
                      <td className="px-2 py-1.5 text-right font-bold whitespace-nowrap text-ink">{res}</td>
                      <td className="px-3 py-1.5 text-right font-bold whitespace-nowrap text-ink">{cash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Ganaste {money(RESULT)}, pero la caja puede haber bajado. Está bien: <b>el resultado dice si el negocio es bueno; la caja, si podés pagar las cuentas</b>. Mirá los dos.
            </p>
          </Idea>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Idea icon={Coins} title="Costo promedio" term="costo_promedio">
          <p>Cada botella vale el promedio de lo que pagaste por ella:</p>
          <Mini
            rows={[
              ['10 botellas a $ 1.000', money(10_000)],
              ['+ 10 botellas a $ 1.400', money(14_000)],
              ['= 20 botellas, cada una a', money(1_200)],
            ]}
          />
          <p>
            Si vendés 5, el CMV es 5 × $ 1.200 = <b>$ 6.000</b>. Si cargás una compra con fecha vieja o corregís algo, el sistema recalcula toda la historia del vino en orden: los números siempre cierran.
          </p>
        </Idea>
        <Idea icon={Truck} title="El flete va al costo" term="flete_prorrateado">
          <p>El flete de una compra se reparte entre las botellas, según el precio de cada una:</p>
          <Mini
            rows={[
              ['Vino según factura', money(40_000)],
              ['Flete', money(4_000)],
              ['Botella de $ 8.000 queda en', money(8_800)],
            ]}
          />
          <p>Así el costo es el real (lo que te costó tener la botella en tu depósito) y el margen no te miente.</p>
        </Idea>
        <Idea icon={PackageOpen} title="Comprar vino no es un gasto" term="stock_valorizado">
          <p>
            Si comprás 60 botellas por $ 480.000, la plata sale de la caja, pero <b>las botellas siguen siendo tuyas</b>: es stock, plata «guardada» en el depósito.
          </p>
          <p>
            Se convierte en costo recién cuando las vendés (CMV) o si se rompen, se regalan o se abren para degustar (mermas). Por eso un mes de mucha compra no aparece como un mes de pérdida.
          </p>
        </Idea>
        <Idea icon={Calculator} title="Todo en pesos y con impuestos" term="iva">
          <p>
            Los montos se cargan <b>finales</b>, como salen en el ticket o la factura. Es la plata que realmente se mueve, y así la caja cierra con el banco.
          </p>
          <p>
            El dólar es solo de referencia (se configura en <Link to="/configuracion#dolar" className="font-bold text-sky-deep hover:underline">Configuración</Link>), y la inflación se usa en Reportes para comparar meses «a pesos de hoy».
          </p>
        </Idea>
      </div>
      <p className="flex items-center gap-2 text-[13.5px] text-muted">
        <ArrowDown size={15} aria-hidden /> Cada concepto tiene su explicación completa en el diccionario de abajo.
      </p>
    </div>
  )
}
