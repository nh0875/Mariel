import { CalendarRange } from 'lucide-react'
import clsx from 'clsx'
import { PERIOD_PRESET_LABELS, type PeriodPreset } from '@shared/dates'
import { usePeriod } from '@/lib/period'
import { DateInput, Select } from './Field'

const PRESETS: PeriodPreset[] = ['este_mes', 'mes_pasado', 'ultimos_3_meses', 'ultimos_6_meses', 'este_anio', 'anio_pasado', 'ultimos_12_meses', 'todo', 'personalizado']

/**
 * Selector de período ("Este mes", "Mes pasado", "Elegir fechas…").
 * Comparte el período con todas las pantallas (si lo cambiás en Inicio, Reportes lo recuerda).
 */
export function PeriodPicker({ className, presets = PRESETS }: { className?: string; presets?: PeriodPreset[] }) {
  const { preset, period, setPreset, setCustom } = usePeriod()
  return (
    <div className={clsx('vh-no-print flex flex-wrap items-center gap-2', className)}>
      <span className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-ink-soft">
        <CalendarRange size={16} aria-hidden /> Período
      </span>
      <Select
        aria-label="Período"
        className="w-[190px]"
        value={preset}
        onChange={(v) => {
          if (v === 'personalizado') setCustom(period.from, period.to)
          else setPreset(v as PeriodPreset)
        }}
        options={presets.map((p) => ({ value: p, label: PERIOD_PRESET_LABELS[p] }))}
      />
      {preset === 'personalizado' && (
        <div className="flex items-center gap-1.5">
          <DateInput aria-label="Desde" className="w-[150px]" value={period.from} onChange={(v) => v && setCustom(v, period.to)} />
          <span className="text-muted">a</span>
          <DateInput aria-label="Hasta" className="w-[150px]" value={period.to} onChange={(v) => v && setCustom(period.from, v)} />
        </div>
      )}
    </div>
  )
}
