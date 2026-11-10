import { describe, expect, it } from 'vitest'
import type { Order, OrderEvent } from '../generated/prisma/client'
import { canReturn } from './service'

const DAY = 24 * 60 * 60 * 1000
const deliveredAt = new Date('2026-10-01T12:00:00Z')

function order(over: Partial<Order> = {}, events: Partial<OrderEvent>[] = [{ status: 'delivered', createdAt: deliveredAt }]) {
  return {
    paymentStatus: 'paid',
    fulfillmentStatus: 'delivered',
    estimatedDelivery: null,
    ...over,
    events: events as OrderEvent[],
  } as Order & { events: OrderEvent[] }
}

describe('canReturn: the one return rule', () => {
  it('delivered and paid, inside 30 days → ok', () => {
    expect(canReturn(order(), new Date(deliveredAt.getTime() + 30 * DAY))).toBe('ok')
  })
  it('a moment past 30 days → window_closed', () => {
    expect(canReturn(order(), new Date(deliveredAt.getTime() + 30 * DAY + 1))).toBe('window_closed')
  })
  it.each([
    [{ fulfillmentStatus: 'processing' }, 'not_delivered'],
    [{ fulfillmentStatus: 'shipped' }, 'not_delivered'],
    [{ paymentStatus: 'pending', fulfillmentStatus: 'processing' }, 'payment_pending'],
    [{ paymentStatus: 'failed', fulfillmentStatus: 'processing' }, 'not_paid'],
    [{ paymentStatus: 'refunded', fulfillmentStatus: 'returned' }, 'already'],
    [{ paymentStatus: 'refund_pending' }, 'already'],
  ] as const)('%o → %s', (over, expected) => {
    expect(canReturn(order(over as Partial<Order>), deliveredAt)).toBe(expected)
  })
  it('no delivered event: the delivery date on the order counts', () => {
    expect(canReturn(order({ estimatedDelivery: deliveredAt }, []), new Date(deliveredAt.getTime() + 2 * DAY))).toBe('ok')
  })
})
