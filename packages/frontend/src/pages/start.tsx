import type { VoiceMode } from '@saystreet/shared'
import { ArrowRight, Ear, SpeakerHigh } from '@phosphor-icons/react'
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
    label: 'Start with my screen reader',
    description: 'SayStreet won’t talk over it.',
    Icon: Ear,
  },
  {
    mode: 'spoken',
    label: 'Start with replies read aloud',
    description: 'No screen reader? Pick this.',
    Icon: SpeakerHigh,
  },
]

export default function StartPage() {
  usePageTitle('Try the demo')
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
    say(['Setting up your demo…'])
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

      {/* One promise, one honest line, one question. What SayStreet is lives on saystreet.app,
          one tap away on the logo. */}
      <div className="mt-10 sm:mt-16">
        <h1 ref={heading} tabIndex={-1} className="title text-5xl text-balance sm:text-6xl">
          <span className="block">Shop by voice.</span>
          <span className="block">
            Pay only what you <span className="text-accent">said</span>.
          </span>
        </h1>
        <p className="mt-5 text-lg text-ink-muted sm:text-xl">
          Built for the{' '}
          <a href="https://paypalaihackathon.devpost.com/" className="font-semibold whitespace-nowrap text-ink underline hover:text-accent">
            PayPal AI Hackathon
          </a>
          . One&nbsp;tap sets up your own demo: shop real products with a sandbox PayPal wallet.
        </p>
      </div>

      <section aria-labelledby="voice-title" className="mt-10 sm:mt-14">
        <h2 id="voice-title" className="text-2xl font-bold">
          How should SayStreet talk to you?
        </h2>
        <div className="mt-5 grid gap-3">
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
                  'group flex min-h-24 w-full items-center gap-4 rounded-(--radius-panel) border border-edge bg-surface-1 px-5 py-5 text-left transition-colors duration-150',
                  'hover:border-ink hover:bg-surface-2 aria-disabled:cursor-wait sm:px-7',
                )}
              >
                <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-3 text-accent sm:size-14">
                  {pending ? <BrailleCell mode="think" className="h-7" /> : <Icon size={28} weight="bold" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xl font-bold text-balance">{pending ? 'Setting up your demo…' : label}</span>
                  <span id={`${mode}-description`} className="mt-1 block text-pretty text-ink-muted">
                    {description}
                  </span>
                </span>
                {/* Says "this goes somewhere": the choice starts the demo, there is no Continue. */}
                <ArrowRight
                  aria-hidden="true"
                  size={24}
                  weight="bold"
                  className="hidden shrink-0 text-ink-muted transition-transform duration-200 ease-out group-hover:translate-x-1 group-hover:text-ink group-focus-visible:translate-x-1 group-focus-visible:text-ink sm:block"
                />
              </button>
            )
          })}
        </div>
        {error && (
          <p aria-hidden="true" className="mt-4 font-semibold text-bad">
            {error}
          </p>
        )}
        <p className="mt-4 text-ink-muted">Talk or type. You can switch this in Settings.</p>
      </section>
    </main>
  )
}
