import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import type { GlossaryKey } from '@/lib/glossary'
import { parseNumber } from '@/lib/format'
import { InfoTip } from './InfoTip'

export const inputClass =
  'h-11 w-full min-w-0 rounded-xl border border-line-strong bg-paper px-3.5 text-[15px] text-ink placeholder:text-muted/70 transition-[border,box-shadow] focus:border-brown focus:outline-none focus:ring-[3px] focus:ring-brown/15 disabled:bg-cream-deep disabled:text-muted aria-[invalid=true]:border-bad'

/** Etiqueta + campo + ayuda + error. */
export function Field({
  label,
  hint,
  error,
  required,
  info,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  /** Concepto del glosario para mostrar un "?" al lado de la etiqueta. */
  info?: GlossaryKey
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-[14px] font-bold text-ink">
          {label}
          {required && <span className="ml-0.5 text-coral-deep" aria-hidden>*</span>}
        </label>
        {info && <InfoTip term={info} />}
      </div>
      {children}
      {error ? <p className="text-[13px] font-semibold text-bad">{error}</p> : hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(inputClass, className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={clsx(inputClass, 'h-auto py-2.5 leading-snug', className)} {...rest} />
})

export function DateInput({ value, onChange, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string | null | undefined; onChange: (v: string) => void }) {
  return <input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={clsx(inputClass, 'pr-2', className)} {...rest} />
}

export interface SelectOption {
  value: string | number
  label: string
}

/** Desplegable simple. value '' = sin elegir (si hay placeholder). */
export function Select({
  options,
  value,
  onChange,
  placeholder,
  className,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  options: SelectOption[]
  value: string | number | null | undefined
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className={clsx('relative min-w-0', className)}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={clsx(inputClass, 'appearance-none pr-9')} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={String(o.value)} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={17} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-soft" aria-hidden />
    </div>
  )
}

const numberDisplay = (v: number | null | undefined, decimals: number) =>
  v == null || !Number.isFinite(v) ? '' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: decimals, useGrouping: true }).format(v)

/**
 * Campo numérico que entiende cómo escribimos en Argentina: "1.234,50".
 * Devuelve number (o null si está vacío).
 */
export function NumberInput({
  value,
  onChange,
  decimals = 2,
  prefix,
  suffix,
  className,
  inputClassName,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix'> & {
  value: number | null | undefined
  onChange: (v: number | null) => void
  decimals?: number
  prefix?: ReactNode
  suffix?: ReactNode
  inputClassName?: string
}) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(() => numberDisplay(value, decimals))
  useEffect(() => {
    if (!focused) setText(numberDisplay(value, decimals))
  }, [value, focused, decimals])
  return (
    <div className={clsx('relative min-w-0', className)}>
      {prefix && <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-bold text-muted">{prefix}</span>}
      <input
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onFocus={(e) => {
          setFocused(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocused(false)
          const n = parseNumber(text)
          const rounded = n == null ? null : Math.round(n * 10 ** decimals) / 10 ** decimals
          setText(numberDisplay(rounded, decimals))
          if (rounded !== value) onChange(rounded)
        }}
        onChange={(e) => {
          setText(e.target.value)
          const n = parseNumber(e.target.value)
          onChange(n == null ? null : Math.round(n * 10 ** decimals) / 10 ** decimals)
        }}
        className={clsx(inputClass, 'vh-num text-right', prefix ? 'pl-8' : '', suffix ? 'pr-12' : '', inputClassName)}
        {...rest}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm font-bold text-muted">{suffix}</span>}
    </div>
  )
}

/** Plata en pesos: $ adelante, acepta "12.500" o "12500,50". */
export function MoneyInput(props: Omit<Parameters<typeof NumberInput>[0], 'prefix' | 'decimals'>) {
  return <NumberInput prefix="$" decimals={2} placeholder="0" {...props} />
}

/** Cantidad entera (botellas, días…). */
export function IntInput(props: Omit<Parameters<typeof NumberInput>[0], 'decimals'>) {
  return <NumberInput decimals={0} {...props} />
}

export function Checkbox({ checked, onChange, label, hint, className, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; className?: string; disabled?: boolean }) {
  const id = useId()
  return (
    <label htmlFor={id} className={clsx('flex cursor-pointer items-start gap-2.5 select-none', disabled && 'cursor-not-allowed opacity-60', className)}>
      <span className="relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 cursor-pointer appearance-none rounded-md border-2 border-line-strong bg-paper checked:border-brown checked:bg-brown focus-visible:outline-2 focus-visible:outline-sky-deep" />
        <Check size={14} strokeWidth={3.2} className="pointer-events-none relative text-white opacity-0 peer-checked:opacity-100" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-semibold text-ink">{label}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
    </label>
  )
}

export function Switch({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={clsx('inline-flex items-center gap-2.5 text-[14.5px] font-semibold text-ink', className)}>
      <span className={clsx('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-good' : 'bg-line-strong')}>
        <span className={clsx('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </span>
      {label}
    </button>
  )
}

export interface ChoiceOption<V extends string> {
  value: V
  title: string
  description?: string
  icon?: LucideIcon
}

/** Opciones grandes tipo tarjeta (ej: "¿Ya lo cobraste? Sí / Todavía no"). Mejor que un radio chiquito. */
export function ChoiceCards<V extends string>({ options, value, onChange, className, columns = 2 }: { options: ChoiceOption<V>[]; value: V; onChange: (v: V) => void; className?: string; columns?: 2 | 3 | 4 }) {
  return (
    <div role="radiogroup" className={clsx('grid gap-2', columns === 2 ? 'sm:grid-cols-2' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4', className)}>
      {options.map((o) => {
        const active = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              'flex items-start gap-2.5 rounded-xl border-2 px-3.5 py-3 text-left transition-colors',
              active ? 'border-brown bg-paper shadow-[0_2px_0_0_var(--color-brown)]' : 'border-line bg-paper/60 hover:border-line-strong',
            )}
          >
            {Icon && <Icon size={19} className={clsx('mt-0.5 shrink-0', active ? 'text-brown' : 'text-muted')} aria-hidden />}
            <span className="min-w-0">
              <span className="block font-extrabold text-ink">{o.title}</span>
              {o.description && <span className="block text-[13px] leading-snug text-ink-soft">{o.description}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
