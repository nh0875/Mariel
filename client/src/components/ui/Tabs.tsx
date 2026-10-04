import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'

export interface TabItem<K extends string = string> {
  key: K
  label: string
  icon?: LucideIcon
  count?: number
}

/** Pestañas tipo "píldora". */
export function Tabs<K extends string>({ items, value, onChange, className }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; className?: string }) {
  return (
    <div role="tablist" className={clsx('vh-no-print vh-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1', className)}>
      {items.map((t) => {
        const active = t.key === value
        const Icon = t.icon
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={clsx(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[14px] font-bold whitespace-nowrap transition-colors',
              active ? 'border-ink bg-ink text-cream' : 'border-line-strong bg-paper text-ink-soft hover:border-ink/40 hover:text-ink',
            )}
          >
            {Icon && <Icon size={15} strokeWidth={2.3} aria-hidden />}
            {t.label}
            {t.count != null && (
              <span className={clsx('rounded-full px-1.5 text-[12px]', active ? 'bg-cream/20' : 'bg-cream-deep')}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
