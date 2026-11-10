import { type ReactNode, useEffect } from 'react'
import { cn } from '../lib/cn'
import { BrailleCell } from './braille'

// Every page has one h1 and a tab title "<Page> · SayStreet" (spec 16.1). The shell moves
// focus to the h1 after navigation, so VoiceOver reads where the person landed.

// Long catalog titles are cut for the tab strip; the page's h1 keeps the whole name.
export function usePageTitle(title: string) {
  useEffect(() => {
    const short = title.length > 60 ? `${title.slice(0, 57).trimEnd()}…` : title
    document.title = short ? `${short} · SayStreet` : 'SayStreet'
  }, [title])
}

// `plain`: the text face in normal case, for names that aren't ours (a 120-character product title
// in the condensed capitals face is hard to read at any zoom). A size passed in className replaces
// the default one instead of fighting it (cn doesn't merge classes).
export function PageTitle({ children, className, plain = false }: { children: ReactNode; className?: string; plain?: boolean }) {
  const sized = className?.split(/\s+/).some((c) => /^(sm:)?text-(\d?xl|lg|base)$/.test(c))
  return (
    <h1
      tabIndex={-1}
      className={cn(plain ? 'font-bold leading-tight [overflow-wrap:anywhere]' : 'title', !sized && (plain ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-5xl'), className)}
    >
      {children}
    </h1>
  )
}

// `status` sits beside the heading, e.g. "Saved" after a change in this section.
export function Section({ title, status, children, className }: { title: string; status?: ReactNode; children: ReactNode; className?: string }) {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={id} className={cn('border-t border-line pt-6', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={id} className="text-xl font-bold">
          {title}
        </h2>
        {status}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function Badge({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const tones = {
    plain: 'border-edge text-ink-muted',
    good: 'border-good text-good',
    warn: 'border-warn text-warn',
    bad: 'border-bad text-bad',
    accent: 'border-accent bg-accent text-accent-ink',
  }
  return <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold', tones[tone])}>{children}</span>
}

export function LoadingLine({ label }: { label: string }) {
  return (
    <p className="loading-line flex items-center gap-3 py-6 text-ink-muted">
      <BrailleCell mode="think" className="h-6 text-accent" />
      {label}
    </p>
  )
}

// The button stays in place while retrying (it says "Trying again…"), so keyboard and VoiceOver
// focus isn't lost; the page says the result.
export function ErrorLine({ message, onRetry, retrying }: { message: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div className="py-6">
      <p className="text-bad">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={() => !retrying && onRetry()}
          aria-disabled={retrying || undefined}
          className="mt-3 min-h-12 font-semibold underline underline-offset-4 aria-disabled:cursor-wait"
        >
          {retrying ? 'Trying again…' : 'Try again'}
        </button>
      )}
    </div>
  )
}
