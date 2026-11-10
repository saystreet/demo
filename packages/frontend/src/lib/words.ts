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
  AMOUNT_MISMATCH: "The amount you said didn't match",
  AMOUNT_MISSING: "You didn't say the amount",
  EXPIRED: 'Time ran out',
  CANCELLED: 'Cancelled',
}

export function ratingWords(rating: number | null, count: number | null): string | null {
  if (rating === null) return null
  const value = rating.toFixed(1)
  return count ? `${value} stars, ${count.toLocaleString('en-US')} ratings` : `${value} stars`
}

// A payment-log line in plain words. The server writes one technical line per money decision
// ("REJECTED mandate=3fa2c1 reason=PRICE_CHANGED quoted=3499 live=4199 → no Orders API call");
// read aloud that's "mandate equals 3 f a…", so the log shows this sentence and keeps the
// technical line under it for people who want the proof.
export function auditWords(line: string): string {
  const [type = '', ...rest] = line.split(' ')
  const kind = type === 'WEBHOOK' ? `WEBHOOK ${rest[0] ?? ''}` : type
  const field = (key: string) => line.match(new RegExp(`\\b${key}=(\\S+)`))?.[1] ?? null
  const money = (key: string) => {
    const cents = Number(field(key))
    return field(key) !== null && Number.isFinite(cents) ? formatUSD(cents) : null
  }
  const reason = field('reason') as RejectReason | null
  const why = reason && reason in REJECT_WORDS ? REJECT_WORDS[reason].toLowerCase() : 'a check failed'
  switch (kind) {
    case 'PROPOSED':
      return `Ready to pay ${money('total') ?? 'the total'}${field('merchant') ? ` at ${field('merchant')}` : ''}. Waiting for the person to confirm.`
    case 'PAID':
      return `Paid ${money('total') ?? ''}. PayPal captured the payment.`.replace('Paid .', 'Paid.')
    case 'PENDING':
      return `Sent to PayPal${money('total') ? `, ${money('total')}` : ''}. Waiting for PayPal to finish.`
    case 'FAILED':
      return 'PayPal declined the payment. Nothing was paid.'
    case 'REJECTED':
    case 'REFUSED': {
      if (reason === 'PRICE_CHANGED' && money('quoted') && money('live')) {
        return `Refused: the price changed from ${money('quoted')} to ${money('live')}. Nothing was paid.`
      }
      if (reason === 'AMOUNT_MISMATCH' && money('heard') && money('total')) {
        return `Refused: heard ${money('heard')}, but the total was ${money('total')}. Nothing was paid.`
      }
      return `Refused: ${why}. Nothing was paid.`
    }
    case 'CANCELLED':
      return 'Cancelled before paying. PayPal was never asked to pay.'
    case 'EXTENDED':
      return `More time to confirm${field('until') ? `, until ${timeOnly(field('until')!)}` : ''}.`
    case 'SHIPPED':
      return `Order shipped${field('tracking') ? `, tracking ${field('tracking')}` : ''}.`
    case 'DELIVERED':
      return 'Order delivered.'
    case 'REFUND':
      return `Refunded ${money('total') ?? 'the order'} through PayPal.`
    case 'SAMPLE':
      return 'Sample order refunded. No PayPal call for sample orders.'
    case 'REFUND_FAILED':
      return "PayPal didn't accept the refund. Nothing changed."
    case 'WEBHOOK COMPLETED':
    case 'WEBHOOK PAID':
      return 'PayPal confirmed the payment.'
    case 'WEBHOOK REFUNDED':
      return 'PayPal confirmed the refund.'
    case 'WEBHOOK FAILED':
      return 'PayPal reported the payment failed. Nothing was paid.'
    default:
      return line
  }
}

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const timeOnly = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : timeFmt.format(date)
}
