import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/cn'
import { BrailleCell } from '../braille'

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
    // Not transition-colors: that also animates outline-color, so the focus ring would fade in from the text colour.
    'inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap transition-[color,background-color,border-color] duration-150',
    // 70%: still reads as unavailable, and its text stays above 7:1.
    'disabled:cursor-not-allowed disabled:opacity-70 aria-disabled:cursor-not-allowed aria-disabled:opacity-70',
    'forced-colors:border-2',
    VARIANTS[variant],
    variant === 'quiet' ? 'min-h-12' : SIZES[size],
    extra,
  )
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; pending?: boolean }

// `pending`: the label keeps its place (and its accessible name) and the SayStreet cell animates over
// it, so the button never changes size and a screen reader never hears a different name. What is
// happening is said by the page's live region, not by the button.
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', pending, children, onClick, 'aria-disabled': ariaDisabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonClass(variant, size, className), pending && 'relative cursor-wait')}
      aria-busy={pending || undefined}
      aria-disabled={pending || ariaDisabled || undefined}
      onClick={pending ? undefined : onClick}
      {...props}
    >
      {pending ? (
        <>
          <span className="inline-flex items-center justify-center gap-2 opacity-0">{children}</span>
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
            <BrailleCell mode="think" className="h-5" dim="opacity-25" />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  )
})
