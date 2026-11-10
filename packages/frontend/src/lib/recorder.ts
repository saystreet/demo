import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Voice recording for the Talk button (spec 16.10): MediaRecorder, audio/mp4 in Safari,
// audio/webm;codecs=opus in Chrome, stops by itself after 20 seconds.
//
// "starting" covers the wait for the microphone (the permission prompt on first use), so the
// button already says "Stop" and a second press can't start a second recorder. Every start ends
// in exactly one callback: onDone with the audio, onDone(null) when there is nothing to send
// (stopped before the microphone was live, an empty recording, the page left), or onError.

export type RecorderState = 'idle' | 'starting' | 'recording' | 'unsupported'
export type RecorderError = 'denied' | 'failed'

const MAX_MS = 20_000
const WARN_MS = 3_000 // a short sound this long before the automatic stop
const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

type Callbacks = {
  onDone: (audio: Blob | null) => void
  onError: (error: RecorderError) => void
  onEnding?: () => void
}

export function useRecorder(onDone: Callbacks['onDone'], onError: Callbacks['onError'], onEnding?: () => void) {
  const supported = typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia
  const [state, setState] = useState<RecorderState>(supported ? 'idle' : 'unsupported')
  const active = useRef(false) // a start is in progress or recording
  const stopRequested = useRef(false)
  const disposed = useRef(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const timers = useRef<number[]>([])
  const callbacks = useRef<Callbacks>({ onDone, onError, onEnding })
  useLayoutEffect(() => {
    callbacks.current = { onDone, onError, onEnding }
  })

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current = []
  }, [])

  const finish = useCallback(
    (result: { audio: Blob | null } | { error: RecorderError }) => {
      clearTimers()
      active.current = false
      stopRequested.current = false
      recorder.current = null
      if (!disposed.current) setState('idle')
      if ('error' in result) callbacks.current.onError(result.error)
      else callbacks.current.onDone(disposed.current ? null : result.audio)
    },
    [clearTimers],
  )

  const stop = useCallback(() => {
    if (!active.current) return
    if (recorder.current?.state === 'recording') recorder.current.stop()
    else stopRequested.current = true // still waiting for the microphone
  }, [])

  const start = useCallback(async () => {
    if (!supported || active.current) return
    active.current = true
    stopRequested.current = false
    setState('starting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (error) {
      finish({ error: (error as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'failed' })
      return
    }
    const release = () => {
      for (const track of stream.getTracks()) track.stop()
    }
    // Let go of Space (or pressed Stop) before the microphone was live, or left the page.
    if (stopRequested.current || disposed.current) {
      release()
      finish({ audio: null })
      return
    }

    let media: MediaRecorder
    const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    const chunks: Blob[] = []
    try {
      media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      media.onstop = () => {
        release()
        const blob = new Blob(chunks, { type: media.mimeType || mimeType || 'audio/mp4' })
        finish({ audio: blob.size ? blob : null })
      }
      media.start()
    } catch {
      release()
      finish({ error: 'failed' })
      return
    }
    recorder.current = media
    setState('recording')
    timers.current = [window.setTimeout(() => callbacks.current.onEnding?.(), MAX_MS - WARN_MS), window.setTimeout(stop, MAX_MS)]
  }, [supported, stop, finish])

  // Leaving the page while recording: stop the microphone and send nothing.
  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
      stop()
    }
  }, [stop])

  return { state, start, stop }
}
