import { randomUUID } from 'node:crypto'
import { type FulfillmentStatus, type OrderSummary, type OrderView, type PaymentStatus, RETURN_DAYS, type ShippingAddress } from '@saystreet/shared'
import { db } from '../db'
import { DELIVERY_DAYS } from '../env'
import type { Mandate, Order, OrderEvent, Prisma } from '../generated/prisma/client'

export type OrderWithEvents = Order & { events: OrderEvent[]; mandate?: Pick<Mandate, 'heardCents' | 'confirmMethod' | 'decidedAt'> | null }

const DAY = 24 * 60 * 60 * 1000

// When it was delivered: the delivered event if we have the history, else the delivery date the
// order carries (set to the actual day when it's marked delivered).
function deliveredOn(order: Order & { events?: OrderEvent[] }): Date | null {
  if (order.fulfillmentStatus !== 'delivered' && order.fulfillmentStatus !== 'returned') return null
  const event = order.events?.findLast((e) => e.status === 'delivered')
  return event?.createdAt ?? order.estimatedDelivery ?? null
}

// The one return rule, used by the order page, its route and the voice agent: paid, delivered,
// and no more than RETURN_DAYS after delivery. What hasn't arrived can't be sent back.
export function returnWindow(order: Order & { events?: OrderEvent[] }, now = new Date()): { returnable: boolean; returnBy: Date | null } {
  const delivered = order.fulfillmentStatus === 'delivered' ? deliveredOn(order) : null
  const returnBy = delivered ? new Date(delivered.getTime() + RETURN_DAYS * DAY) : null
  const returnable = order.paymentStatus === 'paid' && order.fulfillmentStatus === 'delivered' && !!returnBy && now.getTime() <= returnBy.getTime()
  return { returnable, returnBy }
}

// Whether "return it" can go ahead, and if not, why: the same answer for the order page's button
// and the voice agent.
export type ReturnCheck = 'ok' | 'already' | 'payment_pending' | 'not_paid' | 'not_delivered' | 'window_closed'

export function canReturn(order: Order & { events?: OrderEvent[] }, now = new Date()): ReturnCheck {
  if (order.paymentStatus === 'refunded' || order.paymentStatus === 'refund_pending' || order.fulfillmentStatus === 'returned') return 'already'
  if (order.paymentStatus === 'pending') return 'payment_pending'
  if (order.paymentStatus !== 'paid') return 'not_paid'
  if (order.fulfillmentStatus !== 'delivered') return 'not_delivered'
  return returnWindow(order, now).returnable ? 'ok' : 'window_closed'
}

const iso = (date: Date | null) => (date ? date.toISOString() : null)

// Delivery date: DELIVERY_DAYS business days after the order (spec 7.5). Dates are UTC.
export function estimatedDelivery(from: Date, days = DELIVERY_DAYS): Date {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  let left = days
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1)
    const day = date.getUTCDay()
    if (day !== 0 && day !== 6) left--
  }
  return date
}

