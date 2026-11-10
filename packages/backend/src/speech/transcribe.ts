import OpenAI, { toFile } from 'openai'
import { env, requireEnv } from '../env'

// Speech to text with OpenAI. The words SayStreet must not mishear are given as hints.

const KEYWORDS = ['pay', 'cancel', 'repeat', 'dollars', 'cents', 'option one', 'option two', 'option three']
// Used if the main model is unavailable.
const FALLBACK_MODEL = 'gpt-4o-mini-transcribe'
const PROMPT = 'Shopping by voice. Pay, cancel, dollars, cents, thirty-nine ninety-nine.'

let client: OpenAI | null = null
function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY'), timeout: 20_000, maxRetries: 1 })
  return client
}

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const model = env('STT_MODEL') ?? 'gpt-transcribe'
  const file = await toFile(audio, filename, { type: audio.type })
  try {
    const result = await openai().audio.transcriptions.create(
      model === 'gpt-transcribe'
        ? { model, file, languages: ['en'], keywords: KEYWORDS, prompt: PROMPT }
        : { model, file, language: 'en', prompt: PROMPT },
    )
    return result.text.trim()
  } catch (error) {
    // The main model unavailable: one try with the previous generation.
    const fallback = FALLBACK_MODEL
    if (error instanceof OpenAI.APIError && (error.status === 404 || error.status === 400) && model !== fallback) {
      console.warn(`Transcription with ${model} failed (${error.message}), trying ${fallback}`)
      const result = await openai().audio.transcriptions.create({ model: fallback, file, language: 'en', prompt: PROMPT })
      return result.text.trim()
    }
    throw error
  }
}
