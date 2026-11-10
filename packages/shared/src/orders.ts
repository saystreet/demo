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
}

// GET /api/orders/:id
export type OrderView = OrderSummary & {
  product_id: string
  product_source: ProductSource
  source_url: string | null
  merchant_domain: string
  paypal_order_id: string | null
  capture_id: string | null
  item_cents: number
  shipping_cents: number
  ship_to: ShippingAddress // copy at the time of purchase
  carrier: string | null
  tracking_number: string | null
  conversation_id: string | null
  events: { status: string; note: string | null; created_at: string }[] // oldest first
}

// POST /api/orders/:id/return
export type ReturnResponse = {
  order: OrderView
  result: 'done' | 'started' | 'already' | 'failed' // started: PayPal is still processing the refund
  say: string // "Refund of $34.99 done."
}
