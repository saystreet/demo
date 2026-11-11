import type { ShippingAddress } from './account'
import type { ProductSource } from './catalog'

export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'refunded' | 'refund_pending'
export type FulfillmentStatus = 'processing' | 'shipped' | 'delivered' | 'returned'

// GET /api/orders
export type OrderSummary = {
  order_id: string
  title: string
  merchant: string
  image_url: string | null
  total_cents: number
  payment_status: PaymentStatus
  fulfillment_status: FulfillmentStatus
  estimated_delivery: string | null // YYYY-MM-DD
  is_sample: boolean // created with the demo account, never went through PayPal
  created_at: string
  delivered_at: string | null // ISO timestamp (or YYYY-MM-DD for older orders), once delivered
  // One return rule for this page and the voice: delivered, paid, and within RETURN_DAYS of delivery.
  returnable: boolean
  return_by: string | null // ISO timestamp, the end of the return window; null until delivered
}

export const RETURN_DAYS = 30

// GET /api/orders/:id
export type OrderView = OrderSummary & {
  product_id: string
  product_source: ProductSource
  source_url: string | null
  merchant_domain: string
  paypal_order_id: string | null
  capture_id: string | null
  paypal_payer_email: string | null // the PayPal account that paid, as PayPal reported it
  own_wallet: boolean // paid with the person's own sandbox account, not the shared demo buyer
  item_cents: number
  shipping_cents: number
  ship_to: ShippingAddress // copy at the time of purchase
  carrier: string | null
  tracking_number: string | null
  conversation_id: string | null
  events: { id: string; status: string; note: string | null; created_at: string }[] // oldest first
  // How the person approved the payment: the amount said (voice) or the Pay button that named it.
  // Null for sample orders.
  confirmation: { method: 'voice' | 'button'; heard_cents: number | null; at: string } | null
  paypal_tracker_id: string | null // tracking sent to PayPal's tracking API
  // Every call SayStreet made to PayPal for this order, and every webhook PayPal sent, oldest first.
  // Empty for sample orders (no PayPal) and on the list.
  paypal_trail?: PayPalStep[]
  refund_id: string | null
  refunded_at: string | null
}

// POST /api/demo/advance-order  ("Ship latest order", "Mark delivered" in Demo tools)
// The phrase is also added to the order's chat. 404/409 when there is nothing to move.
export type AdvanceOrderResponse = {
  order: OrderView | null
  step: 'shipped' | 'delivered' | null
  say: string // "Your … has shipped. SayStreet Demo Carrier, tracking ending 5736. It should arrive Friday."
}

// POST /api/orders/:id/return
export type ReturnResponse = {
  order: OrderView
  result: 'done' | 'started' | 'already' | 'failed' // started: PayPal is still processing the refund
  say: string // "Refund of $34.99 done."
}

// One step on an order's "At PayPal" trail.
export type PayPalStep = {
  at: string // ISO
  label: string // "Create order (Orders v2, vaulted wallet)", "Webhook PAYMENT.CAPTURE.COMPLETED (signature verified)"
  method: string // POST, GET, WEBHOOK
  endpoint: string // "/v2/checkout/orders/5O1…/capture" or the webhook event type
  http_status: number // 0 when PayPal didn't answer
  result: string | null // PayPal's status: COMPLETED, PENDING… or the error name
  paypal_id: string | null
  request_id: string | null // PayPal-Request-Id: retries with it never act twice
  debug_id: string | null
  ms: number
}
