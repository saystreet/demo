import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { TOAST_EVENT, type Toast } from '../../lib/toast'

// One toast at a time, bottom right, above the input, gone after seven seconds (or the close button). The region is always
// on the page and only its content changes, so a screen reader announces each new toast politely, without
// moving focus. It carries words and an icon, never a colour alone.
const SHOWN_MS = 7000

export function Toaster() {
  const [current, setCurrent] = useState<(Toast & { id: number; modal: boolean }) | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const counter = useRef(0)

  useEffect(() => {
    const show = (event: Event) => {
      window.clearTimeout(timer.current)
      // With a dialog open it sits in the corner under it, not above the input the dialog covers.
      setCurrent({ ...(event as CustomEvent<Toast>).detail, id: ++counter.current, modal: !!document.querySelector('[role="dialog"]') })
      timer.current = window.setTimeout(() => setCurrent(null), SHOWN_MS)
    }
    window.addEventListener(TOAST_EVENT, show)
    return () => {
      window.removeEventListener(TOAST_EVENT, show)
      window.clearTimeout(timer.current)
    }
  }, [])

  const good = current?.tone !== 'bad'
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-none fixed inset-x-4 z-[60] sm:left-auto sm:w-[28rem]',
        current?.modal ? 'bottom-4' : 'bottom-[calc(var(--composer-h,0px)+1rem)]',
      )}
    >
      {current && (
        <div
          key={current.id}
          className={cn(
            'toast-in pointer-events-auto flex items-start gap-3 rounded-(--radius-panel) border bg-surface-2 p-4 shadow-[0_12px_32px_rgb(0_0_0/0.45)]',
            good ? 'border-good' : 'border-bad',
          )}
        >
          {good ? (
            <CheckCircle aria-hidden="true" size={26} weight="fill" className="mt-0.5 shrink-0 text-good" />
          ) : (
            <WarningCircle aria-hidden="true" size={26} weight="fill" className="mt-0.5 shrink-0 text-bad" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-bold">{current.title}</p>
            {current.lines?.map((line) => (
              <p key={line} className="text-sm text-ink-muted [overflow-wrap:anywhere]">
                {line}
              </p>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCurrent(null)}
            className="-m-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <X aria-hidden="true" size={20} weight="bold" />
            <span className="sr-only">Dismiss</span>
          </button>
        </div>
      )}
    </div>
  )
}
