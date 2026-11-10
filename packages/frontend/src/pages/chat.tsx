import { Trash } from '@phosphor-icons/react'
import type { MandateView, Message, TurnResponse } from '@saystreet/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { applyTurn, cancelMandate, payMandate, sendTurn, transcribe, useConversation, useDeleteConversation, useMe } from '../api/queries'
import { MandateCard, OptionsCard, OrdersCard } from '../components/chat/cards'
import { Composer } from '../components/chat/composer'
import { DemoTools } from '../components/chat/demo-tools'
import { ErrorLine, LoadingLine, PageTitle, usePageTitle } from '../components/page'
import { ConfirmDialog } from '../components/ui/alert-dialog'
import { Button } from '../components/ui/button'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { cn } from '../lib/cn'
import { useRecorder } from '../lib/recorder'
import { type Earcon, play } from '../lib/sounds'

// The conversation (spec 16.4, 15.2–15.8). Everything SayStreet says comes back in a
// TurnResponse; its new messages are added to the transcript, spoken in order, and marked with
// a short sound. Old messages are never spoken again, and focus never moves on its own.

const WELCOME = "Hi, I'm SayStreet. Tell me what you need, or paste a product link."
const ERROR = 'Something went wrong on my side. Nothing was paid. Try again.'
const SUGGESTIONS = ['Whistling kettle under $40', 'Where is my order?', 'What are my orders?']

type Phase = 'idle' | 'recording' | 'transcribing' | 'thinking'

