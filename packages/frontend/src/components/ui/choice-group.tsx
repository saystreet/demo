import { RadioGroup } from 'radix-ui'
import { cn } from '../../lib/cn'

// A radio group drawn as large choices: arrow keys move between them, VoiceOver reads
// "radio button, 1 of 3, selected".

type Choice<T extends string> = { value: T; label: string; description?: string }

type Props<T extends string> = {
  label: string
  value: T
  onChange: (value: T) => void
  choices: Choice<T>[]
  columns?: boolean
}

export function ChoiceGroup<T extends string>({ label, value, onChange, choices, columns }: Props<T>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className={cn('grid gap-3', columns && 'sm:grid-flow-col sm:auto-cols-fr')}
    >
      {choices.map((choice) => (
        <RadioGroup.Item
          key={choice.value}
          value={choice.value}
          className={cn(
            'group flex min-h-12 items-start gap-3 rounded-(--radius-control) border border-edge px-4 py-3 text-left',
            'hover:border-ink data-[state=checked]:border-accent data-[state=checked]:bg-surface-2',
          )}
        >
          <span
            aria-hidden="true"
            className="mt-1 grid size-5 shrink-0 place-items-center rounded-full border-2 border-ink-muted group-data-[state=checked]:border-accent"
          >
            <RadioGroup.Indicator className="size-2.5 rounded-full bg-accent" />
          </span>
          <span>
            <span className="block font-semibold">{choice.label}</span>
            {choice.description && <span className="mt-0.5 block text-sm text-ink-muted">{choice.description}</span>}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
