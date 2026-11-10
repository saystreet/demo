import { randomUUID } from 'node:crypto'
import type { FulfillmentStatus, OrderSummary, OrderView, PaymentStatus, ShippingAddress } from '@saystreet/shared'
import { db } from '../db'
import { env } from '../env'
import type { Mandate, Order, OrderEvent, Prisma } from '../generated/prisma/client'

export type OrderWithEvents = Order & { events: OrderEvent[] }

// Delivery date: DELIVERY_DAYS business days after the order (spec 7.5). Dates are UTC.
export function estimatedDelivery(from: Date, days = Number(env('DELIVERY_DAYS') ?? 3)): Date {
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
): Promise<OrderWithEvents> {
  const now = new Date()
  const id = randomUUID()
  return db().order.create({
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
export async function spentThisWeek(accountId: string, client: Pick<ReturnType<typeof db>, 'order'> = db()): Promise<number> {
  const result = await client.order.aggregate({
    _sum: { totalCents: true },
    where: {
      accountId,
      isSample: false,
      paymentStatus: { in: ['paid', 'pending'] },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  })
  return result._sum.totalCents ?? 0
}

export async function listOrders(accountId: string): Promise<OrderSummary[]> {
  const rows = await db().order.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } })
  return rows.map(toOrderSummary)
}

export async function findOrder(accountId: string, id: string): Promise<OrderWithEvents | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  return db().order.findFirst({ where: { id, accountId }, include: { events: { orderBy: { createdAt: 'asc' } } } })
}

export function toOrderSummary(order: Order): OrderSummary {
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
    events: order.events.map((e) => ({ status: e.status, note: e.note, created_at: e.createdAt.toISOString() })),
  }
}
