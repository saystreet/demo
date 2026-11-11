import type { ConversationState, MandateView, Message, TurnRequest, TurnResponse } from '@saystreet/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useParams } from 'react-router'
import {
  applyTurn,
  cancelMandate,
  extendMandate,
  keys,
  payMandate,
  sendTurn,
  transcribe,
  useConversation,
  useMe,
} from '../api/queries'
import { type BuyChoice, MandateCard, OptionsCard, OrdersCard } from '../components/chat/cards'
import { BrailleCell } from '../components/braille'
import { Composer } from '../components/chat/composer'
import { Starters, STARTERS } from '../components/chat/starters'
import { ErrorLine, LoadingLine, PageTitle, usePageTitle } from '../components/page'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { cn } from '../lib/cn'
import { useRecorder } from '../lib/recorder'
import { play } from '../lib/sounds'

// The conversation (spec 16.4, 15.2–15.8). Everything SayStreet says comes back in a
// TurnResponse; its new messages are added to the transcript, spoken in order, and marked with
// a short sound. Old messages are never spoken again, and focus never moves on its own.

// Buying comes first: one open question to answer out loud, then the two worries before the first
// press, how to say it and what gets paid. Orders (track, return) wait in the suggestions below.
const HEADING = 'What are you shopping for today?'
// Spoken mode says this once; it carries the one rule worth knowing before the first purchase.
// The rule no other store has, set apart from the two steps above.
const ERROR = 'Something went wrong on my side. Nothing was paid. Try again.'
// The welcome's three jobs. Buying starts from a search; tracking and returning use the sample
// orders every demo account starts with, each landing on exactly one of them.

type Work = 'idle' | 'transcribing' | 'thinking'
// What is happening, and in which chat it started. The page stays mounted across chats, so a
// reply still on its way must not show up, or keep Talk busy, in the chat the person moved to.
type Turn = { work: Work; chat: string | undefined; text: string | null; token: number }
const IDLE: Turn = { work: 'idle', chat: undefined, text: null, token: 0 }

