import clsx from 'clsx'
import { money } from '@/lib/format'

/**
 * Muestra plata formateada. tone="auto" pinta en verde lo positivo y en rojo lo negativo
 * (usalo solo para resultados/saldos, no para ventas o gastos comunes).
 */
export function Money({
  value,
  tone,
  sign,
  decimals,
  className,
}: {
  value: number | null | undefined
  tone?: 'auto' | 'none'
  sign?: boolean
  decimals?: 0 | 2 | 'auto'
  className?: string
}) {
  const color = tone === 'auto' && value != null ? (value < -0.004 ? 'text-bad' : value > 0.004 ? 'text-good' : '') : ''
  return <span className={clsx('vh-num whitespace-nowrap', color, className)}>{money(value, { sign, decimals })}</span>
}
