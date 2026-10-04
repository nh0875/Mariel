// Gráfico de líneas propio de Reportes. Mismo estilo que TrendChart del kit, pero con los ejes,
// la grilla y el tooltip como hijos DIRECTOS del gráfico: el TrendChart del kit los envuelve en un
// Fragment y Recharts no los encuentra (queda sin ejes ni tooltip). Pedido de arreglo en el kit:
// ver el reporte del módulo. Cuando se arregle, se puede volver a usar TrendChart.
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'
import type { Series } from '@/components/charts'
import { money, moneyCompact, pct } from '@/lib/format'

const AXIS = { fontSize: 12, fill: '#948172' }
const GRID = '#efe6db'

type Fmt = 'money' | 'percent'
const fmt = (v: number, f: Fmt) => (f === 'money' ? money(Math.round(v), { decimals: 0 }) : pct(v))
const fmtAxis = (v: number, f: Fmt) => (f === 'money' ? moneyCompact(v) : pct(v, 0))

function Box({ active, payload, label, format }: TooltipProps<number, string> & { format: Fmt }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2 text-[13px] shadow-[var(--shadow-pop)]">
      <p className="mb-1 font-extrabold text-ink">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-ink-soft">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color as string }} aria-hidden />
          <span className="flex-1">{p.name}</span>
          <b className="vh-num text-ink">{p.value == null ? '—' : fmt(Number(p.value), format)}</b>
        </p>
      ))}
    </div>
  )
}

/** Líneas mes a mes (ej: márgenes, ventas con y sin inflación). */
export function LineTrend({
  data,
  series,
  xKey = 'label',
  height = 250,
  format = 'money',
  zeroLine,
}: {
  data: Record<string, unknown>[]
  series: Series[]
  xKey?: string
  height?: number
  format?: Fmt
  zeroLine?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: '#dccdbd' }} tick={AXIS} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} tick={AXIS} tickFormatter={(v) => fmtAxis(Number(v), format)} width={format === 'percent' ? 48 : 80} />
        <Tooltip content={<Box format={format} />} cursor={{ stroke: '#c3b3a2', strokeWidth: 1 }} />
        {zeroLine && <ReferenceLine y={0} stroke="#b9a693" />}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: s.color }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
