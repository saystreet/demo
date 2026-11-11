import type { VoiceMode } from '@saystreet/shared'
import { Check, Headphones, PaypalLogo, SpeakerHigh } from '@phosphor-icons/react'
import { Dialog } from 'radix-ui'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { connectPayPal, useCreateAccount, useMe } from '../../api/queries'
import { ApiError } from '../../lib/api'
import { useAnnouncer } from '../../lib/announcer'
import { cn } from '../../lib/cn'
import { getStep, setStep, type Step } from '../../lib/onboarding'
import { getToken } from '../../lib/session'
import { play, unlockAudio } from '../../lib/sounds'
import { BrailleCell } from '../braille'
import { announceConnected } from '../paypal'
import { Button } from '../ui/button'
import { PANEL, PanelFooter } from '../ui/dialog-panel'

// The first run is one dialog with three steps, always the same frame (same size, same title, same footer) so
// moving on only changes what is inside it, with a short fade. It lives above the routes, so it is not rebuilt
// when the account is made and the page behind changes from the picture of the empty chat to the real one:
//   1. how replies are read (this makes the account: a name, an address, a sandbox buyer, sample orders),
//   2. PayPal: connect your own sandbox account, or skip,
//   3. how it works.
// It can't be closed, only answered, and where the person is is kept per account (lib/onboarding.ts), so a reload
// or the trip to PayPal and back resumes at the same step. Afterwards "How it works" in the menu is only a reminder,
// the same four lines, closable. PayPal then lives in Settings.

export const OPEN_WELCOME = 'saystreet:welcome'

const HOW = [
  'Say what you want, or paste a product link.',
  'Ask about the options, then pick by number.',
  'To pay, say the total or press Pay.',
  'Track and return orders in the same chat.',
]

// What PayPal adds, in the same shape as the steps of how it works.
const PAYPAL_POINTS = ['See every order in your own PayPal.', 'It’s a sandbox: no real money moves.']

const CHOICES: { mode: VoiceMode; label: string; description: string; Icon: typeof Headphones }[] = [
  { mode: 'screen_reader', label: 'I use a screen reader', description: 'It reads the replies. SayStreet stays quiet.', Icon: Headphones },
  { mode: 'spoken', label: 'Read replies aloud', description: 'SayStreet speaks every reply.', Icon: SpeakerHigh },
]

// What the page was opened with: back from PayPal (?paypal=connected | cancelled | failed), and whether that was
// the chat (the first run) or Settings. Read when the app first renders, before the pages take it off the address.
function readReturn() {
  if (typeof window === 'undefined') return { outcome: null as string | null, params: new URLSearchParams(), inChat: false }
  const params = new URLSearchParams(window.location.search)
  return { outcome: params.get('paypal'), params, inChat: window.location.pathname.startsWith('/chat') }
}

// One step: the same anatomy every time.
function StepFrame({ id, title, description, children, footer }: { id: string; title: string; description: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <div key={id} className="step-in flex min-h-0 flex-1 flex-col">
      <Dialog.Title asChild>
        <h1 className="title text-4xl">{title}</h1>
      </Dialog.Title>
      <Dialog.Description className="mt-3 text-lg text-ink-muted">{description}</Dialog.Description>
      <div className="mt-5 flex-1">{children}</div>
      {footer}
    </div>
  )
}

