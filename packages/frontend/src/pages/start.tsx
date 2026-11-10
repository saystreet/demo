import type { VoiceMode } from '@saystreet/shared'
import { Ear, SpeakerHigh } from '@phosphor-icons/react'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useCreateAccount } from '../api/queries'
import { BrailleCell } from '../components/braille'
import { usePageTitle } from '../components/page'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
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
  const { say } = useAnnouncer()

  useEffect(() => {
    heading.current?.focus()
  }, [])

  const errorText = (error: unknown) => (error instanceof ApiError && error.say ? error.say : 'Something went wrong. Try again.')

  // The button's own text changes too, but a screen reader only hears it through the live region.
  const choose = (mode: VoiceMode) => {
    if (create.isPending) return
    say(['Creating your demo account…'])
    create.mutate(
      { voice_mode: mode },
      {
        onSuccess: () => navigate('/chat', { replace: true }),
        onError: (error) => say([errorText(error)]),
      },
    )
  }

  const error = create.error ? errorText(create.error) : null

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 sm:px-8 sm:py-14">
      <a href="https://saystreet.app" className="flex min-h-12 items-center self-start">
        <img src="/brand/lockup-for-dark-bg.svg" alt="SayStreet: about the product on saystreet.app" width="180" height="36" className="h-9 w-auto" />
      </a>

      <div className="mt-8 sm:mt-16">
        <h1 ref={heading} tabIndex={-1} className="title text-5xl sm:text-7xl">
          Create your <span className="text-accent">demo</span> account
        </h1>
        {/* People often arrive here straight from the hackathon page, so say what this is. */}
        <p className="mt-5 text-xl font-bold sm:text-2xl">Shop by voice. Pay only what you said.</p>
        <p className="mt-3 max-w-[36em] text-lg leading-relaxed text-ink-muted">
          A shopping assistant for blind and low-vision people: find, buy, track and return in one conversation.{' '}
          <a href="https://saystreet.app" className="whitespace-nowrap font-semibold text-ink underline hover:text-accent">
            About SayStreet
          </a>
        </p>
        <p className="mt-3 max-w-[36em] text-lg leading-relaxed text-ink-muted">
          No email or password: you get a sandbox PayPal wallet, a demo address and sample orders.
        </p>
      </div>

      <section aria-labelledby="voice-title" className="mt-9 sm:mt-12">
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
        {error && (
          <p aria-hidden="true" className="mt-4 font-semibold text-bad">
            {error}
          </p>
        )}
        <ul className="mt-5 grid gap-1.5 text-ink-muted">
          <li>
            Not using a screen reader? Choose <span className="font-semibold text-ink">Read replies aloud</span>.
          </li>
          <li>No microphone? You can type instead.</li>
          <li>You can change this anytime in Settings.</li>
        </ul>
      </section>

      <p className="mt-auto pt-14 text-sm text-ink-muted">
        A hackathon demo. Payments run in the PayPal sandbox, so no real money moves, and stores don’t receive orders.
      </p>
    </main>
  )
}
