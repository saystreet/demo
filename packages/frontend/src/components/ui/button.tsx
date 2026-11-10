import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/cn'

// One button vocabulary for the whole app. Every size is at least 48 px tall (spec 16.1).
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
export type ButtonSize = 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-accent-ink hover:bg-white active:bg-ink-muted',
  secondary: 'border border-edge text-ink hover:border-ink hover:bg-surface-2 active:bg-surface-3',
  quiet: 'text-ink-muted underline underline-offset-4 hover:text-ink px-2',
  danger: 'border border-bad text-bad hover:bg-bad hover:text-accent-ink',
}

const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-12 px-6 text-base',
  lg: 'min-h-14 px-8 text-lg',
}

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-full font-bold transition-colors duration-150',
    'disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55',
    'forced-colors:border-2',
    VARIANTS[variant],
    variant === 'quiet' ? 'min-h-12' : SIZES[size],
    extra,
  )
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...props} />
})
