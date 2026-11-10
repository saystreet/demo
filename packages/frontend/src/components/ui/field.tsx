import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react'
import { cn } from '../../lib/cn'

// Form fields with a visible label and an error tied to the control (aria-describedby).

// min-w-0: a field shrinks with its column instead of pushing the page sideways at large text sizes.
const CONTROL =
  'min-h-12 w-full min-w-0 rounded-(--radius-control) border border-edge bg-surface-1 px-4 text-base text-ink placeholder:text-ink-muted ' +
  'hover:border-ink focus-visible:border-accent aria-invalid:border-bad'

type FieldProps = {
  label: string
  id?: string // a stable id, e.g. to focus the field on an error; generated otherwise
  error?: string | null
  hint?: string
  children: (ids: { id: string; describedBy?: string }) => ReactNode
}

// The control must use the `id` it's given: that's what the label points at.
export function Field({ label, id: fixedId, error, hint, children }: FieldProps) {
  const generated = useId()
  const id = fixedId ?? generated
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="grid min-w-0 gap-1.5">
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
