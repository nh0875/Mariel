// Período elegido (este mes, mes pasado, etc.). Se comparte entre Inicio, Reportes, Ventas, Gastos…
// y se recuerda entre sesiones, así no hay que elegirlo cada vez.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { PERIOD_PRESET_LABELS, presetToPeriod, type Period, type PeriodPreset } from '@shared/dates'
import { date } from './format'

interface PeriodState {
  preset: PeriodPreset
  period: Period
  /** Texto para mostrar: "Este mes" o "01/03/2026 – 15/03/2026". */
  label: string
  setPreset: (p: PeriodPreset) => void
  setCustom: (from: string, to: string) => void
}

const Ctx = createContext<PeriodState | null>(null)
const STORAGE_KEY = 'vinoh.period'

function load(): { preset: PeriodPreset; custom?: Period } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* sin localStorage */
  }
  return { preset: 'este_mes' }
}

function save(v: { preset: PeriodPreset; custom?: Period }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  } catch {
    /* sin localStorage */
  }
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(load)
  const setPreset = useCallback((preset: PeriodPreset) => {
    const v = { preset }
    save(v)
    setState(v)
  }, [])
  const setCustom = useCallback((from: string, to: string) => {
    const v = { preset: 'personalizado' as const, custom: from <= to ? { from, to } : { from: to, to: from } }
    save(v)
    setState(v)
  }, [])
  const value = useMemo<PeriodState>(() => {
    const period = state.preset === 'personalizado' && state.custom ? state.custom : presetToPeriod(state.preset)
    const label = state.preset === 'personalizado' ? `${date(period.from)} – ${date(period.to)}` : PERIOD_PRESET_LABELS[state.preset]
    return { preset: state.preset, period, label, setPreset, setCustom }
  }, [state, setPreset, setCustom])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePeriod(): PeriodState {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePeriod fuera de PeriodProvider')
  return v
}
