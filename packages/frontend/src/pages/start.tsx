import type { VoiceMode } from '@saystreet/shared'
import { Headphones, Microphone, Package, Plus, Sliders, SpeakerHigh } from '@phosphor-icons/react'
import { Dialog } from 'radix-ui'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useCreateAccount } from '../api/queries'
import { BrailleCell } from '../components/braille'
import { usePageTitle } from '../components/page'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { cn } from '../lib/cn'
import { getToken } from '../lib/session'
import { play, unlockAudio } from '../lib/sounds'

// "Try the demo" lands here with no account. The page behind is a picture of the empty chat, switched
// off (inert, hidden from screen readers), so the person sees where they are going. On top is one
// dialog that can't be closed or skipped: how should replies be read? Choosing it makes the account
// (a name, an address, a sandbox buyer and sample orders, no email or password) and opens the real chat,
// which looks the same, where "How it works" follows. Signed in, the router never shows this page.

const CHOICES: { mode: VoiceMode; label: string; description: string; Icon: typeof Headphones }[] = [
  { mode: 'screen_reader', label: 'I use a screen reader', description: 'It reads the replies. SayStreet stays quiet.', Icon: Headphones },
  { mode: 'spoken', label: 'Read replies aloud', description: 'SayStreet speaks every reply.', Icon: SpeakerHigh },
]

export default function StartPage() {
  usePageTitle('Start the demo')
  const navigate = useNavigate()
  const create = useCreateAccount()
  const { say } = useAnnouncer()

  // Already has an account (a bookmark, or back from PayPal): straight to the chat.
  useEffect(() => {
    if (getToken()) navigate(`/chat${window.location.search}`, { replace: true })
  }, [navigate])

  const choose = (mode: VoiceMode) => {
    if (create.isPending) return
    unlockAudio()
    play('select')
    say(['Setting up your demo…'], 'status')
    create.mutate(
      { voice_mode: mode },
      {
        onSuccess: () => navigate('/chat', { replace: true }),
        onError: (error) => say([error instanceof ApiError && error.say ? error.say : 'Something went wrong. Try again.']),
      },
    )
  }

  const problem = create.isError ? (create.error instanceof ApiError && create.error.say ? create.error.say : 'Something went wrong. Try again.') : null
  const choosing = create.variables?.voice_mode

  return (
    <>
      <Backdrop />
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ground/80" />
          <Dialog.Content
            // No way out: not Escape, not a click outside. Choosing is the only way on.
            onEscapeKeyDown={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
            className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-(--radius-panel) border border-edge bg-surface-1 p-6"
          >
            <Dialog.Title asChild>
              <h1 className="title text-4xl sm:text-5xl">SayStreet demo</h1>
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-lg text-ink-muted">Shop by voice. Pay only what you said.</Dialog.Description>
            <h2 className="mt-6 text-xl font-bold">How should SayStreet talk to you?</h2>
            <div className="mt-3 grid gap-3">
              {CHOICES.map(({ mode, label, description, Icon }) => {
                const pending = create.isPending && choosing === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => choose(mode)}
                    aria-disabled={create.isPending || undefined}
                    aria-busy={pending || undefined}
                    aria-describedby={`start-${mode}`}
                    className={cn(
                      'flex min-h-20 w-full items-center gap-4 rounded-(--radius-control) border border-edge px-4 py-3 text-left transition-colors duration-150 hover:border-ink hover:bg-surface-2 aria-disabled:cursor-wait',
                      pending && 'border-accent',
                    )}
                  >
                    <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-3 text-accent">
                      {pending ? <BrailleCell mode="think" className="h-6" /> : <Icon size={24} weight="bold" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-lg font-bold">{label}</span>
                      <span id={`start-${mode}`} className="block text-ink-muted">
                        {description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            {/* The same height with or without a problem: nothing moves. */}
            <p className="mt-3 min-h-6 font-semibold text-bad">
              {problem}
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

// A picture of the empty chat. Nothing in it works and nothing in it is read out.
function Backdrop() {
  return (
    <div aria-hidden="true" inert className="min-h-dvh lg:grid lg:grid-cols-[17.5rem_1fr]">
      <aside className="hidden h-dvh flex-col gap-6 border-r border-line bg-surface-1 p-4 lg:flex">
        <img src="/brand/lockup-for-dark-bg.svg" alt="" width="160" height="32" className="h-8 w-auto self-start" />
        <div className="flex min-h-12 items-center gap-2 rounded-full border border-edge px-6 font-bold">
          <Plus size={20} weight="bold" />
          New chat
        </div>
        <div className="mt-auto grid gap-1 border-t border-line pt-4 font-semibold">
          <span className="flex min-h-12 items-center gap-3 px-3">
            <Package size={22} />
            Orders
          </span>
          <span className="flex min-h-12 items-center gap-3 px-3">
            <Sliders size={22} />
            Settings
          </span>
        </div>
      </aside>
      <div className="flex min-h-dvh flex-col justify-center px-4 sm:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <p className="pb-6 text-center text-3xl leading-tight font-bold text-balance sm:text-4xl">What are you shopping for today?</p>
          <div className="flex items-center gap-1.5 rounded-full border border-edge bg-surface-1 p-1.5">
            <span className="inline-flex h-12 w-28 shrink-0 items-center justify-center gap-2 rounded-full bg-accent text-lg font-bold text-accent-ink sm:h-14">
              <Microphone size={24} weight="fill" />
              Talk
            </span>
            <span className="px-2 text-ink-muted">Or type here</span>
          </div>
        </div>
      </div>
    </div>
  )
}