export default function ChatPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { say, stop: stopVoice, hold, speaking } = useAnnouncer()
  const { data: me } = useMe()
  const chat = useConversation(id)
  const [turn, setTurn] = useState<Turn>(IDLE)
  // The last problem, shown as text too: earcons and the hidden live region aren't enough for
  // a sighted or low-vision person without a screen reader.
  const [notice, setNotice] = useState<{ text: string; chat: string | undefined } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const tokens = useRef(0)
  const spoken = me?.voice_mode === 'spoken'

  // Where the person is now (null once they've left the chat page); replies check it.
  const here = useRef<string | undefined | null>(id)
  useLayoutEffect(() => {
    here.current = id
    return () => {
      here.current = null
    }
  }, [id])

  const title = id ? (chat.data?.conversation.title ?? 'Chat') : 'New chat'
  usePageTitle(title)


  // Back from PayPal after choosing "my own PayPal sandbox account" on the start page: said once,
  // then taken off the address. A failure keeps the demo buyer, so the demo still works.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('paypal')
    if (!outcome) return
    // Connected: the toast (raised once, by the app shell) answers. Cancelled or failed: the PayPal step says so.
    if (outcome !== 'connected') say([outcome === 'cancelled' ? 'Cancelled on PayPal. The sandbox buyer will pay.' : "PayPal didn't connect, so purchases pay with the sandbox demo buyer."])
    void client.invalidateQueries({ queryKey: keys.me })
    window.history.replaceState(window.history.state, '', window.location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, [])

  const current = turn.chat === id ? turn : IDLE
  const shownNotice = notice && notice.chat === id ? notice.text : null

  // A quiet tick while waiting more than a second, every 1.5 s.
  const waiting = current.work !== 'idle'
  useEffect(() => {
    if (!waiting) return
    let tick: number | undefined
    const start = window.setTimeout(() => {
      play('tick')
      tick = window.setInterval(() => play('tick'), 1500)
    }, 1000)
    return () => {
      window.clearTimeout(start)
      window.clearInterval(tick)
    }
  }, [waiting])

  // Once the first message of a new chat is on its way, the input stays docked at the bottom, even
  // for the render between the answer arriving and the chat getting its address. Without this the
  // chat looked empty for a moment and the input slid to the middle and back.
  const [started, setStarted] = useState(false)
  const dockFrom = useRef<number | null>(null)
  const begin = useCallback((work: Work, text: string | null = null) => {
    const token = ++tokens.current
    setTurn({ work, chat: here.current ?? undefined, text, token })
    // The moment a message goes out (typed, or a recording that has just stopped) the chat has begun:
    // the input drops down and the message shows, without waiting for the server.
    if (here.current === undefined) {
      dockFrom.current = barRef.current?.getBoundingClientRect().top ?? null
      setStarted(true)
    }
    return token
  }, [])
  // Only the turn that started it may end it: an older reply landing late leaves a newer one alone.
  const end = useCallback((token: number) => setTurn((t) => (t.token === token ? IDLE : t)), [])

  const speak = useCallback(
    (response: TurnResponse) => {
      play(response.sound)
      say(response.messages.filter((m) => m.role !== 'user').map((m) => m.text))
    },
    [say],
  )

  // Returns false when the person has moved on: the reply is saved and shows in the sidebar, but
  // it doesn't pull them back or talk over the page they're on now.
  const handle = useCallback(
    (response: TurnResponse, origin: string | undefined) => {
      applyTurn(client, response)
      if (here.current !== origin) return false
      if (!origin) navigate(`/chat/${response.conversation.id}`, { replace: true, state: { keepFocus: true } })
      speak(response)
      return true
    },
    [client, navigate, speak],
  )

  useEffect(() => {
    if (!id) setStarted(false)
  }, [id])

  const tell = useCallback(
    (text: string, origin: string | undefined) => {
      if (here.current !== origin) return
      play('error')
      setNotice({ text, chat: origin })
      say([text])
    },
    [say],
  )

  const fail = useCallback(
    (error: unknown, origin: string | undefined) => {
      // Signed out: the app is already on its way to the start screen.
      if (error instanceof ApiError && error.status === 401) return
      // Nothing was sent into a new chat: it is empty again.
      if (!origin) setStarted(false)
      tell(error instanceof ApiError && error.say ? error.say : ERROR, origin)
    },
    [tell],
  )

  // Controls that vanish (Pay, Cancel, suggestions, Stop speaking) hand focus to Talk.
  const focusTalk = useCallback(() => {
    ;(document.getElementById('talk') ?? inputRef.current)?.focus()
  }, [])

  const send = useCallback(
    async (text: string, input: 'voice' | 'text', buy?: TurnRequest['buy']) => {
      const origin = id
      stopVoice()
      play('sent')
      setNotice(null)
      const token = begin('thinking', text)
      // A screen reader hears it once, through the live region; the line in the chat is for the eyes.
      say(['Thinking…'], 'status')
      try {
        handle(await sendTurn({ conversation_id: origin, text, input, ...(buy ? { buy } : {}) }), origin)
        return true
      } catch (error) {
        fail(error, origin)
        return false
      } finally {
        end(token)
      }
    },
    [id, stopVoice, begin, end, handle, fail],
  )

  // Pressing Stop already is the sending: the message's place is held at that moment, not when the
  // recording finishes saving.
  const stopToken = useRef<number | null>(null)
  const recorder = useRecorder(
    async (audio) => {
      hold(false)
      play('record_stop')
      const origin = here.current ?? undefined
      const early = stopToken.current
      stopToken.current = null
      if (!audio) {
        // Stopped before the microphone was live, or the page was left: nothing was said.
        if (early !== null) end(early)
        if (!origin) setStarted(false)
        return
      }
      const token = early ?? begin('transcribing')
      try {
        const result = await transcribe(audio)
        if (!result.heard) {
          // Nothing was said after all: the chat that was starting is empty again.
          if (!origin) setStarted(false)
          tell(result.say ?? "I didn't catch that. Try again.", origin)
          return
        }
        if (here.current !== origin) return
        await send(result.text, 'voice')
      } catch (error) {
        fail(error, origin)
      } finally {
        end(token)
      }
    },
    (error) => {
      hold(false)
      // Stop was pressed (the message's place was held), but the microphone never worked.
      if (stopToken.current !== null) end(stopToken.current)
      stopToken.current = null
      if (!here.current) setStarted(false)
      tell(
        error === 'denied'
          ? 'Microphone access is blocked. Type instead, or allow the microphone in your browser.'
          : "The microphone didn't start. Type instead.",
        here.current ?? undefined,
      )
      inputRef.current?.focus()
    },
    // Three seconds before the automatic stop.
    () => play('tick'),
  )

  const recording = recorder.state === 'starting' || recorder.state === 'recording'
  // The start tone sounds when the microphone is really live, so nobody starts speaking into a dead one.
  useEffect(() => {
    if (recorder.state === 'recording') play('record_start')
  }, [recorder.state])
  const phase = recording ? 'recording' : current.work

  const stopRecording = useCallback(() => {
    stopToken.current = begin('transcribing')
    recorder.stop()
  }, [begin, recorder])

  const talk = useCallback(() => {
    if (recording) {
      stopRecording()
      return
    }
    if (current.work !== 'idle') return
    // Talk silences SayStreet at once; nothing is said while recording.
    stopVoice()
    hold(true)
    void recorder.start()
  }, [recording, current.work, recorder, stopRecording, stopVoice, hold])

  // Leaving the page while held (mid-recording) must never leave the announcer silent.
  useEffect(() => () => hold(false), [hold])

  // Hold Space to talk, when focus isn't in a field or on a control (spec 16.10).
  useEffect(() => {
    const isFree = (target: EventTarget | null) =>
      !(target instanceof HTMLElement) || !target.closest('input, textarea, select, button, a, [role="menuitem"], [role="radio"], [role="dialog"]')
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || !isFree(event.target) || recording || current.work !== 'idle') return
      event.preventDefault()
      talk()
    }
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !isFree(event.target) || !recording) return
      event.preventDefault()
      stopRecording()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [talk, recording, current.work, stopRecording])

  // After a payment request failed without a clear answer (the connection dropped, a 502), the
  // money may still have moved. Ask the server what happened instead of guessing.
  const checkPayment = useCallback(
    async (mandate: MandateView, origin: string | undefined) => {
      say(["I couldn't confirm the payment. Checking…"], 'status')
      try {
        await client.invalidateQueries({ queryKey: keys.conversation(mandate.conversation_id) })
        void client.invalidateQueries({ queryKey: keys.orders })
        const state = client.getQueryData<ConversationState>(keys.conversation(mandate.conversation_id))
        const latest = state?.messages
          .map((m) => (m.attachment?.kind === 'mandate' && m.attachment.mandate.id === mandate.id ? m.attachment.mandate : null))
          .filter((m): m is MandateView => m !== null)
          .at(-1)
        const status = state?.mandate?.id === mandate.id ? 'proposed' : latest?.status
        const text =
          status === 'paid'
            ? 'The payment went through. Check Orders for the details.'
            : status === 'paying' || status === 'pending'
              ? "PayPal is still processing. Don't pay again."
              : 'Nothing was paid.'
        tell(text, origin)
      } catch {
        tell("I couldn't check the payment. Look in Orders before you pay again.", origin)
      }
    },
    [client, say, tell],
  )

  const decide = useCallback(
    async (mandate: MandateView, kind: 'pay' | 'cancel') => {
      const origin = id
      stopVoice()
      setNotice(null)
      const token = begin('thinking')
      try {
        handle(await (kind === 'pay' ? payMandate(mandate.id, mandate.total_cents) : cancelMandate(mandate.id)), origin)
      } catch (error) {
        const certain = error instanceof ApiError && (!!error.say || error.status < 500)
        if (kind === 'pay' && !certain) await checkPayment(mandate, origin)
        else fail(error, origin)
      } finally {
        // Commit Talk's idle label first, so focus doesn't land on "SayStreet is answering…".
        flushSync(() => end(token))
        // The Pay and Cancel buttons are gone now; don't leave focus on the page.
        if (here.current === origin) focusTalk()
      }
    },
    [id, stopVoice, begin, end, handle, fail, checkPayment, focusTalk],
  )

  const onPay = useCallback((mandate: MandateView) => decide(mandate, 'pay'), [decide])
  const onCancel = useCallback((mandate: MandateView) => decide(mandate, 'cancel'), [decide])
  const onExpiring = useCallback(() => say(['30 seconds left to pay. Press More time if you need longer.']), [say])
  const onExpired = useCallback(
    (mandate: MandateView) => {
      say(['This payment expired. Nothing was paid.'])
      void client.invalidateQueries({ queryKey: keys.conversation(mandate.conversation_id) })
    },
    [client, say],
  )
  const onExtend = useCallback(
    async (mandate: MandateView) => {
      try {
        await extendMandate(client, mandate)
        say(['Two more minutes.'], 'status')
      } catch (error) {
        fail(error, id)
        void client.invalidateQueries({ queryKey: keys.conversation(mandate.conversation_id) })
      }
    },
    [client, say, fail, id],
  )
  // Buy on a card is the person asking, in the chat, to buy that product: their line says "Buy …", and the
  // product itself (never found again by its title) and what they chose on the card go with it. The server
  // asks for what is missing or prepares the payment, so every Buy, on any list, behaves the same way.
  const onChoose = useCallback(
    (choice: BuyChoice) => {
      if (phase !== 'idle') return
      focusTalk()
      const choices = choice.selection.map((s) => s.value).join(', ')
      void send(`Buy ${choice.title}${choices ? `, ${choices}` : ''}`.slice(0, 300), 'text', {
        product_id: choice.product_id,
        merchant_domain: choice.merchant_domain,
        selection: choice.selection,
      })
    },
    [phase, focusTalk, send],
  )
  // "More options" under the latest list: the same as saying "more".
  const onMore = useCallback(() => {
    if (phase !== 'idle') return
    focusTalk()
    void send('More options', 'text')
  }, [phase, focusTalk, send])


  // A suggestion: these buttons disappear once the chat starts, so focus goes to Talk, not the page.
  const start = useCallback(
    (text: string) => {
      if (phase !== 'idle') return
      focusTalk()
      void send(text, 'text')
    },
    [phase, focusTalk, send],
  )

  const messages: Message[] = chat.data?.messages ?? []
  const liveMandate = chat.data?.mandate ?? null
  const latestOptionsId = messages.findLast((m) => m.attachment?.kind === 'options')?.id ?? null
  const options = chat.data?.options ?? null
  const pendingText = current.text

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
  const lastId = messages.at(-1)?.id
  useLayoutEffect(() => {
    // An empty chat stays at the top, with its welcome in view.
    if (!lastId && !pendingText) return
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [id, lastId, pendingText])

  const empty = !started && !id && messages.length === 0 && !pendingText

  // The input sits in the middle of an empty chat and drops to the bottom with the first message. It is
  // one element in both places; this slides it between them (FLIP) so nothing jumps.
  // The start position was read at rest, when the message went out; this runs once when the chat stops
  // being empty and only then looks at the layout.
  useLayoutEffect(() => {
    const from = dockFrom.current
    dockFrom.current = null
    const bar = barRef.current
    if (empty || from === null || !bar || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const delta = from - bar.getBoundingClientRect().top
    if (Math.abs(delta) < 4) return
    bar.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
  }, [empty])

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4.1rem)] max-w-3xl flex-col px-4 sm:px-8 lg:min-h-dvh">
      {empty ? (
        // An empty chat leads with what to do, and the input is right under it.
        <div className="flex-[2] pt-10" />
      ) : (
        <div className="pt-6 pb-2 sm:pt-10">
          <PageTitle className="text-2xl sm:text-3xl">{title}</PageTitle>
        </div>
      )}
      {empty && (
        <h1 tabIndex={-1} className="pb-6 text-center text-3xl leading-tight font-bold text-balance sm:text-4xl">
          {HEADING}
        </h1>
      )}

      {id && chat.isPending && <LoadingLine label="Loading the chat…" />}
      {id && chat.isError &&
        (chat.error instanceof ApiError && chat.error.status === 404 ? (
          <p className="py-6 text-lg">This chat was deleted or doesn't exist. Choose New chat to start another.</p>
        ) : (
          <ErrorLine message="Couldn't load this chat." onRetry={() => chat.refetch()} />
        ))}

      {messages.length > 0 || pendingText || current.work === 'transcribing' ? (
        <ol className="grid flex-1 content-start gap-8 pt-4 pb-8" aria-label="Messages">
          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              conversationId={id ?? null}
              liveMandate={liveMandate}
              busy={phase !== 'idle'}
              onPay={onPay}
              onCancel={onCancel}
              onExpiring={onExpiring}
              onExpired={onExpired}
              onExtend={onExtend}
              onChoose={onChoose}
              onMore={message.id === latestOptionsId ? onMore : null}
              active={message.id === latestOptionsId}
            />
          ))}
          {pendingText && (
            <li>
              <p className="text-sm font-semibold text-ink-muted">
                You<span className="sr-only"> said</span>
              </p>
              <p className="mt-1 text-xl">{pendingText}</p>
            </li>
          )}
          {current.work === 'transcribing' && (
            // A recording was just sent: its place is held at once, and the words replace it.
            <li>
              <p className="text-sm font-semibold text-ink-muted">
                You<span className="sr-only"> said</span>
              </p>
              <p className="mt-1 flex items-center gap-3 text-xl text-ink-muted">
                <BrailleCell mode="think" className="h-6 text-accent" />
                <span className="sr-only">Writing it down…</span>
              </p>
            </li>
          )}
          {current.work === 'thinking' && (
            // The wait, in the conversation where the answer will appear: the cell and one word.
            <li className="flex items-center gap-3 text-ink-muted">
              <BrailleCell mode="think" className="h-6 text-accent" />
              Thinking…
            </li>
          )}
        </ol>
      ) : (
        !empty && <div className="flex-1" />
      )}
      <div ref={endRef} style={{ scrollMarginBottom: 'calc(var(--composer-h, 10rem) + 1rem)' }} />

      <div
        ref={barRef}
        // In a conversation the bar sticks to the bottom and never moves again. An empty chat has it
        // in the middle, under the heading.
        className={cn(
          'z-10 bg-ground pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          empty ? 'static' : 'sticky bottom-0 [@media(max-height:32rem)]:static',
        )}
      >
        {/* Not a live region (the announcer already said it), but readable when VoiceOver comes back to it. */}
        {shownNotice && <p className="mb-3 px-3 font-semibold text-bad">{shownNotice}</p>}
        <Composer
          ref={inputRef}
          phase={phase}
          canRecord={recorder.state !== 'unsupported'}
          spoken={spoken}
          speaking={speaking}
          onTalk={talk}
          onSend={(text) => send(text, 'text')}
          onStopSpeaking={() => {
            stopVoice()
            focusTalk()
          }}
          onSpeakingEnded={focusTalk}
          // Read with Talk itself, so a VoiceOver user hears it before the first recording.
          talkHint={empty && !spoken ? "Use headphones so the microphone doesn't hear your screen reader." : undefined}
        />
      </div>
      {empty ? (
        // Examples to start from; they leave with the first message.
        <div className="flex flex-[3] flex-col items-center pt-4 pb-10">
          <h2 className="sr-only">Try saying</h2>
          <Starters items={STARTERS} onPick={start} />
        </div>
      ) : (
        <div className="pb-2" />
      )}
    </div>
  )
}

