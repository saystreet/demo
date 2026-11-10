import { useCallback, useEffect, useRef, useState } from 'react'

// Voice recording for the Talk button (spec 16.10): MediaRecorder, audio/mp4 in Safari,
// audio/webm;codecs=opus in Chrome, stops by itself after 10 seconds.

export type RecorderState = 'idle' | 'recording' | 'unsupported'
export type RecorderError = 'denied' | 'failed'

const MAX_MS = 10_000
const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

export function useRecorder(onDone: (audio: Blob) => void, onError: (error: RecorderError) => void) {
  const supported = typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia
  const [state, setState] = useState<RecorderState>(supported ? 'idle' : 'unsupported')
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<number | null>(null)
  const callbacks = useRef({ onDone, onError })
  callbacks.current = { onDone, onError }

  const stop = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])

  const start = useCallback(async () => {
    if (!supported || recorder.current?.state === 'recording') return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (error) {
      callbacks.current.onError((error as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'failed')
      return
    }
    const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    media.onstop = () => {
      for (const track of stream.getTracks()) track.stop()
      setState('idle')
      recorder.current = null
      const blob = new Blob(chunks, { type: media.mimeType || mimeType || 'audio/mp4' })
      if (blob.size) callbacks.current.onDone(blob)
    }
    recorder.current = media
    media.start()
    setState('recording')
    timer.current = window.setTimeout(stop, MAX_MS)
  }, [supported, stop])

  useEffect(() => () => stop(), [stop])

  return { state, start, stop }
}
