import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  subtitle?: ReactNode
  /** Botones o links a la derecha del título. */
  actions?: ReactNode
  /** Sin padding interno (para tablas que van de borde a borde). */
  flush?: boolean
  children?: ReactNode
}

/** Tarjeta blanca con borde suave. La base de casi todo. */
export function Card({ title, subtitle, actions, flush, className, children, ...rest }: CardProps) {
  return (
    <section className={clsx('vh-card min-w-0', className)} {...rest}>
      {(title || actions) && (
        <header className={clsx('flex flex-wrap items-start justify-between gap-3', flush ? 'px-5 pt-5 pb-3' : 'px-5 pt-5')}>
          <div className="min-w-0">
            {title && <h3 className="text-[17px] leading-tight font-extrabold text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(!flush && 'p-5', !flush && (title || actions) && 'pt-4')}>{children}</div>
    </section>
  )
}
