import type { ApiError } from '@saystreet/shared'
import { Hono } from 'hono'
import { db } from '../db'
import type { Prisma } from '../generated/prisma/client'
import { PayPalError, verifyWebhookSignature } from '../paypal'
import { type PayPalEvent, processEvent } from './process'

// POST /api/webhooks/paypal (spec 8.5). PayPal calls it when a payment changes later.
// 1. Verify the signature with PayPal. 2. Store the event once by its id.
// 3–5. Update the order and mandate, tell the chat (webhooks/process.ts). 6. Mark it processed.
// If processing fails we answer 500: PayPal retries, and the stored but unprocessed event runs again.

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
  await db().webhookEvent.createMany({
    data: [{ id: event.id, type: event.event_type, payload: event as unknown as Prisma.InputJsonValue }],
    skipDuplicates: true,
  })
  const stored = await db().webhookEvent.findUnique({ where: { id: event.id } })
  if (stored?.processedAt) {
    console.log(`PayPal webhook ${event.event_type} ${event.resource?.id ?? ''}: duplicate`)
    return c.json({ ok: true })
  }

  try {
    const outcome = await processEvent(event)
    await db().webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } })
    console.log(`PayPal webhook ${event.event_type} ${event.resource?.id ?? ''}: ${outcome}`)
    return c.json({ ok: true })
  } catch (error) {
    console.error(`PayPal webhook ${event.event_type} ${event.id} failed`, error)
    return c.json<ApiError>({ error: 'processing_failed' }, 500)
  }
})