export default function ChatPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const announcer = useAnnouncer()
  const { data: me } = useMe()
  const chat = useConversation(id)
  const remove = useDeleteConversation()
  const [phase, setPhase] = useState<Phase>('idle')
  const [pendingText, setPendingText] = useState<string | null>(null)
  // The last problem, shown as text too: earcons and the hidden live region aren't enough for
  // a sighted or low-vision person without a screen reader.
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const spoken = me?.voice_mode === 'spoken'

  usePageTitle(chat.data?.conversation.title ?? 'New chat')

  // Spoken mode greets a new empty chat once. (`say` is stable; the announcer object is not.)
  const { say } = announcer
  useEffect(() => {
    if (!id && spoken) say([WELCOME])
  }, [id, spoken, say])

  // A quiet tick while waiting more than a second, every 1.5 s.
  useEffect(() => {
    if (phase !== 'thinking' && phase !== 'transcribing') return
    let tick: number | undefined
    const start = window.setTimeout(() => {
      play('tick')
      tick = window.setInterval(() => play('tick'), 1500)
    }, 1000)
    return () => {
      window.clearTimeout(start)
      window.clearInterval(tick)
    }
  }, [phase])

  const speak = useCallback(
    (response: TurnResponse) => {
      play(response.sound as Earcon | null)
      announcer.say(response.messages.filter((m) => m.role !== 'user').map((m) => m.text))
    },
    [announcer],
  )

  const handle = useCallback(
    (response: TurnResponse) => {
      applyTurn(client, response)
      if (response.conversation.id !== id) navigate(`/chat/${response.conversation.id}`, { replace: !id, state: { keepFocus: true } })
      speak(response)
    },
    [client, id, navigate, speak],
  )

  const fail = useCallback(
    (error: unknown) => {
      const text = error instanceof ApiError && error.say ? error.say : ERROR
      play('error')
      setNotice(text)
      announcer.say([text])
    },
    [announcer],
  )

  // Controls that vanish (Pay, Cancel, suggestions, Stop speaking) hand focus to Talk.
  const focusTalk = useCallback(() => {
    ;(document.getElementById('talk') ?? inputRef.current)?.focus()
  }, [])

  const send = useCallback(
    async (text: string, input: 'voice' | 'text') => {
      announcer.stop()
      play('sent')
      setNotice(null)
      setPendingText(text)
      setPhase('thinking')
      try {
        handle(await sendTurn({ conversation_id: id, text, input }))
      } catch (error) {
        fail(error)
      } finally {
        setPendingText(null)
        setPhase('idle')
      }
    },
    [announcer, handle, fail, id],
  )

  const recorder = useRecorder(
    async (audio) => {
      play('record_stop')
      announcer.hold(false)
      setPhase('transcribing')
      try {
        const result = await transcribe(audio)
        if (!result.heard) {
          const text = result.say ?? "I didn't catch that."
          setPhase('idle')
          setNotice(text)
          announcer.say([text])
          return
        }
        await send(result.text, 'voice')
      } catch (error) {
        setPhase('idle')
        fail(error)
      }
    },
    (error) => {
      const text = error === 'denied' ? 'Microphone is off. You can type instead.' : "The microphone didn't start. You can type instead."
      announcer.hold(false)
      setPhase('idle')
      setNotice(text)
      announcer.say([text])
      inputRef.current?.focus()
    },
  )

  const talk = useCallback(() => {
    if (recorder.state === 'recording') {
      recorder.stop()
      return
    }
    // Talk silences SayStreet at once; nothing is said while recording.
    announcer.stop()
    announcer.hold(true)
    play('record_start')
    setPhase('recording')
    void recorder.start()
  }, [recorder, announcer])

  useEffect(() => {
    if (recorder.state === 'idle' && phase === 'recording') setPhase('idle')
  }, [recorder.state, phase])

  // Hold Space to talk, when focus isn't in a field or on a control (spec 16.10).
  useEffect(() => {
    const isFree = (target: EventTarget | null) => !(target instanceof HTMLElement) || !target.closest('input, textarea, select, button, a, [role="menuitem"], [role="radio"]')
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || !isFree(event.target) || phase !== 'idle') return
      event.preventDefault()
      talk()
    }
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !isFree(event.target) || recorder.state !== 'recording') return
      event.preventDefault()
      recorder.stop()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [talk, phase, recorder])

  const decide = useCallback(
    async (action: () => Promise<TurnResponse>) => {
      announcer.stop()
      setNotice(null)
      setPhase('thinking')
      try {
        handle(await action())
      } catch (error) {
        fail(error)
      } finally {
        setPhase('idle')
        // The Pay and Cancel buttons are gone now; don't leave focus on the page.
        focusTalk()
      }
    },
    [announcer, handle, fail, focusTalk],
  )

  const onPay = useCallback((mandate: MandateView) => decide(() => payMandate(mandate.id, mandate.total_cents)), [decide])
  const onCancel = useCallback((mandate: MandateView) => decide(() => cancelMandate(mandate.id)), [decide])
  const onExpiring = useCallback(() => announcer.say(['30 seconds left to confirm.']), [announcer])

  const messages: Message[] = chat.data?.messages ?? []
  const liveMandate = chat.data?.mandate ?? null
  const options = chat.data?.options ?? null

  // Keep the newest message in view, above the sticky input bar (visual only; focus stays put).
  const barRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--composer-h', `${bar.offsetHeight}px`))
    observer.observe(bar)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--composer-h')
    }
  }, [])
  useLayoutEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, pendingText])

  const empty = !id && messages.length === 0 && !pendingText

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4.1rem)] max-w-3xl flex-col px-4 sm:px-8 lg:min-h-dvh">
      <div className="pt-8 pb-4 sm:pt-12">
        <PageTitle className="text-3xl sm:text-4xl">{chat.data?.conversation.title ?? 'New chat'}</PageTitle>
      </div>

      {id && chat.isPending && <LoadingLine label="Loading the chat…" />}
      {id && chat.isError &&
        (chat.error instanceof ApiError && chat.error.status === 404 ? (
          <p className="py-6 text-lg">This chat was deleted or doesn’t exist. Start a new one below.</p>
        ) : (
          <ErrorLine message="Couldn’t load this chat." onRetry={() => chat.refetch()} />
        ))}

      {empty && (
        <div className="py-6">
          <p className="text-2xl leading-snug">{WELCOME}</p>
          <h2 className="mt-8 text-sm font-semibold text-ink-muted">Try saying</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {SUGGESTIONS.map((text) => (
              <li key={text}>
                <button
                  type="button"
                  onClick={() => {
                    if (phase !== 'idle') return
                    // These buttons disappear once the chat starts; keep focus on Talk, not the page.
                    focusTalk()
                    void send(text, 'text')
                  }}
                  className="min-h-12 rounded-full border border-edge px-5 font-semibold hover:border-ink hover:bg-surface-1"
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-ink-muted">Found something but can’t check out? Paste the product link below.</p>
        </div>
      )}

      <ol className="grid flex-1 content-start gap-8 pb-8" aria-label="Conversation">
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            conversationId={id ?? null}
            liveMandateId={liveMandate?.id ?? null}
            busy={phase !== 'idle'}
            onPay={onPay}
            onCancel={onCancel}
            onExpiring={onExpiring}
          />
        ))}
        {pendingText && (
          <li>
            <p className="text-sm text-ink-muted">
              You<span className="sr-only"> said</span>
            </p>
            <p className="mt-1 text-xl">{pendingText}</p>
          </li>
        )}
      </ol>
      <div ref={endRef} style={{ scrollMarginBottom: 'calc(var(--composer-h, 10rem) + 1rem)' }} />

      <div
        ref={barRef}
        className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-ground px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8 [@media(max-height:32rem)]:static"
      >
        {/* Already spoken through the announcer; shown here for people who read the screen. */}
        {notice && (
          <p aria-hidden="true" className="mb-3 font-semibold text-bad">
            {notice}
          </p>
        )}
        <Composer
          ref={inputRef}
          phase={phase}
          canRecord={recorder.state !== 'unsupported'}
          spoken={spoken}
          speaking={announcer.speaking}
          onTalk={talk}
          onSend={(text) => send(text, 'text')}
          onStopSpeaking={() => {
            announcer.stop()
            focusTalk()
          }}
          onSpeakingEnded={focusTalk}
        />
      </div>
      {/* Below the input, outside the sticky bar: reachable by scrolling, never covering the chat. */}
      <div className="grid gap-4 pt-2 pb-8">
        {recorder.state !== 'unsupported' && !spoken && (
          <p className="text-sm text-ink-muted">Tip: use headphones so the microphone doesn’t hear VoiceOver.</p>
        )}
        <DemoTools conversationId={id ?? null} hasOptions={!!options?.length} say={announcer.say} />
        {/* After the conversation, so VoiceOver reads the chat before this control. */}
        {id && chat.data && (
          <ConfirmDialog
            title="Delete this chat?"
            description="The chat and its messages go away. Orders stay in Orders."
            confirm="Delete chat"
            danger
            onConfirm={() =>
              remove.mutate(id, {
                onSuccess: () => {
                  announcer.say(['Chat deleted.'])
                  navigate('/chat', { replace: true })
                },
              })
            }
            trigger={
              <Button variant="quiet" className="justify-self-start">
                <Trash aria-hidden="true" size={20} />
                Delete chat
              </Button>
            }
          />
        )}
      </div>
    </div>
  )
}

