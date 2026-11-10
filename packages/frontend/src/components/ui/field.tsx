import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react'
import { cn } from '../../lib/cn'

// Form fields with a visible label and an error tied to the control (aria-describedby).

const CONTROL =
  'min-h-12 w-full rounded-(--radius-control) border border-edge bg-surface-1 px-4 text-base text-ink placeholder:text-ink-muted ' +
  'hover:border-ink focus-visible:border-accent aria-invalid:border-bad'

type FieldProps = { label: string; error?: string | null; hint?: string; children: (ids: { id: string; describedBy?: string }) => ReactNode }

export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {children({ id, describedBy })}
      {error && (
        <p id={errorId} className="text-sm font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(CONTROL, className)} {...props} />
})

// Native select: the most reliable picker with VoiceOver on iPhone.
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(CONTROL, 'appearance-auto', className)} {...props} />
})
