import type { VoiceMode } from '@saystreet/shared'
import { Ear, SpeakerHigh } from '@phosphor-icons/react'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useCreateAccount } from '../api/queries'
import { BrailleCell } from '../components/braille'
import { usePageTitle } from '../components/page'
import { ApiError } from '../lib/api'
import { cn } from '../lib/cn'

// The demo starts here (spec 16.3): no email, no password, one question. The browser can't tell
// whether VoiceOver is on, so the person says how replies should be read.

const CHOICES: { mode: VoiceMode; label: string; description: string; Icon: typeof Ear }[] = [
  {
    mode: 'screen_reader',
    label: 'I use a screen reader',
    description: 'VoiceOver reads replies. SayStreet only plays short sounds.',
    Icon: Ear,
  },
  {
    mode: 'spoken',
    label: 'Read replies aloud',
    description: 'SayStreet speaks every reply in your browser’s voice.',
    Icon: SpeakerHigh,
  },
]

export default function StartPage() {
  usePageTitle('Create your demo account')
  const navigate = useNavigate()
  const create = useCreateAccount()
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  const choose = (mode: VoiceMode) => {
    if (create.isPending) return
    create.mutate({ voice_mode: mode }, { onSuccess: () => navigate('/chat', { replace: true }) })
  }

  const error = create.error instanceof ApiError ? (create.error.say ?? 'Something went wrong. Try again.') : create.error ? 'Something went wrong. Try again.' : null

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-8 sm:px-8 sm:py-14">
      <a href="https://saystreet.app" className="flex min-h-12 items-center self-start">
        <img src="/brand/lockup-for-dark-bg.svg" alt="SayStreet, about the product" width="180" height="36" className="h-9 w-auto" />
      </a>

      <div className="mt-12 sm:mt-20">
        <h1 ref={heading} tabIndex={-1} className="title text-6xl sm:text-7xl">
          Create your <span className="text-accent">demo</span> account
        </h1>
        <p className="mt-6 max-w-[34em] text-xl leading-relaxed text-ink-muted">
          No email, no password. You get a sandbox PayPal wallet, a demo address and a few sample orders.
        </p>
      </div>

      <section aria-labelledby="voice-title" className="mt-12">
        <h2 id="voice-title" className="text-2xl font-bold">
          How should SayStreet talk to you?
        </h2>
        <div className="mt-5 grid gap-4">
          {CHOICES.map(({ mode, label, description, Icon }) => {
            const pending = create.isPending && create.variables?.voice_mode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => choose(mode)}
                aria-disabled={create.isPending || undefined}
                aria-describedby={`${mode}-description`}
                className={cn(
                  'group flex min-h-24 w-full items-center gap-5 rounded-(--radius-panel) border border-edge bg-surface-1 px-5 py-5 text-left transition-colors duration-150',
                  'hover:border-ink hover:bg-surface-2 aria-disabled:cursor-wait sm:px-7',
                )}
              >
                <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full bg-surface-3 text-accent">
                  {pending ? <BrailleCell mode="think" className="h-7" /> : <Icon size={28} weight="bold" />}
                </span>
                <span>
                  <span className="block text-xl font-bold">{pending ? 'Creating your account…' : label}</span>
                  <span id={`${mode}-description`} className="mt-1 block text-ink-muted">
                    {description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        {error && <p className="mt-4 font-semibold text-bad">{error}</p>}
        <p className="mt-5 text-ink-muted">You can change this anytime in Settings.</p>
      </section>

      <p className="mt-auto pt-14 text-sm text-ink-muted">
        A hackathon demo. Payments run in the PayPal sandbox, so no real money moves, and stores don’t receive orders.
      </p>
    </main>
  )
}
