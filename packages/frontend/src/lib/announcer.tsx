import type { VoiceMode } from '@saystreet/shared'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// One way out for everything SayStreet says (spec 16.9).
// - screen_reader: phrases go to one polite live region; VoiceOver reads them in its own voice.
//   No role="alert" or aria-live="assertive": on iOS those double-read.
// - spoken: the browser's own voice reads them (speechSynthesis), one at a time, 300 ms apart.
// While the person is recording, nothing is said; phrases wait until recording ends.

type Announcer = {
  say: (phrases: string[]) => void
  stop: () => void
  hold: (on: boolean) => void
  speaking: boolean
  configure: (mode: VoiceMode, rate: number) => void
}

const Context = createContext<Announcer | null>(null)
const GAP_MS = 300
const REGION_KEEP = 10

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [region, setRegion] = useState<{ id: number; text: string }[]>([])
  const [speaking, setSpeaking] = useState(false)
  const mode = useRef<VoiceMode>('screen_reader')
  const rate = useRef(1)
  const queue = useRef<string[]>([])
  const held = useRef(false)
  const busy = useRef(false)
  const nextId = useRef(0)

  const pump = useCallback(() => {
    if (busy.current || held.current) return
    const text = queue.current.shift()
    if (text === undefined) {
      setSpeaking(false)
      return
    }
    busy.current = true
    const done = () => {
      busy.current = false
      window.setTimeout(pump, GAP_MS)
    }

    // The live region always gets the phrase, in both modes.
    setRegion((items) => [...items, { id: nextId.current++, text }].slice(-REGION_KEEP))

    if (mode.current === 'spoken' && 'speechSynthesis' in window) {
      setSpeaking(true)
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'en-US'
      utterance.rate = rate.current
      const voice = bestVoice()
      if (voice) utterance.voice = voice
      utterance.onend = done
      utterance.onerror = done
      window.speechSynthesis.speak(utterance)
    } else {
      // Give VoiceOver time to start one phrase before the next lands in the region.
      window.setTimeout(done, 40)
    }
  }, [])

  const say = useCallback(
    (phrases: string[]) => {
      const clean = phrases.map((p) => p.trim()).filter(Boolean)
      if (!clean.length) return
      queue.current.push(...clean)
      pump()
    },
    [pump],
  )

  const stop = useCallback(() => {
    queue.current = []
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    busy.current = false
    setSpeaking(false)
  }, [])

  const hold = useCallback(
    (on: boolean) => {
      held.current = on
      if (!on) pump()
    },
    [pump],
  )

  const configure = useCallback((nextMode: VoiceMode, nextRate: number) => {
    mode.current = nextMode
    rate.current = nextRate
  }, [])

  // Escape stops the voice anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && speakingNow()) stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stop])

  const value = useMemo(() => ({ say, stop, hold, speaking, configure }), [say, stop, hold, speaking, configure])

  return (
    <Context.Provider value={value}>
      {children}
      <div aria-live="polite" className="sr-only">
        {region.map((item) => (
          <p key={item.id}>{item.text}</p>
        ))}
      </div>
    </Context.Provider>
  )
}

export function useAnnouncer(): Announcer {
  const value = useContext(Context)
  if (!value) throw new Error('useAnnouncer outside AnnouncerProvider')
  return value
}

function speakingNow() {
  return 'speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)
}

// The clearest English voice available: enhanced and premium system voices first,
// then Google's network voice in Chrome, then any US English voice.
let cachedVoice: SpeechSynthesisVoice | null | undefined
function bestVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined && cachedVoice !== null) return cachedVoice
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
  if (!voices.length) return null
  const score = (v: SpeechSynthesisVoice) =>
    (/premium|enhanced/i.test(v.name) ? 8 : 0) +
    (/google us english/i.test(v.name) ? 6 : 0) +
    (/samantha|ava|allison|susan|zoe/i.test(v.name) ? 4 : 0) +
    (v.lang === 'en-US' ? 2 : 0) +
    (v.localService ? 1 : 0)
  cachedVoice = [...voices].sort((a, b) => score(b) - score(a))[0] ?? null
  return cachedVoice
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    cachedVoice = undefined
  })
}
