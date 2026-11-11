import type { ApiError, TranscribeResponse } from '@saystreet/shared'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { type AuthEnv, requireAccount } from '../auth'
import { clientIp, consume, LIMITS } from '../limits'
import { templates } from '../templates'
import { transcribe } from './transcribe'

export const speechRoutes = new Hono<AuthEnv>()

const MAX_BYTES = 2 * 1024 * 1024
const AUDIO_TYPES = /^audio\/(mp4|m4a|x-m4a|aac|webm|ogg|mpeg|mp3|wav|x-wav)(;|$)/

// POST /api/transcribe  multipart, field "audio". See TranscribeResponse.
speechRoutes.post(
  '/transcribe',
  requireAccount,
  bodyLimit({ maxSize: MAX_BYTES + 64 * 1024, onError: (c) => c.json<ApiError>({ error: 'audio_too_large' }, 413) }),
  async (c) => {
    const form = await c.req.parseBody().catch(() => null)
    const audio = form?.audio
    if (!(audio instanceof File) || audio.size === 0) return c.json<ApiError>({ error: 'missing_audio' }, 400)
    if (audio.size > MAX_BYTES) return c.json<ApiError>({ error: 'audio_too_large' }, 413)
    if (!AUDIO_TYPES.test(audio.type)) return c.json<ApiError>({ error: 'unsupported_audio' }, 400)

    const over = await consume([
      { key: 'transcriptions:hour:all', window: 'hour', max: LIMITS.transcriptionsPerHour },
      { key: 'transcriptions:all', window: 'day', max: LIMITS.transcriptionsPerDay },
      { key: `transcriptions:account:${c.var.account.id}`, window: 'day', max: LIMITS.transcriptionsPerAccountDay },
      { key: `transcriptions:ip:${clientIp(c)}`, window: 'day', max: LIMITS.transcriptionsPerIpDay },
    ])
    if (over) return c.json<ApiError>({ error: 'busy', say: templates.busy() }, 429)

    try {
      const text = await transcribe(audio, audio.name || filenameFor(audio.type))
      // Less than two characters is noise, not a request.
      const heard = text.replace(/[^\p{L}\p{N}]/gu, '').length >= 2
      return c.json<TranscribeResponse>({ text: heard ? text : '', heard, say: heard ? null : templates.notHeard() })
    } catch (error) {
      console.error('Transcription failed', error)
      return c.json<ApiError>({ error: 'transcription_failed' }, 502)
    }
  },
)

function filenameFor(type: string): string {
  if (type.includes('webm')) return 'speech.webm'
  if (type.includes('ogg')) return 'speech.ogg'
  if (type.includes('wav')) return 'speech.wav'
  if (type.includes('mpeg') || type.includes('mp3')) return 'speech.mp3'
  return 'speech.m4a'
}
