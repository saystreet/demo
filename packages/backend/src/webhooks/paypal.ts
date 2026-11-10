import type { ApiError } from '@saystreet/shared'
import { Hono } from 'hono'
import { db } from '../db'
import type { Prisma } from '../generated/prisma/client'
import { PayPalError, verifyWebhookSignature } from '../paypal'

// POST /api/webhooks/paypal. PayPal calls it when a payment changes later:
// a pending capture completes or is denied, a refund goes through.
// Steps 1 and 2 of spec section 8.5: check the signature, store the event once.
// Updating orders and mandates (steps 3 to 5) comes with the orders table;
// until then events stay with processed_at = null.

type PayPalEvent = { id: string; event_type: string; resource?: { id?: string } }

export const paypalWebhook = new Hono()

paypalWebhook.post('/', async (c) => {
  // The signature covers the body exactly as sent, so read it raw.
  const raw = await c.req.text()

  let verified: boolean
  try {
    verified = await verifyWebhookSignature(c.req.raw.headers, raw)
  } catch (error) {
    // PayPal rejected the verification request itself: treat as not verified.
    if (error instanceof PayPalError && error.status < 500) verified = false
    // Our config is missing or PayPal is down: 500 makes PayPal retry later.
    else throw error
  }
  if (!verified) return c.json<ApiError>({ error: 'invalid_signature' }, 400)

  const event = JSON.parse(raw) as PayPalEvent
  const { count } = await db().webhookEvent.createMany({
    data: [{ id: event.id, type: event.event_type, payload: event as unknown as Prisma.InputJsonValue }],
    skipDuplicates: true,
  })
  console.log(`PayPal webhook ${event.event_type} ${event.resource?.id ?? ''}${count === 0 ? ' (duplicate)' : ''}`)

  return c.json({ ok: true })
})
