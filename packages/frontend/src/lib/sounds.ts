import type { Sound } from '@saystreet/shared'

// Short earcons, each under 300 ms and distinct in pitch and rhythm, so they tell events apart
// without words. Web Audio only starts after a user gesture (Safari), so `unlockAudio` runs on
// the first tap.

export type Earcon = Sound | 'record_start' | 'record_stop' | 'tick' | 'select' | 'on' | 'off' | 'open' | 'close' | 'done'

type Note = { f: number; at: number; dur: number; type?: OscillatorType; gain?: number }

const EARCONS: Record<Earcon, Note[]> = {
  record_start: [{ f: 660, at: 0, dur: 0.08 }, { f: 990, at: 0.07, dur: 0.1 }],
  record_stop: [{ f: 990, at: 0, dur: 0.08 }, { f: 660, at: 0.07, dur: 0.1 }],
  sent: [{ f: 880, at: 0, dur: 0.06, gain: 0.12 }],
  // Micro-sounds for small actions: a choice, a switch, a dialog, something saved or copied.
  select: [{ f: 620, at: 0, dur: 0.045, type: 'triangle', gain: 0.07 }],
  on: [{ f: 540, at: 0, dur: 0.05, type: 'triangle', gain: 0.08 }, { f: 810, at: 0.05, dur: 0.07, type: 'triangle', gain: 0.08 }],
  off: [{ f: 810, at: 0, dur: 0.05, type: 'triangle', gain: 0.07 }, { f: 540, at: 0.05, dur: 0.07, type: 'triangle', gain: 0.07 }],
  open: [{ f: 440, at: 0, dur: 0.05, type: 'sine', gain: 0.07 }, { f: 587, at: 0.05, dur: 0.08, type: 'sine', gain: 0.07 }],
  close: [{ f: 587, at: 0, dur: 0.05, type: 'sine', gain: 0.06 }, { f: 440, at: 0.05, dur: 0.08, type: 'sine', gain: 0.06 }],
  done: [{ f: 784, at: 0, dur: 0.06, type: 'triangle', gain: 0.09 }, { f: 1175, at: 0.06, dur: 0.1, type: 'triangle', gain: 0.09 }],
  tick: [{ f: 520, at: 0, dur: 0.035, gain: 0.06 }],
  reply: [{ f: 740, at: 0, dur: 0.09, type: 'triangle' }],
  options: [{ f: 587, at: 0, dur: 0.07, type: 'triangle' }, { f: 740, at: 0.08, dur: 0.07, type: 'triangle' }, { f: 880, at: 0.16, dur: 0.09, type: 'triangle' }],
  mandate: [{ f: 523, at: 0, dur: 0.12, type: 'triangle' }, { f: 523, at: 0.16, dur: 0.12, type: 'triangle' }],
  paid: [{ f: 659, at: 0, dur: 0.11 }, { f: 988, at: 0.12, dur: 0.16 }],
  refused: [{ f: 220, at: 0, dur: 0.26, type: 'square', gain: 0.08 }],
  cancelled: [{ f: 440, at: 0, dur: 0.08, type: 'triangle' }, { f: 330, at: 0.09, dur: 0.12, type: 'triangle' }],
  error: [{ f: 300, at: 0, dur: 0.1, type: 'sawtooth', gain: 0.07 }, { f: 240, at: 0.12, dur: 0.14, type: 'sawtooth', gain: 0.07 }],
}

let context: AudioContext | null = null
let enabled = true

export function soundsEnabled() {
  return enabled
}

export function setSoundsEnabled(on: boolean) {
  enabled = on
}

export function unlockAudio() {
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    context = new Ctor()
  }
  if (context.state === 'suspended') void context.resume()
}

export function play(earcon: Earcon | null | undefined, force = false) {
  if (!earcon || (!enabled && !force) || !context || context.state !== 'running') return
  const now = context.currentTime
  for (const note of EARCONS[earcon]) {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = note.type ?? 'sine'
    osc.frequency.value = note.f
    const peak = note.gain ?? 0.16
    gain.gain.setValueAtTime(0.0001, now + note.at)
    gain.gain.exponentialRampToValueAtTime(peak, now + note.at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.dur)
    osc.connect(gain).connect(context.destination)
    osc.start(now + note.at)
    osc.stop(now + note.at + note.dur + 0.02)
  }
}
