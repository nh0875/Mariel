// Período elegido (este mes, mes pasado, etc.). Se comparte entre Inicio, Reportes, Ventas, Gastos…
// y se recuerda entre sesiones, así no hay que elegirlo cada vez.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PERIOD_PRESET_LABELS, presetToPeriod, today, type Period, type PeriodPreset } from '@shared/dates'
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

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Lo guardado en el navegador, revisado: si está roto (ej. "null" o un preset viejo), arranca en «Este mes». */
export function parseStoredPeriod(raw: string | null): { preset: PeriodPreset; custom?: Period } {
  const fallback = { preset: 'este_mes' as PeriodPreset }
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw) as { preset?: unknown; custom?: { from?: unknown; to?: unknown } } | null
    if (!v || typeof v !== 'object' || typeof v.preset !== 'string' || !(v.preset in PERIOD_PRESET_LABELS)) return fallback
    const preset = v.preset as PeriodPreset
    if (preset === 'personalizado') {
      const c = v.custom
      if (!c || typeof c.from !== 'string' || typeof c.to !== 'string' || !ISO.test(c.from) || !ISO.test(c.to)) return fallback
      return { preset, custom: { from: c.from, to: c.to } }
    }
    return { preset }
  } catch {
    return fallback
  }
}

function load(): { preset: PeriodPreset; custom?: Period } {
  try {
    return parseStoredPeriod(localStorage.getItem(STORAGE_KEY))
  } catch {
    /* sin localStorage */
    return { preset: 'este_mes' }
  }
}

/**
 * El día de hoy, que se actualiza solo si la pestaña queda abierta de un día para otro (cada minuto,
 * y al volver a la pestaña). Así «Este mes» pasa a ser el mes nuevo sin tener que recargar.
 */
export function useToday(): string {
  const [day, setDay] = useState(today)
  useEffect(() => {
    const check = () => setDay((d) => (d === today() ? d : today()))
    const timer = window.setInterval(check, 60_000)
    const onVisible = () => document.visibilityState === 'visible' && check()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return day
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
  const day = useToday()
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
    // `day` en las dependencias: si cambia el día, los presets («Este mes», «Últimos 30 días»…) se recalculan.
    const period = state.preset === 'personalizado' && state.custom ? state.custom : presetToPeriod(state.preset, day)
    const label = state.preset === 'personalizado' ? `${date(period.from)} – ${date(period.to)}` : PERIOD_PRESET_LABELS[state.preset]
    return { preset: state.preset, period, label, setPreset, setCustom }
  }, [state, setPreset, setCustom, day])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePeriod(): PeriodState {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePeriod fuera de PeriodProvider')
  return v
}