type ItemProps = {
  message: Message
  conversationId: string | null
  liveMandateId: string | null
  busy: boolean
  onPay: (mandate: MandateView) => void
  onCancel: (mandate: MandateView) => void
  onExpiring: () => void
}

function MessageItem({ message, conversationId, liveMandateId, busy, onPay, onCancel, onExpiring }: ItemProps) {
  const mine = message.role === 'user'
  const attachment = message.attachment
  return (
    <li>
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        {mine ? 'You' : 'SayStreet'}
        <span className="sr-only"> said</span>
        {message.source === 'listing' && <span className="rounded-full border border-edge px-2 py-px text-xs font-semibold">From the listing</span>}
      </p>
      <p className={cn('mt-1', mine ? 'text-xl' : 'text-lg leading-relaxed')}>{message.text}</p>
      {attachment?.kind === 'options' && <OptionsCard options={attachment.options} conversationId={conversationId} />}
      {attachment?.kind === 'mandate' && (
        <MandateCard
          mandate={attachment.mandate}
          live={attachment.mandate.status === 'proposed' && attachment.mandate.id === liveMandateId}
          busy={busy}
          onPay={onPay}
          onCancel={onCancel}
          onExpiring={onExpiring}
        />
      )}
      {attachment?.kind === 'orders' && <OrdersCard orders={attachment.orders} />}
    </li>
  )
}
