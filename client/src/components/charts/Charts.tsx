// Gráficos con el estilo de VINOH!: barras finas con punta redondeada, líneas de 2px,
// grilla suave, montos abreviados en el eje y tooltip con el valor exacto.
// Colores fijos por concepto (ventas = azul, gastos = coral, costo = mostaza, ganancia = verde azulado).
import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'
import { CHART_SERIES } from '@shared/constants'
import { money, moneyCompact, pct } from '@/lib/format'

export interface Series {
  key: string
  label: string
  color: string
}

const AXIS = { stroke: '#dccdbd', fontSize: 12, fill: '#948172' }
const GRID = '#efe6db'

type ValueFormat = 'money' | 'number' | 'percent'
const fmt = (v: number, f: ValueFormat) => (f === 'money' ? money(v) : f === 'percent' ? pct(v) : new Intl.NumberFormat('es-AR').format(v))
const fmtAxis = (v: number, f: ValueFormat) => (f === 'money' ? moneyCompact(v) : f === 'percent' ? pct(v, 0) : new Intl.NumberFormat('es-AR', { notation: 'compact' }).format(v))

function TooltipBox({ active, payload, label, format, labelFormatter }: TooltipProps<number, string> & { format: ValueFormat; labelFormatter?: (l: string) => ReactNode }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2 text-[13px] shadow-[var(--shadow-pop)]">
      <p className="mb-1 font-extrabold text-ink">{labelFormatter ? labelFormatter(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-ink-soft">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: (p.color as string) || (p.payload?.fill as string) }} aria-hidden />
          <span className="flex-1">{p.name}</span>
          <b className="vh-num text-ink">{fmt(Number(p.value), format)}</b>
        </p>
      ))}
    </div>
  )
}

/**
 * Columnas agrupadas (ej: ventas vs. gastos por mes).
 * data: [{ label: 'ene 26', ventas: 123, gastos: 45 }, …]
 */
export function ColumnChart({
  data,
  series,
  xKey = 'label',
  height = 260,
  format = 'money',
  stacked,
  zeroLine,
}: {
  data: Record<string, unknown>[]
  series: Series[]
  xKey?: string
  height?: number
  format?: ValueFormat
  stacked?: boolean
  zeroLine?: boolean
}) {
  const barSize = Math.max(6, Math.min(24, Math.floor(560 / Math.max(1, data.length * (stacked ? 1 : series.length)) - 6)))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: AXIS.stroke }} tick={{ fontSize: AXIS.fontSize, fill: AXIS.fill }} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: AXIS.fontSize, fill: AXIS.fill }} tickFormatter={(v) => fmtAxis(v, format)} width={80} />
        <Tooltip cursor={{ fill: 'rgba(59,36,20,0.05)' }} content={<TooltipBox format={format} />} />
        {zeroLine && <ReferenceLine y={0} stroke="#c3b3a2" />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color}
            barSize={barSize}
            stackId={stacked ? 'a' : undefined}
            radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]}
            stroke={stacked ? '#ffffff' : undefined}
            strokeWidth={stacked ? 2 : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/**
 * Columnas de un valor que puede ser positivo o negativo (ej: resultado por mes):
 * verde azulado si ganaste, coral si perdiste.
 */
export function ResultChart({ data, valueKey, xKey = 'label', label = 'Resultado', height = 240 }: { data: Record<string, unknown>[]; valueKey: string; xKey?: string; label?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fontSize: AXIS.fontSize, fill: AXIS.fill }} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: AXIS.fontSize, fill: AXIS.fill }} tickFormatter={(v) => fmtAxis(v, 'money')} width={80} />
        <Tooltip cursor={{ fill: 'rgba(59,36,20,0.05)' }} content={<TooltipBox format="money" />} />
        <ReferenceLine y={0} stroke="#b9a693" />
        <Bar dataKey={valueKey} name={label} barSize={22} radius={[4, 4, 4, 4]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={Number(d[valueKey]) >= 0 ? '#2F9E8F' : '#E8605E'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Líneas (ej: evolución de caja). area=true agrega un relleno suave. */
export function TrendChart({
  data,
  series,
  xKey = 'label',
  height = 260,
  format = 'money',
  area,
  zeroLine,
}: {
  data: Record<string, unknown>[]
  series: Series[]
  xKey?: string
  height?: number
  format?: ValueFormat
  area?: boolean
  zeroLine?: boolean
}) {
  const common = (
    <>
      <CartesianGrid vertical={false} stroke={GRID} />
      <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: AXIS.stroke }} tick={{ fontSize: AXIS.fontSize, fill: AXIS.fill }} interval="preserveStartEnd" minTickGap={16} />
      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: AXIS.fontSize, fill: AXIS.fill }} tickFormatter={(v) => fmtAxis(v, format)} width={80} />
      <Tooltip content={<TooltipBox format={format} />} cursor={{ stroke: '#c3b3a2', strokeWidth: 1 }} />
      {zeroLine && <ReferenceLine y={0} stroke="#b9a693" />}
    </>
  )
  return (
    <ResponsiveContainer width="100%" height={height}>
      {area ? (
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          {common}
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.1} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
          ))}
        </AreaChart>
      ) : (
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          {common}
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  )
}

