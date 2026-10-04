import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import { Spinner } from './Feedback'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
  children?: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brown text-white hover:bg-brown-deep shadow-[0_2px_0_0_var(--color-brown-deep)] active:translate-y-px active:shadow-none',
  secondary: 'bg-paper text-ink border border-line-strong hover:border-brown/50 hover:bg-cream',
  ghost: 'bg-transparent text-ink-soft hover:bg-cream-deep hover:text-ink',
  danger: 'bg-bad text-white hover:bg-[#a52a2a] shadow-[0_2px_0_0_#8f2323] active:translate-y-px active:shadow-none',
  soft: 'bg-mustard-soft text-ink hover:bg-mustard/40',
}
const SIZES: Record<Size, string> = {
  sm: 'h-8 text-[13px] gap-1.5',
  md: 'h-10 text-[14.5px] gap-2',
  lg: 'h-12 text-base gap-2.5',
}
/** Padding horizontal con texto; si es solo ícono, el botón es un círculo (sin padding). */
const PAD: Record<Size, string> = { sm: 'px-3', md: 'px-4', lg: 'px-6' }
const ICON_ONLY: Record<Size, string> = { sm: 'w-8', md: 'w-10', lg: 'w-12' }

/**
 * Botón redondeado. variant="primary" para LA acción principal de la pantalla (una sola).
 * Para ocultarlo en pantallas chicas, envolvelo en un <span className="hidden sm:inline-flex">.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 15 : size === 'lg' ? 20 : 17
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold whitespace-nowrap transition-[background,border,transform,color] duration-150 select-none disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        children ? PAD[size] : ICON_ONLY[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} /> : Icon ? <Icon size={iconSize} strokeWidth={2.2} aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} strokeWidth={2.2} aria-hidden /> : null}
    </button>
  )
})
