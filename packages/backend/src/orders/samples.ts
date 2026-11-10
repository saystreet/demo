import { randomUUID } from 'node:crypto'
import type { ShippingAddress } from '@saystreet/shared'
import type { C3Product } from '../catalog/channel3'
import { fixtureSearch } from '../catalog/fixtures'
import { mainImage, merchantFromDomain, normalizeDomain, offerPriceCents, pickOffer } from '../catalog/offers'
import { shippingCents } from '../env'
import type { Prisma } from '../generated/prisma/client'
import { estimatedDelivery } from './service'

// Four sample purchases every demo account starts with (spec section 4.1), so Orders and
// "where is my order" have something to show. Real products from the recorded catalog,
// never sent to PayPal, marked "Sample". Tracking numbers are labelled (demo).

type Sample = {
  query: string
  index: number
  daysAgo: number
  paymentStatus: 'paid' | 'refunded'
  fulfillmentStatus: 'processing' | 'shipped' | 'delivered' | 'returned'
  carrier: string | null
  trackingNumber: string | null
  // [status, days after the order]
  events: [string, number][]
}

const SAMPLES: Sample[] = [
  {
    query: 'french press',
    index: 0,
    daysAgo: 14,
    paymentStatus: 'paid',
    fulfillmentStatus: 'delivered',
    carrier: 'USPS (demo)',
    trackingNumber: '9400 1000 0000 0000 0001',
    events: [['ordered', 0], ['paid', 0], ['shipped', 1], ['out_for_delivery', 3], ['delivered', 3]],
  },
  {
    query: 'electric kettle',
    index: 0,
    daysAgo: 3,
    paymentStatus: 'paid',
    fulfillmentStatus: 'shipped',
    carrier: 'UPS (demo)',
    trackingNumber: '1Z999AA10000000002',
    events: [['ordered', 0], ['paid', 0], ['shipped', 1], ['in_transit', 2]],
  },
  {
    query: 'french press',
    index: 1,
    daysAgo: 0,
    paymentStatus: 'paid',
    fulfillmentStatus: 'processing',
    carrier: null,
    trackingNumber: null,
    events: [['ordered', 0], ['paid', 0]],
  },
  {
    query: 'electric kettle',
    index: 1,
    daysAgo: 21,
    paymentStatus: 'refunded',
    fulfillmentStatus: 'returned',
    carrier: 'USPS (demo)',
    trackingNumber: '9400 1000 0000 0000 0004',
    events: [['ordered', 0], ['paid', 0], ['shipped', 1], ['delivered', 4], ['return_started', 6], ['refunded', 8]],
  },
]

const DAY = 24 * 60 * 60 * 1000

export function sampleOrders(accountId: string, shipTo: ShippingAddress, now = new Date()): Prisma.OrderCreateManyInput[] {
  const orders: Prisma.OrderCreateManyInput[] = []
  for (const sample of SAMPLES) {
    const product = pickProduct(sample.query, sample.index)
    if (!product) continue
    const offer = pickOffer(product.product)!
    const item = offerPriceCents(offer)!
    const shipping = shippingCents()
    const createdAt = new Date(now.getTime() - sample.daysAgo * DAY)
    const image = mainImage(product.product)
    const domain = normalizeDomain(offer.domain)
    orders.push({
      id: randomUUID(),
      accountId,
      isSample: true,
      paymentStatus: sample.paymentStatus,
      fulfillmentStatus: sample.fulfillmentStatus,
      productId: product.product.id,
      merchantDomain: domain,
      title: product.product.title,
      merchant: merchantFromDomain(domain),
      imageUrl: image ? (image.cleaned_url ?? image.url) : null,
      itemCents: item,
      shippingCents: shipping,
      totalCents: item + shipping,
      shipTo: shipTo as Prisma.InputJsonValue,
      carrier: sample.carrier,
      trackingNumber: sample.trackingNumber,
      estimatedDelivery: estimatedDelivery(createdAt),
      createdAt,
      refundedAt: sample.paymentStatus === 'refunded' ? new Date(createdAt.getTime() + 8 * DAY) : null,
    })
  }
  return orders
}

export function sampleOrderEvents(orders: Prisma.OrderCreateManyInput[]): Prisma.OrderEventCreateManyInput[] {
  const events: Prisma.OrderEventCreateManyInput[] = []
  for (const order of orders) {
    const sample = SAMPLES.find((s) => order.fulfillmentStatus === s.fulfillmentStatus && order.paymentStatus === s.paymentStatus)
    if (!sample) continue
    const created = new Date(order.createdAt as Date).getTime()
    sample.events.forEach(([status, days], i) => {
      events.push({
        id: randomUUID(),
        orderId: order.id,
        status,
        note: status === 'refunded' ? 'Sample order, so PayPal had nothing to refund' : null,
        // Same-day events keep their order with a millisecond step.
        createdAt: new Date(created + days * DAY + i),
      })
    })
  }
  return events
}

// The n-th sellable product of a recorded budget search, so samples are everyday prices and work offline.
function pickProduct(query: string, index: number): { product: C3Product } | null {
  const sellable = (fixtureSearch(query, null, 45)?.products ?? []).filter((p) => pickOffer(p) !== null)
  const product = sellable[index]
  return product ? { product } : null
}
