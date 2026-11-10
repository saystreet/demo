import { randomUUID } from 'node:crypto'
import { audit, fields, shortId } from '../audit'
import { db } from '../db'
import type { Order } from '../generated/prisma/client'
import { PayPalError, refundCapture } from '../paypal'
import { templates } from '../templates'
import { findOrder, type OrderWithEvents, weekday } from './service'

// "Where is it?" and "return it": finding the order the person means, saying where it is,
// refunding it. Real orders are refunded through PayPal; sample orders only in our database.

export function statusWords(order: Order): string {
  if (order.paymentStatus === 'pending') return 'waiting for PayPal'
  if (order.paymentStatus === 'refund_pending') return 'being refunded'
  switch (order.fulfillmentStatus) {
    case 'processing':
      return 'being prepared'
    case 'shipped':
      return 'on its way'
    case 'delivered':
      return order.estimatedDelivery ? `delivered on ${monthDay(order.estimatedDelivery)}` : 'delivered'
    case 'returned':
      return 'returned'
    default:
      return order.fulfillmentStatus
  }
}

export function trackingPhrase(order: Order): string {
  const inTransit = order.fulfillmentStatus === 'processing' || order.fulfillmentStatus === 'shipped'
  return templates.tracking({
    title: order.title,
    statusWords: statusWords(order),
    carrier: order.carrier,
    trackingLast4: order.trackingNumber ? order.trackingNumber.replace(/\s/g, '').slice(-4) : null,
    etaWeekday: inTransit && order.estimatedDelivery ? weekday(order.estimatedDelivery) : null,
  })
}

export type Resolved = { order: OrderWithEvents } | { error: 'NO_ORDER' } | { error: 'AMBIGUOUS'; candidates: Order[] }

// The order "where is it?" means: the one named, else this chat's order, else the only one on its way.
export async function resolveForTracking(accountId: string, conversationId: string, orderId: string | null): Promise<Resolved> {
  return resolve(accountId, conversationId, orderId, {
    fulfillmentStatus: { in: ['processing', 'shipped'] },
    paymentStatus: { in: ['paid', 'pending'] },
  })
}

// The order "return it" means: the one named, else this chat's order, else the only delivered and
// paid one from the last 30 days. What hasn't arrived yet can't be sent back.
export async function resolveForReturn(accountId: string, conversationId: string, orderId: string | null): Promise<Resolved> {
  return resolve(accountId, conversationId, orderId, {
    paymentStatus: 'paid',
    fulfillmentStatus: 'delivered',
    createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  })
}

async function resolve(
  accountId: string,
  conversationId: string,
  orderId: string | null,
  fallback: NonNullable<Parameters<ReturnType<typeof db>['order']['findMany']>[0]>['where'],
): Promise<Resolved> {
  if (orderId) {
    const order = await findOrder(accountId, orderId)
    return order ? { order } : { error: 'NO_ORDER' }
  }
  const inChat = await db().order.findFirst({
    where: { accountId, conversationId },
    orderBy: { createdAt: 'desc' },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
  if (inChat) return { order: inChat }
  const candidates = await db().order.findMany({ where: { accountId, ...fallback }, orderBy: { createdAt: 'desc' } })
  if (candidates.length === 0) return { error: 'NO_ORDER' }
  if (candidates.length > 1) return { error: 'AMBIGUOUS', candidates }
  const order = await findOrder(accountId, candidates[0]!.id)
  return order ? { order } : { error: 'NO_ORDER' }
}

export type RefundResult =
  | { status: 'done' | 'started'; order: OrderWithEvents; phrase: string }
  | { status: 'already'; order: OrderWithEvents; phrase: string }
  | { status: 'failed'; order: OrderWithEvents; phrase: string }

// Full refund. The money goes back to the person, so no spoken amount is needed to confirm.
export async function refundOrder(order: OrderWithEvents): Promise<RefundResult> {
  if (order.paymentStatus === 'refunded' || order.paymentStatus === 'refund_pending' || order.fulfillmentStatus === 'returned') {
    return { status: 'already', order, phrase: templates.alreadyRefunded() }
  }

  if (order.isSample) {
    const updated = await markRefunded(order, null, 'refunded', 'Sample order, so PayPal had nothing to refund')
    await audit(order.accountId, 'order.refunded', `SAMPLE ${fields({ order: shortId(order.id) })} refund simulated → no Payments API call`)
    return { status: 'done', order: updated, phrase: templates.sampleReturned(order.title) }
  }

  if (!order.captureId) return { status: 'failed', order, phrase: templates.refundFailed() }
  try {
    const refund = await refundCapture(order.captureId, `refund:${order.id}`)
    const done = refund.status === 'COMPLETED'
    const updated = await markRefunded(order, refund.refundId, done ? 'refunded' : 'refund_pending', null)
    await audit(order.accountId, 'order.refunded', `REFUND ${fields({ order: shortId(order.id), total: order.totalCents, capture: order.captureId, refund: refund.refundId, status: refund.status })}`)
    return { status: done ? 'done' : 'started', order: updated, phrase: done ? templates.refundDone(order.totalCents, order.title) : templates.refundStarted(order.totalCents, order.title) }
  } catch (error) {
    console.error('Refund failed', error)
    const reason = error instanceof PayPalError ? `PAYPAL_${error.status}` : 'PAYPAL_UNREACHABLE'
    await audit(order.accountId, 'order.refund_failed', `REFUND_FAILED ${fields({ order: shortId(order.id), reason })}`)
    return { status: 'failed', order, phrase: templates.refundFailed() }
  }
}

async function markRefunded(
  order: Order,
  refundId: string | null,
  paymentStatus: 'refunded' | 'refund_pending',
  note: string | null,
): Promise<OrderWithEvents> {
  const now = new Date()
  const events = [{ id: randomUUID(), status: 'return_started', createdAt: now, note: null as string | null }]
  if (paymentStatus === 'refunded') events.push({ id: randomUUID(), status: 'refunded', createdAt: new Date(now.getTime() + 1), note })
  return db().order.update({
    where: { id: order.id },
    data: {
      paymentStatus,
      fulfillmentStatus: paymentStatus === 'refunded' ? 'returned' : order.fulfillmentStatus,
      refundId,
      refundedAt: paymentStatus === 'refunded' ? now : null,
      events: { create: events },
    },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
}

function monthDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