export function weekday(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

// Order for a payment PayPal accepted (paid) or is still processing (pending).
export async function createOrderFromPayment(
  mandate: Mandate,
  merchantDomain: string,
  payment: { paypalOrderId: string; captureId: string | null; status: 'paid' | 'pending' },
  client: Pick<ReturnType<typeof db>, 'order'> = db(),
): Promise<OrderWithEvents> {
  const now = new Date()
  const id = randomUUID()
  return client.order.create({
    data: {
      id,
      accountId: mandate.accountId,
      mandateId: mandate.id,
      conversationId: mandate.conversationId,
      paypalOrderId: payment.paypalOrderId,
      captureId: payment.captureId,
      paymentStatus: payment.status,
      fulfillmentStatus: 'processing',
      productId: mandate.productId,
      productSource: mandate.productSource,
      sourceUrl: mandate.sourceUrl,
      merchantDomain,
      title: mandate.title,
      merchant: mandate.merchant,
      imageUrl: mandate.imageUrl,
      itemCents: mandate.itemCents,
      shippingCents: mandate.shippingCents,
      totalCents: mandate.totalCents,
      shipTo: mandate.shipTo as Prisma.InputJsonValue,
      estimatedDelivery: estimatedDelivery(now),
      createdAt: now,
      events: {
        create: [
          { id: randomUUID(), status: 'ordered', createdAt: now },
          {
            id: randomUUID(),
            status: payment.status === 'paid' ? 'paid' : 'payment_pending',
            note: payment.status === 'paid' ? 'PayPal confirmed' : 'PayPal is processing',
            createdAt: new Date(now.getTime() + 1),
          },
        ],
      },
    },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
}

// Paid or pending real purchases in the last 7 days. Sample and refunded orders don't count.
// Neither does nothing: a payment still going through, or one whose answer PayPal never gave us
// (a mandate "paying" or "pending" with no order yet), may well have taken the money, so it counts.
export async function spentThisWeek(accountId: string, client: Pick<ReturnType<typeof db>, 'order' | 'mandate'> = db()): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  // One after the other: this also runs inside the payment transaction, which takes one query at a time.
  const orders = await client.order.aggregate({
    _sum: { totalCents: true },
    where: { accountId, isSample: false, paymentStatus: { in: ['paid', 'pending'] }, createdAt: { gte: since } },
  })
  const unsettled = await client.mandate.aggregate({
    _sum: { totalCents: true },
    where: { accountId, status: { in: ['paying', 'pending', 'paid'] }, order: { is: null }, createdAt: { gte: since } },
  })
  return (orders._sum.totalCents ?? 0) + (unsettled._sum.totalCents ?? 0)
}

export async function listOrders(accountId: string): Promise<OrderSummary[]> {
  const rows = await db().order.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } })
  return rows.map(toOrderSummary)
}

export async function findOrder(accountId: string, id: string): Promise<OrderWithEvents | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  return db().order.findFirst({
    where: { id, accountId },
    include: { events: { orderBy: { createdAt: 'asc' } }, mandate: { select: { heardCents: true, confirmMethod: true, decidedAt: true } } },
  })
}

export function toOrderSummary(order: Order & { events?: OrderEvent[] }): OrderSummary {
  const window = returnWindow(order)
  return {
    order_id: order.id,
    title: order.title,
    merchant: order.merchant,
    image_url: order.imageUrl,
    total_cents: order.totalCents,
    payment_status: order.paymentStatus as PaymentStatus,
    fulfillment_status: order.fulfillmentStatus as FulfillmentStatus,
    estimated_delivery: order.estimatedDelivery ? order.estimatedDelivery.toISOString().slice(0, 10) : null,
    is_sample: order.isSample,
    created_at: order.createdAt.toISOString(),
    delivered_at: iso(deliveredOn(order)),
    returnable: window.returnable,
    return_by: iso(window.returnBy),
  }
}

export function toOrderView(order: OrderWithEvents): OrderView {
  return {
    ...toOrderSummary(order),
    product_id: order.productId,
    product_source: order.productSource as OrderView['product_source'],
    source_url: order.sourceUrl,
    merchant_domain: order.merchantDomain,
    paypal_order_id: order.paypalOrderId,
    capture_id: order.captureId,
    item_cents: order.itemCents,
    shipping_cents: order.shippingCents,
    ship_to: order.shipTo as ShippingAddress,
    carrier: order.carrier,
    tracking_number: order.trackingNumber,
    conversation_id: order.conversationId,
    events: order.events.map((e) => ({ id: e.id, status: e.status, note: e.note, created_at: e.createdAt.toISOString() })),
    confirmation:
      order.mandate?.confirmMethod && order.mandate.decidedAt
        ? { method: order.mandate.confirmMethod === 'voice' ? 'voice' : 'button', heard_cents: order.mandate.heardCents, at: order.mandate.decidedAt.toISOString() }
        : null,
    paypal_tracker_id: order.paypalTrackerId,
    refund_id: order.refundId,
    refunded_at: order.refundedAt ? order.refundedAt.toISOString() : null,
  }
}