type ItemProps = {
  message: Message
  conversationId: string | null
  liveMandate: MandateView | null
  busy: boolean
  onPay: (mandate: MandateView) => void
  onCancel: (mandate: MandateView) => void
  onExpiring: () => void
  onExpired: (mandate: MandateView) => void
  onExtend: (mandate: MandateView) => void
  onChoose: (choice: BuyChoice) => void
  active: boolean // the newest list of options in the chat
  onMore: (() => void) | null // set on the latest options only
}

// The spoken list of options ("Three options. One: …, $31.09 with shipping. Two: …") is for the
// ear; on screen the card below shows the same list, so the text keeps only its first sentence.
// A screen reader user swiping through the chat then hears the options once, not twice.
function optionsIntro(text: string) {
  const match = /^((?:One|Two|Three)(?: more)? options?(?: from [^.]+)?\.)\s/.exec(text)
  return match ? match[1] : text
}

function MessageItem({ message, conversationId, liveMandate, busy, onPay, onCancel, onExpiring, onExpired, onExtend, onChoose, onMore, active }: ItemProps) {
  const mine = message.role === 'user'
  const attachment = message.attachment
  const text = attachment?.kind === 'options' ? optionsIntro(message.text) : message.text
  // The card's own copy is a snapshot from when it was sent; the live one has the current expiry.
  const mandate = attachment?.kind === 'mandate' ? (liveMandate?.id === attachment.mandate.id ? liveMandate : attachment.mandate) : null
  return (
    <li>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
        {mine ? 'You' : 'SayStreet'}
        <span className="sr-only">{message.source === 'listing' ? ' said, from the listing:' : ' said:'}</span>
        {message.source === 'listing' && (
          <span aria-hidden="true" className="rounded-full border border-edge px-2 py-px text-xs font-semibold">
            From the listing
          </span>
        )}
      </p>
      <p className={cn('mt-1', mine ? 'text-xl' : 'text-lg leading-relaxed')}>{text}</p>
      {attachment?.kind === 'options' && (
        <OptionsCard
          options={attachment.options}
          conversationId={conversationId}
          busy={busy}
          onChoose={onChoose}
          active={active}
          paying={liveMandate !== null}
          // The server offers "more" in the spoken list when the search has further options.
          onMore={onMore && message.text.includes('"more"') ? onMore : null}
        />
      )}
      {mandate && (
        <MandateCard
          mandate={mandate}
          live={mandate.status === 'proposed' && mandate.id === liveMandate?.id}
          busy={busy}
          onPay={onPay}
          onCancel={onCancel}
          onExpiring={onExpiring}
          onExpired={onExpired}
          onExtend={onExtend}
        />
      )}
      {attachment?.kind === 'orders' && <OrdersCard orders={attachment.orders} />}
    </li>
  )
}