export function Welcome() {
  const navigate = useNavigate()
  useLocation() // re-render when the person moves: "Start over" forgets the account and comes back to step 1
  const { data: me } = useMe()
  const create = useCreateAccount()
  const { say } = useAnnouncer()
  const [ret] = useState(readReturn)
  const [stepState, setStepState] = useState<Step | null>(null)
  const [info, setInfo] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const handledFor = useRef<string | null>(null)

  // Once the account is known: resume where this account was, and take in what PayPal answered. Before paint,
  // so the step the person left on never shows for a frame.
  useLayoutEffect(() => {
    if (!me || handledFor.current === me.id) return
    const first = handledFor.current === null
    handledFor.current = me.id
    let current = getStep(me.id)
    if (first && ret.outcome === 'connected') {
      announceConnected(ret.params)
      if (ret.inChat && current === 'paypal') {
        current = 'how'
        setStep(me.id, current)
      }
    } else if (first && ret.inChat && current === 'paypal' && (ret.outcome === 'cancelled' || ret.outcome === 'failed')) {
      setNote(ret.outcome === 'cancelled' ? 'Cancelled on PayPal. You can try again, or skip.' : "PayPal didn't connect. You can try again, or skip.")
    }
    setStepState(current)
  }, [me, ret])

  // The reminder in the menu.
  useLayoutEffect(() => {
    const show = () => setInfo(true)
    window.addEventListener(OPEN_WELCOME, show)
    return () => window.removeEventListener(OPEN_WELCOME, show)
  }, [])

  const token = getToken()
  // No account: step 1. An account: where it is (the stored step until the effect above has read it).
  const step: 'voice' | Step | null = !token ? 'voice' : me ? (handledFor.current === me.id ? (stepState ?? getStep(me.id)) : getStep(me.id)) : null

  const go = (next: Step) => {
    if (!me) return
    setStep(me.id, next)
    setStepState(next)
    if (next === 'done') window.setTimeout(() => document.getElementById('talk')?.focus(), 50)
  }

  const choose = (mode: VoiceMode) => {
    if (create.isPending) return
    unlockAudio()
    play('select')
    say(['Setting up your demo…'], 'status')
    setNote(null)
    create.mutate(
      { voice_mode: mode },
      {
        onSuccess: () => navigate('/chat', { replace: true }),
        onError: (error) => say([error instanceof ApiError && error.say ? error.say : 'Something went wrong. Try again.']),
      },
    )
  }

  const connect = async () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    say(['Opening PayPal…'], 'status')
    try {
      const { approve_url } = await connectPayPal('chat')
      window.location.assign(approve_url)
    } catch (error) {
      setNote(error instanceof ApiError && error.say ? error.say : "Couldn't open PayPal. Try again, or skip.")
      play('error')
      setBusy(false)
    }
  }

  const problem = create.isError ? (create.error instanceof ApiError && create.error.say ? create.error.say : 'Something went wrong. Try again.') : null
  const choosing = create.variables?.voice_mode
  const locked = step === 'voice' || step === 'paypal' || step === 'how'

  return (
    <>
      <Dialog.Root open={locked}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ground/80" />
          <Dialog.Content
            // No way out but the buttons: not Escape, not a click outside.
            onEscapeKeyDown={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            className={PANEL}
          >
            {step === 'voice' && (
              <StepFrame id="voice" title="SayStreet demo" description="Accessible online shopping.">
                <p className="text-lg font-bold">How should SayStreet talk to you?</p>
                <div className="mt-3 grid gap-2">
                  {CHOICES.map(({ mode, label, description, Icon }) => {
                    const pending = create.isPending && choosing === mode
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => choose(mode)}
                        aria-disabled={create.isPending || undefined}
                        aria-busy={pending || undefined}
                        aria-describedby={`voice-${mode}`}
                        className={cn(
                          'flex min-h-16 w-full items-center gap-3 rounded-(--radius-control) border border-edge px-3 py-2.5 text-left transition-colors duration-150 hover:border-ink hover:bg-surface-2 aria-disabled:cursor-wait',
                          pending && 'border-accent',
                        )}
                      >
                        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-accent">
                          {pending ? <BrailleCell mode="think" className="h-6" /> : <Icon size={24} weight="bold" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-lg leading-snug font-bold">{label}</span>
                          <span id={`voice-${mode}`} className="block leading-snug text-ink-muted">
                            {description}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                {/* The same height with or without a problem: nothing moves. */}
                <p className="mt-2 min-h-6 text-sm font-semibold text-bad">{problem}</p>
              </StepFrame>
            )}

            {step === 'paypal' && (
              <StepFrame
                id="paypal"
                title="Connect PayPal"
                description="Pay with your own PayPal sandbox account."
                footer={
                  <PanelFooter
                    left={
                      <Button
                        variant="quiet"
                        onClick={() => {
                          play('select')
                          go('how')
                        }}
                        className="-ml-2"
                      >
                        Skip
                      </Button>
                    }
                    right={
                      <Button pending={busy} onClick={connect}>
                        <PaypalLogo aria-hidden="true" size={20} weight="fill" />
                        Connect PayPal
                      </Button>
                    }
                  />
                }
              >
                <ul className="grid gap-3">
                  {PAYPAL_POINTS.map((text) => (
                    <li key={text} className="grid grid-cols-[1.75rem_minmax(0,1fr)] text-base sm:text-lg">
                      <Check aria-hidden="true" size={20} weight="bold" className="mt-1 text-accent" />
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 min-h-6 font-semibold text-bad">{note}</p>
              </StepFrame>
            )}

            {step === 'how' && (
              <StepFrame
                id="how"
                title="How it works"
                description="Four short steps."
                footer={
                  <PanelFooter
                    right={
                      <Button
                        onClick={() => {
                          play('select')
                          go('done')
                        }}
                      >
                        Continue
                      </Button>
                    }
                  />
                }
              >
                <HowList />
              </StepFrame>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Later, from the menu: only a reminder, and it closes. */}
      <Dialog.Root open={info && step === 'done'} onOpenChange={setInfo}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ground/80" />
          <Dialog.Content onCloseAutoFocus={(event) => event.preventDefault()} className={PANEL}>
            <StepFrame
              id="info"
              title="How it works"
              description="Four short steps."
              footer={
                <PanelFooter
                  right={
                    <Dialog.Close asChild>
                      <Button>Close</Button>
                    </Dialog.Close>
                  }
                />
              }
            >
              <HowList />
            </StepFrame>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

function HowList() {
  return (
    <ol className="grid gap-3">
      {HOW.map((text, i) => (
        <li key={text} className="grid grid-cols-[1.75rem_minmax(0,1fr)] text-base sm:text-lg">
          <span aria-hidden="true" className="data text-accent">
            {i + 1}
          </span>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  )
}
