import { PaperPlaneRight, SpeakerSlash } from '@phosphor-icons/react'
import { type FormEvent, forwardRef, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { BrailleCell } from '../braille'
import { Button } from '../ui/button'

// The input area (spec 16.4, 16.10): one big Talk button, then "Type instead".
// Talk starts recording; pressing it again stops and sends. Focus stays on it after replies,
// so the next double tap records right away.

type Props = {
  phase: 'idle' | 'recording' | 'transcribing' | 'thinking'
  canRecord: boolean
  spoken: boolean
  speaking: boolean
  onTalk: () => void
  onSend: (text: string) => void
  onStopSpeaking: () => void
  onSpeakingEnded: () => void // called if Stop speaking had focus when the voice finished
}

export const Composer = forwardRef<HTMLInputElement, Props>(function Composer(
  { phase, canRecord, spoken, speaking, onTalk, onSend, onStopSpeaking, onSpeakingEnded },
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

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const clean = text.trim()
    if (!clean || busy) return
    onSend(clean.slice(0, 500))
    setText('')
  }

  const talkLabel = phase === 'recording' ? 'Stop and send' : phase === 'transcribing' ? 'Listening back…' : phase === 'thinking' ? 'SayStreet is answering…' : 'Talk'

  return (
    <form aria-label="Message" onSubmit={submit} className="grid gap-3">
      {canRecord && (
        <button
          id="talk"
          type="button"
          onClick={() => !busy && onTalk()}
          aria-disabled={busy || undefined}
          className={cn(
            'flex min-h-16 w-full items-center justify-center gap-4 rounded-full text-xl font-bold transition-colors duration-150 forced-colors:border-2',
            phase === 'recording' ? 'bg-accent text-accent-ink' : 'bg-ink text-accent-ink hover:bg-white',
            busy && 'cursor-wait bg-surface-3 text-ink hover:bg-surface-3',
          )}
        >
          <BrailleCell mode={phase === 'recording' ? 'listen' : busy ? 'think' : 'still'} className="h-8" dim="opacity-25" />
          {talkLabel}
        </button>
      )}

      <label htmlFor="type-instead" className="-mb-1 text-sm font-semibold text-ink-muted">
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
          placeholder="Or paste a product link"
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
