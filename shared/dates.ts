// Ayudas para fechas. Todo se maneja como texto 'YYYY-MM-DD' en hora local,
// así no hay sorpresas de zona horaria (una venta del 31/12 a las 23 h es del 31/12).

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const MONTHS_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

const pad = (n: number) => String(n).padStart(2, '0')

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function today(): string {
  return toISODate(new Date())
}

/** 'YYYY-MM-DD' → Date local a medianoche. */
export function parseISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(s: string, days: number): string {
  const d = parseISODate(s)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export function addMonths(s: string, months: number): string {
  const d = parseISODate(s)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toISODate(d)
}

export function monthKey(s: string): string {
  return s.slice(0, 7)
}

export function startOfMonth(s: string): string {
  return `${s.slice(0, 7)}-01`
}

export function endOfMonth(s: string): string {
  const d = parseISODate(startOfMonth(s))
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

export function startOfYear(s: string): string {
  return `${s.slice(0, 4)}-01-01`
}

export function endOfYear(s: string): string {
  return `${s.slice(0, 4)}-12-31`
}

/** Lista de meses 'YYYY-MM' entre dos fechas (inclusive). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let cur = startOfMonth(from)
  const last = monthKey(to)
  let guard = 0
  while (monthKey(cur) <= last && guard++ < 600) {
    out.push(monthKey(cur))
    cur = addMonths(cur, 1)
  }
  return out
}

/** 'YYYY-MM' → 'ene 26' */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`
}

/** 'YYYY-MM' → 'enero 2026' */
export function monthLabelLong(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS_LONG[m - 1]} ${y}`
}

/** Cantidad de días entre dos fechas (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000)
}

export type PeriodPreset =
  | 'este_mes'
  | 'mes_pasado'
  | 'ultimos_3_meses'
  | 'ultimos_6_meses'
  | 'este_anio'
  | 'anio_pasado'
  | 'ultimos_12_meses'
  | 'todo'
  | 'personalizado'

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  este_mes: 'Este mes',
  mes_pasado: 'Mes pasado',
  ultimos_3_meses: 'Últimos 3 meses',
  ultimos_6_meses: 'Últimos 6 meses',
  este_anio: 'Este año',
  anio_pasado: 'Año pasado',
  ultimos_12_meses: 'Últimos 12 meses',
  todo: 'Desde siempre',
  personalizado: 'Elegir fechas…',
}

export interface Period {
  from: string
  to: string
}

export function presetToPeriod(preset: PeriodPreset, ref: string = today()): Period {
  switch (preset) {
    case 'este_mes':
      return { from: startOfMonth(ref), to: endOfMonth(ref) }
    case 'mes_pasado': {
      const prev = addMonths(startOfMonth(ref), -1)
      return { from: prev, to: endOfMonth(prev) }
    }
    case 'ultimos_3_meses':
      return { from: addMonths(startOfMonth(ref), -2), to: endOfMonth(ref) }
    case 'ultimos_6_meses':
      return { from: addMonths(startOfMonth(ref), -5), to: endOfMonth(ref) }
    case 'este_anio':
      return { from: startOfYear(ref), to: endOfYear(ref) }
    case 'anio_pasado': {
      const y = Number(ref.slice(0, 4)) - 1
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    }
    case 'ultimos_12_meses':
      return { from: addMonths(startOfMonth(ref), -11), to: endOfMonth(ref) }
    case 'todo':
      return { from: '2000-01-01', to: endOfYear(ref) }
    default:
      return { from: startOfMonth(ref), to: endOfMonth(ref) }
  }
}

/** El período inmediatamente anterior con la misma duración (para comparar). */
export function previousPeriod(p: Period): Period {
  // Si es un mes calendario completo, el anterior es el mes calendario anterior.
  if (p.from === startOfMonth(p.from) && p.to === endOfMonth(p.from)) {
    const prev = addMonths(p.from, -1)
    return { from: prev, to: endOfMonth(prev) }
  }
  const len = daysBetween(p.from, p.to) + 1
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) }
}
