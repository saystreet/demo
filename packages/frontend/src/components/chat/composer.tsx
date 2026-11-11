import { ArrowUp, Microphone, SpeakerSlash, Stop } from '@phosphor-icons/react'
import { type FormEvent, forwardRef, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMe } from '../../api/queries'
import { cn } from '../../lib/cn'

// The input (spec 16.4, 16.10): one row, always the same size. Talk is first and the only filled
// control; the field comes next, then one slot on the right that holds Send while there is text and
// Stop speaking while SayStreet talks. Nothing here changes size or moves: the states change the
// icon and the placeholder, and the page's live region says what is happening.
//
// Talk's visible word and its name agree (WCAG 2.5.3): "Talk" now, "Stop" while recording, and the
// name then is "Stop and send". While SayStreet is working the label stays and the cell animates over it.

type Props = {
  phase: 'idle' | 'recording' | 'transcribing' | 'thinking'
  canRecord: boolean
  spoken: boolean
  speaking: boolean
  onTalk: () => void
  onSend: (text: string) => Promise<boolean> // false: not sent, the text comes back
  onStopSpeaking: () => void
  onSpeakingEnded: () => void // called if Stop speaking had focus when the voice finished
  talkHint?: string // read with Talk as its description (not drawn)
}

export const Composer = forwardRef<HTMLInputElement, Props>(function Composer(
  { phase, canRecord, spoken, speaking, onTalk, onSend, onStopSpeaking, onSpeakingEnded, talkHint },
  inputRef,
) {
  const [text, setText] = useState('')
  const stopHadFocus = useRef(false)

  // "Stop speaking" leaves when the voice ends; if it had focus, hand focus back.
  useEffect(() => {
    if (speaking) return
    if (stopHadFocus.current) onSpeakingEnded()
    stopHadFocus.current = false
  }, [speaking, onSpeakingEnded])

  const busy = phase === 'transcribing' || phase === 'thinking'
  const recording = phase === 'recording'
  const clean = text.trim()
  const slot: 'send' | 'stop' | null = clean ? 'send' : spoken && speaking ? 'stop' : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!clean || busy) return
    setText('')
    // A failed send gives the words back, so nobody has to retype (or re-paste) them.
    if (!(await onSend(clean.slice(0, 500)))) setText((now) => now || clean)
  }

  return (
    <form aria-label="Message" onSubmit={submit}>
      <div className="flex items-center gap-1.5 rounded-full border border-edge bg-surface-1 p-1.5 focus-within:border-ink">
        {canRecord && (
          <button
            id="talk"
            type="button"
            onClick={() => !busy && onTalk()}
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            aria-label={recording ? 'Stop and send' : undefined}
            // Holding Space anywhere outside a field or control talks too (spec 16.10).
            aria-keyshortcuts="Space"
            aria-describedby={talkHint ? 'talk-hint' : undefined}
            className={cn(
              'relative inline-flex h-12 w-28 shrink-0 items-center justify-center gap-2 rounded-full text-lg font-bold active:scale-95 sm:h-14 forced-colors:border-2',
              recording ? 'bg-ground text-accent ring-3 ring-accent ring-inset' : 'bg-accent text-accent-ink hover:bg-accent-bright', busy && 'cursor-wait',
            )}
          >
            {/* The icon's place: the mic, Stop, or the cell while SayStreet works. The word stays. */}
            <span aria-hidden="true" className="grid size-6 place-items-center">
              {recording ? <Stop size={22} weight="fill" /> : <Microphone size={24} weight="fill" />}
            </span>
            {recording ? 'Stop' : 'Talk'}
          </button>
        )}
        {talkHint && (
          <span id="talk-hint" className="sr-only">
            {talkHint}
          </span>
        )}

        <label htmlFor="type-instead" className="sr-only">
          Type a message
        </label>
        <input
          id="type-instead"
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          readOnly={recording}
          maxLength={500}
          autoComplete="off"
          enterKeyHint="send"
          placeholder={recording ? 'Listening…' : phase === 'transcribing' ? 'Writing it down…' : phase === 'thinking' ? 'Thinking…' : canRecord ? 'Or type here' : 'Message SayStreet'}
          className="h-12 min-w-0 flex-1 bg-transparent px-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none sm:h-14 sm:px-3"
        />

        {/* One slot, one size: Send, Stop speaking, or nothing (the space stays). */}
        <div className="grid size-12 shrink-0 place-items-center sm:size-14">
          {slot === 'send' && (
            <button
              type="submit"
              aria-disabled={busy || undefined}
              className="grid size-11 place-items-center rounded-full bg-ink text-accent-ink hover:bg-white sm:size-12 forced-colors:border-2"
            >
              <ArrowUp aria-hidden="true" size={22} weight="bold" />
              <span className="sr-only">Send</span>
            </button>
          )}
          {slot === 'stop' && (
            <button
              type="button"
              onClick={onStopSpeaking}
              onFocus={() => (stopHadFocus.current = true)}
              // Removing a focused button can fire blur with no new target: only a real move clears the flag.
              onBlur={(event) => {
                if (event.relatedTarget) stopHadFocus.current = false
              }}
              className="grid size-11 place-items-center rounded-full border border-edge hover:border-ink hover:bg-surface-2 sm:size-12 forced-colors:border-2"
            >
              <SpeakerSlash aria-hidden="true" size={22} weight="bold" />
              <span className="sr-only">Stop speaking</span>
            </button>
          )}
        </div>
      </div>

      <LimitsLine showShortcut={canRecord} />
    </form>
  )
})

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

// What is left to spend, under the input where the buying happens: the shortcut on the left (with a
// keyboard), the weekly limit on the right, one tap to change it. A ring, not a bar, and words first.
function LimitsLine({ showShortcut }: { showShortcut?: boolean }) {
  const { data: me } = useMe()
  if (!me) return <div className="h-11" />
  const { spent_this_week_cents: spent, weekly_cents: weekly } = me.limits
  const share = weekly > 0 ? Math.min(1, spent / weekly) : 0
  const r = 7
  const circumference = 2 * Math.PI * r
  return (
    <div className="flex h-11 items-center justify-between gap-3 px-1 text-sm text-ink-muted">
      <span aria-hidden="true" className="hidden px-2 [@media(pointer:fine)]:block">
        {showShortcut ? 'Hold Space to talk' : ''}
      </span>
      <Link to="/settings" className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-full px-3 hover:bg-surface-1 hover:text-ink">
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5 shrink-0 -rotate-90">
          <circle cx="10" cy="10" r={r} fill="none" strokeWidth="3" className="stroke-surface-3" />
          <circle
            cx="10"
            cy="10"
            r={r}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className="stroke-accent"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - (spent > 0 ? Math.max(share, 0.04) : 0))}
          />
        </svg>
        <span className="sr-only">
          Weekly limit: {dollars(spent)} of {dollars(weekly)} spent. Opens settings.
        </span>
        <span aria-hidden="true">
          <span className="data text-ink">{dollars(spent)}</span> / {dollars(weekly)} weekly
        </span>
      </Link>
    </div>
  )
}
