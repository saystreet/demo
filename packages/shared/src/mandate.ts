// A mandate is a purchase waiting for the person's confirmation: they say the exact total
// ("pay thirty-nine ninety-nine") or press the Pay button that names it.

import type { ShippingAddress } from './account'
import type { PayPalStep } from './orders'

export type MandateStatus = 'proposed' | 'paying' | 'paid' | 'pending' | 'rejected' | 'failed' | 'expired' | 'cancelled'

// Why a payment didn't happen.
export type RejectReason =
  | 'PRICE_CHANGED' // the store's price differs from the confirmed one, in either direction
  | 'OUT_OF_STOCK'
  | 'PRICE_UNAVAILABLE' // couldn't check the current price
  | 'OVER_LIMIT' // over the per-purchase limit
  | 'OVER_WEEKLY_LIMIT'
  | 'AMOUNT_MISMATCH' // said a different amount; the mandate stays open
  | 'AMOUNT_MISSING' // said "pay" without an amount; the mandate stays open
  | 'EXPIRED' // two minutes passed
  | 'CANCELLED'

export type MandateView = {
  id: string
  conversation_id: string
  status: MandateStatus
  title: string
  merchant: string
  image_url: string | null
  item_cents: number
  shipping_cents: number
  total_cents: number
  ship_to: ShippingAddress
  spoken: string // "thirty-nine ninety-nine", for the hint "Or say pay …"
  expires_at: string // countdown; the frontend says "30 seconds left to confirm." once
  reject_reason: RejectReason | null
  live_total_cents: number | null // the new total when the price changed
  audit_line: string | null // engine log line for a refusal, e.g. "REJECTED mandate=3fa2c1 reason=PRICE_CHANGED …"
  order_id: string | null // after payment
  paypal_order_id: string | null // shown on the receipt
  // On the receipt, what PayPal answered: the calls made for this payment, the capture and the
  // PayPal account that paid. Missing on receipts saved before it existed.
  paypal?: {
    capture_id: string | null
    capture_status: string | null // COMPLETED, PENDING…
    payer_email: string | null
    own_wallet: boolean // the person's own sandbox account: they can find the payment in PayPal
    steps: PayPalStep[]
  } | null
}

// POST /api/mandates/:id/pay
export type PayRequest = { confirm_cents: number }
