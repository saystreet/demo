import { randomUUID } from 'node:crypto'
import { normalize } from '../amount/parse'
import { audit, fields, shortId } from '../audit'
import { db } from '../db'
import type { Order } from '../generated/prisma/client'
import { PayPalError, refundCapture } from '../paypal'
import { templates } from '../templates'
import { findOrder, type OrderWithEvents, type ReturnCheck, weekday } from './service'

// "Where is it?" and "return it": finding the order the person means, saying where it is,
// refunding it. Real orders are refunded through PayPal; sample orders only in our database.

export function statusWords(order: Order): string {
  if (order.paymentStatus === 'pending') return 'waiting for PayPal'
  if (order.paymentStatus === 'failed') return 'not paid: PayPal declined it'
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

// For questions about any order ("how much did I pay", "did my refund go through"): the one named,
// else this chat's order, else the only one that fits `where`.
export async function resolveOrder(
  accountId: string,
  conversationId: string,
  orderId: string | null,
  where: NonNullable<Parameters<ReturnType<typeof db>['order']['findMany']>[0]>['where'],
): Promise<Resolved> {
  return resolve(accountId, conversationId, orderId, where)
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

// What to say when an order can't be returned (canReturn's reason).
export function returnRefusal(order: Order, check: Exclude<ReturnCheck, 'ok'>): string {
  switch (check) {
    case 'already':
      return templates.alreadyRefunded()
    case 'payment_pending':
      return templates.returnPaymentPending(order.title)
    case 'not_paid':
      return templates.returnNotPaid(order.title)
    case 'not_delivered':
      return templates.notDeliveredYet(order.title)
    case 'window_closed':
      return templates.returnWindowClosed(order.title)
  }
}

// "Return it" by voice is confirmed in plain code, like a payment: the agent's request_return only
// asks, and the person's next words ("return it", "yes") are matched here, never by the model.
// Kept in memory for two minutes: lost on a restart, which only means asking again.
const RETURN_TTL_MS = 2 * 60 * 1000
const pendingReturns = new Map<string, { accountId: string; orderId: string; until: number }>()

export function askToReturn(accountId: string, conversationId: string, orderId: string) {
  pendingReturns.set(conversationId, { accountId, orderId, until: Date.now() + RETURN_TTL_MS })
}

// The order waiting for "return it" in this chat, taken (so it's asked once), or null.
export function takePendingReturn(accountId: string, conversationId: string): string | null {
  const pending = pendingReturns.get(conversationId)
  pendingReturns.delete(conversationId)
  for (const [id, p] of pendingReturns) if (p.until < Date.now()) pendingReturns.delete(id)
  return pending && pending.accountId === accountId && pending.until >= Date.now() ? pending.orderId : null
}

const RETURN_YES = new Set(['return it', 'yes return it', 'yes', 'yes please', 'yeah', 'yep', 'confirm', 'do it', 'go ahead', 'ok', 'okay', 'return', 'yes return', 'ok return it', 'okay return it', 'please return it', 'return it please', 'sure'])

export function isReturnConfirmation(text: string): boolean {
  return RETURN_YES.has(normalize(text))
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
  const events = [{ id: randomUUID(), orderId: order.id, status: 'return_started', createdAt: now, note: null as string | null }]
  if (paymentStatus === 'refunded') events.push({ id: randomUUID(), orderId: order.id, status: 'refunded', createdAt: new Date(now.getTime() + 1), note })
  return db().$transaction(async (tx) => {
    // Only from "paid": if the refund webhook (or a second tap) settled it first, that stands, and
    // the order is never moved back from "refunded" to "refund_pending".
    const { count } = await tx.order.updateMany({
      where: { id: order.id, paymentStatus: 'paid' },
      data: {
        paymentStatus,
        fulfillmentStatus: paymentStatus === 'refunded' ? 'returned' : order.fulfillmentStatus,
        refundId,
        refundedAt: paymentStatus === 'refunded' ? now : null,
      },
    })
    if (count === 1) await tx.orderEvent.createMany({ data: events })
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { events: { orderBy: { createdAt: 'asc' } } } })
  })
}

function monthDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
