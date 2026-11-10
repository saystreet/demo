import { type OrderSummary, type RejectReason, formatUSD } from '@saystreet/shared'

// Status in words, never colour alone (spec 16.12).

const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const localDayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const nearFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

// Two kinds of dates. A day (YYYY-MM-DD: delivery, return-by) is a calendar day, the same
// everywhere, so it's read in UTC. A moment (an ISO timestamp: ordered, history) is shown in the
// person's own time zone. Mixing the two made one order "Nov 10" in the list and "Nov 11" inside.
const isDay = (date: string) => date.length === 10
export const weekday = (date: string) => weekdayFmt.format(new Date(`${date}T00:00:00Z`))
export const shortDate = (date: string) => (isDay(date) ? dayFmt.format(new Date(`${date}T00:00:00Z`)) : localDayFmt.format(new Date(date)))
export const dateTime = (iso: string) => dateTimeFmt.format(new Date(iso))

// "today", "tomorrow", "Friday" within the week, then "Wed, Nov 18": a bare weekday is ambiguous
// once it's more than six days away, and "arrives Wednesday" on a Wednesday should say today.
export function dayWords(date: string, now = new Date()): string {
  // A moment counts on the person's own calendar day.
  const local = new Date(date)
  const day = isDay(date) ? date : `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((new Date(`${day}T00:00:00Z`).getTime() - today) / 86_400_000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  if (diff > 1 && diff < 7) return weekday(day)
  return nearFmt.format(new Date(`${day}T00:00:00Z`))
}

// Store names as people write them; the catalog sometimes has only a domain-style name.
const STORE_NAMES: Record<string, string> = { publicgoods: 'Public Goods', qvc: 'QVC', hsn: 'HSN', bestbuy: 'Best Buy', homedepot: 'The Home Depot' }
export const storeName = (name: string) => STORE_NAMES[name.toLowerCase().replace(/[^a-z]/g, '')] ?? name

export function orderStatus(order: OrderSummary): { words: string; tone: 'plain' | 'good' | 'warn' | 'bad' } {
  if (order.payment_status === 'pending') return { words: 'Waiting for PayPal', tone: 'warn' }
  if (order.payment_status === 'failed') return { words: 'Payment declined', tone: 'bad' }
  if (order.payment_status === 'refund_pending') return { words: 'Refund in progress', tone: 'warn' }
  switch (order.fulfillment_status) {
    case 'processing':
      return {
        words: order.estimated_delivery ? `Being prepared, arrives ${dayWords(order.estimated_delivery)}` : 'Being prepared',
        tone: 'plain',
      }
    case 'shipped':
      // A normal state, not a warning: plain, not the accent-yellow warn tone.
      return { words: order.estimated_delivery ? `On its way, arrives ${dayWords(order.estimated_delivery)}` : 'On its way', tone: 'plain' }
    case 'delivered': {
      const day = order.delivered_at ?? order.estimated_delivery
      return { words: day ? `Delivered ${dayWords(day)}` : 'Delivered', tone: 'good' }
    }
    case 'returned':
      return {
        words: order.is_sample ? 'Returned, no money moved' : `Returned, ${formatUSD(order.total_cents)} refunded to PayPal`,
        tone: 'plain',
      }
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

// Sample orders never went through PayPal: their history must not say it did.
export const SAMPLE_EVENT_WORDS: Record<string, string> = { paid: 'Paid (sample order)', refunded: 'Refunded (sample order, no money moved)' }

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
