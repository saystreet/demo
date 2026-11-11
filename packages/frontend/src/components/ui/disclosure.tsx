import { CaretRight } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

// Closed by default, native <details>: a screen reader says "collapsed" or "expanded", and Enter or
// Space opens it. For the proof and the developer tools: there for whoever wants them, not in the way.
export function Disclosure({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={cn('group', className)}>
      <summary className="flex min-h-12 w-fit cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        <CaretRight aria-hidden="true" size={18} weight="bold" className="transition-transform duration-150 group-open:rotate-90" />
        {summary}
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  )
}
