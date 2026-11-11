import { env, requireEnv } from '../env'
import { idsInRequest, idsInResponse, recordPayPalCall } from './log'

// Low-level PayPal REST client: OAuth token, JSON requests, timeouts, errors.

const TIMEOUT_MS = 15_000

export function paypalBaseUrl(): string {
  return (env('PAYPAL_BASE_URL') ?? 'https://api-m.sandbox.paypal.com').replace(/\/+$/, '')
}

export class PayPalError extends Error {
  readonly status: number
  readonly debugId: string | null
  readonly body: unknown

  constructor(status: number, body: unknown, debugId: string | null) {
    const name = (body as { name?: string; error?: string } | null)?.name ?? (body as { error?: string } | null)?.error
    super(`PayPal ${status}${name ? ` ${name}` : ''}${debugId ? ` (debug_id ${debugId})` : ''}`)
    this.status = status
    this.debugId = debugId
    this.body = body
  }
}

// ---- Access token -------------------------------------------------------

type CachedToken = { value: string; expiresAt: number }

let cached: CachedToken | null = null
// One shared request, so parallel calls don't ask for a token twice.
let pending: Promise<string> | null = null

export async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.value
  pending ??= fetchToken().finally(() => {
    pending = null
  })
  return pending
}

async function fetchToken(): Promise<string> {
  const id = requireEnv('PAYPAL_CLIENT_ID')
  const secret = requireEnv('PAYPAL_CLIENT_SECRET')
  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await readJson(res)
  if (!res.ok) throw new PayPalError(res.status, body, res.headers.get('paypal-debug-id'))
  const { access_token, expires_in } = body as { access_token: string; expires_in: number }
  // Refresh a minute early.
  cached = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 }
  return access_token
}

// ---- Requests -----------------------------------------------------------

type RequestOptions = {
  body?: unknown
  // PayPal-Request-Id: retrying with the same id returns the same result instead of acting twice.
  requestId?: string
}

export async function paypalRequest<T>(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
  if (options.requestId) headers['PayPal-Request-Id'] = options.requestId

  const started = Date.now()
  const endpoint = path.split('?')[0]!
  let res: Response
  try {
    res = await fetch(`${paypalBaseUrl()}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    // No answer (a timeout, the network): on the trail too, so a retried call reads as such.
    if (shouldLog(endpoint)) await recordPayPalCall({ method, endpoint, status: 0, result: 'NO_ANSWER', requestId: options.requestId, ms: Date.now() - started, refs: idsInRequest(endpoint, options.requestId) })
    throw error
  }
  const body = await readJson(res)
  const debugId = res.headers.get('paypal-debug-id')
  if (shouldLog(endpoint)) {
    const b = body as { id?: string; status?: string; name?: string } | null
    await recordPayPalCall({
      method,
      endpoint,
      status: res.status,
      result: res.ok ? (b?.status ?? null) : (b?.name ?? null),
      paypalId: res.ok ? (b?.id ?? null) : null,
      requestId: options.requestId,
      debugId,
      ms: Date.now() - started,
      refs: [...idsInRequest(endpoint, options.requestId), ...(res.ok ? idsInResponse(body) : [])],
    })
  }
  if (!res.ok) {
    if (res.status === 401) cached = null
    throw new PayPalError(res.status, body, debugId)
  }
  return body as T
}

// Webhook signature checks are logged with the webhook itself (webhooks/paypal.ts): anyone can
// trigger one, so they don't get rows of their own.
const shouldLog = (endpoint: string) => endpoint !== '/v1/notifications/verify-webhook-signature'

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ---- Helpers ------------------------------------------------------------

export type Link = { href: string; rel: string; method?: string }

export function findLink(links: Link[] | undefined, rel: string): string | null {
  return links?.find((link) => link.rel === rel)?.href ?? null
}

// Integer cents to PayPal's decimal string: 3999 → "39.99".
export function toPayPalValue(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Invalid cents: ${cents}`)
  return (cents / 100).toFixed(2)
}
