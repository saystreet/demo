import type { ApiError as ApiErrorBody } from '@saystreet/shared'
import { clearToken, getToken } from './session'

// Thin fetch wrapper for the SayStreet API (docs/api.md): bearer token, JSON, typed errors.

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | undefined
  readonly say: string | undefined

  constructor(status: number, body: Partial<ApiErrorBody> | null) {
    super(body?.say ?? body?.error ?? `HTTP ${status}`)
    this.status = status
    this.code = body?.error ?? 'unknown'
    this.field = body?.field
    this.say = body?.say
  }
}

// Signed out anywhere: forget the token and let the app send the person to the start.
export const SIGNED_OUT_EVENT = 'saystreet:signed-out'

export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
    headers,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  })
  const body = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    if (res.status === 401) {
      clearToken()
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
    }
    throw new ApiError(res.status, body as Partial<ApiErrorBody> | null)
  }
  return body as T
}
