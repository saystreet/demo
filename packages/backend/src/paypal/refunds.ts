import { paypalRequest } from './client'

// Payments v2: full refund of a capture.

type RefundResponse = { id: string; status: string }

export async function refundCapture(captureId: string, requestId: string) {
  const res = await paypalRequest<RefundResponse>('POST', `/v2/payments/captures/${captureId}/refund`, {
    requestId,
    body: {},
  })
  // COMPLETED or PENDING; PENDING settles later through the webhook.
  return { refundId: res.id, status: res.status }
}
