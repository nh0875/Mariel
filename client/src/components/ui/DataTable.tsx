import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import clsx from 'clsx'
import { normalize } from './Combobox'

export interface Column<T> {
  key: string
  header: ReactNode
  /** Cómo se muestra la celda. Por defecto: row[key]. */
  cell?: (row: T) => ReactNode
  /** Valor para ordenar y buscar. Por defecto: row[key]. */
  value?: (row: T) => string | number | null | undefined
  align?: 'left' | 'right' | 'center'
  /** Ocultar en pantallas chicas. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  sortable?: boolean
  /** Contenido de la fila de totales para esta columna. */
  footer?: ReactNode
  className?: string
  width?: string
}

const HIDE: Record<string, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
  '2xl': 'hidden 2xl:table-cell',
}

/**
 * Tabla con búsqueda, orden por columna (clic en el encabezado), paginado y fila de totales.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  searchable = true,
  searchPlaceholder = 'Buscar…',
  initialSort,
  pageSize = 25,
  empty,
  toolbar,
  className,
  dense,
  rowClassName,
  onFilteredRowsChange,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  onRowClick?: (row: T) => void
  searchable?: boolean
  searchPlaceholder?: string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  pageSize?: number
  /** Qué mostrar si no hay filas (idealmente un <EmptyState/>). */
  empty?: ReactNode
  /** Filtros/botones extra al lado del buscador. */
  toolbar?: ReactNode
  className?: string
  dense?: boolean
  rowClassName?: (row: T) => string | undefined
  /** Avisa qué filas quedan después de buscar (para sumar totales de lo que se ve). */
  onFilteredRowsChange?: (rows: T[]) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)

  const getValue = (c: Column<T>, r: T) => (c.value ? c.value(r) : ((r as Record<string, unknown>)[c.key] as string | number | null | undefined))

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return rows
    const words = q.split(/\s+/)
    return rows.filter((r) => {
      const hay = normalize(columns.map((c) => String(getValue(c, r) ?? '')).join(' '))
      return words.every((w) => hay.includes(w))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, columns])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = getValue(col, a)
      const vb = getValue(col, b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'es', { numeric: true }) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, columns])

  useEffect(() => {
    onFilteredRowsChange?.(filtered)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize)
  const hasFooter = columns.some((c) => c.footer !== undefined)

  const toggleSort = (c: Column<T>) => {
    if (c.sortable === false) return
    setSort((s) => (s?.key === c.key ? (s.dir === 'desc' ? { key: c.key, dir: 'asc' } : null) : { key: c.key, dir: 'desc' }))
  }

  return (
    <div className={clsx('min-w-0', className)}>
      {(searchable || toolbar) && (
        <div className="vh-no-print mb-3 flex flex-wrap items-center gap-2">
          {searchable && (
            <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(0)
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-10 w-full rounded-full border border-line-strong bg-paper pr-3 pl-9 text-[14.5px] placeholder:text-muted/70 focus:border-brown focus:ring-[3px] focus:ring-brown/15 focus:outline-none"
              />
            </label>
          )}
          {toolbar}
        </div>
      )}
      {rows.length === 0 && empty ? (
        empty
      ) : (
        <div className="vh-scroll overflow-x-auto rounded-2xl border border-line bg-paper">
          <table className="w-full border-collapse text-[14.5px]">
            <thead>
              <tr className="border-b border-line bg-cream/70">
                {columns.map((c) => {
                  const active = sort?.key === c.key
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      style={{ width: c.width }}
                      className={clsx(
                        'px-3.5 py-2.5 text-[12.5px] font-extrabold tracking-wide whitespace-nowrap text-ink-soft uppercase',
                        c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                        c.hideBelow && HIDE[c.hideBelow],
                        c.className,
                      )}
                      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {c.sortable === false ? (
                        c.header
                      ) : (
                        <button type="button" onClick={() => toggleSort(c)} className={clsx('inline-flex items-center gap-1 uppercase hover:text-ink', active && 'text-ink')}>
                          {c.header}
                          {active && (sort!.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
                        </button>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
                  className={clsx('border-b border-line/70 last:border-0', onRowClick && 'cursor-pointer hover:bg-cream focus-visible:bg-cream', rowClassName?.(r))}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={clsx(
                        dense ? 'px-3.5 py-2' : 'px-3.5 py-3',
                        'align-middle',
                        c.align === 'right' ? 'vh-num text-right whitespace-nowrap' : c.align === 'center' ? 'text-center' : 'text-left',
                        c.hideBelow && HIDE[c.hideBelow],
                        c.className,
                      )}
                    >
                      {c.cell ? c.cell(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-10 text-center text-ink-soft">
                    {query ? `No hay resultados para «${query}».` : 'No hay nada para mostrar.'}
                  </td>
                </tr>
              )}
            </tbody>
            {hasFooter && visible.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line-strong bg-cream/70 font-extrabold">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={clsx('px-3.5 py-3', c.align === 'right' ? 'vh-num text-right whitespace-nowrap' : 'text-left', c.hideBelow && HIDE[c.hideBelow])}
                    >
                      {c.footer}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="vh-no-print mt-3 flex items-center justify-between gap-2 text-sm text-ink-soft">
          <span>
            {current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} de {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-cream-deep disabled:opacity-40" aria-label="Página anterior">
              <ChevronLeft size={18} />
            </button>
            <span className="px-1 font-bold text-ink">
              {current + 1} / {pages}
            </span>
            <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-cream-deep disabled:opacity-40" aria-label="Página siguiente">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
