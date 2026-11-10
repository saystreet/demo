// POST /api/transcribe  multipart/form-data with one field "audio"
// (audio/mp4 from Safari, audio/webm from Chrome, up to 2 MB / about 10 seconds).
// Send `text` to POST /api/turn with input: 'voice'. If nothing was heard, speak `say` instead.
export type TranscribeResponse = {
  text: string // empty when nothing was heard
  heard: boolean
  say: string | null // "I didn't catch that." when heard is false
}
