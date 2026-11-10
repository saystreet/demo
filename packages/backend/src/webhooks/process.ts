import { randomUUID } from 'node:crypto'
import { audit, fields, shortId } from '../audit'
import { addMessages } from '../conversations/service'
import { db } from '../db'
import type { Order } from '../generated/prisma/client'
import { createOrderFromPayment, weekday } from '../orders/service'
import { paypalRequest } from '../paypal/client'
import { templates } from '../templates'

// What a verified PayPal webhook changes (spec 8.5, steps 3–5). PayPal tells us here about things
// that settle later: a pending capture completing or being denied, a refund going through.
// Every update is idempotent: if the API response already set the state, the webhook changes nothing.

type Link = { href: string; rel: string }
type Resource = {
  id?: string
  status?: string
  links?: Link[]
  supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } }
}
export type PayPalEvent = { id: string; event_type: string; resource?: Resource }

export async function processEvent(event: PayPalEvent): Promise<string> {
  const resource = event.resource ?? {}
  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED':
      return captureSettled(resource, 'paid')
    case 'PAYMENT.CAPTURE.PENDING':
      return captureSettled(resource, 'pending')
    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED':
      return captureSettled(resource, 'failed')
    case 'PAYMENT.CAPTURE.REFUNDED':
      return refunded(resource)
    default:
      return 'ignored'
  }
}

// ---- Captures ------------------------------------------------------------

async function captureSettled(resource: Resource, outcome: 'paid' | 'pending' | 'failed'): Promise<string> {
  const captureId = resource.id ?? null
  const paypalOrderId = resource.supplementary_data?.related_ids?.order_id ?? null

  const order =
    (captureId ? await db().order.findUnique({ where: { captureId } }) : null) ??
    (paypalOrderId ? await db().order.findUnique({ where: { paypalOrderId } }) : null)
  if (!order) return paypalOrderId ? recoverMandate(paypalOrderId, captureId, outcome) : 'no matching order'

  // Already where the webhook would put it (usually set by the API response): nothing to do.
  if (order.paymentStatus === outcome || order.paymentStatus === 'refunded' || order.paymentStatus === 'refund_pending') {
    return `unchanged (${order.paymentStatus})`
  }
  if (order.paymentStatus !== 'pending') return `unchanged (${order.paymentStatus})`
  if (outcome === 'pending') return 'unchanged (pending)'

  await db().order.update({
    where: { id: order.id },
    data: {
      paymentStatus: outcome,
      captureId: order.captureId ?? captureId,
      events: {
        create: [{ id: randomUUID(), status: outcome, note: outcome === 'paid' ? 'PayPal confirmed (webhook)' : 'PayPal declined (webhook)' }],
      },
    },
  })
  if (order.mandateId) {
    await db().mandate.updateMany({ where: { id: order.mandateId, status: 'pending' }, data: { status: outcome, decidedAt: new Date() } })
  }
  await audit(order.accountId, `webhook.${outcome}`, `WEBHOOK ${outcome.toUpperCase()} ${fields({ order: shortId(order.id), capture: captureId })}`, {
    mandateId: order.mandateId,
  })
  await tellChat(order.conversationId, outcome === 'paid' ? templates.paid(order.totalCents, weekday(order.estimatedDelivery ?? new Date())) : templates.failed())
  return `order ${shortId(order.id)} → ${outcome}`
}

// The payment call timed out twice, so we never learned its result and made no order; the mandate
// waits as "pending". PayPal's order carries the mandate id as reference_id, so we can match it now.
async function recoverMandate(paypalOrderId: string, captureId: string | null, outcome: 'paid' | 'pending' | 'failed'): Promise<string> {
  const paypalOrder = await paypalRequest<{ purchase_units?: { reference_id?: string }[] }>('GET', `/v2/checkout/orders/${paypalOrderId}`)
  const mandateId = paypalOrder.purchase_units?.[0]?.reference_id
  if (!mandateId || !/^[0-9a-f-]{36}$/i.test(mandateId)) return 'no matching order'
  const mandate = await db().mandate.findUnique({ where: { id: mandateId } })
  if (!mandate || mandate.status !== 'pending') return 'no matching order'

  if (outcome === 'failed') {
    await db().mandate.update({ where: { id: mandate.id }, data: { status: 'failed', decidedAt: new Date() } })
    await audit(mandate.accountId, 'webhook.failed', `WEBHOOK FAILED ${fields({ mandate: shortId(mandate.id), paypal_order: paypalOrderId })}`, { mandateId: mandate.id })
    await tellChat(mandate.conversationId, templates.failed())
    return `mandate ${shortId(mandate.id)} → failed`
  }

  const order = await createOrderFromPayment(mandate, mandate.offerDomain, { paypalOrderId, captureId, status: outcome })
  if (outcome === 'paid') await db().mandate.update({ where: { id: mandate.id }, data: { status: 'paid', decidedAt: new Date() } })
  await audit(mandate.accountId, `webhook.${outcome}`, `WEBHOOK ${outcome.toUpperCase()} ${fields({ mandate: shortId(mandate.id), order: shortId(order.id), paypal_order: paypalOrderId, capture: captureId })} (recovered)`, {
    mandateId: mandate.id,
  })
  if (outcome === 'paid') await tellChat(mandate.conversationId, templates.paid(order.totalCents, weekday(order.estimatedDelivery ?? new Date())))
  return `mandate ${shortId(mandate.id)} recovered → order ${shortId(order.id)} ${outcome}`
}

// ---- Refunds -------------------------------------------------------------

async function refunded(resource: Resource): Promise<string> {
  const refundId = resource.id ?? null
  // A refund links to its capture: .../v2/payments/captures/{capture_id}
  const captureId =
    resource.supplementary_data?.related_ids?.capture_id ??
    resource.links?.find((l) => l.rel === 'up')?.href.match(/\/captures\/([^/?]+)/)?.[1] ??
    null

  const order: Order | null =
    (refundId ? await db().order.findFirst({ where: { refundId } }) : null) ??
    (captureId ? await db().order.findUnique({ where: { captureId } }) : null)
  if (!order) return 'no matching order'
  if (order.paymentStatus === 'refunded') return 'unchanged (refunded)'
  if (resource.status && resource.status !== 'COMPLETED') return `unchanged (refund ${resource.status})`

  const hadReturnStarted = order.paymentStatus === 'refund_pending'
  const now = new Date()
  await db().order.update({
    where: { id: order.id },
    data: {
      paymentStatus: 'refunded',
      fulfillmentStatus: 'returned',
      refundId: order.refundId ?? refundId,
      refundedAt: now,
      events: {
        create: [
          ...(hadReturnStarted ? [] : [{ id: randomUUID(), status: 'return_started', createdAt: now }]),
          { id: randomUUID(), status: 'refunded', note: 'PayPal confirmed (webhook)', createdAt: new Date(now.getTime() + 1) },
        ],
      },
    },
  })
  await audit(order.accountId, 'webhook.refunded', `WEBHOOK REFUNDED ${fields({ order: shortId(order.id), refund: refundId, capture: captureId })}`)
  await tellChat(order.conversationId, templates.refundDone(order.totalCents, order.title))
  return `order ${shortId(order.id)} → refunded`
}

// The news goes into the chat where the purchase happened; the person hears it when they open it.
async function tellChat(conversationId: string | null, text: string) {
  if (conversationId) await addMessages(conversationId, [{ role: 'system', source: 'system', text }])
}
