import { RadioGroup } from 'radix-ui'
import { type KeyboardEvent, type MouseEvent, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

// A radio group drawn as large choices: arrow keys move between them, VoiceOver reads
// "radio button, 1 of 3, selected".
//
// Radix checks a radio as soon as an arrow key reaches it (the ARIA radio pattern). Settings save
// on change, so that would save every option arrowed past, and arrowing onto "Read replies aloud"
// would switch on the browser voice over VoiceOver. Here arrows only move the selection; it's
// committed by a click or tap (VoiceOver's double tap), Space or Enter, or when focus leaves.

type Choice<T extends string> = { value: T; label: string; description?: string }

type Props<T extends string> = {
  label?: string // or point at a visible heading with labelledBy, so it isn't read twice
  labelledBy?: string
  value: T
  onChange: (value: T) => void
  choices: Choice<T>[]
  columns?: boolean
}

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

export function ChoiceGroup<T extends string>({ label, labelledBy, value, onChange, choices, columns }: Props<T>) {
  const [draft, setDraft] = useState<T | null>(null)
  const arrowed = useRef(false)

  const commit = (next: T) => {
    setDraft(null)
    if (next !== value) onChange(next)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (ARROWS.has(event.key)) arrowed.current = true
    else if ((event.key === ' ' || event.key === 'Enter') && draft !== null) {
      event.preventDefault()
      commit(draft)
    }
  }

  // A click on the option that is already shown as selected (an arrowed-to draft) commits it.
  const onClick = (event: MouseEvent) => {
    const item = (event.target as HTMLElement).closest('[role="radio"]')
    if (draft !== null && item?.getAttribute('value') === draft) commit(draft)
  }

  return (
    <RadioGroup.Root
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      value={draft ?? value}
      onValueChange={(next) => {
        if (arrowed.current) setDraft(next as T)
        else commit(next as T)
        arrowed.current = false
      }}
      onKeyDownCapture={onKeyDown}
      onKeyUp={() => {
        arrowed.current = false
      }}
      onClickCapture={onClick}
      onBlur={(event) => {
        if (draft !== null && !event.currentTarget.contains(event.relatedTarget as Node | null)) commit(draft)
      }}
      className={cn('grid gap-3', columns && 'sm:grid-flow-col sm:auto-cols-fr')}
    >
      {choices.map((choice) => (
        <RadioGroup.Item
          key={choice.value}
          value={choice.value}
          aria-describedby={choice.description ? `choice-${choice.value}-description` : undefined}
          className={cn(
            'group flex min-h-12 items-start gap-3 rounded-(--radius-control) border border-edge px-4 py-3 text-left',
            'hover:border-ink data-[state=checked]:border-accent data-[state=checked]:bg-surface-2',
            // Windows High Contrast drops backgrounds and recolours borders: keep "selected" visible.
            'forced-colors:data-[state=checked]:border-[3px] forced-colors:data-[state=checked]:border-[Highlight]',
          )}
        >
          <span
            aria-hidden="true"
            className="mt-1 grid size-5 shrink-0 place-items-center rounded-full border-2 border-ink-muted group-data-[state=checked]:border-accent forced-colors:border-[CanvasText]"
          >
            <RadioGroup.Indicator className="size-2.5 rounded-full bg-accent forced-colors:bg-[CanvasText]" />
          </span>
          <span>
            <span className="block font-semibold">{choice.label}</span>
            {choice.description && (
              // Not part of the name: read once as the description, after "radio button, selected".
              <span id={`choice-${choice.value}-description`} aria-hidden="true" className="mt-0.5 block text-sm text-ink-muted">
                {choice.description}
              </span>
            )}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
