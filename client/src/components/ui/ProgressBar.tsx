import clsx from 'clsx'
import { pct } from '@/lib/format'

/**
 * Barra de avance (ej: meta de ventas). value/max.
 * mode="goal": verde al llegar; mode="budget": se pone roja si te pasás.
 */
export function ProgressBar({
  value,
  max,
  mode = 'goal',
  showLabel = true,
  className,
}: {
  value: number
  max: number
  mode?: 'goal' | 'budget'
  showLabel?: boolean
  className?: string
}) {
  const ratio = max > 0 ? value / max : 0
  const width = Math.max(0, Math.min(ratio, 1)) * 100
  const color =
    mode === 'goal'
      ? ratio >= 1
        ? 'bg-good'
        : ratio >= 0.6
          ? 'bg-sky-deep'
          : 'bg-orange'
      : ratio > 1
        ? 'bg-bad'
        : ratio > 0.85
          ? 'bg-orange'
          : 'bg-good'
  return (
    <div className={clsx('flex items-center gap-3', className)}>
      <div
        className="h-3 flex-1 overflow-hidden rounded-full bg-cream-deep"
        role="progressbar"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={clsx('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${width}%` }} />
      </div>
      {showLabel && <span className="vh-num w-14 text-right text-sm font-extrabold text-ink">{max > 0 ? pct(ratio, 0) : '—'}</span>}
    </div>
  )
}
