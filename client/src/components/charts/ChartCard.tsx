import { useState, type ReactNode } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import clsx from 'clsx'
import type { GlossaryKey } from '@/lib/glossary'
import { InfoTip } from '../ui/InfoTip'

export interface ChartTable {
  columns: { key: string; header: string; align?: 'left' | 'right'; format?: (v: unknown) => ReactNode }[]
  rows: Record<string, unknown>[]
}

/**
 * Tarjeta para gráficos, con botón "Ver tabla" (los mismos datos en números,
 * para quien prefiere leer o necesita el valor exacto).
 */
export function ChartCard({
  title,
  subtitle,
  term,
  actions,
  table,
  children,
  className,
  legend,
}: {
  title: ReactNode
  subtitle?: ReactNode
  term?: GlossaryKey
  actions?: ReactNode
  table?: ChartTable
  children: ReactNode
  className?: string
  /** Leyenda arriba del gráfico (ver <Legend/>). */
  legend?: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  return (
    <section className={clsx('vh-card flex min-w-0 flex-col', className)}>
      <header className="flex items-start justify-between gap-2 px-5 pt-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[17px] leading-tight font-extrabold text-ink">{title}</h3>
            {term && <InfoTip term={term} />}
          </div>
          {subtitle && <p className="mt-0.5 text-[13.5px] text-ink-soft">{subtitle}</p>}
        </div>
        <div className="vh-no-print flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((s) => !s)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1 text-[12.5px] font-bold text-ink-soft hover:border-ink/40 hover:text-ink"
            >
              {showTable ? <BarChart3 size={14} aria-hidden /> : <Table2 size={14} aria-hidden />}
              {showTable ? 'Ver gráfico' : 'Ver tabla'}
            </button>
          )}
        </div>
      </header>
      {legend && !showTable && <div className="px-5 pt-3">{legend}</div>}
      <div className="min-w-0 flex-1 px-3 pt-3 pb-4 sm:px-4">
        {showTable && table ? (
          <div className="vh-scroll max-h-[340px] overflow-auto px-1">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line">
                  {table.columns.map((c) => (
                    <th key={c.key} className={clsx('px-2 py-2 text-[12px] font-extrabold text-ink-soft uppercase', c.align === 'right' ? 'text-right' : 'text-left')}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    {table.columns.map((c) => (
                      <td key={c.key} className={clsx('px-2 py-1.5', c.align === 'right' && 'vh-num text-right whitespace-nowrap')}>
                        {c.format ? c.format(r[c.key]) : String(r[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

/** Leyenda: punto de color + nombre (el texto nunca va pintado del color de la serie). */
export function Legend({ items, className }: { items: { label: string; color: string; dashed?: boolean }[]; className?: string }) {
  return (
    <ul className={clsx('flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold text-ink-soft', className)}>
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed ? (
            <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: i.color }} aria-hidden />
          ) : (
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} aria-hidden />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  )
}
