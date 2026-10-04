// Formatos argentinos: $ 1.234.567,89 · 12,5 % · 31/01/2026

const moneyFmt0 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0, minimumFractionDigits: 0 })
const moneyFmt2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2, minimumFractionDigits: 2 })
const usdFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const numFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const intFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

/**
 * Plata en pesos. Muestra centavos solo si los hay (o si decimals = 2).
 * money(1234567) → "$ 1.234.567"
 */
export function money(n: number | null | undefined, opts: { decimals?: 0 | 2 | 'auto'; sign?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const decimals = opts.decimals ?? 'auto'
  const useCents = decimals === 2 || (decimals === 'auto' && Math.abs(n % 1) > 0.004)
  const fmt = useCents ? moneyFmt2 : moneyFmt0
  // Espacio duro entre "$" y el número: nunca se cortan en dos renglones.
  const abs = fmt.format(Math.abs(n)).replace(/\s/g, '\u00a0')
  // Negativos como "−$ 1.234" (signo menos tipográfico). Si redondeado da 0, sin signo.
  if (n < 0 && fmt.format(Math.abs(n)) !== fmt.format(0)) return `−${abs}`
  return opts.sign && n > 0 ? `+${abs}` : abs
}

/** Plata abreviada para gráficos y números grandes: "$ 1,2 M", "$ 350 mil". */
export function moneyCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  const NB = '\u00a0'
  if (abs >= 1_000_000_000) return `${sign}$${NB}${numFmt.format(Math.round(abs / 100_000_000) / 10)}${NB}mil${NB}M`
  if (abs >= 1_000_000) return `${sign}$${NB}${numFmt.format(Math.round(abs / 100_000) / 10)}${NB}M`
  if (abs >= 10_000) return `${sign}$${NB}${intFmt.format(Math.round(abs / 1000))}${NB}mil`
  return `${sign}$${NB}${intFmt.format(Math.round(abs))}`
}

export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return usdFmt.format(n).replace(/ /g, ' ')
}

export function num(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: decimals }).format(n)
}

export function int(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return intFmt.format(n)
}

/** 0.123 → "12,3 %" */
export function pct(ratio: number | null | undefined, decimals = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(ratio * 100)} %`
}

/** Variación con signo: 0.12 → "+12 %", −0.05 → "−5 %" */
export function pctDelta(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  const v = Math.round(ratio * 1000) / 10
  const s = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Math.abs(v))
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s} %`
}

export function bottles(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${intFmt.format(n)} ${Math.abs(n) === 1 ? 'botella' : 'botellas'}`
}

/** "37 botellas = 6 cajas y 1 botella" (cajas de 6 por defecto). */
export function boxes(n: number, perBox = 6): string {
  if (!perBox || perBox <= 1 || Math.abs(n) < perBox) return bottles(n)
  const b = Math.trunc(n / perBox)
  const r = n - b * perBox
  return `${b} ${b === 1 ? 'caja' : 'cajas'}${r ? ` y ${bottles(r)}` : ''}`
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** '2026-01-31' → '31/01/2026' */
export function date(s: string | null | undefined): string {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** '2026-01-31' → '31 ene' (o '31 ene 25' si no es de este año) */
export function dateShort(s: string | null | undefined): string {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  const thisYear = new Date().getFullYear()
  return `${d} ${MONTHS[m - 1]}${y !== thisYear ? ` ${String(y).slice(2)}` : ''}`
}

/** '2026-01-31' → 'sábado 31 de enero de 2026' */
export function dateLong(s: string | null | undefined): string {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${DAYS[dt.getDay()]} ${d} de ${MONTHS_LONG[m - 1]} de ${y}`
}

/** 'YYYY-MM' → 'enero 2026' */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS_LONG[m - 1]} ${y}`
}

/** Días desde/hasta hoy en palabras: "hoy", "ayer", "hace 5 días", "en 3 días". */
export function relativeDays(s: string | null | undefined): string {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  const target = new Date(y, m - 1, d).getTime()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.round((target - today) / 86_400_000)
  if (diff === 0) return 'hoy'
  if (diff === -1) return 'ayer'
  if (diff === 1) return 'mañana'
  if (diff < 0) return `hace ${-diff} días`
  return `en ${diff} días`
}

/** Convierte lo que escribe la gente ("1.234,50", "1234.5", "$ 2.000") en número. */
export function parseNumber(input: string): number | null {
  if (input == null) return null
  let s = String(input).trim().replace(/[$\s]/g, '').replace(/[^\d,.\-]/g, '')
  if (!s || s === '-' || s === ',' || s === '.') return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // El último separador es el decimal.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (lastComma > -1) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > -1) {
    // "1.234" en Argentina es mil doscientos treinta y cuatro; "12.5" es doce coma cinco.
    const parts = s.split('.')
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
