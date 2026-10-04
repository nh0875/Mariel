import type { ReactNode } from 'react'
import clsx from 'clsx'
import { CircleCheck, Clock, CircleDot, AlertTriangle } from 'lucide-react'
import type { PaymentStatus } from '@shared/constants'

type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad' | 'sky' | 'coral' | 'mustard' | 'orange'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-cream-deep text-ink-soft',
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  sky: 'bg-sky-soft text-sky-deep',
  coral: 'bg-coral-soft text-coral-deep',
  mustard: 'bg-mustard-soft text-mustard-deep',
  orange: 'bg-orange-soft text-orange-deep',
}

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: BadgeTone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-bold whitespace-nowrap', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

/**
 * Estado de cobro/pago con ícono + texto (nunca solo color).
 * kind="sale" dice "Cobrada/Por cobrar"; kind="pay" dice "Pagada/Por pagar".
 */
export function StatusBadge({ status, overdue, kind = 'pay' }: { status: PaymentStatus; overdue?: boolean; kind?: 'sale' | 'pay' }) {
  if (status === 'pagado') {
    return (
      <Badge tone="good" icon={<CircleCheck size={13} strokeWidth={2.6} aria-hidden />}>
        {kind === 'sale' ? 'Cobrada' : 'Pagada'}
      </Badge>
    )
  }
  if (overdue) {
    return (
      <Badge tone="bad" icon={<AlertTriangle size={13} strokeWidth={2.6} aria-hidden />}>
        Vencida
      </Badge>
    )
  }
  if (status === 'parcial') {
    return (
      <Badge tone="warn" icon={<CircleDot size={13} strokeWidth={2.6} aria-hidden />}>
        {kind === 'sale' ? 'Cobro parcial' : 'Pago parcial'}
      </Badge>
    )
  }
  return (
    <Badge tone="warn" icon={<Clock size={13} strokeWidth={2.6} aria-hidden />}>
      {kind === 'sale' ? 'Por cobrar' : 'Por pagar'}
    </Badge>
  )
}