/**
 * Torta/dona para "partes de un todo" (máx. 6 porciones; el resto se agrupa en "Otros").
 * Muestra al lado la lista con montos y %.
 */
export function DonutChart({ data, height = 220, format = 'money' }: { data: { label: string; value: number }[]; height?: number; format?: ValueFormat }) {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, 5)
  const rest = sorted.slice(5).reduce((s, d) => s + d.value, 0)
  const slices = rest > 0 ? [...top, { label: 'Otros', value: rest }] : top
  const total = slices.reduce((s, d) => s + d.value, 0)
  if (!slices.length) return <p className="py-10 text-center text-sm text-muted">Sin datos en este período.</p>
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-[200px] w-[200px] shrink-0" style={{ height: Math.min(height, 220) }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="95%" paddingAngle={1.5} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
              {slices.map((_, i) => (
                <Cell key={i} fill={CHART_SERIES[i % CHART_SERIES.length]} />
              ))}
            </Pie>
            <Tooltip content={<TooltipBox format={format} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-[14px]">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: CHART_SERIES[i % CHART_SERIES.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-ink">{s.label}</span>
            <span className="vh-num font-bold text-ink">{fmt(s.value, format)}</span>
            <span className="vh-num w-12 text-right text-[12.5px] text-muted">{pct(total ? s.value / total : 0, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Ranking en barras horizontales hechas con HTML (ej: vinos más vendidos).
 * Fácil de leer: nombre, barra proporcional y valor al final.
 */
export function RankBars({
  items,
  color = '#3D8FCF',
  format = 'money',
  max: maxItems = 8,
  emptyText = 'Sin datos en este período.',
}: {
  items: { label: string; value: number; sublabel?: string }[]
  color?: string
  format?: ValueFormat
  max?: number
  emptyText?: string
}) {
  const shown = items.slice(0, maxItems)
  const max = Math.max(...shown.map((i) => Math.abs(i.value)), 0)
  if (!shown.length) return <p className="py-8 text-center text-sm text-muted">{emptyText}</p>
  return (
    <ol className="space-y-3">
      {shown.map((it, idx) => (
        <li key={`${it.label}-${idx}`} className="min-w-0">
          <div className="mb-1 flex items-baseline gap-2 text-[14px]">
            <span className="w-5 shrink-0 text-right font-extrabold text-muted">{idx + 1}</span>
            <span className="min-w-0 flex-1 truncate font-semibold text-ink">
              {it.label}
              {it.sublabel && <span className="ml-1.5 text-[12.5px] font-normal text-muted">{it.sublabel}</span>}
            </span>
            <span className="vh-num shrink-0 font-bold text-ink">{fmt(it.value, format)}</span>
          </div>
          <div className="ml-7 h-2 rounded-full bg-cream-deep">
            <div className="h-full rounded-full" style={{ width: `${max ? Math.max(2, (Math.abs(it.value) / max) * 100) : 0}%`, background: it.value < 0 ? '#E8605E' : color }} />
          </div>
        </li>
      ))}
    </ol>
  )
}
