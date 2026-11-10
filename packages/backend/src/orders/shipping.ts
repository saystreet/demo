import { randomInt, randomUUID } from 'node:crypto'
import { audit, fields, shortId } from '../audit'
import { addMessages } from '../conversations/service'
import { db } from '../db'
import { addTracker, PayPalError } from '../paypal'
import { templates } from '../templates'
import { estimatedDelivery, type OrderWithEvents, weekday } from './service'

// Demo delivery (spec 15.9). SayStreet is the seller in the sandbox, so it "ships" the order
// the way a real seller on PayPal would: a carrier and tracking number, added to the PayPal
// order. The store never gets the order; the carrier and number are labelled as demo.

export const DEMO_CARRIER = 'SayStreet Demo Carrier'

export type AdvanceResult = { order: OrderWithEvents; say: string; step: 'shipped' | 'delivered' }

// The order "Ship latest order" moves: the newest real purchase that is paid and not delivered yet.
export async function latestOpenOrder(accountId: string): Promise<OrderWithEvents | null> {
  return db().order.findFirst({
    where: { accountId, isSample: false, paymentStatus: 'paid', fulfillmentStatus: { in: ['processing', 'shipped'] } },
    orderBy: { createdAt: 'desc' },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
}

// processing → shipped → delivered. Anything else stays as it is (null).
export async function advanceOrder(order: OrderWithEvents): Promise<AdvanceResult | null> {
  if (order.paymentStatus !== 'paid') return null
  if (order.fulfillmentStatus === 'processing') return ship(order)
  if (order.fulfillmentStatus === 'shipped') return deliver(order)
  return null
}

async function ship(order: OrderWithEvents): Promise<AdvanceResult> {
  const trackingNumber = `SS${String(randomInt(0, 10 ** 10)).padStart(10, '0')}`
  let trackerId: string | null = null
  let paypalNote = 'no PayPal order (sample)'
  if (!order.isSample && order.paypalOrderId && order.captureId) {
    try {
      const tracker = await addTracker({
        paypalOrderId: order.paypalOrderId,
        captureId: order.captureId,
        trackingNumber,
        carrierName: DEMO_CARRIER,
      })
      trackerId = tracker.trackerId
      paypalNote = `paypal_tracker=${tracker.trackerId} status=${tracker.status}`
    } catch (error) {
      // The shipment still happens in SayStreet; the log says PayPal didn't get it.
      console.error('PayPal tracker failed', error)
      paypalNote = `paypal_tracker=FAILED ${error instanceof PayPalError ? error.status : ''}`.trim()
    }
  }

  const now = new Date()
  const eta = estimatedDelivery(now, 2)
  const updated = await db().order.update({
    where: { id: order.id },
    data: {
      fulfillmentStatus: 'shipped',
      carrier: DEMO_CARRIER,
      trackingNumber,
      paypalTrackerId: trackerId,
      estimatedDelivery: eta,
      events: { create: [{ id: randomUUID(), status: 'shipped', note: `${DEMO_CARRIER} ${trackingNumber}`, createdAt: now }] },
    },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
  await audit(order.accountId, 'order.shipped', `SHIPPED ${fields({ order: shortId(order.id), tracking: trackingNumber })} ${paypalNote}`)
  const say = templates.shipped(order.title, DEMO_CARRIER, trackingNumber.slice(-4), weekday(eta))
  await tellChat(updated, say)
  return { order: updated, say, step: 'shipped' }
}

async function deliver(order: OrderWithEvents): Promise<AdvanceResult> {
  const now = new Date()
  const updated = await db().order.update({
    where: { id: order.id },
    data: {
      fulfillmentStatus: 'delivered',
      estimatedDelivery: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      events: { create: [{ id: randomUUID(), status: 'delivered', createdAt: now }] },
    },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
  await audit(order.accountId, 'order.delivered', `DELIVERED ${fields({ order: shortId(order.id) })} (SayStreet only: PayPal trackers have no delivered status)`)
  const say = templates.delivered(order.title)
  await tellChat(updated, say)
  return { order: updated, say, step: 'delivered' }
}

// The news also goes into the chat where the order was bought.
async function tellChat(order: OrderWithEvents, text: string) {
  if (!order.conversationId) return
  await addMessages(order.conversationId, [{ role: 'system', source: 'system', text }])
}
