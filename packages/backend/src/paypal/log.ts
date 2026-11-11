import { randomUUID } from 'node:crypto'
import { db } from '../db'

// The "At PayPal" trail: one row per call to PayPal and per verified webhook. Written right after
// the call (a few milliseconds) so the receipt shows it; it never throws: a logging failure must
// not fail a payment.

export type PayPalCallRecord = {
  method: string
  endpoint: string // path with PayPal's ids, no query string
  status: number // HTTP status (0: no answer, e.g. a timeout)
  result?: string | null // PayPal's own status: COMPLETED, PENDING…
  paypalId?: string | null
  requestId?: string | null
  debugId?: string | null
  ms: number
  refs: (string | null | undefined)[]
  label?: string
}

// What a call was, in words a judge reads: "Create order", "Capture payment"…
export function labelFor(method: string, endpoint: string): string {
  if (method === 'POST' && endpoint === '/v2/checkout/orders') return 'Create order (Orders v2, vaulted wallet)'
  if (/^\/v2\/checkout\/orders\/[^/]+\/capture$/.test(endpoint)) return 'Capture payment (Orders v2)'
  if (/^\/v2\/checkout\/orders\/[^/]+\/track$/.test(endpoint)) return 'Add tracking (Orders v2)'
  if (method === 'GET' && /^\/v2\/checkout\/orders\/[^/]+$/.test(endpoint)) return 'Look up order (Orders v2)'
  if (/^\/v2\/payments\/captures\/[^/]+\/refund$/.test(endpoint)) return 'Refund (Payments v2)'
  if (endpoint === '/v3/vault/setup-tokens') return 'Save wallet: setup token (Vault v3)'
  if (endpoint === '/v3/vault/payment-tokens') return 'Save wallet: payment token (Vault v3)'
  return `${method} ${endpoint}`
}

export async function recordPayPalCall(call: PayPalCallRecord): Promise<void> {
  const refs = [...new Set(call.refs.filter((r): r is string => typeof r === 'string' && r.length > 0))]
  await db()
    .paypalCall.create({
      data: {
        id: randomUUID(),
        label: call.label ?? labelFor(call.method, call.endpoint),
        method: call.method,
        endpoint: call.endpoint,
        status: call.status,
        result: call.result ?? null,
        paypalId: call.paypalId ?? null,
        requestId: call.requestId ?? null,
        debugId: call.debugId ?? null,
        ms: Math.round(call.ms),
        refs,
      },
    })
    .catch((error) => console.warn('PayPal call log failed', (error as Error).message))
}

// Ids in a PayPal response that tie it to our records: the resource itself, captures, refunds.
export function idsInResponse(body: unknown): string[] {
  const ids: string[] = []
  const b = body as {
    id?: string
    status?: string
    purchase_units?: { reference_id?: string; payments?: { captures?: { id?: string }[]; refunds?: { id?: string }[] } }[]
  } | null
  if (b?.id) ids.push(b.id)
  for (const unit of b?.purchase_units ?? []) {
    if (unit.reference_id) ids.push(unit.reference_id)
    for (const capture of unit.payments?.captures ?? []) if (capture.id) ids.push(capture.id)
    for (const refund of unit.payments?.refunds ?? []) if (refund.id) ids.push(refund.id)
  }
  return ids
}

// The ids in a request: PayPal's ids in the path, and ours in the request id
// ("<mandate id>", "<mandate id>:capture", "refund:<order id>", "track:<capture id>:<number>").
export function idsInRequest(endpoint: string, requestId: string | undefined): string[] {
  const fromPath = endpoint.split('/').filter((part) => /^[A-Z0-9]{10,}$/.test(part))
  const fromRequest = (requestId ?? '').split(':').filter((part) => /^[0-9a-f-]{36}$/i.test(part) || /^[A-Z0-9]{10,}$/.test(part))
  return [...fromPath, ...fromRequest]
}
