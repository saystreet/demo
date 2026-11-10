import { PaperPlaneRight, SpeakerSlash } from '@phosphor-icons/react'
import { type FormEvent, forwardRef, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { BrailleCell } from '../braille'
import { Button } from '../ui/button'

// The input area (spec 16.4, 16.10): one big Talk button, then "Type instead".
// Talk starts recording; pressing it again stops and sends. Focus stays on it after replies,
// so the next double tap records right away. Talk is the brand's yellow: the one thing to press.

type Props = {
  phase: 'idle' | 'recording' | 'transcribing' | 'thinking'
  canRecord: boolean
  spoken: boolean
  speaking: boolean
  onTalk: () => void
  onSend: (text: string) => Promise<boolean> // false: not sent, the text comes back
  onStopSpeaking: () => void
  onSpeakingEnded: () => void // called if Stop speaking had focus when the voice finished
  talkHint?: string // a line under Talk, also read as its description
}

export const Composer = forwardRef<HTMLInputElement, Props>(function Composer(
  { phase, canRecord, spoken, speaking, onTalk, onSend, onStopSpeaking, onSpeakingEnded, talkHint },
  inputRef,
) {
  const [text, setText] = useState('')
  const stopHadFocus = useRef(false)

  // "Stop speaking" disappears when the voice ends; if it had focus, hand focus back.
  useEffect(() => {
    if (speaking) return
    if (stopHadFocus.current) onSpeakingEnded()
    stopHadFocus.current = false
  }, [speaking, onSpeakingEnded])

  const busy = phase === 'transcribing' || phase === 'thinking'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const clean = text.trim()
    if (!clean || busy) return
    setText('')
    // A failed send gives the words back, so nobody has to retype (or re-paste) them.
    if (!(await onSend(clean.slice(0, 500)))) setText((now) => now || clean)
  }

  const talkLabel = phase === 'recording' ? 'Stop and send' : phase === 'transcribing' ? 'Writing it down…' : phase === 'thinking' ? 'SayStreet is answering…' : 'Talk'

  return (
    <form aria-label="Message" onSubmit={submit} className="grid gap-3">
      {canRecord && (
        <button
          id="talk"
          type="button"
          onClick={() => !busy && onTalk()}
          aria-disabled={busy || undefined}
          // Holding Space anywhere outside a field or control talks too (spec 16.10).
          aria-keyshortcuts="Space"
          aria-describedby={talkHint ? 'talk-hint' : undefined}
          className={cn(
            'relative flex min-h-14 w-full items-center justify-center gap-4 rounded-full text-xl font-bold transition-colors duration-150 sm:min-h-16 forced-colors:border-2',
            phase === 'recording'
              ? 'bg-ground text-accent ring-3 ring-accent ring-inset'
              : busy
                ? 'cursor-wait bg-surface-3 text-ink'
                : 'bg-accent text-accent-ink hover:bg-accent-bright',
          )}
        >
          <BrailleCell mode={phase === 'recording' ? 'listen' : busy ? 'think' : 'still'} className="h-8" dim="opacity-25" />
          {talkLabel}
          {/* The shortcut, the way menus show one: only with a keyboard and mouse, only at rest. */}
          {phase === 'idle' && (
            <kbd
              aria-hidden="true"
              className="absolute right-5 hidden rounded-md border border-accent-ink/35 px-2 py-0.5 font-sans text-sm font-semibold sm:right-7 [@media(pointer:fine)]:block"
            >
              Hold Space
            </kbd>
          )}
        </button>
      )}

      {canRecord && talkHint && (
        <p id="talk-hint" className="-mt-1 text-center text-sm text-ink-muted">
          {talkHint}
        </p>
      )}

      {/* On phones the placeholder says it; the label stays for screen readers. */}
      <label htmlFor="type-instead" className="-mb-1 text-sm font-semibold text-ink-muted max-sm:sr-only">
        {canRecord ? 'Type instead' : 'Type a message'}
      </label>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          id="type-instead"
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={500}
          autoComplete="off"
          placeholder="Message SayStreet"
          className="min-h-12 w-full rounded-full border border-edge bg-surface-1 px-5 text-base text-ink placeholder:text-ink-muted hover:border-ink focus-visible:border-accent"
        />
        <Button type="submit" variant="secondary" aria-disabled={busy || !text.trim() || undefined}>
          <PaperPlaneRight aria-hidden="true" size={20} weight="bold" />
          Send
        </Button>
      </div>

      {spoken && speaking && (
        <Button
          variant="secondary"
          onClick={onStopSpeaking}
          onFocus={() => (stopHadFocus.current = true)}
          // Removing a focused button can fire blur with no new target: only a real move clears the flag.
          onBlur={(event) => {
            if (event.relatedTarget) stopHadFocus.current = false
          }}
          className="justify-self-start"
        >
          <SpeakerSlash aria-hidden="true" size={20} weight="bold" />
          Stop speaking
        </Button>
      )}
    </form>
  )
})
