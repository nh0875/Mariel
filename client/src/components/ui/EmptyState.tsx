import type { ReactNode } from 'react'
import { Wine, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'

/** Pantalla vacía: en vez de "no hay datos", invita a hacer algo. */
export function EmptyState({
  icon: Icon = Wine,
  title,
  children,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={clsx('flex flex-col items-center text-center', compact ? 'gap-2 py-8' : 'gap-3 py-14', className)}>
      <div className="relative grid h-16 w-16 place-items-center" aria-hidden>
        <span className="absolute inset-0 rotate-6 rounded-[40%] bg-mustard/45 mix-blend-multiply" />
        <span className="absolute inset-1 -rotate-12 rounded-[45%] bg-coral/35 mix-blend-multiply" />
        <Icon size={28} className="relative text-ink" strokeWidth={2} />
      </div>
      <p className="font-display text-2xl text-ink">{title}</p>
      {children && <div className="max-w-md text-[14.5px] text-ink-soft">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
