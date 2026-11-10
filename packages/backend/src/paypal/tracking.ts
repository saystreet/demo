import { paypalRequest } from './client'

// Orders v2 tracking: tell PayPal a paid order has shipped, with carrier and tracking number.
// The buyer then sees the shipment in PayPal. PayPal trackers are only SHIPPED or CANCELLED,
// so "delivered" exists in SayStreet only.

type TrackedOrder = { purchase_units?: { shipping?: { trackers?: { id: string; status: string }[] } }[] }

export async function addTracker(input: {
  paypalOrderId: string
  captureId: string
  trackingNumber: string
  carrierName: string
}): Promise<{ trackerId: string | null; status: string | null }> {
  const order = await paypalRequest<TrackedOrder>('POST', `/v2/checkout/orders/${input.paypalOrderId}/track`, {
    requestId: `track:${input.captureId}:${input.trackingNumber}`,
    body: {
      capture_id: input.captureId,
      tracking_number: input.trackingNumber,
      carrier: 'OTHER',
      carrier_name_other: input.carrierName,
      notify_payer: false,
    },
  })
  const trackers = order.purchase_units?.[0]?.shipping?.trackers ?? []
  const tracker = trackers.find((t) => t.id.endsWith(input.trackingNumber)) ?? trackers.at(-1)
  return { trackerId: tracker?.id ?? null, status: tracker?.status ?? null }
}
