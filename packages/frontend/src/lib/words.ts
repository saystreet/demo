import { type OrderSummary, type RejectReason, formatUSD } from '@saystreet/shared'

// Status in words, never colour alone (spec 16.12).

const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const dateTimeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export const weekday = (date: string) => weekdayFmt.format(new Date(`${date}T00:00:00Z`))
export const shortDate = (date: string) => dayFmt.format(new Date(date.length === 10 ? `${date}T00:00:00Z` : date))
export const dateTime = (iso: string) => dateTimeFmt.format(new Date(iso))

export function orderStatus(order: OrderSummary): { words: string; tone: 'plain' | 'good' | 'warn' | 'bad' } {
  if (order.payment_status === 'pending') return { words: 'Waiting for PayPal', tone: 'warn' }
  if (order.payment_status === 'failed') return { words: 'Payment declined', tone: 'bad' }
  if (order.payment_status === 'refund_pending') return { words: 'Refund in progress', tone: 'warn' }
  switch (order.fulfillment_status) {
    case 'processing':
      return { words: 'Being prepared', tone: 'plain' }
    case 'shipped':
      return { words: order.estimated_delivery ? `On its way, arrives ${weekday(order.estimated_delivery)}` : 'On its way', tone: 'warn' }
    case 'delivered':
      return { words: order.estimated_delivery ? `Delivered ${shortDate(order.estimated_delivery)}` : 'Delivered', tone: 'good' }
    case 'returned':
      return { words: `Returned, refunded ${formatUSD(order.total_cents)}`, tone: 'plain' }
  }
}

export const EVENT_WORDS: Record<string, string> = {
  ordered: 'Ordered',
  paid: 'Paid with PayPal',
  payment_pending: 'Waiting for PayPal',
  shipped: 'Shipped',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  return_started: 'Return started',
  refunded: 'Refunded',
  failed: 'Payment declined',
}

export const REJECT_WORDS: Record<RejectReason, string> = {
  PRICE_CHANGED: 'The price changed',
  OUT_OF_STOCK: 'Out of stock',
  PRICE_UNAVAILABLE: "Couldn't check the price",
  OVER_LIMIT: 'Over your limit per purchase',
  OVER_WEEKLY_LIMIT: 'Over your weekly limit',
  AMOUNT_MISMATCH: 'A different amount was said',
  AMOUNT_MISSING: 'No amount was said',
  EXPIRED: 'It expired',
  CANCELLED: 'Cancelled',
}

export function ratingWords(rating: number | null, count: number | null): string | null {
  if (rating === null) return null
  const value = rating.toFixed(1)
  return count ? `${value} out of 5, ${count.toLocaleString('en-US')} ratings` : `${value} out of 5`
}
